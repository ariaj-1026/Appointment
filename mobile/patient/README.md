# Clinic Patient app (Tauri v2: Android + desktop)

A patient-only app. It opens the hosted clinic site (the `clinic-web` Render static site)
in a native window and keeps users on patient pages: `/login`, `/register`, `/portal`
and the password reset pages. Staff pages (`/app`, `/admin`, `/staff`, `/setup`) are blocked.
It needs an internet connection, and changes you deploy to the website show up in the app
without a new release.

## 1. Set the site URL

In `src-tauri/src/lib.rs`, set `DEFAULT_SITE` to your clinic-web URL, for example
`https://clinic-web-abcd.onrender.com`. Alternatively, set `CLINIC_WEB_URL` when you build.

## 2. Install the tools (Windows)

1. **Rust:** install from https://rustup.rs, and choose the default options.
2. **Microsoft C++ Build Tools:** in the Visual Studio Installer, select "Desktop development with C++".
3. **Node.js 20+:** you should already have it.
4. **For Android:**
   - Install **Android Studio**. Then go to SDK Manager → SDK Tools and install
     *Android SDK Platform-Tools*, *NDK (Side by side)*, *Android SDK Command-line Tools* and *CMake*.
   - Set these environment variables (System Properties → Environment Variables):
     ```
     JAVA_HOME    = C:\Program Files\Android\Android Studio\jbr
     ANDROID_HOME = %LOCALAPPDATA%\Android\Sdk
     NDK_HOME     = %ANDROID_HOME%\ndk\<version folder>
     ```
   - Add the Rust Android targets:
     ```powershell
     rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
     ```

## 3. Build

Run these from `mobile/patient` in a new PowerShell window:

```powershell
npm install
npm run icons            # creates src-tauri/icons from app-icon.svg (run once)

npm run dev              # desktop window, for quick testing

npm run android:init     # run once; creates src-tauri/gen/android
npm run android:dev      # runs on a connected phone (USB debugging on) or an emulator
npm run android:build    # makes the APK
```

The APK is written to
`src-tauri/gen/android/app/build/outputs/apk/universal/release/`.
A release APK must be **signed** before it will install on phones. See
https://v2.tauri.app/distribute/sign/android/. While testing, use the debug build from
`npm run android:dev`.

## Notes

- **Google sign-in is hidden in the app** because Google blocks sign-in inside embedded
  webviews. Patients sign in with email and password. If a patient only ever used Google,
  they can set a password with "Forgot password".
- Logins remain saved between app launches, as they do in a browser.
- This folder is intentionally **outside** the npm workspaces, so it does not affect
  the website and API builds on Render.
