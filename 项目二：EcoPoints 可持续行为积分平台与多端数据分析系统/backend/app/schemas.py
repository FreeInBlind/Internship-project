"""Pydantic request and response schemas. / Pydantic 请求和响应结构。"""
from datetime import date, datetime, time
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, ConfigDict, EmailStr, Field

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)

class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    campus: str | None = Field(default=None, max_length=120)
    department: str | None = Field(default=None, max_length=120)
    # Public registration can only create a user or organisation account.
    role: Literal["user", "organization"] = "user"

class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    full_name: str
    email: EmailStr
    role: str
    organization_id: int | None = None
    subscription_tier: Literal["basic", "plus"] = "basic"
    subscription_started_at: datetime | None = None
    subscription_expires_at: datetime | None = None
    campus: str | None = None
    department: str | None = None
    avatar_url: str | None = None
    phone: str | None = None
    is_active: bool = True
    created_at: datetime | None = None

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut

class ProfileUpdate(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=40)
    avatar_url: str | None = Field(default=None, max_length=4_000_000)

class SubscriptionUpgradeResponse(BaseModel):
    message: str
    status: str
    subscription_tier: Literal["basic", "plus"]
    expires_at: datetime | None = None

class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: str
    title: str
    message: str
    entity_type: str | None = None
    entity_id: int | None = None
    is_read: bool
    created_at: datetime

class OrganizationApplicationOut(BaseModel):
    id: int
    user_id: int
    applicant_name: str
    applicant_email: EmailStr
    organization_name: str
    registration_number: str | None = None
    document_name: str
    document_content_type: str
    status: str
    created_at: datetime

class SubscriptionRequestOut(BaseModel):
    id: int
    user_id: int
    applicant_name: str
    applicant_email: EmailStr
    requested_tier: str
    payment_reference: str | None = None
    status: str
    created_at: datetime
    reviewed_at: datetime | None = None

class ActivityRequestOut(BaseModel):
    id: int
    user_id: int
    applicant_name: str
    applicant_email: EmailStr
    title: str
    description: str
    status: str
    created_at: datetime

class OrganizationApplicationCreate(BaseModel):
    organization_name: str = Field(min_length=2, max_length=180)
    registration_number: str | None = Field(default=None, max_length=120)

class SubscriptionRequestCreate(BaseModel):
    payment_reference: str | None = Field(default=None, max_length=160)

class ActivityRequestCreate(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    description: str = Field(min_length=5, max_length=4000)

class AdminDecision(BaseModel):
    decision: Literal["approved", "rejected"]
    reason: str | None = Field(default=None, max_length=1000)

class AdminSubscriptionGrant(BaseModel):
    tier: Literal["basic", "plus"]

class AdminUserStatus(BaseModel):
    action: Literal["activate", "ban", "delete"]

class InitiativeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    description: str
    category: str
    points: int
    start_date: datetime | None = None
    end_date: datetime | None = None

class AdminInitiativeCreate(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    activity_date: date
    start_time: time
    end_time: time
    location: str = Field(min_length=2, max_length=160)
    description: str = Field(min_length=5, max_length=4000)

class AdminRewardCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    description: str = Field(min_length=5, max_length=4000)
    points_cost: int = Field(ge=1, le=100_000)
    stock: int = Field(ge=0, le=100_000)
    icon: Literal["gift", "coffee", "leaf", "book-open", "ticket"] = "gift"

class RedemptionCreate(BaseModel):
    contact_phone: str = Field(min_length=6, max_length=40, pattern=r"^[0-9+()\-\s]+$")
    contact_email: EmailStr

class RewardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    description: str
    points_cost: int
    stock: int
    icon: str

class HomeRewardProgress(BaseModel):
    name: str
    points_cost: int
    progress: int
    remaining: int
    percentage: int

class HomeLeaderboardEntry(BaseModel):
    rank: int
    name: str
    points: int
    is_current_user: bool = False

class HomeSummary(BaseModel):
    balance: int
    activities_this_week: int
    rewards_redeemed: int
    energy_rank: int | None
    initiatives: list[InitiativeOut]
    energy_usage_kwh: Decimal
    energy_change_percent: float | None
    next_reward: HomeRewardProgress | None = None
    organization_rank: int | None = None
    organization_points: int | None = None
    organization_leaderboard: list[HomeLeaderboardEntry] = Field(default_factory=list)

