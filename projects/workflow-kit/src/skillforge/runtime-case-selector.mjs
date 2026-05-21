function asCases(replayCases) {
  return Array.isArray(replayCases?.cases) ? replayCases.cases : [];
}

function cloneCaseRecord(caseRecord = {}) {
  return {
    id: caseRecord?.id ?? null,
    type: caseRecord?.type ?? null,
    intent: caseRecord?.intent ?? null,
    expectedBehavior: caseRecord?.expectedBehavior ?? null,
    forbiddenBehavior: caseRecord?.forbiddenBehavior ?? null,
    input: caseRecord?.input ?? null,
    observed: caseRecord?.observed ?? null,
    passed: caseRecord?.passed ?? null,
    runtime: caseRecord?.runtime && typeof caseRecord.runtime === "object" && !Array.isArray(caseRecord.runtime)
      ? { ...caseRecord.runtime }
      : {},
    preflight: caseRecord?.preflight && typeof caseRecord.preflight === "object" && !Array.isArray(caseRecord.preflight)
      ? { ...caseRecord.preflight }
      : {},
    tags: Array.isArray(caseRecord?.tags) ? [...caseRecord.tags] : [],
    privacyNotes: Array.isArray(caseRecord?.privacyNotes) ? [...caseRecord.privacyNotes] : [],
  };
}

export function selectRuntimeCase({
  normalizedFixture = null,
  caseId = null,
  caseIndex = null,
} = {}) {
  const availableCases = asCases(normalizedFixture?.replayCases);

  if (availableCases.length === 0) {
    throw new RangeError("No replay cases available for runtime runner skeleton");
  }

  if (caseId !== null && caseId !== undefined) {
    const match = availableCases.find((item) => item?.id === caseId);
    if (!match) {
      throw new RangeError(`Replay case not found for runtime runner skeleton: ${caseId}`);
    }
    return cloneCaseRecord(match);
  }

  if (Number.isInteger(caseIndex)) {
    const match = availableCases[caseIndex];
    if (!match) {
      throw new RangeError(`Replay case index out of range for runtime runner skeleton: ${caseIndex}`);
    }
    return cloneCaseRecord(match);
  }

  return cloneCaseRecord(availableCases[0]);
}

export default selectRuntimeCase;
