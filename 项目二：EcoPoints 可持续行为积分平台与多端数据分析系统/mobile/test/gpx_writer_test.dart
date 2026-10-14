import 'package:flutter_test/flutter_test.dart';

import 'package:ecopoints_mobile/models/track_point.dart';
import 'package:ecopoints_mobile/models/trip_session.dart';
import 'package:ecopoints_mobile/services/gpx_writer.dart';

void main() {
  test('writes namespaced GPX 1.1 track segments with UTC timestamps', () {
    final trip = TripSession(
      id: 'sample',
      mode: TransportMode.walking,
      createdAt: DateTime.utc(2026, 10, 13, 8),
      segments: [
        [
          TrackPoint(latitude: 3.139, longitude: 101.6869, timestamp: DateTime.utc(2026, 10, 13, 8)),
          TrackPoint(latitude: 3.1391, longitude: 101.687, timestamp: DateTime.utc(2026, 10, 13, 8, 0, 8)),
        ],
      ],
    );

    final xml = GpxWriter.build(trip);

    expect(xml, contains('xmlns="http://www.topografix.com/GPX/1/1"'));
    expect(xml, contains('<trkseg>'));
    expect(xml, contains('lat="3.1390000" lon="101.6869000"'));
    expect(xml, contains('<time>2026-10-13T08:00:00.000Z</time>'));
  });
}
