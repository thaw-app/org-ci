// Finds a release's section in a Keep a Changelog file. Shared by the actions
// that read the changelog, so they agree on which lines belong to a release.

// Returns the section's lines between its `## [tag]` heading and the next
// level-two heading, trimmed, or undefined when no heading names the tag.
export function findChangelogSection(content: string, tag: string): string | undefined {
  const lines = content.replace(/^﻿/, "").split(/\r?\n/);
  const sectionLines: string[] = [];
  let collecting = false;
  let fence: string | null = null;

  for (const line of lines) {
    // A line is code when it sits inside a fence or is the fence marker itself.
    const wasFenced = fence !== null;
    fence = fenceAfter(fence, line);
    const isCode = wasFenced || fence !== null;

    if (!collecting) {
      collecting = !isCode && isReleaseHeading(line, tag);
      continue;
    }
    if (!isCode && /^ {0,3}##(?:[\t ]|$)/.test(line)) break;
    sectionLines.push(line);
  }

  if (!collecting) return undefined;
  return sectionLines.join("\n").trim();
}

// Returns the open fence after reading the line, or null when no fence is open.
export function fenceAfter(fence: string | null, line: string): string | null {
  const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  if (marker === null) return fence;

  const opening = marker[0].trimStart();
  if (fence === null) return opening;

  const closes =
    opening.startsWith(fence.charAt(0)) &&
    opening.length >= fence.length &&
    /^ {0,3}(`+|~+)\s*$/.test(line);
  return closes ? null : fence;
}

function isReleaseHeading(line: string, tag: string): boolean {
  const prefix = /^ {0,3}##[\t ]+/.exec(line);
  if (prefix === null) return false;

  const heading = line.slice(prefix[0].length);
  const candidates = [
    tag,
    `[${tag}]`,
    String.raw`\[${tag}]`,
    String.raw`[${tag}\]`,
    String.raw`\[${tag}\]`,
  ];
  return candidates.some((candidate) => {
    if (!heading.startsWith(candidate)) return false;
    const suffix = heading.slice(candidate.length);
    return suffix.length === 0 || /^[\t ]/.test(suffix);
  });
}
