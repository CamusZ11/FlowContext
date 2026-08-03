export type FrontmatterValue = string | number | boolean | null | string[];
export type Frontmatter = Record<string, FrontmatterValue>;

/**
 * Parse the deliberately small YAML subset used by Obsidian project status
 * files. Keeping this parser dependency-free makes projection generation work
 * in the Codex/Deno tooling as well as in Node.
 */
export function parseFrontmatter(markdown: string): Frontmatter {
  const normalized = markdown.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---")) return {};
  const firstLineEnd = normalized.indexOf("\n");
  if (firstLineEnd < 0) return {};
  const endMatch = /^(?:---|\.\.\.)\s*$/m.exec(normalized.slice(firstLineEnd + 1));
  if (!endMatch) return {};

  const body = normalized.slice(firstLineEnd + 1, firstLineEnd + 1 + endMatch.index);
  const values: Frontmatter = {};
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const rawValue = stripInlineComment(line.slice(separator + 1).trim());
    values[key] = parseValue(rawValue);
  }
  return values;
}

function stripInlineComment(value: string): string {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if ((character === "'" || character === '"') && (index === 0 || value[index - 1] !== "\\")) {
      quote = quote === character ? null : quote ?? character;
    }
    if (character === "#" && quote === null && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index).trim();
    }
  }
  return value;
}

function parseValue(value: string): FrontmatterValue {
  if (value === "" || value === "~" || value === "null") return null;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\([\\"'])/g, "$1");
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => String(parseValue(item)));
  }
  return value;
}
