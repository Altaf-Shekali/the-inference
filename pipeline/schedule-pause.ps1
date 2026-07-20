# Pause or resume the LOCAL daily scheduled tasks (InferenceDaily-*).
# Use this when the pipeline runs in the cloud (GitHub Actions) so the local
# machine does not ALSO render + upload (which would double-post).
#
#   Pause (disable, keeps the tasks):
#     powershell -ExecutionPolicy Bypass -File pipeline\schedule-pause.ps1
#   Resume (re-enable):
#     powershell -ExecutionPolicy Bypass -File pipeline\schedule-pause.ps1 -Resume
#   Status:
#     Get-ScheduledTask -TaskName "InferenceDaily-*" | Select TaskName, State
#
# Run in PowerShell as Administrator (the tasks may be registered system-wide).
param([switch]$Resume)

$tasks = Get-ScheduledTask -TaskName "InferenceDaily-*" -ErrorAction SilentlyContinue
if (-not $tasks) {
  Write-Host "No 'InferenceDaily-*' tasks found on this machine - nothing to change."
  exit 0
}

if ($Resume) {
  $tasks | Enable-ScheduledTask | Out-Null
  Write-Host ("Resumed {0} local task(s) - they will run on schedule again." -f $tasks.Count)
} else {
  $tasks | Disable-ScheduledTask | Out-Null
  Write-Host ("Paused {0} local task(s) - disabled, so nothing renders/uploads locally." -f $tasks.Count)
  Write-Host "The cloud (GitHub Actions) keeps running. Resume anytime with -Resume."
}

Write-Host ""
Get-ScheduledTask -TaskName "InferenceDaily-*" | Select-Object TaskName, State | Format-Table -AutoSize
