# Daily runner for "The Inference" channels. Waits for internet, then generates +
# renders + uploads. Logs to out/daily-<date>.log. Invoked by the scheduled tasks
# (see install-schedule.ps1); safe to run by hand.
#
#   .\run-daily.ps1                 # all enabled channels, upload immediately
#   .\run-daily.ps1 -Channel <id>   # one channel, upload SCHEDULED for its peak time
#
# Each per-channel scheduled task fires 1 hour before that channel's uploadTime and
# passes --at=<uploadTime in UTC> so YouTube releases the video at the peak time.
param([string]$Channel = "")

$ErrorActionPreference = "Stop"
$proj = Split-Path -Parent $PSScriptRoot   # repo root (pipeline/ -> ..)
Set-Location $proj

$stamp = Get-Date -Format "yyyy-MM-dd_HHmm"
$log = Join-Path $proj "out\daily-$stamp.log"
New-Item -ItemType Directory -Force -Path (Join-Path $proj "out") | Out-Null

function Log($msg) {
  $line = "$(Get-Date -Format o)  $msg"
  $line | Tee-Object -FilePath $log -Append
}

# today's HH:MM (local) as an RFC3339 UTC instant; "" if it already passed
function Get-PublishIso($hhmm) {
  try {
    $p = $hhmm -split ":"
    $dt = (Get-Date).Date.AddHours([int]$p[0]).AddMinutes([int]$p[1])
    if ($dt -lt (Get-Date)) { return "" }
    return $dt.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  } catch { return "" }
}

# Wait for network (handles laptop-asleep / no-wifi-yet at trigger time). ~30 min.
$online = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "https://www.googleapis.com/discovery/v1/apis" -UseBasicParsing -TimeoutSec 8
    if ($r.StatusCode -ge 200) { $online = $true; break }
  } catch {
    Log "no network yet (try $($i+1)) -waiting 30s"
    Start-Sleep -Seconds 30
  }
}
if (-not $online) { Log "ERROR: still offline after waiting -aborting"; exit 1 }
Log "network OK"

# free storage: delete rendered media older than 3 days (already on YouTube).
# Non-fatal: cleanup problems must never abort the actual video run.
try { & node pipeline/cleanup.mjs 2>&1 | Tee-Object -FilePath $log -Append } catch { Log "cleanup skipped: $($_.Exception.Message)" }

# figure out which channels to run
$cfg = @()
try { $cfg = Get-Content (Join-Path $proj "pipeline\channels.json") -Raw | ConvertFrom-Json } catch {}
if ($Channel) {
  $targets = @($cfg | Where-Object { $_.id -eq $Channel })
  if (-not $targets) { $targets = @([pscustomobject]@{ id = $Channel; uploadTime = "" }) }
} else {
  $targets = @($cfg | Where-Object { $_.enabled -ne $false })
  if (-not $targets) { $targets = @([pscustomobject]@{ id = "the-inference"; uploadTime = "" }) }
}

$fail = 0
foreach ($ch in $targets) {
  $id = $ch.id
  # skip channels with no YouTube token (authorize them first) to avoid wasted renders
  $tokenCh = Join-Path $proj ("pipeline\channels\" + $id + "\youtube.token.json")
  $tokenLegacy = Join-Path $proj "pipeline\youtube.token.json"
  $hasToken = (Test-Path $tokenCh) -or ($id -eq "the-inference" -and (Test-Path $tokenLegacy))
  if (-not $hasToken) { Log "channel '$id' not authorized - skipping (run: npm run yt-auth -- --channel=$id)"; continue }
  # for a scheduled single-channel run, publish at the channel's peak time
  $iso = if ($Channel -and $ch.uploadTime) { Get-PublishIso $ch.uploadTime } else { "" }
  $npmArgs = @("run", "daily-upload", "--", "--channel=$id")
  if ($iso) { $npmArgs += "--at=$iso"; Log "=== $id === (scheduled release $iso)" }
  else { Log "=== $id === (upload immediately)" }
  # npm.cmd so PATH/extension resolve under Task Scheduler's non-interactive shell
  & npm.cmd @npmArgs 2>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { $fail = 1; Log "channel '$id' FAILED (exit $LASTEXITCODE)" }
  else { Log "channel '$id' done" }
}
Log "run finished (fail=$fail)"
exit $fail
