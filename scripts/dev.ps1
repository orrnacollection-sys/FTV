# scripts/dev.ps1 — stop anything on :3000, then start the dev server.
[CmdletBinding()]
param(
    [int]$Port = 3000,
    [int]$HeapMB = 4096,
    [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

# 1. Stop existing dev server.
& "$PSScriptRoot/stop.ps1" -Port $Port

# 2. Ensure deps installed.
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies…" -ForegroundColor Cyan
    pnpm install
}

# 3. Ensure DB exists.
if (-not (Test-Path "prisma/dev.db")) {
    Write-Host "Initializing dev database…" -ForegroundColor Cyan
    npx --yes prisma migrate dev --name init --skip-seed
    npx --yes tsx prisma/seed.ts
}

# 4. Start dev server.
# Bigger V8 heap: the Next 15 dev server leaks memory across HMR recompiles and,
# at the default ~2 GB cap, eventually GC-thrashes until its event loop freezes
# (port stays open but stops serving). 4 GB gives plenty of headroom for a long
# session. Override with -HeapMB if needed.
$env:NODE_OPTIONS = "--max-old-space-size=$HeapMB"
$env:PORT = "$Port"
Write-Host "Starting Next.js on http://localhost:$Port (heap ${HeapMB}MB) …" -ForegroundColor Green

if (-not $NoOpen) {
    Start-Job -ScriptBlock {
        Start-Sleep -Seconds 4
        Start-Process "http://localhost:$using:Port"
    } | Out-Null
}

pnpm dev
