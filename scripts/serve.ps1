# scripts/serve.ps1 — PRODUCTION server: stop :3000, build, then `next start`.
#
# Use this instead of dev.ps1 for stable, long-running sessions. The optimized
# production server has no dev-mode HMR memory leak, so it stays up for hours/days
# without the "listening but not serving" freeze the Next 15.0.3 dev server hits.
#
# Trade-off vs dev.ps1: no hot reload. After a code change, re-run this (it
# rebuilds) — or `-SkipBuild` to just restart the existing build.
[CmdletBinding()]
param(
    [int]$Port = 3000,
    [int]$HeapMB = 4096,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

# 1. Stop whatever is on the port (dev or a previous prod server).
& "$PSScriptRoot/stop.ps1" -Port $Port

# 2. Ensure deps + DB exist.
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies…" -ForegroundColor Cyan
    pnpm install
}
if (-not (Test-Path "prisma/dev.db")) {
    Write-Host "Initializing dev database…" -ForegroundColor Cyan
    npx --yes prisma migrate dev --name init --skip-seed
    npx --yes tsx prisma/seed.ts
}

# Roomy heap for the build step; harmless for `next start`.
$env:NODE_OPTIONS = "--max-old-space-size=$HeapMB"

# 3. Production build (skip to reuse an existing .next).
if (-not $SkipBuild) {
    Write-Host "Building production bundle…" -ForegroundColor Cyan
    pnpm build
}

# 4. Start the optimized server.
$env:PORT = "$Port"
Write-Host "Starting PRODUCTION server on http://localhost:$Port …" -ForegroundColor Green
pnpm start
