# Pulls the CWI production backups (already encrypted on the server) to this PC.
# Run by the Windows Task Scheduler task "CWI - Keo backup prod" every day and at logon.
#
#   D:\CWI-Backups\db\<UTC time>\      encrypted database dumps (kept 90 days here)
#   D:\CWI-Backups\storage\...\*.gpg   encrypted copy of every Storage file (PDFs), only new files are downloaded
#   D:\CWI-Backups\storage-deleted\<date>\   copies of files deleted on the platform, removed after 90 days
#   D:\CWI-Backups\logs\               one log per day
#   D:\CWI-Backups\TRANG-THAI.txt      result of the last run, in plain words
# Problems (pull failed, server backup failed or older than 2 days, restore test failed) also
# show a Windows notification.
param(
  [string]$Root = 'D:\CWI-Backups',
  [string]$Server = 'ubuntu@18.139.252.111',
  [string]$RemoteBase = '/home/ubuntu/cwi-backups/auto',
  [int]$KeepDays = 90
)

$ErrorActionPreference = 'Stop'
$ssh = 'C:\Windows\System32\OpenSSH\ssh.exe'
$scp = 'C:\Windows\System32\OpenSSH\scp.exe'
$sshOpts = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=30', '-o', 'ServerAliveInterval=30')
New-Item -ItemType Directory -Force -Path "$Root\db", "$Root\storage", "$Root\logs" | Out-Null
$log = Join-Path $Root ("logs\pull-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
function Log([string]$message) { Add-Content -Path $log -Value ("{0}  {1}" -f (Get-Date -Format 'HH:mm:ss'), $message) -Encoding UTF8 }

function Notify([string]$title, [string]$text) {
  try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $nodes = $xml.GetElementsByTagName('text')
    $nodes.Item(0).AppendChild($xml.CreateTextNode($title)) | Out-Null
    $nodes.Item(1).AppendChild($xml.CreateTextNode($text)) | Out-Null
    $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
  } catch { Log "notification failed: $($_.Exception.Message)" }
}

function Remote([string]$command) {
  $out = & $ssh @sshOpts $Server $command 2>&1
  if ($LASTEXITCODE -ne 0) { throw "ssh failed ($LASTEXITCODE): $out" }
  return $out
}

