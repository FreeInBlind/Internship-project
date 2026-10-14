import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/trip_session.dart';
import 'gpx_writer.dart';

class TripStore {
  static const _tripsKey = 'saved_trips_v1';

  Future<List<TripSession>> loadTrips() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_tripsKey);
    if (raw == null) return [];
    final values = jsonDecode(raw) as List<dynamic>;
    return values.map((item) => TripSession.fromJson(Map<String, dynamic>.from(item as Map))).toList();
  }

  Future<void> saveTrips(List<TripSession> trips) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tripsKey, jsonEncode(trips.map((trip) => trip.toJson()).toList()));
  }

  Future<String> writeGpx(TripSession trip) async {
    final documents = await getApplicationDocumentsDirectory();
    final tracks = Directory('${documents.path}${Platform.pathSeparator}tracks');
    await tracks.create(recursive: true);
    final file = File('${tracks.path}${Platform.pathSeparator}${trip.mode.apiValue}-${trip.id}.gpx');
    await file.writeAsString(GpxWriter.build(trip), flush: true);
    return file.path;
  }
}
