# Windows Island

A notch-style island at the top-centre of your screen. Hover to open it, move away to close it.
Built with Tauri 2 (Rust) and React. Windows 10 and 11 only.

Inspired by the island on [hitodama.in](https://hitodama.in/). Not affiliated with it.

## Install

**From a release:** download the latest `...-setup.exe` from the Releases page and run it.
It installs for your user only, so no admin prompt. On first launch the island registers itself to start at login (you can switch that off in the tray menu).

Windows SmartScreen may say "Windows protected your PC" because the installer isn't code-signed. Choose *More info*, then *Run anyway*.

**Build it yourself:** double-click `installer.bat`. It checks for Node.js, Rust and the Visual Studio C++ Build Tools (offering to install anything missing with winget), builds the installer, and offers to run it.

## Using it

| Do this | Result |
|---|---|
| Move the cursor to the top-centre | The island opens after about 90 ms |
| Move away | It closes after about 220 ms |
| `Ctrl+Alt+Shift+I` | Open or close from the keyboard (also works over apps) |
| `Esc` or the chevron | Close |

Tray icon, right-click:

- **Toggle island**
- **Only show on desktop** hides the island whenever an app window is open
- **Launch at login**
- **Quit**

## What's inside

- **Controls:** now playing (title, artist, album art, progress, prev/play/next) via Windows media sessions, volume and mute via Core Audio, real Wi-Fi and Bluetooth switches, quick links to display and night light settings
- **Today:** date, time and a quick note saved on your PC
- **Stats:** CPU, memory, disks, network speed, uptime
- **Clipboard:** history of copied text, kept in memory only, skipping anything a password manager flags
- **Apps:** search your Start Menu apps and launch them
- **Wallpaper:** pick an image and set it as your desktop background
- **Power:** lock, sleep, restart, shut down (two-click confirm)

## Uninstall

Use *Settings, Apps*, or the uninstaller in the install folder. It also removes the launch-at-login entry.

## Build from source

Needs Node 20+, Rust (MSVC toolchain), and the Visual Studio C++ Build Tools. WebView2 ships with Windows.

```powershell
npm install
npm run tauri dev      # run in development
npm run tauri build    # build the installer into src-tauri/target/release/bundle/nsis
```

If you have an installed copy running, quit it from the tray first. Both would otherwise fight over the same hotkey.

Pushing a tag like `v0.4.0` builds the installer in GitHub Actions and attaches it to a draft release (`.github/workflows/release.yml`).

## How it works

- **The window never resizes.** One transparent 560x520 window sits at the top of the screen. The island is a box inside it, animated by a small spring (`src/spring.ts`) that writes width, height and corner radius straight to the element each frame. Opening overshoots slightly, closing is critically damped.
- **Click-through.** The transparent area around the island passes clicks to whatever is underneath. A Rust thread tracks the cursor (`src-tauri/src/island.rs`) and only lets the island itself capture the mouse. Show, hide and click-through use Win32 directly, because mixing them with Tauri's own window calls makes the window vanish.
- **Desktop-only mode.** `foreground.rs` checks whether any real application window is open on the main monitor, instead of guessing from which window has focus.

## Tuning

- Compact size, tab heights, spring feel: `src/App.tsx` (`TABS`, `COMPACT_H`) and `src/spring.ts` (`OPEN`, `RETAB`, `CLOSE`)
- Hover delays: `HOVER_OPEN` and `LEAVE_CLOSE` in `src-tauri/src/island.rs`
- Launch at login on first run: `AUTOSTART_BY_DEFAULT` in `src-tauri/src/main.rs`
- If you change the window width in `tauri.conf.json`, change `WIN_W` in `App.tsx` too

## Not done yet

- A brightness slider (the row opens Display settings)
- A real Night Light toggle (opens Settings)
- Calendar and weather

The icons are placeholders. Replace them with `npm run tauri icon path/to/icon.png`.

## License

MIT, see `LICENSE`.
