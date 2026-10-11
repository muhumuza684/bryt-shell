<#
  Publish a new version of Bryt Shell.

  1. Set the version in package.json (for example:  npm version patch --no-git-tag-version)
  2. Commit your work:  git add . ; git commit -m "Bryt Shell v2.8.1"
  3. Run:  .\release.ps1

  It creates the tag for the version in package.json and pushes it. GitHub then builds the installer
  and publishes it at  https://github.com/muhumuza684/bryt-shell/releases/latest

  -DryRun   show what it would do, change nothing
#>
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }

if (-not (Test-Path 'package.json')) { throw 'Run this from the Bryt Shell project folder.' }
$pkg = Get-Content 'package.json' -Raw | ConvertFrom-Json
if ($pkg.name -ne 'brytma-shell') { throw "This folder is '$($pkg.name)', not Bryt Shell." }
$tag = "v$($pkg.version)"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git is not installed or not on your PATH.' }
if (-not (Test-Path '.git')) { throw 'This folder is not a git repository yet. Run: git init ; git remote add origin https://github.com/muhumuza684/bryt-shell.git' }

Say "Releasing Bryt Shell $($pkg.version)  (tag $tag)" 'Green'
$dirty = @(git status --porcelain)
if ($dirty.Count -gt 0) { throw "You have uncommitted changes. Commit them first:`n  git add . ; git commit -m `"Bryt Shell $tag`"" }
if (@(git tag --list $tag).Count -gt 0) { throw "The tag $tag already exists. Raise the version in package.json first (npm version patch --no-git-tag-version), commit, then run this again." }

Say '  will run:  git push'
Say "  will run:  git tag $tag"
Say "  will run:  git push origin $tag"
if ($DryRun) { Say '(dry run: nothing was changed)' 'Yellow'; exit 0 }

git push;                    if ($LASTEXITCODE -ne 0) { throw 'git push failed (is a remote and branch set up?). Nothing was tagged.' }
git tag $tag;                if ($LASTEXITCODE -ne 0) { throw 'git tag failed.' }
git push origin $tag;        if ($LASTEXITCODE -ne 0) { throw 'pushing the tag failed.' }
Say ''
Say 'Pushed. GitHub is now building the installer (about 3 to 6 minutes).' 'Green'
Say '  Watch it:   https://github.com/muhumuza684/bryt-shell/actions'
Say "  Download:   https://github.com/muhumuza684/bryt-shell/releases/tag/$tag"
