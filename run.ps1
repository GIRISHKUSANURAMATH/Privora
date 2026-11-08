<#
.SYNOPSIS
  Start Umbra. By default the FastAPI backend serves the built UI at http://127.0.0.1:8000.

.PARAMETER Dev
  Run the backend and the Vite dev server (hot reload, http://127.0.0.1:5173) side by side.

.PARAMETER Port
  Backend port (default 8000).

.PARAMETER NoBrowser
  Do not open a browser window.
#>
param(
    [switch]$Dev,
    [int]$Port = 8000,
    [switch]$NoBrowser
)

. (Join-Path $PSScriptRoot 'scripts\common.ps1')
Set-Location $Script:Root

$venvPy = Get-VenvPython
if (-not (Test-Path $venvPy)) {
    Write-Fail 'Virtual environment not found. Run .\setup.ps1 first.'
    exit 1
}

$env:PPML_PORT = "$Port"
$env:PYTHONPATH = Join-Path $Script:Root 'backend'

if ($Dev) {
    Write-Step "Starting backend on http://127.0.0.1:$Port (background)"
    $backend = Start-Process -FilePath $venvPy -ArgumentList @('-m', 'uvicorn', 'ppml.main:create_app', '--factory', '--host', '127.0.0.1', '--port', "$Port", '--app-dir', 'backend') -PassThru -NoNewWindow
    try {
        Write-Step 'Starting Vite dev server on http://127.0.0.1:5173'
        if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:5173' | Out-Null }
        Push-Location (Join-Path $Script:Root 'frontend')
        & npm run dev
    } finally {
        Pop-Location
        if ($backend -and -not $backend.HasExited) { Stop-Process -Id $backend.Id -Force }
    }
    exit 0
}

if (-not (Test-Path (Join-Path $Script:Root 'frontend\dist\index.html'))) {
    Write-Step 'Frontend build not found - building it now'
    Push-Location (Join-Path $Script:Root 'frontend')
    try { Invoke-Checked 'npm' @('run', 'build') 'frontend build' } finally { Pop-Location }
}

Write-Step "Umbra is starting at http://127.0.0.1:$Port  (Ctrl+C to stop)"
Write-Info 'Binding to 127.0.0.1 only. The API has no authentication; do not expose it on a network.'
if (-not $NoBrowser) {
    Start-Job -ScriptBlock { param($u) Start-Sleep -Seconds 4; Start-Process $u } -ArgumentList "http://127.0.0.1:$Port" | Out-Null
}
& $venvPy -m uvicorn ppml.main:create_app --factory --host 127.0.0.1 --port $Port --app-dir backend
exit $LASTEXITCODE
