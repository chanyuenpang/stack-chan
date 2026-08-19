Set-StrictMode -Version Latest

function Write-AtomicJson([string]$Path, [object]$Value) {
    $temporary = "$Path.new"
    $Value | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $temporary -Encoding utf8
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Get-ChunkPlan([long]$Offset, [long]$Length, [long]$ChunkSize) {
    if ($Offset -lt 0 -or $Length -le 0 -or $ChunkSize -le 0) { throw 'Invalid chunk plan inputs.' }
    $plan = [Collections.Generic.List[object]]::new()
    for ($index = 0; ; $index++) {
        $relative = [long]$index * $ChunkSize
        if ($relative -ge $Length) { break }
        $chunkLength = [Math]::Min($ChunkSize, $Length - $relative)
        $plan.Add([pscustomobject]@{ index=$index; address=$Offset + $relative; length=$chunkLength })
    }
    if (($plan | Measure-Object -Property length -Sum).Sum -ne $Length) { throw 'Chunk plan coverage mismatch.' }
    return ,$plan
}

function Get-CombinedSha256([Collections.Generic.List[object]]$Plan, [string]$Directory, [string]$Prefix) {
    $hasher = [Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
    try {
        foreach ($chunk in $Plan) {
            $path = Join-Path $Directory ("$Prefix-chunk-{0:D2}.bin" -f $chunk.index)
            $stream = [IO.File]::OpenRead($path)
            try {
                [byte[]]$buffer = [byte[]]::new(1MB)
                while (($count = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $hasher.AppendData($buffer, 0, $count)
                }
            } finally { $stream.Dispose() }
        }
        return [Convert]::ToHexString($hasher.GetHashAndReset())
    } finally { $hasher.Dispose() }
}

function Join-ChunkFiles([Collections.Generic.List[object]]$Plan, [string]$Directory, [string]$Prefix, [string]$Destination) {
    $temporary = "$Destination.new"
    $output = [IO.File]::Create($temporary)
    try {
        foreach ($chunk in $Plan) {
            $path = Join-Path $Directory ("$Prefix-chunk-{0:D2}.bin" -f $chunk.index)
            $input = [IO.File]::OpenRead($path)
            try { $input.CopyTo($output) } finally { $input.Dispose() }
        }
    } finally { $output.Dispose() }
    Move-Item -LiteralPath $temporary -Destination $Destination -Force
}

function Assert-ChunkEvidence([Collections.Generic.List[object]]$Plan, [string]$Directory, [string]$Prefix, [object[]]$Records) {
    foreach ($chunk in $Plan) {
        $path = Join-Path $Directory ("$Prefix-chunk-{0:D2}.bin" -f $chunk.index)
        $record = @($Records | Where-Object index -eq $chunk.index)
        if ((Test-Path -LiteralPath $path) -or $record.Count -ne 0) {
            if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or $record.Count -ne 1 -or
                $record[0].address -ne ('0x{0:x}' -f $chunk.address) -or
                $record[0].length -ne $chunk.length -or
                (Get-Item -LiteralPath $path).Length -ne $chunk.length -or
                (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $record[0].sha256) {
                throw "Existing $Prefix chunk evidence is inconsistent; nothing was overwritten."
            }
        }
    }
}

function Invoke-ChunkReadSet {
    param(
        [Parameter(Mandatory = $true)][Collections.Generic.List[object]]$Plan,
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][string]$AttemptDirectory,
        [Parameter(Mandatory = $true)][ValidateSet('backup','readback')][string]$Prefix,
        [Parameter(Mandatory = $true)][object]$State,
        [Parameter(Mandatory = $true)][string]$StatePath,
        [Parameter(Mandatory = $true)][scriptblock]$Transport
    )
    $propertyName = "${Prefix}_chunks"
    $records = [Collections.Generic.List[object]]::new()
    foreach ($record in @($State.$propertyName)) { $records.Add($record) }
    Assert-ChunkEvidence -Plan $Plan -Directory $Directory -Prefix $Prefix -Records $records

    foreach ($chunk in $Plan) {
        $finalPath = Join-Path $Directory ("$Prefix-chunk-{0:D2}.bin" -f $chunk.index)
        if (Test-Path -LiteralPath $finalPath) { continue }
        $partialPath = Join-Path $AttemptDirectory ("$Prefix-chunk-{0:D2}.partial" -f $chunk.index)
        $action = [pscustomobject]@{
            name = ("$Prefix-chunk-{0:D2}" -f $chunk.index)
            operation = 'read_flash'
            address = $chunk.address
            length = $chunk.length
            path = $partialPath
            after = 'no_reset'
        }
        & $Transport $action | Out-Null
        if (-not (Test-Path -LiteralPath $partialPath -PathType Leaf) -or
            (Get-Item -LiteralPath $partialPath).Length -ne $chunk.length) {
            throw "$Prefix chunk $($chunk.index) is incomplete; partial evidence was preserved."
        }
        $hash = (Get-FileHash -LiteralPath $partialPath -Algorithm SHA256).Hash
        Move-Item -LiteralPath $partialPath -Destination $finalPath
        $records.Add([pscustomobject]@{
            index = $chunk.index
            address = ('0x{0:x}' -f $chunk.address)
            length = $chunk.length
            sha256 = $hash
        })
        $State.$propertyName = $records
        Write-AtomicJson -Path $StatePath -Value $State
    }
}

function Invoke-StackChanAppOnlyTransaction {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$CandidatePath,
        [Parameter(Mandatory = $true)][ValidatePattern('^[0-9A-Fa-f]{64}$')][string]$ExpectedSha256,
        [Parameter(Mandatory = $true)][long]$ExpectedLength,
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][scriptblock]$Transport,
        [switch]$FinalHardReset,
        [long]$AppOffset = 0x20000,
        [long]$AppPartitionSize = 0x4f0000,
        [long]$ChunkSize = 0x100000
    )

    if (-not $FinalHardReset) { throw 'A complete app-only transaction requires the single final hard reset.' }
    $candidateResolved = [IO.Path]::GetFullPath($CandidatePath)
    $evidenceResolved = [IO.Path]::GetFullPath($EvidenceDirectory)
    if (-not (Test-Path -LiteralPath $candidateResolved -PathType Leaf)) { throw 'Candidate is missing.' }
    $candidate = Get-Item -LiteralPath $candidateResolved
    $candidateHash = (Get-FileHash -LiteralPath $candidateResolved -Algorithm SHA256).Hash
    if ($candidate.Length -ne $ExpectedLength -or $candidateHash -ne $ExpectedSha256.ToUpperInvariant()) {
        throw 'Candidate identity mismatch.'
    }
    if ($candidate.Length -le 0 -or $candidate.Length -ge $AppPartitionSize) { throw 'Candidate does not fit ota_0.' }
    $stream = [IO.File]::OpenRead($candidateResolved)
    try {
        [byte[]]$header = [byte[]]::new(24)
        if ($stream.Read($header, 0, $header.Length) -ne $header.Length) { throw 'Candidate header is short.' }
    } finally { $stream.Dispose() }
    if ($header[0] -ne 0xE9 -or [BitConverter]::ToUInt16($header, 12) -ne 9) {
        throw 'Candidate is not an ESP32-S3 app image.'
    }

    if (-not (Test-Path -LiteralPath $evidenceResolved)) {
        New-Item -ItemType Directory -Path $evidenceResolved | Out-Null
    } elseif (-not (Test-Path -LiteralPath $evidenceResolved -PathType Container)) {
        throw 'Evidence path is not a directory.'
    }
    $statePath = Join-Path $evidenceResolved 'transaction.json'
    $resultPath = Join-Path $evidenceResolved 'result.json'
    if (Test-Path -LiteralPath $resultPath) {
        return Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
    }
    $state = if (Test-Path -LiteralPath $statePath) {
        Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    } else {
        [pscustomobject]@{
            schema = 1
            phase = 'backup_reading'
            candidate_sha256 = $candidateHash
            candidate_length = $candidate.Length
            app_offset = ('0x{0:x}' -f $AppOffset)
            app_partition_size = $AppPartitionSize
            chunk_size = $ChunkSize
            backup_chunks = @()
            readback_chunks = @()
            backup_sha256 = $null
            readback_sha256 = $null
            write_count = 0
            hard_reset_count = 0
        }
    }
    if ($state.schema -ne 1 -or $state.candidate_sha256 -ne $candidateHash -or
        $state.candidate_length -ne $candidate.Length -or $state.app_offset -ne ('0x{0:x}' -f $AppOffset) -or
        $state.app_partition_size -ne $AppPartitionSize -or $state.chunk_size -ne $ChunkSize -or
        $state.write_count -lt 0 -or $state.write_count -gt 1 -or
        $state.hard_reset_count -lt 0 -or $state.hard_reset_count -gt 1) {
        throw 'Existing transaction state does not match this app-only operation.'
    }
    Write-AtomicJson -Path $statePath -Value $state

    $attemptNumber = @(Get-ChildItem -LiteralPath $evidenceResolved -Directory -Filter 'transaction-attempt-*').Count + 1
    $attemptDirectory = Join-Path $evidenceResolved ('transaction-attempt-{0:D3}' -f $attemptNumber)
    New-Item -ItemType Directory -Path $attemptDirectory | Out-Null

    $backupDirectory = Join-Path $evidenceResolved 'backup-chunks'
    $readbackDirectory = Join-Path $evidenceResolved 'readback-chunks'
    foreach ($directory in @($backupDirectory, $readbackDirectory)) {
        if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory | Out-Null }
    }
    $backupPlan = Get-ChunkPlan -Offset $AppOffset -Length $AppPartitionSize -ChunkSize $ChunkSize
    $readbackPlan = Get-ChunkPlan -Offset $AppOffset -Length $candidate.Length -ChunkSize $ChunkSize

    if ($state.write_count -eq 0) {
        $state.phase = 'backup_reading'
        Write-AtomicJson -Path $statePath -Value $state
        Invoke-ChunkReadSet -Plan $backupPlan -Directory $backupDirectory -AttemptDirectory $attemptDirectory `
            -Prefix backup -State $state -StatePath $statePath -Transport $Transport
        $backupSha = Get-CombinedSha256 -Plan $backupPlan -Directory $backupDirectory -Prefix backup
        $backupPath = Join-Path $evidenceResolved 'preflash-ota0.bin'
        Join-ChunkFiles -Plan $backupPlan -Directory $backupDirectory -Prefix backup -Destination $backupPath
        if ((Get-Item -LiteralPath $backupPath).Length -ne $AppPartitionSize) { throw 'Combined backup length mismatch.' }
        $assembledBackupSha = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash
        if ($assembledBackupSha -ne $backupSha) { throw 'Combined backup SHA256 mismatch.' }
        $state.backup_sha256 = $backupSha
        $state.phase = 'backup_complete'
        Write-AtomicJson -Path $statePath -Value $state
        [ordered]@{ path=$backupPath; length=$AppPartitionSize; sha256=$backupSha; offset=$state.app_offset } |
            ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidenceResolved 'preflash-ota0.json') -Encoding utf8

        # Reserve the only write before entering the transport. A crash or
        # exception after this point is write-uncertain and can never retry it.
        $state.write_count = 1
        $state.phase = 'write_armed'
        Write-AtomicJson -Path $statePath -Value $state
        try {
            & $Transport ([pscustomobject]@{
                name = 'write-app'
                operation = 'write_flash'
                address = $AppOffset
                length = $candidate.Length
                path = $candidateResolved
                after = 'no_reset'
            }) | Out-Null
            $state.phase = 'write_complete'
            Write-AtomicJson -Path $statePath -Value $state
        } catch {
            $state.phase = 'write_uncertain'
            Write-AtomicJson -Path $statePath -Value $state
            throw
        }
    } else {
        # Existing transaction already reserved its only write. Resume only
        # with no-write readback; never infer that a failed call is safe to redo.
        if (-not $state.backup_sha256) { throw 'Reserved write has no complete preflash backup evidence.' }
    }

    $state.phase = 'readback_reading'
    Write-AtomicJson -Path $statePath -Value $state
    Invoke-ChunkReadSet -Plan $readbackPlan -Directory $readbackDirectory -AttemptDirectory $attemptDirectory `
        -Prefix readback -State $state -StatePath $statePath -Transport $Transport
    $readbackSha = Get-CombinedSha256 -Plan $readbackPlan -Directory $readbackDirectory -Prefix readback
    $state.readback_sha256 = $readbackSha
    if ($readbackSha -ne $candidateHash) {
        $state.phase = 'readback_mismatch'
        Write-AtomicJson -Path $statePath -Value $state
        throw 'Post-write readback does not match the candidate; the reserved write will not be repeated.'
    }
    $state.phase = 'readback_complete'
    Write-AtomicJson -Path $statePath -Value $state

    if ($state.hard_reset_count -ne 0) {
        throw 'The final verify/reset was already armed; automatic reset repetition is forbidden.'
    }
    $state.hard_reset_count = 1
    $state.phase = 'verify_armed'
    Write-AtomicJson -Path $statePath -Value $state
    try {
        $verifyOutput = & $Transport ([pscustomobject]@{
            name = 'verify-and-final-reset'
            operation = 'verify_flash'
            address = $AppOffset
            length = $candidate.Length
            path = $candidateResolved
            after = 'hard_reset'
        })
    } catch {
        $state.phase = 'verify_uncertain'
        Write-AtomicJson -Path $statePath -Value $state
        throw
    }
    $verifyText = @($verifyOutput) -join "`n"
    if ($verifyText -notmatch '(?i)verify OK \(digest matched\)' -or
        $verifyText -notmatch '(?i)Hard resetting via RTS pin') {
        $state.phase = 'verify_uncertain'
        Write-AtomicJson -Path $statePath -Value $state
        throw 'Independent verify/final-reset evidence is incomplete.'
    }
    $state.phase = 'complete'
    Write-AtomicJson -Path $statePath -Value $state
    $result = [ordered]@{
        completed_at = (Get-Date).ToString('o')
        candidate_sha256 = $candidateHash
        candidate_length = $candidate.Length
        backup_sha256 = $state.backup_sha256
        backup_length = $AppPartitionSize
        readback_sha256 = $readbackSha
        write_count = $state.write_count
        hard_reset_count = $state.hard_reset_count
        non_app_writes = 0
        app_offset = $state.app_offset
    }
    Write-AtomicJson -Path $resultPath -Value $result
    return [pscustomobject]$result
}

Export-ModuleMember -Function Invoke-StackChanAppOnlyTransaction
