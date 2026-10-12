# Run the project-local official CLI with the existing bundled Node runtime.
. (Join-Path $PSScriptRoot 'airi-env.ps1')
$storedCredentials = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'firecrawl-cli/credentials.json'
$credentialArguments = @($args | Where-Object { $_ -match '^(--api-key|--api-url|-k)(=|$)' })
if ($env:FIRECRAWL_API_KEY -or $env:FIRECRAWL_API_URL -or $credentialArguments.Count -gt 0 -or (Test-Path -LiteralPath $storedCredentials)) {
    throw 'This project uses keyless free Firecrawl only. Authenticated or custom API configuration requires a separate explicit setup.'
}
$cliEntry = Join-Path $AiriWorkspace '.tools/firecrawl/node_modules/firecrawl-cli/dist/index.js'
if (-not (Test-Path -LiteralPath $cliEntry)) {
    throw 'Firecrawl CLI is not installed in .tools/firecrawl.'
}
& $AiriNode $cliEntry @args
exit $LASTEXITCODE
