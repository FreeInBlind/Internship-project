import 'track_point.dart';

enum TransportMode { walking, cycling }

extension TransportModeLabel on TransportMode {
  String get apiValue => this == TransportMode.walking ? 'walking' : 'cycling';
  String get label => this == TransportMode.walking ? 'Walking' : 'Cycling';
  String get gpxName => this == TransportMode.walking ? 'EcoPoints walk' : 'EcoPoints cycle';
}

class TripSession {
  TripSession({
    required this.id,
    required this.mode,
    required this.createdAt,
    required this.segments,
    this.isActive = false,
    this.gpxPath,
    this.uploaded = false,
  });

  final String id;
  final TransportMode mode;
  final DateTime createdAt;
  final List<List<TrackPoint>> segments;
  bool isActive;
  String? gpxPath;
  bool uploaded;

  int get pointCount => segments.fold(0, (sum, segment) => sum + segment.length);

  DateTime? get startedAt => segments.isEmpty || segments.first.isEmpty ? null : segments.first.first.timestamp;
  DateTime? get endedAt => segments.isEmpty || segments.last.isEmpty ? null : segments.last.last.timestamp;

  Map<String, dynamic> toJson() => {
        'id': id,
        'mode': mode.apiValue,
        'created_at': createdAt.toUtc().toIso8601String(),
        'segments': segments.map((segment) => segment.map((point) => point.toJson()).toList()).toList(),
        'is_active': isActive,
        'gpx_path': gpxPath,
        'uploaded': uploaded,
      };

  factory TripSession.fromJson(Map<String, dynamic> json) {
    final mode = json['mode'] == 'cycling' ? TransportMode.cycling : TransportMode.walking;
    return TripSession(
      id: json['id'] as String,
      mode: mode,
      createdAt: DateTime.parse(json['created_at'] as String).toUtc(),
      segments: (json['segments'] as List<dynamic>)
          .map((segment) => (segment as List<dynamic>)
              .map((point) => TrackPoint.fromJson(Map<String, dynamic>.from(point as Map)))
              .toList())
          .toList(),
      isActive: json['is_active'] as bool? ?? false,
      gpxPath: json['gpx_path'] as String?,
      uploaded: json['uploaded'] as bool? ?? false,
    );
  }
}
