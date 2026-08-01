# Launcher for the Pipedrive file-body import — used by the Windows Scheduled
# Task "GOS-file-import" so the job is independent of any terminal, editor or
# Claude session. Contains no secrets: the database URL is fetched from Railway
# at run time.
#
# Manual run:
#   powershell -NoProfile -ExecutionPolicy Bypass -File server\scripts\migration\run-file-import.ps1
#
# The importer itself enforces one-process (heartbeat lock), waits for the
# Pipedrive rate-limit window, checkpoints every file and resumes by re-running.
$ErrorActionPreference = 'Stop'
Set-Location 'C:\Projects\grafitiyul-os'

$log = "C:\Projects\grafitiyul-os\.file-import.log"
"[{0}] launcher starting" -f (Get-Date -Format o) | Out-File -FilePath $log -Append -Encoding utf8

# Public proxy URL — the internal host railway injects is unreachable from a laptop.
$pg = railway variables --service Postgres --json | ConvertFrom-Json
$env:MIGRATION_DB_URL = $pg.DATABASE_PUBLIC_URL

railway run --service Grafitiyul-OS node server/scripts/migration/import-file-bodies.mjs `
  --execute --year all --wait-for-window 2>&1 | Tee-Object -FilePath $log -Append

"[{0}] launcher finished (exit {1})" -f (Get-Date -Format o), $LASTEXITCODE | Out-File -FilePath $log -Append -Encoding utf8
