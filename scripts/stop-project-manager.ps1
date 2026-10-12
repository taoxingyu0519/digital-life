. (Join-Path $PSScriptRoot 'airi-env.ps1')
$AiriManagerRecord = Join-Path $AiriWorkspace '.runtime\project-manager-process.json'
if (Test-Path -LiteralPath $AiriManagerRecord) {
    $AiriManagerInfo = Get-Content -LiteralPath $AiriManagerRecord -Raw | ConvertFrom-Json
    $AiriManagerProcess = Get-Process -Id $AiriManagerInfo.pid -ErrorAction SilentlyContinue
    if ($AiriManagerProcess) {
        if ($AiriManagerProcess.StartTime.ToUniversalTime().Ticks -ne ([datetimeoffset]$AiriManagerInfo.started).UtcTicks) { throw 'The recorded process ID was reused. No process was stopped.' }
        Stop-Process -Id $AiriManagerProcess.Id
        $AiriManagerProcess.WaitForExit(10000) | Out-Null
        if (-not $AiriManagerProcess.HasExited) { throw 'Project manager has not exited yet.' }
    }
    Remove-Item -LiteralPath $AiriManagerRecord
}
