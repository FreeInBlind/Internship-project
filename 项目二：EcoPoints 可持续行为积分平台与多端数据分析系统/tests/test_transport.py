"""Transport integration checks using isolated SQLite, never the project MySQL."""
import asyncio
import json
import unittest
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, func
import test_analytics
from backend.app.main import app
from backend.app.models import TransportTrip, PointTransaction, User
from backend.app.security import create_access_token
from backend.app.transport import TripCreate, evaluate, save_trip

def track(mode="walking", step=.001, start=None):
    start = start or datetime.now(timezone.utc).replace(microsecond=0) - timedelta(hours=2)
    return {"mode": mode, "segments": [[{"latitude": 0, "longitude": round(i * step, 7), "timestamp": (start + timedelta(minutes=i)).isoformat()} for i in range(7)]]}

def gpx(payload):
    body = ''.join('<trkseg>' + ''.join(f'<trkpt lat="{p["latitude"]}" lon="{p["longitude"]}"><time>{p["timestamp"]}</time></trkpt>' for p in segment) + '</trkseg>' for segment in payload['segments'])
    return f'<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk>{body}</trk></gpx>'.encode()

class TransportTest(unittest.TestCase):
    setUp = test_analytics.AnalyticsTest.setUp
    tearDown = test_analytics.AnalyticsTest.tearDown
    request = test_analytics.AnalyticsTest.request

    def upload(self, content, mode="walking", user=None, filename="walk.gpx"):
        user = user or self.users[0]
        boundary = 'ecopoints-transport-test'
        lines = [f'--{boundary}', 'Content-Disposition: form-data; name="mode"', '', mode,
                 f'--{boundary}', f'Content-Disposition: form-data; name="file"; filename="{filename}"',
                 'Content-Type: application/gpx+xml', '', content.decode('latin1'), f'--{boundary}--', '']
        payload = (chr(13) + chr(10)).join(lines).encode('latin1')
        async def run():
            messages = []
            received = False
            async def receive():
                nonlocal received
                if not received:
                    received = True
                    return {"type": "http.request", "body": payload, "more_body": False}
                await asyncio.sleep(.01)
                return {"type": "http.disconnect"}
            async def send(message): messages.append(message)
            scope = {"type": "http", "http_version": "1.1", "method": "POST", "scheme": "http", "path": "/api/transport-trips/import", "query_string": b"", "root_path": "", "headers": [(b'content-type', f'multipart/form-data; boundary={boundary}'.encode()), (b'authorization', ('Bearer ' + create_access_token(user.id)).encode())], "client": ("127.0.0.1", 1234), "server": ("testserver", 80)}
            await app(scope, receive, send)
            return next(m['status'] for m in messages if m['type'] == 'http.response.start'), json.loads(b''.join(m.get('body', b'') for m in messages if m['type'] == 'http.response.body'))
        return asyncio.run(run())

    def test_gpx_award_retry_and_mobile_equivalence(self):
        payload = track()
        code, result = self.upload(gpx(payload))
        self.assertEqual(code, 200)
        self.assertEqual(result['awarded_now'], 10)
        self.assertAlmostEqual(result['trip']['distance_m'], 667.17, places=1)
        self.assertEqual(result['trip']['duration_s'], 360)
        self.assertTrue(result['trip']['started_at'].endswith('Z'))
        altered = gpx(payload).replace(b'><', b'> <')
        result = self.upload(altered, filename='renamed.gpx')[1]
        self.assertTrue(result['duplicate']); self.assertEqual(result['awarded_now'], 0)
        result = self.request('POST', '/api/transport-trips', self.users[0], payload)[1]
        self.assertTrue(result['duplicate'])
        self.assertEqual(self.request('GET', '/api/home/summary', self.users[0])[1]['balance'], 910)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(TransportTrip)), 1)
        long_track = track('cycling', .002)
        self.assertEqual(self.request('POST', '/api/transport-trips', self.users[0], long_track)[1]['awarded_now'], 20)
        long_track['mode'] = 'walking'
        self.assertTrue(self.request('POST', '/api/transport-trips', self.users[0], long_track)[1]['duplicate'])

    def test_mobile_cycle_history_scope_and_chart_category(self):
        payload = track('cycling', .002)
        code, result = self.request('POST', '/api/transport-trips', self.users[1], payload)
        self.assertEqual(code, 200); self.assertEqual(result['awarded_now'], 20)
        self.assertEqual(result['trip']['source'], 'mobile')
        self.assertEqual(self.request('GET', '/api/transport-trips', self.users[0])[1]['items'], [])
        self.assertEqual(self.request('GET', '/api/transport-trips', self.users[1])[1]['total'], 1)
        charts = self.request('GET', '/api/dashboard/summary', self.users[1])[1]['charts']
        chart = next(c for c in charts if c['key'] == 'contribution')
        self.assertIn({'name': 'transport', 'value': 20}, chart['data']['categories'])
        admin = self.db.scalar(select(User).where(User.role == 'admin'))
        self.assertEqual(self.request('POST', '/api/transport-trips', admin, payload)[0], 403)
        self.assertEqual(self.request('GET', '/api/transport-trips')[0], 401)

    def test_non_qualifying_trip_never_awards(self):
        for payload in [track(step=.0001), track(step=.02)]:
            code, result = self.request('POST', '/api/transport-trips', self.users[0], payload)
            self.assertEqual(code, 200); self.assertEqual(result['trip']['status'], 'rejected')
            self.assertEqual(result['awarded_now'], 0)
        self.assertEqual(self.request('GET', '/api/home/summary', self.users[0])[1]['balance'], 900)

    def test_admin_rules_permissions_persistence_and_rewards(self):
        admin = self.db.scalar(select(User).where(User.role == 'admin'))
        modes = self.request('GET', '/api/transport-trips/rules')[1]['modes']
        path = '/api/transport-trips/admin/rules'
        self.assertEqual(self.request('GET', path, self.users[0])[0], 403)
        self.assertEqual(self.request('PUT', path, self.users[0], modes)[0], 403)
        modes['walking']['points'] = 35
        self.assertEqual(self.request('PUT', path, admin, modes)[0], 200)
        self.assertEqual(self.request('GET', path, admin)[1]['modes']['walking']['points'], 35)
        payload = track()
        self.assertEqual(self.upload(gpx(payload))[1]['awarded_now'], 35)
        modes['walking']['points'] = 80
        modes['cycling']['enabled'] = False
        self.assertEqual(self.request('PUT', path, admin, modes)[0], 200)
        duplicate = self.request('POST', '/api/transport-trips', self.users[0], payload)[1]
        self.assertEqual(duplicate['trip']['points_awarded'], 35)
        self.assertEqual(duplicate['awarded_now'], 0)
        result = self.request('POST', '/api/transport-trips', self.users[0], track('cycling', .002))[1]
        self.assertEqual(result['trip']['status'], 'rejected')
        self.assertIn('disabled', result['message'])
        modes['walking']['min_duration_s'] = 600
        self.assertEqual(self.request('PUT', path, admin, modes)[0], 200)
        result = self.request('POST', '/api/transport-trips', self.users[1], track())[1]
        self.assertIn('600 seconds', result['message'])
        modes['walking']['points'] = -1
        self.assertEqual(self.request('PUT', path, admin, modes)[0], 422)
        self.assertEqual(self.request('GET', path, admin)[1]['modes']['walking']['points'], 80)

    def test_retry_correct_mode_returns_successful_trip(self):
        payload = track('walking', .002)
        self.assertEqual(self.request('POST', '/api/transport-trips', self.users[0], payload)[1]['trip']['status'], 'rejected')
        payload['mode'] = 'cycling'
        result = self.request('POST', '/api/transport-trips', self.users[0], payload)[1]
        self.assertEqual(result['awarded_now'], 20)
        payload['mode'] = 'walking'
        repeated = self.request('POST', '/api/transport-trips', self.users[0], payload)[1]
        self.assertTrue(repeated['duplicate'])
        self.assertEqual(repeated['trip']['id'], result['trip']['id'])
        self.assertEqual(repeated['awarded_now'], 0)

    def test_invalid_tracks_and_xml(self):
        payload = track()
        for content in [b'bad xml', b'<gpx><trk><trkseg><trkpt lat="0" lon="0"/></trkseg></trk></gpx>', b'<!DOCTYPE gpx [<!ENTITY x "expanded">]><gpx>&x;</gpx>', '<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE gpx [<!ENTITY x "expanded">]><gpx>&x;</gpx>'.encode('utf-16')]:
            self.assertEqual(self.upload(content)[0], 422)
        self.assertEqual(self.upload(gpx(payload), filename='track.txt')[0], 422)
        self.assertEqual(self.upload(b' ' * (5 * 1024 * 1024 + 1))[0], 413)
        for change in ['time', 'coordinate', 'future', 'timezone', 'too_many']:
            p = track()
            if change == 'time': p['segments'][0][1]['timestamp'] = p['segments'][0][0]['timestamp']
            if change == 'coordinate': p['segments'][0][0]['latitude'] = 100
            if change == 'future': p = track(start=datetime.now(timezone.utc) + timedelta(days=1))
            if change == 'timezone': p['segments'][0][0]['timestamp'] = '2026-10-01T08:00:00'
            if change == 'too_many': p['segments'][0] *= 3000
            self.assertEqual(self.request('POST', '/api/transport-trips', self.users[0], p)[0], 422, change)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(TransportTrip)), 0)

    def test_segments_gaps_accuracy_and_transaction_rollback(self):
        p = track(); p['segments'] = [p['segments'][0][:3], p['segments'][0][3:]]
        values = evaluate(TripCreate(**p))
        self.assertAlmostEqual(values['distance_m'], 555.97, places=1)
        self.assertEqual(values['duration_s'], 300)
        p = track(); p['segments'][0][3]['accuracy_m'] = 100
        values = evaluate(TripCreate(**p))
        self.assertEqual(values['status'], 'rejected'); self.assertTrue(values['warnings'])
        p = track()
        for point in p['segments'][0][3:]:
            point['timestamp'] = (datetime.fromisoformat(point['timestamp']) + timedelta(minutes=10)).isoformat()
        self.assertEqual(evaluate(TripCreate(**p))['duration_s'], 300)
        from unittest.mock import patch
        with patch.object(self.db, 'commit', side_effect=RuntimeError('commit failed')):
            with self.assertRaises(RuntimeError): save_trip(TripCreate(**track()), self.users[0], self.db, 'mobile')
        self.db.rollback()
        self.assertEqual(self.db.scalar(select(func.count()).select_from(TransportTrip)), 0)
        self.assertEqual(self.db.scalar(select(func.sum(PointTransaction.points)).where(PointTransaction.user_id == self.users[0].id)), 900)

if __name__ == '__main__': unittest.main()
