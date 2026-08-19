$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\..'))
$modulePath = Join-Path $repoRoot 'ops\lib\StackChanAppOnlyTransaction.psm1'
Import-Module $modulePath -Force

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

$script:TransportScopeProbeValue = 'script-scope-preserved'
function Invoke-TransportScopeProbe([string]$Value) {
    return "${script:TransportScopeProbeValue}:$Value"
}
$invokeTransportScopeProbe = ${function:Invoke-TransportScopeProbe}
$transportScopeProbe = {
    param($Value)
    & $invokeTransportScopeProbe $Value
}.GetNewClosure()
$transactionModule = Get-Module StackChanAppOnlyTransaction
$transportScopeResult = & $transactionModule {
    param($Callback)
    function Invoke-NestedTransportScopeProbe([scriptblock]$NestedCallback) {
        & $NestedCallback 'module-nested-call'
    }
    Invoke-NestedTransportScopeProbe $Callback
} $transportScopeProbe
Assert-True ($transportScopeResult -eq 'script-scope-preserved:module-nested-call') `
    'captured script-scoped transport helper was lost across the module boundary'

function New-Fixture([string]$Root, [string]$FaultName, [bool]$WriteBeforeFault = $false) {
    $candidatePath = Join-Path $Root 'candidate.bin'
    [byte[]]$candidate = [byte[]]::new(0x25001)
    for ($i = 0; $i -lt $candidate.Length; $i++) { $candidate[$i] = [byte](($i * 17 + 3) % 251) }
    $candidate[0] = 0xE9
    $candidate[12] = 9
    $candidate[13] = 0
    [IO.File]::WriteAllBytes($candidatePath, $candidate)

    [byte[]]$flash = [byte[]]::new(0x60000)
    for ($i = 0; $i -lt $flash.Length; $i++) { $flash[$i] = [byte](($i * 7 + 11) % 253) }
    [byte[]]$originalSlot = [byte[]]::new(0x40000)
    [Array]::Copy($flash, 0x20000, $originalSlot, 0, $originalSlot.Length)

    $fixture = [pscustomobject]@{
        candidate = $candidate
        flash = $flash
        originalSlot = $originalSlot
        faultName = $FaultName
        faultConsumed = $false
        writeBeforeFault = $WriteBeforeFault
        writeCount = 0
        resetCount = 0
        operations = [Collections.Generic.List[string]]::new()
    }
    $transport = {
        param($Action)
        $fixture.operations.Add($Action.name)
        if ($Action.operation -eq 'read_flash') {
            [byte[]]$bytes = [byte[]]::new([int]$Action.length)
            [Array]::Copy($fixture.flash, [int]$Action.address, $bytes, 0, $bytes.Length)
            if (-not $fixture.faultConsumed -and $Action.name -eq $fixture.faultName) {
                $fixture.faultConsumed = $true
                [IO.File]::WriteAllBytes($Action.path, $bytes[0..([Math]::Max(0, [int]($bytes.Length / 2) - 1))])
                throw "injected read failure: $($Action.name)"
            }
            [IO.File]::WriteAllBytes($Action.path, $bytes)
            return 'read complete'
        }
        if ($Action.operation -eq 'write_flash') {
            $fixture.writeCount++
            if (-not $fixture.faultConsumed -and $Action.name -eq $fixture.faultName) {
                $fixture.faultConsumed = $true
                if ($fixture.writeBeforeFault) {
                    [Array]::Copy($fixture.candidate, 0, $fixture.flash, [int]$Action.address, $fixture.candidate.Length)
                }
                throw "injected write failure: $($Action.name)"
            }
            [Array]::Copy($fixture.candidate, 0, $fixture.flash, [int]$Action.address, $fixture.candidate.Length)
            return 'write complete'
        }
        if ($Action.operation -eq 'verify_flash') {
            if (-not $fixture.faultConsumed -and $Action.name -eq $fixture.faultName) {
                $fixture.faultConsumed = $true
                throw "injected verify failure: $($Action.name)"
            }
            for ($i = 0; $i -lt $fixture.candidate.Length; $i++) {
                if ($fixture.flash[[int]$Action.address + $i] -ne $fixture.candidate[$i]) {
                    throw 'fixture verify mismatch'
                }
            }
            if ($Action.after -eq 'hard_reset') { $fixture.resetCount++ }
            return "Verify OK (digest matched)`nHard resetting via RTS pin"
        }
        throw "unexpected operation: $($Action.operation)"
    }.GetNewClosure()
    return [pscustomobject]@{
        candidatePath = $candidatePath
        candidateSha = (Get-FileHash -LiteralPath $candidatePath -Algorithm SHA256).Hash
        candidateLength = $candidate.Length
        fixture = $fixture
        transport = $transport
    }
}

