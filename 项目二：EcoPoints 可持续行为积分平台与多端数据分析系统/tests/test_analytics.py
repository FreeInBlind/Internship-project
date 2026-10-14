"""Run with the project's Python: python -m unittest tests.test_analytics -v.

The in-memory SQLite database never touches the configured MySQL records.
"""
import asyncio
import json
import unittest
from datetime import datetime, timedelta
from datetime import date

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend.app.database import Base, get_db
from backend.app.main import app
from backend.app.models import User, Organization, OrganizationDataset, OrganizationDataRow, PointTransaction, Reward
from backend.app.analytics import ChartRequest, LayoutRequest, build_chart, parse_csv, summary, save_layout
from backend.app.security import create_access_token, hash_password


def fixture(db):
    password_hash = hash_password("TestAccount123!")
    users = [User(full_name=name, email=email, password_hash=password_hash, role=role, subscription_tier=tier) for name, email, role, tier in [
        ("Personal Basic", "basic@example.com", "user", "basic"), ("Personal Plus", "plus@example.com", "user", "plus"),
        ("Organization Plus", "org@example.com", "organization", "plus"), ("Other Organization", "other@example.com", "organization", "plus"),
        ("Organization Basic", "org-basic@example.com", "organization", "basic")]]
    db.add_all(users); db.flush()
    for user in users[2:]:
        org = Organization(name=user.full_name, slug="test-" + str(user.id), created_by=user.id)
        db.add(org); db.flush(); user.organization_id = org.id
    raw = b"date,building,department,category,participants,points_earned,energy_kwh\n" + b"".join(f"2026-10-{i:02d},Library,Science,Recycling,{i},{i*10},{i*100}\n".encode() for i in range(1,11))
    rows, columns, _ = parse_csv(raw)
    dataset = OrganizationDataset(organization_id=users[2].organization_id, uploaded_by=users[2].id, name="Validation source", source_filename="test.csv", columns=columns, row_count=len(rows))
    db.add(dataset); db.flush()
    db.add_all([OrganizationDataRow(dataset_id=dataset.id, row_number=i+1, data=row) for i,row in enumerate(rows)])
    db.add(PointTransaction(user_id=users[0].id, points=900, created_at=datetime.utcnow()))
    for i in range(5):
        db.add(PointTransaction(user_id=users[1].id, points=10*(i+1), created_at=datetime.utcnow()-timedelta(days=i)))
    db.add(Reward(name="Test reward", description="Test only", points_cost=300, stock=2, icon="gift"))
    db.add(User(full_name="Test Admin", email="admin@example.com", password_hash=password_hash, role="admin", subscription_tier="basic"))
    db.commit()
    return users, dataset


class AnalyticsTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.users, self.dataset = fixture(self.db)
        def override():
            with Session(self.engine) as session:
                yield session
        app.dependency_overrides[get_db] = override

    def tearDown(self):
        app.dependency_overrides.clear(); self.db.close(); self.engine.dispose()

    def request(self, method, path, user=None, body=None):
        async def run():
            payload = json.dumps(body).encode() if body is not None else b""
            headers = [(b"content-type", b"application/json")]
            if user:
                headers.append((b"authorization", ("Bearer " + create_access_token(user.id)).encode()))
            scope = {"type": "http", "http_version": "1.1", "method": method, "scheme": "http", "path": path, "raw_path": path.encode(), "query_string": b"", "root_path": "", "headers": headers, "client": ("127.0.0.1", 1234), "server": ("testserver", 80)}
            messages = []
            received = False
            async def receive():
                nonlocal received
                if not received:
                    received = True
                    return {"type": "http.request", "body": payload, "more_body": False}
                await asyncio.sleep(1)
                return {"type": "http.disconnect"}
            async def send(message):
                messages.append(message)
            await app(scope, receive, send)
            status = next(message["status"] for message in messages if message["type"] == "http.response.start")
            output = b"".join(message.get("body", b"") for message in messages if message["type"] == "http.response.body")
            return status, json.loads(output) if output else None
        return asyncio.run(run())

    def test_authentication_and_scope(self):
        self.assertEqual(self.request("GET", "/api/dashboard/summary")[0], 401)
        code, response = self.request("GET", "/api/dashboard/summary", self.users[0])
        self.assertEqual(code, 200)
        self.assertEqual(response["metrics"][0]["value"], 900)
        self.assertEqual(len(response["charts"]), 4)
        self.assertEqual(self.request("GET", "/api/dashboard/summary", self.users[1])[1]["metrics"][0]["value"], 150)
        req = {"dataset_id": self.dataset.id, "dimension": "date", "metric": "energy_kwh"}
        self.assertEqual(self.request("POST", "/api/dashboard/chart", self.users[3], req)[0], 404)
        self.assertEqual(self.request("POST", "/api/dashboard/chart", self.users[4], req)[0], 403)

    def test_upload_parser(self):
        rows, cols, duplicates = parse_csv(b"date,value,label\n2026-10-01,10,A\n2026-10-01,10,A\n2026-10-02,,B\n")
        self.assertEqual([col["type"] for col in cols], ["date", "number", "text"])
        self.assertEqual(cols[1]["missing"], 1)
        self.assertEqual(duplicates, 1)
        for raw in (b"a,a\n1,2\n", b"a,b\n1,2,3\n", b"a\n", b"\xff"):
            with self.assertRaises(HTTPException): parse_csv(raw)

    def test_analysis(self):
        req = ChartRequest(dataset_id=self.dataset.id, dimension="date", metric="energy_kwh")
        item = build_chart(self.db, self.users[2], req)
        self.assertEqual(sum(item["data"]["series"][0]["data"]), 5500)
        moving = build_chart(self.db, self.users[2], req.model_copy(update={"analysis": "moving-average"}))
        self.assertEqual(moving["data"]["series"][1]["data"][2], 200)
        future = build_chart(self.db, self.users[2], req.model_copy(update={"analysis": "forecast"}))
        self.assertEqual(future["data"]["series"][1]["data"][-3:], [1100, 1200, 1300])
        self.assertEqual(len(future["data"]["x"]), len(future["data"]["series"][1]["data"]))
        self.assertEqual(future["data"]["series"][1]["data"][9], 1000)
        for kind in ("bar", "area", "stacked", "donut", "treemap", "radar", "boxplot", "histogram"):
            self.assertEqual(build_chart(self.db, self.users[2], req.model_copy(update={"chart_type": kind}))["chart_type"], kind)
        scatter = build_chart(self.db, self.users[2], req.model_copy(update={"chart_type": "scatter", "second_metric": "participants"}))
        self.assertIn("1.000", scatter["data"]["notes"][0])
        heat = build_chart(self.db, self.users[2], req.model_copy(update={"chart_type": "heatmap", "split": "department"}))
        self.assertEqual(len(heat["data"]["cells"]), 10)

    def test_layout_and_expiry(self):
        self.assertEqual(self.request("PUT", "/api/dashboard/layout", self.users[0], {"widgets": []})[0], 403)
        self.assertEqual(self.request("PUT", "/api/dashboard/layout", self.users[1], {"widgets": []})[0], 200)
        self.assertEqual(self.request("GET", "/api/dashboard/summary", self.users[1])[1]["layout"], [])
        self.users[2].subscription_expires_at = datetime.utcnow()-timedelta(days=1); self.db.commit()
        code, data = self.request("GET", "/api/dashboard/summary", self.users[2])
        self.assertEqual(code, 200); self.assertEqual(data["tier"], "basic")

    def test_filters_comparison_and_invalid_inputs(self):
        req = ChartRequest(dataset_id=self.dataset.id, dimension="date", metric="energy_kwh", date_column="date", start=date(2026,10,6), end=date(2026,10,10), analysis="comparison", filters={"building": "Library", "department": "Science"})
        result = build_chart(self.db, self.users[2], req)
        self.assertEqual(result["data"]["series"][0]["data"], [1500, 4000])
        no_data = build_chart(self.db, self.users[2], req.model_copy(update={"analysis": "none", "filters": {"building": "Unknown"}}))
        self.assertTrue(no_data["data"]["empty"])
        for changes in ({"metric": "building"}, {"dimension": "not-a-column"}, {"analysis": "forecast", "start": date(2026,10,9)}):
            with self.assertRaises(HTTPException):
                build_chart(self.db, self.users[2], req.model_copy(update=changes))
        self.assertEqual(self.request("PUT", "/api/dashboard/layout", self.users[2], {"widgets": [{"key": "custom", "config": {"dataset_id": self.dataset.id}}]})[0], 422)


if __name__ == "__main__":
    unittest.main()
