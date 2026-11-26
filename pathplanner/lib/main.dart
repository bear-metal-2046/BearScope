import 'dart:async';
import 'dart:io';

import 'package:file/file.dart';
import 'package:file/local.dart';
import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_colorpicker/flutter_colorpicker.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:pathplanner/services/log.dart';
import 'package:pathplanner/services/pplib_telemetry.dart';
import 'package:pathplanner/services/update_checker.dart';
import 'package:pathplanner/util/prefs.dart';
import 'package:pathplanner/widgets/error_popup.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:undo/undo.dart';
import 'package:window_manager/window_manager.dart';
import 'package:pathplanner/pages/home_page.dart';

void main() async {
  final zone = Zone.current.fork(
    specification: ZoneSpecification(handleUncaughtError: (Zone self,
        ZoneDelegate parent,
        Zone zone,
        Object error,
        StackTrace stackTrace) async {
      zone.run(() async {
        Log.error('Uncaught Error', error, stackTrace);

        await windowManager.hide();

        WindowOptions windowOptions = const WindowOptions(
          size: Size(400, 280),
          minimumSize: Size(400, 280),
          maximumSize: Size(400, 280),
          center: true,
          title: 'PathPlanner Error',
          titleBarStyle: TitleBarStyle.normal,
        );

        windowManager.waitUntilReadyToShow(windowOptions, () async {
          await windowManager.setSize(const Size(400, 280));
          await windowManager.show();
          await windowManager.focus();
        });

        SharedPreferences prefs = await SharedPreferences.getInstance();

        runApp(ErrorPopup(
          prefs: prefs,
          error: error,
          stackTrace: stackTrace,
        ));
      });
    }),
  );

  zone.run(() async {
    WidgetsFlutterBinding.ensureInitialized();
    await Log.init();
    await windowManager.ensureInitialized();
    PackageInfo packageInfo = await PackageInfo.fromPlatform();

    FlutterError.onError = (FlutterErrorDetails details) {
      FlutterError.presentError(details);
      Log.error('Flutter Error', details.exception, details.stack);
    };

    Animate.restartOnHotReload = true;

    final docked = Platform.environment.containsKey('BEARSCOPE_PROJECT_FILE');
    await windowManager.hide();
    final minimumSize = docked ? const Size(1, 1) : const Size(640, 360);
    await windowManager.setMinimumSize(minimumSize);
    await windowManager.setSize(const Size(1280, 720));

    WindowOptions windowOptions = WindowOptions(
      center: !docked,
      titleBarStyle:
          Platform.isMacOS ? TitleBarStyle.normal : TitleBarStyle.hidden,
    );

    await windowManager.waitUntilReadyToShow(windowOptions);
    // Setting the title bar style clears the plugin's frameless flag.
    if (docked) await windowManager.setAsFrameless();
    await windowManager.setTitle('PathPlanner');
    await windowManager.show();
    if (!docked) await windowManager.focus();

    SharedPreferences prefs = await SharedPreferences.getInstance();

    // Ensure saved host is an IP
    try {
      String? hostIP = prefs.getString(PrefsKeys.ntServerAddress);
      if (hostIP != null) {
        Uri.parseIPv4Address(hostIP);
      }
    } catch (_) {
      // Not a valid IP, reset to default
      prefs.setString(PrefsKeys.ntServerAddress, Defaults.ntServerAddress);
    }

    bool useSim =
        prefs.getBool(PrefsKeys.telemetryUseSim) ?? Defaults.telemetryUseSim;
    String telemetryAddress = useSim
        ? '127.0.0.1'
        : (prefs.getString(PrefsKeys.ntServerAddress) ??
            Defaults.ntServerAddress);

    PPLibTelemetry telemetry =
        PPLibTelemetry(serverBaseAddress: telemetryAddress);

    runApp(PathPlanner(
      appVersion: packageInfo.version,
      prefs: prefs,
      undoStack: ChangeStack(),
      telemetry: telemetry,
      updateChecker: UpdateChecker(),
    ));
  });
}

class PathPlanner extends StatefulWidget {
  final String appVersion;
  final FileSystem fs;
  final SharedPreferences prefs;
  final ChangeStack undoStack;
  final PPLibTelemetry telemetry;
  final UpdateChecker updateChecker;

  const PathPlanner({
    required this.appVersion,
    required this.prefs,
    required this.undoStack,
    required this.telemetry,
    required this.updateChecker,
    this.fs = const LocalFileSystem(),
    super.key,
  });

  @override
  State<PathPlanner> createState() => _PathPlannerState();
}

class _PathPlannerState extends State<PathPlanner> {
  late Color _teamColor =
      const Color(0xFFFFDF00);

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PathPlanner',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: _teamColor, brightness: Brightness.dark).copyWith(primary: _teamColor, surface: const Color(0xFF181818)),
        brightness: Brightness.dark,
      ),
      home: HomePage(
        appVersion: widget.appVersion,
        prefs: widget.prefs,
        fs: widget.fs,
        undoStack: widget.undoStack,
        telemetry: widget.telemetry,
        updateChecker: widget.updateChecker,
        onTeamColorChanged: (Color color) {
          setState(() {
            _teamColor = color;
            widget.prefs.setInt(PrefsKeys.teamColor,
                int.parse(_teamColor.toHexString(), radix: 16));
          });
        },
      ),
    );
  }
}
