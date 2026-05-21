import { readFile } from "node:fs/promises";
import path from "node:path";

const REQUIRED_FILES = Object.freeze({
  readme: "README.md",
  workflowSource: "workflow-source.yaml",
  skillSpec: "skill-spec.yaml",
  generationRun: "generation-run.yaml",
  skillManifest: "skill-manifest.yaml",
  replayCases: "replay-cases.yaml",
  validationResult: "validation-result.yaml",
  skill: "skill/SKILL.md",
});

export class FixtureLoadError extends Error {
  constructor(code, message, file, cause) {
    super(message);
    this.name = "FixtureLoadError";
    this.code = code;
    this.file = file;
    if (cause) this.cause = cause;
  }

  toJSON() {
    return { code: this.code, message: this.message, file: this.file };
  }
}

function structuredError(code, message, file, cause) {
  return new FixtureLoadError(code, message, file, cause);
}

async function readFixtureFile(fixtureDir, relativePath) {
  const absolutePath = path.join(fixtureDir, relativePath);
  try {
    return await readFile(absolutePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw structuredError(
        "FIXTURE_FILE_MISSING",
        `Required fixture file is missing: ${relativePath}`,
        relativePath,
        error,
      );
    }
    throw structuredError(
      "FIXTURE_FILE_READ_FAILED",
      `Unable to read fixture file: ${relativePath}`,
      relativePath,
      error,
    );
  }
}

function countIndent(line) {
  const match = line.match(/^ */u);
  return match ? match[0].length : 0;
}

function isBlankOrComment(line) {
  const trimmed = line.trim();
  return trimmed === "" || trimmed.startsWith("#");
}

function firstContentLine(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (!isBlankOrComment(lines[index])) return index;
  }
  return -1;
}

function splitKeyValue(text, file) {
  const separator = text.indexOf(":");
  if (separator <= 0) {
    throw structuredError("YAML_PARSE_FAILED", `Expected key/value pair, got: ${text}`, file);
  }
  const key = text.slice(0, separator).trim();
  const value = text.slice(separator + 1).trim();
  if (!key) {
    throw structuredError("YAML_PARSE_FAILED", "YAML mapping key cannot be empty", file);
  }
  return [key, value];
}

function parseScalar(value) {
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "[]") return [];
  if (value === "{}") return {};

  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));
  if (quoted) {
    const inner = value.slice(1, -1);
    return value.startsWith('"')
      ? inner.replace(/\\"/gu, '"').replace(/\\n/gu, "\n").replace(/\\\\/gu, "\\")
      : inner.replace(/''/gu, "'");
  }

  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) return Number(value);
  return value;
}

function parseBlockScalar(lines, startIndex, parentIndent, style) {
  let index = startIndex;
  const blockLines = [];
  let blockIndent = null;

  while (index < lines.length) {
    const line = lines[index];
    if (!isBlankOrComment(line) && countIndent(line) <= parentIndent) break;
    if (line.trim() !== "" && blockIndent === null) blockIndent = countIndent(line);
    blockLines.push(line);
    index += 1;
  }

  const trimIndent = blockIndent ?? parentIndent + 2;
  const text = blockLines
    .map((line) => (line.length >= trimIndent ? line.slice(trimIndent) : ""))
    .join("\n");

  return [style === ">" ? text.replace(/\n+/gu, " ").trimEnd() : text.replace(/\n*$/u, ""), index];
}

function parseValue(value, lines, nextIndex, indent, file) {
  if (value === "|" || value === ">") {
    return parseBlockScalar(lines, nextIndex, indent, value);
  }
  if (value === "") {
    const nestedIndex = firstContentLine(lines, nextIndex);
    if (nestedIndex === -1 || countIndent(lines[nestedIndex]) <= indent) return [null, nextIndex];
    return parseBlock(lines, nextIndex, countIndent(lines[nestedIndex]), file);
  }
  return [parseScalar(value), nextIndex];
}

function parseMapping(lines, startIndex, indent, file) {
  const result = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (isBlankOrComment(line)) {
      index += 1;
      continue;
    }

    const lineIndent = countIndent(line);
    if (lineIndent < indent) break;
    if (lineIndent > indent) {
      throw structuredError("YAML_PARSE_FAILED", `Unexpected indentation at line ${index + 1}`, file);
    }

    const trimmed = line.slice(indent);
    if (trimmed.startsWith("- ")) break;

    const [key, rawValue] = splitKeyValue(trimmed, file);
    const [value, nextIndex] = parseValue(rawValue, lines, index + 1, indent, file);
    result[key] = value;
    index = nextIndex;
  }

  return [result, index];
}

