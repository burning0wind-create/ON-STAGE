$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$runtimeNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path -LiteralPath $runtimeNode)) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) { throw 'Install Node.js 22.13+ first.' }
  $runtimeNode = $nodeCommand.Source
}
try {
  $running = Invoke-RestMethod 'http://127.0.0.1:4318/api/config' -TimeoutSec 2
  if ($running.name -eq 'ON STAGE') { Start-Process 'http://127.0.0.1:4318'; exit 0 }
} catch {}
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\pdfjs-dist'))) {
  Write-Host 'Run pnpm install --frozen-lockfile, or npm install, in this folder first.'
  exit 1
}
Write-Host 'ON STAGE: http://127.0.0.1:4318'
Write-Host 'Keep this window open. Ctrl+C stops the local service.'
Start-Process 'http://127.0.0.1:4318'
& $runtimeNode --env-file-if-exists=.env.local src/server.js
