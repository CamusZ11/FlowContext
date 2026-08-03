export function readHeading(markdown: string, level: number): string {
  const marker = "#".repeat(level);
  const pattern = new RegExp(`^${marker}\\s+(.+?)\\s*$`, "m");
  return pattern.exec(markdown)?.[1].trim() ?? "";
}

export function readFirstParagraph(markdown: string, heading: string): string {
  const section = sectionBody(markdown, heading);
  if (!section) return "";
  const lines = section.split(/\r?\n/);
  const paragraph: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (paragraph.length > 0) break;
      continue;
    }
    if (/^#{1,6}\s/.test(trimmed) || /^[-*+]\s/.test(trimmed)) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(trimmed);
  }
  return paragraph.join(" ").trim();
}

export function readFirstListItem(markdown: string, heading: string): string {
  const section = sectionBody(markdown, heading);
  if (!section) return "";
  const match = /^(?:\s*[-*+]\s+|\s*\d+[.)]\s+)(.+?)\s*$/m.exec(section);
  return match?.[1].trim() ?? "";
}

export function sectionBody(markdown: string, heading: string): string {
  const escapedHeading = escapeRegExp(heading.trim());
  const match = new RegExp(`^#{1,6}\\s+${escapedHeading}\\s*$`, "mi").exec(markdown);
  if (!match || match.index === undefined) return "";
  const start = match.index + match[0].length;
  const remainder = markdown.slice(start).replace(/^\r?\n/, "");
  const nextHeading = /^#{1,6}\s+/m.exec(remainder);
  return nextHeading?.index === undefined ? remainder : remainder.slice(0, nextHeading.index);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
