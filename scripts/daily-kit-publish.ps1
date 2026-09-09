# Daily Field Kit guide publisher — run by Windows Task Scheduler.
# Runs Claude Code headless in this repo, once per guide, up to $perDay guides a day,
# each per docs/KIT-GUIDE-SPEC.md taking the next topic from docs/KIT-CALENDAR.md.
# When the calendar is down to $alertAt topics or fewer it emails Dom for new ones
# (see fieldkit-alert.ps1). It never researches topics itself.
# Log: %USERPROFILE%\.claude\field-kit-daily.log

$ErrorActionPreference = "Continue"
$repo = Split-Path $PSScriptRoot -Parent
$log = Join-Path $env:USERPROFILE ".claude\field-kit-daily.log"
$calendar = Join-Path $repo "docs\KIT-CALENDAR.md"
$perDay = 3
$alertAt = 3

. (Join-Path $PSScriptRoot "fieldkit-alert.ps1")

function Get-RemainingTopics {
    # Pull first so the count reflects what other runs have ticked.
    & git -C $repo pull --rebase --quiet origin main 2>&1 | Out-Null
    return @(Select-String -Path $calendar -Pattern '^- \[ \]').Count
}

Set-Location $repo
"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') run started ===" | Add-Content $log

$prompt = Get-Content (Join-Path $PSScriptRoot "daily-kit-prompt.txt") -Raw
$published = 0

for ($i = 1; $i -le $perDay; $i++) {
    $remaining = Get-RemainingTopics
    if ($remaining -eq 0) {
        "--- run $i of ${perDay}: no unticked topics remain, stopping ---" | Add-Content $log
        break
    }
    "--- run $i of $perDay ($remaining topics remaining) ---" | Add-Content $log
    $before = (& git -C $repo rev-parse HEAD)
    # Headless Claude Code run; skip-permissions is required for unattended edits/pushes.
    & claude -p $prompt --dangerously-skip-permissions --model sonnet 2>&1 | Add-Content $log
    $after = (& git -C $repo rev-parse HEAD)
    if ($after -ne $before) { $published++ }
}

$remaining = Get-RemainingTopics
"$published guide(s) published; $remaining topics remaining" | Add-Content $log

if ($remaining -le $alertAt) {
    if ($remaining -eq 0) {
        $subject = "Field Kit calendar is empty - no more guides will publish"
        $lead = "The Field Kit backlog has run out. The 07:30 routine will keep starting each day but publish nothing until new topics are added."
    } else {
        $subject = "Field Kit calendar: $remaining topic(s) left - add more"
        $lead = "The Field Kit backlog is down to $remaining unticked topic(s), which is less than a day's run of $perDay."
    }
    $html = "<p>$lead</p>" +
            "<p>Add new topics as unticked <code>- [ ]</code> lines under <strong>Upcoming</strong> in " +
            "<code>docs/KIT-CALENDAR.md</code> in the Dominic-Bowkett-Website repo (one line per topic: slug, " +
            "primary keyword with UK volume/KD, angle, ROUNDUP if not a ranked guide, hub group), commit and push to main. " +
            "Or ask Claude to research and append a batch.</p>" +
            "<p>Published today: $published. Sent by scripts/daily-kit-publish.ps1 on $env:COMPUTERNAME at $(Get-Date -Format 'HH:mm, d MMM yyyy').</p>"
    try {
        $id = Send-FieldKitAlert -Subject $subject -Html $html
        "alert email sent (id $id): $subject" | Add-Content $log
    } catch {
        "alert email FAILED: $($_.Exception.Message)" | Add-Content $log
    }
}

"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') run finished (exit $LASTEXITCODE) ===" | Add-Content $log
