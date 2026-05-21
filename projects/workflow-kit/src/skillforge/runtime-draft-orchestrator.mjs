import { loadFixture } from "./loader.mjs";
import { normalizeFixture } from "./normalize.mjs";
import { validateFixture } from "./validator.mjs";
import { validatePreflight } from "./preflight-validator.mjs";
import { runRuntimeCaseSkeleton } from "./runtime-runner.mjs";

function buildLineageMetadata({ staticReport = null, preflightReport = null, normalizedFixture = null } = {}) {
  return {
    sourceStaticReportVersion: staticReport?.reportVersion ?? null,
    sourceStaticRuleSetVersion: staticReport?.ruleSetVersion ?? null,
    sourceStaticStatus: staticReport?.status ?? null,
    sourcePreflightReportVersion: preflightReport?.reportVersion ?? null,
    sourcePreflightProtocolVersion: preflightReport?.protocolVersion ?? null,
    sourcePreflightStatus: preflightReport?.status ?? null,
    sourceReplayCasesKind: normalizedFixture?.replayCases?.kind ?? null,
    sourceFixtureProfile: normalizedFixture?.profile ?? null,
    sourceFixtureEntry: normalizedFixture?.entryPath ?? null,
    lineage: {
      static: {
        kind: staticReport?.kind ?? null,
        reportVersion: staticReport?.reportVersion ?? null,
        ruleSetVersion: staticReport?.ruleSetVersion ?? null,
        status: staticReport?.status ?? null,
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
    },
  };
}

export async function orchestrateRuntimeDraft({
  fixtureDir,
  caseId = null,
  caseIndex = null,
  options = {},
} = {}) {
  if (!fixtureDir) {
    throw new TypeError("orchestrateRuntimeDraft requires fixtureDir");
  }

  const loadedFixture = await loadFixture(fixtureDir);
  const normalizedFixture = normalizeFixture(loadedFixture);
  const staticReport = await validateFixture(fixtureDir, options);
  const preflightReport = validatePreflight({
    fixtureDir,
    loadedFixture,
    normalizedFixture,
    staticReport,
    options,
  });

  const runtimeRun = runRuntimeCaseSkeleton({
    fixtureDir,
    loadedFixture,
    normalizedFixture,
    preflightReport,
    caseId,
    caseIndex,
    options,
  });

  return {
    fixtureDir,
    loadedFixture,
    normalizedFixture,
    staticReport,
    preflightReport,
    caseRecord: runtimeRun.caseRecord,
    sandboxContract: runtimeRun.sandboxContract,
    runnerInput: runtimeRun.runnerInput,
    runtimeResult: runtimeRun.result,
    transcriptArtifact: runtimeRun.transcriptArtifact,
    runtimeReport: {
      ...runtimeRun.runtimeReport,
      metadata: {
        ...(runtimeRun.runtimeReport?.metadata ?? {}),
        ...buildLineageMetadata({
          staticReport,
          preflightReport,
          normalizedFixture,
        }),
      },
    },
  };
}

export default orchestrateRuntimeDraft;
