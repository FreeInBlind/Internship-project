"""Isolated browser-test API: no configured MySQL writes or sample production rows."""
import sys
import sqlite3
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from backend.app.database import Base, get_db
from backend.app.main import app
from backend.app.models import User, OrganizationApplication
from backend.app.security import create_access_token
from test_analytics import fixture

from sqlalchemy.pool import QueuePool
test_uri = "file:dashboard-test?mode=memory&cache=shared"
anchor = sqlite3.connect(test_uri, uri=True, check_same_thread=False)
engine = create_engine("sqlite://", creator=lambda: sqlite3.connect(test_uri, uri=True, check_same_thread=False), poolclass=QueuePool)
Base.metadata.create_all(engine)
with Session(engine) as db:
    users, _ = fixture(db)
    db.add(OrganizationApplication(user_id=users[0].id, organization_name="Browser Approved Team", document_name="proof.pdf", document_content_type="application/pdf", document_data=b"test", status="pending"))
    db.commit()

def override():
    with Session(engine) as db:
        yield db

app.dependency_overrides[get_db] = override
app.router.on_startup.clear()

@app.get("/test/session/{user_id}")
def session(user_id: int):
    with Session(engine) as db:
        user = db.get(User, user_id)
        return {"access_token": create_access_token(user.id), "user": {"id": user.id, "full_name": user.full_name, "email": user.email, "role": user.role, "subscription_tier": user.subscription_tier, "organization_id": user.organization_id}}

@app.get("/test/expired/{user_id}")
def expired(user_id: int):
    from datetime import datetime, timedelta, timezone
    from jose import jwt
    from backend.app.config import get_settings
    data = session(user_id)
    data["access_token"] = jwt.encode({"sub": str(user_id), "exp": datetime.now(timezone.utc) - timedelta(minutes=1)}, get_settings().secret_key, algorithm="HS256")
    return data

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8002)
