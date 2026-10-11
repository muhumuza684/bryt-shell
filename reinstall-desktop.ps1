<#
  Bryt Shell: replace the installed desktop app with a fresh build of this folder.

  Run it from the Bryt Shell project folder:
      .\reinstall-desktop.ps1           (or double-click reinstall-desktop.bat)

  What it does, in order:
    1. stops every running copy of Bryt Shell (including the background service)
    2. uninstalls the OLD installed desktop app and removes its shortcuts
    3. builds a NEW installer with "npm run dist"
    4. opens the new installer so you can install it

  Your tabs, logs and settings (%APPDATA%\Bryt Shell) are KEPT.
  Options:  -DryRun   show what would happen, change nothing
            -SkipBuild  reuse the installer already in the dist folder
            -ShortcutOnly  do NOT reinstall: just repair the desktop and Start menu shortcuts so they
                           open the installed copy, and refresh the icons
#>
param([switch]$DryRun, [switch]$SkipBuild, [switch]$ShortcutOnly)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Step($n, $m) { Write-Host ""; Write-Host "[$n/4] $m" -ForegroundColor Cyan }
function Act($what, [scriptblock]$do) { if ($DryRun) { Say "  (dry run) would: $what" 'Yellow' } else { Say "  $what"; & $do } }

# --- are we in the right folder? ---
$pkgPath = Join-Path $root 'package.json'
if (-not (Test-Path $pkgPath)) { throw 'package.json not found. Run this from the Bryt Shell project folder (for example D:\brytma-shell).' }
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
if ($pkg.name -ne 'brytma-shell') { throw "This folder is '$($pkg.name)', not Bryt Shell. Nothing was changed." }
Say "Bryt Shell $($pkg.version): replace the installed desktop app" 'Green'
if ($DryRun) { Say '(dry run: nothing will be changed)' 'Yellow' }

# --- shortcut repair mode: point the shortcuts at the installed copy and refresh the icons ---
if ($ShortcutOnly) {
  $uk = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
  $cands = @()
  foreach ($k in $uk) { try { foreach ($i in @(Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Bryt Shell' })) { if ($i.InstallLocation) { $cands += (Join-Path $i.InstallLocation 'Bryt Shell.exe') } } } catch { } }
  if ($env:ProgramFiles) { $cands += (Join-Path $env:ProgramFiles 'Bryt Shell\Bryt Shell.exe') }
  if ($env:LOCALAPPDATA) { $cands += (Join-Path $env:LOCALAPPDATA 'Programs\Bryt Shell\Bryt Shell.exe') }
  $exe = $cands | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if (-not $exe) { throw 'Bryt Shell is not installed. Run .\reinstall-desktop.ps1 (without -ShortcutOnly) to build and install it.' }
  Say "Installed copy: $exe  (version $((Get-Item $exe).VersionInfo.ProductVersion))" 'Green'
  $dirs = @{ 'Desktop' = [Environment]::GetFolderPath('Desktop'); 'Start menu' = [Environment]::GetFolderPath('Programs') }
  foreach ($name in $dirs.Keys) {
    $dir = $dirs[$name]; if (-not $dir) { continue }
    $lnkPath = Join-Path $dir 'Bryt Shell.lnk'
    Act "$name shortcut -> $exe" {
      $sh = New-Object -ComObject WScript.Shell
      $l = $sh.CreateShortcut($lnkPath)
      $l.TargetPath = $exe; $l.WorkingDirectory = (Split-Path $exe -Parent); $l.IconLocation = "$exe,0"; $l.Description = 'Bryt Shell'
      $l.Save()
    }
  }
  Act 'refresh the Windows icon cache' { try { & "$env:SystemRoot\System32\ie4uinit.exe" -show } catch { } }
  Say ''; Say 'Done. The shortcuts now open the installed Bryt Shell. If an old icon still shows, sign out and back in once.' 'Green'
  exit 0
}

# --- 1. stop every running copy ---
Step 1 'Stopping Bryt Shell'
$running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq 'Bryt Shell' })
$dev = @(Get-Process -Name electron -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -like "$root*" } catch { $false } })
$all = @($running) + @($dev)
if ($all.Count -eq 0) { Say '  nothing is running' } else {
  Act "stop $($all.Count) process(es): $((($all | ForEach-Object { $_.ProcessName + ' ' + $_.Id }) -join ', '))" {
    $all | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 1500
  }
}

