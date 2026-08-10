[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Write-Check([string]$Name, [scriptblock]$Probe) {
    try {
        $value = & $Probe
        $text = @($value | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ }) -join '; '
        Write-Output "$Name=$text"
    } catch {
        Write-Output "$Name=unavailable"
    }
}

$os = Get-CimInstance Win32_OperatingSystem
Write-Output "os=$($os.Caption) $($os.Version)"
Write-Output "architecture=$($os.OSArchitecture)"
Write-Check 'cl' {
    (Get-Command cl.exe -ErrorAction Stop).Path
}
Write-Check 'link' {
    (Get-Command link.exe -ErrorAction Stop).Path
}
Write-Check 'rust_host' { (rustc -vV | Select-String '^host:').ToString().Replace('host: ', '') }
Write-Check 'rust_version' { rustc --version }
Write-Check 'node' { node --version }
Write-Check 'pnpm' { pnpm --version }
Write-Check 'tauri' { pnpm --filter @flowcontext/desktop exec tauri --version }
Write-Check 'webview2' {
    $runtime = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\*' -ErrorAction SilentlyContinue |
        Where-Object { $_.name -eq 'Microsoft Edge WebView2 Runtime' } |
        Select-Object -First 1
    if ($null -eq $runtime) { throw 'WebView2 Runtime not found' }
    $runtime.pv
}
Write-Check 'git_commit' { git rev-parse HEAD }
