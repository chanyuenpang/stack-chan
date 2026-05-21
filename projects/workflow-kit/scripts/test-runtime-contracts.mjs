import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  buildRuntimeReplayReport,
  RUNTIME_REPLAY_KIND,
} from "../src/skillforge/runtime-replay-reporter.mjs";
import {
  buildRuntimeProviderAdapterContractContext,
  RUNTIME_PROVIDER_ADAPTER_DEFAULT_SLOT,
  RUNTIME_PROVIDER_ADAPTER_KEYS,
} from "../src/skillforge/runtime-provider-adapter-contract.mjs";
import {
  RUNTIME_TRANSCRIPT_ARTIFACT_CONTRACT_VERSION,
  RUNTIME_TRANSCRIPT_ARTIFACT_EXECUTION_CLASS,
  RUNTIME_TRANSCRIPT_ARTIFACT_KIND,
  RUNTIME_TRANSCRIPT_ARTIFACT_SCOPE,
} from "../src/skillforge/runtime-transcript-contract.mjs";
import {
  RUNTIME_TRANSCRIPT_ARTIFACT_REF_KIND,
  RUNTIME_TRANSCRIPT_ARTIFACT_REF_VERSION,
} from "../src/skillforge/runtime-runner-contract.mjs";
import { selectRuntimeCase } from "../src/skillforge/runtime-case-selector.mjs";
import {
  buildRuntimeRunnerContractContext,
  buildRuntimeRunnerInput,
} from "../src/skillforge/runtime-runner-contract.mjs";
import {
  buildRuntimeSandboxBoundary,
  buildRuntimeSandboxBoundaryFromSources,
} from "../src/skillforge/runtime-sandbox-contract.mjs";
import {
  buildRuntimeRunnerSkeletonInput,
  runRuntimeCaseSkeleton,
} from "../src/skillforge/runtime-runner.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const runtimeDraftScript = path.join(repoRoot, "scripts/run-runtime-draft.mjs");
const baselineFixture = path.join(repoRoot, "fixtures/meeting-summary-assistant");
const nodeExecutable = process.execPath;

