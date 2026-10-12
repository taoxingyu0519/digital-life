$ErrorActionPreference = 'Stop'
$AiriWorkspace = Split-Path -Parent $PSScriptRoot
$AiriRepo = Join-Path $AiriWorkspace 'airi'
$AiriPnpm = Join-Path $AiriWorkspace '.tools\pnpm-11.24.0\bin\pnpm.mjs'
$AiriBundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (Test-Path -LiteralPath $AiriBundledNode) {
    $AiriNode = $AiriBundledNode
} else {
    $AiriNode = (Get-Command node.exe -ErrorAction Stop).Source
}
if (-not (Test-Path -LiteralPath $AiriPnpm)) {
    throw "Missing pnpm: $AiriPnpm"
}
$env:Path = "$(Join-Path $AiriWorkspace '.tools\bin');$(Split-Path -Parent $AiriNode);$env:Path"
$AiriBundledGit = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git'
if (Test-Path -LiteralPath (Join-Path $AiriBundledGit 'cmd\git.exe')) {
    $env:Path = "$(Join-Path $AiriBundledGit 'cmd');$env:Path"
    $env:GIT_EXEC_PATH = Join-Path $AiriBundledGit 'mingw64\bin'
}
