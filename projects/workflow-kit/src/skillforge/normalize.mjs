import { DIMENSIONS } from "./rules.mjs";

const ALLOWED_DIMENSIONS = new Set(DIMENSIONS);
const SOURCE_KEYS = Object.freeze([
  "workflowSource",
  "skillSpec",
  "generationRun",
  "skillManifest",
  "replayCases",
  "validationResult",
]);

function pickFirst(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeDimensionMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (ALLOWED_DIMENSIONS.has(key)) result[key] = item;
  }
  return result;
}

function normalizeDimensionList(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : item?.dimension ?? item?.id ?? item?.name))
      .filter((dimension) => ALLOWED_DIMENSIONS.has(dimension));
  }

  if (typeof value === "object") return Object.keys(normalizeDimensionMap(value));
  return [];
}

function parseSkillBodyChecklist(body) {
  const checklist = {};
  const linePattern = /^\s*-\s*([a-z]+)\s*[：:]\s*(.+?)\s*$/gimu;
  let match;
  while ((match = linePattern.exec(body)) !== null) {
    const dimension = match[1];
    if (ALLOWED_DIMENSIONS.has(dimension)) checklist[dimension] = match[2];
  }
  return checklist;
}

function normalizeChecklistSources(loadedFixture) {
  const sources = {};
  const dimensions = new Set();

  for (const key of SOURCE_KEYS) {
    const checklist = normalizeDimensionMap(loadedFixture[key]?.checklist);
    if (Object.keys(checklist).length > 0) {
      sources[key] = checklist;
      for (const dimension of Object.keys(checklist)) dimensions.add(dimension);
    }
  }

  const validationChecks = normalizeDimensionMap(loadedFixture.validationResult?.validation?.checks);
  if (Object.keys(validationChecks).length > 0) {
    sources.validationChecks = validationChecks;
    for (const dimension of Object.keys(validationChecks)) dimensions.add(dimension);
  }

  const skillBodyChecklist = parseSkillBodyChecklist(loadedFixture.skill?.body ?? "");
  if (Object.keys(skillBodyChecklist).length > 0) {
    sources.skillBody = skillBodyChecklist;
    for (const dimension of Object.keys(skillBodyChecklist)) dimensions.add(dimension);
  }

  return {
    dimensions: DIMENSIONS.filter((dimension) => dimensions.has(dimension)),
    bySource: sources,
    complete: DIMENSIONS.every((dimension) => dimensions.has(dimension)),
  };
}

function normalizeDependencies(loadedFixture) {
  const spec = loadedFixture.skillSpec ?? {};
  const workflow = loadedFixture.workflowSource ?? {};
  const run = loadedFixture.generationRun ?? {};

  const explicit = [
    ...asArray(spec.dependencies),
    ...asArray(spec.dependency),
    ...asArray(spec.externalDependencies),
    ...asArray(workflow.dependencies),
    ...asArray(run.dependencies),
  ];

  const checklistNotes = Object.fromEntries(
    SOURCE_KEYS.map((key) => [key, loadedFixture[key]?.checklist?.dependency]).filter(([, value]) => value),
  );

  const noExternalDependencySignals = [
    spec.checklist?.dependency,
    workflow.checklist?.dependency,
    run.checklist?.dependency,
    loadedFixture.replayCases?.checklist?.dependency,
  ].filter(Boolean);

  return {
    explicit,
    checklistNotes,
    noExternalDependenciesDeclared:
      explicit.length === 0 && noExternalDependencySignals.some((text) => /无|不依赖|no external/i.test(String(text))),
  };
}

function normalizeMethod(loadedFixture) {
  const generation = loadedFixture.generationRun?.run ?? {};
  const validation = loadedFixture.validationResult?.validation ?? {};

  return {
    generationMode: pickFirst(generation.mode, loadedFixture.generationRun?.method, loadedFixture.generationRun?.mode),
    generationStatus: generation.status,
    validationMode: pickFirst(validation.mode, loadedFixture.validationResult?.method),
    validationStatus: validation.status,
    modelReplayExecuted: pickFirst(
      generation.modelReplayExecuted,
      validation.modelReplayExecuted,
      loadedFixture.generationRun?.modelReplayExecuted,
    ),
  };
}

