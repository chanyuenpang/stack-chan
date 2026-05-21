export const PREFLIGHT_RULESET_VERSION = "skillforge-preflight-draft-0.1.0";

export const PREFLIGHT_SEVERITY_BLOCKING = Object.freeze(["P0", "P1"]);

export const PREFLIGHT_RULES = Object.freeze([
  {
    id: "RF-P1-PREFLIGHT-STATIC-BASELINE-PASSED",
    severity: "P1",
    category: "static-baseline",
    description: "Static baseline must already be in a passing state before runtime preflight can pass.",
    closeCondition: "Provide a passing static report summary and no blocking static failures.",
  },
  {
    id: "RF-P1-PREFLIGHT-REPLAY-CASES-MINIMAL",
    severity: "P1",
    category: "replay-cases",
    description: "Replay cases must expose the minimum shape required for runtime preflight review.",
    closeCondition: "Declare at least one replay case and include id, type, intent, and expectedBehavior for each case.",
  },
  {
    id: "RF-P1-PREFLIGHT-CASE-IDENTITY-STABLE",
    severity: "P1",
    category: "replay-cases",
    description: "Replay case identities must be stable and referenceable.",
    closeCondition: "Replay cases have non-empty ids, no duplicates, and every id can be traced back to the fixture replay-cases declaration.",
  },
  {
    id: "RF-P0-PREFLIGHT-FORGED-RUNTIME-RESULT",
    severity: "P0",
    category: "runtime-honesty",
    description: "Preflight must fail if fixture data claims runtime results without actual execution evidence.",
    closeCondition: "Do not declare replay pass or validation pass without observed/executed evidence.",
  },
  {
    id: "RF-P1-PREFLIGHT-BOUNDARY-DECLARED",
    severity: "P1",
    category: "boundary",
    description: "The runtime boundary must be declared conservatively enough for preflight review.",
    closeCondition: "Expose tool/permission boundary declarations or another clear conservative boundary signal.",
  },
  {
    id: "RF-P2-PREFLIGHT-RUNTIME-HINT-MISSING",
    severity: "P2",
    category: "runtime-hints",
    description: "Runtime-oriented hints are recommended but not required for the minimal preflight package.",
    closeCondition: "Document runtime hints such as generation/validation mode, dependencies, or checklist context.",
  },
  {
    id: "RF-P2-PREFLIGHT-PROFILE-NOT-YET-TIERED",
    severity: "P2",
    category: "profile",
    description: "Profiles are not yet tiered for runtime routing and may remain draft-level.",
    closeCondition: "Declare a stable profile value that can be routed in future runtime tiers.",
  },
]);

export function getPreflightRule(id) {
  const rule = PREFLIGHT_RULES.find((item) => item.id === id);
  if (!rule) throw new Error(`Unknown preflight rule id: ${id}`);
  return rule;
}

export function isBlockingPreflightSeverity(severity) {
  return PREFLIGHT_SEVERITY_BLOCKING.includes(severity);
}
