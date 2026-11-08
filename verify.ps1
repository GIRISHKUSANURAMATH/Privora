<#
.SYNOPSIS
  Verify the Umbra installation: environment, structure, tests, lint, types, security, smoke tests.
  Exits 0 when no check failed, 1 otherwise. Never deletes user files.

.PARAMETER Quick
  Skip the slower checks (full pytest suite, pip-audit, frontend build).
#>
param([switch]$Quick)

. (Join-Path $PSScriptRoot 'scripts\common.ps1')
$ErrorActionPreference = 'Continue'
Set-Location $Script:Root

$results = New-Object System.Collections.Generic.List[object]
function Add-Result([string]$Name, [string]$Status, [string]$Detail = '') {
    $results.Add([pscustomobject]@{ Check = $Name; Status = $Status; Detail = $Detail })
    switch ($Status) {
        'PASS' { Write-Pass "$Name  $Detail" }
        'FAIL' { Write-Fail "$Name  $Detail" }
        default { Write-Skip "$Name  $Detail" }
    }
}

function Invoke-Check([string]$Name, [string]$Exe, [string[]]$Arguments, [string]$WorkDir = $Script:Root) {
    Push-Location $WorkDir
    try {
        $out = & $Exe @Arguments 2>&1 | Out-String
        $code = $LASTEXITCODE
    } catch {
        $out = $_.Exception.Message
        $code = 1
    } finally { Pop-Location }
    $tail = ($out.Trim() -split "`r?`n" | Select-Object -Last 1)
    if ($code -eq 0) { Add-Result $Name 'PASS' $tail } else {
        Add-Result $Name 'FAIL' "exit $code - $tail"
        Write-Host ($out.Trim() -split "`r?`n" | Select-Object -Last 25 | Out-String) -ForegroundColor DarkGray
    }
}

Write-Host 'Umbra verification' -ForegroundColor Magenta

# ---------------------------------------------------------------- environment
Write-Step 'Environment'
$py = Find-SystemPython
if ($py) { Add-Result 'System Python >= 3.10' 'PASS' $py.Version } else { Add-Result 'System Python >= 3.10' 'FAIL' 'not found' }
$venvPy = Get-VenvPython
if (Test-Path $venvPy) {
    $v = & $venvPy -c "import sys; print(sys.version.split()[0])"
    Add-Result 'Virtual environment' 'PASS' "Python $v"
} else {
    Add-Result 'Virtual environment' 'FAIL' 'run .\setup.ps1'
    $results | Format-Table -AutoSize
    exit 1
}
# A script file, not 'python -c': PowerShell 5.1 strips embedded double quotes from native arguments.
Invoke-Check 'Core dependencies import' $venvPy @('scripts/check_env.py')
Invoke-Check 'Dependency consistency (pip check)' $venvPy @('-m', 'pip', 'check')

# ---------------------------------------------------------------- structure
Write-Step 'Project structure'
$required = @('README.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md', '.env.example', '.gitignore',
    'requirements.txt', 'requirements-dev.txt', 'Dockerfile', 'docker-compose.yml', 'setup.ps1', 'run.ps1', 'verify.ps1',
    'backend\ppml\main.py', 'backend\ppml\core\privacy\dp.py', 'backend\ppml\core\federated\fedavg.py',
    'backend\ppml\core\attacks\membership.py', 'backend\tests', 'frontend\package.json', 'frontend\src\main.tsx',
    'docs\ARCHITECTURE.md', 'docs\THREAT_MODEL.md', 'docs\PRIVACY_METHODOLOGY.md', 'docs\EXPERIMENTS.md',
    'docs\INSTALLATION.md', 'docs\API_REFERENCE.md', 'docs\VERIFICATION_REPORT.md', 'docs\UI_UX_REVIEW.md')
