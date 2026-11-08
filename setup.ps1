<#
.SYNOPSIS
  One-time setup for Umbra: Python virtual environment, backend dependencies, frontend build.

.PARAMETER Cuda
  Install the CUDA build of PyTorch (cu126) instead of the default CPU build.

.PARAMETER SkipFrontend
  Skip npm install / build (the backend still works; the UI will not be served).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\setup.ps1
#>
param(
    [switch]$Cuda,
    [switch]$SkipFrontend
)

. (Join-Path $PSScriptRoot 'scripts\common.ps1')
Set-Location $Script:Root

Write-Host 'Umbra - Privacy-Preserving ML Framework - setup' -ForegroundColor Magenta

Write-Step 'Checking Python (3.10 or newer)'
$py = Find-SystemPython
if (-not $py) {
    Write-Fail 'Python 3.10+ not found. Install it from https://www.python.org/downloads/ and tick "Add to PATH".'
    exit 1
}
Write-Pass "Python $($py.Version) ($($py.Exe))"

$venvPy = Get-VenvPython
Write-Step 'Creating virtual environment (.venv)'
if (Test-Path $venvPy) {
    Write-Pass '.venv already exists - reusing it'
} else {
    Invoke-Checked $py.Exe ($py.Args + @('-m', 'venv', '.venv')) 'venv creation'
    Write-Pass '.venv created'
}

Write-Step 'Installing backend dependencies (PyTorch is a large download the first time)'
Invoke-Checked $venvPy @('-m', 'pip', 'install', '--upgrade', 'pip') 'pip upgrade'
if ($Cuda) {
    Write-Info 'Installing CUDA PyTorch build (cu126)'
    Invoke-Checked $venvPy @('-m', 'pip', 'install', 'torch', '--index-url', 'https://download.pytorch.org/whl/cu126') 'torch (CUDA) install'
} elseif (-not (Test-IsWindowsHost)) {
    # On Linux the default PyPI torch wheel bundles CUDA (several GB). Prefer the CPU wheel.
    Write-Info 'Installing CPU PyTorch build'
    & $venvPy -m pip install torch --index-url https://download.pytorch.org/whl/cpu
    if ($LASTEXITCODE -ne 0) { Write-Info 'CPU index unreachable - falling back to PyPI torch' }
}
Invoke-Checked $venvPy @('-m', 'pip', 'install', '-r', 'requirements.txt') 'requirements install'
Invoke-Checked $venvPy @('-m', 'pip', 'install', '-r', 'requirements-dev.txt') 'dev requirements install'
Write-Pass 'Python packages installed'

Write-Step 'Checking hardware'
& $venvPy -c "import torch, os; print('  torch', torch.__version__, '| CUDA available:', torch.cuda.is_available(), '| CPU cores:', os.cpu_count())"

if (-not (Test-Path '.env')) {
    Copy-Item '.env.example' '.env'
    Write-Pass 'Created .env from .env.example'
}

if ($SkipFrontend) {
    Write-Skip 'Frontend skipped (-SkipFrontend)'
} else {
    Write-Step 'Building the frontend (Node.js 18+)'
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Fail 'npm not found. Install Node.js LTS from https://nodejs.org/ and re-run setup.'
        exit 1
    }
    Push-Location (Join-Path $Script:Root 'frontend')
    try {
        if (Test-Path 'package-lock.json') { Invoke-Checked 'npm' @('ci', '--no-audit', '--no-fund') 'npm ci' }
        else { Invoke-Checked 'npm' @('install', '--no-audit', '--no-fund') 'npm install' }
        Invoke-Checked 'npm' @('run', 'build') 'frontend build'
    } finally { Pop-Location }
    Write-Pass 'Frontend built to frontend\dist'
}

Write-Host ''
Write-Host 'Setup complete. Start the app with:  .\run.ps1' -ForegroundColor Green
exit 0
