param(
  [Parameter(Mandatory = $true)][int]$RootPid,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [ValidateRange(1, 1000)][int]$Samples = 25,
  [ValidateRange(10, 3600)][int]$PeriodSeconds = 300
)

$ErrorActionPreference = 'Stop'
$startedAt = [DateTimeOffset]::UtcNow
$outputDirectory = Split-Path -Parent $OutputPath
[IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
if (Test-Path -LiteralPath $OutputPath) {
  throw "Memory evidence already exists: $OutputPath"
}

$initialRoot = Get-CimInstance Win32_Process -Filter "ProcessId=$RootPid"
if (-not $initialRoot) {
  throw "Root process does not exist: $RootPid"
}
$rootCreatedAt = [DateTime]$initialRoot.CreationDate
$rootName = [string]$initialRoot.Name
$profilePath = $null
if ($rootName -ieq 'msedge.exe' -and $initialRoot.CommandLine) {
  $profileMatch = [regex]::Match(
    [string]$initialRoot.CommandLine,
    '--user-data-dir=(?:"([^"]+)"|([^\s]+))'
  )
  if ($profileMatch.Success) {
    $profilePath = if ($profileMatch.Groups[1].Success) {
      $profileMatch.Groups[1].Value
    } else {
      $profileMatch.Groups[2].Value
    }
  }
}

for ($index = 0; $index -lt $Samples; $index += 1) {
  $capturedAt = [DateTimeOffset]::UtcNow
  $processRows = @(
    Get-CimInstance Win32_Process |
      Select-Object ProcessId, ParentProcessId, Name, CommandLine, CreationDate
  )
  $wanted = [Collections.Generic.HashSet[int]]::new()
  $selection = 'creation-checked-ancestry'

  if ($profilePath) {
    $selection = 'edge-user-data-dir'
    foreach ($row in $processRows) {
      if (
        $row.Name -ieq $rootName -and
        $row.CommandLine -and
        ([string]$row.CommandLine).IndexOf(
          $profilePath,
          [StringComparison]::OrdinalIgnoreCase
        ) -ge 0 -and
        [DateTime]$row.CreationDate -ge $rootCreatedAt
      ) {
        [void]$wanted.Add([int]$row.ProcessId)
      }
    }
  } else {
    [void]$wanted.Add($RootPid)
    $createdByPid = [Collections.Generic.Dictionary[int, DateTime]]::new()
    $createdByPid[$RootPid] = $rootCreatedAt
    $changed = $true
    while ($changed) {
      $changed = $false
      foreach ($row in $processRows) {
        $parentPid = [int]$row.ParentProcessId
        $processId = [int]$row.ProcessId
        if ($wanted.Contains($parentPid) -and -not $wanted.Contains($processId)) {
          $childCreatedAt = [DateTime]$row.CreationDate
          if (
            $childCreatedAt -ge $createdByPid[$parentPid] -and
            $childCreatedAt -ge $rootCreatedAt -and
            $wanted.Add($processId)
          ) {
            $createdByPid[$processId] = $childCreatedAt
            $changed = $true
          }
        }
      }
    }
  }

  $privateBytes = [int64]0
  $workingSetBytes = [int64]0
  $validProcessCount = 0
  foreach ($processId in $wanted) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    $privateBytes += [int64]$process.PrivateMemorySize64
    $workingSetBytes += [int64]$process.WorkingSet64
    $validProcessCount += 1
  }

  $record = [ordered]@{
    index = $index
    at = $capturedAt.ToString('o')
    elapsedMs = [int64]($capturedAt - $startedAt).TotalMilliseconds
    rootPid = $RootPid
    processCount = $validProcessCount
    privateBytes = $privateBytes
    workingSetBytes = $workingSetBytes
    valid = $validProcessCount -gt 0
    selection = $selection
  }
  [IO.File]::AppendAllText(
    $OutputPath,
    (($record | ConvertTo-Json -Compress) + [Environment]::NewLine),
    [Text.UTF8Encoding]::new($false)
  )

  if ($index + 1 -lt $Samples) {
    $nextAt = $startedAt.AddSeconds(($index + 1) * $PeriodSeconds)
    $remainingMs = [int][Math]::Max(0, ($nextAt - [DateTimeOffset]::UtcNow).TotalMilliseconds)
    Start-Sleep -Milliseconds $remainingMs
  }
}
