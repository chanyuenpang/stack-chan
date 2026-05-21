import buildPreflightInput from "./preflight-adapter.mjs";
import buildPreflightReport from "./preflight-reporter.mjs";
import {
  getPreflightRule,
  PREFLIGHT_RULESET_VERSION,
} from "./preflight-rules.mjs";

function safeDetail(detail) {
  return String(detail ?? "").slice(0, 500);
}

function evidence(file, detail) {
  return { file, detail: safeDetail(detail) };
}

function check(id, status, message, evidenceItems = []) {
  const rule = getPreflightRule(id);
  return {
    id: rule.id,
    severity: rule.severity,
    category: rule.category,
    status,
    message,
    evidence: evidenceItems,
    closeCondition: rule.closeCondition,
  };
}

function errorToReportError(error) {
  return {
    code: error?.code ?? error?.name ?? "PREFLIGHT_EXCEPTION",
    message: safeDetail(error?.message ?? String(error)),
    file: error?.file,
    checkId: error?.checkId,
  };
}

function hasPassingStaticBaseline(preflight) {
  return preflight?.staticBaseline?.status === "passed" && preflight?.staticBaseline?.passed === true;
}

function evaluateStaticBaseline(preflight) {
  const staticBaseline = preflight?.staticBaseline;
  if (hasPassingStaticBaseline(preflight)) {
    return check(
      "RF-P1-PREFLIGHT-STATIC-BASELINE-PASSED",
      "pass",
      "Static baseline passed and is acceptable for runtime preflight.",
      [
        evidence(
          "validation-result.yaml",
          `status=${staticBaseline.status}; totalChecks=${staticBaseline.totalChecks}; blockingFailures=${staticBaseline.blockingFailures}; errors=${staticBaseline.errors}`,
        ),
      ],
    );
  }

  if (!staticBaseline) {
    return check(
      "RF-P1-PREFLIGHT-STATIC-BASELINE-PASSED",
      "fail",
      "Static baseline report is missing; preflight cannot confirm runtime readiness without it.",
      [evidence("validation-result.yaml", "static baseline report not provided to preflight adapter")],
    );
  }

  return check(
    "RF-P1-PREFLIGHT-STATIC-BASELINE-PASSED",
    "fail",
    "Static baseline did not pass, so runtime preflight remains blocked.",
    [
      evidence(
        "validation-result.yaml",
        `status=${staticBaseline.status}; passed=${staticBaseline.passed}; blockingFailures=${staticBaseline.blockingFailures}; errors=${staticBaseline.errors}`,
      ),
    ],
  );
}

function evaluateReplayCasesMinimal(preflight) {
  const cases = preflight?.normalized?.replayCases?.cases ?? [];
  const invalidCases = [];

  for (const item of cases) {
    const missing = [];
    if (!String(item?.id ?? "").trim()) missing.push("id");
    if (!String(item?.type ?? "").trim()) missing.push("type");
    if (!String(item?.intent ?? "").trim()) missing.push("intent");
    const expectedBehavior = item?.expectedBehavior;
    const hasExpectedBehavior = Array.isArray(expectedBehavior)
      ? expectedBehavior.length > 0
      : String(expectedBehavior ?? "").trim() !== "";
    if (!hasExpectedBehavior) missing.push("expectedBehavior");
    if (missing.length > 0) invalidCases.push({ id: item?.id ?? "<unknown>", missing });
  }

  if (cases.length > 0 && invalidCases.length === 0) {
    return check(
      "RF-P1-PREFLIGHT-REPLAY-CASES-MINIMAL",
      "pass",
      "Replay cases expose the minimal runtime-preflight shape.",
      [evidence("replay-cases.yaml", `${cases.length} replay cases provide id/type/intent/expectedBehavior`)],
    );
  }

  const evidenceItems =
    cases.length === 0
      ? [evidence("replay-cases.yaml", "no replay cases declared")]
      : invalidCases.map((item) => evidence("replay-cases.yaml", `case ${item.id} missing ${item.missing.join(", ")}`));

  return check(
    "RF-P1-PREFLIGHT-REPLAY-CASES-MINIMAL",
    "fail",
    cases.length === 0
      ? "Replay cases are missing; preflight needs at least one declared case."
      : "Replay cases are missing required minimal fields for runtime preflight.",
    evidenceItems,
  );
}

