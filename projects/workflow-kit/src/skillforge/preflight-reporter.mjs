import path from "node:path";

export const PREFLIGHT_REPORT_VERSION = "0.1.0-draft";
export const PREFLIGHT_PROTOCOL_VERSION = "preflight-contract-draft-1";
export const PREFLIGHT_KIND = "runtime-preflight-result";
export const PREFLIGHT_RULESET_VERSION = "skillforge-preflight-draft-0.1.0";

const BLOCKING_SEVERITIES = new Set(["P0", "P1"]);

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

function normalizeError(error) {
  return {
    code: error?.code ?? "PREFLIGHT_ERROR",
    message: error?.message ?? String(error),
    file: error?.file,
    checkId: error?.checkId,
  };
}

export function buildPreflightReport({
  fixtureDir,
  preflight = null,
  checks = [],
  errors = [],
  options = {},
} = {}) {
  const sortedChecks = [...checks].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const normalizedErrors = errors.map(normalizeError);
  const passed = !hasBlockingFailure(sortedChecks, normalizedErrors);

  const summary = {
    passed,
    totalChecks: sortedChecks.length,
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
    id: preflight?.fixture?.id ?? null,
    version: preflight?.fixture?.version ?? null,
    entry: preflight?.fixture?.entry ?? null,
    profile: preflight?.fixture?.profile ?? null,
  };

  const generatedAt = options.generatedAt ?? new Date().toISOString();

  return {
    kind: PREFLIGHT_KIND,
    reportVersion: options.reportVersion ?? PREFLIGHT_REPORT_VERSION,
    protocolVersion: options.protocolVersion ?? PREFLIGHT_PROTOCOL_VERSION,
    ruleSetVersion: options.ruleSetVersion ?? PREFLIGHT_RULESET_VERSION,
    fixture,
    status: passed ? "passed" : "failed",
    summary,
    checks: sortedChecks,
    errors: normalizedErrors,
    metadata: {
      generatedAt,
      validator: "skillforge-preflight-draft",
      sourceStaticReportVersion: preflight?.staticBaseline?.reportVersion ?? null,
      sourceStaticRuleSetVersion: preflight?.staticBaseline?.ruleSetVersion ?? null,
      sourceReplayCasesKind: preflight?.replayCases?.kind ?? null,
      normalizedFixtureVersion: preflight?.normalizedFixtureVersion ?? 1,
    },
    pendingCapabilities: Array.isArray(preflight?.pendingCapabilities)
      ? [...preflight.pendingCapabilities]
      : ["runtime-runner", "transcript-engine", "sandbox-implementation"],
  };
}

export default buildPreflightReport;
