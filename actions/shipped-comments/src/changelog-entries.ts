import { fenceAfter } from "../../release-notes/src/changelog-section.js";

export interface ChangelogEntry {
  // The `###` heading the entry sits under.
  readonly section: string;
  // The list item's text without its marker, continuation lines included.
  readonly text: string;
}

const ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[\t ]+|$)/;

// Lists the top-level list items under one of `sections` (compared without case); a `####` keeps its `###`.
// Prose, quotes and anything before the first `###` are never entries.
export function listEntries(body: string, sections: readonly string[]): ChangelogEntry[] {
  const wanted = new Set(sections.map((name) => name.trim().toLowerCase()));
  const entries: ChangelogEntry[] = [];
  let section: string | undefined;
  let lines: string[] | undefined;
  let afterBlank = false;
  let fence: string | null = null;

  const close = (): void => {
    if (lines !== undefined && section !== undefined) {
      const text = lines.join("\n").trim();
      if (text.length > 0) entries.push({ section, text });
    }
    lines = undefined;
    afterBlank = false;
  };

  for (const line of body.split(/\r?\n/)) {
    const wasFenced = fence !== null;
    fence = fenceAfter(fence, line);
    if (wasFenced || fence !== null) {
      // Code stays with the item it is indented under, and is never an item itself.
      if (lines !== undefined && /^[\t ]/.test(line)) lines.push(line.trim());
      else close();
      continue;
    }

    const heading = /^(#{1,6})[\t ]+(.*?)[\t ]*#*[\t ]*$/.exec(line);
    if (heading !== null) {
      close();
      const level = heading[1]?.length ?? 0;
      if (level === 3) section = heading[2];
      else if (level < 3) section = undefined;
      continue;
    }

    if (line.trim().length === 0) {
      afterBlank = lines !== undefined;
      continue;
    }

    // Indented lines, nested items among them, belong to the open item.
    if (lines !== undefined && /^[\t ]{2,}/.test(line)) {
      lines.push(line.trim());
      afterBlank = false;
      continue;
    }

    const item = ITEM.exec(line);
    if (item !== null) {
      close();
      if (section !== undefined && wanted.has(section.trim().toLowerCase())) {
        lines = [line.slice(item[0].length)];
      }
      continue;
    }

    // A line straight after the item, without a blank line, continues it.
    if (lines !== undefined && !afterBlank && !/^ {0,3}>/.test(line)) {
      lines.push(line.trim());
      continue;
    }
    // A paragraph, a quote or a rule after the list ends the item.
    close();
  }
  close();
  return entries;
}
