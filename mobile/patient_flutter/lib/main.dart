// Patient-only app: wraps the hosted clinic site (Render "clinic-web") and keeps
// users on patient pages. Same behaviour as the Tauri app in ../patient.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// Your clinic-web URL. Override with:
///   flutter run --dart-define=CLINIC_WEB_URL=https://clinic-web-xxxx.onrender.com
const siteUrl = String.fromEnvironment(
  'CLINIC_WEB_URL',
  defaultValue: 'https://clinic-web-REPLACE-ME.onrender.com',
);

/// Staff/admin pages, plus Google sign-in (Google blocks it inside webviews).
final _blocked = RegExp(r'^/(app|admin|staff|setup|api/auth/google)(/|$)');

const _hideCss = '''
(function () {
  if (document.getElementById('patient-app-css')) return;
  var s = document.createElement('style');
  s.id = 'patient-app-css';
  s.textContent = 'a[href^="/api/auth/google"], a[href^="/staff"] { display: none !important; }';
  document.head.appendChild(s);
})();
''';

void main() => runApp(const PatientApp());

class PatientApp extends StatelessWidget {
  const PatientApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Clinic Patient',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: const Color(0xFF0F766E), useMaterial3: true),
      home: const PortalScreen(),
    );
  }
}

class PortalScreen extends StatefulWidget {
  const PortalScreen({super.key});

  @override
  State<PortalScreen> createState() => _PortalScreenState();
}

class _PortalScreenState extends State<PortalScreen> {
  final _site = Uri.parse(siteUrl);
  late final WebViewController _controller;
  int _progress = 0;
  bool _failed = false;

  bool _sameSite(Uri u) => u.host == _site.host;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(NavigationDelegate(
        // Full page loads: only the clinic site, only patient pages.
        onNavigationRequest: (request) {
          final u = Uri.tryParse(request.url);
          final ok = u != null && _sameSite(u) && !_blocked.hasMatch(u.path);
          return ok ? NavigationDecision.navigate : NavigationDecision.prevent;
        },
        // In-app route changes (React Router) don't trigger the check above.
        onUrlChange: (change) {
          final u = change.url == null ? null : Uri.tryParse(change.url!);
          if (u != null && _sameSite(u) && _blocked.hasMatch(u.path)) {
            _controller.loadRequest(_site.resolve('/portal'));
          }
        },
        onProgress: (p) => setState(() => _progress = p),
        onPageStarted: (_) => setState(() => _failed = false),
        onPageFinished: (_) => _controller.runJavaScript(_hideCss),
        onWebResourceError: (e) {
          if (e.isForMainFrame ?? true) setState(() => _failed = true);
        },
      ))
      ..loadRequest(_site.resolve('/login'));
  }

  Future<void> _retry() async {
    setState(() => _failed = false);
    final current = await _controller.currentUrl();
    final target = current != null && current.startsWith('http') ? Uri.parse(current) : _site.resolve('/login');
    await _controller.loadRequest(target);
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      // Android back button goes back in the site, then closes the app.
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (await _controller.canGoBack()) {
          await _controller.goBack();
        } else {
          await SystemNavigator.pop();
        }
      },
      child: Scaffold(
        body: SafeArea(
          child: Stack(
            children: [
              if (_failed) _OfflineView(onRetry: _retry) else WebViewWidget(controller: _controller),
              if (!_failed && _progress < 100) LinearProgressIndicator(value: _progress / 100),
            ],
          ),
        ),
      ),
    );
  }
}

class _OfflineView extends StatelessWidget {
  const _OfflineView({required this.onRetry});
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.wifi_off, size: 48),
            const SizedBox(height: 16),
            Text("Can't reach the clinic", style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            const Text(
              'Check your internet connection. If the clinic server was idle, it can take up to a minute to wake up.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            FilledButton(onPressed: onRetry, child: const Text('Try again')),
          ],
        ),
      ),
    );
  }
}
