# Daily "cost of X in 2026" guide — run by Windows Task Scheduler.
# Runs Claude Code headless in this repo to research current UK prices and
# publish one cost guide per docs/COST-GUIDE-SPEC.md, taking the next topic
# from docs/COST-CALENDAR.md.
# Log: %USERPROFILE%\.claude\cost-guide-daily.log

$ErrorActionPreference = "Continue"
$repo = Split-Path $PSScriptRoot -Parent
$log = Join-Path $env:USERPROFILE ".claude\cost-guide-daily.log"

Set-Location $repo
"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') run started ===" | Add-Content $log

$prompt = Get-Content (Join-Path $PSScriptRoot "daily-cost-prompt.txt") -Raw

& claude -p $prompt --dangerously-skip-permissions --model sonnet 2>&1 | Add-Content $log

"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') run finished (exit $LASTEXITCODE) ===" | Add-Content $log
