import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:share_plus/share_plus.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'models/track_point.dart';
import 'models/trip_session.dart';
import 'services/api_client.dart';
import 'services/trip_store.dart';

const moss = Color(0xff476c51);
const sage = Color(0xffa7f3d0);
const ink = Color(0xff173526);
const muted = Color(0xff5f7065);
const line = Color(0xffd8e6dc);
const porcelain = Color(0xfffffefa);

void main() => runApp(const EcoPointsApp());

class EcoPointsApp extends StatelessWidget {
  const EcoPointsApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'EcoPoints',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: moss),
          scaffoldBackgroundColor: const Color(0xfff5f8f5),
          useMaterial3: true,
          appBarTheme: const AppBarTheme(
              backgroundColor: porcelain,
              foregroundColor: ink,
              surfaceTintColor: porcelain),
          inputDecorationTheme: const InputDecorationTheme(
              border: OutlineInputBorder(
                  borderRadius: BorderRadius.all(Radius.circular(8)))),
        ),
        home: const BootstrapPage(),
      );
}

class BootstrapPage extends StatefulWidget {
  const BootstrapPage({super.key});

  @override
  State<BootstrapPage> createState() => _BootstrapPageState();
}

class _BootstrapPageState extends State<BootstrapPage> {
  final _preferences = SharedPreferences.getInstance();

  @override
  Widget build(BuildContext context) => FutureBuilder<SharedPreferences>(
        future: _preferences,
        builder: (context, snapshot) {
          if (!snapshot.hasData)
            return const Scaffold(
                body: Center(child: CircularProgressIndicator()));
          final prefs = snapshot.data!;
          return prefs.getString('access_token') == null
              ? LoginPage(prefs: prefs)
              : ActivityPage(prefs: prefs);
        },
      );
}

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, required this.prefs});
  final SharedPreferences prefs;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  late final TextEditingController server;
  final email = TextEditingController();
  final password = TextEditingController();
  bool busy = false;
  String? error;
  final credentials = const FlutterSecureStorage();
  bool rememberLogin = false;
  bool credentialsLoading = true;

  @override
  void initState() {
    super.initState();
    server = TextEditingController(
        text: widget.prefs.getString('server_url') ?? 'http://10.0.2.2:8001');
    restoreCredentials();
  }

  Future<void> restoreCredentials() async {
    try {
      final saved = await credentials.read(key: 'login_password');
      if (!mounted) return;
      email.text = widget.prefs.getString('login_email') ?? '';
      password.text = saved ?? '';
      rememberLogin = saved != null;
    } catch (_) {
      if (mounted) email.text = widget.prefs.getString('login_email') ?? '';
    } finally {
      if (mounted) setState(() => credentialsLoading = false);
    }
  }

  @override
  void dispose() {
    server.dispose();
    email.dispose();
    password.dispose();
    super.dispose();
  }

  Future<void> login() async {
    if (busy || credentialsLoading) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final baseUrl = server.text.trim().replaceFirst(RegExp(r'/$'), '');
      final parsed = Uri.tryParse(baseUrl);
      if (parsed == null || !parsed.hasScheme)
        throw const ApiException(
            'Enter a full API address, such as http://192.168.1.20:8001.');
      final result =
          await ApiClient(baseUrl).login(email.text.trim(), password.text);
      if (result.role == 'admin')
        throw const ApiException(
            'Administrator accounts cannot log transport journeys.');
      await widget.prefs.setString('login_email', email.text.trim());
      try {
        if (rememberLogin) {
          await credentials.write(key: 'login_password', value: password.text);
        } else {
          await credentials.delete(key: 'login_password');
        }
      } catch (_) {
        throw const ApiException(
            'Could not save login preferences. Try again with Remember login unchecked.');
      }
      await widget.prefs.setString('server_url', baseUrl);
      await widget.prefs.setString('access_token', result.token);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => ActivityPage(prefs: widget.prefs)));
    } on ApiException catch (exception) {
      if (mounted) setState(() => error = exception.message);
    } on Object {
      if (mounted)
        setState(() => error =
            'Could not reach the API. Check the address, Wi-Fi and server.');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
            child: Center(
                child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Panel(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                    const Icon(Icons.eco_outlined, color: moss, size: 42),
                    const SizedBox(height: 18),
                    Text('EcoPoints Activity',
                        style: Theme.of(context)
                            .textTheme
                            .headlineMedium
                            ?.copyWith(
                                color: ink, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 8),
                    const Text(
                        'Sign in with your existing EcoPoints account to record a walk or cycle.',
                        style: TextStyle(color: muted, height: 1.5)),
                    const SizedBox(height: 24),
                    TextField(
                        controller: server,
                        keyboardType: TextInputType.url,
                        decoration: const InputDecoration(
                            labelText: 'API address',
                            hintText: 'http://192.168.1.20:8001')),
                    const SizedBox(height: 14),
                    TextField(
                        controller: email,
                        enabled: !credentialsLoading && !busy,
                        autofillHints: const [AutofillHints.username],
                        keyboardType: TextInputType.emailAddress,
                        decoration: const InputDecoration(labelText: 'Email')),
                    const SizedBox(height: 14),
                    TextField(
                        controller: password,
                        enabled: !credentialsLoading && !busy,
                        autofillHints: const [AutofillHints.password],
                        obscureText: true,
                        onSubmitted: (_) => login(),
                        decoration:
                            const InputDecoration(labelText: 'Password')),
                    CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Remember login'),
                        subtitle: const Text(
                            'Save the password securely on this phone.'),
                        value: rememberLogin,
                        onChanged: busy || credentialsLoading
                            ? null
                            : (value) async {
                                setState(() => rememberLogin = value ?? false);
                                if (!rememberLogin) {
                                  try {
                                    await credentials.delete(
                                        key: 'login_password');
                                  } catch (_) {
                                    if (mounted)
                                      setState(() => error =
                                          'Could not remove the saved password. Please try again.');
                                  }
                                }
                              }),
                    if (error != null)
                      Padding(
                          padding: const EdgeInsets.only(top: 14),
                          child: Text(error!,
                              style: const TextStyle(
                                  color: Color(0xffb42318), height: 1.4))),
                    const SizedBox(height: 22),
                    SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                            onPressed:
                                busy || credentialsLoading ? null : login,
                            child: Padding(
                                padding:
                                    const EdgeInsets.symmetric(vertical: 12),
                                child: Text(busy
                                    ? 'Signing in...'
                                    : rememberLogin
                                        ? 'Quick sign in'
                                        : 'Sign in')))),
                    const SizedBox(height: 12),
                    const Text(
                        "USB with adb reverse: http://127.0.0.1:8001. Wi-Fi: use the computer's IPv4 address.",
                        style:
                            TextStyle(color: muted, fontSize: 12, height: 1.4)),
                  ]))),
        ))),
      );
}

