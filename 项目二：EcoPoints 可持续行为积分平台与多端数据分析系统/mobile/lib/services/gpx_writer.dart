import '../models/track_point.dart';
import '../models/trip_session.dart';

class GpxWriter {
  static String build(TripSession trip) {
    final output = StringBuffer()
      ..writeln('<?xml version="1.0" encoding="UTF-8"?>')
      ..writeln('<gpx version="1.1" creator="EcoPoints Mobile" xmlns="http://www.topografix.com/GPX/1/1">')
      ..writeln('  <trk><name>${_escape(trip.mode.gpxName)}</name>');

    for (final segment in trip.segments.where((segment) => segment.isNotEmpty)) {
      output.writeln('    <trkseg>');
      for (final point in segment) {
        output.writeln(_pointXml(point));
      }
      output.writeln('    </trkseg>');
    }

    output
      ..writeln('  </trk>')
      ..writeln('</gpx>');
    return output.toString();
  }

  static String _pointXml(TrackPoint point) {
    final lat = point.latitude.toStringAsFixed(7);
    final lon = point.longitude.toStringAsFixed(7);
    final timestamp = point.timestamp.toUtc().toIso8601String();
    return '      <trkpt lat="$lat" lon="$lon"><time>$timestamp</time></trkpt>';
  }

  static String _escape(String value) => value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');
}
