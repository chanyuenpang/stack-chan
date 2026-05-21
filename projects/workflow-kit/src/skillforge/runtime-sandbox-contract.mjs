const RUNTIME_SANDBOX_CONTRACT_VERSION = "runtime-sandbox-boundary-draft-1";

const DEFAULT_RESERVED_CAPABILITIES = Object.freeze([
  "sandbox-enforcement",
  "tool-execution-adapter",
  "filesystem-isolation",
  "network-isolation",
  "external-messaging-guard",
  "side-effect-audit-log",
]);

const DEFAULT_WARNINGS = Object.freeze([
  "sandbox boundary contract is declaration-only in this phase; enforcement is not implemented",
]);

function cloneArray(value) {
  return Array.isArray(value) ? [...value] : [];
}

function cloneObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : { ...fallback };
}

function normalizePermissions(permissions = {}) {
  const normalized = cloneObject(permissions, {
    allowed: [],
    denied: [],
    conservativeDefault: false,
    declarations: [],
  });

  normalized.allowed = cloneArray(normalized.allowed);
  normalized.denied = cloneArray(normalized.denied);
  normalized.declarations = cloneArray(normalized.declarations);
  normalized.conservativeDefault = normalized.conservativeDefault === true;

  return normalized;
}

function normalizeToolBoundary(toolBoundary = {}) {
  const normalized = cloneObject(toolBoundary, {
    allowedActions: [],
    deniedActions: [],
    permissions: {
      allowed: [],
      denied: [],
      conservativeDefault: false,
      declarations: [],
    },
    bodyMentionsConservativeBoundary: false,
  });

  normalized.allowedActions = cloneArray(normalized.allowedActions);
  normalized.deniedActions = cloneArray(normalized.deniedActions);
  normalized.permissions = normalizePermissions(normalized.permissions);
  normalized.bodyMentionsConservativeBoundary = normalized.bodyMentionsConservativeBoundary === true;

  return normalized;
}

function normalizeSideEffectPolicy(sideEffectPolicy = {}) {
  const normalized = cloneObject(sideEffectPolicy, {
    mode: "declaration-only",
    guard: "not-implemented",
    requiresHumanApproval: false,
    notes: [],
  });

  normalized.mode = normalized.mode ?? "declaration-only";
  normalized.guard = normalized.guard ?? "not-implemented";
  normalized.requiresHumanApproval = normalized.requiresHumanApproval === true;
  normalized.notes = cloneArray(normalized.notes);

  return normalized;
}

function normalizeSandboxMode(sandboxMode = null) {
  return sandboxMode ?? "contract-only";
}

function normalizeScope(scope = {}, defaults = {}) {
  const normalized = cloneObject(scope, defaults);
  normalized.mode = normalized.mode ?? defaults.mode ?? "unspecified";
  normalized.allowed = cloneArray(normalized.allowed);
  normalized.denied = cloneArray(normalized.denied);
  normalized.notes = cloneArray(normalized.notes);
  normalized.enforced = normalized.enforced === true;
  return normalized;
}

function buildBoundarySummary({
  permissions,
  toolBoundary,
  sideEffectPolicy,
  sandboxMode,
  network,
  filesystem,
  externalMessaging,
} = {}) {
  return {
    contractVersion: RUNTIME_SANDBOX_CONTRACT_VERSION,
    sandboxMode,
    declarationOnly: true,
    enforcementImplemented: false,
    permissions,
    toolBoundary,
    sideEffectPolicy,
    sideEffectGuard: sideEffectPolicy.guard,
    network,
    filesystem,
    externalMessaging,
  };
}

export function buildRuntimeSandboxBoundary({
  permissions = {},
  toolBoundary = {},
  sideEffectPolicy = {},
  sandboxMode = null,
  network = {},
  filesystem = {},
  externalMessaging = {},
  reservedCapabilities = DEFAULT_RESERVED_CAPABILITIES,
  warnings = DEFAULT_WARNINGS,
} = {}) {
  const normalizedPermissions = normalizePermissions(permissions);
  const normalizedToolBoundary = normalizeToolBoundary(toolBoundary);
  const normalizedSideEffectPolicy = normalizeSideEffectPolicy(sideEffectPolicy);
  const normalizedSandboxMode = normalizeSandboxMode(sandboxMode);
  const normalizedNetwork = normalizeScope(network, {
    mode: "inherit-declared-boundary",
    allowed: [],
    denied: [],
    notes: [],
    enforced: false,
  });
  const normalizedFilesystem = normalizeScope(filesystem, {
    mode: "inherit-declared-boundary",
    allowed: [],
    denied: [],
    notes: [],
    enforced: false,
  });
  const normalizedExternalMessaging = normalizeScope(externalMessaging, {
    mode: "inherit-declared-boundary",
    allowed: [],
    denied: [],
    notes: [],
    enforced: false,
  });

  return {
    contract: {
      kind: "runtime-sandbox-boundary",
      version: RUNTIME_SANDBOX_CONTRACT_VERSION,
    },
    permissions: normalizedPermissions,
    toolBoundary: normalizedToolBoundary,
    sideEffectPolicy: normalizedSideEffectPolicy,
    sandboxMode: normalizedSandboxMode,
    network: normalizedNetwork,
    filesystem: normalizedFilesystem,
    externalMessaging: normalizedExternalMessaging,
    boundarySummary: buildBoundarySummary({
      permissions: normalizedPermissions,
      toolBoundary: normalizedToolBoundary,
      sideEffectPolicy: normalizedSideEffectPolicy,
      sandboxMode: normalizedSandboxMode,
      network: normalizedNetwork,
      filesystem: normalizedFilesystem,
      externalMessaging: normalizedExternalMessaging,
    }),
    reservedCapabilities: cloneArray(reservedCapabilities),
    warnings: cloneArray(warnings),
  };
}

export function buildRuntimeSandboxBoundaryFromSources({
  normalizedFixture = null,
  preflightInput = null,
  overrides = {},
} = {}) {
  const sourcePermissions =
    overrides.permissions ?? preflightInput?.permissions ?? normalizedFixture?.permissions ?? {};
  const sourceToolBoundary =
    overrides.toolBoundary ?? preflightInput?.toolBoundary ?? normalizedFixture?.toolBoundary ?? {};

  return buildRuntimeSandboxBoundary({
    permissions: sourcePermissions,
    toolBoundary: sourceToolBoundary,
    sideEffectPolicy: overrides.sideEffectPolicy,
    sandboxMode: overrides.sandboxMode,
    network: overrides.network,
    filesystem: overrides.filesystem,
    externalMessaging: overrides.externalMessaging,
    reservedCapabilities: overrides.reservedCapabilities,
    warnings: overrides.warnings,
  });
}

export { RUNTIME_SANDBOX_CONTRACT_VERSION };

export default {
  buildRuntimeSandboxBoundary,
  buildRuntimeSandboxBoundaryFromSources,
  RUNTIME_SANDBOX_CONTRACT_VERSION,
};
