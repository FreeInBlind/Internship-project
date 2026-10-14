class TrackPoint {
  const TrackPoint({
    required this.latitude,
    required this.longitude,
    required this.timestamp,
    this.accuracyMeters,
  });

  final double latitude;
  final double longitude;
  final DateTime timestamp;
  final double? accuracyMeters;

  Map<String, dynamic> toJson() => {
        'latitude': latitude,
        'longitude': longitude,
        'timestamp': timestamp.toUtc().toIso8601String(),
        if (accuracyMeters != null) 'accuracy_m': accuracyMeters,
      };

  factory TrackPoint.fromJson(Map<String, dynamic> json) => TrackPoint(
        latitude: (json['latitude'] as num).toDouble(),
        longitude: (json['longitude'] as num).toDouble(),
        timestamp: DateTime.parse(json['timestamp'] as String).toUtc(),
        accuracyMeters: (json['accuracy_m'] as num?)?.toDouble(),
      );
}
