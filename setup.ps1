# One-command setup for a fresh PC (Windows). Safe to re-run (idempotent).
#
#   powershell -ExecutionPolicy Bypass -File setup.ps1
#   ...or:  npm run setup
#
# Does: npm install, recreate the Kokoro voice venv + model, fetch fonts,
# report which API keys / YouTube authorizations are still needed, and install
# the daily schedule. Skip parts with -SkipKokoro / -SkipSchedule.
param([switch]$SkipKokoro, [switch]$SkipSchedule)

$ErrorActionPreference = "Stop"
$proj = $PSScriptRoot
Set-Location $proj

function Step($m) { Write-Host "`n== $m ==" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  [ok]  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [!]   $m" -ForegroundColor Yellow }
function Bad($m)  { Write-Host "  [x]   $m" -ForegroundColor Red }

# --- Node -------------------------------------------------------------------
Step "Node.js"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Bad "Node.js not found. Install v20+ from https://nodejs.org then re-run."
  exit 1
}
Ok ("node " + (node --version))

# --- npm install ------------------------------------------------------------
Step "Installing dependencies (npm install)"
npm install
if ($LASTEXITCODE -ne 0) { Bad "npm install failed"; exit 1 }
Ok "node_modules ready"

# --- Kokoro local TTS (optional) --------------------------------------------
if (-not $SkipKokoro) {
  Step "Kokoro local TTS (optional; Edge TTS works without it)"
  $venv = Join-Path $proj "pipeline\.venv-tts"
  $venvPy = Join-Path $venv "Scripts\python.exe"
  $pyCmd = if (Get-Command py -ErrorAction SilentlyContinue) { "py" }
           elseif (Get-Command python -ErrorAction SilentlyContinue) { "python" }
           else { $null }
  if (-not $pyCmd) {
    Warn "Python not found - skipping Kokoro (local cloned/offline voice). Edge TTS still works."
  } else {
    try {
      if (-not (Test-Path $venvPy)) { & $pyCmd -m venv $venv; Ok "created venv" } else { Ok "venv exists" }
      & $venvPy -m pip install --quiet --upgrade pip kokoro-onnx soundfile numpy
      Ok "kokoro-onnx installed"
      $kdir = Join-Path $proj "pipeline\kokoro"
      New-Item -ItemType Directory -Force -Path $kdir | Out-Null
      $rel = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
      foreach ($f in @("kokoro-v1.0.onnx", "voices-v1.0.bin")) {
        $dest = Join-Path $kdir $f
        if (Test-Path $dest) { Ok "$f present" }
        else { Write-Host "  downloading $f ..."; Invoke-WebRequest "$rel/$f" -OutFile $dest -UseBasicParsing; Ok "$f downloaded" }
      }
    } catch { Warn ("Kokoro setup failed (" + $_.Exception.Message + ") - Edge TTS still works.") }
  }
}

# --- Fonts ------------------------------------------------------------------
Step "Fonts"
if (Test-Path (Join-Path $proj "public\fonts\Poppins-400.woff2")) { Ok "fonts present" }
else { npm run fonts; if ($LASTEXITCODE -eq 0) { Ok "fonts fetched" } else { Warn "font fetch failed - re-run 'npm run fonts' with internet" } }

# --- Keys -------------------------------------------------------------------
Step "API keys (add any missing files under pipeline\)"
function KeyCheck($file, $need, $what) {
  if (Test-Path (Join-Path $proj ("pipeline\" + $file))) { Ok ($file + " - " + $what) }
  elseif ($need) { Bad ($file + " MISSING (required) - " + $what) }
  else { Warn ($file + " missing (optional) - " + $what) }
}
KeyCheck "nemotron.key" $true  "script generation"
KeyCheck "gemini.key"   $false "Kannada translation"
KeyCheck "pexels.key"   $false "B-roll footage"
KeyCheck "tavily.key"   $false "research grounding"
KeyCheck "youtube.client.json" $false "YouTube upload (OAuth client)"

# --- Per-channel YouTube (client + token) ----------------------------------
Step "Channels: YouTube client + authorization"
try {
  $cfg = Get-Content (Join-Path $proj "pipeline\channels.json") -Raw | ConvertFrom-Json
  foreach ($ch in @($cfg)) {
    $cli = Join-Path $proj ("pipeline\channels\" + $ch.id + "\youtube.client.json")
    $tok = Join-Path $proj ("pipeline\channels\" + $ch.id + "\youtube.token.json")
    $legacyC = Join-Path $proj "pipeline\youtube.client.json"
    $legacyT = Join-Path $proj "pipeline\youtube.token.json"
    $hasClient = (Test-Path $cli) -or (Test-Path $legacyC)
    $hasTok = (Test-Path $tok) -or ($ch.id -eq "the-inference" -and (Test-Path $legacyT))
    $label = "$($ch.name) [$($ch.id)]"
    if ($hasTok) { Ok "$label - authorized" }
    elseif ($hasClient) { Warn "$label - has client, NOT authorized: npm run yt-auth -- --channel=$($ch.id)" }
    else { Bad "$label - no OAuth client: add pipeline\channels\$($ch.id)\youtube.client.json, then authorize" }
  }
} catch { Warn "could not read channels.json" }

# --- Schedule ---------------------------------------------------------------
if (-not $SkipSchedule) {
  Step "Installing daily schedule"
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $proj "pipeline\install-schedule.ps1")
}

Write-Host "`nSetup done." -ForegroundColor Green
Write-Host "Next: add any MISSING keys above, authorize each channel, then open the dashboard: npm run dashboard"
