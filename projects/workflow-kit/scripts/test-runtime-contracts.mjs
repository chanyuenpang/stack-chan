import assert from "node:assert/strict";

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
  assert.match(report.metadata.note, /skeleton-only artifact/i);
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

const tests = [
  ["runtime replay report skeleton top-level contract", testRuntimeReplayReportSkeleton],
  ["single-case selector default/caseId/caseIndex behavior", testCaseSelectorStability],
  ["dry-run and null-runner never masquerade as passed runtime", testDryAndNullRunnerNeverPass],
  ["blocked case summary and counts stay aligned", testBlockedSummaryAndCountsAlign],
  ["pending capabilities and draft metadata stay explicit", testPendingCapabilitiesAndDraftMetadata],
];

let passed = 0;
for (const [name, fn] of tests) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

console.log(`Runtime contract tests passed: ${passed}/${tests.length} cases.`);
