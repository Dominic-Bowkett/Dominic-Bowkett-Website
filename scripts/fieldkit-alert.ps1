# Email alert for the Field Kit routines. Dot-source this file, then call
#   Send-FieldKitAlert -Subject "..." -Html "<p>...</p>"
# Sends through Resend (dominicbowkett.com is a verified sender there). The API key
# is read from the booking-saas .dev.vars file, the same place the P2 weekly report
# reads it from. Never prints the key.

function Get-ResendKey {
    $vars = Join-Path $env:USERPROFILE "projects\booking-saas\.dev.vars"
    if (-not (Test-Path $vars)) { throw "Resend key file not found: $vars" }
    $text = Get-Content $vars -Raw
    if ($text -match 'RESEND_API_KEY="([^"]+)"') { return $Matches[1] }
    throw "RESEND_API_KEY not found in $vars"
}

function Send-FieldKitAlert {
    param(
        [Parameter(Mandatory = $true)] [string] $Subject,
        [Parameter(Mandatory = $true)] [string] $Html,
        [string] $To = "info@dominicbowkett.com"
    )
    $key = Get-ResendKey
    $payload = @{
        from    = "Dominic Bowkett <info@dominicbowkett.com>"
        to      = @($To)
        subject = $Subject
        html    = $Html
    } | ConvertTo-Json -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
    $headers = @{
        Authorization  = "Bearer $key"
        "Content-Type" = "application/json"
        # Resend sits behind Cloudflare, which rejects bare script user agents.
        "User-Agent"   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    }
    $resp = Invoke-RestMethod -Method Post -Uri "https://api.resend.com/emails" -Headers $headers -Body $bytes
    return $resp.id
}
