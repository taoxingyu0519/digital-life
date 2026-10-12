param([switch]$OpenBrowser)
. (Join-Path $PSScriptRoot 'airi-env.ps1')
$AiriRuntime = Join-Path $AiriWorkspace '.runtime'
New-Item -ItemType Directory -Path $AiriRuntime -Force | Out-Null
$AiriManagerRecord = Join-Path $AiriRuntime 'project-manager-process.json'
$AiriManagerRunning = $false
if (Test-Path -LiteralPath $AiriManagerRecord) {
    $AiriManagerInfo = Get-Content -LiteralPath $AiriManagerRecord -Raw | ConvertFrom-Json
    $AiriManagerProcess = Get-Process -Id $AiriManagerInfo.pid -ErrorAction SilentlyContinue
    if ($AiriManagerProcess -and $AiriManagerProcess.StartTime.ToUniversalTime().Ticks -eq ([datetimeoffset]$AiriManagerInfo.started).UtcTicks) { $AiriManagerRunning = $true }
}
if (-not $AiriManagerRunning) {
    $AiriManagerScript = Join-Path $PSScriptRoot 'project-manager.mjs'
    $AiriManagerProcess = Start-Process -FilePath $AiriNode -ArgumentList @('"' + $AiriManagerScript + '"') -WorkingDirectory $AiriWorkspace -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $AiriRuntime 'project-manager.log') -RedirectStandardError (Join-Path $AiriRuntime 'project-manager-error.log')
    Start-Sleep -Seconds 2
    if ($AiriManagerProcess.HasExited) { throw 'Project manager failed to start. See .runtime/project-manager-error.log' }
    @{ pid = $AiriManagerProcess.Id; started = $AiriManagerProcess.StartTime.ToString('o'); url = 'http://127.0.0.1:5174' } | ConvertTo-Json | Set-Content -LiteralPath $AiriManagerRecord -Encoding utf8
}
Write-Host 'AIRI project manager: http://127.0.0.1:5174'
if ($OpenBrowser) { Start-Process 'http://127.0.0.1:5174' }
