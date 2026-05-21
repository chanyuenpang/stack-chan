import { buildRuntimeReplayReport } from "./runtime-replay-reporter.mjs";
import {
  buildRuntimeProviderAdapterContractContext,
  buildRuntimeProviderSelection,
  RUNTIME_PROVIDER_ADAPTER_DEFAULT_SLOT,
  RUNTIME_PROVIDER_ADAPTER_KEYS,
} from "./runtime-provider-adapter-contract.mjs";
import {
  buildRuntimeRunnerContractContext,
  buildRuntimeTranscriptArtifactRef,
} from "./runtime-runner-contract.mjs";
import { mapProviderResultToObservedRuntime } from "./runtime-observed-mapper.mjs";
import { buildRuntimeSandboxBoundaryFromSources } from "./runtime-sandbox-contract.mjs";
import { buildRuntimeTranscriptArtifact } from "./runtime-transcript-contract.mjs";
import { selectRuntimeCase } from "./runtime-case-selector.mjs";

const DRY_RUNNER_VERSION = "runtime-runner-skeleton-dry-null-1";
const SUPPORTED_MODES = new Set(["dry-run", "null-runner", "provider-backed"]);
const NON_PASSING_STATUSES = new Set(["dry-run", "blocked", "not-executed", "error"]);

function pickStatusForMode(mode, { preflightBlocked = false } = {}) {
  if (preflightBlocked) return "blocked";
  if (mode === "null-runner") return "not-executed";
  if (mode === "provider-backed") return "error";
  return "dry-run";
}

function buildBlockedReason(preflightReport) {
  const blockingFailures = Array.isArray(preflightReport?.checks)
    ? preflightReport.checks.filter((check) => check?.status === "fail" || check?.status === "error")
    : [];

  return {
    code: "RUNTIME_PREFLIGHT_BLOCKED",
    message:
      blockingFailures.length > 0
        ? `runtime runner skeleton blocked by preflight findings: ${blockingFailures.map((check) => check?.id).filter(Boolean).join(", ")}`
        : "runtime runner skeleton blocked because preflight report is not marked passed",
    blockingCheckIds: blockingFailures.map((check) => check?.id).filter(Boolean),
  };
}

function buildProviderAdapterUnimplementedReason() {
  return {
    code: "RUNTIME_PROVIDER_ADAPTER_UNIMPLEMENTED",
    message:
      "provider-backed runtime adapter slot is reserved but intentionally unimplemented in this phase",
    blockingCheckIds: [],
  };
}

function buildTranscriptEvents({
  loadedFixture,
  normalizedFixture,
  preflightReport,
  caseRecord,
  boundary,
  mode,
  adapterKey,
  blocked,
}) {
  const blockingChecks = Array.isArray(preflightReport?.checks)
    ? preflightReport.checks.filter((check) => check?.status === "fail" || check?.status === "error")
    : [];

  return [
    {
      phase: "fixture",
      kind: "fixture-loaded",
      status: loadedFixture ? "ok" : "unknown",
      detail: "fixture material loaded for single-case runtime draft orchestration",
      evidence: {
        fixtureId: normalizedFixture?.fixtureId ?? null,
        fixtureVersion: normalizedFixture?.fixtureVersion ?? null,
        entryPath: normalizedFixture?.entryPath ?? null,
        profile: normalizedFixture?.profile ?? null,
      },
    },
    {
      phase: "static-validation",
      kind: "static-validated",
      status: preflightReport?.metadata?.sourceStaticStatus ?? null,
      detail: "static validation evidence inherited into runtime draft transcript stub",
      evidence: {
        reportVersion: preflightReport?.metadata?.sourceStaticReportVersion ?? null,
        ruleSetVersion: preflightReport?.metadata?.sourceStaticRuleSetVersion ?? null,
      },
    },
    {
      phase: "preflight",
      kind: blocked ? "preflight-failed" : "preflight-passed",
      status: preflightReport?.status ?? (blocked ? "blocked" : "passed"),
      detail: blocked
        ? "preflight did not pass, so runtime execution remained blocked in draft mode"
        : "preflight passed, enabling adapter selection without provider execution",
      evidence: {
        reportVersion: preflightReport?.reportVersion ?? null,
        protocolVersion: preflightReport?.protocolVersion ?? null,
        ruleSetVersion: preflightReport?.ruleSetVersion ?? null,
        blockingCheckIds: blockingChecks.map((check) => check?.id).filter(Boolean),
      },
    },
    {
      phase: "case-selection",
      kind: "case-selected",
      status: caseRecord?.id ? "ok" : "unknown",
      detail: "single runtime replay case selected for draft orchestration",
      evidence: {
        caseId: caseRecord?.id ?? null,
        caseType: caseRecord?.type ?? null,
        intent: caseRecord?.intent ?? null,
      },
    },
    {
      phase: "boundary",
      kind: "sandbox-boundary-built",
      status: "ok",
      detail: "runtime sandbox boundary contract prepared for provider-less draft execution",
      evidence: {
        permissions: boundary?.permissions ?? {},
        toolBoundary: boundary?.toolBoundary ?? {},
      },
    },
    {
      phase: "runner",
      kind: blocked
        ? "runner-blocked"
        : mode === "null-runner"
          ? "runner-skipped"
          : mode === "provider-backed"
            ? "runner-provider-slot-blocked"
            : "runner-dry-run-reserved",
      status: blocked ? "blocked" : mode === "provider-backed" ? "error" : adapterKey === "dry-run" ? "dry-run" : "not-executed",
      detail: blocked
        ? "runner remained blocked because preflight was not passed"
        : mode === "null-runner"
          ? "null runner reserved output contract shape without execution"
          : mode === "provider-backed"
            ? "provider-backed adapter slot was selected but remains intentionally unimplemented in this phase"
            : "dry-run reserved output contract shape without execution",
      evidence: {
        mode,
        adapterKey,
        providerCall: false,
        transcriptEngineUsed: false,
        executionReservedOnly: true,
        providerEvidenceAvailable: false,
        persistedTranscriptAvailable: false,
      },
    },
  ];
}

