<p align="center">
  <img src="docs/assets/icon.png" width="96" alt="Bryt Shell icon">
</p>

<h1 align="center">Bryt Shell</h1>
<p align="center"><b>The PowerShell that never forgets.</b><br>
Tabbed, named, persistent terminals for Windows, with live status lights, a test tube that shows what failed, and a running engine that fills the window.<br>
<sub>Built in Uganda by BrytMa Tech Uganda</sub></p>

<p align="center">
  <a href="https://github.com/muhumuza684/bryt-shell/releases/latest/download/Bryt-Shell-Setup.exe">
    <img alt="Download Bryt Shell for Windows" src="https://img.shields.io/badge/%E2%AC%87%EF%B8%8F%20Download%20for%20Windows-Bryt--Shell--Setup.exe-0b57a4?style=for-the-badge">
  </a>
</p>
<p align="center"><sub>Windows 10 and 11 · free · one file to double-click · <a href="#about-the-windows-warning">about the Windows notice</a></sub></p>

<p align="center">
  <a href="https://github.com/muhumuza684/bryt-shell/releases/latest">All releases</a> ·
  <a href="https://muhumuza684.github.io/bryt-shell/">Landing page and live demo</a> ·
  <a href="#faq">FAQ</a> ·
  <a href="#support">Support</a>
</p>

<p align="center">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%2010%2F11-0b57a4">
  <img alt="Version" src="https://img.shields.io/badge/version-2.9.0-0b57a4">
  <img alt="Built with" src="https://img.shields.io/badge/built%20with-Electron%20%2B%20xterm.js-0b57a4">
</p>

<p align="center">
  <img src="docs/screenshots/engine.jpg" width="900" alt="Bryt Shell with the running engine filling the left and right of the window: a meshing gear train and V-twin crank on the left, a flywheel, belt drive and camshaft on the right">
</p>
<p align="center"><sub>The engine runs while a command runs. Left and right of the terminal: gear train, V-twin with pistons and rods, flywheel, belt drive, camshaft and valves.</sub></p>

---

## Why Bryt Shell?

If you run many programs at once (Docker, Airflow, API servers, build watchers), a normal PowerShell window has three problems: close it and the history is gone, restart the PC and everything is gone, and with ten windows open you cannot tell which one failed.

Bryt Shell fixes those:

- **Your work survives.** Every tab keeps its full history on disk. Restart the PC and your tabs, names and logs come back.
- **Real names.** Call a tab "airflow" or "api-server" instead of "Tab 3".
- **You can see what happened.** Optional **Life** shows traffic lights for all tabs and a glass test tube for the active one.
- **You decide what happens on close.** Stop everything, or keep programs running in the background.
- **Calm and premium.** The main window is just tabs and a terminal. Everything else lives in **Settings**.

## Features

| | |
|---|---|
| **Real terminal** | Full PowerShell through Windows ConPTY: colors, tab completion, Ctrl+C, vim, ssh, resizing. Uses PowerShell 7 if installed, otherwise Windows PowerShell. |
| **Tabs** | **+** asks for a name, **×** deletes (with confirmation), double-click renames. In Life mode a colored dot on each tab shows its state. |
| **Persistent logs** | Output is saved per tab and replayed when you reopen. Scrollback is 10,000 lines. Logs over 2 MB are trimmed to the most recent 1 MB when the app starts. |
| **Two modes** | *Closes with window* or *Daemon* (see below). |
| **Startup command** | Give a tab a command (for example `docker compose up`) and it runs whenever that tab's shell starts, including after a restart. |
| **Start at login** | In the installed app and Daemon mode, Windows starts Bryt Shell silently at login and starts tabs that have a startup command. |
| **Log tools** | **Search** (Ctrl+F), **Export log** (clean `.txt` or raw `.log`), **Notify when done**. |
| **Run as admin** | Opens an elevated copy with its **own separate tabs and logs**. |
| **Settings** | General, Appearance, Life, Engine, Faith, Support, About and a 20-question FAQ, all in one place. |