function runRuntimeDraftCli(args = []) {
  return spawnSync(nodeExecutable, [runtimeDraftScript, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function parseJsonStdout(result, message) {
  assert.equal(result.stderr, "", `${message}: expected empty stderr, got ${result.stderr}`);
  assert.ok(result.stdout.trim().length > 0, `${message}: expected JSON stdout`);
  return JSON.parse(result.stdout);
}

function createFixtureCases() {
  return [
    {
      id: "case-alpha",
      type: "positive",
      intent: "summarize transcript",
      expectedBehavior: ["returns concise summary"],
      tags: ["default"],
    },
    {
      id: "case-beta",
      type: "negative",
      intent: "reject unsupported request",
      expectedBehavior: ["refuses unsafe action"],
      tags: ["guardrail"],
    },
  ];
}

function createNormalizedFixture() {
  return {
    fixtureId: "runtime-contract-fixture",
    fixtureVersion: "0.1.0",
    profile: "standard",
    entryPath: "skill/SKILL.md",
    permissions: {
      allowed: ["read"],
      denied: ["write"],
      conservativeDefault: true,
      declarations: ["default deny for side effects"],
    },
    toolBoundary: {
      allowedActions: ["read"],
      deniedActions: ["write", "exec"],
      permissions: {
        allowed: ["read"],
        denied: ["write"],
        conservativeDefault: true,
        declarations: ["tool boundary inherits conservative default"],
      },
      bodyMentionsConservativeBoundary: true,
    },
    replayCases: {
      kind: "replay-cases",
      cases: createFixtureCases(),
    },
  };
}

function createLoadedFixture() {
  return {
    skillManifest: {
      id: "runtime-contract-fixture",
      version: "0.1.0",
      profile: "standard",
      entry: "skill/SKILL.md",
    },
  };
}

function createPreflightReport(status = "passed") {
  return {
    kind: "runtime-preflight-result",
    reportVersion: "0.1.0-draft",
    protocolVersion: "runtime-preflight-protocol-draft-1",
    status,
    summary: {
      passed: status === "passed",
      totalChecks: status === "passed" ? 1 : 2,
      blockingFailures: status === "passed" ? 0 : 1,
      warnings: 0,
      errors: 0,
    },
    checks:
      status === "passed"
        ? [
            {
              id: "RF-P1-PREFLIGHT-STATIC-BASELINE-PASSED",
              status: "pass",
            },
          ]
        : [
            {
              id: "RF-P1-PREFLIGHT-STATIC-BASELINE-PASSED",
              status: "fail",
            },
            {
              id: "RF-P1-PREFLIGHT-BOUNDARY-DECLARED",
              status: "pass",
            },
          ],
  };
}

function testRuntimeReplayReportSkeleton() {
  const report = buildRuntimeReplayReport({
    fixtureDir: "/tmp/runtime-contract-fixture",
    fixture: {
      id: "runtime-contract-fixture",
      version: "0.1.0",
      entry: "skill/SKILL.md",
      profile: "standard",
    },
    runtime: {
      mode: "dry-run",
    },
    cases: [
      {
        id: "case-alpha",
        type: "positive",
        status: "dry-run",
      },
    ],
    options: {
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
  });

  assert.equal(report.kind, RUNTIME_REPLAY_KIND);
  assert.equal(report.kind, "runtime-replay-report");
  assert.ok(report.reportVersion);
  assert.ok(report.protocolVersion);
  assert.ok(report.fixture);
  assert.ok(report.summary);
  assert.ok(Array.isArray(report.cases));
  assert.ok(Array.isArray(report.checks));
  assert.ok(Array.isArray(report.errors));
  assert.ok(Array.isArray(report.pendingCapabilities));
  assert.equal(report.summary.totalCases, 1);
  assert.equal(report.summary.passedCases, 0);
  assert.equal(report.summary.failedCases, 0);
  assert.equal(report.summary.blockedCases, 1);
  assert.equal(report.summary.passed, false);
  assert.match(report.metadata.note, /runtime draft artifact only/i);
  assert.ok(report.pendingCapabilities.includes("provider-integration"));
}

function testCaseSelectorStability() {
  const normalizedFixture = createNormalizedFixture();

  const defaultCase = selectRuntimeCase({ normalizedFixture });
  const byIdCase = selectRuntimeCase({ normalizedFixture, caseId: "case-beta" });
  const byIndexCase = selectRuntimeCase({ normalizedFixture, caseIndex: 1 });

  assert.equal(defaultCase.id, "case-alpha");
  assert.equal(byIdCase.id, "case-beta");
  assert.equal(byIndexCase.id, "case-beta");
}

function testProviderAdapterContractBuiltinSemantics() {
  const normalizedFixture = createNormalizedFixture();
  const loadedFixture = createLoadedFixture();
  const preflightReport = createPreflightReport("passed");
  const sandboxContract = buildRuntimeSandboxBoundaryFromSources({
    normalizedFixture,
    preflightInput: preflightReport,
  });
  const caseRecord = selectRuntimeCase({ normalizedFixture });

  assert.deepEqual(RUNTIME_PROVIDER_ADAPTER_KEYS, ["dry-run", "null-runner", "provider-backed"]);
  assert.equal(RUNTIME_PROVIDER_ADAPTER_DEFAULT_SLOT, "future-provider-backed-single-case-runtime");

  for (const providerKey of RUNTIME_PROVIDER_ADAPTER_KEYS) {
    const contract = buildRuntimeProviderAdapterContractContext({
      fixtureDir: "/tmp/runtime-contract-fixture",
      loadedFixture,
      normalizedFixture,
      caseRecord,
      boundary: {
        permissions: sandboxContract.permissions,
        toolBoundary: sandboxContract.toolBoundary,
      },
      options: {
        mode: providerKey,
        providerKey,
        providerSlot: RUNTIME_PROVIDER_ADAPTER_DEFAULT_SLOT,
      },
    });

    assert.equal(contract.input.contract.kind, "runtime-provider-adapter-input");
    assert.equal(contract.input.provider.mode, providerKey);
    assert.equal(contract.input.provider.providerKey, providerKey);
    assert.equal(contract.input.provider.providerSlot, RUNTIME_PROVIDER_ADAPTER_DEFAULT_SLOT);
    assert.equal(contract.input.provider.builtin, true);
    assert.equal(contract.input.provider.contractFirst, true);
    assert.equal(contract.input.provider.implemented, false);
    assert.match(contract.input.provider.note, /reserves future provider-backed runtime execution/i);
  }
}

function testDryAndNullRunnerNeverPass() {
  const normalizedFixture = createNormalizedFixture();
  const loadedFixture = createLoadedFixture();
  const preflightReport = createPreflightReport("passed");
  const sandboxContract = buildRuntimeSandboxBoundaryFromSources({
    normalizedFixture,
    preflightInput: preflightReport,
  });
  const runnerContract = buildRuntimeRunnerContractContext({
    fixtureDir: "/tmp/runtime-contract-fixture",
    loadedFixture,
    normalizedFixture,
    preflightReport,
    caseRecord: selectRuntimeCase({ normalizedFixture }),
    boundary: {
      permissions: sandboxContract.permissions,
      toolBoundary: sandboxContract.toolBoundary,
    },
    options: {
      mode: "dry-run",
    },
  });

  const dryRun = runRuntimeCaseSkeleton({
    fixtureDir: "/tmp/runtime-contract-fixture",
    loadedFixture,
    normalizedFixture,
    preflightReport,
    runnerContract,
    sandboxContract,
    options: { mode: "dry-run" },
  });

  const nullRun = runRuntimeCaseSkeleton({
    fixtureDir: "/tmp/runtime-contract-fixture",
    loadedFixture,
    normalizedFixture,
    preflightReport,
    runnerContract,
    sandboxContract,
    options: { mode: "null-runner" },
  });

  assert.equal(dryRun.result.status, "dry-run");
  assert.equal(nullRun.result.status, "not-executed");
  assert.notEqual(dryRun.result.status, "passed");
  assert.notEqual(nullRun.result.status, "passed");
  assert.equal(dryRun.result.observed.providerCall, false);
  assert.equal(dryRun.result.observed.transcriptCaptured, false);
  assert.equal(dryRun.result.observed.sideEffectsPerformed, false);
  assert.equal(nullRun.result.runnerMetadata.executed, false);
  assert.equal(dryRun.runtimeReport.summary.passed, false);
  assert.equal(nullRun.runtimeReport.summary.passed, false);
}

function testRuntimePreflightTaxonomyDoesNotMasqueradeAsStaticOrPassed() {
  const normalizedFixture = createNormalizedFixture();
  const loadedFixture = createLoadedFixture();
  const blockedPreflight = createPreflightReport("failed");

  const blockedRun = runRuntimeCaseSkeleton({
    fixtureDir: "/tmp/runtime-contract-fixture",
    loadedFixture,
    normalizedFixture,
    preflightReport: blockedPreflight,
    options: { mode: "dry-run" },
  });

  assert.equal(blockedRun.runtimeReport.summary.totalCases, 1);
  assert.equal(blockedRun.runtimeReport.summary.passedCases, 0);
  assert.equal(blockedRun.runtimeReport.summary.passed, false);
  assert.equal(blockedRun.runtimeReport.summary.warnings, 1);
  assert.equal(blockedRun.runtimeReport.summary.errors, 0);
  assert.equal(blockedRun.runtimeReport.metadata.lineage.preflight.status, "failed");
  assert.equal(blockedRun.runtimeReport.metadata.lineage.static.status, null);
  assert.deepEqual(blockedRun.runtimeReport.metadata.statusTaxonomy.reportStatuses, ["draft", "blocked"]);
  assert.deepEqual(blockedRun.runtimeReport.metadata.statusTaxonomy.caseStatuses, [
    "blocked",
    "error",
    "dry-run",
    "not-executed",
  ]);
  assert.equal(blockedRun.runtimeReport.metadata.statusTaxonomy.passedReserved, true);
  assert.equal(blockedRun.runtimeReport.metadata.statusTaxonomy.providerReadyPassPathImplemented, false);
  assert.equal(blockedRun.runtimeReport.checks.length, 1);
  assert.equal(blockedRun.runtimeReport.checks[0].status, "warn");
  assert.deepEqual(blockedRun.runtimeReport.checks[0].evidence, ["dry-run", "dry-run"]);
  assert.notEqual(blockedRun.runtimeReport.cases[0].status, "passed");
  assert.equal(blockedRun.runtimeReport.cases.length, blockedRun.runtimeReport.summary.totalCases);
}

function testTranscriptArtifactAndReportReferenceContract() {
  const normalizedFixture = createNormalizedFixture();
  const loadedFixture = createLoadedFixture();
  const preflightReport = createPreflightReport("passed");

  const run = runRuntimeCaseSkeleton({
    fixtureDir: "/tmp/runtime-contract-fixture",
    loadedFixture,
    normalizedFixture,
    preflightReport,
    options: { mode: "dry-run" },
  });

  const runtimeCase = run.runtimeReport.cases[0];
  const transcript = runtimeCase.transcript;
  const transcriptRef = runtimeCase.transcriptRef;

  assert.equal(transcript.kind, RUNTIME_TRANSCRIPT_ARTIFACT_KIND);
  assert.equal(transcript.artifactVersion, RUNTIME_TRANSCRIPT_ARTIFACT_CONTRACT_VERSION);
  assert.equal(transcript.scope, RUNTIME_TRANSCRIPT_ARTIFACT_SCOPE);
  assert.equal(transcript.executionClass, RUNTIME_TRANSCRIPT_ARTIFACT_EXECUTION_CLASS);
  assert.equal(transcript.executionClass, "provider-less-draft-only");
  assert.equal(transcript.case.id, runtimeCase.id);
  assert.equal(transcript.executionMode, "dry-run");

  assert.equal(transcriptRef.kind, RUNTIME_TRANSCRIPT_ARTIFACT_REF_KIND);
  assert.equal(transcriptRef.version, RUNTIME_TRANSCRIPT_ARTIFACT_REF_VERSION);
  assert.equal(transcriptRef.available, true);
  assert.equal(transcriptRef.providerTranscript, false);
  assert.deepEqual(transcriptRef.location, {
    kind: "in-report-artifact",
    path: ["cases", 0, "transcript"],
  });
  assert.equal(transcriptRef.artifactId, transcript.artifactId);
  assert.match(transcriptRef.note, /not a provider transcript reference/i);
}

function testTranscriptStubRecordsOnlyOrchestrationEvidence() {
  const normalizedFixture = createNormalizedFixture();
  const loadedFixture = createLoadedFixture();
  const preflightReport = createPreflightReport("passed");

  const run = runRuntimeCaseSkeleton({
    fixtureDir: "/tmp/runtime-contract-fixture",
    loadedFixture,
    normalizedFixture,
    preflightReport,
    options: { mode: "dry-run" },
  });

  const transcript = run.transcriptArtifact;
  assert.ok(Array.isArray(transcript.events));
  assert.equal(transcript.events.length > 0, true);
  assert.equal(transcript.outcome.transcriptCaptured, false);
  assert.equal(transcript.outcome.providerResponseCaptured, false);
  assert.equal(transcript.runnerMetadata.providerCall, false);
  assert.equal(transcript.runnerMetadata.transcriptEngineUsed, false);
  assert.match(transcript.note, /orchestration evidence/i);
  assert.match(transcript.note, /(without any model dialogue|excludes any fictional model\/provider dialogue)/i);

  for (const event of transcript.events) {
    assert.ok(event.seq >= 1);
    assert.equal(typeof event.phase, "string");
    assert.equal(typeof event.kind, "string");
    assert.equal(typeof event.detail, "string");
    assert.ok(event.evidence && typeof event.evidence === "object");
  }

  const runnerEvent = transcript.events.find((event) => event.phase === "runner");
  assert.ok(runnerEvent);
  assert.equal(runnerEvent.evidence.providerCall, false);
  assert.equal(runnerEvent.evidence.transcriptEngineUsed, false);
  assert.equal(runnerEvent.evidence.executionReservedOnly, true);
}

function testTranscriptRefDoesNotUpgradeDraftStatuses() {
  const normalizedFixture = createNormalizedFixture();
  const loadedFixture = createLoadedFixture();

  const dryRun = runRuntimeCaseSkeleton({
    fixtureDir: "/tmp/runtime-contract-fixture",
    loadedFixture,
    normalizedFixture,
    preflightReport: createPreflightReport("passed"),
    options: { mode: "dry-run" },
  });

  const nullRun = runRuntimeCaseSkeleton({
    fixtureDir: "/tmp/runtime-contract-fixture",
    loadedFixture,
    normalizedFixture,
    preflightReport: createPreflightReport("passed"),
    options: { mode: "null-runner" },
  });

  const blockedRun = runRuntimeCaseSkeleton({
    fixtureDir: "/tmp/runtime-contract-fixture",
    loadedFixture,
    normalizedFixture,
    preflightReport: createPreflightReport("failed"),
    options: { mode: "dry-run" },
  });

  for (const run of [dryRun, nullRun, blockedRun]) {
    assert.equal(run.result.transcriptRef?.available, true);
    assert.equal(run.result.transcriptRef?.providerTranscript, false);
    assert.notEqual(run.result.status, "passed");
    assert.ok(["blocked", "dry-run", "not-executed", "error"].includes(run.result.status));
    assert.notEqual(run.runtimeReport.cases[0].status, "passed");
  }

  assert.equal(dryRun.result.status, "dry-run");
  assert.equal(nullRun.result.status, "not-executed");
  assert.equal(blockedRun.result.status, "dry-run");
  assert.equal(blockedRun.result.failureReason?.code, "RUNTIME_PREFLIGHT_BLOCKED");
}

function testProviderBackedRuntimeStaysHonestAndUnimplemented() {
  const normalizedFixture = createNormalizedFixture();
  const loadedFixture = createLoadedFixture();
  const preflightReport = createPreflightReport("passed");

  const providerBackedRun = runRuntimeCaseSkeleton({
    fixtureDir: "/tmp/runtime-contract-fixture",
    loadedFixture,
    normalizedFixture,
    preflightReport,
    options: { mode: "provider-backed" },
  });

  assert.equal(providerBackedRun.result.status, "error");
  assert.notEqual(providerBackedRun.result.status, "passed");
  assert.equal(providerBackedRun.result.observed.evidence, "provider-slot-reserved");
  assert.equal(providerBackedRun.result.observed.providerCall, false);
  assert.equal(providerBackedRun.result.observed.transcriptCaptured, false);
  assert.equal(providerBackedRun.result.observed.sideEffectsPerformed, false);
  assert.equal(providerBackedRun.result.failureReason?.code, "RUNTIME_PROVIDER_ADAPTER_UNIMPLEMENTED");
  assert.match(providerBackedRun.result.failureReason?.message ?? "", /intentionally unimplemented/i);

  const adapterMetadata = providerBackedRun.result.runnerMetadata.providerAdapter;
  assert.equal(adapterMetadata.key, "provider-backed");
  assert.equal(adapterMetadata.slot, RUNTIME_PROVIDER_ADAPTER_DEFAULT_SLOT);
  assert.equal(adapterMetadata.implemented, false);
  assert.equal(adapterMetadata.providerBacked, true);
  assert.equal(adapterMetadata.status, "error");

  assert.equal(providerBackedRun.runtimeReport.status, "draft");
  assert.equal(providerBackedRun.runtimeReport.summary.totalCases, 1);
  assert.equal(providerBackedRun.runtimeReport.summary.passedCases, 0);
  assert.equal(providerBackedRun.runtimeReport.summary.failedCases, 1);
  assert.equal(providerBackedRun.runtimeReport.summary.blockedCases, 0);
  assert.equal(providerBackedRun.runtimeReport.summary.passed, false);
  assert.equal(providerBackedRun.runtimeReport.cases[0].status, "error");
  assert.equal(providerBackedRun.runtimeReport.cases[0].transcriptRef?.available, true);
  assert.equal(providerBackedRun.runtimeReport.cases[0].transcriptRef?.providerTranscript, false);
  assert.equal(providerBackedRun.runtimeReport.cases[0].transcriptRef?.persistence, "in-report-only");
  assert.match(providerBackedRun.runtimeReport.cases[0].transcriptRef?.note ?? "", /not a provider transcript reference/i);
  assert.equal(providerBackedRun.runtimeReport.cases[0].transcript.executionMode, "provider-backed");
  assert.equal(providerBackedRun.runtimeReport.cases[0].transcript.runnerMetadata.providerCall, false);
  assert.equal(providerBackedRun.runtimeReport.cases[0].transcript.outcome.transcriptCaptured, false);

  assert.deepEqual(providerBackedRun.runtimeReport.metadata.statusTaxonomy.reportStatuses, ["draft", "blocked"]);
  assert.deepEqual(providerBackedRun.runtimeReport.metadata.statusTaxonomy.caseStatuses, [
    "blocked",
    "error",
    "dry-run",
    "not-executed",
  ]);
  assert.equal(providerBackedRun.runtimeReport.metadata.statusTaxonomy.passedReserved, true);
  assert.equal(providerBackedRun.runtimeReport.metadata.statusTaxonomy.providerReadyPassPathImplemented, false);
  assert.equal(providerBackedRun.runtimeReport.metadata.lineage.preflight.status, "passed");
  assert.equal(providerBackedRun.runtimeReport.metadata.executionMode, "provider-backed");
  assert.equal(providerBackedRun.runtimeReport.metadata.sandbox.enforcementImplemented, false);
  assert.equal(providerBackedRun.runtimeReport.pendingCapabilities.includes("provider-integration"), true);
  assert.equal(providerBackedRun.runtimeReport.pendingCapabilities.includes("runtime-pass-path"), true);
  assert.equal(providerBackedRun.runtimeReport.pendingCapabilities.includes("scoring-engine"), true);
  assert.equal(providerBackedRun.runtimeReport.checks.length, 1);
  assert.equal(providerBackedRun.runtimeReport.checks[0].status, "warn");
  assert.match(providerBackedRun.runtimeReport.checks[0].message, /intentionally unimplemented/i);
}

function testPendingCapabilitiesAndDraftMetadata() {
  const normalizedFixture = createNormalizedFixture();
  const preflightReport = createPreflightReport("passed");
  const sandboxContract = buildRuntimeSandboxBoundary({
    permissions: normalizedFixture.permissions,
    toolBoundary: normalizedFixture.toolBoundary,
    sideEffectPolicy: {
      mode: "declaration-only",
      guard: "not-implemented",
      requiresHumanApproval: true,
      notes: ["provider/transcript/sandbox enforcement are deferred"],
    },
  });

  const runnerInput = buildRuntimeRunnerInput({
    fixtureDir: "/tmp/runtime-contract-fixture",
    loadedFixture: createLoadedFixture(),
    normalizedFixture,
    preflightReport,
    caseRecord: selectRuntimeCase({ normalizedFixture }),
    boundary: {
      permissions: sandboxContract.permissions,
      toolBoundary: sandboxContract.toolBoundary,
    },
    options: {
      mode: "dry-run",
      note: "contract test only",
    },
  });

  const skeletonInput = buildRuntimeRunnerSkeletonInput({
    fixtureDir: "/tmp/runtime-contract-fixture",
    loadedFixture: createLoadedFixture(),
    normalizedFixture,
    preflightReport,
    runnerContract: { input: runnerInput },
    sandboxContract,
  });

  const run = runRuntimeCaseSkeleton({
    fixtureDir: "/tmp/runtime-contract-fixture",
    loadedFixture: createLoadedFixture(),
    normalizedFixture,
    preflightReport,
    sandboxContract,
    options: { mode: "dry-run" },
  });

  assert.equal(sandboxContract.boundarySummary.declarationOnly, true);
  assert.equal(sandboxContract.boundarySummary.enforcementImplemented, false);
  assert.match(sandboxContract.warnings[0], /declaration-only/i);
  assert.equal(skeletonInput.boundary.permissions.conservativeDefault, true);
  assert.equal(run.runtimeReport.metadata.sandbox.enforcementImplemented, false);
  assert.match(run.runtimeReport.metadata.note, /no provider call/i);
  assert.ok(run.runtimeReport.pendingCapabilities.includes("provider-integration"));
  assert.ok(run.runtimeReport.pendingCapabilities.includes("transcript-engine"));
  assert.ok(run.result.runnerMetadata.pendingCapabilities.includes("sandbox-implementation"));
}

function testRuntimeDraftCliDefaultModeAndKind() {
  const result = runRuntimeDraftCli([baselineFixture]);
  assert.equal(result.status, 0, `runtime draft default invocation should exit 0, got ${result.status}`);

  const artifact = parseJsonStdout(result, "default runtime draft invocation");
  assert.equal(artifact.kind, "runtime-replay-report");
  assert.equal(artifact.metadata.executionMode, "dry-run");
  assert.equal(artifact.summary.passed, false);
  assert.equal(artifact.cases.length, 1);
  assert.notEqual(artifact.cases[0].status, "passed");
  assert.equal(typeof artifact.metadata.generatedAt, "string");
}

function testRuntimeDraftCliStableCaseSelection() {
  const byId = runRuntimeDraftCli([baselineFixture, "--case-id", "positive-basic-summary"]);
  assert.equal(byId.status, 0, `runtime draft --case-id should exit 0, got ${byId.status}`);
  const byIdArtifact = parseJsonStdout(byId, "runtime draft case-id invocation");
  assert.equal(byIdArtifact.cases.length, 1);
  assert.equal(byIdArtifact.cases[0].id, "positive-basic-summary");

  const byIndex = runRuntimeDraftCli([baselineFixture, "--case-index", "0"]);
  assert.equal(byIndex.status, 0, `runtime draft --case-index should exit 0, got ${byIndex.status}`);
  const byIndexArtifact = parseJsonStdout(byIndex, "runtime draft case-index invocation");
  assert.equal(byIndexArtifact.cases.length, 1);
  assert.equal(byIndexArtifact.cases[0].id, byIdArtifact.cases[0].id);
}

function testRuntimeCliAndOrchestratorKeepProviderBackedSeamOutOfStaticPreflightSemantics() {
  const result = runRuntimeDraftCli([baselineFixture, "--mode", "provider-backed"]);
  assert.equal(result.status, 2, `runtime draft provider-backed should be rejected by CLI for now, got ${result.status}`);
  assert.match(result.stderr, /Unsupported mode: provider-backed/i);
  assert.match(result.stderr, /Supported modes: dry-run, null-runner/i);
  assert.equal(result.stdout, "", "provider-backed CLI rejection should not emit runtime report JSON");

  const dryRun = parseJsonStdout(runRuntimeDraftCli([baselineFixture]), "runtime draft dry-run invocation");
  assert.equal(dryRun.kind, "runtime-replay-report");
  assert.equal(dryRun.metadata.executionMode, "dry-run");
  assert.equal(dryRun.metadata.lineage.preflight.status, "passed");
  assert.equal(dryRun.metadata.lineage.static.status, "passed");
  assert.deepEqual(dryRun.metadata.statusTaxonomy.reportStatuses, ["draft", "blocked"]);
  assert.deepEqual(dryRun.metadata.statusTaxonomy.caseStatuses, ["blocked", "error", "dry-run", "not-executed"]);
  assert.equal(dryRun.metadata.statusTaxonomy.passedReserved, true);
  assert.equal(dryRun.metadata.statusTaxonomy.providerReadyPassPathImplemented, false);
  assert.equal(dryRun.summary.passed, false);
}

function testRuntimeDraftCliPreflightPassedStillNotPassedCase() {
  const result = runRuntimeDraftCli([baselineFixture]);
  assert.equal(result.status, 0, `runtime draft baseline should exit 0, got ${result.status}`);

  const artifact = parseJsonStdout(result, "runtime draft baseline preflight passed");
  assert.equal(artifact.metadata.lineage.preflight.status, "passed");
  assert.notEqual(artifact.cases[0].status, "passed");
  assert.equal(artifact.summary.passedCases, 0);
  assert.equal(artifact.summary.passed, false);
}

function testRuntimeDraftCliUsageErrorsAndUnsupportedMode() {
  const missingPath = runRuntimeDraftCli([]);
  assert.equal(missingPath.status, 2, `missing path should exit 2, got ${missingPath.status}`);
  assert.match(missingPath.stderr, /Missing fixture path\./, "missing path error message mismatch");
  assert.match(missingPath.stdout, /Usage: pnpm validate:runtime:draft/, "missing path should print usage");

  const unsupportedMode = runRuntimeDraftCli([baselineFixture, "--mode", "live-run"]);
  assert.equal(unsupportedMode.status, 2, `unsupported mode should exit 2, got ${unsupportedMode.status}`);
  assert.match(
    unsupportedMode.stderr,
    /Unsupported mode: live-run\. Supported modes: dry-run, null-runner\./,
    "unsupported mode error message mismatch",
  );
  assert.equal(unsupportedMode.stdout, "", "unsupported mode should not print JSON stdout");
}

function testRuntimePreflightFailureStillStaysNonPassing() {
  const normalizedFixture = createNormalizedFixture();
  const loadedFixture = createLoadedFixture();
  const blockedPreflight = createPreflightReport("failed");

  const blockedRun = runRuntimeCaseSkeleton({
    fixtureDir: "/tmp/runtime-contract-fixture",
    loadedFixture,
    normalizedFixture,
    preflightReport: blockedPreflight,
    options: { mode: "dry-run" },
  });

  assert.notEqual(blockedRun.result.status, "passed");
  assert.equal(blockedRun.runtimeReport.cases.length, 1);
  assert.equal(blockedRun.runtimeReport.summary.passedCases, 0);
  assert.equal(blockedRun.runtimeReport.summary.passed, false);
  assert.equal(blockedRun.result.failureReason?.code, "RUNTIME_PREFLIGHT_BLOCKED");
  assert.match(blockedRun.result.failureReason?.message ?? "", /blocked by preflight findings/i);
}

const tests = [
  ["runtime replay report skeleton top-level contract", testRuntimeReplayReportSkeleton],
  ["single-case selector default/caseId/caseIndex behavior", testCaseSelectorStability],
  ["provider adapter contract exposes builtin key/slot/default seam semantics", testProviderAdapterContractBuiltinSemantics],
  ["dry-run and null-runner never masquerade as passed runtime", testDryAndNullRunnerNeverPass],
  ["runtime preflight taxonomy stays non-passing and does not masquerade as static", testRuntimePreflightTaxonomyDoesNotMasqueradeAsStaticOrPassed],
  ["runtime transcript artifact and runtime report reference stay aligned", testTranscriptArtifactAndReportReferenceContract],
  ["runtime transcript stub records orchestration evidence only", testTranscriptStubRecordsOnlyOrchestrationEvidence],
  ["transcript ref presence never upgrades draft statuses to passed", testTranscriptRefDoesNotUpgradeDraftStatuses],
  ["provider-backed runtime stays honest and intentionally unimplemented", testProviderBackedRuntimeStaysHonestAndUnimplemented],
  ["pending capabilities and draft metadata stay explicit", testPendingCapabilitiesAndDraftMetadata],
  ["runtime draft CLI emits runtime-replay-report and defaults to dry-run", testRuntimeDraftCliDefaultModeAndKind],
  ["runtime draft CLI keeps case-id and case-index selection stable", testRuntimeDraftCliStableCaseSelection],
  ["runtime CLI and orchestrator keep provider-backed seam out of static/preflight semantics", testRuntimeCliAndOrchestratorKeepProviderBackedSeamOutOfStaticPreflightSemantics],
  ["runtime draft CLI keeps passed preflight cases non-passed in draft mode", testRuntimeDraftCliPreflightPassedStillNotPassedCase],
  ["runtime draft CLI usage errors and unsupported mode stay stable", testRuntimeDraftCliUsageErrorsAndUnsupportedMode],
  ["runtime preflight failure still stays non-passing", testRuntimePreflightFailureStillStaysNonPassing],
];

let passed = 0;
for (const [name, fn] of tests) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

console.log(`Runtime contract tests passed: ${passed}/${tests.length} cases.`);
