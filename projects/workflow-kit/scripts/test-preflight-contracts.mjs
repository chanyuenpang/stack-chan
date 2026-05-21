#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const fixturePath = path.join(projectRoot, "fixtures", "meeting-summary-assistant");
const validatePreflightScript = path.join(projectRoot, "scripts", "validate-preflight.mjs");
const expectedPendingCapabilities = [
  "runtime-runner",
  "transcript-engine",
  "sandbox-implementation",
];

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: "utf8",
    ...options,
  });
}

function parseJson(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${label}: stdout is not valid JSON\n${stdout}`);
  }
}

function assertSummaryMatchesChecks(report, label) {
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const blockingFailures = checks.filter(
    (check) => ["P0", "P1"].includes(check?.severity) && ["fail", "error"].includes(check?.status),
  ).length;
  const warnings = checks.filter((check) => check?.status === "warn").length;
  const byStatus = checks.reduce((acc, check) => {
    const key = check?.status ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const bySeverity = checks.reduce((acc, check) => {
    const key = check?.severity ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  assert.equal(report.summary.totalChecks, checks.length, `${label}: summary.totalChecks mismatch`);
  assert.deepEqual(report.summary.byStatus, byStatus, `${label}: summary.byStatus mismatch`);
  assert.deepEqual(report.summary.bySeverity, bySeverity, `${label}: summary.bySeverity mismatch`);
  assert.equal(report.summary.blockingFailures, blockingFailures, `${label}: blockingFailures mismatch`);
  assert.equal(report.summary.warnings, warnings, `${label}: warnings mismatch`);
  assert.equal(report.summary.errors, Array.isArray(report.errors) ? report.errors.length : 0, `${label}: errors mismatch`);
}

function assertTopLevelContract(report, label) {
  assert.equal(report.kind, "runtime-preflight-result", `${label}: kind mismatch`);
  assert.equal(typeof report.reportVersion, "string", `${label}: missing reportVersion`);
  assert.equal(typeof report.protocolVersion, "string", `${label}: missing protocolVersion`);
  assert.equal(typeof report.ruleSetVersion, "string", `${label}: missing ruleSetVersion`);
  assert.equal(typeof report.status, "string", `${label}: missing status`);
  assert.ok(report.fixture && typeof report.fixture === "object", `${label}: missing fixture`);
  assert.ok(report.summary && typeof report.summary === "object", `${label}: missing summary`);
  assert.ok(Array.isArray(report.checks), `${label}: checks must be an array`);
  assert.ok(Array.isArray(report.errors), `${label}: errors must be an array`);
  assert.ok(Array.isArray(report.pendingCapabilities), `${label}: pendingCapabilities must be an array`);
}

function assertPositiveFixtureIdentity(report, label) {
  assert.equal(report.fixture.path, "fixtures/meeting-summary-assistant", `${label}: fixture.path mismatch`);
  assert.equal(report.fixture.id, "meeting-summary-assistant", `${label}: fixture.id mismatch`);
  assert.equal(report.fixture.version, "0.1.0", `${label}: fixture.version mismatch`);
  assert.equal(report.fixture.entry, "skill/SKILL.md", `${label}: fixture.entry mismatch`);
  assert.equal(report.fixture.profile, null, `${label}: fixture.profile mismatch`);
}

async function withBrokenReplayFixture(mutator, callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "skillforge-preflight-contract-"));
  const tempFixture = path.join(tempRoot, "fixture");
  await fs.cp(fixturePath, tempFixture, { recursive: true });
  await mutator(tempFixture);
  try {
    await callback(tempFixture);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  const positive = runNode([validatePreflightScript, fixturePath, "--format", "json"]);
  assert.equal(positive.status, 0, `positive fixture should exit 0, got ${positive.status}\n${positive.stderr}`);
  assert.equal(positive.stderr.trim(), "", "positive fixture should not write stderr");

  const positiveReport = parseJson(positive.stdout, "positive fixture");
  assertTopLevelContract(positiveReport, "positive fixture");
  assertPositiveFixtureIdentity(positiveReport, "positive fixture");
  assertSummaryMatchesChecks(positiveReport, "positive fixture");
  assert.equal(positiveReport.status, "passed", "positive fixture should pass preflight");
  assert.equal(positiveReport.summary.passed, true, "positive fixture summary.passed should be true");
  assert.deepEqual(
    positiveReport.pendingCapabilities,
    expectedPendingCapabilities,
    "positive fixture pendingCapabilities mismatch",
  );

  const missingUsage = runNode([validatePreflightScript]);
  assert.equal(missingUsage.status, 2, `missing path should exit 2, got ${missingUsage.status}`);
  assert.match(missingUsage.stderr, /Missing fixture path\./, "missing path error message mismatch");
  assert.match(missingUsage.stdout, /Usage: pnpm validate:preflight/, "missing path should print usage");

  const unsupportedFormat = runNode([validatePreflightScript, fixturePath, "--format", "yaml"]);
  assert.equal(unsupportedFormat.status, 2, `unsupported format should exit 2, got ${unsupportedFormat.status}`);
  assert.match(unsupportedFormat.stderr, /Unsupported format: yaml/, "unsupported format error message mismatch");

  await withBrokenReplayFixture(
    async (tempFixture) => {
      const replayPath = path.join(tempFixture, "replay-cases.yaml");
      const replayContent = await fs.readFile(replayPath, "utf8");
      const broken = replayContent.replace(/expectedBehavior:\n(?:\s+- .*\n)+/m, "expectedBehavior: []\n");
      assert.notEqual(broken, replayContent, "failed to mutate replay-cases.yaml for negative preflight test");
      await fs.writeFile(replayPath, broken);
    },
    async (tempFixture) => {
      const negative = runNode([validatePreflightScript, tempFixture, "--format", "json"]);
      assert.equal(negative.status, 1, `negative fixture should exit 1, got ${negative.status}\n${negative.stderr}`);
      assert.equal(negative.stderr.trim(), "", "negative fixture should not write stderr");

      const negativeReport = parseJson(negative.stdout, "negative fixture");
      assertTopLevelContract(negativeReport, "negative fixture");
      assertSummaryMatchesChecks(negativeReport, "negative fixture");
      assert.equal(negativeReport.status, "failed", "negative fixture should fail preflight");
      assert.equal(negativeReport.summary.passed, false, "negative fixture summary.passed should be false");
      assert.ok(negativeReport.summary.blockingFailures >= 1, "negative fixture should report blocking failures");
      assert.ok(
        negativeReport.checks.some((check) => check.id === "RF-P1-PREFLIGHT-REPLAY-CASES-MINIMAL" && check.status === "fail"),
        "negative fixture should fail RF-P1-PREFLIGHT-REPLAY-CASES-MINIMAL",
      );
    },
  );

  console.log("Preflight contract tests passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