## The main window

A calm, balanced header in a light "Ivory" design (and a warm black one):

- **Left:** the experience switch, **Plain / Life / Engine**.
- **Center:** the Bryt Shell name.
- **Right:** the **White / Black** theme switch (White means your last light theme), the **Mode** chip, **Run as admin** and **Settings**. The Mode chip opens a small menu with **Change mode** and, in Daemon mode, **Quit & stop all**.

Under the header, the tabs sit on one line with a soft fade instead of a scrollbar, the **+** is always visible, and the tools are beside them: **Search**, **Notify when done** and a **⋯** menu with **Export log**, **Clear log** and **Startup command**. Everything optional, including all of Faith, is in **Settings**.

## Settings

Open **Settings** from the header. Press Esc to close it.

| Page | What it does |
|---|---|
| **General** | What happens when you close the window (Mode), Start at login, and resetting the close prompt. |
| **Appearance** | Three themes (**Ivory**, **White**, **Black**) and, folded away under **Colors**, an accent color picker and a terminal color picker. |
| **Life** | Turn Life on or off, see what each face means, and edit level recipes. |
| **Engine** | Turn the running engine on or off, with **Preview** buttons (Run, Crash). |
| **Faith** | Optional Christian or Islamic styling and verses, including your own. Hidden until you switch it on (see below). |
| **Support** | Write to support, copy the address, copy your system details. |
| **About** | What Bryt Shell can do, and live system details. |
| **FAQ** | Twenty questions and answers. |

<p align="center">
  <img src="docs/screenshots/settings-faith.jpg" width="760" alt="The Faith page of Settings with Islam selected and three style previews">
</p>

## Appearance and colors

Settings, Appearance.

- **Three themes:** **Ivory** (warm and light, the default), **White** (clean and bright) and **Black** (warm black). The header switch flips between your light theme and Black.
- **Colors** (folded away until you open it): pick an **accent color** from seven presets or any custom color, and a **terminal color** from five presets or any custom color. The text on buttons and the terminal text color adjust automatically so everything stays readable. **Reset colors** puts the defaults back. Faith styles keep their own colors while Faith is on.
- **Clear buttons:** every control is a filled, bordered button, with a bright accent-colored **Settings** button. All text and background pairs in the three themes meet WCAG AA contrast (4.5:1 or better).

<p align="center">
  <img src="docs/screenshots/appearance.jpg" width="760" alt="Settings, Appearance: three theme cards and the Colors section with accent and terminal color pickers">
</p>

## The two modes

Click **Mode** (or Settings, General). Switching stops the programs running right now and restarts the app. Saved logs are always kept.

| | **Closes with window** | **Daemon (keeps running)** |
|---|---|---|
| Close the window | Everything stops | Asks: **Keep running / Stop everything / Cancel** |
| CPU while the window is closed | None | Only the programs you left running |
| Reopen | Logs come back, programs must be started again | Reattaches to the still-running programs, with everything they printed meanwhile |
| Stop it all | Close the window | **Quit & stop all** button |

In Daemon mode a small background service owns your terminals. It is idle and light, and it **quits by itself after 5 minutes** if no window is open and nothing is running. A background service that survived an app update still runs the old code, so Bryt Shell shows a banner asking you to click **Quit & stop all** once and reopen.

> No application can keep programs alive through a Windows restart. After a restart you get your tabs, names and full logs back, and tabs with a startup command start again by themselves.

## One experience at a time

Bryt Shell offers four experiences and runs **one at a time**, so the window never feels crowded:

| Experience | Where you choose it | What it does |
|---|---|---|
| **Plain** | Header | Just tabs and the terminal. |
| **Life** | Header, or Settings, Life | Status lights, test tube, faces. |
| **Engine** | Header, or Settings, Engine | A running engine fills the left and right of the window. |
| **Faith** | Settings, Faith | Styled frames and a strip of verses. When Faith is on, the first header segment reads **Faith**. |

