# Daily Field Kit guide publisher — run by Windows Task Scheduler.
# Runs Claude Code headless in this repo to write and publish one guide
# per docs/KIT-GUIDE-SPEC.md, taking the next topic from docs/KIT-CALENDAR.md.
# Log: %USERPROFILE%\.claude\field-kit-daily.log

$ErrorActionPreference = "Continue"
$repo = Split-Path $PSScriptRoot -Parent
$log = Join-Path $env:USERPROFILE ".claude\field-kit-daily.log"

Set-Location $repo
"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') run started ===" | Add-Content $log

$prompt = Get-Content (Join-Path $PSScriptRoot "daily-kit-prompt.txt") -Raw

# Headless Claude Code run; skip-permissions is required for unattended edits/pushes.
& claude -p $prompt --dangerously-skip-permissions --model sonnet 2>&1 | Add-Content $log

"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') run finished (exit $LASTEXITCODE) ===" | Add-Content $log
