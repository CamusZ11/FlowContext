[CmdletBinding()]
param(
    [string]$DiagnosticsPath
)

$ErrorActionPreference = 'Stop'

if (-not [Environment]::UserInteractive) {
    throw 'Physical overlay validation requires an interactive Windows desktop session.'
}

Write-Output 'physical_session=true'
Write-Output 'automatic_result=not_applicable'
Write-Output 'checklist=Move pointer to the selected monitor external rightmost 2 physical pixels for at least 150 ms.'
Write-Output 'checklist=Confirm the foreground application does not change while FlowContext appears passively.'
Write-Output 'checklist=Move to a shared monitor seam and confirm FlowContext remains hidden.'
Write-Output 'checklist=Enter the pane, then leave it and confirm the next sampler tick hides it.'
Write-Output 'checklist=Record only monitor geometry, scale, PID and pass/fail; do not record prompts, URI queries, tokens or window titles.'

if ($DiagnosticsPath) {
    if (-not (Test-Path -LiteralPath $DiagnosticsPath)) { throw 'Diagnostics file not found.' }
    $text = Get-Content -LiteralPath $DiagnosticsPath -Raw -Encoding UTF8
    if ($text -match '(?i)(authorization|token|cookie|prompt|codex://|postgres|password)') {
        throw 'Diagnostics file contains a prohibited sensitive field.'
    }
    Write-Output 'diagnostics=redaction_check_passed'
}
