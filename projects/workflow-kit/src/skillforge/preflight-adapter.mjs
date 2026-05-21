import normalizeFixture from "./normalize.mjs";

const DEFAULT_PENDING_CAPABILITIES = Object.freeze([
  "runtime-runner",
  "transcript-engine",
  "sandbox-implementation",
]);

function pickReplayCaseSummary(replayCases) {
  const cases = Array.isArray(replayCases?.cases) ? replayCases.cases : [];
  return {
    kind: replayCases?.kind ?? null,
    fixtureId: replayCases?.fixtureId ?? null,
    totalCases: cases.length,
    caseIds: cases.map((item) => item?.id).filter(Boolean),
    byType: cases.reduce((acc, item) => {
      const type = item?.type ?? "unknown";
      acc[type] = (acc[type] ?? 0) + 1;
      return acc;
    }, {}),
    hasObservedEvidence: cases.some((item) => item?.observed !== null && item?.observed !== undefined),
    hasDeclaredPassFail: cases.some((item) => item?.passed !== null && item?.passed !== undefined),
  };
}

function summarizeChecklist(checklist) {
  return {
    dimensions: Array.isArray(checklist?.dimensions) ? [...checklist.dimensions] : [],
    complete: checklist?.complete === true,
    sourceKeys: checklist?.bySource ? Object.keys(checklist.bySource) : [],
  };
}

function summarizeDependencies(dependencies) {
  return {
    explicit: Array.isArray(dependencies?.explicit) ? [...dependencies.explicit] : [],
    checklistSources: dependencies?.checklistNotes ? Object.keys(dependencies.checklistNotes) : [],
    noExternalDependenciesDeclared: dependencies?.noExternalDependenciesDeclared === true,
  };
}

function summarizeMethod(method) {
  return {
    generationMode: method?.generationMode ?? null,
    generationStatus: method?.generationStatus ?? null,
    validationMode: method?.validationMode ?? null,
    validationStatus: method?.validationStatus ?? null,
    modelReplayExecuted: method?.modelReplayExecuted ?? null,
  };
}

function summarizeStaticBaseline(staticReport) {
  if (!staticReport || typeof staticReport !== "object") return null;
  return {
    status: staticReport.status ?? null,
    passed: staticReport.summary?.passed ?? null,
    reportVersion: staticReport.reportVersion ?? null,
    ruleSetVersion: staticReport.ruleSetVersion ?? null,
    totalChecks: staticReport.summary?.total ?? null,
    blockingFailures: staticReport.summary?.blockingFailures ?? null,
    errors: staticReport.summary?.errors ?? null,
  };
}

function assertLoadedFixture(loadedFixture) {
  if (!loadedFixture || typeof loadedFixture !== "object") {
    throw new TypeError("buildPreflightInput expected loadedFixture");
  }
}

export function buildPreflightInput({ fixtureDir = null, loadedFixture, normalizedFixture = null, staticReport = null } = {}) {
  assertLoadedFixture(loadedFixture);

  const normalized = normalizedFixture ?? normalizeFixture(loadedFixture);
  const replayCases = pickReplayCaseSummary(normalized.replayCases);

  return {
    fixtureDir,
    fixture: {
      path: fixtureDir ?? null,
      id: normalized.fixtureId ?? null,
      version: normalized.fixtureVersion ?? null,
      entry: normalized.entryPath ?? null,
      profile: normalized.profile ?? null,
    },
    normalizedFixtureVersion: 1,
    replayCases,
    permissions: {
      merged: normalized.permissions?.merged ?? {},
      allowed: Array.isArray(normalized.permissions?.allowed) ? [...normalized.permissions.allowed] : [],
      denied: Array.isArray(normalized.permissions?.denied) ? [...normalized.permissions.denied] : [],
      conservativeDefault: normalized.permissions?.conservativeDefault === true,
      declarations: Array.isArray(normalized.permissions?.declarations) ? [...normalized.permissions.declarations] : [],
    },
    toolBoundary: {
      allowedActions: Array.isArray(normalized.toolBoundary?.allowedActions) ? [...normalized.toolBoundary.allowedActions] : [],
      deniedActions: Array.isArray(normalized.toolBoundary?.deniedActions) ? [...normalized.toolBoundary.deniedActions] : [],
      permissions: normalized.toolBoundary?.permissions ?? {
        denied: [],
        allowed: [],
        conservativeDefault: false,
      },
      bodyMentionsConservativeBoundary: normalized.toolBoundary?.bodyMentionsConservativeBoundary === true,
    },
    checklist: summarizeChecklist(normalized.checklist),
    checklistDimensions: Array.isArray(normalized.checklistDimensions) ? [...normalized.checklistDimensions] : [],
    dependencies: summarizeDependencies(normalized.dependencies),
    method: summarizeMethod(normalized.method),
    staticBaseline: summarizeStaticBaseline(staticReport),
    pendingCapabilities: [...DEFAULT_PENDING_CAPABILITIES],
    normalized,
    loadedFixture,
  };
}

export default buildPreflightInput;
