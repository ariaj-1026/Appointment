//! Patient-only app: a native window around the hosted web app, locked to the
//! patient pages (/login, /register, /portal, password reset). Staff and admin
//! pages are blocked, and the session cookie stays same-origin with the site.

use tauri::{Url, WebviewUrl, WebviewWindowBuilder};

/// Your Render static site (clinic-web). Override at build time with
/// `CLINIC_WEB_URL=https://... npm run android:build`.
const DEFAULT_SITE: &str = "https://clinic-web-REPLACE-ME.onrender.com";

/// Path prefixes patients must never reach.
const BLOCKED: [&str; 4] = ["/app", "/admin", "/staff", "/setup"];

/// Runs in every page before the site's own scripts. Client-side route changes
/// don't trigger native navigation events, so they're guarded here too.
const INIT_SCRIPT: &str = r#"
(function () {
  var blocked = /^\/(app|admin|staff|setup)(\/|$)/;
  function guard() { if (blocked.test(location.pathname)) location.replace('/portal'); }
  var push = history.pushState, rep = history.replaceState;
  history.pushState = function () { push.apply(this, arguments); guard(); };
  history.replaceState = function () { rep.apply(this, arguments); guard(); };
  addEventListener('popstate', guard);
  guard();
  // Google blocks sign-in inside embedded webviews; hide it and staff links.
  var css = 'a[href^="/api/auth/google"], a[href^="/staff"] { display: none !important; }';
  document.addEventListener('DOMContentLoaded', function () {
    var s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  });
})();
"#;

fn is_blocked(path: &str) -> bool {
    BLOCKED
        .iter()
        .any(|p| path == *p || path.starts_with(&format!("{p}/")))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let site = Url::parse(option_env!("CLINIC_WEB_URL").unwrap_or(DEFAULT_SITE))?;
            let host = site.host_str().map(str::to_owned);
            let start = site.join("/login")?;

            #[allow(unused_mut)]
            let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(start))
                .initialization_script(INIT_SCRIPT)
                .on_navigation(move |url| {
                    // Stay on the clinic site, and only on patient pages.
                    url.host_str().map(str::to_owned) == host && !is_blocked(url.path())
                });

            #[cfg(desktop)]
            {
                builder = builder.title("Clinic Patient").inner_size(420.0, 820.0);
            }

            builder.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Clinic Patient");
}
