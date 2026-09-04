param(
  [string]$Source4Path = '',
  [string]$DashboardPath = '',
  [string]$OutputDirectory = '',
  [string]$ReleaseId = '',
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Resolve-RequiredPath([string]$PathValue, [string]$Label) {
  if (-not $PathValue -or -not (Test-Path -LiteralPath $PathValue -PathType Container)) {
    throw "$Label does not exist: $PathValue"
  }
  return (Resolve-Path -LiteralPath $PathValue).Path
}

function Invoke-Npm([string]$WorkingDirectory, [string[]]$Arguments) {
  Push-Location $WorkingDirectory
  try {
    & npm.cmd @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "npm command failed in $WorkingDirectory with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Get-GitSha([string]$RepositoryPath) {
  Push-Location $RepositoryPath
  try {
    $sha = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $sha) { throw "Cannot read Git commit from $RepositoryPath" }
    return $sha
  } finally {
    Pop-Location
  }
}

function Assert-CleanRepository([string]$RepositoryPath, [string]$Label) {
  Push-Location $RepositoryPath
  try {
    $status = @(git status --porcelain=v1 --untracked-files=all)
    if ($LASTEXITCODE -ne 0) { throw "Cannot inspect Git status for $Label" }
    if ($status.Count -gt 0) {
      throw "$Label has uncommitted or untracked files. Commit or clean the repository before creating a production artifact."
    }
  } finally {
    Pop-Location
  }
}

$backendPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$workspacePath = (Resolve-Path -LiteralPath (Join-Path $backendPath '..')).Path
if (-not $Source4Path) { $Source4Path = Join-Path $workspacePath 'source4' }
if (-not $DashboardPath) { $DashboardPath = Join-Path $workspacePath 'cwi-dashboard' }
$Source4Path = Resolve-RequiredPath $Source4Path 'source4 repository'
$DashboardPath = Resolve-RequiredPath $DashboardPath 'cwi-dashboard repository'
$backendPath = Resolve-RequiredPath $backendPath 'cwi-backend repository'

Assert-CleanRepository $Source4Path 'source4 repository'
Assert-CleanRepository $DashboardPath 'cwi-dashboard repository'
Assert-CleanRepository $backendPath 'cwi-backend repository'

if (-not $ReleaseId) { $ReleaseId = [DateTime]::UtcNow.ToString('yyyyMMddHHmmss') }
if ($ReleaseId -notmatch '^[0-9A-Za-z._-]+$') { throw 'ReleaseId contains unsupported characters.' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $backendPath '.artifacts' }
$OutputDirectory = (New-Item -ItemType Directory -Force -Path $OutputDirectory).FullName

if (-not $SkipInstall) {
  Invoke-Npm $Source4Path @('ci', '--no-audit', '--no-fund')
  Invoke-Npm $DashboardPath @('ci', '--no-audit', '--no-fund')
  Invoke-Npm $backendPath @('ci', '--no-audit', '--no-fund')
}

Invoke-Npm $Source4Path @('run', 'build')
Invoke-Npm $DashboardPath @('run', 'build')
Invoke-Npm $backendPath @('run', 'build')

$stagePath = Join-Path $OutputDirectory ".stage-$ReleaseId"
$artifactPath = Join-Path $OutputDirectory "cwi-release-$ReleaseId.tar.gz"
if (Test-Path -LiteralPath $stagePath) { Remove-Item -LiteralPath $stagePath -Recurse -Force }
if (Test-Path -LiteralPath $artifactPath) { Remove-Item -LiteralPath $artifactPath -Force }

New-Item -ItemType Directory -Force -Path (Join-Path $stagePath 'source4') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stagePath 'cwi-dashboard') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stagePath 'cwi-backend') | Out-Null

Copy-Item -LiteralPath (Join-Path $Source4Path 'dist') -Destination (Join-Path $stagePath 'source4') -Recurse
Copy-Item -LiteralPath (Join-Path $DashboardPath 'dist') -Destination (Join-Path $stagePath 'cwi-dashboard') -Recurse
Copy-Item -LiteralPath (Join-Path $backendPath 'dist') -Destination (Join-Path $stagePath 'cwi-backend') -Recurse
Copy-Item -LiteralPath (Join-Path $backendPath 'package.json') -Destination (Join-Path $stagePath 'cwi-backend')
Copy-Item -LiteralPath (Join-Path $backendPath 'package-lock.json') -Destination (Join-Path $stagePath 'cwi-backend')

$runtimeFiles = @(
  'cwi-public-router.mjs',
  'ecosystem.config.cjs',
  'start-backend.mjs',
  'start-export-worker.mjs',
  'start-report-delivery-worker.mjs',
  'start-report-generation-worker.mjs'
)
$runtimeDirectory = Join-Path $stagePath 'cwi-backend/deploy'
New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
foreach ($runtimeFile in $runtimeFiles) {
  Copy-Item -LiteralPath (Join-Path $backendPath "deploy/$runtimeFile") -Destination $runtimeDirectory
}

$marker = [ordered]@{
  artifactVersion = 1
  releaseId = $ReleaseId
  builtAt = [DateTime]::UtcNow.ToString('o')
  repositories = [ordered]@{
    source4 = Get-GitSha $Source4Path
    cwiDashboard = Get-GitSha $DashboardPath
    cwiBackend = Get-GitSha $backendPath
  }
}
$marker | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $stagePath 'release.json') -Encoding utf8
Set-Content -LiteralPath (Join-Path $stagePath '.artifact-release') -Value $ReleaseId -Encoding ascii

$hashLines = [System.Collections.Generic.List[string]]::new()
$stagePrefix = "$($stagePath.TrimEnd('\'))\"
Get-ChildItem -LiteralPath $stagePath -Recurse -File | ForEach-Object {
  if ($_.Name -eq 'manifest.sha256') { return }
  $relative = $_.FullName.Substring($stagePrefix.Length).Replace('\', '/')
  $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $hashLines.Add("$hash  $relative")
}
[System.IO.File]::WriteAllLines((Join-Path $stagePath 'manifest.sha256'), $hashLines, [System.Text.UTF8Encoding]::new($false))

if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) { throw 'tar.exe is required to create the production artifact.' }
& tar.exe -czf $artifactPath -C $stagePath '.'
if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE" }

Remove-Item -LiteralPath $stagePath -Recurse -Force
Write-Output $artifactPath
