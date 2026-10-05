import { describe, expect, it } from "vitest";
import { parseRepoUrl, refCandidates, RepoUrlError } from "@/lib/github/parse-url";

describe("parseRepoUrl", () => {
  it.each([
    ["https://github.com/vercel/next.js", "vercel", "next.js"],
    ["github.com/vercel/ai-chatbot", "vercel", "ai-chatbot"],
    ["http://www.github.com/owner/repo/", "owner", "repo"],
    ["owner/repo", "owner", "repo"],
    ["https://github.com/owner/repo.git", "owner", "repo"],
    ["git@github.com:owner/repo.git", "owner", "repo"],
    ["  https://github.com/owner/repo?tab=readme  ", "owner", "repo"],
    ["https://github.com/owner/repo/issues/12", "owner", "repo"],
  ])("reads %s", (input, owner, repo) => {
    const t = parseRepoUrl(input);
    expect(t.owner).toBe(owner);
    expect(t.repo).toBe(repo);
    expect(t.treeSegments).toEqual([]);
  });

  it("keeps the branch and folder from /tree/ links", () => {
    const t = parseRepoUrl("https://github.com/owner/repo/tree/main/packages/web");
    expect(t.treeSegments).toEqual(["main", "packages", "web"]);
    expect(refCandidates(t)[0]).toEqual({ ref: "main", subpath: "packages/web" });
    expect(refCandidates(t)[1]).toEqual({ ref: "main/packages", subpath: "web" });
  });

  it("narrates the folder that holds a /blob/ file", () => {
    const t = parseRepoUrl("https://github.com/owner/repo/blob/main/src/index.ts");
    expect(refCandidates(t)[0]).toEqual({ ref: "main", subpath: "src" });
  });

  it("defaults to HEAD", () => {
    expect(refCandidates(parseRepoUrl("owner/repo"))).toEqual([{ ref: "HEAD", subpath: "" }]);
  });

  it.each([
    [""],
    ["https://gitlab.com/owner/repo"],
    ["https://github.com/owner"],
    ["https://github.com/orgs/foo"],
    ["not a url at all"],
  ])("rejects %j with a friendly message", (input) => {
    expect(() => parseRepoUrl(input)).toThrow(RepoUrlError);
  });
});