function collectPermissionObjects(loadedFixture) {
  const manifestSkills = asArray(loadedFixture.skillManifest?.skills);
  return [
    ["workflowSource.permissions", loadedFixture.workflowSource?.permissions],
    ["generationRun.permissions", loadedFixture.generationRun?.permissions],
    ["validationResult.permissions", loadedFixture.validationResult?.permissions],
    ["skillFrontmatter.metadata.permissions", loadedFixture.skill?.frontmatter?.metadata?.permissions],
    ...manifestSkills.map((skill, index) => [`skillManifest.skills[${index}].permissions`, skill?.permissions]),
  ].filter(([, value]) => value && typeof value === "object" && !Array.isArray(value));
}

function summarizePermissions(loadedFixture) {
  const permissionObjects = collectPermissionObjects(loadedFixture);
  const merged = {};
  const declarations = [];

  for (const [source, permissions] of permissionObjects) {
    declarations.push({ source, permissions });
    for (const [name, value] of Object.entries(permissions)) {
      if (!Object.hasOwn(merged, name)) merged[name] = value;
      else if (merged[name] !== value) merged[name] = "mixed";
    }
  }

  const denied = Object.entries(merged)
    .filter(([, value]) => value === false)
    .map(([name]) => name);
  const allowed = Object.entries(merged)
    .filter(([, value]) => value === true)
    .map(([name]) => name);

  return {
    declarations,
    merged,
    denied,
    allowed,
    conservativeDefault: allowed.length === 0 && denied.length > 0,
  };
}

function summarizeToolBoundary(loadedFixture) {
  const specBoundaries = loadedFixture.skillSpec?.boundaries ?? {};
  const body = loadedFixture.skill?.body ?? "";
  const permissions = summarizePermissions(loadedFixture);

  return {
    allowedActions: asArray(specBoundaries.allowed),
    deniedActions: asArray(specBoundaries.denied),
    permissions: {
      denied: permissions.denied,
      allowed: permissions.allowed,
      conservativeDefault: permissions.conservativeDefault,
    },
    bodyMentionsConservativeBoundary: /默认保守|不联网|不外发|不写文件|破坏性操作/u.test(body),
  };
}

function getManifestEntry(loadedFixture) {
  const firstSkill = asArray(loadedFixture.skillManifest?.skills)[0];
  return firstSkill?.entry;
}

function assertLoadedFixtureShape(loadedFixture) {
  if (!loadedFixture || typeof loadedFixture !== "object") {
    throw new TypeError("normalizeFixture expected a loaded fixture object");
  }
  if (!loadedFixture.skill?.frontmatter || typeof loadedFixture.skill.frontmatter !== "object") {
    throw new TypeError("normalizeFixture expected loadedFixture.skill.frontmatter");
  }
}

export function normalizeFixture(loadedFixture) {
  assertLoadedFixtureShape(loadedFixture);

  const checklist = normalizeChecklistSources(loadedFixture);
  const permissions = summarizePermissions(loadedFixture);
  const toolBoundary = summarizeToolBoundary(loadedFixture);

  return {
    fixtureId: pickFirst(
      loadedFixture.skillManifest?.fixtureId,
      loadedFixture.workflowSource?.fixtureId,
      loadedFixture.skill?.frontmatter?.metadata?.fixtureId,
    ),
    fixtureVersion: pickFirst(
      loadedFixture.skillManifest?.fixtureVersion,
      loadedFixture.workflowSource?.fixtureVersion,
      loadedFixture.skill?.frontmatter?.metadata?.fixtureVersion,
    ),
    profile: pickFirst(loadedFixture.skillManifest?.profile, loadedFixture.skill?.frontmatter?.metadata?.profile),
    entryPath: getManifestEntry(loadedFixture),
    skillFrontmatter: loadedFixture.skill.frontmatter,
    skillBody: loadedFixture.skill.body,
    workflowSource: loadedFixture.workflowSource,
    skillSpec: loadedFixture.skillSpec,
    generationRun: loadedFixture.generationRun,
    skillManifest: loadedFixture.skillManifest,
    replayCases: loadedFixture.replayCases,
    validationResult: loadedFixture.validationResult,
    checklistDimensions: checklist.dimensions,
    checklist,
    dependencies: normalizeDependencies(loadedFixture),
    method: normalizeMethod(loadedFixture),
    permissions,
    toolBoundary,
  };
}

export default normalizeFixture;