function Invoke-Cycle([string]$Scenario, [string]$FaultName, [bool]$WriteBeforeFault = $false) {
    $root = Join-Path ([IO.Path]::GetTempPath()) ('stackchan-transaction-' + $Scenario + '-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $root | Out-Null
    try {
        $case = New-Fixture -Root $root -FaultName $FaultName -WriteBeforeFault $WriteBeforeFault
        $evidence = Join-Path $root 'evidence'
        $failed = $false
        try {
            Invoke-StackChanAppOnlyTransaction -CandidatePath $case.candidatePath `
                -ExpectedSha256 $case.candidateSha -ExpectedLength $case.candidateLength `
                -EvidenceDirectory $evidence -Transport $case.transport -FinalHardReset `
                -AppOffset 0x20000 -AppPartitionSize 0x40000 -ChunkSize 0x10000 | Out-Null
        } catch {
            $failed = $true
        }
        Assert-True $failed "$Scenario did not hit the injected failure"
        $state = Get-Content -LiteralPath (Join-Path $evidence 'transaction.json') -Raw | ConvertFrom-Json

        if ($Scenario -eq 'backup') {
            Assert-True ($state.write_count -eq 0) 'backup failure reserved or performed a write'
            Assert-True ($case.fixture.writeCount -eq 0) 'backup failure called write transport'
            Assert-True ($case.fixture.resetCount -eq 0) 'backup failure reset the device'
            Assert-True ($state.backup_chunks.Count -eq 1) 'backup progress was not persisted before failure'
        } else {
            Assert-True ($state.write_count -eq 1) "$Scenario did not reserve exactly one write"
            Assert-True ($case.fixture.writeCount -eq 1) "$Scenario did not call write exactly once"
            Assert-True ($case.fixture.resetCount -eq 0) "$Scenario reset before recovery"
        }

        $firstOperations = @($case.fixture.operations)
        Invoke-StackChanAppOnlyTransaction -CandidatePath $case.candidatePath `
            -ExpectedSha256 $case.candidateSha -ExpectedLength $case.candidateLength `
            -EvidenceDirectory $evidence -Transport $case.transport -FinalHardReset `
            -AppOffset 0x20000 -AppPartitionSize 0x40000 -ChunkSize 0x10000 | Out-Null

        $result = Get-Content -LiteralPath (Join-Path $evidence 'result.json') -Raw | ConvertFrom-Json
        Assert-True ($result.write_count -eq 1) "$Scenario recovery result write count is not one"
        Assert-True ($case.fixture.writeCount -eq 1) "$Scenario recovery repeated the write"
        Assert-True ($case.fixture.resetCount -eq 1) "$Scenario recovery did not reset exactly once"
        Assert-True ($result.readback_sha256 -eq $case.candidateSha) "$Scenario readback hash mismatch"
        Assert-True ($result.backup_length -eq 0x40000) "$Scenario backup length mismatch"

        if ($Scenario -eq 'backup') {
            $resumeOperations = @($case.fixture.operations | Select-Object -Skip $firstOperations.Count)
            Assert-True (-not ($resumeOperations -contains 'backup-chunk-00')) 'completed backup chunk was reread'
            $backup = [IO.File]::ReadAllBytes((Join-Path $evidence 'preflash-ota0.bin'))
            Assert-True ($backup.Length -eq $case.fixture.originalSlot.Length) 'combined backup size mismatch'
            Assert-True ([Linq.Enumerable]::SequenceEqual([byte[]]$backup, [byte[]]$case.fixture.originalSlot)) 'combined backup content mismatch'
        }
    } finally {
        Remove-Item -LiteralPath $root -Recurse -Force
    }
}

Invoke-Cycle -Scenario 'backup' -FaultName 'backup-chunk-01'
Invoke-Cycle -Scenario 'readback' -FaultName 'readback-chunk-01'
Invoke-Cycle -Scenario 'write-uncertain-complete' -FaultName 'write-app' -WriteBeforeFault $true

$root = Join-Path ([IO.Path]::GetTempPath()) ('stackchan-transaction-write-uncertain-incomplete-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
try {
    $case = New-Fixture -Root $root -FaultName 'write-app' -WriteBeforeFault $false
    $evidence = Join-Path $root 'evidence'
    try {
        Invoke-StackChanAppOnlyTransaction -CandidatePath $case.candidatePath `
            -ExpectedSha256 $case.candidateSha -ExpectedLength $case.candidateLength `
            -EvidenceDirectory $evidence -Transport $case.transport -FinalHardReset `
            -AppOffset 0x20000 -AppPartitionSize 0x40000 -ChunkSize 0x10000 | Out-Null
        throw 'write-before-transfer fixture did not fail'
    } catch {
        Assert-True ($case.fixture.writeCount -eq 1) 'uncertain write was not reserved/called once'
    }
    $resumeFailed = $false
    try {
        Invoke-StackChanAppOnlyTransaction -CandidatePath $case.candidatePath `
            -ExpectedSha256 $case.candidateSha -ExpectedLength $case.candidateLength `
            -EvidenceDirectory $evidence -Transport $case.transport -FinalHardReset `
            -AppOffset 0x20000 -AppPartitionSize 0x40000 -ChunkSize 0x10000 | Out-Null
    } catch {
        $resumeFailed = $_.Exception.Message -match 'reserved write will not be repeated'
    }
    Assert-True $resumeFailed 'unchanged flash did not fail closed as a readback mismatch'
    Assert-True ($case.fixture.writeCount -eq 1) 'uncertain incomplete write was repeated'
    Assert-True ($case.fixture.resetCount -eq 0) 'uncertain incomplete write reset the device'
    $state = Get-Content -LiteralPath (Join-Path $evidence 'transaction.json') -Raw | ConvertFrom-Json
    Assert-True ($state.phase -eq 'readback_mismatch') 'uncertain incomplete write state was not preserved'
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force
}

$root = Join-Path ([IO.Path]::GetTempPath()) ('stackchan-transaction-verify-uncertain-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
try {
    $case = New-Fixture -Root $root -FaultName 'verify-and-final-reset'
    $evidence = Join-Path $root 'evidence'
    try {
        Invoke-StackChanAppOnlyTransaction -CandidatePath $case.candidatePath `
            -ExpectedSha256 $case.candidateSha -ExpectedLength $case.candidateLength `
            -EvidenceDirectory $evidence -Transport $case.transport -FinalHardReset `
            -AppOffset 0x20000 -AppPartitionSize 0x40000 -ChunkSize 0x10000 | Out-Null
        throw 'verify fixture did not fail'
    } catch {
        Assert-True ($case.fixture.writeCount -eq 1) 'verify failure lost the one-write invariant'
    }
    $operationsBeforeResume = $case.fixture.operations.Count
    $resumeRefused = $false
    try {
        Invoke-StackChanAppOnlyTransaction -CandidatePath $case.candidatePath `
            -ExpectedSha256 $case.candidateSha -ExpectedLength $case.candidateLength `
            -EvidenceDirectory $evidence -Transport $case.transport -FinalHardReset `
            -AppOffset 0x20000 -AppPartitionSize 0x40000 -ChunkSize 0x10000 | Out-Null
    } catch {
        $resumeRefused = $_.Exception.Message -match 'reset was already armed'
    }
    Assert-True $resumeRefused 'verify-uncertain state did not refuse a second reset'
    Assert-True ($case.fixture.operations.Count -eq $operationsBeforeResume) 'verify-uncertain resume touched transport'
    Assert-True ($case.fixture.resetCount -eq 0) 'verify-uncertain fixture unexpectedly reset'
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force
}

Write-Output 'stackchan app-only transaction fault injection: PASS'
