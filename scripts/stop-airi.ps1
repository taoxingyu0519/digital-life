$ErrorActionPreference = 'Stop'
$AiriWorkspace = Split-Path -Parent $PSScriptRoot
$AiriStatePath = Join-Path $AiriWorkspace '.runtime\web-process.json'
if (-not (Test-Path -LiteralPath $AiriStatePath)) {
    Write-Host 'No managed AIRI background process. For a foreground server, press Ctrl+C in its terminal.'
    exit 0
}
$AiriState = Get-Content -LiteralPath $AiriStatePath -Raw | ConvertFrom-Json
$AiriProcess = Get-Process -Id $AiriState.pid -ErrorAction SilentlyContinue
if (-not $AiriProcess) {
    Write-Host 'The recorded AIRI process has already stopped.'
    exit 0
}
if ($AiriProcess.StartTime.ToUniversalTime().Ticks -ne ([datetimeoffset]$AiriState.started).UtcTicks) {
    throw 'The process ID now belongs to another process. No process was stopped.'
}
& "$env:SystemRoot\System32\taskkill.exe" /PID $AiriState.pid /T /F
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Remove-Item -LiteralPath $AiriStatePath
