export type Channel = "alpha" | "beta" | "rc" | "stable" | "prerelease";

// The channel is the first pre-release identifier: 3.0.0-alpha.14 is alpha,
// 2.2.0-rc.1 is rc, and a tag without one is stable.
export function channelOfTag(tag: string): Channel {
  const [version = ""] = tag.replace(/^v/i, "").split("+", 1);
  const dash = version.indexOf("-");
  if (dash === -1) return "stable";
  const identifier = version.slice(dash + 1).toLowerCase();
  const known = /^(alpha|beta|rc)(?![a-z])/.exec(identifier);
  return (known?.[1] as Channel | undefined) ?? "prerelease";
}

const CHANNEL_PHRASES: Record<Channel, string> = {
  alpha: "an alpha release",
  beta: "a beta release",
  rc: "a release candidate",
  stable: "a stable release",
  prerelease: "a pre-release",
};

// Later runs for the same tag find the comment by this first line.
export function markerFor(tag: string): string {
  return `<!-- shipped-in ${tag} -->`;
}

export interface CommentContent {
  readonly tag: string;
  readonly releaseUrl: string;
  readonly productName: string;
  readonly entries: readonly string[];
}

export function renderComment(content: CommentContent): string {
  const product = content.productName.trim();
  const prefix = product.length > 0 ? `${product} ` : "";
  const version = `${prefix}[${content.tag}](${content.releaseUrl})`;
  const subject = content.entries.length === 1 ? "The change below" : "The changes below";
  const quotes = content.entries.map((entry) =>
    quietMentions(entry)
      .split("\n")
      .map((line) => `> ${line}`.trimEnd())
      .join("\n"),
  );
  return [
    markerFor(content.tag),
    `${subject} shipped in ${version}, ${CHANNEL_PHRASES[channelOfTag(content.tag)]}.`,
    "",
    quotes.join("\n\n"),
    "",
  ].join("\n");
}

// A quoted entry names contributors; a zero-width space keeps the comment from
// notifying each of them again on every issue it lands on.
function quietMentions(text: string): string {
  return text.replace(/(^|[^\w`])@(?=[A-Za-z0-9])/g, "$1@&#8203;");
}
