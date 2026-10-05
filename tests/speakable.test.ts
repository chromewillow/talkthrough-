import { describe, expect, it } from "vitest";
import { firstSentences, parseSectionReply, toSpeakable } from "@/lib/narrate/speakable";

describe("toSpeakable", () => {
  it("strips markdown a voice would read out", () => {
    const out = toSpeakable("## The router\n\nIt uses **bold** and `inline code` and *italics*.\n\n- first point\n- second point\n\n```ts\nconst x = 1;\n```\n\n[docs](https://x.y) & more -> next");
    expect(out).not.toMatch(/[#*`\[\]]/);
    expect(out).toContain("The router.");
    expect(out).toContain("It uses bold and inline code and italics.");
    expect(out).toContain("first point.");
    expect(out).not.toContain("const x");
    expect(out).toContain("docs and more to next");
  });

  it("spells out abbreviations and keeps identifiers intact", () => {
    expect(toSpeakable("Small helpers, e.g. handle_submit, i.e. glue, etc.")).toBe(
      "Small helpers, for example, handle_submit, that is, glue, and so on.",
    );
    expect(toSpeakable("React vs. Vue")).toBe("React versus Vue");
  });

  it("removes emoji and collapses whitespace", () => {
    expect(toSpeakable("Done ✅   really.\n\n\n\nNext.")).toBe("Done really.\n\nNext.");
  });
});

describe("parseSectionReply", () => {
  it("splits title, body and summary", () => {
    const r = parseSectionReply("TITLE: The chat route.\n\nFirst paragraph\nstill first.\n\nSecond one.\n\nSUMMARY: Handles chat.");
    expect(r.title).toBe("The chat route");
    expect(r.body).toBe("First paragraph still first.\n\nSecond one.");
    expect(r.summary).toBe("Handles chat.");
  });

  it("tolerates markdown around the labels and missing parts", () => {
    const r = parseSectionReply("**TITLE:** \"Where data lives\"\n\nBody here.");
    expect(r.title).toBe("Where data lives");
    expect(r.body).toBe("Body here.");
    expect(r.summary).toBeNull();
    expect(parseSectionReply("Just prose, no labels.").title).toBeNull();
  });

  it("unwraps a fenced reply", () => {
    const r = parseSectionReply("```\nTITLE: X\n\nBody.\n\nSUMMARY: S\n```");
    expect(r.title).toBe("X");
    expect(r.body).toBe("Body.");
  });

  it("picks the first sentences as a fallback summary", () => {
    expect(firstSentences("One. Two! Three?", 2)).toBe("One. Two!");
  });
});