$missing = @($required | Where-Object { -not (Test-Path (Join-Path $Script:Root ($_ -replace '\\', [IO.Path]::DirectorySeparatorChar))) })
if ($missing.Count -eq 0) { Add-Result 'Required files present' 'PASS' "$($required.Count) paths" }
else { Add-Result 'Required files present' 'FAIL' ("missing: " + ($missing -join ', ')) }

# ---------------------------------------------------------------- quality + security
Write-Step 'Lint, format, types'
Invoke-Check 'Ruff lint' $venvPy @('-m', 'ruff', 'check', 'backend', 'scripts')
Invoke-Check 'Ruff format check' $venvPy @('-m', 'ruff', 'format', '--check', 'backend', 'scripts')
Invoke-Check 'Mypy type check' $venvPy @('-m', 'mypy', 'backend/ppml')

Write-Step 'Security'
Invoke-Check 'Bandit static analysis' $venvPy @('-m', 'bandit', '-q', '-r', 'backend/ppml', '-c', 'backend/pyproject.toml')
if ($Quick) { Add-Result 'pip-audit dependency scan' 'SKIP' '-Quick' }
else { Invoke-Check 'pip-audit dependency scan' $venvPy @('-m', 'pip_audit', '-r', 'requirements.txt', '--progress-spinner', 'off') }
$secretHits = Get-ChildItem -Recurse -File -Include *.py, *.ts, *.tsx, *.ps1, *.yml, *.json -Path (Join-Path $Script:Root 'backend'), (Join-Path $Script:Root 'frontend\src'), (Join-Path $Script:Root 'scripts') -ErrorAction SilentlyContinue |
    Select-String -Pattern '(?i)(api[_-]?key|secret|password|token)\s*[:=]\s*["''][A-Za-z0-9/+_-]{16,}["'']' -ErrorAction SilentlyContinue
if ($secretHits) { Add-Result 'Hard-coded secret scan' 'FAIL' "$(@($secretHits).Count) suspicious line(s)" } else { Add-Result 'Hard-coded secret scan' 'PASS' 'no matches' }

# ---------------------------------------------------------------- tests
Write-Step 'Tests'
$env:PYTHONPATH = Join-Path $Script:Root 'backend'
if ($Quick) {
    Invoke-Check 'Pytest (data + accounting subset)' $venvPy @('-m', 'pytest', '-q', 'tests/test_data.py', '-k', 'not overfit') (Join-Path $Script:Root 'backend')
} else {
    Invoke-Check 'Pytest full suite' $venvPy @('-m', 'pytest', '-q') (Join-Path $Script:Root 'backend')
}
Invoke-Check 'ML / DP / FL / attack / report smoke tests' $venvPy @('scripts/smoke.py')

# ---------------------------------------------------------------- frontend
Write-Step 'Frontend'
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Add-Result 'Frontend checks' 'SKIP' 'npm not installed' }
elseif (-not (Test-Path (Join-Path $Script:Root 'frontend/node_modules'))) { Add-Result 'Frontend checks' 'SKIP' 'run setup.ps1 first' }
else {
    $fe = Join-Path $Script:Root 'frontend'
    Invoke-Check 'TypeScript type check' 'npm' @('run', '--silent', 'typecheck') $fe
    Invoke-Check 'Frontend unit tests (vitest)' 'npm' @('run', '--silent', 'test') $fe
    if ($Quick) { Add-Result 'Frontend production build' 'SKIP' '-Quick' } else { Invoke-Check 'Frontend production build' 'npm' @('run', '--silent', 'build') $fe }
}

# ---------------------------------------------------------------- summary
Write-Host ''
$results | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
$failed = @($results | Where-Object { $_.Status -eq 'FAIL' }).Count
$passed = @($results | Where-Object { $_.Status -eq 'PASS' }).Count
$skipped = @($results | Where-Object { $_.Status -eq 'SKIP' }).Count
$colour = 'Green'
if ($failed -gt 0) { $colour = 'Red' }
Write-Host "Passed: $passed   Failed: $failed   Skipped: $skipped" -ForegroundColor $colour
if ($failed -gt 0) { exit 1 }
exit 0
