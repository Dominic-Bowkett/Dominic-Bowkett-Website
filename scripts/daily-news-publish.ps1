# Daily surveyor's news briefing — run by Windows Task Scheduler.
# Runs Claude Code headless in this repo to research the day's EPC/landlord/
# surveying news and publish one commentary post per docs/NEWS-ROUNDUP-SPEC.md.
# Log: %USERPROFILE%\.claude\news-roundup-daily.log

$ErrorActionPreference = "Continue"
$repo = Split-Path $PSScriptRoot -Parent
$log = Join-Path $env:USERPROFILE ".claude\news-roundup-daily.log"

Set-Location $repo
"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') run started ===" | Add-Content $log

$prompt = Get-Content (Join-Path $PSScriptRoot "daily-news-prompt.txt") -Raw

& claude -p $prompt --dangerously-skip-permissions --model sonnet 2>&1 | Add-Content $log

"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') run finished (exit $LASTEXITCODE) ===" | Add-Content $log
