param(
  [int]$Days = 30,
  [switch]$Json
)

$ErrorActionPreference = "Stop"

if ($Days -lt 1 -or $Days -gt 730) {
  throw "Days must be from 1 to 730."
}

$hostName = if ($env:MIND_ATLAS_VPS_HOST) { $env:MIND_ATLAS_VPS_HOST } else { "mind-atlas.org" }
$sshUser = if ($env:MIND_ATLAS_VPS_USER) { $env:MIND_ATLAS_VPS_USER } else { "root" }
$keyPath = if ($env:MIND_ATLAS_VPS_KEY_PATH) { $env:MIND_ATLAS_VPS_KEY_PATH } else { Join-Path $HOME ".ssh\mind-atlas-api-key-01.pem" }
$appPath = if ($env:MIND_ATLAS_VPS_APP_PATH) { $env:MIND_ATLAS_VPS_APP_PATH } else { "/opt/mind-atlas" }

if (-not (Test-Path -LiteralPath $keyPath)) {
  throw "SSH key was not found: $keyPath. Set MIND_ATLAS_VPS_KEY_PATH."
}

$jsonFlag = if ($Json) { " --json" } else { "" }
$remoteCommand = "cd '$appPath' && npm run service:admin -- growth-report --days $Days$jsonFlag"

& ssh -o BatchMode=yes -o ConnectTimeout=15 -i $keyPath "$sshUser@$hostName" $remoteCommand
if ($LASTEXITCODE -ne 0) {
  throw "KPI command failed with exit code $LASTEXITCODE."
}
