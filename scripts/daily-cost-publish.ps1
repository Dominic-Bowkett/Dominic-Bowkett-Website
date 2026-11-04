# Weekly (Wednesday) "cost of X in 2026" guide — run by Windows Task Scheduler.
# Runs Claude Code headless in this repo to research current UK prices and
# publish one cost guide per docs/COST-GUIDE-SPEC.md, taking the next topic
# from docs/COST-CALENDAR.md.
# Log: %USERPROFILE%\.claude\cost-guide-daily.log

$ErrorActionPreference = "Continue"
$repo = Split-Path $PSScriptRoot -Parent
$log = Join-Path $env:USERPROFILE ".claude\cost-guide-daily.log"

Set-Location $repo
"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') run started ===" | Add-Content $log

. (Join-Path $PSScriptRoot "find-claude.ps1")
$claude = Find-Claude -Log $log -Routine "Cost guide"
if (-not $claude) { "=== run aborted ===" | Add-Content $log; exit 1 }

# Feed the prompt on stdin as UTF-8: Windows PowerShell mangles a long argument with
# quotes in it (runs were getting the prompt cut off mid-spec).
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$prompt = Get-Content -Encoding UTF8 (Join-Path $PSScriptRoot "daily-cost-prompt.txt") -Raw

$prompt | & $claude -p --dangerously-skip-permissions --model sonnet 2>&1 | Add-Content $log

"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') run finished (exit $LASTEXITCODE) ===" | Add-Content $log
