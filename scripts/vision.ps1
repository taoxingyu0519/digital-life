param(
    [ValidateSet('install', 'install-cuda', 'install-grounding', 'prepare-grounding', 'prepare-recognition', 'recognition-benchmark', 'recognition-probe', 'adaptation-probe', 'doctor', 'prepare', 'verify', 'start', 'stop', 'test', 'calibrate', 'benchmark', 'accept', 'smoke', 'integration')]
    [string]$Command = 'doctor',
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExtraArguments
)
. (Join-Path $PSScriptRoot 'airi-env.ps1')
$VisionRuntime = Join-Path $AiriWorkspace '.runtime'
$VisionPython = Join-Path $VisionRuntime 'vision-venv/Scripts/python.exe'
$VisionService = Join-Path $AiriRepo 'services/local-vision'
$VisionRecord = Join-Path $VisionRuntime 'vision-process.json'
if ($Command -eq 'install') {
    $VisionBasePython = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
    if (-not (Test-Path -LiteralPath $VisionBasePython)) { $VisionBasePython = (Get-Command python.exe -ErrorAction Stop).Source }
    if (-not (Test-Path -LiteralPath $VisionPython)) { & $VisionBasePython -m venv (Join-Path $VisionRuntime 'vision-venv') }
    & $VisionPython -m pip install --disable-pip-version-check -r (Join-Path $VisionService 'requirements.txt')
    exit $LASTEXITCODE
}
if (-not (Test-Path -LiteralPath $VisionPython)) { throw 'Run scripts/vision.ps1 install first.' }
if ($Command -eq 'install-cuda' -or $Command -eq 'install-grounding') {
    $VisionRequirements = if ($Command -eq 'install-cuda') { 'requirements-cuda.txt' } else { 'requirements-grounding.txt' }
    & $VisionPython -m pip install --disable-pip-version-check -r (Join-Path $VisionService $VisionRequirements) --cache-dir (Join-Path $AiriWorkspace '.downloads/vision-pip')
    exit $LASTEXITCODE
}
if ($Command -eq 'stop' -or $Command -eq 'start') {
    $VisionProcess = $null
    if (Test-Path -LiteralPath $VisionRecord) {
        $VisionInfo = Get-Content -LiteralPath $VisionRecord -Raw | ConvertFrom-Json
        $VisionCandidate = Get-Process -Id $VisionInfo.pid -ErrorAction SilentlyContinue
        if ($VisionCandidate -and $VisionCandidate.StartTime.ToUniversalTime().Ticks -eq ([datetimeoffset]$VisionInfo.started).UtcTicks) {
            $VisionProcess = $VisionCandidate
        }
        elseif ($VisionCandidate) {
            throw 'Vision PID ownership could not be verified. The recorded process was not changed.'
        }
    }
    if ($Command -eq 'stop') {
        if ($VisionProcess) {
            # The Windows venv launcher owns a child interpreter that serves Uvicorn.
            & taskkill.exe /PID $VisionProcess.Id /T /F | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Could not stop the recorded vision process tree.' }
        }
        if (Test-Path -LiteralPath $VisionRecord) { Remove-Item -LiteralPath $VisionRecord }
        Write-Host 'Local vision stopped. Only the recorded project process was targeted.'
        exit 0
    }
    if (-not $VisionProcess) {
        $VisionProcess = Start-Process -FilePath $VisionPython -ArgumentList @('-m', 'uvicorn', 'service:app', '--host', '127.0.0.1', '--port', '18765', '--no-access-log', '--ws-max-size', '1052680', '--ws-max-queue', '2') -WorkingDirectory $VisionService -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $VisionRuntime 'vision-service.log') -RedirectStandardError (Join-Path $VisionRuntime 'vision-service-error.log')
        Start-Sleep -Seconds 2
        if ($VisionProcess.HasExited) { throw 'Vision service exited. Read .runtime/vision-service-error.log.' }
        $VisionRecordedProcess = Get-Process -Id $VisionProcess.Id -ErrorAction Stop
        @{ pid = $VisionRecordedProcess.Id; started = $VisionRecordedProcess.StartTime.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $VisionRecord -Encoding utf8
    }
    Write-Host 'Local vision: 127.0.0.1:18765. Active mode starts the camera from the AIRI stage. Passive mode releases it.'
    exit 0
}
Push-Location $VisionService
try {
    & $VisionPython cli.py $Command @ExtraArguments
    $VisionExitCode = $LASTEXITCODE
} finally { Pop-Location }
exit $VisionExitCode
