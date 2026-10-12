param([string]$Task = 'local-check')
. (Join-Path $PSScriptRoot 'airi-env.ps1')
if ($Task -notmatch '^[A-Za-z0-9_-]+$') { throw '任务标识只能包含字母、数字、短横线和下划线。' }
$AiriDeliveryDirectory = Join-Path $AiriWorkspace ".runtime/delivery/$Task"
New-Item -ItemType Directory -Path $AiriDeliveryDirectory -Force | Out-Null
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $AiriWorkspace '.tools/playwright'
$env:RAYON_NUM_THREADS = '1'
$AiriDeliveryResults = [Collections.Generic.List[object]]::new()

function Invoke-AiriDeliveryStep([string]$Name, [scriptblock]$Action) {
    $AiriStepLog = Join-Path $AiriDeliveryDirectory "$Name.log"
    Write-Host "正在检查：$Name"
    $AiriStepStarted = [datetime]::UtcNow
    & $Action > $AiriStepLog 2>&1
    $AiriStepExit = $LASTEXITCODE
    $AiriDeliveryResults.Add(@{name=$Name;passed=($AiriStepExit -eq 0);exitCode=$AiriStepExit;seconds=([datetime]::UtcNow-$AiriStepStarted).TotalSeconds;log=$AiriStepLog})
    if ($AiriStepExit -ne 0) { throw "$Name 失败，请查看 $AiriStepLog；禁止将本次交付记为回归通过。" }
}

Push-Location $AiriRepo
$AiriDeliveryPassed = $false
try {
    # Build shared contracts first. Browser imports and the actual Vite gateway use these generated exports.
    Invoke-AiriDeliveryStep 'i18n-build' { & $AiriNode $AiriPnpm --config.verify-deps-before-run=false -F '@proj-airi/i18n' build }
    Invoke-AiriDeliveryStep 'voice-build' { & $AiriNode $AiriPnpm --config.verify-deps-before-run=false -F '@proj-airi/realtime-voice' build }
    Invoke-AiriDeliveryStep 'vision-build' { & $AiriNode $AiriPnpm --config.verify-deps-before-run=false -F '@proj-airi/local-vision' build }
    Invoke-AiriDeliveryStep 'typecheck' { & $AiriNode $AiriPnpm --config.verify-deps-before-run=false run typecheck }
    Invoke-AiriDeliveryStep 'lint' { & $AiriNode $AiriPnpm --config.verify-deps-before-run=false run lint }
    Invoke-AiriDeliveryStep 'critical-regression' {
        & $AiriNode ./node_modules/vitest/vitest.mjs run --config packages/stage-ui/vitest.config.ts --no-file-parallelism src/stores/modules/realtime-brain.browser.test.ts src/stores/modules/realtime-audio.browser.test.ts src/stores/stage-runtime.browser.test.ts src/stores/stage-identity.browser.test.ts src/stores/local-vision.browser.test.ts src/stores/companion.browser.test.ts src/stores/chat-archive.browser.test.ts src/stores/chat/session-store.browser.test.ts src/stores/chat/context-providers/user-account.browser.test.ts src/stores/chat/voice-transcript.browser.test.ts src/composables/vision/local-vision-capture.browser.test.ts src/stores/chat.contract.test.ts src/stores/chat/session-store.test.ts
    }
    Invoke-AiriDeliveryStep 'gateway-contracts' { & $AiriNode ./node_modules/vitest/vitest.mjs run packages/realtime-voice/src packages/local-vision/src }
    Invoke-AiriDeliveryStep 'stage-theme' {
        Push-Location apps/stage-web
        try { & $AiriNode ../../node_modules/vitest/vitest.mjs run --project browser src/composables/theme-color.browser.test.ts }
        finally { Pop-Location }
    }
    Invoke-AiriDeliveryStep 'vision-service' {
        Push-Location services/local-vision
        try { & (Join-Path $AiriWorkspace '.runtime/vision-venv/Scripts/python.exe') -m unittest discover -s tests -p 'test*.py' }
        finally { Pop-Location }
    }
    Invoke-AiriDeliveryStep 'web-build' { & $AiriNode $AiriPnpm --config.verify-deps-before-run=false -F '@proj-airi/stage-web' build }
    # This checks the running process, not the build directory. Restart changed host/Python code before this gate.
    Invoke-AiriDeliveryStep 'live-gateways' { & $AiriNode (Join-Path $PSScriptRoot 'check-airi-gateways.mjs') }
    $AiriDeliveryPassed = $true
}
finally {
    Pop-Location
    @{task=$Task;checkedAt=[datetime]::UtcNow.ToString('o');automaticPassed=$AiriDeliveryPassed;checks=$AiriDeliveryResults.ToArray();manualChecksRequired=@('舞台启动→关闭→再启动，实际设备与服务器释放/恢复','休眠时设置→机体模块→长期记忆仍可访问','真实麦克风/扬声器连续对话、打断、换人；未具备设备或模型时明确待验收')} | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $AiriDeliveryDirectory 'result.json') -Encoding utf8
}
Write-Host "自动回归通过。还须记录真实 UI/设备验收及未验收边界：$AiriDeliveryDirectory/result.json"
