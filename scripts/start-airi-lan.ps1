param([string]$LanAddress = '192.168.1.5')
. (Join-Path $PSScriptRoot 'airi-env.ps1')
$AiriLanPython = Join-Path $AiriWorkspace '.runtime/vision-venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $AiriLanPython)) { throw 'The existing local vision Python runtime is required.' }
& $AiriLanPython (Join-Path $PSScriptRoot 'prepare-lan-certificate.py') $LanAddress
if ($LASTEXITCODE -ne 0) { throw 'LAN certificate preparation failed.' }
& (Join-Path $PSScriptRoot 'start-project-manager.ps1')
try {
    $AiriWebReady = (Invoke-WebRequest 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200
} catch { $AiriWebReady = $false }
if (-not $AiriWebReady) {
    Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $PSScriptRoot 'start-airi.ps1') + '"'), '-Mode', 'web') -WorkingDirectory $AiriWorkspace -WindowStyle Hidden -RedirectStandardOutput (Join-Path $AiriWorkspace '.runtime/lan-web.log') -RedirectStandardError (Join-Path $AiriWorkspace '.runtime/lan-web-error.log') | Out-Null
    for ($AiriAttempt = 0; $AiriAttempt -lt 30; $AiriAttempt++) {
        Start-Sleep -Seconds 1
        try {
            $AiriWebReady = (Invoke-WebRequest 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200
        } catch { $AiriWebReady = $false }
        if ($AiriWebReady) { break }
    }
    if (-not $AiriWebReady) { throw 'Web startup failed. Read .runtime/lan-web-error.log.' }
} else {
    & (Join-Path $PSScriptRoot 'vision.ps1') start
}
$AiriLanRecord = Join-Path $AiriWorkspace '.runtime/lan-process.json'
$AiriLanRunning = $false
if (Test-Path -LiteralPath $AiriLanRecord) {
    $AiriLanInfo = Get-Content -LiteralPath $AiriLanRecord -Raw | ConvertFrom-Json
    $AiriLanProcess = Get-Process -Id $AiriLanInfo.pid -ErrorAction SilentlyContinue
    if ($AiriLanProcess -and $AiriLanProcess.StartTime.ToUniversalTime().Ticks -eq ([datetimeoffset]$AiriLanInfo.started).UtcTicks) { $AiriLanRunning = $true }
}
if (-not $AiriLanRunning) {
    $AiriLanProcess = Start-Process -FilePath $AiriNode -ArgumentList @('"' + (Join-Path $PSScriptRoot 'lan-gateway.mjs') + '"') -WorkingDirectory $AiriWorkspace -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $AiriWorkspace '.runtime/lan-gateway.log') -RedirectStandardError (Join-Path $AiriWorkspace '.runtime/lan-gateway-error.log')
    Start-Sleep -Seconds 1
    if ($AiriLanProcess.HasExited) { throw 'LAN gateway startup failed. Read .runtime/lan-gateway-error.log.' }
    @{pid=$AiriLanProcess.Id;started=$AiriLanProcess.StartTime.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $AiriLanRecord -Encoding utf8
}
Write-Host "Certificate setup: http://${LanAddress}:5442"
Write-Host "AIRI HTTPS: https://${LanAddress}:5443"
$AiriLanConfig = Get-Content -LiteralPath (Join-Path $AiriWorkspace 'airi/.local/lan/config.json') -Raw | ConvertFrom-Json
Write-Host ("Private test link: https://${LanAddress}:5443/enter?access=" + $AiriLanConfig.access)
