# Daily surveyor's news briefing — run by Windows Task Scheduler.
# Runs Claude Code headless in this repo to research the day's EPC/landlord/
# surveying news and publish one commentary post per docs/NEWS-ROUNDUP-SPEC.md.
# Log: %USERPROFILE%\.claude\news-roundup-daily.log

$ErrorActionPreference = "Continue"
$repo = Split-Path $PSScriptRoot -Parent
$log = Join-Path $env:USERPROFILE ".claude\news-roundup-daily.log"

Set-Location $repo
"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') run started ===" | Add-Content $log

. (Join-Path $PSScriptRoot "find-claude.ps1")
$claude = Find-Claude -Log $log -Routine "Surveyor's notes"
if (-not $claude) { "=== run aborted ===" | Add-Content $log; exit 1 }

# Feed the prompt on stdin as UTF-8: Windows PowerShell mangles a long argument with
# quotes in it (runs were getting the prompt cut off mid-spec).
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$prompt = Get-Content -Encoding UTF8 (Join-Path $PSScriptRoot "daily-news-prompt.txt") -Raw

$prompt | & $claude -p --dangerously-skip-permissions --model sonnet 2>&1 | Add-Content $log

"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') run finished (exit $LASTEXITCODE) ===" | Add-Content $log
