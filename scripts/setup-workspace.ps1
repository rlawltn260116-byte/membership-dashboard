param(
  [string]$TargetDir = "$env:USERPROFILE\Downloads\dashboard_fixed_v9_app",
  [switch]$SkipServer
)

$ErrorActionPreference = "Stop"

$repoUrl = "https://github.com/rlawltn260116-byte/membership-dashboard.git"

function Require-Command($Name, $InstallHint) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw "$Name is not installed. $InstallHint"
}

$git = Require-Command "git" "Install Git for Windows, then run this again."

$parent = Split-Path -Parent $TargetDir
if ($parent -and -not (Test-Path -LiteralPath $parent)) {
  New-Item -ItemType Directory -Path $parent | Out-Null
}

if (Test-Path -LiteralPath (Join-Path $TargetDir ".git")) {
  Write-Host "Updating existing workspace: $TargetDir"
  Set-Location -LiteralPath $TargetDir
  & $git pull --ff-only origin main
} elseif (Test-Path -LiteralPath $TargetDir) {
  throw "Target directory exists but is not a git repo: $TargetDir"
} else {
  Write-Host "Cloning workspace to: $TargetDir"
  & $git clone $repoUrl $TargetDir
  Set-Location -LiteralPath $TargetDir
}

$gh = Get-Command "gh" -ErrorAction SilentlyContinue
if ($gh) {
  & $gh.Source auth status *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Opening GitHub login. Approve it once in the browser."
    & $gh.Source auth login
  }
} else {
  Write-Host "GitHub CLI is not installed. Git may ask for browser login when pushing."
}

if (-not $SkipServer) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $TargetDir "scripts\start-local.ps1")
}

Write-Host "Workspace ready: $TargetDir"
