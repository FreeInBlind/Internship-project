"""Account-scoped dashboard, typed CSV ingestion and reusable chart analysis."""
from __future__ import annotations

import csv
import io
import math
import statistics
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select, func, insert, case
from sqlalchemy.orm import Session

from .database import get_db
from .dependencies import get_current_user
from .models import DashboardLayout, Initiative, Organization, OrganizationDataset, OrganizationDataRow, PointTransaction, Redemption, Reward, TransportTrip, User

router = APIRouter(prefix="/api", tags=["analytics"])
MAX_ROWS, MAX_COLUMNS, MAX_BYTES = 50000, 60, 10 * 1024 * 1024
TYPES = {"line", "bar", "area", "stacked", "donut", "scatter", "heatmap", "treemap", "radar", "boxplot", "histogram"}


class ChartRequest(BaseModel):
    dataset_id: int
    chart_type: str = "line"
    dimension: str
    metric: str
    second_metric: str | None = None
    aggregation: Literal["sum", "mean", "count", "min", "max"] = "sum"
    split: str | None = None
    filters: dict[str, str] = Field(default_factory=dict)
    date_column: str | None = None
    start: date | None = None
    end: date | None = None
    analysis: Literal["none", "moving-average", "forecast", "anomalies", "comparison"] = "none"
    title: str = Field(default="", max_length=120)


class LayoutRequest(BaseModel):
    widgets: list[dict] = Field(max_length=24)


def require_org(user):
    if user.role != "organization" or not user.organization_id:
        raise HTTPException(403, "An organization account is required")


def require_plus(user):
    if user.subscription_tier != "plus":
        raise HTTPException(403, "This analysis is available on Plus")


def owned_dataset(db, user, dataset_id):
    require_org(user)
    item = db.scalar(select(OrganizationDataset).where(OrganizationDataset.id == dataset_id, OrganizationDataset.organization_id == user.organization_id))
    if not item:
        raise HTTPException(404, "Dataset not found")
    return item


def number(value):
    try:
        result = float(str(value).replace(",", ""))
        return result if math.isfinite(result) and abs(result) <= 1e100 else None
    except (TypeError, ValueError):
        return None


def day(value):
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def parse_csv(raw: bytes):
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, "CSV files must be 10 MB or smaller")
    try:
        content = raw.decode("utf-8-sig")
        if "\x00" in content:
            raise HTTPException(400, "CSV files cannot contain null bytes")
        reader = csv.reader(io.StringIO(content), strict=True)
        headers = [value.strip() for value in next(reader)]
        if not headers or any(not key or len(key) > 120 for key in headers) or len(set(headers)) != len(headers) or len(headers) > MAX_COLUMNS:
            raise HTTPException(400, "Use 1–60 unique, non-empty column names (maximum 120 characters each)")
        rows = []
        for line, values in enumerate(reader, 2):
            if not values or not any(value.strip() for value in values):
                continue
            if len(values) != len(headers):
                raise HTTPException(400, f"Row {line} has {len(values)} fields; expected {len(headers)}")
            if any(len(value) > 2000 for value in values):
                raise HTTPException(400, f"Row {line} contains a cell longer than 2000 characters")
            rows.append(dict(zip(headers, [value.strip() or None for value in values])))
            if len(rows) > MAX_ROWS:
                raise HTTPException(413, "A dataset may contain at most 50,000 rows")
        if not rows:
            raise HTTPException(400, "The CSV needs a header and at least one data row")
    except (UnicodeDecodeError, csv.Error, StopIteration):
        raise HTTPException(400, "Use a valid UTF-8 CSV file with a header row")
    columns = []
    for key in headers:
        values = [row[key] for row in rows if row[key] is not None]
        kind = "number" if values and all(number(value) is not None for value in values) else "date" if values and all(day(value) is not None for value in values) else "text"
        if kind == "number":
            for row in rows:
                if row[key] is not None:
                    row[key] = number(row[key])
        elif kind == "date":
            for row in rows:
                if row[key] is not None:
                    row[key] = day(row[key]).isoformat()
        columns.append({"name": key, "type": kind, "missing": len(rows) - len(values)})
    duplicate_count = len(rows) - len({tuple(str(row[key]) for key in headers) for row in rows})
    return rows, columns, duplicate_count