class ActivityPage extends StatefulWidget {
  const ActivityPage({super.key, required this.prefs});
  final SharedPreferences prefs;

  @override
  State<ActivityPage> createState() => _ActivityPageState();
}

class _ActivityPageState extends State<ActivityPage>
    with WidgetsBindingObserver {
  final store = TripStore();
  List<TripSession> trips = [];
  StreamSubscription<Position>? stream;
  Map<String, dynamic>? rules;
  bool loading = true;
  bool busy = false;
  String? notice;
  bool noticeError = false;
  bool showRecording = false;

  String get token => widget.prefs.getString('access_token')!;
  ApiClient get api => ApiClient(widget.prefs.getString('server_url')!);
  TripSession? get active {
    for (final trip in trips) {
      if (trip.isActive) return trip;
    }
    return null;
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    stream?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) stopStream();
  }

  Future<void> load() async {
    if (stream != null || busy) return;
    try {
      final values = await Future.wait([store.loadTrips(), api.fetchRules()]);
      trips = values[0] as List<TripSession>;
      rules = values[1] as Map<String, dynamic>;
    } on Object {
      trips = await store.loadTrips();
      notice =
          'Could not load current point rules. Recording still works offline.';
      noticeError = true;
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> persist() => store.saveTrips(trips);

  void tell(String text, bool isError) {
    if (mounted)
      setState(() {
        notice = text;
        noticeError = isError;
      });
  }

  Future<bool> permission() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      await locationSettingsDialog(false);
      return false;
    }
    var value = await Geolocator.checkPermission();
    if (value == LocationPermission.denied)
      value = await Geolocator.requestPermission();
    if (value == LocationPermission.deniedForever) {
      await locationSettingsDialog(true);
      return false;
    }
    if (value == LocationPermission.denied) {
      tell(
          'Location permission is required. Tap Record or Resume to try again.',
          true);
      return false;
    }
    return true;
  }

  Future<void> locationSettingsDialog(bool appSettings) async {
    if (!mounted) return;
    final open = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
              title:
                  Text(appSettings ? 'Allow location access' : 'Turn on GPS'),
              content: const Text(
                  'Enable location, then return and tap Record or Resume.'),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context, false),
                    child: const Text('Cancel')),
                TextButton(
                    onPressed: () => Navigator.pop(context, true),
                    child: const Text('Open settings'))
              ],
            ));
    if (open == true) {
      if (appSettings) {
        await Geolocator.openAppSettings();
      } else {
        await Geolocator.openLocationSettings();
      }
    }
    tell(
        'Return here and tap Record or Resume after enabling location.', false);
  }

  Future<void> backToMenu() async {
    await stopStream();
    if (mounted) setState(() => showRecording = false);
  }

  Future<void> discardRecording() async {
    final trip = active;
    if (trip == null) return;
    final discard = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
              title: const Text('Discard unfinished journey?'),
              content: const Text(
                  'The GPS points in this unfinished journey will be deleted. Completed journeys will be kept.'),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context, false),
                    child: const Text('Keep journey')),
                TextButton(
                    onPressed: () => Navigator.pop(context, true),
                    child: const Text('Discard'))
              ],
            ));
    if (discard != true) return;
    await stopStream();
    trips.remove(trip);
    await persist();
    if (mounted) setState(() => showRecording = false);
  }

  Future<void> start(TransportMode mode) async {
    if (busy) return;
    if (active != null) {
      setState(() => showRecording = true);
      tell(
          'Resume or finish the unfinished journey, or discard it before starting a new one.',
          false);
      return;
    }
    setState(() => busy = true);
    try {
      if (!await permission() || !mounted) return;
      final now = DateTime.now().toUtc();
      trips.insert(
          0,
          TripSession(
              id: now.microsecondsSinceEpoch.toString(),
              mode: mode,
              createdAt: now,
              segments: [[]],
              isActive: true));
      await persist();
      showRecording = true;
      await startStream();
      tell(
          mode.label +
              ' recording started. Keep this screen open while recording.',
          false);
    } catch (_) {
      tell(
          'Could not start GPS. Check location settings and try Resume.', true);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> startStream() async {
    await stream?.cancel();
    const settings =
        LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 0);
    stream = Geolocator.getPositionStream(locationSettings: settings)
        .listen(acceptPosition, onError: (_) {
      tell('GPS signal was lost. Resume recording after location is available.',
          true);
      stopStream();
    });
  }

  void acceptPosition(Position position) {
    final trip = active;
    if (trip == null) return;
    final at = position.timestamp.toUtc();
    if (trip.segments.isEmpty) trip.segments.add([]);
    final segment = trip.segments.last;
    if (segment.isNotEmpty &&
        at.difference(segment.last.timestamp).inSeconds < 8) return;
    segment.add(TrackPoint(
        latitude: position.latitude,
        longitude: position.longitude,
        timestamp: at,
        accuracyMeters: position.accuracy));
    persist();
    if (mounted) setState(() {});
  }

  Future<void> stopStream() async {
    final previousStream = stream;
    stream = null;
    await previousStream?.cancel();
    final trip = active;
    if (trip != null &&
        trip.segments.isNotEmpty &&
        trip.segments.last.isNotEmpty) {
      trip.segments.add([]);
      await persist();
    }
    if (mounted) setState(() {});
  }

  Future<void> pauseResume() async {
    final trip = active;
    if (trip == null || busy) return;
    setState(() => busy = true);
    try {
      if (stream == null) {
        if (!await permission()) return;
        if (trip.segments.isEmpty || trip.segments.last.isNotEmpty)
          trip.segments.add([]);
        await persist();
        await startStream();
        tell('Recording resumed.', false);
      } else {
        await stopStream();
        tell('Recording paused. Resuming creates a new track segment.', false);
      }
    } catch (_) {
      tell(
          'Could not resume GPS. Check location settings and try again.', true);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> finish() async {
    final trip = active;
    if (trip == null) return;
    await stopStream();
    if (!trip.segments.any((segment) => segment.length >= 2)) {
      tell(
          'At least two GPS points in one segment are required. Tap Resume to continue, or return to the menu to discard this journey.',
          true);
      return;
    }
    final discarded = trip.segments
        .where((item) => item.isNotEmpty && item.length < 2)
        .length;
    trip.segments.removeWhere((item) => item.length < 2);
    setState(() => busy = true);
    try {
      trip.gpxPath = await store.writeGpx(trip);
      trip.isActive = false;
      await persist();
      showRecording = false;
      tell(
          discarded == 0
              ? 'GPX file saved. Upload it now or later from Saved journeys.'
              : 'GPX file saved. ' +
                  discarded.toString() +
                  ' short segment(s) were omitted because the server requires at least two points per segment.',
          false);
    } on Object {
      tell('Could not save the GPX file.', true);
    }
    if (mounted) setState(() => busy = false);
  }

  Future<void> upload(TripSession trip) async {
    setState(() => busy = true);
    try {
      final result = await api.uploadTrip(trip, token);
      trip.uploaded = true;
      await persist();
      final text = result['duplicate'] == true
          ? 'This journey was already submitted. No additional points were awarded.'
          : 'Journey uploaded. This submission earned ' +
              result['awarded_now'].toString() +
              ' EcoPoints.';
      tell(text, false);
    } on ApiException catch (exception) {
      if (exception.statusCode == 401) {
        await signOut('Your sign-in expired. Please sign in again.');
      } else {
        tell(exception.message, true);
      }
    } on Object {
      tell('Could not upload the journey. It remains saved on this phone.',
          true);
    }
    if (mounted) setState(() => busy = false);
  }

  Future<void> exportGpx(TripSession trip) async {
    setState(() => busy = true);
    try {
      trip.gpxPath ??= await store.writeGpx(trip);
      if (!await File(trip.gpxPath!).exists())
        trip.gpxPath = await store.writeGpx(trip);
      await persist();
      await Share.shareXFiles([XFile(trip.gpxPath!)],
          subject: 'EcoPoints ' + trip.mode.label + ' track');
    } on Object {
      tell('Could not export the GPX file.', true);
    }
    if (mounted) setState(() => busy = false);
  }

  Future<void> signOut([String? message]) async {
    await stopStream();
    await persist();
    await widget.prefs.remove('access_token');
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => LoginPage(prefs: widget.prefs)));
    if (message != null)
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));
  }

  String rule(TransportMode mode) {
    final modes = rules?['modes'] as Map<String, dynamic>?;
    final item = modes?[mode.apiValue] as Map<String, dynamic>?;
    if (item == null) return 'Rules will be checked when you upload.';
    if (item['enabled'] != true) return 'Point awards are currently paused.';
    final distance = (item['min_distance_m'] as num).toDouble() / 1000;
    final minutes = (item['min_duration_s'] as num).toDouble() / 60;
    return 'At least ' +
        distance.toStringAsFixed(distance % 1 == 0 ? 0 : 1) +
        ' km and ' +
        minutes.toStringAsFixed(0) +
        ' min. +' +
        item['points'].toString() +
        ' pts.';
  }

  @override
  Widget build(BuildContext context) {
    if (loading)
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    final recording = showRecording ? active : null;
    final saved = trips.where((trip) => !trip.isActive).toList();
    return PopScope(
        canPop: !showRecording,
        onPopInvokedWithResult: (didPop, result) {
          if (!didPop && showRecording && !busy) backToMenu();
        },
        child: Scaffold(
            appBar: AppBar(
                leading: showRecording
                    ? IconButton(
                        tooltip: 'Back to menu',
                        onPressed: busy ? null : backToMenu,
                        icon: const Icon(Icons.arrow_back))
                    : null,
                title: const Text('EcoPoints Activity',
                    style: TextStyle(fontWeight: FontWeight.w700)),
                actions: [
                  IconButton(
                      tooltip: 'Sign out',
                      onPressed: busy ? null : () => signOut(),
                      icon: const Icon(Icons.logout))
                ]),
            body: SafeArea(
                child: RefreshIndicator(
                    onRefresh: load,
                    child: ListView(
                        padding: const EdgeInsets.fromLTRB(16, 20, 16, 32),
                        children: [
                          Text('Log your sustainable transport',
                              style: Theme.of(context)
                                  .textTheme
                                  .headlineSmall
                                  ?.copyWith(
                                      color: ink, fontWeight: FontWeight.w700)),
                          const SizedBox(height: 6),
                          const Text(
                              'GPS points stay on this device until you choose to upload a completed journey.',
                              style: TextStyle(color: muted, height: 1.5)),
                          const SizedBox(height: 18),
                          if (notice != null)
                            Notice(text: notice!, isError: noticeError),
                          if (!showRecording && active != null)
                            Panel(
                                child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                  Text(
                                      'Unfinished ' +
                                          active!.mode.label.toLowerCase() +
                                          ' journey',
                                      style: const TextStyle(
                                          fontWeight: FontWeight.w700)),
                                  const Text(
                                      'Your GPS points are saved. Resume recording or discard this journey to start another.'),
                                  TextButton(
                                      onPressed: busy
                                          ? null
                                          : () => setState(
                                              () => showRecording = true),
                                      child: const Text('Continue journey')),
                                  TextButton(
                                      onPressed: busy ? null : discardRecording,
                                      child: const Text(
                                          'Discard unfinished journey')),
                                ])),
                          if (recording == null) ...[
                            ModeCard(
                                mode: TransportMode.walking,
                                icon: Icons.directions_walk_outlined,
                                detail: rule(TransportMode.walking),
                                busy: busy,
                                onStart: () => start(TransportMode.walking)),
                            const SizedBox(height: 12),
                            ModeCard(
                                mode: TransportMode.cycling,
                                icon: Icons.pedal_bike_outlined,
                                detail: rule(TransportMode.cycling),
                                busy: busy,
                                onStart: () => start(TransportMode.cycling))
                          ] else
                            RecordingCard(
                                trip: recording,
                                paused: stream == null,
                                busy: busy,
                                onPause: pauseResume,
                                onFinish: finish),
                          const SizedBox(height: 26),
                          Text('Saved journeys',
                              style: Theme.of(context)
                                  .textTheme
                                  .titleLarge
                                  ?.copyWith(
                                      color: ink, fontWeight: FontWeight.w700)),
                          const SizedBox(height: 10),
                          if (saved.isEmpty)
                            const Panel(
                                child: Text('No completed journeys saved yet.',
                                    style: TextStyle(color: muted)))
                          else
                            ...saved.map((trip) => Padding(
                                padding: const EdgeInsets.only(bottom: 10),
                                child: TripCard(
                                    trip: trip,
                                    busy: busy,
                                    onUpload: () => upload(trip),
                                    onExport: () => exportGpx(trip)))),
                        ])))));
  }
}

