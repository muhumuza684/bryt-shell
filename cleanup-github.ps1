<#
  Tidy up GitHub: delete OLD releases (and their tags) and OLD build runs.

  Deleting a build run also deletes the ~70 MB installer file it kept as a "build artifact".
  It ALWAYS keeps the newest release (the one people download) and the newest build run(s).

  Needs the GitHub command-line tool (one time):
      winget install --id GitHub.cli -e        then open a NEW PowerShell window, and run:
      gh auth login                            (choose GitHub.com, HTTPS, "Login with a web browser")

  Usage:
      .\cleanup-github.ps1 -DryRun       show exactly what would be deleted, change nothing
      .\cleanup-github.ps1               shows the list, then asks you to type DELETE
  Options:
      -Repo owner/name   (default: muhumuza684/bryt-shell)
      -KeepRuns N        how many of the newest build runs to keep (default: 1)
      -Yes               do not ask (for scripts)

  Deleted releases cannot be restored. Your code and history stay on GitHub.
#>
param(
  [switch]$DryRun,
  [switch]$Yes,
  [string]$Repo = 'muhumuza684/bryt-shell',
  [int]$KeepRuns = 1
)
$ErrorActionPreference = 'Stop'
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }

# --- is the GitHub CLI there and signed in? ---
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "The GitHub command-line tool (gh) is not installed. Install it with:  winget install --id GitHub.cli -e  then open a NEW PowerShell window, run:  gh auth login  and try again."
}
& gh auth status *> $null
if ($LASTEXITCODE -ne 0) { throw "You are not signed in to GitHub. Run:  gh auth login  (GitHub.com, HTTPS, 'Login with a web browser'), then run this again." }

Say "Cleaning up $Repo" 'Green'
if ($DryRun) { Say '(dry run: nothing will be deleted)' 'Yellow' }

# --- what exists? ---
$rel = @(& gh release list --repo $Repo --limit 200 --json 'tagName,isLatest,isDraft,isPrerelease,createdAt' | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { throw 'Could not list the releases.' }
$keepRel = $rel | Where-Object { $_.isLatest } | Select-Object -First 1
if (-not $keepRel) { $keepRel = $rel | Sort-Object createdAt -Descending | Select-Object -First 1 }
$oldRel = @($rel | Where-Object { $keepRel -and $_.tagName -ne $keepRel.tagName })

$tagRefs = @(& gh api "repos/$Repo/git/matching-refs/tags/" --paginate --jq '.[].ref')
$allTags = @($tagRefs | ForEach-Object { $_ -replace '^refs/tags/', '' } | Where-Object { $_ })
$relTags = @($rel | ForEach-Object { $_.tagName })
$strayTags = @($allTags | Where-Object { (-not $keepRel -or $_ -ne $keepRel.tagName) -and ($relTags -notcontains $_) })

$runs = @(& gh run list --repo $Repo --limit 300 --json 'databaseId,status,conclusion,createdAt,displayTitle' | ConvertFrom-Json | Sort-Object createdAt -Descending)
$oldRuns = @($runs | Select-Object -Skip $KeepRuns | Where-Object { $_.status -eq 'completed' })

# --- show the plan ---
Say ''
if ($keepRel) { Say "KEEPING the newest release: $($keepRel.tagName)" 'Green' } else { Say 'No releases found.' }
Say "Old releases to delete (with their tags): $($oldRel.Count)"
$oldRel | ForEach-Object { Say "   $($_.tagName)" }
Say "Tags without a release to delete: $($strayTags.Count)"
$strayTags | ForEach-Object { Say "   $_" }
Say "KEEPING the newest $KeepRuns build run(s). Old build runs to delete: $($oldRuns.Count)"
$oldRuns | Select-Object -First 8 | ForEach-Object { Say "   run $($_.databaseId): $($_.displayTitle) ($($_.conclusion))" }
if ($oldRuns.Count -gt 8) { Say "   ... and $($oldRuns.Count - 8) more" }

$total = $oldRel.Count + $strayTags.Count + $oldRuns.Count
if ($total -eq 0) { Say ''; Say 'Nothing to delete. GitHub is already tidy.' 'Green'; exit 0 }
if ($DryRun) { Say ''; Say '(dry run: nothing was deleted)' 'Yellow'; exit 0 }

if (-not $Yes) {
  Say ''
  $a = Read-Host "Type DELETE to remove these $total item(s) (anything else cancels)"
  if ($a -cne 'DELETE') { Say 'Cancelled. Nothing was deleted.' 'Yellow'; exit 0 }
}

# --- delete ---
$failed = 0
foreach ($r in $oldRel) {
  & gh release delete $r.tagName --repo $Repo --cleanup-tag --yes *> $null
  if ($LASTEXITCODE -eq 0) { Say "  deleted release $($r.tagName)" } else { $failed++; Say "  FAILED to delete release $($r.tagName)" 'Red' }
}
foreach ($t in $strayTags) {
  & gh api -X DELETE "repos/$Repo/git/refs/tags/$t" *> $null
  if ($LASTEXITCODE -eq 0) { Say "  deleted tag $t" } else { $failed++; Say "  FAILED to delete tag $t" 'Red' }
}
foreach ($u in $oldRuns) {
  & gh run delete $u.databaseId --repo $Repo *> $null
  if ($LASTEXITCODE -ne 0) { $failed++; Say "  FAILED to delete run $($u.databaseId)" 'Red' }
}
if ($oldRuns.Count -gt 0) { Say "  deleted $($oldRuns.Count - [Math]::Min($failed, $oldRuns.Count)) old build run(s) and their artifacts" }
Say ''
if ($failed -eq 0) { Say 'Done. GitHub is tidy.' 'Green' } else { Say "Done, but $failed item(s) could not be deleted (see the red lines above)." 'Yellow' }