def dataset_info(item):
    columns = item.columns
    # Upgrade compatibility with CSVs uploaded during the interrupted first pass.
    if columns and isinstance(columns[0], str):
        columns = [{"name": key, "type": "text", "missing": 0} for key in columns]
    return {"id": item.id, "name": item.name, "rows": item.row_count, "columns": columns, "created_at": item.created_at.isoformat()}


def chart(key, title, kind, data, description="", tier="basic"):
    return {"key": key, "title": title, "chart_type": kind, "data": data, "description": description, "tier": tier}


def user_charts(db, user, start=None, end=None):
    now = datetime.utcnow().date()
    start = start or now - timedelta(days=29)
    end = end or now
    if start > end or (end - start).days > 730:
        raise HTTPException(400, "Choose a valid date range of at most two years")
    category = case((TransportTrip.id.is_not(None), "transport"), else_=Initiative.category).label("category")
    query = select(PointTransaction.created_at, PointTransaction.points, category).outerjoin(Initiative, Initiative.id == PointTransaction.initiative_id).outerjoin(TransportTrip, TransportTrip.point_transaction_id == PointTransaction.id).where(PointTransaction.user_id == user.id, PointTransaction.created_at >= datetime.combine(start, datetime.min.time()), PointTransaction.created_at < datetime.combine(end + timedelta(days=1), datetime.min.time()))
    rows = db.execute(query).all()
    redeemed_rows = db.execute(select(Redemption.created_at, Redemption.points_spent).where(Redemption.user_id == user.id, Redemption.status != "rejected", Redemption.created_at >= datetime.combine(start, datetime.min.time()), Redemption.created_at < datetime.combine(end + timedelta(days=1), datetime.min.time()))).all()
    dates = [(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]
    counts, earned_days, spent_days, categories = Counter(), Counter(), Counter(), Counter()
    for row in rows:
        key = row.created_at.date().isoformat()
        counts[key] += 1
        earned_days[key] += row.points
        categories[row.category or "Other"] += max(0, row.points)
    for row in redeemed_rows:
        spent_days[row.created_at.date().isoformat()] += row.points_spent
    lifetime = int(db.scalar(select(func.coalesce(func.sum(PointTransaction.points), 0)).where(PointTransaction.user_id == user.id)) or 0)
    spent = int(db.scalar(select(func.coalesce(func.sum(Redemption.points_spent), 0)).where(Redemption.user_id == user.id, Redemption.status != "rejected")) or 0)
    balance = max(0, lifetime - spent)
    reward = db.scalar(select(Reward).where(Reward.is_active.is_(True), Reward.stock > 0, Reward.points_cost > balance).order_by(Reward.points_cost))
    catalogue = [
        chart("journey", "My EcoPoints Journey", "line", {"x": dates, "series": [{"name": "Earned", "data": [earned_days[key] for key in dates]}]}, "EcoPoints earned each day in the selected period."),
        chart("activity", "My Activity Trend", "bar", {"x": dates, "series": [{"name": "Activity records", "data": [counts[key] for key in dates]}]}, "Activity records credited to this account."),
        chart("points-flow", "EcoPoints Earned & Redeemed", "bar", {"x": ["Earned", "Redeemed"], "series": [{"name": "EcoPoints", "data": [sum(earned_days.values()), sum(spent_days.values())]}]}, "Reward requests reserve points; rejected requests are excluded."),
        chart("next-reward", "Progress to Your Next Reward", "progress", {"balance": balance, "target": reward.points_cost if reward else None, "reward": reward.name if reward else None}, "Based on your current balance and available reward catalogue."),
    ]
    if user.subscription_tier == "plus":
        catalogue.extend([
            chart("contribution", "Activity Contribution by Category", "donut", {"categories": [{"name": key, "value": value} for key, value in categories.items()]}, "EcoPoints contribution by recorded activity category.", "plus"),
            chart("streak", "My Participation Streak", "calendar", {"days": [[key, counts[key]] for key in dates], "range": [start.isoformat(), end.isoformat()]}, "Days with recorded activity in the selected period.", "plus"),
        ])
    return catalogue, [{"label": "EcoPoints balance", "value": balance}, {"label": "Activity records", "value": len(rows)}, {"label": "EcoPoints earned", "value": sum(earned_days.values())}]


def selected_rows(db, item, req):
    schema = {column["name"]: column for column in dataset_info(item)["columns"]}
    for key in (req.dimension, req.metric, req.second_metric, req.split, req.date_column, *req.filters):
        if key and key not in schema:
            raise HTTPException(400, f"Unknown column: {key}")
    if req.aggregation != "count" and schema[req.metric]["type"] != "number":
        raise HTTPException(400, "Select a numeric metric or use row count")
    if req.start and req.end and req.start > req.end:
        raise HTTPException(400, "The end date must follow the start date")
    if (req.start or req.end) and not req.date_column:
        raise HTTPException(400, "Select a date column to apply a date range")
    rows = list(db.scalars(select(OrganizationDataRow.data).where(OrganizationDataRow.dataset_id == item.id).order_by(OrganizationDataRow.row_number)).all())
    result = []
    for row in rows:
        if any(str(row.get(key)) != value for key, value in req.filters.items() if value != ""):
            continue
        if req.start or req.end:
            value = day(row.get(req.date_column))
            if value is None or req.start and value < req.start or req.end and value > req.end:
                continue
        result.append(row)
    return result, schema


def aggregate(values, operation):
    if operation == "count":
        return len(values)
    if not values:
        return None
    return round({"sum": sum, "mean": statistics.mean, "min": min, "max": max}[operation](values), 4)


def build_chart(db, user, req):
    require_plus(user)
    item = owned_dataset(db, user, req.dataset_id)
    if req.chart_type not in TYPES:
        raise HTTPException(400, "Unsupported chart type")
    rows, schema = selected_rows(db, item, req)
    description = f"{item.name} · {len(rows):,} rows · {req.aggregation} of {req.metric}"
    notes = []
    if req.analysis in {"moving-average", "forecast", "comparison"} and any(day(row.get(req.dimension)) is None for row in rows):
        raise HTTPException(400, "Trend analysis requires a valid date in every dimension value; filter missing dates first")
    if req.chart_type in {"scatter", "histogram", "boxplot"} and schema[req.metric]["type"] != "number":
        raise HTTPException(400, "Distribution and scatter charts require a numeric metric")
    numeric = [number(row.get(req.metric)) for row in rows]
    numeric = [value for value in numeric if value is not None]
    groups = defaultdict(list)
    for row in rows:
        key = str(row.get(req.dimension) if row.get(req.dimension) is not None else "Missing")
        group = str(row.get(req.split) or "Missing") if req.split else req.metric
        value = 1 if req.aggregation == "count" else number(row.get(req.metric))
        if value is not None:
            groups[(key, group)].append(value)
    labels = sorted({key for key, _ in groups})
    if schema[req.dimension]["type"] == "number":
        labels.sort(key=lambda key: (number(key) is None, number(key) or 0))
    if len(labels) > 200:
        labels = labels[:200]
        notes.append("Only the first 200 dimension groups are shown; narrow the filters for detail.")
    splits = sorted({key for _, key in groups})[:12]
    series = [{"name": name, "data": [aggregate(groups[(key, name)], req.aggregation) for key in labels]} for name in splits]
    data = {"x": labels, "series": series}
    if req.chart_type in {"donut", "treemap", "radar"}:
        totals = defaultdict(list)
        for (key, _), values in groups.items():
            totals[key].extend(values)
        pairs = [{"name": key, "value": aggregate(values, req.aggregation)} for key, values in totals.items()]
        pairs.sort(key=lambda pair: pair["value"] or 0, reverse=True)
        if any((pair["value"] or 0) < 0 for pair in pairs):
            raise HTTPException(400, "This chart requires non-negative values; use a bar chart for signed values")
        data = {"categories": pairs[:20]}
    elif req.chart_type == "scatter":
        if not req.second_metric or schema[req.second_metric]["type"] != "number":
            raise HTTPException(400, "Scatter charts need two numeric metrics")
        points = [[number(row.get(req.metric)), number(row.get(req.second_metric))] for row in rows]
        points = [point for point in points if None not in point]
        data = {"points": points[:5000], "x_name": req.metric, "y_name": req.second_metric}
        if len(points) >= 3:
            xs, ys = zip(*points)
            covariance = sum((x - statistics.mean(xs)) * (y - statistics.mean(ys)) for x, y in points)
            divisor = math.sqrt(sum((x - statistics.mean(xs)) ** 2 for x in xs) * sum((y - statistics.mean(ys)) ** 2 for y in ys))
            notes.append(f"Pearson correlation r = {covariance / divisor:.3f}. Correlation does not establish causation." if divisor else "Correlation requires variation in both metrics.")
    elif req.chart_type == "histogram":
        if numeric:
            bins = min(20, max(1, math.ceil(math.sqrt(len(numeric)))))
            low, high = min(numeric), max(numeric)
            width = (high - low) / bins or 1
            counts = [0] * bins
            for value in numeric:
                counts[min(bins - 1, int((value - low) / width))] += 1
            data = {"x": [f"{low + i * width:.2f}–{low + (i + 1) * width:.2f}" for i in range(bins)], "series": [{"name": "Records", "data": counts}]}
    elif req.chart_type == "boxplot":
        def box(values):
            values = sorted(values)
            if not values:
                return None
            def quantile(q):
                index = (len(values) - 1) * q
                return values[int(index)] + (values[math.ceil(index)] - values[int(index)]) * (index % 1)
            return [values[0], quantile(.25), quantile(.5), quantile(.75), values[-1]]
        data = {"x": labels, "boxes": [box([value for (label, _), values in groups.items() if label == key for value in values]) for key in labels]}
        notes.append("Whiskers show minimum and maximum; box shows the 25th, 50th and 75th percentiles.")
    elif req.chart_type == "heatmap":
        if not req.split:
            raise HTTPException(400, "Select a second dimension for the heatmap")
        data = {"x": labels, "y": splits, "cells": [[i, j, aggregate(groups[(key, group)], req.aggregation) or 0] for i, key in enumerate(labels) for j, group in enumerate(splits)]}
    if req.analysis != "none":
        if req.chart_type not in {"line", "area", "bar"} or req.split:
            raise HTTPException(400, "Trend analysis needs a single-series line, area or bar chart")
        values = list(series[0]["data"]) if series else []
        if any(value is None for value in values):
            raise HTTPException(400, "Trend analysis requires numeric values for every displayed group")
        if req.analysis in {"moving-average", "forecast", "comparison"} and schema[req.dimension]["type"] != "date":
            raise HTTPException(400, "This analysis needs a date dimension")
        if req.analysis == "moving-average":
            if len(values) < 3:
                raise HTTPException(400, "Moving average needs at least three time points")
            series.append({"name": "3-period average", "data": [None, None] + [round(statistics.mean(values[i-2:i+1]), 4) for i in range(2, len(values))]})
        elif req.analysis == "anomalies":
            if len(values) < 5:
                raise HTTPException(400, "Anomaly detection needs at least five observations")
            mean, deviation = statistics.mean(values), statistics.pstdev(values)
            data["anomalies"] = [{"coord": [labels[i], value], "value": value} for i, value in enumerate(values) if deviation and abs(value - mean) > 2 * deviation]
            notes.append("Anomalies are observations more than two standard deviations from the mean; review them before drawing conclusions.")
        elif req.analysis == "forecast":
            if len(values) < 5:
                raise HTTPException(400, "Forecast needs at least five time points")
            x = [(day(key) - day(labels[0])).days for key in labels]
            if len(set(x)) < 5:
                raise HTTPException(400, "Forecast needs five distinct dates")
            xm, ym = statistics.mean(x), statistics.mean(values)
            slope = sum((a-xm)*(b-ym) for a,b in zip(x, values)) / sum((a-xm)**2 for a in x)
            intercept = ym - slope * xm
            step = max(1, round(statistics.median([x[i]-x[i-1] for i in range(1, len(x))])))
            future = [(day(labels[-1]) + timedelta(days=step*i)).isoformat() for i in range(1, 4)]
            series[0]["data"] += [None] * 3
            series.append({"name": "Linear projection", "data": [None]*(len(values)-1) + [values[-1]] + [round(intercept+slope*(x[-1]+step*i), 4) for i in range(1,4)], "projected": True})
            labels.extend(future)
            notes.append("Three-period linear extrapolation; a descriptive projection, not a guaranteed outcome.")
        elif req.analysis == "comparison":
            if not req.start or not req.end:
                raise HTTPException(400, "Select a start and end date for period comparison")
            span = (req.end - req.start).days + 1
            previous = req.model_copy(update={"start": req.start - timedelta(days=span), "end": req.start - timedelta(days=1), "analysis": "none"})
            prev_rows, _ = selected_rows(db, item, previous)
            prev_total = len(prev_rows) if req.aggregation == "count" else aggregate([number(row.get(req.metric)) for row in prev_rows if number(row.get(req.metric)) is not None], req.aggregation)
            curr_total = len(rows) if req.aggregation == "count" else aggregate(numeric, req.aggregation)
            data = {"x": ["Previous period", "Selected period"], "series": [{"name": req.metric, "data": [prev_total, curr_total]}]}
            notes.append("Equal-length immediately preceding period. Percentage change is undefined when the previous value is zero.")
    data["notes"] = notes
    data["empty"] = not rows or not groups
    return chart("custom", req.title or f"{req.metric} by {req.dimension}", req.chart_type, data, description, "plus")


def basic_org_charts(db, user, item):
    columns = dataset_info(item)["columns"] if item else []
    def find(names, kind=None):
        return next((column["name"] for column in columns if column["name"].lower() in names and (kind is None or column["type"] == kind)), None)
    definitions = [("participation", "Participation Trend", "line", find({"date", "activity_date", "period_start"}, "date"), find({"participants", "participation_count", "users"}, "number")), ("energy", "Energy Usage by Building", "bar", find({"building", "area"}), find({"energy_kwh", "usage_kwh", "energy"}, "number")), ("contribution", "EcoPoints Contribution by Category", "donut", find({"category", "activity_category"}), find({"points", "points_earned", "ecopoints"}, "number")), ("department", "Department Participation Leaderboard", "bar", find({"department"}), find({"participants", "participation_count", "users"}, "number"))]
    charts = []
    rows = list(db.scalars(select(OrganizationDataRow.data).where(OrganizationDataRow.dataset_id == item.id)).all()) if item else []
    for key, title, kind, dimension, metric in definitions:
        if item and dimension and metric:
            # Basic gets only these fixed aggregations; general analysis stays Plus-only.
            grouped = defaultdict(float)
            for row in rows:
                value = number(row.get(metric))
                if value is not None:
                    grouped[str(row.get(dimension) or "Missing")] += value
            keys = (sorted(grouped, key=lambda label: grouped[label], reverse=True) if kind == "bar" else sorted(grouped))[:100]
            data = {"x": keys, "series": [{"name": metric, "data": [grouped[key] for key in keys]}]}
            if kind == "donut":
                if any(value < 0 for value in grouped.values()):
                    data = {"empty": True, "notes": ["Donut charts require non-negative contributions. Use Plus bar charts to analyze signed adjustments."]}
                else:
                    data = {"categories": [{"name": key, "value": grouped[key]} for key in keys]}
            charts.append(chart(key, title, kind, data, f"{item.name} · {metric}"))
        else:
            charts.append(chart(key, title, kind, {"empty": True}, "Upload a dataset with the required date, category, building or department and numeric fields."))
    return charts


@router.get("/dashboard/summary")
def summary(start: date | None = None, end: date | None = None, dataset_id: int | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role == "admin":
        raise HTTPException(403, "Administrator accounts use the Admin page")
    if (start or end) and user.subscription_tier != "plus":
        require_plus(user)
    datasets, org_name = [], None
    if user.role == "organization":
        require_org(user)
        org = db.get(Organization, user.organization_id)
        org_name = org.name if org else None
        datasets = list(db.scalars(select(OrganizationDataset).where(OrganizationDataset.organization_id == user.organization_id).order_by(OrganizationDataset.created_at.desc())).all())
        item = owned_dataset(db, user, dataset_id) if dataset_id else datasets[0] if datasets else None
        charts = basic_org_charts(db, user, item)
        if user.subscription_tier == "plus":
            columns = dataset_info(item)["columns"] if item else []
            total_cells = (item.row_count if item else 0) * len(columns)
            missing_cells = sum(column.get("missing", 0) for column in columns)
            charts.append(chart("quality", "Data Coverage and Quality", "quality", {"value": round((total_cells - missing_cells) / total_cells * 100, 2) if total_cells else 0, "empty": not total_cells, "notes": [f"{missing_cells:,} missing cells out of {total_cells:,}. Completeness does not establish accuracy."]}, "Proportion of non-empty cells in the selected dataset.", "plus"))
        metrics = [{"label": "Datasets", "value": len(datasets)}, {"label": "Selected dataset rows", "value": item.row_count if item else 0}, {"label": "Numeric fields", "value": sum(column["type"] == "number" for column in dataset_info(item)["columns"]) if item else 0}]
    else:
        charts, metrics = user_charts(db, user, start, end)
    layout = db.get(DashboardLayout, user.id)
    return {"role": user.role, "tier": user.subscription_tier, "organization_name": org_name, "metrics": metrics, "charts": charts, "datasets": [dataset_info(item) for item in datasets], "layout": layout.widgets if layout else None, "chart_types": sorted(TYPES) if user.role == "organization" and user.subscription_tier == "plus" else []}


@router.post("/organization/datasets/preview")
async def preview(file: UploadFile = File(...), user: User = Depends(get_current_user)):
    require_org(user)
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(415, "Upload a CSV file")
    rows, columns, duplicate_count = parse_csv(await file.read(MAX_BYTES + 1))
    return {"rows": len(rows), "columns": columns, "sample": rows[:10], "duplicates": duplicate_count}


@router.post("/organization/datasets", status_code=201)
async def upload(name: str = Form(...), file: UploadFile = File(...), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_org(user)
    if not name.strip() or len(name.strip()) > 180:
        raise HTTPException(400, "Enter a dataset name of 1–180 characters")
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(415, "Upload a CSV file")
    rows, columns, duplicate_count = parse_csv(await file.read(MAX_BYTES + 1))
    # Basic can bring its own data too, with a smaller practical allowance.
    if user.subscription_tier != "plus" and len(rows) > 5000:
        raise HTTPException(413, "Basic datasets support 5,000 rows; Plus supports 50,000")
    item = OrganizationDataset(organization_id=user.organization_id, uploaded_by=user.id, name=name.strip(), source_filename=(file.filename or "dataset.csv")[:255], columns=columns, row_count=len(rows))
    db.add(item)
    db.flush()
    for offset in range(0, len(rows), 1000):
        db.execute(insert(OrganizationDataRow), [{"dataset_id": item.id, "row_number": i + 1, "data": rows[i]} for i in range(offset, min(offset+1000, len(rows)))])
    db.commit()
    return {**dataset_info(item), "duplicates": duplicate_count}


@router.post("/dashboard/chart")
def analyze(req: ChartRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return build_chart(db, user, req)


@router.post("/dashboard/export")
def export(req: ChartRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_plus(user)
    item = owned_dataset(db, user, req.dataset_id)
    rows, schema = selected_rows(db, item, req)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(list(schema))
    for row in rows:
        # Prevent spreadsheet formula evaluation when downloaded data is opened in Excel.
        writer.writerow([("'" + str(row.get(key))) if isinstance(row.get(key), str) and row[key].lstrip().startswith(("=", "+", "-", "@")) else row.get(key) for key in schema])
    return Response(output.getvalue().encode("utf-8-sig"), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=analysis.csv"})


@router.put("/dashboard/layout")
def save_layout(req: LayoutRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_plus(user)
    clean = []
    seen = set()
    allowed = {item["key"] for item in user_charts(db, user)[0]} if user.role != "organization" else {"participation", "energy", "contribution", "department", "quality"}
    for widget in req.widgets:
        key = str(widget.get("key", ""))[:80]
        if not key or key in seen:
            raise HTTPException(400, "Every widget needs a unique key")
        seen.add(key)
        config = widget.get("config")
        if config:
            try:
                parsed = ChartRequest.model_validate(config)
            except ValidationError:
                raise HTTPException(422, "Invalid chart configuration")
            owned_dataset(db, user, parsed.dataset_id)
            config = parsed.model_dump(mode="json")
        elif key not in allowed:
            raise HTTPException(400, "Unknown dashboard module")
        clean.append({"key": key, "config": config, "wide": bool(widget.get("wide", False))})
    layout = db.get(DashboardLayout, user.id)
    if layout is None:
        layout = DashboardLayout(user_id=user.id, widgets=clean)
        db.add(layout)
    else:
        layout.widgets = clean
    db.commit()
    return {"widgets": clean}
