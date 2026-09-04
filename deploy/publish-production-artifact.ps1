param(
  [Parameter(Mandatory = $true)]
  [string]$RemoteHost,
  [string]$RemoteUser = 'ubuntu',
  [string]$SshKeyPath = '',
  [string]$Source4Path = '',
  [string]$DashboardPath = '',
  [string]$FrontendApiBaseUrl = '/api',
  [switch]$SkipInstall,
  [switch]$PruneLegacySource
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}

if ($RemoteHost -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw 'RemoteHost contains unsupported characters.' }
if ($RemoteUser -notmatch '^[A-Za-z_][A-Za-z0-9_-]*$') { throw 'RemoteUser contains unsupported characters.' }

$backendPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$builder = Join-Path $PSScriptRoot 'build-production-artifact.ps1'
$buildArgs = @('-File', $builder)
if ($Source4Path) { $buildArgs += @('-Source4Path', $Source4Path) }
if ($DashboardPath) { $buildArgs += @('-DashboardPath', $DashboardPath) }
if ($FrontendApiBaseUrl) { $buildArgs += @('-FrontendApiBaseUrl', $FrontendApiBaseUrl) }
if ($SkipInstall) { $buildArgs += '-SkipInstall' }
$buildOutput = @(& pwsh @buildArgs)
$builderExitCode = $LASTEXITCODE
if ($builderExitCode -ne 0) { throw "Local production artifact build failed with exit code $builderExitCode" }
$artifactPath = (($buildOutput | Select-Object -Last 1) ?? '').ToString().Trim()
if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) { throw "Artifact was not created: $artifactPath" }

$artifactName = Split-Path -Leaf $artifactPath
$remoteTarget = "${RemoteUser}@${RemoteHost}"
$sshOptions = @()
if ($SshKeyPath) {
  $key = (Resolve-Path -LiteralPath $SshKeyPath).Path
  $sshOptions += @('-i', $key)
}

$remoteHome = (& ssh @sshOptions $remoteTarget 'printf %s "$HOME"').Trim()
if (-not $remoteHome -or $remoteHome -notmatch '^/[A-Za-z0-9._/-]+$') { throw "Cannot resolve a safe remote home directory: $remoteHome" }
$remoteIncoming = "$remoteHome/cwi-platform/incoming/$artifactName"
Invoke-Checked 'ssh' ($sshOptions + @($remoteTarget, 'mkdir -p ~/cwi-platform/incoming'))
Invoke-Checked 'scp' ($sshOptions + @($artifactPath, "${remoteTarget}:$remoteIncoming"))

$installer = Join-Path $backendPath 'deploy/install-production-artifact.sh'
$installArgs = @('--artifact', $remoteIncoming)
if ($PruneLegacySource) { $installArgs += '--prune-legacy-source' }
$remoteInstaller = "$remoteHome/cwi-platform/incoming/.install-$artifactName.sh"
Invoke-Checked 'scp' ($sshOptions + @($installer, "${remoteTarget}:$remoteInstaller"))
$installCommand = "bash '$remoteInstaller' " + (($installArgs | ForEach-Object { "'$_'" }) -join ' ')
try {
  & ssh @sshOptions $remoteTarget $installCommand
  if ($LASTEXITCODE -ne 0) { throw "Remote artifact installation failed with exit code $LASTEXITCODE" }
} finally {
  & ssh @sshOptions $remoteTarget "rm -f '$remoteInstaller'" | Out-Null
}

Write-Output "Published $artifactName to $remoteTarget"
