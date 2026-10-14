"""Regression tests for admin controls, closed accounts and organization sessions."""
import unittest
from sqlalchemy import select
from backend.app.models import User, OrganizationApplication, SubscriptionRequest, Organization
import test_analytics


class AdminSessionTest(unittest.TestCase):
    setUp = test_analytics.AnalyticsTest.setUp
    tearDown = test_analytics.AnalyticsTest.tearDown
    request = test_analytics.AnalyticsTest.request

    def admin(self):
        return self.db.scalar(select(User).where(User.role == "admin"))

    def test_upgrade_downgrade_and_permissions(self):
        path = f"/api/admin/accounts/{self.users[0].id}/subscription"
        self.assertEqual(self.request("POST", path, self.users[0], {"tier": "plus"})[0], 403)
        self.assertEqual(self.request("POST", path, self.admin(), {"tier": "plus"})[0], 200)
        self.assertEqual(self.request("GET", "/api/me", self.users[0])[1]["subscription_tier"], "plus")
        self.assertEqual(self.request("POST", path, self.admin(), {"tier": "basic"})[0], 200)
        self.assertEqual(self.request("GET", "/api/me", self.users[0])[1]["subscription_tier"], "basic")

    def test_organization_review_and_dashboard(self):
        item = OrganizationApplication(user_id=self.users[0].id, organization_name="Approved Team", document_name="proof.pdf", document_content_type="application/pdf", document_data=b"test", status="pending")
        self.db.add(item); self.db.commit()
        queue = self.request("GET", "/api/admin/queue", self.admin())[1]
        self.assertEqual(len(queue["organizations"]), 1)
        self.assertEqual(self.request("POST", f"/api/admin/organization-applications/{item.id}/review", self.admin(), {"decision": "approved"})[0], 200)
        code, data = self.request("GET", "/api/dashboard/summary", self.users[0])
        self.assertEqual(code, 200); self.assertEqual(data["role"], "organization"); self.assertEqual(data["organization_name"], "Approved Team")
        self.assertEqual(len(data["charts"]), 4)

    def test_ban_login_reactivate_and_closed_queue(self):
        path = f"/api/admin/accounts/{self.users[0].id}/status"
        login = {"email": self.users[0].email, "password": "TestAccount123!"}
        self.assertEqual(self.request("POST", path, self.admin(), {"action": "ban"})[0], 200)
        self.assertEqual(self.request("POST", "/api/auth/login", body=login)[0], 403)
        self.assertEqual(self.request("GET", "/api/dashboard/summary", self.users[0])[0], 403)
        self.assertEqual(self.request("POST", path, self.admin(), {"action": "activate"})[0], 200)
        self.assertEqual(self.request("POST", "/api/auth/login", body=login)[0], 200)
        self.assertEqual(self.request("POST", path, self.admin(), {"action": "delete"})[0], 200)
        code, queue = self.request("GET", "/api/admin/queue", self.admin())
        self.assertEqual(code, 200)
        account = next(item for item in queue["accounts"] if item["id"] == self.users[0].id)
        self.assertTrue(account["is_closed"])
        self.assertEqual(self.request("POST", path, self.admin(), {"action": "activate"})[0], 404)

    def test_admin_has_no_home_or_dashboard(self):
        for path in ("/api/home/summary", "/api/dashboard/summary"):
            self.assertEqual(self.request("GET", path, self.admin())[0], 403)
        self.assertEqual(self.request("GET", "/api/admin/queue", self.admin())[0], 200)


if __name__ == "__main__":
    unittest.main()
