"""SQLAlchemy engine and session helpers. / SQLAlchemy 引擎和会话工具。"""
from collections.abc import Generator
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from .config import get_settings

class Base(DeclarativeBase):
    pass

settings = get_settings()
engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

def get_db() -> Generator[Session, None, None]:
    # One database session per request / 每个请求使用一个数据库会话
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
