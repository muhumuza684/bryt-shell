# Changelog

## 2.8.3 (2026-10)
- **One-click, permanent download link:** the installer is now always named `Bryt-Shell-Setup.exe`, so `github.com/muhumuza684/bryt-shell/releases/latest/download/Bryt-Shell-Setup.exe` always downloads the newest version. The repo front page and the website both have a Download button that uses it

## 2.8.2 (2026-10)
- **setup-github.ps1:** first-time GitHub setup in one safe step (checks git and your identity, connects the repository, commits, pushes; never overwrites work already on GitHub without `-Force`)
- The GitHub release build falls back to `npm install` if `npm ci` fails, so the first release does not stop on a lock-file difference

## 2.8.1 (2026-10)
- **The desktop shortcut now updates itself:** the installer recreates the desktop shortcut on every install or update, and `reinstall-desktop.ps1 -ShortcutOnly` repairs the desktop and Start menu shortcuts and refreshes the icons
- **A real downloadable installer:** the GitHub release build now also writes a SHA-256 checksum, keeps the installer as a build artifact, and publishes on every version tag; `release.ps1` creates and pushes the tag
- **Landing page:** the download button always points at the newest release (with version and size), and a new section explains the Windows warning and how to verify a download

## 2.8.0 (2026-10)
- **New White theme** (pure white) next to Ivory and Black, chosen in Settings, Appearance; the header White button means "your last light theme"
- **Color pickers, folded away under Appearance, Colors:** an accent color (7 presets or any custom color) and a terminal color (5 presets or any custom color), with readable text chosen automatically and a Reset button. Faith styles keep their own colors while Faith is on
- **Clearer, brighter buttons:** every control is now a filled, bordered button, Settings is a bright accent button, muted text is darker, and all text/background pairs in the three themes meet WCAG AA contrast
- The tab strip fades (and scrolls to the open tab) only when it really overflows
- **reinstall-desktop.ps1 / .bat:** one step to uninstall the old desktop app, build a new installer and open it, keeping your tabs, logs and settings

## 2.7.0 (2026-10)
- **New "Ivory" design** across the whole app: a light editorial look (and a warm black one) with a balanced header, a serif brand, gold hairlines, underlined tabs and refined panels
- **One experience at a time:** Plain, Life and Engine in the header; Faith in Settings. Choosing one turns the others off, and your 2.6.0 choices carry over
- **Life is back on top**, and the **White / Black** theme switch is always visible in the header
- **Faith lives entirely inside Settings** and stays folded away until you switch it on. New **My verses**: paste your own verses (with optional references), add them to the built-in ones or use only yours, saved per tradition
- The Mode chip opens a menu with **Change mode** and **Quit & stop all**; tools moved beside the tabs (Search, Notify when done, and a menu with Export log, Clear log and Startup command)
- The tab bar fades instead of showing a scrollbar, and the **+** button always stays visible
- A minimum window size, and a header that adapts to narrower windows

## 2.6.0 (2026-10)
- **Settings screen** with General, Appearance, Life, Engine, Faith, Support, About and a 20-question FAQ (including why PowerShell is stronger than most people think). *Add life*, Start at login, the theme and everything optional moved out of the header, which now has only Mode, Run as admin, Settings and Quit
- **A new running engine** that fills the left and right of the window: a five-gear train with exactly meshing teeth, a V-twin with pistons and rods driven by the real crank-slider equation, a flywheel with ring gear and starter pinion, a belt drive and a camshaft with sprung valves. It runs while a command runs and jams when it fails
- **Faith**: Christianity (3 styles, King James verses) and Islam (3 styles, Arabic verses with English meaning on hover), each with matching frames, corner ornaments and a verse strip that changes with the command's state
- **Support** page with a pre-filled email to muhumuzabright26@gmail.com and a button that copies system details; **About** page with live system details
- The window can only open links to the support email and the project pages
- Removed: trees, ocean, footballers, chimney and fireworks, to keep the app calm and premium


## 2.5.0 (2026-10)
- **Scenes**, each optional and off by default, in a row of icon buttons next to *Add life*: V16 engine with turning gears and a smoking chimney (crashes and stops the smoke when a command fails), wind-blown trees, scrolling King James Bible verses that change with the state, fireworks on long successful runs, footballers, and an ocean with fish
- One shared "world" state from the active tab drives every scene, so they always agree with the lights and the test tube
- **Black theme** with a moon/sun toggle (white stays the default)
- Preview buttons in the footer to watch the scenes without running a command
- Header buttons no longer wrap their labels; side columns use thin scrollbars
- Screenshots in the README and on the landing page

## 2.4.0 (2026-10)
- App icon (blue "B" with three signal lamps) written into the `.exe`, plus proper file properties (Bryt Shell / BrytMa Tech Uganda), so shortcuts and Task Manager no longer show Electron
- Installer with desktop shortcut and Start menu entry; the build no longer needs Developer Mode or admin rights
- State faces next to the Engine test tube: idle, running, success, failure, stopped by you
- Detects a background service left over from an older version and explains how to refresh it
- Fixed: the app could wait forever if the background service rejected its token
- Fixed: the Engine panel title was clipped on shorter windows

## 2.3.0 (2026-10)
- **Life mode**: Signal traffic lights across all tabs, Engine test tube for the active tab, tab dots, Recent list
- Command state tracking (running / ok / fail / stopped) from OSC 133 marks, with correct exit codes and Ctrl+C handling
- Level recipes (`recipes.json`) so the tube fills by level for known commands
- Fluent Emoji for modes and Life

## 2.2.0 (2026-10)
- Mode window that explains both modes in plain words
- Daemon mode now asks what to do with programs when you close the window
- Batched log writes (one disk write per tab every 250 ms instead of one per output chunk)
- The background service quits by itself after 5 idle minutes

## 2.1.x (2026-10)
- Tab naming and startup-command dialogs (Electron has no `prompt()`)
- Run as admin waits for the Windows permission prompt and reports failure
- Switched to a prebuilt terminal engine (`@lydell/node-pty`), so nothing is compiled during install

## 2.0.0 (2026-10)
- Real terminal (xterm.js + Windows ConPTY), Chrome-style tabs
- Persistent logs, Daemon and "Closes with window" modes, Start at login
- Log tools: search, export, notify when done
- Run as admin with a separate workspace