function assertRequiredInput(input) {
  if (!input?.normalizedFixture) {
    throw new TypeError("runtime runner skeleton requires normalizedFixture");
  }
  if (!input?.preflightReport) {
    throw new TypeError("runtime runner skeleton requires preflightReport");
  }
  if (!input?.runnerContract) {
    throw new TypeError("runtime runner skeleton requires runnerContract");
  }
  if (!input?.sandboxContract) {
    throw new TypeError("runtime runner skeleton requires sandboxContract");
  }
}

function normalizeMode(mode) {
  const normalizedMode = mode ?? "dry-run";
  if (!SUPPORTED_MODES.has(normalizedMode)) {
    throw new RangeError(`Unsupported runtime runner skeleton mode: ${normalizedMode}`);
  }
  return normalizedMode;
}

function buildProviderSelection(mode) {
  const adapterKey = normalizeMode(mode);
  if (!RUNTIME_PROVIDER_ADAPTER_KEYS.includes(adapterKey)) {
    throw new RangeError(`Unsupported runtime provider adapter key: ${adapterKey}`);
  }

  return {
    adapterKey,
    providerSlot: RUNTIME_PROVIDER_ADAPTER_DEFAULT_SLOT,
    providerBacked: adapterKey === "provider-backed",
    implemented: adapterKey !== "provider-backed",
  };
}

function buildFailureReason({ mode, preflightReport }) {
  if (preflightReport?.status !== "passed") {
    return buildBlockedReason(preflightReport);
  }

  if (mode === "provider-backed") {
    return buildProviderAdapterUnimplementedReason();
  }

  return null;
}

function runBuiltinProviderAdapter({ mode, caseRecord, providerAdapterContract, preflightReport }) {
  const preflightBlocked = preflightReport?.status !== "passed";

  return providerAdapterContract.buildResult({
    caseId: caseRecord.id,
    status: pickStatusForMode(mode, { preflightBlocked }),
    observed: null,
    transcriptRef: null,
    note: preflightBlocked
      ? "provider adapter output remained blocked because preflight did not pass"
      : mode === "provider-backed"
        ? "provider-backed adapter slot selected, but no provider integration exists yet"
        : mode === "null-runner"
          ? "null runner adapter reserved output contract shape without execution"
          : "dry-run adapter reserved output contract shape without provider execution",
    providerMetadata: {
      implementationState: preflightBlocked
        ? "preflight-blocked"
        : mode === "provider-backed"
          ? "reserved-unimplemented-provider-slot"
          : "builtin-skeleton-adapter",
      providerBacked: mode === "provider-backed",
      providerKey: providerAdapterContract.input.provider.providerKey,
      providerSlot: providerAdapterContract.input.provider.providerSlot,
      executed: false,
      providerCall: false,
      providerEvidenceAvailable: false,
      transcriptCaptured: false,
      transcriptPersistence: false,
      persistence: "none",
      mode,
      preflightBlocked,
    },
    pendingCapabilities:
      mode === "provider-backed"
        ? [
            "provider-integration",
            "provider-selection",
            "provider-transcript-capture",
            "provider-transcript-persistence",
            "runtime-pass-path",
            "scoring-engine",
          ]
        : [
            "provider-integration",
            "transcript-engine",
            "sandbox-implementation",
            "scoring-engine",
          ],
  });
}

