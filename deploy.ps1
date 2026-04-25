param(
    [Parameter(Mandatory = $true, HelpMessage = "Commit message for this deploy")]
    [string]$Message
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Message)) {
    Write-Host "Error: -Message is required (e.g. .\deploy.ps1 -Message ""fix bank list"")" -ForegroundColor Red
    exit 1
}

Write-Host "Starting deploy..." -ForegroundColor Cyan

git status
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

git add .
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

git commit -m $Message
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Commit created" -ForegroundColor Green

git push
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Pushed to remote" -ForegroundColor Green
