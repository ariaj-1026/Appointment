# Clinic Patient: Flutter app (Android + iOS)

This is the patient-only app. It works the same way as the Tauri app in `../patient`.
It opens the hosted clinic site (`clinic-web` on Render) and keeps users on patient pages.
Staff and admin pages (`/app`, `/admin`, `/staff`, `/setup`) are blocked, and so are links
to other websites. Google sign-in is hidden because Google blocks it inside apps.

## Set the site URL

There are two ways to set it:
- Edit `defaultValue` in `lib/main.dart`, or
- pass it when you run or build:
  `--dart-define=CLINIC_WEB_URL=https://clinic-web-xxxx.onrender.com`

## Setup (Windows)

1. Install the **Flutter SDK**: https://docs.flutter.dev/get-started/install/windows/mobile
2. Install **Android Studio**, open it once, and let it install the Android SDK.
3. Run `flutter doctor` and fix anything it flags. Run
   `flutter doctor --android-licenses` and accept all.

## Run and build

Run these from `mobile/patient_flutter`:

```powershell
flutter pub get
flutter run --dart-define=CLINIC_WEB_URL=https://clinic-web-xxxx.onrender.com          # on a phone (USB debugging) or an emulator
flutter build apk --release --dart-define=CLINIC_WEB_URL=https://clinic-web-xxxx.onrender.com
```

The APK is written to `build/app/outputs/flutter-apk/app-release.apk`. Until you set up
your own signing key (https://docs.flutter.dev/deployment/android#sign-the-app), the
release build is signed with the debug key. That is fine for sharing with testers, but
not for the Play Store.

iOS builds require a Mac with Xcode: run `flutter build ios`.
