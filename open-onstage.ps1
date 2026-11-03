$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
function Test-OnStage {
  try { return (Invoke-RestMethod 'http://127.0.0.1:4318/api/config' -TimeoutSec 2).name -eq 'ON STAGE' } catch { return $false }
}
try {
  if (-not (Test-OnStage)) {
    $runtimeNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (-not (Test-Path -LiteralPath $runtimeNode)) { $runtimeNode = (Get-Command node -ErrorAction Stop).Source }
    $service = Start-Process -FilePath $runtimeNode -ArgumentList '--env-file-if-exists=.env.local src/server.js' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'integration-server.log') -RedirectStandardError (Join-Path $PSScriptRoot 'integration-server-error.log') -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-OnStage)) {
      if ([DateTime]::UtcNow -gt $deadline -or $service.HasExited) { throw 'The local service could not start. Check integration-server-error.log in the project folder.' }
      Start-Sleep -Milliseconds 250
    }
  }
  Start-Process 'http://127.0.0.1:4318/#home'
} catch {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($_.Exception.Message, 'ON STAGE') | Out-Null
  exit 1
}
