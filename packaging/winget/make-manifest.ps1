<#
Makes the winget manifest files for a Bryt Shell release, so people can run:  winget install BrytMaTech.BrytShell
Usage (after the GitHub release for that version exists):
    .\make-manifest.ps1 -Version 2.10.0
It downloads the installer from the release, calculates its SHA256, and writes three files into
.\manifests\<version>\ . Check them, then follow README.md in this folder to submit them to winget-pkgs.
#>
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Repo = 'muhumuza684/bryt-shell'
)
$ErrorActionPreference = 'Stop'
$id   = 'BrytMaTech.BrytShell'
$url  = "https://github.com/$Repo/releases/download/v$Version/Bryt-Shell-Setup.exe"
$tmp  = Join-Path $env:TEMP "Bryt-Shell-Setup-$Version.exe"
Write-Host "Downloading $url"
Invoke-WebRequest -Uri $url -OutFile $tmp
$sha  = (Get-FileHash -Path $tmp -Algorithm SHA256).Hash.ToUpper()
$date = Get-Date -Format 'yyyy-MM-dd'
$out  = Join-Path $PSScriptRoot "manifests\$Version"
New-Item -ItemType Directory -Path $out -Force | Out-Null

$versionYaml = @"
PackageIdentifier: $id
PackageVersion: $Version
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.6.0
"@
$installerYaml = @"
PackageIdentifier: $id
PackageVersion: $Version
InstallerType: nullsoft
Scope: user
InstallerSwitches:
  Silent: /S
  SilentWithProgress: /S
Installers:
- Architecture: x64
  InstallerUrl: $url
  InstallerSha256: $sha
ReleaseDate: $date
ManifestType: installer
ManifestVersion: 1.6.0
"@
$localeYaml = @"
PackageIdentifier: $id
PackageVersion: $Version
PackageLocale: en-US
Publisher: BrytMa Tech Uganda
PublisherUrl: https://muhumuza684.github.io/bryt-shell/
PackageName: Bryt Shell
PackageUrl: https://github.com/$Repo
ShortDescription: A tabbed, persistent PowerShell terminal for Windows that AI apps can use through MCP.
Description: Bryt Shell keeps named PowerShell tabs alive, shows live status for every command, and lets AI apps you trust (Claude Desktop, Claude Code, Cursor, VS Code) open tabs, run commands, create projects and read or write files, with approvals and a Stop button. Free, local-first, no telemetry.
Tags:
- powershell
- terminal
- mcp
- ai
- windows
ReleaseNotesUrl: https://github.com/$Repo/releases/tag/v$Version
ManifestType: defaultLocale
ManifestVersion: 1.6.0
"@
Set-Content -Path (Join-Path $out "$id.yaml") -Value $versionYaml -Encoding UTF8
Set-Content -Path (Join-Path $out "$id.installer.yaml") -Value $installerYaml -Encoding UTF8
Set-Content -Path (Join-Path $out "$id.locale.en-US.yaml") -Value $localeYaml -Encoding UTF8
Write-Host "Done. Files are in $out"
Write-Host "Next: winget validate --manifest `"$out`"   (then see README.md in this folder)"
