# Shared helpers for setup.ps1, run.ps1 and verify.ps1.
# Compatible with Windows PowerShell 5.1 and PowerShell 7+.

$ErrorActionPreference = 'Stop'
$Script:Root = Split-Path -Parent $PSScriptRoot

function Write-Step([string]$Text) { Write-Host ''; Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Pass([string]$Text) { Write-Host "  [PASS] $Text" -ForegroundColor Green }
function Write-Fail([string]$Text) { Write-Host "  [FAIL] $Text" -ForegroundColor Red }
function Write-Skip([string]$Text) { Write-Host "  [SKIP] $Text" -ForegroundColor Yellow }
function Write-Info([string]$Text) { Write-Host "         $Text" -ForegroundColor DarkGray }

function Test-IsWindowsHost {
    if ($PSVersionTable.PSVersion.Major -lt 6) { return $true }
    return [bool]$IsWindows
}

function Get-VenvPython {
    if (Test-IsWindowsHost) { return Join-Path $Script:Root '.venv\Scripts\python.exe' }
    return Join-Path $Script:Root '.venv/bin/python'
}

function Find-SystemPython {
    # Prefer the Windows launcher, then python/python3 on PATH. Require 3.10+.
    $candidates = @()
    if (Get-Command py -ErrorAction SilentlyContinue) { $candidates += , @('py', '-3') }
    if (Get-Command python -ErrorAction SilentlyContinue) { $candidates += , @('python') }
    if (Get-Command python3 -ErrorAction SilentlyContinue) { $candidates += , @('python3') }
    foreach ($c in $candidates) {
        $exe = $c[0]
        $pyArgs = @()
        if ($c.Count -gt 1) { $pyArgs = $c[1..($c.Count - 1)] }
        try {
            $v = & $exe @pyArgs -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
            if ($LASTEXITCODE -eq 0 -and $v) {
                $parts = $v.Trim().Split('.')
                if ([int]$parts[0] -eq 3 -and [int]$parts[1] -ge 10) {
                    return [pscustomobject]@{ Exe = $exe; Args = $pyArgs; Version = $v.Trim() }
                }
            }
        } catch { }
    }
    return $null
}

function Invoke-Checked([string]$Exe, [string[]]$Arguments, [string]$What) {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$What failed with exit code $LASTEXITCODE" }
}
