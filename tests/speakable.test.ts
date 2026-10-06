import { describe, expect, it } from "vitest";
import { camelToWords, firstSentences, parseSectionReply, polishPhrasing, screamingToWords, shoutedToWords, toSpeakable } from "@/lib/narrate/speakable";

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

  it("capitalises acronyms so voices spell them out", () => {
    expect(toSpeakable("Pass the id and the urls to the api.")).toBe("Pass the ID and the URLs to the API.");
    expect(toSpeakable("A valid identifier, an idea, a uniform.")).toBe("A valid identifier, an idea, a uniform.");
  });

  it("says dotted product names the way people do", () => {
    expect(toSpeakable("Built with Next.js, listed in package.json.")).toBe("Built with Next JS, listed in package JSON.");
  });

  it("drops banned filler and screen-bound phrasing", () => {
    expect(polishPhrasing("Notice that the list resets. It simply waits, as you can see, at the bottom of the file.")).toBe(
      "The list resets. It waits toward the end of the file.",
    );
    expect(polishPhrasing("The header at the top of the page stays.")).toBe("The header at the top of the page stays.");
  });

  it("removes emoji and collapses whitespace", () => {
    expect(toSpeakable("Done ✅   really.\n\n\n\nNext.")).toBe("Done really.\n\nNext.");
  });
});

describe("code names", () => {
  it("turns constants and camel case into words a voice can say", () => {
    expect(screamingToWords("SET_PAGE")).toBe("set page");
    expect(screamingToWords("NEXT_PUBLIC_API_URL")).toBe("next public API URL");
    expect(camelToWords("mapDispatchToProps")).toBe("map dispatch to props");
    expect(camelToWords("innerHTML")).toBe("inner HTML");
    expect(camelToWords("iPhone")).toBe("iPhone");
    expect(toSpeakable("It dispatches SET_PAGE from mapDispatchToProps.")).toBe("It dispatches set page from map dispatch to props.");
  });

  it("lowers shouted action names but keeps acronyms", () => {
    expect(shoutedToWords("APP LOAD")).toBe("app load");
    expect(shoutedToWords("LOGIN")).toBe("login");
    expect(shoutedToWords("JWT")).toBe("JWT");
    expect(shoutedToWords("README")).toBe("README");
    expect(toSpeakable("It sends APP LOAD, then LOGIN, with the JWT and the API URL.")).toBe("It sends app load, then login, with the JWT and the API URL.");
  });

  it("keeps literal values in their own case and splits joined-up names", () => {
    expect(toSpeakable("It saves the token under the key jwt and sends the API url.")).toBe("It saves the token under the key jwt and sends the API URL.");
    expect(toSpeakable("The CommentInput component sits on GitHub.")).toBe("The Comment Input component sits on GitHub.");
  });

  it("smooths trailing-off dots and folder shorthand", () => {
    expect(toSpeakable("A line that reads No articles are here... yet.")).toBe("A line that reads No articles are here, yet.");
    expect(toSpeakable("It lives in the src folder.")).toBe("It lives in the source folder.");
  });

  it("drops stock back-references and labelled morals", () => {
    expect(polishPhrasing("The middleware we covered earlier waits for it.")).toBe("The middleware waits for it.");
    expect(polishPhrasing("As we heard earlier, the store holds it.")).toBe("The store holds it.");
    expect(polishPhrasing("Unlike everything we heard about earlier, it waits.")).toBe("Unlike everything we heard about earlier, it waits.");
    expect(polishPhrasing("The takeaway: keep both lists in step.")).toBe("Keep both lists in step.");
    expect(polishPhrasing("The takeaway is that both lists must match.")).toBe("Both lists must match.");
  });
});

describe("parseSectionReply", () => {
  it("reads the notes for later parts, one per line", () => {
    const r = parseSectionReply(
      "TITLE: The editor\n\nThe editor saves articles.\n\nRECIPE: Add a cover image: add an input in the Editor component, then send it in submit form.\nBUGS:\n- submit form: errors never show\n- none\nEXPLAINED: pages empty their shared data when you leave\nFACTS: none\nTERMS: slug\nSUMMARY: The editor.",
    );
    expect(r.body).toBe("The editor saves articles.");
    expect(r.recipes).toEqual(["Add a cover image: add an input in the Editor component, then send it in submit form."]);
    expect(r.bugs).toEqual(["submit form: errors never show"]);
    expect(r.explained).toEqual(["pages empty their shared data when you leave"]);
    expect(r.facts).toEqual([]);
  });

  it("keeps every line when a label repeats", () => {
    const r = parseSectionReply("TITLE: Settings\n\nThe settings page.\n\nBUGS: the save button stays disabled\nBUGS: errors clear the user\nRECIPE: one\nRECIPE: two\nNOTED: unload never sent\nSUMMARY: Settings.");
    expect(r.bugs).toEqual(["the save button stays disabled", "errors clear the user"]);
    expect(r.recipes).toEqual(["one", "two"]);
    expect(r.noted).toEqual(["unload never sent"]);
  });

  it("reads chapter names and bridges from the introduction", () => {
    const o = parseSectionReply("NAME: Conduit\n\nConduit is a blogging site.\n\nCHAPTER 1: Where it all starts\nCHAPTER 2: Reading articles.\nBRIDGE 2: Now that the app is running, let's read something.");
    expect(o.body).toBe("Conduit is a blogging site.");
    expect(o.chapters).toEqual({ 1: "Where it all starts", 2: "Reading articles" });
    expect(o.bridges).toEqual({ 2: "Now that the app is running, let's read something." });
  });

  it("reads the terms a part explained and an app name", () => {
    const r = parseSectionReply("TITLE: The store\n\nThe store holds it.\n\nCHANGES: none\n\nTERMS: reducer, Slug.\n\nSUMMARY: The store.");
    expect(r.terms).toEqual(["reducer", "slug"]);
    expect(r.changes).toBeNull();
    expect(r.summary).toBe("The store.");
    const o = parseSectionReply("NAME: Conduit\n\nConduit is a blogging site.");
    expect(o.name).toBe("Conduit");
    expect(o.body).toBe("Conduit is a blogging site.");
  });

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

  it("uses a leading markdown heading as the title when there's no TITLE line", () => {
    const r = parseSectionReply("## The chat route\n\nIt handles messages.\n\nSUMMARY: Chat.");
    expect(r.title).toBe("The chat route");
    expect(r.body).toBe("It handles messages.");
  });

  it("pulls out the change notes, wherever the model puts them", () => {
    const r = parseSectionReply("TITLE: X\n\nBody.\n\nCHANGES: Edit the limit in the agent file.\n\nSUMMARY: Does X.");
    expect(r).toMatchObject({ body: "Body.", changes: "Edit the limit in the agent file.", summary: "Does X." });
    const swapped = parseSectionReply("TITLE: X\n\nBody.\n\nSUMMARY: Does X.\nCHANGES: none");
    expect(swapped).toMatchObject({ body: "Body.", summary: "Does X.", changes: null });
  });

  it("drops chatter before the TITLE line", () => {
    const r = parseSectionReply("Sure, here's the narration you asked for.\n\nTITLE: The store\n\nThe store holds the data.\n\nSUMMARY: The store.");
    expect(r.title).toBe("The store");
    expect(r.body).toBe("The store holds the data.");
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
