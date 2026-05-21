import path from "node:path";

import { JSON_REPORT_CONTRACT, RULE_COUNTS } from "./rules.mjs";

export const REPORT_VERSION = "0.1.0";

const BLOCKING_SEVERITIES = new Set(JSON_REPORT_CONTRACT.blockingSeverities);

function safeFixturePath(fixtureDir) {
  if (!fixtureDir) return null;
  const cwd = process.cwd();
  const relative = path.relative(cwd, path.resolve(fixtureDir));
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative;
  return path.basename(path.resolve(fixtureDir));
}

function countBy(values, key) {
  const counts = {};
  for (const value of values) {
    const name = value?.[key] ?? "unknown";
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

function hasBlockingFailure(checks, errors) {
  if (errors.length > 0) return true;
  return checks.some(
    (check) => BLOCKING_SEVERITIES.has(check.severity) && ["fail", "error"].includes(check.status),
  );
}

export function buildReport({ fixtureDir, normalized = null, checks = [], errors = [], options = {} } = {}) {
  const sortedChecks = [...checks].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const normalizedErrors = errors.map((error) => ({
    code: error?.code ?? "VALIDATION_ERROR",
    message: error?.message ?? String(error),
    file: error?.file,
    ruleId: error?.ruleId,
  }));
  const passed = !hasBlockingFailure(sortedChecks, normalizedErrors);

  const summary = {
    passed,
    total: sortedChecks.length,
    byStatus: countBy(sortedChecks, "status"),
    bySeverity: countBy(sortedChecks, "severity"),
    blockingFailures: sortedChecks.filter(
      (check) => BLOCKING_SEVERITIES.has(check.severity) && ["fail", "error"].includes(check.status),
    ).length,
    warnings: sortedChecks.filter((check) => check.status === "warn").length,
    errors: normalizedErrors.length,
  };

  const fixture = {
    path: safeFixturePath(fixtureDir),
    id: normalized?.fixtureId ?? null,
    version: normalized?.fixtureVersion ?? null,
    entry: normalized?.entryPath ?? null,
    profile: normalized?.profile ?? null,
  };

  const generatedAt = options.generatedAt ?? new Date().toISOString();

  return {
    reportVersion: REPORT_VERSION,
    ruleSetVersion: options.ruleSetVersion ?? "skillforge-static-mvp-0.1.0",
    fixture,
    status: passed ? "passed" : "failed",
    summary,
    checks: sortedChecks,
    errors: normalizedErrors,
    metadata: {
      generatedAt,
      validator: "skillforge-static-mvp",
      format: options.format ?? "json",
      contract: {
        topLevelFields: [...JSON_REPORT_CONTRACT.topLevelFields],
        findingFields: [...JSON_REPORT_CONTRACT.findingFields],
      },
    },
    // Compatibility aliases for the T2 contract skeleton.
    rules: RULE_COUNTS,
    findings: sortedChecks.filter((check) => ["fail", "warn", "error"].includes(check.status)),
    generatedAt,
  };
}

export default buildReport;
