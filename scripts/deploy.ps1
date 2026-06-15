# scripts/deploy.ps1 — production deploy via Vercel CLI.
#
# Prerequisites (one-time):
#   1. npm i -g vercel
#   2. vercel link              (links this folder to your Vercel project)
#   3. Set env vars in Vercel dashboard (DATABASE_URL, DIRECT_URL, AUTH_SECRET, …)
#   4. Set Prisma schema provider to "postgresql" before first deploy.

[CmdletBinding()]
param(
    [switch]$Preview,
    [switch]$SkipMigrate,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

function Step($msg) {
    Write-Host ""
    Write-Host "▶ $msg" -ForegroundColor Cyan
}

# --- Sanity checks -----------------------------------------------------------

Step "Sanity checks"
if (-not (Get-Command vercel -ErrorAction SilentlyContinue)) {
    Write-Error "Vercel CLI not found. Run: npm i -g vercel"
    exit 1
}
if (-not (Test-Path ".vercel/project.json")) {
    Write-Error "Project not linked. Run: vercel link"
    exit 1
}

# Make sure we're on a clean working tree.
$dirty = git status --porcelain
if ($dirty) {
    Write-Warning "Working tree is dirty. Commit or stash before deploying."
    Write-Host $dirty
    if (-not $PSCmdlet.ShouldContinue("Continue anyway?", "Confirm deploy")) { exit 1 }
}

# --- Quality gates -----------------------------------------------------------

Step "Type-checking"
pnpm typecheck

if (-not $SkipBuild) {
    Step "Building (locally) to catch errors early"
    pnpm build
}

# --- DB migration ------------------------------------------------------------

if (-not $SkipMigrate) {
    Step "Syncing DB schema to production (prisma db push)"
    # Schema-sync strategy: the whole schema was built with `prisma db push`
    # (dialect-agnostic SQLite-dev / Postgres-prod). `db push` recreates the full
    # schema on Neon from schema.prisma — no migration history required. Set the
    # schema provider to `postgresql` first (see header).
    #
    # First deploy only: after this completes, seed the baseline once with
    #   npx dotenv -e .env.production -- tsx prisma/seed.ts
    # (admin + primary company + Chart of Accounts + models + series).
    #
    # Requires DATABASE_URL (or DIRECT_URL) in your local environment OR
    # pulled from vercel via `vercel env pull .env.production`.
    if (-not (Test-Path ".env.production")) {
        Write-Host "Pulling production env vars…" -ForegroundColor Yellow
        vercel env pull .env.production --environment=production
    }
    $env:DOTENV_CONFIG_PATH = ".env.production"
    npx --yes dotenv -e .env.production -- prisma db push --accept-data-loss
}

# --- Deploy ------------------------------------------------------------------

Step "Deploying to Vercel"
if ($Preview) {
    vercel deploy
} else {
    vercel deploy --prod
}

Step "Done"