function parseSequence(lines, startIndex, indent, file) {
  const result = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (isBlankOrComment(line)) {
      index += 1;
      continue;
    }

    const lineIndent = countIndent(line);
    if (lineIndent < indent) break;
    if (lineIndent > indent) {
      throw structuredError("YAML_PARSE_FAILED", `Unexpected indentation at line ${index + 1}`, file);
    }

    const trimmed = line.slice(indent);
    if (!trimmed.startsWith("- ")) break;

    const itemText = trimmed.slice(2).trim();
    if (itemText === "") {
      const nestedIndex = firstContentLine(lines, index + 1);
      if (nestedIndex === -1 || countIndent(lines[nestedIndex]) <= indent) {
        result.push(null);
        index += 1;
      } else {
        const [value, nextIndex] = parseBlock(lines, index + 1, countIndent(lines[nestedIndex]), file);
        result.push(value);
        index = nextIndex;
      }
      continue;
    }

    if (/^[^:'"]+\s*:/u.test(itemText)) {
      const [key, rawValue] = splitKeyValue(itemText, file);
      const [firstValue, afterFirst] = parseValue(rawValue, lines, index + 1, indent + 2, file);
      const item = { [key]: firstValue };
      index = afterFirst;

      const nestedIndex = firstContentLine(lines, index);
      if (nestedIndex !== -1 && countIndent(lines[nestedIndex]) > indent) {
        const [extra, nextIndex] = parseMapping(lines, index, countIndent(lines[nestedIndex]), file);
        Object.assign(item, extra);
        index = nextIndex;
      }

      result.push(item);
      continue;
    }

    result.push(parseScalar(itemText));
    index += 1;
  }

  return [result, index];
}

function parseBlock(lines, startIndex, indent, file) {
  const contentIndex = firstContentLine(lines, startIndex);
  if (contentIndex === -1) return [null, lines.length];
  const actualIndent = countIndent(lines[contentIndex]);
  const blockIndent = Math.max(indent, actualIndent);
  const trimmed = lines[contentIndex].slice(blockIndent);
  return trimmed.startsWith("- ")
    ? parseSequence(lines, contentIndex, blockIndent, file)
    : parseMapping(lines, contentIndex, blockIndent, file);
}

export function parseYaml(text, file = "<yaml>") {
  if (/\t/u.test(text)) {
    throw structuredError("YAML_PARSE_FAILED", "Tabs are not supported in YAML indentation", file);
  }

  try {
    const lines = text.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n").split("\n");
    const [value, index] = parseBlock(lines, 0, 0, file);
    const remaining = firstContentLine(lines, index);
    if (remaining !== -1) {
      throw structuredError("YAML_PARSE_FAILED", `Unexpected content at line ${remaining + 1}`, file);
    }
    return value ?? {};
  } catch (error) {
    if (error instanceof FixtureLoadError) throw error;
    throw structuredError("YAML_PARSE_FAILED", error?.message ?? "Unable to parse YAML", file, error);
  }
}

function parseSkillMarkdown(text, file) {
  const normalized = text.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
  if (!normalized.startsWith("---\n")) {
    throw structuredError("FRONTMATTER_PARSE_FAILED", "SKILL.md must start with YAML frontmatter", file);
  }

  const closeIndex = normalized.indexOf("\n---\n", 4);
  if (closeIndex === -1) {
    throw structuredError("FRONTMATTER_PARSE_FAILED", "SKILL.md frontmatter closing delimiter not found", file);
  }

  const frontmatterText = normalized.slice(4, closeIndex);
  const body = normalized.slice(closeIndex + "\n---\n".length);

  try {
    return {
      frontmatter: parseYaml(frontmatterText, file),
      frontmatterText,
      body,
    };
  } catch (error) {
    throw structuredError(
      "FRONTMATTER_PARSE_FAILED",
      `Unable to parse SKILL.md frontmatter: ${error.message}`,
      file,
      error,
    );
  }
}

export async function loadFixture(fixtureDir) {
  const entries = await Promise.all(
    Object.entries(REQUIRED_FILES).map(async ([key, relativePath]) => {
      const raw = await readFixtureFile(fixtureDir, relativePath);
      return [key, { path: relativePath, raw }];
    }),
  );

  const files = Object.fromEntries(entries);
  const parsed = {};

  for (const [key, file] of Object.entries(files)) {
    if (key === "readme") continue;
    if (key === "skill") {
      parsed.skill = parseSkillMarkdown(file.raw, file.path);
      continue;
    }
    parsed[key] = parseYaml(file.raw, file.path);
  }

  return {
    fixtureDir: path.resolve(fixtureDir),
    files,
    ...parsed,
  };
}

export default loadFixture;
