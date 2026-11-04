# Locate the Claude Code CLI for the publishing routines. Dot-source this file, then call
#   $claude = Find-Claude -Log $log -Routine "Field Kit"
# Prefers the npm global install; falls back to the newest VS Code extension binary.
# If neither exists it logs the problem and emails an alert (an empty npm install made
# every routine fail silently from 16 Oct to 4 Nov 2026), then returns $null.

function Find-Claude {
    param([string] $Log, [string] $Routine)
    $npm = Join-Path $env:APPDATA "npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe"
    if (Test-Path $npm) { return $npm }
    $ext = Get-ChildItem (Join-Path $env:USERPROFILE ".vscode\extensions") -Directory -Filter "anthropic.claude-code-*" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        ForEach-Object { Join-Path $_.FullName "resources\native-binary\claude.exe" } |
        Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($ext) {
        "WARNING: npm claude.exe missing, using $ext (reinstall: npm install -g @anthropic-ai/claude-code)" | Add-Content $Log
        return $ext
    }
    "ERROR: Claude Code CLI not found; nothing published" | Add-Content $Log
    . (Join-Path $PSScriptRoot "fieldkit-alert.ps1")
    try {
        Send-FieldKitAlert -Subject "$Routine routine can't find Claude Code - nothing published" -Html (
            "<p>The $Routine publishing routine on $env:COMPUTERNAME could not find the Claude Code CLI, so nothing was published today.</p>" +
            "<p>Fix: run <code>npm install -g @anthropic-ai/claude-code</code> and check <code>claude --version</code>.</p>") | Out-Null
    } catch { "alert email FAILED: $($_.Exception.Message)" | Add-Content $Log }
    return $null
}
