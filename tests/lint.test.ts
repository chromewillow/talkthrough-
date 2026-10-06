import { describe, expect, it } from "vitest";
import { lintPart } from "@/lib/narrate/lint";

const earlier = [
  { number: 3, title: "The profile page", body: "The Profile component passes the current page under the wrong name, so no page number is highlighted. It shows the user's articles." },
  { number: 4, title: "The editor", body: "When you open the editor, it loads the article. The catch is that errors vanish. The catch is that saving twice duplicates." },
];

describe("lintPart", () => {
  it("flags repeats, screen pointers, spoken code, case points and hedges", () => {
    const flags = lintPart(
      [
        "When you open the editor, it fills in the form.",
        "The Profile component passes the current page under the wrong name, so no page number is highlighted.",
        "The list shown below holds every tab.",
        "It reads state dot in progress before saving.",
        "It writes the tag in lowercase so React ignores it.",
        "This probably runs on every page.",
        "The catch is that it never clears.",
      ].join(" "),
      earlier,
    );
    const text = flags.join("\n");
    expect(text).toMatch(/opens with the same words as part 4/);
    expect(text).toMatch(/repeats what the listener heard in part 3/);
    expect(text).toMatch(/can't see/);
    expect(text).toMatch(/reads code aloud/);
    expect(text).toMatch(/ear can't catch/);
    expect(text).toMatch(/hedges/);
    expect(text).toMatch(/"The catch is" has already been used 2 times/);
  });

  it("catches a paraphrased repeat and a back-reference to nothing", () => {
    const flags = lintPart(
      "Leaving the settings page empties its shared data, so the next visit starts clean.",
      [{ number: 9, title: "Pages", body: "When you leave a page, its shared data is emptied so the next visit starts clean with nothing stale." }],
    ).join("\n");
    expect(flags).toMatch(/repeats what the listener heard in part 9/);
    expect(flags).not.toMatch(/refers back/);
    const lonely = lintPart("This uses the same recipe as the editor.", []).join("\n");
    expect(lonely).toMatch(/refers back to something no earlier part said/);
  });

  it("flags a term explained again", () => {
    const flags = lintPart("Each article has a slug, the short web-address version of its title, which the page reads.", [], ["slug"]);
    expect(flags.join("\n")).toMatch(/explains "slug" again/);
  });

  it("leaves a clean part alone", () => {
    expect(lintPart("The Settings component lets you change your bio and picture. Saving sends the new details to the server.", earlier)).toEqual([]);
  });
});