Choosing one turns the others off. Click the active one again to return to Plain.

## Life

Choose **Life** in the top bar (or Settings, Life).

- **Signal (left):** a traffic light for *all* tabs. **Red** if any tab failed, **orange** if any is running, **green** if all finished fine (red beats orange beats green), plus a *Recent* list with durations.
- **Engine test tube (right):** a glass tube for the *active* tab. The liquid rises as the command runs, turns **green** on success, and turns **red** with an error pin where it failed. **Find the error** jumps to the error in the log.
- **Faces:** a smile when idle, a thinking face while running, a happy face on success, a crying face on failure, and a neutral face when *you* pressed Ctrl+C. Stopping a program yourself is never shown as an error.
- **Levels:** for commands it recognizes, the tube fills level by level (Docker compose up, git clone and pip install are built in). Unknown commands show a steady tube and turn green or red when they finish. Bryt Shell never fakes progress.

### Teach the tube your own commands

Settings, Life, **Edit level recipes** opens `recipes.json`. Each recipe has a regular expression for the command (`match`) and a list of levels, each with a regular expression (`on`) that is looked for in the output:

```json
[
  {
    "name": "Docker compose up",
    "match": "^\\s*docker[ -]compose\\b.*\\bup\\b|^\\s*docker\\s+compose\\b.*\\bup\\b",
    "levels": [
      { "name": "Pull",    "on": "Pull(ing|ed)" },
      { "name": "Create",  "on": "Created" },
      { "name": "Start",   "on": "Started" },
      { "name": "Healthy", "on": "Healthy" }
    ]
  }
]
```

A level counts as reached the first time its pattern appears; levels only move forward. Changes apply to the next command you run.

## The engine

Choose **Engine** in the top bar (or Settings, Engine). A running engine fills the left and right of the window, and it is built with real mechanics:

- **Left:** a five-gear train whose teeth mesh exactly, above a V-twin with finned cylinders, bronze pistons, steel connecting rods and a counterweighted crankshaft. Piston motion follows the true crank-slider equation.
- **Right:** a flywheel with its bolt circle and ring gear, a starter pinion, a ribbed belt drive around three pulleys, and a camshaft whose lobes lift sprung valves.
- **It follows your command.** It spins up while a command runs and winds down when it ends. If the command **fails, the engine jams**: it shakes, sparks fly, a red glow appears and everything stops dead.
- **Light on your PC.** It only animates while a command is running, at 30 frames a second, and pauses when the window is hidden. Turn it off in Settings and it costs nothing.

## Faith styles and verses

Settings, Faith. Optional, and kept out of the way: nothing appears until you switch **Use Faith** on, and then its options unfold.

1. **Tradition:** Christianity or Islam.
2. **Style:** one of three, each recoloring the whole app and giving the frames a double gold line with ornamented corners.
3. **Show verses:** a strip of verses scrolls above the terminal and changes with what your command is doing: courage while it runs, thanksgiving after success, comfort after a failure.
4. **My verses:** paste the verses you love, one per line, with an optional reference after a dash (`Be still, and know that I am God. — Psalm 46:10`). Choose **Add to built-in** or **Only mine**. Your verses are saved separately for each tradition, work in Arabic too, and are never sent anywhere.

| | Styles |
|---|---|
| **Christianity** (King James Bible verses, public domain) | **Classic** (royal blue and white), **Stained glass** (jewel-tone frames), **Parchment & gold** (warm paper and gold) |
| **Islam** (short Arabic verses; hover for the English meaning) | **Emerald & gold** (with a star pattern), **Midnight & gold** (arabesque corners), **Sand & teal** (warm geometric frames) |

