// Issue numbers an entry names in the calling repository, in order: issue links, `owner/repo#N`, bare `#N`.
// Pull request links and other repositories are left out; a bare `#N` can be a pull request, so the caller asks the API.
export function issueNumbersIn(text: string, repository: string, serverUrl: string): number[] {
  const found: { readonly at: number; readonly number: number }[] = [];
  const add = (at: number, value: string | undefined): void => {
    const number = Number(value);
    if (Number.isSafeInteger(number) && number > 0) found.push({ at, number });
  };
  const self = repository.toLowerCase();
  const host = new URL(serverUrl).host.toLowerCase();
  const url = /https?:\/\/([^/\s)>\]]+)\/([\w.-]+)\/([\w.-]+)\/(issues|pull|pulls)\/(\d+)[^\s)>\]]*/gi;
  const isOwnIssue = (match: readonly (string | undefined)[]): boolean =>
    match[1]?.toLowerCase() === host &&
    `${match[2]}/${match[3]}`.toLowerCase() === self &&
    match[4]?.toLowerCase() === "issues";
  // Each pass blanks what it read, so offsets stay put and nothing is read twice.
  const blank = (value: string): string => " ".repeat(value.length);

  let rest = text.replace(/(`+)[\s\S]*?\1/g, blank);

  // A link's text, such as [#687], names the link's target, so it never counts on its own.
  rest = rest.replace(/\[(?:\\.|[^[\]\\])*\]\(([^)\s]*)(?:\s[^)]*)?\)/g, (link: string, target: string, at: number) => {
    const match = new RegExp(url.source, "i").exec(target);
    if (match === null) return link.replace(target, blank(target));
    if (isOwnIssue(match)) add(at, match[5]);
    return blank(link);
  });
  // A reference link such as [#7][upstream] is defined outside the entry, so its target is unknown and it never counts.
  rest = rest.replace(/\[(?:\\.|[^[\]\\])*\]\[[^[\]]*\]/g, blank);
  rest = rest.replace(url, (whole: string, ...groups: unknown[]) => {
    const match = [whole, ...groups.slice(0, 5)] as string[];
    if (isOwnIssue(match)) add(groups[5] as number, match[5]);
    return blank(whole);
  });
  rest = rest.replace(/https?:\/\/\S+/g, blank);

  for (const ref of rest.matchAll(/(?<![\w.-])([\w.-]+)\/([\w.-]+)#(\d+)\b/g)) {
    if (`${ref[1]}/${ref[2]}`.toLowerCase() === self) add(ref.index, ref[3]);
    rest = rest.slice(0, ref.index) + blank(ref[0]) + rest.slice(ref.index + ref[0].length);
  }
  for (const ref of rest.matchAll(/(?<![\w&#/])#(\d+)\b/g)) add(ref.index, ref[1]);

  const numbers: number[] = [];
  for (const { number } of found.sort((a, b) => a.at - b.at)) {
    if (!numbers.includes(number)) numbers.push(number);
  }
  return numbers;
}
