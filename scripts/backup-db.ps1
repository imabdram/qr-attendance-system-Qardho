# Daily Neon snapshot backup for the Qardho attendance database.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-db.ps1
#
# Creates one snapshot per day named auto-YYYY-MM-DD on the production branch and
# deletes auto-* snapshots older than 14 days. Registered as the Windows scheduled
# task "Qardho DB Backup" (daily 02:00). Log: backups\backup.log

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$neon = Join-Path $env:APPDATA 'npm\neon.cmd'
if (-not (Test-Path $neon)) { $neon = 'neon' }

$logDir = Join-Path $root 'backups'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'backup.log'

function Write-Log($message) {
  $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
  Write-Output $line
  Add-Content -Path $log -Value $line
}

try {
  $today = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
  $snapshotName = "auto-$today"

  $listOutput = & $neon snapshots list 2>&1
  $rows = @($listOutput | Where-Object { $_ -match '^snap-' })

  # One snapshot per day: skip if anything was already taken today (UTC).
  $takenToday = $rows | Where-Object { $_ -match $today }
  if ($takenToday) {
    Write-Log "A snapshot from $today already exists, skipping."
    exit 0
  }

  Write-Log "Creating snapshot $snapshotName ..."
  $created = & $neon snapshots create --branch production --name $snapshotName 2>&1
  Write-Log ($created -join ' ')

  # Retention: keep 14 days of automatic snapshots.
  $cutoff = (Get-Date).ToUniversalTime().AddDays(-14)
  foreach ($row in $rows) {
    $cols = $row -split '\s{2,}'
    if ($cols.Count -lt 4) { continue }
    $id = $cols[0]
    $nameCol = $cols[1]
    $createdAt = $cols[3]
    if ($nameCol -notlike 'auto-*') { continue }
    $parsed = [datetime]::MinValue
    if (-not [datetime]::TryParse($createdAt, [ref]$parsed)) { continue }
    if ($parsed.ToUniversalTime() -lt $cutoff) {
      Write-Log "Deleting old snapshot $nameCol ($id)"
      & $neon snapshots delete $id 2>&1 | Out-Null
    }
  }

  Write-Log 'Backup complete.'
} catch {
  Write-Log "BACKUP FAILED: $($_.Exception.Message)"
  exit 1
}
