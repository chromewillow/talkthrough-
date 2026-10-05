import { describe, expect, it } from "vitest";
import { fileSlug, numberWords, scriptStats, spokenName, toListeningText, toMarkdown } from "@/lib/narrate/assemble";
import type { Walkthrough } from "@/lib/narrate/types";

const w: Walkthrough = {
  repo: { owner: "me", repo: "my_cool-App", ref: "HEAD", subpath: "", htmlUrl: "https://github.com/me/my_cool-App" },
  model: "anthropic/claude-sonnet-5.5",
  createdAt: "2026-10-05T12:00:00.000Z",
  title: "A guided tour of my_cool-App",
  overview: "This app does a thing.",
  sections: [
    { id: "file:src/a.ts", title: "Where it starts", body: "First.\n\nSecond.", summary: "", paths: ["src/a.ts"] },
    { id: "group:config", title: "How it's set up.", body: "Config.", summary: "", paths: ["package.json", "tsconfig.json"] },
  ],
  closing: "Go explore.",
  missing: [{ id: "file:src/b.ts", label: "src/b.ts" }],
};

describe("toListeningText", () => {
  it("reads as plain speech with spoken part numbers and no paths", () => {
    const text = toListeningText(w);
    expect(text).toBe(
      "A guided tour of my cool App.\n\nThis app does a thing.\n\nPart one. Where it starts.\n\nFirst.\n\nSecond.\n\nPart two. How it's set up.\n\nConfig.\n\nLast stop. Where to go when you want to change something.\n\nGo explore.\n",
    );
    expect(text).not.toMatch(/[#*`/]/);
  });

  it("announces chapters, then each part by its title", () => {
    const chaptered: Walkthrough = {
      ...w,
      sections: [
        { ...w.sections[0], chapter: "start" },
        { ...w.sections[1], chapter: "setup" },
      ],
    };
    expect(toListeningText(chaptered)).toBe(
      "A guided tour of my cool App.\n\nThis app does a thing.\n\nChapter one. Where it all starts.\n\nWhere it starts.\n\nFirst.\n\nSecond.\n\nChapter two. Setup, tests and docs.\n\nHow it's set up.\n\nConfig.\n\nLast stop. Where to go when you want to change something.\n\nGo explore.\n",
    );
    expect(toMarkdown(chaptered)).toContain("## Chapter 2: Setup, tests and docs");
    expect(toMarkdown(chaptered)).toContain("### 2. How it's set up.");
  });
});

describe("toMarkdown", () => {
  it("keeps headings, paths, provenance and missing parts", () => {
    const md = toMarkdown(w);
    expect(md).toContain("# A guided tour of my_cool-App");
    expect(md).toContain("## 1. Where it starts");
    expect(md).toContain("`package.json` · `tsconfig.json`");
    expect(md).toContain("## Where to make changes");
    expect(md).toContain("couldn't be generated: src/b.ts");
    expect(md).toContain("October 5, 2026");
  });
});

describe("helpers", () => {
  it("spells numbers", () => {
    expect([1, 13, 20, 42, 100, 115].map(numberWords)).toEqual(["one", "thirteen", "twenty", "forty-two", "one hundred", "one hundred and fifteen"]);
  });
  it("estimates listening time", () => {
    expect(scriptStats("word ".repeat(300))).toMatchObject({ words: 300, minutes: 2 });
  });
  it("names files and speaks repo names", () => {
    expect(fileSlug(w)).toBe("me-my-cool-app-talkthrough");
    expect(spokenName("reactReduxApp")).toBe("react Redux App");
  });
});
