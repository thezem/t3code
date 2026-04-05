import { describe, expect, it } from "vitest";

import {
  getPromptSkillMentions,
  splitPromptIntoComposerSegments,
  stripPromptSkillMentions,
} from "./composer-editor-mentions";
import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "./lib/terminalContext";

describe("splitPromptIntoComposerSegments", () => {
  it("splits mention tokens followed by whitespace into mention segments", () => {
    expect(splitPromptIntoComposerSegments("Inspect @AGENTS.md please")).toEqual([
      { type: "text", text: "Inspect " },
      { type: "mention", path: "AGENTS.md" },
      { type: "text", text: " please" },
    ]);
  });

  it("does not convert an incomplete trailing mention token", () => {
    expect(splitPromptIntoComposerSegments("Inspect @AGENTS.md")).toEqual([
      { type: "text", text: "Inspect @AGENTS.md" },
    ]);
  });

  it("keeps newlines around mention tokens", () => {
    expect(splitPromptIntoComposerSegments("one\n@src/index.ts \ntwo")).toEqual([
      { type: "text", text: "one\n" },
      { type: "mention", path: "src/index.ts" },
      { type: "text", text: " \ntwo" },
    ]);
  });

  it("keeps inline terminal context placeholders at their prompt positions", () => {
    expect(
      splitPromptIntoComposerSegments(
        `Inspect ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}@AGENTS.md please`,
      ),
    ).toEqual([
      { type: "text", text: "Inspect " },
      { type: "terminal-context", context: null },
      { type: "mention", path: "AGENTS.md" },
      { type: "text", text: " please" },
    ]);
  });

  it("renders matching /skill tokens as skill segments", () => {
    expect(splitPromptIntoComposerSegments("/polish Final pass", [], ["polish"])).toEqual([
      { type: "skill", skillName: "polish" },
      { type: "text", text: " Final pass" },
    ]);
  });
});

describe("skill prompt helpers", () => {
  it("collects unique skill mentions in prompt order", () => {
    expect(getPromptSkillMentions("/polish /adapt /polish", ["polish", "adapt"])).toEqual([
      "polish",
      "adapt",
    ]);
  });

  it("strips skill mentions while keeping surrounding text readable", () => {
    expect(stripPromptSkillMentions("/polish Final quality pass", ["polish"])).toBe(
      "Final quality pass",
    );
    expect(stripPromptSkillMentions("Need /polish this", ["polish"])).toBe("Need this");
  });
});