class Panel extends StatelessWidget {
  const Panel({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
          color: porcelain,
          border: Border.all(color: line),
          borderRadius: BorderRadius.circular(8),
          boxShadow: const [
            BoxShadow(
                color: Color(0x0b385642), blurRadius: 18, offset: Offset(0, 7))
          ]),
      child: child);
}

class Notice extends StatelessWidget {
  const Notice({super.key, required this.text, required this.isError});
  final String text;
  final bool isError;
  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
              color:
                  isError ? const Color(0xffffe9e7) : const Color(0xffe8f5ec),
              borderRadius: BorderRadius.circular(7)),
          child: Text(text,
              style: TextStyle(
                  color: isError ? const Color(0xff9d271e) : ink,
                  height: 1.4))));
}

class ModeCard extends StatelessWidget {
  const ModeCard(
      {super.key,
      required this.mode,
      required this.icon,
      required this.detail,
      required this.busy,
      required this.onStart});
  final TransportMode mode;
  final IconData icon;
  final String detail;
  final bool busy;
  final VoidCallback onStart;
  @override
  Widget build(BuildContext context) => Panel(
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(
            width: 68,
            height: 68,
            decoration: BoxDecoration(
                color: sage, borderRadius: BorderRadius.circular(8)),
            child: Icon(icon, color: ink, size: 34)),
        const SizedBox(width: 14),
        Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(mode.label,
              style: const TextStyle(
                  color: ink, fontWeight: FontWeight.w700, fontSize: 17)),
          const SizedBox(height: 5),
          Text(detail, style: const TextStyle(color: muted, height: 1.4)),
          const SizedBox(height: 12),
          FilledButton.icon(
              onPressed: busy ? null : onStart,
              icon: Icon(icon, size: 18),
              label: Text('Record ' + mode.label.toLowerCase()))
        ]))
      ]));
}

