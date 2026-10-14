"""Shared FastAPI dependencies. / FastAPI 共用依赖项。"""
from typing import Annotated
from datetime import datetime
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from .database import get_db
from .models import User
from .security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    # Validate the token before reading protected data.
    # 读取受保护数据前先校验令牌。
    user_id = decode_access_token(token)
    user = db.get(User, user_id) if user_id else None
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Your session has expired. Sign in again.")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is suspended or closed. Contact an administrator.")
    if user.subscription_tier == "plus" and user.subscription_expires_at and user.subscription_expires_at <= datetime.utcnow():
        user.subscription_tier = "basic"
        user.subscription_started_at = None
        user.subscription_expires_at = None
        db.commit()
    return user
