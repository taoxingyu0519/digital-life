param([int]$ReadyTimeoutSeconds = 90)
. (Join-Path $PSScriptRoot 'airi-env.ps1')
$AiriRuntime = Join-Path $AiriWorkspace '.runtime'
$AiriWebProcess = $null
New-Item -ItemType Directory -Path $AiriRuntime -Force | Out-Null

function Test-AiriWeb {
    $AiriRequest = [Net.HttpWebRequest]::Create('http://127.0.0.1:5173/')
    $AiriRequest.Proxy = $null
    $AiriRequest.Timeout = 3000
    try {
        $AiriResponse = $AiriRequest.GetResponse()
        try {
            $AiriReader = [IO.StreamReader]::new($AiriResponse.GetResponseStream())
            try { return $AiriReader.ReadToEnd() -match '<title>\s*AIRI\s*</title>' }
            finally { $AiriReader.Dispose() }
        } finally { $AiriResponse.Dispose() }
    } catch { return $false }
}

function Test-AiriVisionReady {
    $AiriRequest = [Net.HttpWebRequest]::Create('http://127.0.0.1:5173/api/local-vision/health')
    $AiriRequest.Proxy = $null
    $AiriRequest.Timeout = 3000
    $AiriRequest.Headers['Origin'] = 'http://127.0.0.1:5173'
    $AiriRequest.Headers['X-Airi-Vision'] = '1'
    $AiriRequest.Headers['Sec-Fetch-Site'] = 'same-origin'
    try {
        $AiriResponse = $AiriRequest.GetResponse()
        try {
            $AiriReader = [IO.StreamReader]::new($AiriResponse.GetResponseStream())
            try { return [bool](($AiriReader.ReadToEnd() | ConvertFrom-Json).ready) }
            finally { $AiriReader.Dispose() }
        } finally { $AiriResponse.Dispose() }
    } catch { return $false }
}

function Test-AiriPort([int]$Port) {
    $AiriClient = [Net.Sockets.TcpClient]::new()
    try { return $AiriClient.ConnectAsync('127.0.0.1', $Port).Wait(1000) -and $AiriClient.Connected }
    catch { return $false }
    finally { $AiriClient.Dispose() }
}

$AiriWebReady = Test-AiriWeb
if (-not $AiriWebReady) {
    if (Test-AiriPort 5173) { throw '5173 已有服务，但不是健康的 AIRI 网页。请先检查日志，保留现有进程。' }
    $AiriWebProcess = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $PSScriptRoot 'start-airi.ps1') + '"'), '-Mode', 'web') -WorkingDirectory $AiriWorkspace -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $AiriRuntime 'web.log') -RedirectStandardError (Join-Path $AiriRuntime 'web-error.log')
    $AiriRecordedWeb = Get-Process -Id $AiriWebProcess.Id -ErrorAction Stop
    @{pid=$AiriRecordedWeb.Id;started=$AiriRecordedWeb.StartTime.ToString('o');workspace=$AiriRepo;port=5173} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $AiriRuntime 'web-process.json') -Encoding utf8
} elseif (-not (Test-AiriPort 18765)) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'vision.ps1') start
    if ($LASTEXITCODE -ne 0) { throw '视觉服务启动失败，请检查 .runtime/vision-service-error.log。' }
}

$AiriDeadline = [DateTime]::UtcNow.AddSeconds($ReadyTimeoutSeconds)
do {
    if ((Test-AiriWeb) -and (Test-AiriVisionReady)) {
        Write-Host 'AIRI 后台服务已就绪：网页 5173，视觉模型 ready=true。'
        exit 0
    }
    if ($AiriWebProcess -and $AiriWebProcess.HasExited) { throw 'Web 启动进程已退出，请检查 .runtime/web-error.log。' }
    Start-Sleep -Seconds 1
} while ([DateTime]::UtcNow -lt $AiriDeadline)
throw 'AIRI 就绪检查超时。保留现有服务，请检查 Web 和视觉日志。'