function evaluateCaseIdentityStable(preflight) {
  const cases = preflight?.normalized?.replayCases?.cases ?? [];
  const replayFixtureId = preflight?.replayCases?.fixtureId ?? null;
  const fixtureId = preflight?.fixture?.id ?? null;
  const seen = new Set();
  const problems = [];

  for (const item of cases) {
    const id = String(item?.id ?? "").trim();
    if (!id) continue;
    if (seen.has(id)) problems.push(`duplicate id ${id}`);
    seen.add(id);
  }

  if (fixtureId && replayFixtureId && fixtureId !== replayFixtureId) {
    problems.push(`fixture id mismatch fixture=${fixtureId} replayCases=${replayFixtureId}`);
  }

  if (cases.length > 0 && problems.length === 0) {
    return check(
      "RF-P1-PREFLIGHT-CASE-IDENTITY-STABLE",
      "pass",
      "Replay case identities are stable and trace back to the fixture declaration.",
      [evidence("replay-cases.yaml", `fixtureId=${replayFixtureId ?? fixtureId ?? "unknown"}; uniqueCaseIds=${seen.size}`)],
    );
  }

  return check(
    "RF-P1-PREFLIGHT-CASE-IDENTITY-STABLE",
    "fail",
    "Replay case identity is unstable or cannot be traced cleanly to the fixture declaration.",
    problems.length > 0
      ? problems.map((item) => evidence("replay-cases.yaml", item))
      : [evidence("replay-cases.yaml", "case identities unavailable")],
  );
}

function evaluateForgedRuntimeResult(preflight) {
  const findings = [];
  for (const item of preflight?.normalized?.replayCases?.cases ?? []) {
    if (item?.passed === true && (item?.observed === null || item?.observed === undefined || item?.observed === false || item?.observed === "")) {
      findings.push(evidence("replay-cases.yaml", `case ${item?.id ?? "<unknown>"}: passed=true without observed evidence`));
    }
  }

  const validation = preflight?.normalized?.validationResult?.validation ?? {};
  if ((validation.status === "passed" || validation.passed === true) && validation.executed !== true && validation.modelReplayExecuted !== true) {
    findings.push(evidence("validation-result.yaml", "validation passed without executed/modelReplayExecuted evidence"));
  }

  return findings.length === 0
    ? check(
        "RF-P0-PREFLIGHT-FORGED-RUNTIME-RESULT",
        "pass",
        "No forged runtime result claims were detected in replay or validation data.",
        [evidence("replay-cases.yaml", "no claimed runtime pass without execution evidence")],
      )
    : check(
        "RF-P0-PREFLIGHT-FORGED-RUNTIME-RESULT",
        "fail",
        "Fixture data appears to forge runtime results without execution evidence.",
        findings,
      );
}