class RecordingCard extends StatelessWidget {
  const RecordingCard(
      {super.key,
      required this.trip,
      required this.paused,
      required this.busy,
      required this.onPause,
      required this.onFinish});
  final TripSession trip;
  final bool paused;
  final bool busy;
  final VoidCallback onPause;
  final VoidCallback onFinish;
  @override
  Widget build(BuildContext context) => Panel(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(paused ? Icons.pause_circle_outline : Icons.gps_fixed,
              color: moss),
          const SizedBox(width: 8),
          Text(trip.mode.label + (paused ? ' paused' : ' recording'),
              style: const TextStyle(
                  color: ink, fontSize: 18, fontWeight: FontWeight.w700))
        ]),
        const SizedBox(height: 8),
        Text(
            trip.pointCount.toString() +
                ' GPS points • ' +
                trip.segments
                    .where((item) => item.isNotEmpty)
                    .length
                    .toString() +
                ' segment(s)',
            style: const TextStyle(color: muted)),
        const SizedBox(height: 17),
        Row(children: [
          Expanded(
              child: OutlinedButton.icon(
                  onPressed: busy ? null : onPause,
                  icon: Icon(paused ? Icons.play_arrow : Icons.pause),
                  label: Text(paused ? 'Resume' : 'Pause'))),
          const SizedBox(width: 10),
          Expanded(
              child: FilledButton.icon(
                  onPressed: busy ? null : onFinish,
                  icon: const Icon(Icons.stop),
                  label: const Text('Finish')))
        ])
      ]));
}

