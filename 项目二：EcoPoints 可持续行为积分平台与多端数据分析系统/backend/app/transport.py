"""Shared GPX/Flutter ingestion and server-side transport rewards."""
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import math
from typing import Literal
from xml.etree import ElementTree as ET
from xml.parsers import expat

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import get_db
from .dependencies import get_current_user
from .models import PointTransaction, TransportRule, TransportTrip, User

router = APIRouter(prefix="/api/transport-trips", tags=["transport"])
MAX_BYTES = 5 * 1024 * 1024
MAX_POINTS = 20000
RULES = {
    "walking": {"min_distance_m": 500, "min_duration_s": 300, "max_speed_kmh": 12, "points": 10},
    "cycling": {"min_distance_m": 1000, "min_duration_s": 300, "max_speed_kmh": 60, "points": 20},
}

class RuleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    enabled: bool
    min_distance_m: int = Field(ge=1, le=100000)
    min_duration_s: int = Field(ge=1, le=86400)
    max_speed_kmh: float = Field(gt=0, le=200)
    points: int = Field(ge=0, le=10000)

class RulesUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    walking: RuleUpdate
    cycling: RuleUpdate

def current_rules(db):
    modes = {mode: {"enabled": True, **rule} for mode, rule in RULES.items()}
    for row in db.scalars(select(TransportRule)).all():
        if row.mode in modes:
            modes[row.mode] = {key: getattr(row, key) for key in ("enabled", "min_distance_m", "min_duration_s", "max_speed_kmh", "points")}
    return modes

def require_admin(user):
    if user.role != "admin":
        raise HTTPException(403, "Only administrators can manage transport point rules.")

