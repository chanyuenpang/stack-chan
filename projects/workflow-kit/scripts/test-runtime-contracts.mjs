import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  buildRuntimeReplayReport,
  RUNTIME_REPLAY_KIND,
} from "../src/skillforge/runtime-replay-reporter.mjs";
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

function testBlockedSummaryAndCountsAlign() {
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

  assert.equal(blockedRun.result.status, "blocked");
  assert.equal(blockedRun.runtimeReport.summary.totalCases, 1);
  assert.equal(blockedRun.runtimeReport.summary.passedCases, 0);
  assert.equal(blockedRun.runtimeReport.summary.failedCases, 0);
  assert.equal(blockedRun.runtimeReport.summary.blockedCases, 1);
  assert.equal(blockedRun.runtimeReport.summary.warnings, 1);
  assert.equal(blockedRun.runtimeReport.summary.errors, 0);
  assert.equal(blockedRun.runtimeReport.cases[0].status, "blocked");
  assert.equal(blockedRun.runtimeReport.checks.length, 1);
  assert.deepEqual(
    blockedRun.runtimeReport.checks[0].evidence,
    ["RF-P1-PREFLIGHT-STATIC-BASELINE-PASSED"],
  );
  assert.equal(blockedRun.runtimeReport.cases.length, blockedRun.runtimeReport.summary.totalCases);
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

function testRuntimeCaseBlockedWhenPreflightFails() {
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

  assert.equal(blockedRun.result.status, "blocked");
  assert.equal(blockedRun.runtimeReport.status, "blocked");
  assert.equal(blockedRun.runtimeReport.cases.length, 1);
  assert.equal(blockedRun.runtimeReport.cases[0].status, "blocked");
  assert.equal(blockedRun.runtimeReport.summary.blockedCases, 1);
  assert.equal(blockedRun.runtimeReport.summary.passedCases, 0);
  assert.equal(blockedRun.runtimeReport.summary.passed, false);
}

const tests = [
  ["runtime replay report skeleton top-level contract", testRuntimeReplayReportSkeleton],
  ["single-case selector default/caseId/caseIndex behavior", testCaseSelectorStability],
  ["dry-run and null-runner never masquerade as passed runtime", testDryAndNullRunnerNeverPass],
  ["blocked case summary and counts stay aligned", testBlockedSummaryAndCountsAlign],
  ["pending capabilities and draft metadata stay explicit", testPendingCapabilitiesAndDraftMetadata],
  ["runtime draft CLI emits runtime-replay-report and defaults to dry-run", testRuntimeDraftCliDefaultModeAndKind],
  ["runtime draft CLI keeps case-id and case-index selection stable", testRuntimeDraftCliStableCaseSelection],
  ["runtime draft CLI keeps passed preflight cases non-passed in draft mode", testRuntimeDraftCliPreflightPassedStillNotPassedCase],
  ["runtime draft CLI usage errors and unsupported mode stay stable", testRuntimeDraftCliUsageErrorsAndUnsupportedMode],
  ["runtime runner skeleton marks case blocked when preflight fails", testRuntimeCaseBlockedWhenPreflightFails],
];

let passed = 0;
for (const [name, fn] of tests) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

console.log(`Runtime contract tests passed: ${passed}/${tests.length} cases.`);
