import { fenceAfter } from "../../release-notes/src/changelog-section.js";

export interface ChangelogEntry {
  // The ### heading the entry sits under.
  readonly section: string;
  // The list item's text without its marker, continuation lines included.
  readonly text: string;
}

const ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[\t ]+|$)/;
const HEADING = /^(#{1,6})(?:[\t ]|$)/;

const sectionKey = (name: string): string => name.trim().toLowerCase();

// Lists the top-level list items under one of sections (compared without case); a #### keeps its ###.
// Prose, quotes and anything before the first ### are never entries.
export function listEntries(body: string, sections: readonly string[]): ChangelogEntry[] {
  const reader = new EntryReader(new Set(sections.map(sectionKey)));
  for (const line of body.split(/\r?\n/)) reader.read(line);
  return reader.finish();
}

class EntryReader {
  private readonly entries: ChangelogEntry[] = [];
  private section: string | undefined;
  private lines: string[] | undefined;
  private afterBlank = false;
  private fence: string | null = null;

  constructor(private readonly wanted: ReadonlySet<string>) {}

  read(line: string): void {
    const wasFenced = this.fence !== null;
    this.fence = fenceAfter(this.fence, line);
    if (wasFenced || this.fence !== null) this.readCode(line);
    else if (!this.readHeading(line)) this.readText(line);
  }

  finish(): ChangelogEntry[] {
    this.close();
    return this.entries;
  }

  // Code stays with the item it is indented under, and is never an item itself.
  private readCode(line: string): void {
    if (this.lines !== undefined && /^[\t ]/.test(line)) this.lines.push(line.trim());
    else this.close();
  }

  private readHeading(line: string): boolean {
    const heading = HEADING.exec(line);
    if (heading === null) return false;
    this.close();
    const level = heading[1]?.length ?? 0;
    if (level === 3) this.section = headingText(line.slice(level));
    else if (level < 3) this.section = undefined;
    return true;
  }

  private readText(line: string): void {
    if (line.trim().length === 0) {
      this.afterBlank = this.lines !== undefined;
      return;
    }
    // Indented lines, nested items among them, belong to the open item.
    if (this.lines !== undefined && /^[\t ]{2,}/.test(line)) {
      this.lines.push(line.trim());
      this.afterBlank = false;
      return;
    }
    const item = ITEM.exec(line);
    if (item !== null) {
      this.close();
      if (this.section !== undefined && this.wanted.has(sectionKey(this.section))) {
        this.lines = [line.slice(item[0].length)];
      }
      return;
    }
    // A line straight after the item, without a blank line, continues it.
    if (this.lines !== undefined && !this.afterBlank && !/^ {0,3}>/.test(line)) {
      this.lines.push(line.trim());
      return;
    }
    // A paragraph, a quote or a rule after the list ends the item.
    this.close();
  }

  private close(): void {
    if (this.lines !== undefined && this.section !== undefined) {
      const text = this.lines.join("\n").trim();
      if (text.length > 0) this.entries.push({ section: this.section, text });
    }
    this.lines = undefined;
    this.afterBlank = false;
  }
}

// Closing #s follow a space: "### Fixed ##" is Fixed, "### C#" stays C#.
function headingText(rest: string): string {
  const text = rest.trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end -= 1;
  if (end > 0 && !/[\t ]/.test(text.charAt(end - 1))) return text;
  return text.slice(0, end).trimEnd();
}
