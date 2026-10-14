import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/trip_session.dart';

class ApiException implements Exception {
  const ApiException(this.message, {this.statusCode});
  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

class LoginResult {
  const LoginResult({required this.token, required this.userName, required this.role});
  final String token;
  final String userName;
  final String role;
}

class ApiClient {
  ApiClient(this.baseUrl);
  final String baseUrl;

  Uri _uri(String path) => Uri.parse('${baseUrl.replaceFirst(RegExp(r'/$'), '')}$path');

  Future<LoginResult> login(String email, String password) async {
    final response = await http.post(
      _uri('/api/auth/login'),
      headers: const {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email, 'password': password}),
    );
    final data = _decode(response);
    if (response.statusCode != 200) throw ApiException(_detail(data), statusCode: response.statusCode);
    final user = data['user'] as Map<String, dynamic>;
    return LoginResult(
      token: data['access_token'] as String,
      userName: user['full_name'] as String,
      role: user['role'] as String,
    );
  }

  Future<Map<String, dynamic>> fetchRules() async {
    final response = await http.get(_uri('/api/transport-trips/rules'));
    final data = _decode(response);
    if (response.statusCode != 200) throw ApiException(_detail(data), statusCode: response.statusCode);
    return data;
  }

  Future<Map<String, dynamic>> uploadTrip(TripSession trip, String token) async {
    final response = await http.post(
      _uri('/api/transport-trips'),
      headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer $token'},
      body: jsonEncode({
        'mode': trip.mode.apiValue,
        'segments': trip.segments.map((segment) => segment.map((point) => point.toJson()).toList()).toList(),
      }),
    );
    final data = _decode(response);
    if (response.statusCode != 200) throw ApiException(_detail(data), statusCode: response.statusCode);
    return data;
  }

  Future<List<Map<String, dynamic>>> fetchHistory(String token) async {
    final response = await http.get(
      _uri('/api/transport-trips?limit=20&offset=0'),
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _decode(response);
    if (response.statusCode != 200) throw ApiException(_detail(data), statusCode: response.statusCode);
    return (data['items'] as List<dynamic>).map((item) => Map<String, dynamic>.from(item as Map)).toList();
  }

  Map<String, dynamic> _decode(http.Response response) {
    try {
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    } on FormatException {
      throw const ApiException('The server returned an invalid response. Check the API address.');
    }
  }

  String _detail(Map<String, dynamic> data) {
    final detail = data['detail'];
    if (detail is String) return detail;
    if (detail is List) return 'The server rejected one or more fields.';
    return data['message'] as String? ?? 'The request could not be completed.';
  }
}