export function buildRuntimeRunnerSkeletonInput({
  fixtureDir = null,
  loadedFixture = null,
  normalizedFixture = null,
  preflightReport = null,
  runnerContract = null,
  sandboxContract = null,
  caseId = null,
  caseIndex = null,
  options = {},
} = {}) {
  const caseRecord = selectRuntimeCase({ normalizedFixture, caseId, caseIndex });
  const boundary = {
    permissions: sandboxContract?.permissions ?? runnerContract?.input?.boundary?.permissions ?? {},
    toolBoundary: sandboxContract?.toolBoundary ?? runnerContract?.input?.boundary?.toolBoundary ?? {},
  };

  return {
    fixtureDir,
    loadedFixture,
    normalizedFixture,
    preflightReport,
    runnerContract,
    sandboxContract,
    caseRecord,
    boundary,
    options: { ...options },
  };
}

export function runRuntimeCaseSkeleton({
  fixtureDir = null,
  loadedFixture = null,
  normalizedFixture = null,
  preflightReport = null,
  runnerContract = null,
  sandboxContract = null,
  caseId = null,
  caseIndex = null,
  options = {},
} = {}) {
  const mode = normalizeMode(options.mode);

  const effectiveSandboxContract =
    sandboxContract ??
    buildRuntimeSandboxBoundaryFromSources({
      normalizedFixture,
      preflightInput: preflightReport,
    });

  const caseRecord = selectRuntimeCase({ normalizedFixture, caseId, caseIndex });
  const providerSelection = buildProviderSelection(mode);

  const effectiveRunnerContract =
    runnerContract ??
    buildRuntimeRunnerContractContext({
      fixtureDir,
      loadedFixture,
      normalizedFixture,
      preflightReport,
      caseRecord,
      boundary: {
        permissions: effectiveSandboxContract.permissions,
        toolBoundary: effectiveSandboxContract.toolBoundary,
      },
      options: {
        mode,
        skeleton: true,
        providerAdapterSeam: {
          key: providerSelection.adapterKey,
          slot: providerSelection.providerSlot,
          implemented: providerSelection.implemented,
          providerBacked: providerSelection.providerBacked,
        },
      },
    });

  const input = buildRuntimeRunnerSkeletonInput({
    fixtureDir,
    loadedFixture,
    normalizedFixture,
    preflightReport,
    runnerContract: effectiveRunnerContract,
    sandboxContract: effectiveSandboxContract,
    caseId: caseRecord.id,
    options: {
      ...options,
      mode,
      providerKey: providerSelection.adapterKey,
      providerSlot: providerSelection.providerSlot,
      providerAdapterSeam: {
        key: providerSelection.adapterKey,
        slot: providerSelection.providerSlot,
        implemented: providerSelection.implemented,
        providerBacked: providerSelection.providerBacked,
      },
    },
  });

  assertRequiredInput(input);

  const providerAdapterContract = buildRuntimeProviderAdapterContractContext({
    fixtureDir,
    loadedFixture,
    normalizedFixture,
    caseRecord,
    boundary: {
      permissions: effectiveSandboxContract.permissions,
      toolBoundary: effectiveSandboxContract.toolBoundary,
    },
    options: {
      ...options,
      mode,
      providerKey: providerSelection.adapterKey,
      providerSlot: providerSelection.providerSlot,
    },
  });

  const adapterResult = runBuiltinProviderAdapter({
    mode,
    caseRecord,
    providerAdapterContract,
    preflightReport,
  });

  if (!NON_PASSING_STATUSES.has(adapterResult.status)) {
    throw new RangeError(`Runtime runner skeleton produced forbidden status: ${adapterResult.status}`);
  }

  const mappedRuntime = mapProviderResultToObservedRuntime({
    adapterResult,
    providerSelection: buildRuntimeProviderSelection({
      mode,
      providerKey: providerAdapterContract.input.provider.providerKey,
      providerSlot: providerAdapterContract.input.provider.providerSlot,
      builtin: providerAdapterContract.input.provider.builtin,
      implemented: providerSelection.implemented,
      providerBacked: providerSelection.providerBacked,
    }),
    caseContext: caseRecord,
  });

  const failureReason = buildFailureReason({ mode, preflightReport });
  const blocked = mappedRuntime.status === "blocked";
  const providerExecution = mappedRuntime.providerExecution;
  const transcriptAvailability = mappedRuntime.transcriptAvailability;

  const result = effectiveRunnerContract.buildResult({
    caseId: caseRecord.id,
    status: mappedRuntime.status,
    observed: mappedRuntime.observed,
    transcriptRef: null,
    failureReason,
    runnerMetadata: {
      implementation: "single-case-dry-null-runner-skeleton",
      runnerVersion: DRY_RUNNER_VERSION,
      mode,
      providerBacked: providerExecution.providerBacked,
      executed: providerExecution.executed,
      providerCall: providerExecution.providerCall,
      transcriptCaptured: transcriptAvailability.transcriptCaptured,
      transcriptEngineUsed: false,
      sandboxEnforced: false,
      evidenceProduced:
        providerExecution.providerEvidenceAvailable || transcriptAvailability.transcriptPersistence,
      transcriptPersistence: transcriptAvailability.persistence,
      caseType: caseRecord?.type ?? null,
      providerAdapter: {
        key: providerExecution.providerKey,
        slot: providerExecution.providerSlot,
        builtin: providerExecution.builtin,
        implemented: providerExecution.implemented,
        providerBacked: providerExecution.providerBacked,
        status: providerExecution.status,
        executionId: providerExecution.executionId,
        providerRunId: providerExecution.providerRunId,
        providerStatus: providerExecution.providerStatus,
        transcriptAvailable: providerExecution.transcriptAvailable,
        rawResponseAvailable: providerExecution.rawResponseAvailable,
        futureRequiredFields: [...providerExecution.futureRequiredFields],
      },
      note: blocked
        ? "runner remained blocked because preflight did not pass"
        : mode === "provider-backed"
          ? "runner selected provider-backed adapter slot, but execution remains intentionally unimplemented"
          : mode === "null-runner"
            ? "runner selected null runner adapter and reserved contract shape without execution"
            : "runner selected dry-run adapter and reserved contract shape without provider execution",
      pendingCapabilities: [...providerExecution.pendingCapabilities],
    },
  });

  const transcriptArtifact = buildRuntimeTranscriptArtifact({
    fixture: {
      path: fixtureDir,
      id: normalizedFixture?.fixtureId ?? null,
      version: normalizedFixture?.fixtureVersion ?? null,
      entry: normalizedFixture?.entryPath ?? null,
      profile: normalizedFixture?.profile ?? null,
    },
    caseRecord,
    executionMode: mode,
    boundary: {
      permissions: effectiveSandboxContract.permissions,
      toolBoundary: effectiveSandboxContract.toolBoundary,
      boundarySummary: effectiveSandboxContract.boundarySummary,
    },
    runnerMetadata: result.runnerMetadata,
    outcome: {
      status: result.status,
      observedKind: mappedRuntime.observed.kind,
      observedEvidence: mappedRuntime.observed.evidence,
      observed: mappedRuntime.observed,
      failureReason,
    },
    events: buildTranscriptEvents({
      loadedFixture,
      normalizedFixture,
      preflightReport,
      caseRecord,
      boundary: {
        permissions: effectiveSandboxContract.permissions,
        toolBoundary: effectiveSandboxContract.toolBoundary,
      },
      mode,
      adapterKey: providerSelection.adapterKey,
      blocked,
    }),
    note:
      "provider-less runtime transcript stub only; captures orchestration evidence for a single draft case without any model dialogue or transcript persistence",
    pendingCapabilities: [
      ...result.runnerMetadata.pendingCapabilities,
      "transcript-ref-wiring",
      "transcript-persistence",
    ],
  });

  const transcriptRef = buildRuntimeTranscriptArtifactRef({
    artifactId: transcriptArtifact.artifactId,
    caseId: caseRecord.id,
    executionMode: mode,
    available: true,
    persistence: "in-report-only",
    location: {
      kind: "in-report-artifact",
      path: ["cases", 0, "transcript"],
    },
    providerTranscript: false,
    note:
      "draft in-report transcript artifact ref wired to the provider-less runtime transcript stub for this single case; not a provider transcript reference",
  });

  const resultWithTranscriptRef = {
    ...result,
    transcriptRef,
  };

  const runtimeReport = buildRuntimeReplayReport({
    fixtureDir,
    fixture: {
      id: normalizedFixture?.fixtureId ?? null,
      version: normalizedFixture?.fixtureVersion ?? null,
      entry: normalizedFixture?.entryPath ?? null,
      profile: normalizedFixture?.profile ?? null,
    },
    runtime: {
      fixture: effectiveRunnerContract.input.fixture,
      runner: {
        implementation: "single-case-dry-null-runner-skeleton",
        version: DRY_RUNNER_VERSION,
      },
      sandbox: effectiveSandboxContract.boundarySummary,
      staticBaseline: {
        kind: preflightReport?.metadata?.lineage?.static?.kind ?? null,
        reportVersion: preflightReport?.metadata?.sourceStaticReportVersion ?? null,
        ruleSetVersion: preflightReport?.metadata?.sourceStaticRuleSetVersion ?? null,
        status: preflightReport?.preflight?.staticBaseline?.status ?? null,
      },
      preflight: {
        kind: preflightReport?.kind ?? null,
        reportVersion: preflightReport?.reportVersion ?? null,
        protocolVersion: preflightReport?.protocolVersion ?? null,
        ruleSetVersion: preflightReport?.ruleSetVersion ?? null,
        status: preflightReport?.status ?? null,
      },
      replayCases: {
        kind: normalizedFixture?.replayCases?.kind ?? null,
        fixtureId: normalizedFixture?.replayCases?.fixtureId ?? null,
      },
      mode,
      providerAdapter: {
        key: providerExecution.providerKey,
        slot: providerExecution.providerSlot,
        implemented: providerExecution.implemented,
        providerBacked: providerExecution.providerBacked,
        executionId: providerExecution.executionId,
        providerRunId: providerExecution.providerRunId,
        providerStatus: providerExecution.providerStatus,
        currentState: providerExecution.implementationState,
      },
      providerExecution,
      transcriptAvailability,
      statusTaxonomy: {
        reportStatuses: ["draft", "blocked"],
        caseStatuses: ["blocked", "error", "dry-run", "not-executed"],
        passedReserved: true,
        providerReadyPassPathImplemented: false,
      },
      pendingCapabilities: result.runnerMetadata.pendingCapabilities,
    },
    cases: [
      {
        id: caseRecord.id,
        type: caseRecord.type,
        status: result.status,
        expectedBehavior: caseRecord.expectedBehavior ?? null,
        observed: result.observed,
        providerExecution,
        transcriptAvailability,
        transcriptRef: resultWithTranscriptRef.transcriptRef,
        failureReason: result.failureReason,
        transcript: transcriptArtifact,
      },
    ],
    checks: blocked
      ? [
          {
            id: "RUNTIME-RUNNER-SKELETON-PREFLIGHT-BLOCKED",
            scope: "runtime",
            status: "warn",
            severity: "P1",
            message: "runtime runner skeleton did not execute because preflight is not passed",
            evidence: result.failureReason?.blockingCheckIds ?? [],
          },
        ]
      : [
          {
            id: "RUNTIME-RUNNER-SKELETON-DRY-NULL-ONLY",
            scope: "runtime",
            status: "warn",
            severity: "P2",
            message:
              mode === "provider-backed"
                ? "runtime runner skeleton selected provider-backed adapter slot but it remains intentionally unimplemented in this phase"
                : "runtime runner skeleton only emits dry-run/null-runner contract results in this phase",
            evidence: [mode, providerSelection.adapterKey],
          },
        ],
    options: {
      runner: {
        implementation: "single-case-dry-null-runner-skeleton",
        version: DRY_RUNNER_VERSION,
      },
      sandbox: effectiveSandboxContract.boundarySummary,
      note:
        "runtime draft artifact only; single-case adapter-driven skeleton with no provider call, no transcript evidence, no scoring, and no runtime pass evidence",
    },
  });

  return {
    mode,
    caseRecord,
    runnerInput: effectiveRunnerContract.input,
    sandboxContract: effectiveSandboxContract,
    result: resultWithTranscriptRef,
    transcriptArtifact,
    runtimeReport,
  };
}

export default {
  buildRuntimeRunnerSkeletonInput,
  runRuntimeCaseSkeleton,
};