@router.get("/admin/rules")
def admin_rules(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_admin(user)
    return {"modes": current_rules(db)}

@router.put("/admin/rules")
def update_rules(payload: RulesUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_admin(user)
    for mode in RULES:
        row = db.get(TransportRule, mode)
        if row is None:
            row = TransportRule(mode=mode)
            db.add(row)
        for key, value in getattr(payload, mode).model_dump().items():
            setattr(row, key, value)
        row.updated_by = user.id
        row.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    return {"modes": current_rules(db), "message": "Transport point rules saved. New uploads use these rules."}

class TrackPoint(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    timestamp: datetime
    accuracy_m: float | None = Field(default=None, ge=0)

    @field_validator("timestamp")
    @classmethod
    def utc_timestamp(cls, value):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Each timestamp needs a timezone, for example 2026-10-13T08:00:00Z.")
        return value.astimezone(timezone.utc)

class TripCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["walking", "cycling"]
    segments: list[list[TrackPoint]] = Field(min_length=1, max_length=1000)

    @field_validator("segments")
    @classmethod
    def bounded_points(cls, value):
        count = sum(len(segment) for segment in value)
        if not 2 <= count <= MAX_POINTS or any(len(segment) < 2 for segment in value):
            raise ValueError("Provide 2–20,000 points in segments containing at least two points each.")
        return value

class TripOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    mode: str
    source: str
    source_filename: str | None
    started_at: datetime
    ended_at: datetime
    distance_m: float
    duration_s: float
    point_count: int
    status: str
    validation_message: str
    warnings: list[str]
    points_awarded: int
    created_at: datetime

    @field_validator("started_at", "ended_at", "created_at")
    @classmethod
    def response_utc(cls, value):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)

class ImportResult(BaseModel):
    trip: TripOut
    duplicate: bool
    awarded_now: int
    message: str

class TripPage(BaseModel):
    items: list[TripOut]
    total: int
    limit: int
    offset: int

def parse_gpx(content: bytes, mode: str) -> TripCreate:
    # Expat recognizes declarations in UTF-8/UTF-16 too; never expand a DTD/entity.
    def forbid_dtd(*_):
        raise ValueError("GPX files must not contain a DTD or entity declarations.")
    try:
        guard = expat.ParserCreate()
        guard.StartDoctypeDeclHandler = forbid_dtd
        guard.EntityDeclHandler = forbid_dtd
        guard.ExternalEntityRefHandler = forbid_dtd
        guard.Parse(content, True)
        root = ET.fromstring(content)
        if root.tag.split("}")[-1] != "gpx":
            raise ValueError("Choose a GPX track file.")
        # Match only GPX children, not similarly named extension elements.
        namespace = root.tag[:-3] if root.tag.endswith("}gpx") else ""
        segments = []
        count = 0
        for segment in root.findall(f"{namespace}trk/{namespace}trkseg"):
            points = []
            for item in segment.findall(f"{namespace}trkpt"):
                time = item.find(f"{namespace}time")
                if time is None or not time.text:
                    raise ValueError("Every GPX track point must include a timestamp with timezone.")
                points.append({"latitude": item.attrib.get("lat"), "longitude": item.attrib.get("lon"), "timestamp": time.text.strip()})
                count += 1
                if count > MAX_POINTS:
                    raise ValueError("A trip can contain at most 20,000 track points.")
            if points:
                segments.append(points)
        return TripCreate(mode=mode, segments=segments)
    except (ET.ParseError, expat.ExpatError, ValueError, ValidationError) as error:
        detail = "GPX needs valid coordinates and timezone-aware timestamps, with at least two points per segment." if isinstance(error, ValidationError) else str(error)
        raise HTTPException(422, detail=detail or "Invalid GPX XML.") from error

def distance(a: TrackPoint, b: TrackPoint) -> float:
    lat1, lat2 = math.radians(a.latitude), math.radians(b.latitude)
    dlat, dlon = lat2 - lat1, math.radians(b.longitude - a.longitude)
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(min(1, max(0, h))))

def evaluate(payload: TripCreate, modes=None) -> dict:
    rule = (modes or RULES)[payload.mode]
    points = [point for segment in payload.segments for point in segment]
    now = datetime.now(timezone.utc)
    for previous, current in zip(points, points[1:]):
        if current.timestamp <= previous.timestamp:
            raise HTTPException(422, "Track timestamps must be strictly increasing, including across segments.")
    if points[-1].timestamp > now + timedelta(minutes=10):
        raise HTTPException(422, "Track timestamps are in the future. Check the recording device clock.")
    if points[-1].timestamp - points[0].timestamp > timedelta(hours=24):
        raise HTTPException(422, "Upload one trip of at most 24 hours.")
    total_distance, duration, max_speed = 0.0, 0.0, 0.0
    gap_count = inaccurate = 0
    for segment in payload.segments:
        anchor = None
        previous = None
        for point in segment:
            if point.accuracy_m is not None and point.accuracy_m > 50:
                inaccurate += 1
                anchor = previous = None
                continue
            if previous is not None:
                dt = (point.timestamp - previous.timestamp).total_seconds()
                if dt > 120:
                    gap_count += 1
                    anchor = point
                else:
                    duration += dt
                    # Accumulate small movements against an anchor to reduce GPS jitter.
                    moved = distance(anchor, point)
                    if moved >= 3:
                        elapsed = (point.timestamp - anchor.timestamp).total_seconds()
                        max_speed = max(max_speed, moved / elapsed * 3.6)
                        total_distance += moved
                        anchor = point
            else:
                anchor = point
            previous = point
    warnings = []
    if gap_count:
        warnings.append(f"{gap_count} gap(s) longer than 120 seconds excluded from distance and duration.")
    if inaccurate:
        warnings.append(f"{inaccurate} point(s) with accuracy worse than 50 m excluded.")
    reasons = []
    if not rule.get("enabled", True):
        reasons.append(f"Points for {payload.mode} are currently disabled.")
    if max_speed > rule["max_speed_kmh"]:
        reasons.append(f"Track contains speeds above {rule['max_speed_kmh']} km/h for {payload.mode}.")
    if total_distance < rule["min_distance_m"]:
        reasons.append(f"At least {rule['min_distance_m']} m of valid distance is required.")
    if duration < rule["min_duration_s"]:
        reasons.append(f"At least {rule['min_duration_s']} seconds of valid recording is required.")
    # Independent of file formatting, filename, source and selected transport mode.
    canonical = [[[round(p.latitude, 7), round(p.longitude, 7), p.timestamp.isoformat()] for p in segment] for segment in payload.segments]
    return dict(
        track_hash=sha256(json.dumps(canonical, separators=(",", ":")).encode()).hexdigest(),
        started_at=points[0].timestamp.replace(tzinfo=None), ended_at=points[-1].timestamp.replace(tzinfo=None),
        distance_m=round(total_distance, 2), duration_s=round(duration, 2), point_count=len(points),
        status="rejected" if reasons else "accepted", validation_message=" ".join(reasons) if reasons else "Trip meets the distance, duration and speed requirements.",
        warnings=warnings, points_awarded=0 if reasons else rule["points"],
    )

def allowed_user(user: User):
    if user.role == "admin":
        raise HTTPException(403, "Administrator accounts cannot earn transport points.")

def existing_trip(db: Session, user_id: int, track_hash: str, mode: str):
    return db.scalar(select(TransportTrip).where(TransportTrip.user_id == user_id, TransportTrip.track_hash == track_hash,
        (TransportTrip.status == "accepted") | (TransportTrip.mode == mode)).order_by((TransportTrip.status == "accepted").desc(), TransportTrip.id).with_for_update())

def result_for(trip, duplicate=False):
    return ImportResult(trip=TripOut.model_validate(trip), duplicate=duplicate, awarded_now=0 if duplicate else trip.points_awarded,
        message="This track was already submitted. No additional points awarded." if duplicate else trip.validation_message)

def save_trip(payload, user, db, source, filename=None, file_hash=None):
    allowed_user(user)
    values = evaluate(payload, current_rules(db))
    # Serialize imports per account on MySQL; unique constraint also protects retries.
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    existing = existing_trip(db, user.id, values["track_hash"], payload.mode)
    if existing:
        return result_for(existing, True)
    imported_at = datetime.now(timezone.utc).replace(tzinfo=None)
    trip = TransportTrip(user_id=user.id, mode=payload.mode, source=source, source_filename=filename, file_hash=file_hash, created_at=imported_at, **values)
    try:
        db.add(trip)
        db.flush()
        if trip.points_awarded:
            transaction = PointTransaction(user_id=user.id, points=trip.points_awarded, note=f"Transport: {payload.mode}; trip #{trip.id}", created_at=imported_at)
            db.add(transaction)
            db.flush()
            trip.point_transaction_id = transaction.id
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = existing_trip(db, user.id, values["track_hash"], payload.mode)
        if existing:
            return result_for(existing, True)
        raise
    db.refresh(trip)
    return result_for(trip)

@router.get("/rules")
def rules(db: Session = Depends(get_db)):
    return {"modes": current_rules(db), "max_file_bytes": MAX_BYTES, "max_points": MAX_POINTS, "max_gap_s": 120, "max_accuracy_m": 50, "max_trip_hours": 24}

@router.post("/import", response_model=ImportResult)
async def import_gpx(mode: Literal["walking", "cycling"] = Form(...), file: UploadFile = File(...),
                     user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    allowed_user(user)
    try:
        content = await file.read(MAX_BYTES + 1)
    finally:
        await file.close()
    if len(content) > MAX_BYTES:
        raise HTTPException(413, "GPX file must be 5 MB or smaller.")
    filename = (file.filename or "track.gpx").replace("\\", "/").split("/")[-1][:255]
    if not filename.lower().endswith(".gpx"):
        raise HTTPException(422, "Choose a .gpx file exported with track timestamps.")
    return save_trip(parse_gpx(content, mode), user, db, "gpx", filename, sha256(content).hexdigest())

@router.post("", response_model=ImportResult)
def import_mobile(payload: TripCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Flutter can submit locally recorded segments using the same validation."""
    return save_trip(payload, user, db, "mobile")

@router.get("", response_model=TripPage)
def history(limit: int = Query(10, ge=1, le=50), offset: int = Query(0, ge=0),
            user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    allowed_user(user)
    where = TransportTrip.user_id == user.id
    items = db.scalars(select(TransportTrip).where(where).order_by(TransportTrip.id.desc()).offset(offset).limit(limit)).all()
    return TripPage(items=items, total=db.scalar(select(func.count()).select_from(TransportTrip).where(where)), limit=limit, offset=offset)
