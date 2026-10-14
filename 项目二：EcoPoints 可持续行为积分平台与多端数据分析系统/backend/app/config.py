"""Application settings loaded from environment variables.
应用配置：从环境变量加载，避免把数据库账号密码写进代码。
"""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # MySQL connection string / MySQL 连接字符串
    database_url: str
    # Local demo JWT key / 本地演示用 JWT 密钥
    secret_key: str
    access_token_expire_minutes: int = 120
    cors_origins: str = "http://localhost:5501,http://127.0.0.1:5501"
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

@lru_cache
def get_settings() -> Settings:
    return Settings()
