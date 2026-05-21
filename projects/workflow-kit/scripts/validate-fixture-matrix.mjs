#!/usr/bin/env node

import { mkdtemp, rm, cp, readFile, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const FIXTURE = path.resolve("fixtures/meeting-summary-assistant");
const CLI = path.resolve("scripts/validate-fixture.mjs");

function runValidator(fixtureDir) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, fixtureDir, "--format", "json"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function updateFile(root, relativePath, mutate) {
  const filePath = path.join(root, relativePath);
  const before = await readFile(filePath, "utf8");
  const after = mutate(before);
  if (after === before) throw new Error(`Mutation made no change: ${relativePath}`);
  await writeFile(filePath, after);
}

async function removeCompatibilityLines(root) {
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (/\.(md|ya?ml)$/iu.test(entry.name)) {
        let text = await readFile(fullPath, "utf8");
        const before = text;
        text = text.replace(/\n    compatibility:\n      status:.*\n      note:.*\n/gu, "\n");
        text = text.replace(/^\s*compatibility:.*\n/gimu, "");
        text = text.replace(/^\s*-\s*compatibility[：:].*\n/gimu, "");
        text = text.replace(/、compatibility/gu, "");
        text = text.replace(/, compatibility/giu, "");
        if (text !== before) await writeFile(fullPath, text);
      }
    }
  }
  await walk(root);
}

const cases = [
  {
    name: "positive baseline",
    expectCode: 0,
    expectPassed: true,
  },
  {
    name: "missing description/trigger",
    expectCode: 1,
    expectPassed: false,
    expectRules: ["SF-P1-STRUCTURE-SKILL-FRONTMATTER-CORE-FIELDS", "SF-P1-TRIGGER-DESCRIPTION-ACTIONABLE"],
    mutate: (root) => updateFile(root, "skill/SKILL.md", (text) => text.replace(/^description:.*\n/mu, "")),
  },
  {
    name: "secret/token",
    expectCode: 1,
    expectPassed: false,
    expectRules: ["SF-P0-PRIVACY-HIGH-CONFIDENCE-LEAK"],
    maxEvidenceByRule: { "SF-P0-PRIVACY-HIGH-CONFIDENCE-LEAK": 2 },
    mutate: (root) => updateFile(root, "README.md", (text) => `${text}\n\nDebug note: token = abcdefgh12345678\nDebug note duplicate: token = abcdefgh12345678\n`),
  },
  {
    name: "private path",
    expectCode: 1,
    expectPassed: false,
    expectRules: ["SF-P0-PRIVACY-HIGH-CONFIDENCE-LEAK"],
    maxEvidenceByRule: { "SF-P0-PRIVACY-HIGH-CONFIDENCE-LEAK": 2 },
    mutate: (root) => updateFile(root, "README.md", (text) => `${text}\n\nPrivate examples: /home/example/.ssh/id_rsa and C:\\Users\\Example\\.env\nPrivate examples duplicate: /home/example/.ssh/id_rsa and C:\\Users\\Example\\.env\n`),
  },
  {
    name: "forged replay",
    expectCode: 1,
    expectPassed: false,
    expectRules: ["SF-P0-REPLAY-PASSED-WITHOUT-OBSERVED-EVIDENCE"],
    mutate: (root) => updateFile(root, "replay-cases.yaml", (text) => text.replace("    observed: null\n    passed: null\n", "    observed: null\n    passed: true\n")),
  },
  {
    name: "all-source missing compatibility",
    expectCode: 1,
    expectPassed: false,
    expectRules: ["SF-P1-STRUCTURE-SEVEN-DIMENSION-CHECKLIST"],
    mutate: removeCompatibilityLines,
  },
];

function parseJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`stdout is not valid JSON: ${error.message}`);
  }
}

function failedRuleIds(report) {
  return new Set((report.checks ?? []).filter((check) => ["fail", "error"].includes(check.status)).map((check) => check.id));
}

function checkById(report, id) {
  return (report.checks ?? []).find((check) => check.id === id);
}

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillforge-fixture-matrix-"));
  const results = [];
  let failures = 0;

  try {
    for (const testCase of cases) {
      const caseDir = path.join(tempRoot, testCase.name.replace(/[^a-z0-9]+/giu, "-"));
      await cp(FIXTURE, caseDir, { recursive: true });
      if (testCase.mutate) await testCase.mutate(caseDir);

      const run = await runValidator(caseDir);
      const report = parseJson(run.stdout);
      const failedIds = failedRuleIds(report);
      const errors = [];

      if (run.code !== testCase.expectCode) errors.push(`exit ${run.code}, expected ${testCase.expectCode}`);
      if (report.summary?.passed !== testCase.expectPassed) errors.push(`summary.passed ${report.summary?.passed}, expected ${testCase.expectPassed}`);
      for (const ruleId of testCase.expectRules ?? []) {
        if (!failedIds.has(ruleId)) errors.push(`missing failed rule ${ruleId}`);
      }
      for (const [ruleId, max] of Object.entries(testCase.maxEvidenceByRule ?? {})) {
        const evidenceCount = checkById(report, ruleId)?.evidence?.length ?? 0;
        if (evidenceCount > max) errors.push(`${ruleId} evidence count ${evidenceCount}, expected <= ${max}`);
      }
      if (run.stderr.trim()) errors.push(`unexpected stderr: ${run.stderr.trim()}`);

      if (errors.length > 0) failures += 1;
      results.push({ name: testCase.name, code: run.code, passed: report.summary?.passed, failedRules: [...failedIds], errors });
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  for (const result of results) {
    const marker = result.errors.length === 0 ? "✓" : "✗";
    console.log(`${marker} ${result.name}: exit=${result.code}, passed=${result.passed}, failedRules=${result.failedRules.join(",") || "-"}`);
    for (const error of result.errors) console.log(`  - ${error}`);
  }

  if (failures > 0) {
    console.error(`Fixture matrix failed: ${failures}/${results.length} cases failed.`);
    process.exit(1);
  }
  console.log(`Fixture matrix passed: ${results.length}/${results.length} cases.`);
}

main().catch((error) => {
  console.error(error?.stack ?? error?.message ?? String(error));
  process.exit(1);
});
