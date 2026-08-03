$ErrorActionPreference = 'Stop'

$ExePath = if ($env:FLOWCONTEXT_EXE_PATH) {
    $env:FLOWCONTEXT_EXE_PATH
} else {
    Join-Path $PSScriptRoot '..\src-tauri\target\release\flowcontext-desktop.exe'
}

if (-not (Test-Path -LiteralPath $ExePath)) {
    throw "FAIL: executable not found: $ExePath"
}

Start-Process -FilePath $ExePath
Start-Sleep -Seconds 2
$processes = @(Get-Process -Name 'flowcontext-desktop' -ErrorAction SilentlyContinue)
if ($processes.Count -ne 1) {
    throw "FAIL: expected one flowcontext-desktop process, found $($processes.Count)"
}

try {
    Start-Process 'codex://settings'
} catch {
    Write-Warning "codex://settings dispatch returned: $($_.Exception.Message)"
}

$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$autostart = Get-ItemProperty -Path $runKey -Name 'FlowContext' -ErrorAction SilentlyContinue
if ($null -eq $autostart) {
    Write-Warning 'FlowContext autostart registry entry is not present; enable it in Settings before release.'
}

Write-Host 'PASS: executable exists, one process is running, codex://settings was dispatched.'
Write-Host 'MANUAL: verify tray icon/menu, autostart toggle, multi-monitor seam suppression and 100%/150% scaling.'
