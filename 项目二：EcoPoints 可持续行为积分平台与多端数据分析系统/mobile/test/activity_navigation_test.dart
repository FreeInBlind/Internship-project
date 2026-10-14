import 'dart:convert';

import 'package:ecopoints_mobile/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets(
      'restored unfinished journey can return to menu without signing out',
      (tester) async {
    SharedPreferences.setMockInitialValues({
      'access_token': 'test-token',
      'server_url': 'http://localhost:8001',
      'saved_trips_v1': jsonEncode([
        {
          'id': 'unfinished',
          'mode': 'walking',
          'created_at': '2026-10-13T08:00:00Z',
          'segments': [],
          'is_active': true,
        }
      ]),
    });
    final prefs = await SharedPreferences.getInstance();
    await tester.pumpWidget(MaterialApp(home: ActivityPage(prefs: prefs)));
    await tester.pumpAndSettle();
    expect(find.text('Continue journey'), findsOneWidget);
    await tester.tap(find.text('Continue journey'));
    await tester.pumpAndSettle();
    expect(find.text('Walking paused'), findsOneWidget);
    await tester.tap(find.text('Finish'));
    await tester.pumpAndSettle();
    expect(find.text('Resume'), findsOneWidget);
    await tester.tap(find.byTooltip('Back to menu'));
    await tester.pumpAndSettle();
    expect(find.text('Continue journey'), findsOneWidget);
    expect(prefs.getString('access_token'), 'test-token');
    await tester.tap(find.text('Discard unfinished journey'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Discard'));
    await tester.pumpAndSettle();
    expect(find.text('Continue journey'), findsNothing);
    expect(jsonDecode(prefs.getString('saved_trips_v1')!), isEmpty);
    expect(find.text('Record walking'), findsOneWidget);
  });
}
