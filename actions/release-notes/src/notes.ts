export interface Notes {
  body: string;
  generate: boolean;
  source: string;
}

export function validateTag(tag: string): void {
  if (!tag.trim() || /[\r\n\0]/.test(tag)) {
    throw new Error("tag must be a nonempty single-line value");
  }
}

export function extractSection(changelog: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(
    `^##[\\t ]+(?:\\[${escaped}\\]|${escaped})(?=[\\t ]|$)[^\\r\\n]*$`,
  );
  const lines = changelog.replace(/^\uFEFF/, "").split(/\r?\n/);
  let start = -1;
  let fence: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line)) fence = undefined;
      continue;
    }
    if (fence) continue;
    if (start < 0 && heading.test(line)) start = i + 1;
    else if (start >= 0 && /^##(?:[\t ]|$)/.test(line)) {
      return lines.slice(start, i).join("\n").trim();
    }
  }
  return start < 0 ? "" : lines.slice(start).join("\n").trim();
}

export function resolveNotes(
  tag: string,
  override: string,
  changelog?: { path: string; text: string },
): Notes {
  validateTag(tag);
  const body = override.trim() || (changelog ? extractSection(changelog.text, tag) : "");
  return {
    body,
    generate: !body,
    source: override.trim() ? "release-notes input" : changelog ? changelog.path : "none",
  };
}
