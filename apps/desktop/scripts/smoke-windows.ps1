[CmdletBinding()]
param(
    [ValidateSet('Mock', 'Real')]
    [string]$CodexMode = 'Mock',
    [string]$InstallerPath,
    [string]$ExePath,
    [int]$StartupTimeoutSeconds = 15
)

$ErrorActionPreference = 'Stop'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$mockLog = Join-Path ([System.IO.Path]::GetTempPath()) ("flowcontext-launcher-{0}.log" -f [Guid]::NewGuid().ToString('N'))
$firstProcess = $null
$installRoot = $null
$uninstaller = $null
$installedByThisRun = $false

function Resolve-FlowContextExecutable {
    param([string]$ExplicitPath)
    if ($ExplicitPath) {
        if (-not (Test-Path -LiteralPath $ExplicitPath)) { throw "FAIL: executable not found" }
        return (Resolve-Path -LiteralPath $ExplicitPath).Path
    }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'FlowContext\flowcontext-desktop.exe'),
        (Join-Path $env:LOCALAPPDATA 'FlowContext\FlowContext.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\FlowContext\flowcontext-desktop.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\FlowContext\FlowContext.exe'),
        (Join-Path $PSScriptRoot '..\src-tauri\target\release\flowcontext-desktop.exe')
    )
    $found = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $found) { throw 'FAIL: installed FlowContext executable was not found in a supported current-user location' }
    return (Resolve-Path -LiteralPath $found).Path
}

function Get-FlowContextProcesses {
    param([string]$Path)
    $resolved = (Resolve-Path -LiteralPath $Path).Path
    return @(
        Get-Process -ErrorAction SilentlyContinue | Where-Object {
            try { $_.Path -eq $resolved } catch { $false }
        }
    )
}

function Wait-FlowContextStart {
    param([System.Diagnostics.Process]$Process)
    $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    do {
        if ($Process.HasExited) { throw "FAIL: first instance exited immediately (exit $($Process.ExitCode))" }
        if ((Get-Date) -ge $deadline) { return }
        Start-Sleep -Milliseconds 250
    } while ($true)
}

function Assert-MockLauncherRoutes {
    param([string]$Path)
    $lines = @(Get-Content -LiteralPath $Path -ErrorAction Stop)
    if ($lines -notcontains 'threads') { throw 'FAIL: mock launcher did not receive a threads route' }
    if ($lines -notcontains 'new') { throw 'FAIL: mock launcher did not receive a new route' }
}

try {
    if (-not $InstallerPath) {
        $InstallerPath = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '..\src-tauri\target\release\bundle\nsis') -Filter '*.exe' -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -notmatch 'uninstall' } |
            Select-Object -First 1 -ExpandProperty FullName
    }
    if ($InstallerPath) {
        if (-not (Test-Path -LiteralPath $InstallerPath)) { throw 'FAIL: installer not found' }
        $installer = Start-Process -FilePath $InstallerPath -ArgumentList '/S' -Wait -PassThru
        if ($installer.ExitCode -ne 0) { throw "FAIL: current-user NSIS install failed (exit $($installer.ExitCode))" }
        $installedByThisRun = $true
    }

    $ExePath = Resolve-FlowContextExecutable $ExePath
    $installRoot = Split-Path -Parent $ExePath
    $candidateUninstaller = Join-Path $installRoot 'uninstall.exe'
    if (Test-Path -LiteralPath $candidateUninstaller) { $uninstaller = $candidateUninstaller }

    if ($CodexMode -eq 'Mock') {
        $env:FLOWCONTEXT_EXTERNAL_LAUNCHER = 'mock'
        $env:FLOWCONTEXT_EXTERNAL_LAUNCHER_LOG = $mockLog
    }

    $firstProcess = Start-Process -FilePath $ExePath -PassThru
    Wait-FlowContextStart $firstProcess

    $second = Start-Process -FilePath $ExePath -ArgumentList @('--flowcontext-test-launch', 'codex://threads/mock-thread') -PassThru
    if (-not $second.WaitForExit($StartupTimeoutSeconds * 1000)) { throw 'FAIL: second instance did not exit after handing off to first instance' }
    if ($firstProcess.HasExited) { throw 'FAIL: first instance exited after second-instance handoff' }

    if ($CodexMode -eq 'Mock') {
        $third = Start-Process -FilePath $ExePath -ArgumentList @('--flowcontext-test-launch', 'codex://new?path=C%3A%5Cfixture%20workspace&prompt=%E7%BB%A7%E7%BB%AD') -PassThru
        if (-not $third.WaitForExit($StartupTimeoutSeconds * 1000)) { throw 'FAIL: new-route handoff did not exit' }
        Assert-MockLauncherRoutes $mockLog
    }

    $running = Get-FlowContextProcesses $ExePath
    if ($running.Count -ne 1) { throw "FAIL: expected one FlowContext process after handoff, found $($running.Count)" }
    Write-Output 'PASS: installer launch, single-instance handoff, and redacted mock launcher routes succeeded.'
} finally {
    if ($firstProcess -and -not $firstProcess.HasExited) {
        Stop-Process -Id $firstProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($ExePath -and (Test-Path -LiteralPath $ExePath)) {
        $deadline = (Get-Date).AddSeconds(10)
        while ((Get-FlowContextProcesses $ExePath).Count -gt 0 -and (Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 250
        }
        if ((Get-FlowContextProcesses $ExePath).Count -gt 0) { throw 'FAIL: FlowContext process remained after cleanup' }
    }
    if ($installedByThisRun -and $uninstaller) {
        $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
        if ($uninstall.ExitCode -ne 0) { throw "FAIL: NSIS uninstall failed (exit $($uninstall.ExitCode))" }
        if ($installRoot -and (Test-Path -LiteralPath $installRoot)) { throw 'FAIL: uninstall left the current-user application directory behind' }
    }
    Remove-ItemProperty -Path $runKey -Name 'FlowContext' -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $mockLog -Force -ErrorAction SilentlyContinue
    Remove-Item Env:FLOWCONTEXT_EXTERNAL_LAUNCHER -ErrorAction SilentlyContinue
    Remove-Item Env:FLOWCONTEXT_EXTERNAL_LAUNCHER_LOG -ErrorAction SilentlyContinue
}
