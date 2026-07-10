# Registers one Windows Scheduled Task PER enabled channel. Each task fires
# 1 HOUR BEFORE that channel's uploadTime, so the video renders and uploads with
# a scheduled release at the channel's peak-viewership time.
#
#   Enable:  powershell -ExecutionPolicy Bypass -File pipeline\install-schedule.ps1
#   Disable one:  Unregister-ScheduledTask -TaskName "InferenceDaily-<id>" -Confirm:$false
#   List:  Get-ScheduledTask -TaskName "InferenceDaily-*"
#
# Re-run this any time you add/change a channel or its uploadTime.

$ErrorActionPreference = "Stop"
$proj = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $proj "pipeline\run-daily.ps1"

$cfg = Get-Content (Join-Path $proj "pipeline\channels.json") -Raw | ConvertFrom-Json
$channels = @($cfg | Where-Object { $_.enabled -ne $false })
if (-not $channels) { Write-Host "No enabled channels in channels.json."; exit 0 }

# remove stale tasks first (cleans up disabled/renamed channels)
Get-ScheduledTask -TaskName "InferenceDaily-*" -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue
Get-ScheduledTask -TaskName "InferenceDaily" -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue

foreach ($ch in $channels) {
  $id = $ch.id
  $uploadTime = if ($ch.uploadTime) { $ch.uploadTime } else { "19:30" }
  # render trigger: explicit renderTime (e.g. idle morning) if set, else uploadTime - 1h
  if ($ch.renderTime) {
    $at = $ch.renderTime
  } else {
    $p = $uploadTime -split ":"
    $render = (Get-Date).Date.AddHours([int]$p[0]).AddMinutes([int]$p[1]).AddHours(-1)
    $at = $render.ToString("HH:mm")
  }

  $arg = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $runner + '" -Channel ' + $id
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg
  $trigger = New-ScheduledTaskTrigger -Daily -At $at
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10) -ExecutionTimeLimit (New-TimeSpan -Hours 2) -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries

  Register-ScheduledTask -TaskName "InferenceDaily-$id" -Action $action -Trigger $trigger -Settings $settings -Description ("The Inference channel " + $id + ": render " + $at + ", upload " + $uploadTime) -Force | Out-Null
  Write-Host ("  {0,-24} render {1}  ->  upload {2}" -f $id, $at, $uploadTime)
}

Write-Host ("Scheduled {0} channel task(s). List: Get-ScheduledTask -TaskName 'InferenceDaily-*'" -f $channels.Count)
