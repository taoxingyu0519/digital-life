param(
    [ValidateSet('web', 'desktop', 'channel')]
    [string]$Mode = 'web'
)
. (Join-Path $PSScriptRoot 'airi-env.ps1')
& (Join-Path $PSScriptRoot 'start-project-manager.ps1')
if ($Mode -eq 'web' -and (Test-Path -LiteralPath (Join-Path $AiriWorkspace '.runtime/vision-venv/Scripts/python.exe'))) {
    & (Join-Path $PSScriptRoot 'vision.ps1') start
}
Push-Location $AiriRepo
try {
    switch ($Mode) {
        'web' { & $AiriNode $AiriPnpm --filter '@proj-airi/stage-web' exec vite --host 127.0.0.1 --port 5173 --strictPort }
        'desktop' { & $AiriNode $AiriPnpm run dev:tamagotchi }
        'channel' { & $AiriNode $AiriPnpm run dev:server }
    }
    $AiriExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $AiriExitCode
