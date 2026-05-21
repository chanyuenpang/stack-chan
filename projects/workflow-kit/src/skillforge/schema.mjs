const PROFILE_VALUES = new Set(["simple", "standard", "advanced-reserved"]);
const PERMISSION_KEYS = Object.freeze([
  "network",
  "externalSend",
  "fileRead",
  "fileWrite",
  "destructiveOperations",
  "privatePathRead",
]);
const REPLAY_CASE_TYPES = new Set(["positive", "negative", "edge"]);

function hasText(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pushError(errors, field, message, severity = "error") {
  errors.push({ field, message, severity });
}

function validatePermissions(errors, permissions, fieldPath) {
  if (!isPlainObject(permissions)) {
    pushError(errors, fieldPath, "must be an object when provided");
    return;
  }

  for (const [key, value] of Object.entries(permissions)) {
    if (!PERMISSION_KEYS.includes(key)) continue;
    if (typeof value !== "boolean") {
      pushError(errors, `${fieldPath}.${key}`, "must be a boolean");
    }
  }
}

function validateSkillManifest(data) {
  const errors = [];

  if (!isPlainObject(data)) {
    pushError(errors, "$", "skill-manifest must be a YAML mapping");
    return { valid: false, errors };
  }

  if (!hasText(data.fixtureId)) pushError(errors, "fixtureId", "is required");
  if (!hasText(data.fixtureVersion)) pushError(errors, "fixtureVersion", "is required");
  if (!hasText(data.kind)) pushError(errors, "kind", "is required");

  if (!Array.isArray(data.skills)) {
    pushError(errors, "skills", "must be an array");
  } else if (data.skills.length === 0) {
    pushError(errors, "skills", "must contain at least one skill");
  } else {
    const firstSkill = data.skills[0];
    if (!isPlainObject(firstSkill)) {
      pushError(errors, "skills[0]", "must be an object");
    } else {
      for (const field of ["id", "name", "version", "entry", "description"]) {
        if (!hasText(firstSkill[field])) pushError(errors, `skills[0].${field}`, "is required");
      }

      if (firstSkill.permissions !== undefined) {
        validatePermissions(errors, firstSkill.permissions, "skills[0].permissions");
      }
    }
  }

  if (data.permissions !== undefined) {
    validatePermissions(errors, data.permissions, "permissions");
  }

  if (data.profile !== undefined && !PROFILE_VALUES.has(data.profile)) {
    pushError(errors, "profile", "should be one of simple|standard|advanced-reserved", "warn");
  }

  return {
    valid: errors.every((item) => item.severity !== "error"),
    errors,
  };
}

function validateReplayCases(data) {
  const errors = [];

  if (!isPlainObject(data)) {
    pushError(errors, "$", "replay-cases must be a YAML mapping");
    return { valid: false, errors };
  }

  if (!hasText(data.fixtureId)) pushError(errors, "fixtureId", "is required");
  if (!hasText(data.kind)) pushError(errors, "kind", "is required");

  if (!Array.isArray(data.cases)) {
    pushError(errors, "cases", "must be an array");
  } else if (data.cases.length === 0) {
    pushError(errors, "cases", "must contain at least one case");
  } else {
    for (const [index, item] of data.cases.entries()) {
      const fieldPath = `cases[${index}]`;
      if (!isPlainObject(item)) {
        pushError(errors, fieldPath, "must be an object");
        continue;
      }

      for (const field of ["id", "type", "intent", "expectedBehavior"]) {
        const value = item[field];
        const valid = field === "expectedBehavior" ? Array.isArray(value) || hasText(value) : hasText(value);
        if (!valid) pushError(errors, `${fieldPath}.${field}`, "is required");
      }

      if (hasText(item.type) && !REPLAY_CASE_TYPES.has(item.type)) {
        pushError(errors, `${fieldPath}.type`, "must be one of positive|negative|edge");
      }

      if (item.observed !== undefined && item.observed !== null && typeof item.observed !== "boolean" && !hasText(item.observed)) {
        pushError(errors, `${fieldPath}.observed`, "must be null, boolean, or non-empty string when provided");
      }

      if (item.passed !== undefined && item.passed !== null && typeof item.passed !== "boolean") {
        pushError(errors, `${fieldPath}.passed`, "must be null or boolean when provided");
      }
    }
  }

  return {
    valid: errors.every((item) => item.severity !== "error"),
    errors,
  };
}

export function validateSchema(targetName, data) {
  if (targetName === "skill-manifest") return validateSkillManifest(data);
  if (targetName === "replay-cases") return validateReplayCases(data);

  return {
    valid: true,
    errors: [],
  };
}

export default validateSchema;