$problems = New-Object System.Collections.Generic.List[string]
$summary = New-Object System.Collections.Generic.List[string]
try {
  Log '=== pull started'

  # 1. Server status.
  $latest = (Remote "cat $RemoteBase/LATEST.json") -join '' | ConvertFrom-Json
  $age = (New-TimeSpan -Start ([DateTime]::Parse($latest.time).ToUniversalTime()) -End (Get-Date).ToUniversalTime()).TotalHours
  $summary.Add(("Backup moi nhat tren server: {0} UTC ({1:N0} gio truoc), ket qua: {2}" -f $latest.time, $age, $(if ($latest.ok) { 'OK' } else { 'LOI - ' + $latest.message })))
  if (-not $latest.ok) { $problems.Add("Backup tren server bi loi: $($latest.message)") }
  if ($age -gt 48) { $problems.Add(("Backup tren server da {0:N0} gio chua chay lai" -f $age)) }
  if ($latest.restoreCheck) {
    $summary.Add(("Lan thu khoi phuc gan nhat: {0} UTC, ket qua: {1}" -f $latest.restoreCheck.time, $(if ($latest.restoreCheck.ok) { 'OK' } else { 'LOI' })))
    if (-not $latest.restoreCheck.ok) { $problems.Add('Lan thu khoi phuc backup hang tuan bi loi') }
  }

  # 2. Database dumps: download every server folder this PC does not have yet.
  $remoteDirs = @(Remote "cd $RemoteBase/db && ls -1" | Where-Object { $_ -match '^\d{8}-\d{6}$' })
  $newDirs = 0
  foreach ($dir in $remoteDirs) {
    $local = Join-Path $Root "db\$dir"
    if (Test-Path (Join-Path $local 'SHA256SUMS')) { continue }
    $tmp = "$local.part"
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    & $scp @sshOpts -q -r "${Server}:$RemoteBase/db/$dir" $tmp
    if ($LASTEXITCODE -ne 0) { throw "scp of db/$dir failed" }
    foreach ($line in Get-Content (Join-Path $tmp 'SHA256SUMS')) {
      $parts = $line -split '\s+', 2
      $file = Join-Path $tmp ($parts[1] -replace '^\./', '')
      if ((Get-FileHash -Algorithm SHA256 $file).Hash.ToLower() -ne $parts[0]) { throw "checksum mismatch in db/$dir" }
    }
    Rename-Item $tmp $local
    $newDirs++
  }
  $summary.Add("Ban sao database: tai them $newDirs, tong cong $(@(Get-ChildItem "$Root\db" -Directory | Where-Object Name -match '^\d{8}-\d{6}$').Count) ban")

  # 3. Storage: list encrypted files on the server, fetch the missing ones in one tar stream.
  $remoteFiles = @{}
  foreach ($line in (Remote "cd $RemoteBase/storage && find . -type f -name '*.gpg' -printf '%P\t%s\n'")) {
    $p = $line -split "`t"
    if ($p.Count -eq 2) { $remoteFiles[$p[0]] = [int64]$p[1] }
  }
  $missing = @($remoteFiles.Keys | Where-Object {
    $localFile = Join-Path "$Root\storage" ($_ -replace '/', '\')
    -not (Test-Path -LiteralPath $localFile) -or (Get-Item -LiteralPath $localFile).Length -ne $remoteFiles[$_]
  })
  if ($missing.Count) {
    $listFile = Join-Path $env:TEMP "cwi-pull-list.txt"
    $tarFile = Join-Path $env:TEMP "cwi-pull-storage.tar"
    [IO.File]::WriteAllText($listFile, (($missing -join "`n") + "`n"))
    $proc = Start-Process -FilePath $ssh -ArgumentList ($sshOpts + @($Server, "cd $RemoteBase/storage && tar -cf - -T -")) -RedirectStandardInput $listFile -RedirectStandardOutput $tarFile -RedirectStandardError "$tarFile.err" -NoNewWindow -PassThru -Wait
    if ($proc.ExitCode -ne 0) { throw "storage download failed: $(Get-Content "$tarFile.err" -Raw)" }
    & tar.exe -xf $tarFile -C "$Root\storage"
    if ($LASTEXITCODE -ne 0) { throw 'storage extract failed' }
    Remove-Item $tarFile, "$tarFile.err", $listFile -Force -ErrorAction SilentlyContinue
  }
  $summary.Add("File PDF (Storage): tai them $($missing.Count), tong cong $($remoteFiles.Count) file tren server")
  if ($latest.warning) { $problems.Add("Server canh bao: $($latest.warning)") }

  # 3b. Copies of files deleted on the platform (no longer on the server list) move to
  # storage-deleted\<date>\ and are removed after $KeepDays days. Safety stop: if more than 20 %
  # would move at once, move nothing and warn (a broken listing must never empty the copy).
  $storageRoot = "$Root\storage"
  $localFiles = @(Get-ChildItem -LiteralPath $storageRoot -Recurse -File -Filter '*.gpg' | ForEach-Object { $_.FullName.Substring($storageRoot.Length + 1) -replace '\\', '/' })
  $gone = @($localFiles | Where-Object { -not $remoteFiles.ContainsKey($_) })
  if ($gone.Count) {
    if ($remoteFiles.Count -eq 0 -or ($gone.Count * 5) -gt $localFiles.Count) {
      $problems.Add("$($gone.Count)/$($localFiles.Count) file PDF tren may khong con tren server; KHONG don (chot an toan), can kiem tra")
    } else {
      $today = Get-Date -Format 'yyyy-MM-dd'
      foreach ($rel in $gone) {
        $from = Join-Path $storageRoot ($rel -replace '/', '\')
        $to = Join-Path "$Root\storage-deleted\$today" ($rel -replace '/', '\')
        New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null
        Move-Item -LiteralPath $from -Destination $to -Force
      }
      Get-ChildItem -LiteralPath $storageRoot -Recurse -Directory | Sort-Object { $_.FullName.Length } -Descending | Where-Object { -not (Get-ChildItem -LiteralPath $_.FullName -Force) } | Remove-Item -Force
      $summary.Add("File PDF da bi xoa tren he thong: chuyen $($gone.Count) file sang storage-deleted\$today (giu $KeepDays ngay)")
    }
  }
  if (Test-Path "$Root\storage-deleted") {
    $deletedCutoff = (Get-Date).AddDays(-$KeepDays).ToString('yyyy-MM-dd')
    Get-ChildItem "$Root\storage-deleted" -Directory | Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}$' -and $_.Name -lt $deletedCutoff } | ForEach-Object {
      Remove-Item -Recurse -Force $_.FullName
      $summary.Add("Da xoa han storage-deleted\$($_.Name) (qua $KeepDays ngay)")
    }
  }

  # 4. Keep $KeepDays days of database copies on this PC (only folders named like a backup).
  $cutoff = (Get-Date).AddDays(-$KeepDays)
  Get-ChildItem "$Root\db" -Directory | Where-Object { $_.Name -match '^\d{8}-\d{6}$' -and $_.CreationTime -lt $cutoff } | ForEach-Object {
    Remove-Item -Recurse -Force $_.FullName
    Log "removed old copy db\$($_.Name)"
  }
  Get-ChildItem "$Root\logs" -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-180) } | Remove-Item -Force
} catch {
  $problems.Add("Keo backup ve may bi loi: $($_.Exception.Message)")
}

$state = if ($problems.Count) { 'CAN KIEM TRA' } else { 'OK' }
$text = @("Ket qua lan keo backup luc $(Get-Date -Format 'yyyy-MM-dd HH:mm'): $state", '') + $summary + $(if ($problems.Count) { @('', 'Van de:') + ($problems | ForEach-Object { "- $_" }) } else { @() }) + @('', "Chi tiet: $log")
Set-Content -Path (Join-Path $Root 'TRANG-THAI.txt') -Value $text -Encoding UTF8
$text | ForEach-Object { Log $_ }
if ($problems.Count) { Notify 'CWI backup can kiem tra' ($problems -join '; ') ; exit 1 }
exit 0
