"""EcoPoints FastAPI app for local course demonstration.
用于课程演示的 EcoPoints FastAPI 应用。
"""
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote
from fastapi import File, Form, UploadFile
from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import desc, func, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .config import get_settings
from .database import Base, engine, get_db
from .dependencies import get_current_user
from .models import ActivityRequest, Initiative, Notification, Organization, OrganizationApplication, PointTransaction, Redemption, Reward, SubscriptionRequest, User
from .schemas import ActivityRequestCreate, ActivityRequestOut, AdminDecision, AdminInitiativeCreate, AdminRewardCreate, AdminSubscriptionGrant, AdminUserStatus, HomeLeaderboardEntry, HomeRewardProgress, HomeSummary, InitiativeOut, LoginRequest, NotificationOut, OrganizationApplicationCreate, OrganizationApplicationOut, ProfileUpdate, RedemptionCreate, RegisterRequest, RewardOut, SubscriptionRequestCreate, SubscriptionRequestOut, SubscriptionUpgradeResponse, TokenResponse, UserOut
from .security import create_access_token, hash_password, verify_password
from .transport import router as transport_router

settings = get_settings()
app = FastAPI(title="EcoPoints API", version="0.1.0")
app.include_router(transport_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

@app.on_event("startup")
def create_tables() -> None:
    # Convenient for a local demo; production would use migrations.
    # 方便本地演示；生产项目应使用迁移工具。
    Base.metadata.create_all(bind=engine)
    # Bring pre-role-classification demo records onto the supported role set.
    with engine.begin() as connection:
        connection.execute(text("UPDATE users SET role = 'user' WHERE role NOT IN ('user', 'organization', 'admin')"))
        connection.execute(text("UPDATE users SET role = 'admin' WHERE email = 'sarah.tan@example.edu'"))
        # The project uses MySQL. Existing installations from before account
        # classification had a VARCHAR role column, so upgrade it in place.
        if engine.dialect.name == "mysql":
            role_column = next(column for column in inspect(engine).get_columns("users") if column["name"] == "role")
            if "enum" not in str(role_column["type"]).lower():
                connection.execute(text("ALTER TABLE users MODIFY COLUMN role ENUM('user', 'organization', 'admin') NOT NULL DEFAULT 'user'"))
            user_columns = {column["name"] for column in inspect(engine).get_columns("users")}
            if "organization_id" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN organization_id INT NULL"))
                connection.execute(text("CREATE INDEX ix_users_organization_id ON users (organization_id)"))
            if "subscription_tier" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN subscription_tier VARCHAR(20) NOT NULL DEFAULT 'basic'"))
            reward_columns = {column["name"] for column in inspect(engine).get_columns("rewards")}
            if "icon" not in reward_columns:
                connection.execute(text("ALTER TABLE rewards ADD COLUMN icon VARCHAR(40) NOT NULL DEFAULT 'gift'"))
            redemption_columns = {column["name"] for column in inspect(engine).get_columns("redemptions")}
            if "contact_phone" not in redemption_columns:
                connection.execute(text("ALTER TABLE redemptions ADD COLUMN contact_phone VARCHAR(40) NOT NULL DEFAULT ''"))
            if "contact_email" not in redemption_columns:
                connection.execute(text("ALTER TABLE redemptions ADD COLUMN contact_email VARCHAR(255) NOT NULL DEFAULT ''"))
            user_columns = {column["name"] for column in inspect(engine).get_columns("users")}
            for column_name, definition in (("subscription_started_at", "DATETIME NULL"), ("subscription_expires_at", "DATETIME NULL")):
                if column_name not in user_columns:
                    connection.execute(text(f"ALTER TABLE users ADD COLUMN {column_name} {definition}"))
            if "phone" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN phone VARCHAR(40) NULL"))
            if "avatar_url" in user_columns:
                connection.execute(text("ALTER TABLE users MODIFY COLUMN avatar_url LONGTEXT NULL"))
    if engine.dialect.name != "mysql":
        with engine.begin() as connection:
            columns = {column["name"] for column in inspect(engine).get_columns("users")}
            if "phone" not in columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN phone VARCHAR(40)"))
            if "organization_id" not in columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN organization_id INTEGER"))
    # create_all does not add indexes to pre-existing tables.
    with engine.begin() as connection:
        for table, index_name, fields in (
            ("users", "ix_users_organization_id", ["organization_id"]),
            ("point_transactions", "ix_point_user_created", ["user_id", "created_at"]),
            ("organization_datasets", "ix_dataset_org_created", ["organization_id", "created_at"]),
        ):
            indexes = inspect(connection).get_indexes(table)
            if not any(index["column_names"][:len(fields)] == fields for index in indexes):
                connection.execute(text(f"CREATE INDEX {index_name} ON {table} ({', '.join(fields)})"))
    # Existing organization accounts receive a stable data boundary once.
    from .database import SessionLocal
    with SessionLocal() as db:
        for user in db.scalars(select(User).where(User.role == "organization", User.organization_id.is_(None))).all():
            application = db.scalar(select(OrganizationApplication).where(OrganizationApplication.user_id == user.id, OrganizationApplication.status == "approved").order_by(OrganizationApplication.id.desc()))
            slug = "account-" + str(user.id)
            organization = db.scalar(select(Organization).where(Organization.slug == slug))
            if organization is None:
                organization = Organization(name=application.organization_name if application else user.full_name, slug=slug, created_by=user.id)
                db.add(organization)
                db.flush()
            user.organization_id = organization.id
        db.commit()

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "ecopoints-api"}

