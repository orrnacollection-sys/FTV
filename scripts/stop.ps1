# scripts/stop.ps1 — kill any process listening on the dev port.
[CmdletBinding()]
param(
    [int]$Port = 3000
)

$pids = @()
try {
    $pids = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
        Select-Object -ExpandProperty OwningProcess -Unique
} catch {
    # No listener found — nothing to stop.
}

if (-not $pids -or $pids.Count -eq 0) {
    Write-Host "No process listening on :$Port." -ForegroundColor DarkGray
    exit 0
}

foreach ($id in $pids) {
    try {
        $proc = Get-Process -Id $id -ErrorAction Stop
        Write-Host "Stopping PID $id ($($proc.ProcessName)) on :$Port…" -ForegroundColor Yellow
        Stop-Process -Id $id -Force -ErrorAction Stop
    } catch {
        Write-Warning "Could not stop PID $($id): $_"
    }
}

Start-Sleep -Milliseconds 300
Write-Host "Done." -ForegroundColor Green
