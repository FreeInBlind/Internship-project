"""Database models. / 数据库模型。"""
from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Float, LargeBinary, JSON, String, Text, UniqueConstraint, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.mysql import LONGBLOB
from .database import Base

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # The three supported account types are: user, organization, and admin.
    role: Mapped[str] = mapped_column(String(40), default="user", nullable=False)
    organization_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), index=True)
    subscription_tier: Mapped[str] = mapped_column(String(20), default="basic", nullable=False)
    subscription_started_at: Mapped[datetime | None] = mapped_column(DateTime)
    subscription_expires_at: Mapped[datetime | None] = mapped_column(DateTime)
    campus: Mapped[str | None] = mapped_column(String(120))
    department: Mapped[str | None] = mapped_column(String(120))
    avatar_url: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(String(40))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    point_transactions: Mapped[list["PointTransaction"]] = relationship(back_populates="user")
    redemptions: Mapped[list["Redemption"]] = relationship(back_populates="user")
    notifications: Mapped[list["Notification"]] = relationship(back_populates="user")
    subscription_requests: Mapped[list["SubscriptionRequest"]] = relationship(back_populates="user", foreign_keys="SubscriptionRequest.user_id")
    organization_applications: Mapped[list["OrganizationApplication"]] = relationship(back_populates="user", foreign_keys="OrganizationApplication.user_id")
    activity_requests: Mapped[list["ActivityRequest"]] = relationship(back_populates="user", foreign_keys="ActivityRequest.user_id")

class Initiative(Base):
    __tablename__ = "initiatives"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(80), nullable=False)
    points: Mapped[int] = mapped_column(Integer, nullable=False)
    start_date: Mapped[datetime | None] = mapped_column(DateTime)
    end_date: Mapped[datetime | None] = mapped_column(DateTime)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    point_transactions: Mapped[list["PointTransaction"]] = relationship(back_populates="initiative")

class PointTransaction(Base):
    __tablename__ = "point_transactions"
    __table_args__ = (Index("ix_point_user_created", "user_id", "created_at"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    initiative_id: Mapped[int | None] = mapped_column(ForeignKey("initiatives.id"))
    points: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    user: Mapped[User] = relationship(back_populates="point_transactions")
    initiative: Mapped[Initiative | None] = relationship(back_populates="point_transactions")

class TransportRule(Base):
    __tablename__ = "transport_rules"
    mode: Mapped[str] = mapped_column(String(20), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    min_distance_m: Mapped[int] = mapped_column(Integer, nullable=False)
    min_duration_s: Mapped[int] = mapped_column(Integer, nullable=False)
    max_speed_kmh: Mapped[float] = mapped_column(Float, nullable=False)
    points: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime)

class TransportTrip(Base):
    __tablename__ = "transport_trips"
    __table_args__ = (
        UniqueConstraint("user_id", "track_hash", "mode", name="uq_transport_user_track_mode"),
        Index("ix_transport_user_created", "user_id", "created_at"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    mode: Mapped[str] = mapped_column(String(20), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    source_filename: Mapped[str | None] = mapped_column(String(255))
    file_hash: Mapped[str | None] = mapped_column(String(64))
    track_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    ended_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    distance_m: Mapped[float] = mapped_column(Float, nullable=False)
    duration_s: Mapped[float] = mapped_column(Float, nullable=False)
    point_count: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    validation_message: Mapped[str] = mapped_column(String(500), nullable=False)
    warnings: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    points_awarded: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    point_transaction_id: Mapped[int | None] = mapped_column(ForeignKey("point_transactions.id"), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

class Reward(Base):
    __tablename__ = "rewards"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    points_cost: Mapped[int] = mapped_column(Integer, nullable=False)
    stock: Mapped[int] = mapped_column(Integer, default=0)
    icon: Mapped[str] = mapped_column(String(40), default="gift", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    redemptions: Mapped[list["Redemption"]] = relationship(back_populates="reward")

class Redemption(Base):
    __tablename__ = "redemptions"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    reward_id: Mapped[int] = mapped_column(ForeignKey("rewards.id"), nullable=False)
    points_spent: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="requested")
    contact_phone: Mapped[str] = mapped_column(String(40), nullable=False)
    contact_email: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    user: Mapped[User] = relationship(back_populates="redemptions")
    reward: Mapped[Reward] = relationship(back_populates="redemptions")

class Organization(Base):
    __tablename__ = "organizations"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    slug: Mapped[str] = mapped_column(String(200), unique=True, index=True, nullable=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    members: Mapped[list["User"]] = relationship(foreign_keys="User.organization_id")
    datasets: Mapped[list["OrganizationDataset"]] = relationship(back_populates="organization", cascade="all, delete-orphan")

class OrganizationDataset(Base):
    __tablename__ = "organization_datasets"
    __table_args__ = (Index("ix_dataset_org_created", "organization_id", "created_at"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True, nullable=False)
    uploaded_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    source_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    columns: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    organization: Mapped[Organization] = relationship(back_populates="datasets")
    rows: Mapped[list["OrganizationDataRow"]] = relationship(back_populates="dataset", cascade="all, delete-orphan")

class OrganizationDataRow(Base):
    __tablename__ = "organization_data_rows"
    __table_args__ = (UniqueConstraint("dataset_id", "row_number", name="uq_dataset_row"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("organization_datasets.id"), index=True, nullable=False)
    row_number: Mapped[int] = mapped_column(Integer, nullable=False)
    data: Mapped[dict] = mapped_column(JSON, nullable=False)
    dataset: Mapped[OrganizationDataset] = relationship(back_populates="rows")

class DashboardLayout(Base):
    __tablename__ = "dashboard_layouts"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    widgets: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(60), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(60))
    entity_id: Mapped[int | None] = mapped_column(Integer)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    user: Mapped[User] = relationship(back_populates="notifications")

class SubscriptionRequest(Base):
    __tablename__ = "subscription_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    requested_tier: Mapped[str] = mapped_column(String(20), default="plus", nullable=False)
    payment_reference: Mapped[str | None] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(40), default="pending", nullable=False)
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    user: Mapped[User] = relationship(back_populates="subscription_requests", foreign_keys=[user_id])

class OrganizationApplication(Base):
    __tablename__ = "organization_applications"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    organization_name: Mapped[str] = mapped_column(String(180), nullable=False)
    registration_number: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(40), default="pending", nullable=False)
    document_name: Mapped[str] = mapped_column(String(255), nullable=False)
    document_content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    document_data: Mapped[bytes] = mapped_column(LargeBinary().with_variant(LONGBLOB(), "mysql"), nullable=False)
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    user: Mapped[User] = relationship(back_populates="organization_applications", foreign_keys=[user_id])

class ActivityRequest(Base):
    __tablename__ = "activity_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="pending", nullable=False)
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    user: Mapped[User] = relationship(back_populates="activity_requests", foreign_keys=[user_id])
