<#
  First-time GitHub setup for Bryt Shell.

  Turns this folder into a git repository, connects it to your GitHub repository and pushes your code.
  Run it from the Bryt Shell project folder:

      .\setup-github.ps1

  It is SAFE: if GitHub already contains different work (for example a README created on github.com), it
  stops and explains your options instead of overwriting anything.

  Options:
    -DryRun       show what it would do, change nothing
    -Force        replace whatever is on GitHub with this folder (only if you are sure)
    -RemoteUrl    use a different repository address
                  (default: https://github.com/muhumuza684/bryt-shell.git)
    -Message      the commit message (default: "Bryt Shell v<version>")
    -Branch       the branch name (default: main)

  After it succeeds, publish the installer with:  .\release.ps1
#>
param(
  [switch]$DryRun,
  [switch]$Force,
  [string]$RemoteUrl = 'https://github.com/muhumuza684/bryt-shell.git',
  [string]$Message,
  [string]$Branch = 'main'
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Step($n, $m) { Write-Host ""; Write-Host "[$n/5] $m" -ForegroundColor Cyan }
function RunGit { & git @args; if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed (exit $LASTEXITCODE)." } }
function GitQuiet { $o = & git @args 2>$null; if ($LASTEXITCODE -ne 0) { return $null }; return $o }

# --- the right folder? ---
if (-not (Test-Path 'package.json')) { throw 'package.json not found. Run this from the Bryt Shell project folder (for example D:\brytma-shell).' }
$pkg = Get-Content 'package.json' -Raw | ConvertFrom-Json
if ($pkg.name -ne 'brytma-shell') { throw "This folder is '$($pkg.name)', not Bryt Shell. Nothing was changed." }
if (-not $Message) { $Message = "Bryt Shell v$($pkg.version)" }
Say "Bryt Shell $($pkg.version): first-time GitHub setup" 'Green'
if ($DryRun) { Say '(dry run: nothing will be changed)' 'Yellow' }

# --- 1. git and your identity ---
Step 1 'Checking git'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git is not installed. Install it with:  winget install --id Git.Git -e   then open a NEW PowerShell window and run this again.' }
Say "  $(& git --version)"
$name = (GitQuiet config user.name); $email = (GitQuiet config user.email)
if (-not $name -or -not $email) {
  Say '  git does not know who you are yet. Run these two lines once (use your own name and the email on your GitHub account):' 'Yellow'
  Say '      git config --global user.name  "Your Name"'
  Say '      git config --global user.email "you@example.com"'
  throw 'Set your git name and email, then run .\setup-github.ps1 again. Nothing was changed.'
}
Say "  commits will be made as: $name <$email>"

# --- 2. repository ---
Step 2 'Preparing the repository'
$isRepo = Test-Path '.git'
if ($isRepo) { Say '  this folder is already a git repository' } elseif ($DryRun) { Say "  (dry run) would: git init, branch $Branch" 'Yellow' } else {
  RunGit init | Out-Null
  RunGit symbolic-ref HEAD "refs/heads/$Branch"
  Say "  created a new repository on branch $Branch"
}
$remote = if ($isRepo) { GitQuiet remote get-url origin } else { $null }
if ($remote) { Say "  GitHub address (origin): $remote" } elseif ($DryRun) { Say "  (dry run) would: git remote add origin $RemoteUrl" 'Yellow'; $remote = $RemoteUrl } else {
  RunGit remote add origin $RemoteUrl; $remote = $RemoteUrl
  Say "  connected to $RemoteUrl"
}
if ($isRepo -and $remote -and ($remote -ne $RemoteUrl)) { Say "  note: origin is $remote (not $RemoteUrl). Using origin." 'Yellow' }

# --- 3. what is already on GitHub? ---
Step 3 'Looking at GitHub'
$remoteHeads = @()
if (-not $DryRun -or $isRepo) {
  $out = & git ls-remote --heads $remote 2>&1
  if ($LASTEXITCODE -ne 0) {
    Say "  could not read $remote" 'Red'
    Say '  Check: your internet, that you are signed in to GitHub (a sign-in window may open), and that the repository exists.'
    Say '  To create it: https://github.com/new  (name it bryt-shell, leave it EMPTY: no README, no license).'
    throw "Could not reach $remote. Nothing was pushed."
  }
  $remoteHeads = @($out | Where-Object { $_ -match 'refs/heads/' })
}
if ($remoteHeads.Count -eq 0) { Say '  the GitHub repository is empty: ready for your first push' } else { Say "  GitHub already has $($remoteHeads.Count) branch(es): $((($remoteHeads | ForEach-Object { ($_ -split 'refs/heads/')[1] }) -join ', '))" }

# --- 4. commit ---
Step 4 'Saving your files (commit)'
if ($DryRun) { Say "  (dry run) would: git add -A ; git commit -m `"$Message`"" 'Yellow' } else {
  RunGit add -A
  $tracked = @(& git ls-files)
  if (@($tracked | Where-Object { $_ -like 'node_modules/*' -or $_ -like 'dist/*' }).Count -gt 0) { Say '  warning: node_modules or dist is being tracked. Check your .gitignore.' 'Yellow' }
  $staged = @(& git diff --cached --name-only)
  $hasHead = ($null -ne (GitQuiet rev-parse --verify HEAD))
  if ($staged.Count -eq 0 -and $hasHead) { Say '  nothing new to commit' } else {
    RunGit commit -m $Message | Out-Null
    Say "  committed $($tracked.Count) files: $Message"
  }
}

# --- 5. push ---
Step 5 'Pushing to GitHub'
if ($DryRun) { Say "  (dry run) would: git push -u origin $Branch" 'Yellow'; Say ''; Say '(dry run: nothing was changed)' 'Yellow'; exit 0 }
$mayPush = $true
if ($remoteHeads.Count -gt 0) {
  & git fetch origin 2>&1 | Out-Null
  $hasRemoteBranch = @($remoteHeads | Where-Object { $_ -match "refs/heads/$([regex]::Escape($Branch))$" }).Count -gt 0
  if ($hasRemoteBranch) {
    & git merge-base --is-ancestor "origin/$Branch" HEAD 2>$null
    $mayPush = ($LASTEXITCODE -eq 0)    # GitHub's branch is already part of your history: a normal push is fine
  } else { $mayPush = $true }
  if (-not $mayPush -and -not $Force) {
    Say ''
    Say 'GitHub already contains work that is NOT in this folder (often a README created on github.com).' 'Yellow'
    Say 'Nothing was overwritten. Your options:'
    Say '  A) The GitHub copy is only the auto-created README/license and you do not need it:'
    Say '       .\setup-github.ps1 -Force          (replaces the GitHub copy with this folder)'
    Say '  B) You want to keep what is on GitHub and add your files on top:'
    Say "       git pull origin $Branch --allow-unrelated-histories     (fix any conflict it reports, commit)"
    Say '       .\setup-github.ps1'
    throw 'Stopped to protect the work already on GitHub.'
  }
}
if ($mayPush) { RunGit push -u origin $Branch } else { Say '  -Force given: replacing the GitHub copy with this folder' 'Yellow'; RunGit push -u origin $Branch --force-with-lease }
Say ''
Say 'Done. Your code is on GitHub:' 'Green'
Say "  $($remote -replace '\.git$','')"
Say ''
Say 'Next: publish the installer so people can download it:' 'Green'
Say '  .\release.ps1'
Say '  (then watch the build at the Actions tab of your repository; it takes about 3 to 6 minutes)'
