param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Message,

    [string]$Remote = "origin",

    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$repoRoot = git rev-parse --show-toplevel
Set-Location $repoRoot

$branch = git branch --show-current
if (-not $branch) {
    throw "Could not detect the current Git branch."
}

Write-Host "Repository: $repoRoot"
Write-Host "Branch: $branch"

if ($DryRun) {
    Write-Host ""
    Write-Host "Dry run: files that would be staged by git add ."
    git add -n .
    exit 0
}

Write-Host ""
Write-Host "Staging changes with: git add ."
git add .

$staged = git diff --cached --name-only
if (-not $staged) {
    Write-Host "No staged changes. Nothing to commit."
    exit 0
}

Write-Host ""
Write-Host "Staged files:"
$staged | ForEach-Object { Write-Host "  $_" }

Write-Host ""
git commit -m $Message

$remoteUrl = git remote get-url $Remote 2>$null
if (-not $remoteUrl) {
    Write-Host ""
    Write-Host "Remote '$Remote' is not configured."
    Write-Host "Add it with:"
    Write-Host "  git remote add $Remote https://github.com/YOUR_USER/YOUR_REPO.git"
    Write-Host "Then run this script again."
    exit 1
}

Write-Host ""
Write-Host "Pushing with: git push -u $Remote $branch"
git push -u $Remote $branch