function evaluateBoundaryDeclared(preflight) {
  const hasBoundary =
    (preflight?.toolBoundary?.allowedActions?.length ?? 0) > 0 ||
    (preflight?.toolBoundary?.deniedActions?.length ?? 0) > 0 ||
    (preflight?.permissions?.allowed?.length ?? 0) > 0 ||
    (preflight?.permissions?.denied?.length ?? 0) > 0 ||
    preflight?.permissions?.conservativeDefault === true ||
    preflight?.toolBoundary?.permissions?.conservativeDefault === true ||
    preflight?.toolBoundary?.bodyMentionsConservativeBoundary === true;

  return hasBoundary
    ? check(
        "RF-P1-PREFLIGHT-BOUNDARY-DECLARED",
        "pass",
        "Runtime boundary is declared clearly enough for minimal preflight review.",
        [
          evidence(
            "skill-spec.yaml",
            `allowed=${(preflight?.toolBoundary?.allowedActions ?? []).length}; denied=${(preflight?.toolBoundary?.deniedActions ?? []).length}; permissionsAllowed=${(preflight?.permissions?.allowed ?? []).length}; permissionsDenied=${(preflight?.permissions?.denied ?? []).length}`,
          ),
        ],
      )
    : check(
        "RF-P1-PREFLIGHT-BOUNDARY-DECLARED",
        "fail",
        "Runtime boundary is missing or too ambiguous for preflight review.",
        [evidence("skill-spec.yaml", "no boundary declarations or conservative default signals found")],
      );
}

function evaluateRuntimeHintMissing(preflight) {
  const hasHints =
    Boolean(preflight?.method?.generationMode) ||
    Boolean(preflight?.method?.validationMode) ||
    (preflight?.dependencies?.explicit?.length ?? 0) > 0 ||
    (preflight?.checklist?.dimensions?.length ?? 0) > 0;

  return hasHints
    ? check(
        "RF-P2-PREFLIGHT-RUNTIME-HINT-MISSING",
        "pass",
        "Fixture already exposes some runtime-oriented hint metadata.",
        [
          evidence(
            "generation-run.yaml",
            `generationMode=${preflight?.method?.generationMode ?? "n/a"}; validationMode=${preflight?.method?.validationMode ?? "n/a"}`,
          ),
        ],
      )
    : check(
        "RF-P2-PREFLIGHT-RUNTIME-HINT-MISSING",
        "warn",
        "Runtime hint metadata is still missing; acceptable for now, but future runner routing will want more hints.",
        [evidence("generation-run.yaml", "no generation/validation/dependency/checklist hints available")],
      );
}

function evaluateProfileTiering(preflight) {
  const profile = String(preflight?.fixture?.profile ?? "").trim();
  return profile
    ? check(
        "RF-P2-PREFLIGHT-PROFILE-NOT-YET-TIERED",
        "warn",
        "Profile is declared, but runtime tier routing is not implemented yet.",
        [evidence("skill-manifest.yaml", `profile=${profile}`)],
      )
    : check(
        "RF-P2-PREFLIGHT-PROFILE-NOT-YET-TIERED",
        "warn",
        "Fixture profile is not yet declared for future runtime tier routing.",
        [evidence("skill-manifest.yaml", "profile missing")],
      );
}

export function evaluatePreflight(preflight) {
  if (!preflight || typeof preflight !== "object") {
    throw new TypeError("evaluatePreflight expected a preflight input object");
  }

  return [
    evaluateStaticBaseline(preflight),
    evaluateReplayCasesMinimal(preflight),
    evaluateCaseIdentityStable(preflight),
    evaluateForgedRuntimeResult(preflight),
    evaluateBoundaryDeclared(preflight),
    evaluateRuntimeHintMissing(preflight),
    evaluateProfileTiering(preflight),
  ];
}

export function validatePreflight({ fixtureDir = null, loadedFixture, normalizedFixture = null, staticReport = null, options = {} } = {}) {
  const errors = [];
  let preflight = null;
  let checks = [];

  try {
    preflight = buildPreflightInput({ fixtureDir, loadedFixture, normalizedFixture, staticReport });
    checks = evaluatePreflight(preflight);
  } catch (error) {
    errors.push(errorToReportError(error));
  }

  return buildPreflightReport({
    fixtureDir,
    preflight,
    checks,
    errors,
    options: {
      ...options,
      ruleSetVersion: options.ruleSetVersion ?? PREFLIGHT_RULESET_VERSION,
    },
  });
}

export default validatePreflight;
