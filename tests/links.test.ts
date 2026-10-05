import { describe, expect, it } from "vitest";
import { analyzeFiles } from "@/lib/ingest/analyze";
import { buildLinkIndex, excerptLines, isRegistry, relatedExcerpts } from "@/lib/narrate/links";

// The shape that hid a real bug: middleware reads a counter at the top of the
// state, but the reducer that owns it is registered under the "common" key.
const files = analyzeFiles(
  Object.entries({
    "src/middleware.js": `import agent from "./agent";\nexport const promiseMiddleware = store => next => action => {\n  const currentView = store.getState().viewChangeCounter;\n  next(action);\n};`,
    "src/reducers/common.js": `import { APP_LOAD } from "../constants";\nexport default (state = { viewChangeCounter: 0 }, action) => {\n  switch (action.type) {\n    case APP_LOAD:\n      return { ...state, viewChangeCounter: state.viewChangeCounter + 1 };\n    default:\n      return state;\n  }\n};`,
    "src/reducer.js": `import common from "./reducers/common";\nimport auth from "./reducers/auth";\nexport default combineReducers({\n  auth,\n  common,\n});`,
    "src/reducers/auth.js": `export default (state = {}, action) => state;`,
    "src/agent.js": `let token = null;\nexport default { setToken: t => { token = t; } };`,
    "src/constants.js": Array.from({ length: 12 }, (_, i) => `export const ACTION_NUMBER_${i} = 'ACTION_NUMBER_${i}';`).join("\n") + "\nexport const APP_LOAD = 'APP_LOAD';",
  }).map(([path, content]) => ({ path, size: content.length, content })),
);

describe("related excerpts", () => {
  const index = buildLinkIndex(files);

  it("links files that share a rare name and shows where the linked file is registered", () => {
    const related = relatedExcerpts(index, "src/middleware.js");
    const paths = related.map((r) => r.path);
    expect(paths).toContain("src/reducers/common.js");
    expect(related.find((r) => r.path === "src/reducers/common.js")?.text).toContain("viewChangeCounter: state.viewChangeCounter + 1");
    // The one hop further: the combine call shows the key the reducer lives under.
    expect(related.find((r) => r.path === "src/reducer.js")?.text).toContain("common,");
  });

  it("shows how importers use a file, without their import lines", () => {
    const related = relatedExcerpts(index, "src/agent.js");
    const fromMiddleware = related.find((r) => r.path === "src/middleware.js");
    expect(fromMiddleware).toBeUndefined(); // middleware imports agent but never calls it here
    expect(excerptLines('import agent from "./agent";\nagent.setToken(x);\nother();', ["agent"], 500)).toBe("agent.setToken(x);\nother();");
  });

  it("recognises a file that only lists constants", () => {
    expect(isRegistry(files.find((f) => f.path === "src/constants.js")!)).toBe(true);
    expect(isRegistry(files.find((f) => f.path === "src/reducers/common.js")!)).toBe(false);
  });

  it("keeps excerpts within the size limit", () => {
    const big = Array.from({ length: 400 }, (_, i) => `use(sharedName${i % 3});`).join("\n");
    expect(excerptLines(big, ["sharedName1"], 300).length).toBeLessThanOrEqual(302);
  });
});
