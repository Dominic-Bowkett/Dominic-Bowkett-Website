# Daily invoice payment reminders — fallback trigger run by Windows Task Scheduler ("DBK Invoice Reminders", 08:30).
# The Cloudflare cron Worker (workers/invoice-reminders) does the same job when the account has a free cron slot;
# running both is harmless (each invoice gets at most one reminder per 6 days).
# Key: %USERPROFILE%\.dbk-invoice-cron.key (same value as the CRON_SECRET Pages secret). Log: %USERPROFILE%\.claude\invoice-reminders.log
$ErrorActionPreference = "Continue"
$log = Join-Path $env:USERPROFILE ".claude\invoice-reminders.log"
$key = (Get-Content (Join-Path $env:USERPROFILE ".dbk-invoice-cron.key") -Raw).Trim()
try {
  $r = Invoke-RestMethod -Uri "https://www.dominicbowkett.com/api/cron/reminders" -Method POST -Headers @{ "x-cron-key" = $key } -ContentType "application/json" -Body "{}" -TimeoutSec 120
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ok checked=$($r.checked) sent=$(($r.sent | ForEach-Object { "$($_.number)#$($_.reminder)" }) -join ',')" | Add-Content $log
} catch {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ERROR $($_.Exception.Message)" | Add-Content $log
}
