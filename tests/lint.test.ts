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
    expect(text).toMatch(/repeats part 3/);
    expect(text).toMatch(/can't see/);
    expect(text).toMatch(/reads code aloud/);
    expect(text).toMatch(/ear can't catch/);
    expect(text).toMatch(/hedges/);
    expect(text).toMatch(/"The catch is" has already been used 2 times/);
  });

  it("flags a term explained again", () => {
    const flags = lintPart("Each article has a slug, the short web-address version of its title, which the page reads.", [], ["slug"]);
    expect(flags.join("\n")).toMatch(/explains "slug" again/);
  });

  it("leaves a clean part alone", () => {
    expect(lintPart("The Settings component lets you change your bio and picture. Saving sends the new details to the server.", earlier)).toEqual([]);
  });
});