@app.post("/api/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email or password is incorrect")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is suspended or closed. Contact an administrator.")
    if user.subscription_tier == "plus" and user.subscription_expires_at and user.subscription_expires_at <= datetime.utcnow():
        user.subscription_tier = "basic"
        user.subscription_started_at = None
        user.subscription_expires_at = None
        db.commit()
    return TokenResponse(access_token=create_access_token(user.id), user=UserOut.model_validate(user))

@app.post("/api/auth/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
    # Create a local demo account; email verification is outside this classroom project.
    # 创建本地演示账号；邮箱验证不属于本课程项目范围。
    email = payload.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This email is already registered")
    user = User(
        full_name=payload.full_name.strip(), email=email, password_hash=hash_password(payload.password),
        campus=payload.campus, department=payload.department, role=payload.role, subscription_tier="basic",
    )
    db.add(user)
    try:
        db.flush()
        if payload.role == "organization":
            slug = "org-" + email.split("@")[0].replace(".", "-") + "-" + str(user.id)
            organization = Organization(name=payload.full_name.strip() + " Organization", slug=slug, created_by=user.id)
            db.add(organization)
            db.flush()
            user.organization_id = organization.id
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This email is already registered")
    return TokenResponse(access_token=create_access_token(user.id), user=UserOut.model_validate(user))

@app.get("/api/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    if current_user.subscription_tier == "plus" and current_user.subscription_expires_at and current_user.subscription_expires_at <= datetime.utcnow():
        current_user.subscription_tier = "basic"
        current_user.subscription_started_at = None
        current_user.subscription_expires_at = None
        db.commit()
    return current_user

@app.put("/api/me", response_model=UserOut)
def update_profile(payload: ProfileUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    email = str(payload.email).lower()
    duplicate = db.scalar(select(User).where(User.email == email, User.id != current_user.id))
    if duplicate:
        raise HTTPException(status_code=409, detail="This email is already registered")
    if payload.avatar_url and not (payload.avatar_url.startswith("data:image/") or payload.avatar_url.startswith("https://") or payload.avatar_url.startswith("http://")):
        raise HTTPException(status_code=400, detail="Avatar image format is not supported")
    current_user.full_name = payload.full_name.strip()
    current_user.email = email
    current_user.phone = payload.phone.strip() if payload.phone else None
    if payload.avatar_url is not None:
        current_user.avatar_url = payload.avatar_url
    db.commit()
    db.refresh(current_user)
    return current_user

@app.post("/api/subscription/upgrade", response_model=SubscriptionUpgradeResponse)
def upgrade_subscription(payload: SubscriptionRequestCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> SubscriptionUpgradeResponse:
    """Create a payment review request; only an administrator can grant Plus."""
    if current_user.role == "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator accounts do not use subscriptions")
    if current_user.subscription_tier == "plus" and current_user.subscription_expires_at and current_user.subscription_expires_at > datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This account is already on Plus")
    existing = db.scalar(select(SubscriptionRequest).where(SubscriptionRequest.user_id == current_user.id, SubscriptionRequest.status == "pending"))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A Plus payment request is already pending review")
    request = SubscriptionRequest(user_id=current_user.id, payment_reference=payload.payment_reference, status="pending")
    db.add(request)
    db.flush()
    db.add(Notification(user_id=current_user.id, kind="plus_upgrade", title="Plus payment submitted", message="Your Plus payment is waiting for administrator verification.", entity_type="subscription_request", entity_id=request.id))
    db.commit()
    return SubscriptionUpgradeResponse(message="Your payment request is waiting for administrator verification", status="pending", subscription_tier=current_user.subscription_tier, expires_at=current_user.subscription_expires_at)

@app.get("/api/notifications", response_model=list[NotificationOut])
def list_notifications(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[Notification]:
    return list(db.scalars(select(Notification).where(Notification.user_id == current_user.id).order_by(Notification.created_at.desc()).limit(50)).all())

@app.post("/api/notifications/{notification_id}/read")
def read_notification(notification_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    notification = db.scalar(select(Notification).where(Notification.id == notification_id, Notification.user_id == current_user.id))
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    notification.is_read = True
    db.commit()
    return {"message": "Notification marked as read"}

@app.post("/api/organization/apply", response_model=OrganizationApplicationOut, status_code=201)
async def apply_organization(organization_name: str = Form(...), registration_number: str | None = Form(None), document: UploadFile = File(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> OrganizationApplicationOut:
    if current_user.role != "user":
        raise HTTPException(status_code=403, detail="Only user accounts can apply for an organization account")
    allowed = {"application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
    suffix = Path(document.filename or "").suffix.lower()
    if not (document.content_type in allowed or document.content_type and document.content_type.startswith("image/")) or suffix not in {".pdf", ".docx", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff"}:
        raise HTTPException(status_code=415, detail="Upload a PDF, DOCX, or image file")
    data = await document.read()
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="The document must be 15 MB or smaller")
    pending = db.scalar(select(OrganizationApplication).where(OrganizationApplication.user_id == current_user.id, OrganizationApplication.status == "pending"))
    if pending:
        raise HTTPException(status_code=409, detail="An organization application is already pending")
    application = OrganizationApplication(user_id=current_user.id, organization_name=organization_name.strip(), registration_number=registration_number, document_name=document.filename or "document", document_content_type=document.content_type or "application/octet-stream", document_data=data)
    db.add(application)
    db.flush()
    db.add(Notification(user_id=current_user.id, kind="organization_application", title="Organization application submitted", message="Your organization account application is waiting for administrator review.", entity_type="organization_application", entity_id=application.id))
    db.commit()
    db.refresh(application)
    return OrganizationApplicationOut(id=application.id, user_id=current_user.id, applicant_name=current_user.full_name, applicant_email=current_user.email, organization_name=application.organization_name, registration_number=application.registration_number, document_name=application.document_name, document_content_type=application.document_content_type, status=application.status, created_at=application.created_at)

@app.post("/api/activity-requests", response_model=ActivityRequestOut, status_code=201)
def request_activity(payload: ActivityRequestCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ActivityRequestOut:
    if current_user.role == "admin":
        raise HTTPException(status_code=403, detail="Administrator accounts publish activities directly")
    request = ActivityRequest(user_id=current_user.id, title=payload.title.strip(), description=payload.description.strip())
    db.add(request)
    db.flush()
    db.add(Notification(user_id=current_user.id, kind="activity_creation", title="Activity request submitted", message="Your activity request is waiting for administrator review.", entity_type="activity_request", entity_id=request.id))
    db.commit()
    db.refresh(request)
    return ActivityRequestOut(id=request.id, user_id=current_user.id, applicant_name=current_user.full_name, applicant_email=current_user.email, title=request.title, description=request.description, status=request.status, created_at=request.created_at)

def require_admin(current_user: User) -> None:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Administrator access is required")

def notify(db: Session, user_id: int, kind: str, title: str, message: str, entity_type: str | None = None, entity_id: int | None = None) -> None:
    db.add(Notification(user_id=user_id, kind=kind, title=title, message=message, entity_type=entity_type, entity_id=entity_id))

@app.get("/api/admin/queue")
def admin_queue(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    require_admin(current_user)
    subscriptions = db.execute(select(SubscriptionRequest, User).join(User, User.id == SubscriptionRequest.user_id).where(SubscriptionRequest.status == "pending").order_by(SubscriptionRequest.created_at.desc())).all()
    organizations = db.execute(select(OrganizationApplication, User).join(User, User.id == OrganizationApplication.user_id).where(OrganizationApplication.status == "pending").order_by(OrganizationApplication.created_at.desc())).all()
    activities = db.execute(select(ActivityRequest, User).join(User, User.id == ActivityRequest.user_id).where(ActivityRequest.status == "pending").order_by(ActivityRequest.created_at.desc())).all()
    redemptions = db.execute(select(Redemption, User, Reward).join(User, User.id == Redemption.user_id).join(Reward, Reward.id == Redemption.reward_id).where(Redemption.status == "requested").order_by(Redemption.created_at.desc())).all()
    accounts = list(db.scalars(select(User).order_by(User.created_at.desc()).limit(100)).all())
    return {
        "subscriptions": [{"id": item.id, "user_id": user.id, "applicant_name": user.full_name, "applicant_email": user.email, "requested_tier": item.requested_tier, "payment_reference": item.payment_reference, "status": item.status, "created_at": item.created_at} for item, user in subscriptions],
        "organizations": [{"id": item.id, "user_id": user.id, "applicant_name": user.full_name, "applicant_email": user.email, "organization_name": item.organization_name, "registration_number": item.registration_number, "document_name": item.document_name, "document_content_type": item.document_content_type, "status": item.status, "created_at": item.created_at} for item, user in organizations],
        "activities": [{"id": item.id, "user_id": user.id, "applicant_name": user.full_name, "applicant_email": user.email, "title": item.title, "description": item.description, "status": item.status, "created_at": item.created_at} for item, user in activities],
        "redemptions": [{"id": item.id, "user_id": user.id, "applicant_name": user.full_name, "applicant_email": user.email, "reward_name": reward.name, "points_spent": item.points_spent, "contact_phone": item.contact_phone, "contact_email": item.contact_email, "status": item.status, "created_at": item.created_at} for item, user, reward in redemptions],
        # Administrative tombstones are deliberately not login email addresses.
        # Serializing one must not make the entire account management queue fail.
        "accounts": [{"id": user.id, "full_name": user.full_name, "email": user.email, "role": user.role, "subscription_tier": user.subscription_tier, "is_active": user.is_active, "is_closed": user.email == f"closed-{user.id}@invalid.local"} for user in accounts],
    }

@app.get("/api/admin/organization-applications/{application_id}/document")
def download_organization_document(application_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from fastapi.responses import Response
    require_admin(current_user)
    application = db.get(OrganizationApplication, application_id)
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    safe_name = quote(application.document_name)
    return Response(content=application.document_data, media_type=application.document_content_type, headers={"Content-Disposition": f"attachment; filename*=UTF-8''{safe_name}"})

@app.post("/api/admin/subscription-requests/{request_id}/review")
def review_subscription(request_id: int, payload: AdminDecision, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    require_admin(current_user)
    request = db.get(SubscriptionRequest, request_id)
    if not request or request.status != "pending":
        raise HTTPException(status_code=404, detail="Pending subscription request not found")
    request.status = payload.decision
    request.reviewed_by = current_user.id
    request.reviewed_at = datetime.utcnow()
    user = db.get(User, request.user_id)
    if payload.decision == "approved":
        started = datetime.utcnow()
        user.subscription_tier = "plus"
        user.subscription_started_at = started
        user.subscription_expires_at = started + timedelta(days=30)
        notify(db, user.id, "plus_upgrade", "Plus is active", "Your Plus subscription was approved and is active for 30 days.", "subscription_request", request.id)
    else:
        notify(db, user.id, "plus_upgrade", "Plus payment needs attention", payload.reason or "Your Plus payment request was not approved.", "subscription_request", request.id)
    db.commit()
    return {"message": f"Subscription request {payload.decision}", "subscription_tier": user.subscription_tier, "expires_at": user.subscription_expires_at}

@app.post("/api/admin/organization-applications/{application_id}/review")
def review_organization(application_id: int, payload: AdminDecision, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    require_admin(current_user)
    application = db.get(OrganizationApplication, application_id)
    if not application or application.status != "pending":
        raise HTTPException(status_code=404, detail="Pending organization application not found")
    application.status = payload.decision
    application.reviewed_by = current_user.id
    application.reviewed_at = datetime.utcnow()
    user = db.get(User, application.user_id)
    if payload.decision == "approved":
        user.role = "organization"
        organization = Organization(
            name=application.organization_name,
            slug="org-application-" + str(application.id),
            created_by=user.id,
        )
        db.add(organization)
        db.flush()
        user.organization_id = organization.id
        notify(db, user.id, "organization_application", "Organization account approved", "Your account is now an organization account.", "organization_application", application.id)
    else:
        notify(db, user.id, "organization_application", "Organization application declined", payload.reason or "Your organization application was not approved.", "organization_application", application.id)
    db.commit()
    return {"message": f"Organization application {payload.decision}", "role": user.role}

@app.post("/api/admin/activity-requests/{request_id}/review")
def review_activity(request_id: int, payload: AdminDecision, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    require_admin(current_user)
    request = db.get(ActivityRequest, request_id)
    if not request or request.status != "pending":
        raise HTTPException(status_code=404, detail="Pending activity request not found")
    request.status = payload.decision
    request.reviewed_by = current_user.id
    request.reviewed_at = datetime.utcnow()
    if payload.decision == "approved":
        initiative = Initiative(title=request.title, description=request.description, category="community", points=0, is_active=True)
        db.add(initiative)
        db.flush()
        notify(db, request.user_id, "activity_creation", "Activity approved", "Your activity is now available to the community.", "activity_request", request.id)
    else:
        notify(db, request.user_id, "activity_creation", "Activity request declined", payload.reason or "Your activity request was not approved.", "activity_request", request.id)
    db.commit()
    return {"message": f"Activity request {payload.decision}"}

@app.post("/api/admin/redemptions/{redemption_id}/review")
def review_redemption(redemption_id: int, payload: AdminDecision, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    require_admin(current_user)
    redemption = db.get(Redemption, redemption_id)
    if not redemption or redemption.status != "requested":
        raise HTTPException(status_code=404, detail="Pending redemption not found")
    reward = db.get(Reward, redemption.reward_id)
    redemption.status = "fulfilled" if payload.decision == "approved" else "rejected"
    if payload.decision == "rejected" and reward:
        reward.stock += 1
    notify(db, redemption.user_id, "reward_redemption", "Reward redemption updated", f"Your redemption for {reward.name if reward else 'the reward'} was {redemption.status}.", "redemption", redemption.id)
    db.commit()
    return {"message": f"Redemption {redemption.status}", "status": redemption.status}

@app.post("/api/admin/accounts/{user_id}/subscription")
def grant_subscription(user_id: int, payload: AdminSubscriptionGrant, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    require_admin(current_user)
    user = db.get(User, user_id)
    if not user or user.role == "admin" or user.email == f"closed-{user_id}@invalid.local":
        raise HTTPException(status_code=404, detail="Account not found")
    user.subscription_tier = payload.tier
    user.subscription_started_at = datetime.utcnow() if payload.tier == "plus" else None
    user.subscription_expires_at = datetime.utcnow() + timedelta(days=30) if payload.tier == "plus" else None
    notify(db, user.id, "plus_upgrade", f"Plan changed to {payload.tier.title()}", f"An administrator changed your plan to {payload.tier.title()}.", "user", user.id)
    db.commit()
    return {"message": "Account plan updated", "subscription_tier": user.subscription_tier, "expires_at": user.subscription_expires_at}

@app.post("/api/admin/accounts/{user_id}/status")
def update_account_status(user_id: int, payload: AdminUserStatus, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    require_admin(current_user)
    user = db.get(User, user_id)
    if not user or user.role == "admin" or user.email == f"closed-{user_id}@invalid.local":
        raise HTTPException(status_code=404, detail="Account not found")
    if payload.action == "delete":
        user.is_active = False
        user.full_name = f"Closed account {user.id}"
        user.email = f"closed-{user.id}@invalid.local"
        user.password_hash = hash_password(f"closed-{user.id}-{datetime.utcnow().isoformat()}")
        user.avatar_url = None
        user.phone = None
        user.campus = None
        user.department = None
        user.subscription_tier = "basic"
        user.subscription_started_at = None
        user.subscription_expires_at = None
        notify(db, user.id, "account_status", "Account closed", "Your account was closed by an administrator and personal profile data was redacted.", "user", user.id)
        db.commit()
        return {"message": "Account closed and personal profile data redacted", "is_active": False}
    elif payload.action == "ban":
        user.is_active = False
        message = "Your account has been suspended by an administrator."
    else:
        user.is_active = True
        message = "Your account has been reactivated."
    notify(db, user.id, "account_status", "Account status updated", message, "user", user.id)
    db.commit()
    return {"message": "Account status updated", "is_active": user.is_active}

@app.get("/api/initiatives", response_model=list[InitiativeOut])
def list_initiatives(db: Session = Depends(get_db)) -> list[Initiative]:
    return list(db.scalars(select(Initiative).where(Initiative.is_active.is_(True)).order_by(Initiative.start_date)).all())

@app.post("/api/admin/initiatives", response_model=InitiativeOut, status_code=status.HTTP_201_CREATED)
def create_admin_volunteering_initiative(
    payload: AdminInitiativeCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Initiative:
    """Administrators may publish volunteering initiatives without an EcoPoints threshold."""
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access is required")
    if payload.end_time <= payload.start_time:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="End time must be after start time")

    initiative = Initiative(
        title=payload.title.strip(),
        description=f"{payload.description.strip()}\n\nLocation: {payload.location.strip()}",
        category="volunteering",
        points=0,
        start_date=datetime.combine(payload.activity_date, payload.start_time),
        end_date=datetime.combine(payload.activity_date, payload.end_time),
        is_active=True,
    )
    db.add(initiative)
    db.commit()
    db.refresh(initiative)
    return initiative

@app.get("/api/rewards", response_model=list[RewardOut])
def list_rewards(db: Session = Depends(get_db)) -> list[Reward]:
    return list(db.scalars(select(Reward).where(Reward.is_active.is_(True)).order_by(Reward.points_cost)).all())

@app.post("/api/admin/rewards", response_model=RewardOut, status_code=status.HTTP_201_CREATED)
def create_admin_reward(
    payload: AdminRewardCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Reward:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access is required")
    reward = Reward(
        name=payload.name.strip(),
        description=payload.description.strip(),
        points_cost=payload.points_cost,
        stock=payload.stock,
        icon=payload.icon,
        is_active=True,
    )
    db.add(reward)
    db.commit()
    db.refresh(reward)
    return reward

@app.post("/api/rewards/{reward_id}/redeem")
def redeem_reward(reward_id: int, payload: RedemptionCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    # Redeem one reward atomically enough for this local classroom demo.
    # 本地课堂演示中，兑换流程在一次数据库事务中完成。
    if current_user.role == "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator accounts cannot redeem rewards")
    reward = db.get(Reward, reward_id)
    if not reward or not reward.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reward not found")
    if reward.stock <= 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This reward is out of stock")
    balance = int(db.scalar(select(func.coalesce(func.sum(PointTransaction.points), 0)).where(PointTransaction.user_id == current_user.id)) or 0)
    spent = int(db.scalar(select(func.coalesce(func.sum(Redemption.points_spent), 0)).where(Redemption.user_id == current_user.id)) or 0)
    available = balance - spent
    if available < reward.points_cost:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You do not have enough EcoPoints")
    db.add(Redemption(user_id=current_user.id, reward_id=reward.id, points_spent=reward.points_cost, status="requested", contact_phone=payload.contact_phone.strip(), contact_email=str(payload.contact_email).lower()))
    reward.stock -= 1
    db.add(Notification(user_id=current_user.id, kind="reward_redemption", title="Reward redemption submitted", message=f"Your redemption for {reward.name} was submitted successfully.", entity_type="reward", entity_id=reward.id))
    db.commit()
    return {"message": "Reward redeemed successfully", "reward": reward.name, "remaining_points": available - reward.points_cost, "stock": reward.stock}

@app.get("/api/home/summary", response_model=HomeSummary)
def home_summary(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> HomeSummary:
    if current_user.role == "admin":
        raise HTTPException(status_code=403, detail="Administrator accounts use the Admin page")
    earned = db.scalar(select(func.coalesce(func.sum(PointTransaction.points), 0)).where(PointTransaction.user_id == current_user.id)) or 0
    spent = db.scalar(select(func.coalesce(func.sum(Redemption.points_spent), 0)).where(Redemption.user_id == current_user.id)) or 0
    balance = max(int(earned) - int(spent), 0)
    week_start = datetime.utcnow() - timedelta(days=7)
    activities = db.scalar(select(func.count(PointTransaction.id)).where(PointTransaction.user_id == current_user.id, PointTransaction.created_at >= week_start)) or 0
    redeemed = db.scalar(select(func.count(Redemption.id)).where(Redemption.user_id == current_user.id)) or 0
    initiatives = list(db.scalars(select(Initiative).where(Initiative.is_active.is_(True)).order_by(Initiative.start_date).limit(3)).all())
    next_reward = db.scalar(select(Reward).where(Reward.is_active.is_(True), Reward.stock > 0, Reward.points_cost > balance).order_by(Reward.points_cost))
    progress = None
    if next_reward:
        progress = HomeRewardProgress(
            name=next_reward.name,
            points_cost=int(next_reward.points_cost),
            progress=min(balance, int(next_reward.points_cost)),
            remaining=max(int(next_reward.points_cost) - balance, 0),
            percentage=min(100, round((balance / next_reward.points_cost) * 100)) if next_reward.points_cost else 100,
        )
    leaderboard = []
    organization_rank = None
    organization_points = None
    if current_user.role == "organization" and current_user.organization_id:
        rows = db.execute(
            select(Organization.id, Organization.name, func.coalesce(func.sum(PointTransaction.points), 0).label("points"))
            .outerjoin(User, User.organization_id == Organization.id)
            .outerjoin(PointTransaction, PointTransaction.user_id == User.id)
            .group_by(Organization.id, Organization.name)
            .order_by(desc("points"), Organization.name)
        ).all()
        for index, row in enumerate(rows, start=1):
            if row.id == current_user.organization_id:
                organization_rank = index
                organization_points = int(row.points or 0)
            if index <= 5:
                leaderboard.append(HomeLeaderboardEntry(rank=index, name=row.name, points=int(row.points or 0), is_current_user=row.id == current_user.organization_id))
    return HomeSummary(
        balance=balance,
        activities_this_week=int(activities),
        rewards_redeemed=int(redeemed),
        energy_rank=None,
        initiatives=initiatives,
        energy_usage_kwh=0,
        energy_change_percent=None,
        next_reward=progress,
        organization_rank=organization_rank,
        organization_points=organization_points,
        organization_leaderboard=leaderboard,
    )

from .analytics import router as analytics_router
app.include_router(analytics_router)
