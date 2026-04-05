import {
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  type TerminalContextDraft,
} from "./lib/terminalContext";

export type ComposerPromptSegment =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "mention";
      path: string;
    }
  | {
      type: "skill";
      skillName: string;
    }
  | {
      type: "terminal-context";
      context: TerminalContextDraft | null;
    };

const MENTION_TOKEN_REGEX = /(^|\s)@([^\s@]+)(?=\s)/g;
const SKILL_TOKEN_REGEX = /(^|\s)\/([^\s/]+)(?=\s|$)/g;

function pushTextSegment(segments: ComposerPromptSegment[], text: string): void {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last && last.type === "text") {
    last.text += text;
    return;
  }
  segments.push({ type: "text", text });
}

function splitPromptTextIntoComposerSegments(
  text: string,
  availableSkillNames: ReadonlySet<string>,
): ComposerPromptSegment[] {
  const segments: ComposerPromptSegment[] = [];
  if (!text) {
    return segments;
  }

  const tokenMatches = [
    ...Array.from(text.matchAll(MENTION_TOKEN_REGEX), (match) => ({
      kind: "mention" as const,
      match,
    })),
    ...Array.from(text.matchAll(SKILL_TOKEN_REGEX), (match) => ({
      kind: "skill" as const,
      match,
    })),
  ].toSorted((left, right) => (left.match.index ?? 0) - (right.match.index ?? 0));

  let cursor = 0;
  for (const tokenMatch of tokenMatches) {
    const fullMatch = tokenMatch.match[0] ?? "";
    const prefix = tokenMatch.match[1] ?? "";
    const value = tokenMatch.match[2] ?? "";
    const matchIndex = tokenMatch.match.index ?? 0;
    const tokenStart = matchIndex + prefix.length;
    const tokenEnd = tokenStart + fullMatch.length - prefix.length;

    if (tokenStart < cursor) {
      continue;
    }

    if (tokenStart > cursor) {
      pushTextSegment(segments, text.slice(cursor, tokenStart));
    }

    if (tokenMatch.kind === "mention") {
      if (value.length > 0) {
        segments.push({ type: "mention", path: value });
      } else {
        pushTextSegment(segments, text.slice(tokenStart, tokenEnd));
      }
    } else if (value.length > 0 && availableSkillNames.has(value)) {
      segments.push({ type: "skill", skillName: value });
    } else {
      pushTextSegment(segments, text.slice(tokenStart, tokenEnd));
    }

    cursor = tokenEnd;
  }

  if (cursor < text.length) {
    pushTextSegment(segments, text.slice(cursor));
  }

  return segments;
}

export function splitPromptIntoComposerSegments(
  prompt: string,
  terminalContexts: ReadonlyArray<TerminalContextDraft> = [],
  availableSkillNamesInput: ReadonlyArray<string> = [],
): ComposerPromptSegment[] {
  if (!prompt) {
    return [];
  }

  const segments: ComposerPromptSegment[] = [];
  let textCursor = 0;
  let terminalContextIndex = 0;
  const availableSkillNames = new Set(availableSkillNamesInput);

  for (let index = 0; index < prompt.length; index += 1) {
    if (prompt[index] !== INLINE_TERMINAL_CONTEXT_PLACEHOLDER) {
      continue;
    }

    if (index > textCursor) {
      segments.push(
        ...splitPromptTextIntoComposerSegments(
          prompt.slice(textCursor, index),
          availableSkillNames,
        ),
      );
    }
    segments.push({
      type: "terminal-context",
      context: terminalContexts[terminalContextIndex] ?? null,
    });
    terminalContextIndex += 1;
    textCursor = index + 1;
  }

  if (textCursor < prompt.length) {
    segments.push(
      ...splitPromptTextIntoComposerSegments(prompt.slice(textCursor), availableSkillNames),
    );
  }

  return segments;
}

export function getPromptSkillMentions(
  prompt: string,
  availableSkillNames: ReadonlyArray<string>,
): string[] {
  const selectedSkillNames: string[] = [];
  const seen = new Set<string>();

  for (const segment of splitPromptIntoComposerSegments(prompt, [], availableSkillNames)) {
    if (segment.type !== "skill" || seen.has(segment.skillName)) {
      continue;
    }
    seen.add(segment.skillName);
    selectedSkillNames.push(segment.skillName);
  }

  return selectedSkillNames;
}

export function stripPromptSkillMentions(
  prompt: string,
  availableSkillNames: ReadonlyArray<string>,
): string {
  const segments = splitPromptIntoComposerSegments(prompt, [], availableSkillNames);
  let nextPrompt = "";
  let trimLeadingWhitespace = false;

  for (const segment of segments) {
    if (segment.type === "skill") {
      trimLeadingWhitespace = nextPrompt.length === 0 || /\s$/.test(nextPrompt);
      continue;
    }

    const nextText =
      segment.type === "mention"
        ? `@${segment.path}`
        : segment.type === "terminal-context"
          ? INLINE_TERMINAL_CONTEXT_PLACEHOLDER
          : segment.text;

    if (trimLeadingWhitespace && nextText.length > 0 && /^\s/.test(nextText)) {
      nextPrompt += nextText.slice(1);
    } else {
      nextPrompt += nextText;
    }
    trimLeadingWhitespace = false;
  }

  return trimLeadingWhitespace ? nextPrompt.replace(/\s$/, "") : nextPrompt;
}