class TripCard extends StatelessWidget {
  const TripCard(
      {super.key,
      required this.trip,
      required this.busy,
      required this.onUpload,
      required this.onExport});
  final TripSession trip;
  final bool busy;
  final VoidCallback onUpload;
  final VoidCallback onExport;
  @override
  Widget build(BuildContext context) {
    final at = trip.startedAt?.toLocal();
    final date = at == null
        ? 'No GPS points'
        : at.year.toString() +
            '-' +
            at.month.toString().padLeft(2, '0') +
            '-' +
            at.day.toString().padLeft(2, '0') +
            ' ' +
            at.hour.toString().padLeft(2, '0') +
            ':' +
            at.minute.toString().padLeft(2, '0');
    return Panel(
        child: Row(children: [
      Container(
          width: 42,
          height: 42,
          decoration: BoxDecoration(
              color: sage, borderRadius: BorderRadius.circular(8)),
          child: Icon(
              trip.mode == TransportMode.walking
                  ? Icons.directions_walk_outlined
                  : Icons.pedal_bike_outlined,
              color: ink)),
      const SizedBox(width: 12),
      Expanded(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(trip.mode.label,
            style: const TextStyle(color: ink, fontWeight: FontWeight.w700)),
        const SizedBox(height: 2),
        Text(date + ' • ' + trip.pointCount.toString() + ' points',
            style: const TextStyle(color: muted, fontSize: 12))
      ])),
      IconButton(
          tooltip: 'Export GPX',
          onPressed: busy ? null : onExport,
          icon: const Icon(Icons.ios_share_outlined, color: moss)),
      if (trip.uploaded)
        const Chip(label: Text('Uploaded'))
      else
        IconButton(
            tooltip: 'Upload journey',
            onPressed: busy ? null : onUpload,
            icon: const Icon(Icons.cloud_upload_outlined, color: moss))
    ]));
  }
}