# --- 2. remove the old installed app ---
Step 2 'Removing the old installed desktop app'
$keys = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
$installed = @()
foreach ($k in $keys) {
  try { $installed += @(Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Bryt Shell' }) } catch { }
}
$uninstallers = @()
foreach ($i in $installed) {
  if ($i.UninstallString -match '^\s*"?([^"]+?\.exe)"?') { $uninstallers += $Matches[1] }
}
foreach ($base in @($env:ProgramFiles, $env:LOCALAPPDATA)) {
  if (-not $base) { continue }
  $cand = if ($base -eq $env:LOCALAPPDATA) { Join-Path $base 'Programs\Bryt Shell\Uninstall Bryt Shell.exe' } else { Join-Path $base 'Bryt Shell\Uninstall Bryt Shell.exe' }
  if (Test-Path $cand) { $uninstallers += $cand }
}
$uninstallers = @($uninstallers | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique)
if ($uninstallers.Count -eq 0) { Say '  no installed copy found (nothing to uninstall)' } else {
  foreach ($u in $uninstallers) {
    $dir = Split-Path $u -Parent
    $needsAdmin = ($dir -like "$env:ProgramFiles*") -or ($dir -like "${env:ProgramFiles(x86)}*")
    Act "uninstall the copy in $dir$(if ($needsAdmin) { ' (Windows will ask for permission)' })" {
      $args = "/S _?=$dir"          # _?= makes the uninstaller finish before this script continues
      if ($needsAdmin) { Start-Process -FilePath $u -ArgumentList $args -Verb RunAs -Wait } else { Start-Process -FilePath $u -ArgumentList $args -Wait }
      Start-Sleep -Milliseconds 800
      if (Test-Path $dir) { Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue }
    }
  }
}
# shortcuts left on the desktop and in the Start menu
$spots = @()
foreach ($f in 'Desktop', 'CommonDesktopDirectory', 'Programs', 'CommonPrograms') {
  try { $p = [Environment]::GetFolderPath($f); if ($p) { $spots += $p } } catch { }
}
foreach ($p in ($spots | Select-Object -Unique)) {
  foreach ($lnk in @(Get-ChildItem -Path $p -Filter 'Bryt Shell*.lnk' -ErrorAction SilentlyContinue)) {
    Act "remove the shortcut $($lnk.FullName)" { Remove-Item $lnk.FullName -Force -ErrorAction SilentlyContinue }
  }
}
Say '  your tabs, logs and settings in %APPDATA%\Bryt Shell are kept'

# --- 3. build the new installer ---
Step 3 'Building the new installer'
if ($SkipBuild) { Say '  skipped (-SkipBuild)' } else {
  Act 'npm install' { & npm install --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'npm install failed. Copy the error above and send it to Claude.' } }
  Act 'npm run dist  (the first time this downloads Electron, so it can take a few minutes)' { & npm run dist; if ($LASTEXITCODE -ne 0) { throw 'npm run dist failed. Copy the error above and send it to Claude.' } }
}

# --- 4. install the new one ---
Step 4 'Installing the new desktop app'
$installer = Get-ChildItem -Path (Join-Path $root 'dist') -Filter 'Bryt-Shell-Setup*.exe' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer) {
  if ($DryRun) { Say '  (dry run) the new installer would be opened here' 'Yellow' } else { throw 'No installer found in the dist folder. Run without -SkipBuild.' }
} else {
  Act "open $($installer.Name)" { Start-Process -FilePath $installer.FullName }
  Say ''
  Say '  If Windows says "Windows protected your PC", click More info, then Run anyway.' 'Yellow'
}
Write-Host ''
Say 'Done. Open Bryt Shell from the new desktop shortcut.' 'Green'
Say '  (if a shortcut still opens the old version, run:  .\reinstall-desktop.ps1 -ShortcutOnly)'
