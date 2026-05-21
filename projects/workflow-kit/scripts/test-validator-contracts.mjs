import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const REPORT_VERSION = "0.1.0";
const RULE_SET_VERSION = "skillforge-static-mvp-0.1.0";
const VALIDATOR_NAME = "skillforge-static-mvp";
const CURRENT_CHECK_BASELINE = 17;
const CURRENT_TOTAL_CHECK_BASELINE = 51;
const MATRIX_SUCCESS_LINE = "Fixture matrix passed: 6/6 cases.";
const EXPECTED_MATRIX_CASE_LINES = [
  "✓ positive baseline:",
  "✓ missing description/trigger:",
  "✓ secret/token:",
  "✓ private path:",
  "✓ forged replay:",
  "✓ all-source missing compatibility:",
];

const SINGLE_FIXTURES = [
  {
    fixturePath: "fixtures/meeting-summary-assistant",
    expectedProfile: null,
  },
  {
    fixturePath: "fixtures/study-card-assistant",
    expectedProfile: "simple",
  },
  {
    fixturePath: "fixtures/release-notes-assistant",
    expectedProfile: "standard",
  },
];

const EXPECTED_PROFILE_BY_ID = {
  "meeting-summary-assistant": null,
  "study-card-assistant": "simple",
  "release-notes-assistant": "standard",
};

function runPnpm(args) {
  const stdout = execFileSync("pnpm", ["--silent", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return stdout;
}

function parseJsonCommand(args) {
  const stdout = runPnpm(args);
  let parsed;

  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new assert.AssertionError({
      message: `Expected JSON stdout for: pnpm --silent ${args.join(" ")}`,
      actual: stdout,
      expected: "valid JSON",
      operator: "json-parse",
      stackStartFn: parseJsonCommand,
    });
  }

  return { stdout, parsed };
}

function assertHasKeys(object, keys, label) {
  assert.equal(typeof object, "object", `${label} should be an object`);
  assert.notEqual(object, null, `${label} should not be null`);

  for (const key of keys) {
    assert.ok(Object.hasOwn(object, key), `${label} should include ${key}`);
  }
}

function assertSingleFixtureReport(report, fixturePath, expectedProfile) {
  assertHasKeys(
    report,
    [
      "reportVersion",
      "ruleSetVersion",
      "fixture",
      "status",
      "summary",
      "checks",
      "errors",
      "metadata",
      "rules",
      "findings",
      "generatedAt",
    ],
    `${fixturePath} report`,
  );

  assertHasKeys(report.fixture, ["path", "id", "version", "entry", "profile"], `${fixturePath} fixture`);
  assertHasKeys(
    report.summary,
    ["passed", "total", "byStatus", "bySeverity", "blockingFailures", "warnings", "errors"],
    `${fixturePath} summary`,
  );

  assert.equal(report.status, "passed", `${fixturePath} status baseline changed`);
  assert.equal(report.summary.passed, true, `${fixturePath} summary.passed baseline changed`);
  assert.ok(Array.isArray(report.checks), `${fixturePath} checks should be an array`);
  assert.ok(Array.isArray(report.findings), `${fixturePath} findings should be an array`);
  assert.ok(Array.isArray(report.errors), `${fixturePath} errors should be an array`);
  assert.equal(report.errors.length, 0, `${fixturePath} should have no top-level errors`);
  assert.equal(report.fixture.path, fixturePath, `${fixturePath} fixture.path mismatch`);
  assert.equal(report.fixture.entry, "skill/SKILL.md", `${fixturePath} fixture.entry mismatch`);
  assert.equal(report.fixture.profile, expectedProfile, `${fixturePath} fixture.profile mismatch`);
  assert.equal(report.summary.total, report.checks.length, `${fixturePath} summary.total should equal checks.length`);
  assert.equal(report.reportVersion, REPORT_VERSION, `${fixturePath} reportVersion mismatch`);
  assert.equal(report.ruleSetVersion, RULE_SET_VERSION, `${fixturePath} ruleSetVersion mismatch`);
  assert.equal(report.metadata.validator, VALIDATOR_NAME, `${fixturePath} metadata.validator mismatch`);
  assert.equal(report.metadata.format, "json", `${fixturePath} metadata.format mismatch`);
  assert.equal(
    report.summary.total,
    CURRENT_CHECK_BASELINE,
    `${fixturePath} current static MVP check baseline changed; update contract test intentionally if validator contract changes`,
  );
}

function assertMultiFixtureReport(report) {
  assertHasKeys(
    report,
    ["reportVersion", "ruleSetVersion", "kind", "status", "summary", "fixtures", "failures", "metadata"],
    "multi-fixture report",
  );

  assert.equal(report.kind, "multi-fixture-validation-report");
  assert.equal(report.status, "passed");
  assert.equal(report.summary.passed, true);
  assert.equal(report.summary.totalFixtures, 3);
  assert.equal(report.summary.passedFixtures, 3);
  assert.equal(report.summary.failedFixtures, 0);
  assert.equal(
    report.summary.totalChecks,
    CURRENT_TOTAL_CHECK_BASELINE,
    "Current static MVP multi-fixture totalChecks baseline changed; update intentionally if validator contract evolves",
  );
  assert.equal(report.summary.errors, 0);
  assert.ok(Array.isArray(report.fixtures), "multi-fixture fixtures should be an array");
  assert.equal(report.fixtures.length, 3);
  assert.ok(Array.isArray(report.failures), "multi-fixture failures should be an array");
  assert.equal(report.failures.length, 0);

  const profileById = Object.fromEntries(report.fixtures.map((fixture) => [fixture.id, fixture.profile]));
  assert.deepEqual(profileById, EXPECTED_PROFILE_BY_ID, "multi-fixture id->profile mapping mismatch");
}

function assertStdoutContains(stdout, expectedLines, label) {
  for (const line of expectedLines) {
    assert.match(stdout, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${label} missing line: ${line}`);
  }
}

function main() {
  for (const { fixturePath, expectedProfile } of SINGLE_FIXTURES) {
    const { parsed } = parseJsonCommand(["validate:fixture", fixturePath, "--format", "json"]);
    assertSingleFixtureReport(parsed, fixturePath, expectedProfile);
  }

  const multiFixture = parseJsonCommand(["validate:fixtures"]);
  assertMultiFixtureReport(multiFixture.parsed);

  const validateAllStdout = runPnpm(["validate:all"]);
  assertStdoutContains(
    validateAllStdout,
    [
      "== validate:fixtures ==",
      "exit=0",
      "status=passed",
      "fixtures passed 3/3",
      "totalChecks=51",
      "blockingFailures=0",
      "warnings=0",
      "errors=0",
      "== validate:fixture:matrix ==",
      MATRIX_SUCCESS_LINE,
    ],
    "validate:all stdout",
  );

  const matrixStdout = runPnpm(["validate:fixture:matrix"]);
  assertStdoutContains(matrixStdout, [...EXPECTED_MATRIX_CASE_LINES, MATRIX_SUCCESS_LINE], "validate:fixture:matrix stdout");

  console.log("Validator contract checks passed.");
}

main();
