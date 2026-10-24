# Changelog

## 2.10.0 (2026-10)
- **AI access (MCP).** AI apps such as Claude Desktop, Claude Code, Cursor and VS Code can now use Bryt Shell: open and manage tabs, run PowerShell in a tab or hidden, follow long-running programs, create projects from templates, and read and write files. **Off by default** (Settings, AI access). It listens only on a local pipe with a secret token, risky actions always ask you in a dialog, tabs made by AI show an **AI** badge, every action is written to `ai-audit.log`, and **Disconnect AI now** switches it off at once. One click copies the connection settings for your PC
- New files: `aiapi.js` (the control server), `mcp/bryt-shell-mcp.js` (the bridge AI apps start), `test/ai-selftest.js` (`npm run test:ai`)
- **Guided "Connect an AI app"**: the AI chip in the header is always there; click it for three steps (turn on, pick your AI app, restart it and ask). Bryt Shell finds Claude Desktop, Claude Code, Cursor and VS Code and connects them in one click without touching your other MCP servers (a backup is kept), shows when an AI app connects, and "Check my setup" tests the whole chain
- **Steadier AI tabs**: a tab opened by an AI app is now told the window's real size once, and repeated identical resizes are ignored, which fixes the rows of blank prompts. `run_in_tab` has a **background mode** (with optional `readyText`) so servers and watchers return as soon as they are up instead of waiting for an end that never comes, and a busy tab now tells the AI plainly not to type into it
- **Recent AI activity** in Settings, AI access: a readable list of what AI apps did (allowed, denied or failed), instead of a raw log file
- **You stay in control**: questions from AI apps appear as a banner inside the window (a Windows dialog only when Bryt Shell is minimised), with **Deny** focused. **Trusted folders**: your projects folder is trusted by default and the banner offers "Allow and trust this folder" elsewhere, so AI iterates on files without constant questions. A red **Stop AI** chip interrupts what AI apps are running, cancels waiting questions and switches AI access off. Reading files or folders outside trusted folders now asks too (it used to be silent), and anything touching keys, credentials or browser data always asks
- **Send a project to another PC**: ... menu, Send a project / Open a project package. One `.brytproject` file; secrets and programs never travel, every path and hash is checked, nothing runs automatically. `export_project` and `import_project` tools for AI apps (imports always ask)
- `packaging/winget`: a script that makes the winget manifests for a release. `docs/mcp-listing.md`: text for MCP directories
- **One-click AI connection**: after start-up Bryt Shell offers to connect the AI apps it finds ("No thanks" is remembered). The AI window is now a single **Connect my AI apps** button that turns AI access on and connects everything found, shows who is connected, and hides settings text, the check and other technical options under "Something not working". Connections fix themselves after an update or a move
- **One Mode button** replaces the three tabs: choose **Plain**, **Lab** or **Engine** from a small menu, and the button shows the current one. **Life is now called Lab** everywhere. (The menu of the Daemon chip on the right now says "Change how it runs" so the two never get mixed up.)
- **Web** and **Access** buttons: switches (Off, On, Admin only) for Files, Recycle Bin, Apps, Install software, Windows settings, Reading web pages, Opening pages in the browser and Internet for commands, plus presets (Careful, Builder, Full control, Lock down). Blocked attempts get a clear message and appear as Blocked in the activity list
- New AI tools: `web_fetch` (page as text; no cookies; local and private addresses blocked unless allowed; size and time limited), `open_url`, `delete_path` (to the Recycle Bin by default), `recycle_bin`, `apps`
- **Project inbox**: choose a shared folder (OneDrive, Dropbox, Google Drive, a network folder) in the "..." menu; packages that arrive there show up with a banner and a count, with the same safe preview before anything is imported. Packages can carry an optional, unverified sender name. No server needed
- **Live watch**: share your AI tabs live with a code (**... menu, Share my work live**) and watch someone else's (**Watch someone's work**). Read-only, end-to-end encrypted (AES-256-GCM, key derived from the code with scrypt), a header chip while you share, up to 8 watchers, and a relay server in `relay/` that cannot read anything it forwards
- The Access window now marks which preset is active (a tick), so "Lock down" can no longer be mistaken for the defaults. Cancelling the Windows prompt after "Run as admin" now says so in plain words
- Tabs now update live when something other than the window changes them

## 2.9.3 (2026-10)
- **Only one Bryt Shell can run.** Clicking the shortcut several times used to open several windows that shared one background service, so closing one with "Stop everything" cut the others off ("Lost connection") and could leave things stuck until a reboot. Extra launches now just bring the open window to the front. The copy that starts at Windows login and the Run as admin copy are separate, a frozen earlier window is replaced, and restarting from "Try again" or a mode change releases the lock first
- **A stuck background service is cleaned up at start-up** (found by its process id, or by its command line for older versions) instead of being waited on for 30 seconds and never removed

## 2.9.2 (2026-10)
- **Fixed: "Lost connection to the background service. Close and reopen Bryt Shell", and being unable to create a tab afterwards.** Two causes: the service exited on *any* pipe error for as long as it ran (it now survives them), and when the connection dropped the app waited forever and never recovered. Now the app notices at once (a heartbeat also catches a stuck service), reconnects or starts a fresh service, re-attaches your terminals and carries on. If no service can be started, the window continues with its own terminals and offers **Try again**
- The service now records its whole life in `daemon.log` (start, connections, errors, why it exited), and opening a terminal can no longer hang the window
- **Settings, About, "Download the newest version"** opens the latest installer in your browser (the app still never contacts the internet by itself), with a "What's new" link
- **Cleanup:** removed nine unused emoji images left over from the scenes removed in 2.6.0, and the redundant `build-installer.bat`
- **cleanup-github.ps1:** deletes old releases, tags and build runs on GitHub, keeping the newest of each

## 2.9.0 (2026-10)
- **Much faster start-up.** The window and the tab strip now appear immediately (about half a second) instead of waiting for the background service, with a "Starting Bryt Shell" placeholder where the terminal will be. The app no longer spawns a Windows process just to check for administrator rights, and the window opens in your theme colour with no white flash
- **Daemon mode now starts reliably.** The app used to give up on the background service after about 10 seconds, which is not enough on the first launch after an install. It now waits up to 30 seconds, notices straight away if the service crashes, and keeps a `daemon.log` so a failure explains itself. The notice has a **Try again** button
- Bryt Shell reopens the tab you were using last
- **One-click installer** (no wizard, per user, no administrator permission) with English-only Electron locales, so it is smaller and quicker to open

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