All six styles work in both the white and the black theme. The built-in verses are short extracts shown as reminders; if you spot a mistake in any of them, please [tell us](#support) and it will be corrected.

<p align="center">
  <img src="docs/screenshots/faith-islam-dark.jpg" width="760" alt="The Islamic Midnight and gold style in the black theme, with an Arabic verse scrolling above the terminal">
</p>

## Install

### Option A: the installer (recommended)

1. Download [`Bryt-Shell-Setup.exe`](https://github.com/muhumuza684/bryt-shell/releases/latest/download/Bryt-Shell-Setup.exe) (one click, always the newest version).
2. Run it. Windows may show **"Windows protected your PC"** because the installer is not code-signed. Click **More info**, then **Run anyway**.
3. Open **Bryt Shell** from the desktop shortcut or Start menu.

The installer creates a desktop shortcut, a Start menu entry and an uninstaller (Settings, Apps).

### Replace an old installed copy

The desktop shortcut runs the **installed** copy, which only changes when you reinstall. From the project folder, run:

```powershell
.\reinstall-desktop.ps1
```

(or double-click `reinstall-desktop.bat`). It stops Bryt Shell, uninstalls the old desktop app and its shortcuts, builds a new installer and opens it. Your tabs, logs and settings are kept. Add `-DryRun` to see what it would do without changing anything. If a shortcut still opens an old version, run `.\reinstall-desktop.ps1 -ShortcutOnly` to repair the desktop and Start menu shortcuts. The installer also recreates the desktop shortcut on every update.

### Build from source

Requirements: **Windows**, **Node.js 20.19.5 or newer**, and internet for the first install. No compiler or Visual Studio is needed.

```powershell
git clone https://github.com/muhumuza684/bryt-shell.git
cd bryt-shell
npm install
npm start
```

Double-clicking `setup.bat` then `start.bat` does the same. To build the installer yourself:

```powershell
npm run dist
```

The result is `dist\Bryt-Shell-Setup.exe`. The build writes the icon and version info into the `.exe` with a small pure-JavaScript step (`build/afterPack.js`), so it works without Developer Mode or administrator rights.

## Share Bryt Shell

- **One-click download (always the newest version):** https://github.com/muhumuza684/bryt-shell/releases/latest/download/Bryt-Shell-Setup.exe
- **Releases page:** https://github.com/muhumuza684/bryt-shell/releases/latest
- **Website:** https://muhumuza684.github.io/bryt-shell/
- The installer is built by GitHub from this public source code and attached to each [release](https://github.com/muhumuza684/bryt-shell/releases).

**Check your download.** Each release includes a `.sha256` file. In PowerShell:

```powershell
Get-FileHash .\Bryt-Shell-Setup.exe -Algorithm SHA256
```

The result must match the text in the `.sha256` file.

### First-time GitHub setup (maintainers)

If this folder is not a git repository yet, run `.\setup-github.ps1` once. It checks git, connects the folder to `https://github.com/muhumuza684/bryt-shell`, commits your files and pushes them. It never overwrites work that is already on GitHub unless you add `-Force`, and `-DryRun` shows what it would do.

### Publishing a new version (maintainers)

1. Raise the version in `package.json` and commit.
2. Run `.\release.ps1` (add `-DryRun` to preview). It creates the version tag and pushes it.
3. GitHub builds the installer (about 3 to 6 minutes) and publishes it with its checksum. Watch it in the **Actions** tab.

## About the Windows warning

The installer is **not code-signed yet**, so Windows SmartScreen may show "Windows protected your PC" the first time you run it. This notice appears for new or rarely downloaded apps. Click **More info**, then **Run anyway**. Code signing is planned; even a signed app can show the notice at first, because Windows builds trust from real downloads over time.

## Startup speed

- **The window and your tabs appear at once.** The terminal fills in as soon as the background service is ready; the app never waits for the service before showing itself.
- **The very first launch after installing is the slowest,** because Windows scans a new, unsigned program. Later launches are quick.
- **In Daemon mode the service keeps running when you close the window,** so reopening Bryt Shell reconnects instantly. Turn on **Settings, General, Start at login** and the service is already running when you sign in.
- If the service cannot start, the notice says why and offers **Try again**. Details are saved in `%APPDATA%\Bryt Shell\daemon.log`.
- The installer is a one-click installer: double-click it, wait a few seconds, and Bryt Shell opens. It installs for your account only, so it needs no administrator permission.

## Your data and privacy

- Everything is stored under `%APPDATA%\Bryt Shell` (`user\` for normal tabs, `admin\` for the elevated workspace), plus `recipes.json` and `settings.json`. Appearance choices are kept inside the app.
- Bryt Shell makes **no network connections of its own** and has no accounts or telemetry. The only things it opens outside the app are the links you click (support email, project pages).
- In Daemon mode the window and the background service talk over a private local Windows pipe, and the service only accepts a connection that presents a random token stored in your profile folder.
- Deleting a tab deletes its saved log.

## How it works

```mermaid
flowchart LR
  W["Window<br/>(Electron + xterm.js)"] <-->|"private local pipe<br/>+ random token"| D["Background service<br/>(Daemon mode)"]
  D --> T1["PowerShell tab 1"]
  D --> T2["PowerShell tab 2"]
  D --> L[("Logs on disk")]
  W -. "Closes mode: runs terminals itself" .-> T1
```

**Status detection.** Each shell starts with a small wrapper (the same technique VS Code uses) that prints standard OSC 133 marks when a command starts and finishes, including whether it succeeded. Your own prompt (oh-my-posh and similar) keeps working and still sees the correct `$?`. The engine reads those marks to drive the lights, tube, faces and the running engine, and to detect Ctrl+C. Because this runs in the shared engine, it works the same in both modes, and states survive closing the window in Daemon mode.

### Project layout

| File | Purpose |
|---|---|
| `main.js` | App window, modes, background-service connection, safe link opener, system details |
| `ptycore.js` | Shared terminal engine: shells, batched log writing, state tracking, level recipes |
| `daemon.js` | The background service used in Daemon mode |
| `preload.js` | Safe bridge between the window and the app |
| `index.html` | The whole interface: tabs, Settings, Life, the engine, faith styles |
| `build/` | App icon and the `afterPack.js` build step |
| `reinstall-desktop.ps1` / `.bat` | Uninstall the old desktop app, build and open a fresh installer |
| `release.ps1` | Create the version tag and push it so GitHub builds and publishes the installer |
| `setup-github.ps1` | First-time setup: connect this folder to GitHub and push your code safely |
| `.github/workflows/release.yml` | The GitHub build that publishes the installer and its checksum |
| `assets/` | Emoji images and window icon |
| `docs/` | Landing page (GitHub Pages) and screenshots |

## Known limitations

- **Windows only.** It relies on Windows ConPTY and Windows named pipes.
- **PowerShell 7 is the tested shell.** Windows PowerShell 5.1 should work but has not been tested.
- **The installer is not code-signed**, so Windows shows a one-time warning.
- **Programs do not survive a Windows restart** (no app can). Tabs, names and logs do.
- **Notifications and the live clock need the window open.** In Daemon mode the programs keep running when it is closed, but "Notify when done" is cleared.
- **Admin is a separate workspace**, not a per-tab switch.
- **Life, Engine and Faith are one at a time.** Choosing one turns the others off.

## Roadmap

- A distinct installer icon, single-instance focus, remember window size and position
- A tray icon in Daemon mode showing what is still running
- Code signing for the installer
- A lightweight native background service to cut idle memory, and possibly a lighter window toolkit
- More built-in level recipes (npm, dotnet, Airflow) and more faith and theme styles

## FAQ

Twenty questions, including why PowerShell is stronger than most people think. The same list is in the app under Settings, FAQ.

<details>
<summary><b>1. What is Bryt Shell?</b></summary>

Bryt Shell is a tabbed PowerShell terminal for Windows that remembers your work. Every tab has a name, keeps its full history on disk, and can keep running in the background after you close the window. Optional status lights, a test tube and a running-engine display show you what is happening at a glance.

</details>

<details>
<summary><b>2. Why use it instead of the normal PowerShell window?</b></summary>

A normal window forgets everything when you close it or restart the PC. Bryt Shell restores your tabs, names and history, shows which tab failed, can start commands for you, and lets long jobs keep running when the window is closed.

</details>

<details>
<summary><b>3. Is my data sent anywhere?</b></summary>

No. Bryt Shell makes no network connections of its own and has no accounts or telemetry. Your logs stay on your PC. In Daemon mode the window and the background service talk over a private local pipe that only accepts a random token stored in your profile folder.

</details>

<details>
<summary><b>4. Where are my logs and settings stored?</b></summary>

In `%APPDATA%\Bryt Shell`. Normal tabs live in the `user` folder and the administrator workspace in `admin`. Each tab's log is a `.log` file in its `logs` folder, and `recipes.json` sits next to them. Appearance choices are kept inside the app.

</details>

<details>
<summary><b>5. What happens to my tabs when I restart the PC?</b></summary>

Windows ends every program at a restart, and no app can prevent that. What you get back is every tab, its name and its full history. Tabs that have a Startup command run it again, and with Start at login (installed app, Daemon mode) they can start by themselves before you even open the window.

</details>

<details>
<summary><b>6. What is the difference between Daemon mode and Closes with window?</b></summary>

In **Closes with window**, programs stop when you close the window and nothing runs in the background. In **Daemon** mode a small background service owns your terminals, so programs keep running after you close the window and you reattach when you reopen it. Change it any time from the Mode chip at the top (Change mode) or in Settings, General.

</details>

<details>
<summary><b>7. Will Daemon mode slow my PC?</b></summary>

The background service is idle and light, and it quits by itself after 5 minutes if no window is open and nothing is running. Programs you leave running use their own CPU, so Bryt Shell asks what to do each time you close the window. The engine and other animations pause when the window is hidden.

</details>

<details>
<summary><b>8. How do I name, rename or delete a tab?</b></summary>

Click **+** and type a name. Double-click a tab to rename it. Click the **×** on a tab to delete it; its saved log is deleted too, after you confirm.

</details>

<details>
<summary><b>9. How do I run a command automatically when a tab starts?</b></summary>

Click **Startup command**, type the command (for example `docker compose up`) and press OK. It runs whenever that tab's shell starts, including after a restart. In the installed app with Daemon mode, Settings, General, Start at login runs those tabs silently when you sign in.

</details>

<details>
<summary><b>10. How do I run as administrator?</b></summary>

Click **Run as admin** and accept the Windows permission prompt. Bryt Shell reopens as administrator with its own separate tabs and logs, so elevated sessions never mix with normal ones.

</details>

<details>
<summary><b>11. What do the lights, the test tube and the faces mean?</b></summary>

Choose Life in the top bar (or in Settings, Life). Life, Engine and Faith are one-at-a-time experiences, so choosing one turns the others off. The traffic light covers all tabs: red if any tab failed, orange if any is running, green if all finished fine. The test tube shows the active tab: it fills as the command runs, turns green on success and red with a pin where it failed. The faces are a smile when idle, a thinking face while running, happy on success, crying on failure, and neutral when you stopped it yourself with Ctrl+C. A command you stop yourself is never counted as an error.

</details>

<details>
<summary><b>12. How does Bryt Shell know a command failed?</b></summary>

At each prompt PowerShell knows whether the last command succeeded. Bryt Shell starts every shell with a small wrapper that prints standard OSC 133 marks when a command starts and finishes, including that success flag, and reads them. Your own prompt (for example oh-my-posh) keeps working.

</details>

<details>
<summary><b>13. How do I teach the test tube my own commands?</b></summary>

Settings, Life, **Edit level recipes** opens `recipes.json`. A recipe has a `match` pattern for the command and a list of levels, each with an `on` pattern that is looked for in the output. A level counts as reached the first time its pattern appears. Unknown commands show a steady tube and turn green or red when they finish.

</details>

<details>
<summary><b>14. Why is PowerShell stronger than most people think? (objects, not text)</b></summary>

PowerShell's pipeline passes live .NET objects, not plain text. `Get-Process | Where-Object CPU -gt 100 | Sort-Object CPU -Descending | Select-Object -First 5 Name, CPU` filters and sorts by real properties, with no text parsing and no fragile column cutting.

</details>

<details>
<summary><b>15. Can PowerShell manage other computers?</b></summary>

Yes. `Invoke-Command -ComputerName server01 -ScriptBlock { Get-Service }` runs commands on another machine (PowerShell remoting), and PowerShell 7 can also remote over SSH with `Enter-PSSession -HostName`. One script can manage many machines at once.

</details>

<details>
<summary><b>16. Can PowerShell use the whole .NET platform?</b></summary>

Yes. Any .NET class is available: `[System.IO.Path]::GetTempPath()`, `[guid]::NewGuid()`, `[Math]::Round(3.14159, 2)`, and `Add-Type` can even compile C# on the fly. That is why PowerShell can do jobs other shells need extra tools for.

</details>

<details>
<summary><b>17. Can PowerShell work with web APIs and data files?</b></summary>

Yes. `Invoke-RestMethod https://api.example.com/items` returns objects already parsed from JSON, `ConvertFrom-Json` and `ConvertTo-Json` convert data, and `Import-Csv` and `Export-Csv` read and write CSV files. Pipe the results straight into other commands.

</details>

<details>
<summary><b>18. Can PowerShell run work in parallel or in the background?</b></summary>

Yes. `Start-Job` runs work in the background, and PowerShell 7 adds `ForEach-Object -Parallel` and `Start-ThreadJob`, for example `1..20 | ForEach-Object -Parallel { $_ * 2 } -ThrottleLimit 5`.

</details>

<details>
<summary><b>19. How do I find commands and learn what they do?</b></summary>

`Get-Command *service*` finds commands, `Get-Help Get-Service -Examples` shows examples, and `Get-Member` shows every property and method of whatever is in the pipeline. Commands follow a Verb-Noun pattern, so they are consistent and guessable. Run `Update-Help` once to download the full help.

</details>

<details>
<summary><b>20. What else makes PowerShell strong for real projects?</b></summary>

Modules and the PowerShell Gallery (`Install-Module`), safe scripting features (functions with typed, validated parameters, `try/catch/finally`, and `-WhatIf` and `-Confirm` for risky commands), and it runs on Windows, Linux and macOS in PowerShell 7. Bryt Shell uses PowerShell 7 when it is installed and falls back to Windows PowerShell 5.1, and your profile still loads.

</details>

## Support

Questions, problems or a correction to a verse? Write to **[muhumuzabright26@gmail.com](mailto:muhumuzabright26@gmail.com)**. In the app, Settings, Support opens a pre-filled email and copies your system details (version, mode, shell and Windows build; no logs and no personal data).

## Credits

[Electron](https://www.electronjs.org/), [xterm.js](https://xtermjs.org/), [@lydell/node-pty](https://github.com/lydell/node-pty) (a prebuilt fork of Microsoft's node-pty), [electron-builder](https://www.electron.build/), [resedit](https://github.com/jet2jet/resedit-js), [Feather icons](https://feathericons.com/) (the settings gear, MIT) and [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji) (MIT, see `THIRD-PARTY-NOTICES.txt`; the devil emoji is recolored from purple to red). King James Bible text is in the public domain.

## License

Not yet chosen. Until a `LICENSE` file is added, all rights are reserved by BrytMa Tech Uganda. The bundled emoji artwork is MIT-licensed by Microsoft (see `THIRD-PARTY-NOTICES.txt`).

---

<p align="center"><sub>Built in Uganda by BrytMa Tech Uganda</sub></p>
