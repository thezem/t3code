import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  type ProjectListSkillsInput,
  type ProjectListSkillsResult,
  type ProjectSkill,
  type ProjectSkillIssue,
} from "../Services/ProjectSkills.ts";
import { Effect, Layer } from "effect";

import {
  ProjectSkills,
  type ProjectSkillsShape,
  type ResolvedProjectSkill,
} from "../Services/ProjectSkills.ts";

const WORKSPACE_SKILLS_DIRECTORY = path.join("agents", "skills");
const GLOBAL_SKILLS_DIRECTORY = path.join(".agents", "skills");
const SKILL_FILE_NAME = "SKILL.md";

function safeReadTextFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function safeReadDirectoryNames(dirPath: string): string[] {
  try {
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function parseFrontmatterSection(raw: string): { frontmatter: string; body: string } {
  if (!raw.startsWith("---")) {
    throw new Error("Expected YAML frontmatter fenced by ---.");
  }
  const lines = raw.split(/\r?\n/g);
  if (lines[0] !== "---") {
    throw new Error("Frontmatter must start on the first line.");
  }
  const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closingIndex < 0) {
    throw new Error("Frontmatter is missing a closing --- line.");
  }
  return {
    frontmatter: lines.slice(1, closingIndex).join("\n"),
    body: lines
      .slice(closingIndex + 1)
      .join("\n")
      .trim(),
  };
}

function parseFrontmatterValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFlatFrontmatter(frontmatter: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of frontmatter.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex <= 0) {
      throw new Error(`Invalid frontmatter line '${trimmed}'.`);
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1);
    result[key] = parseFrontmatterValue(rawValue);
  }
  return result;
}

function displayPathForSkillFile(input: {
  readonly cwd: string;
  readonly filePath: string;
  readonly scope: "workspace" | "global";
}): string {
  if (input.scope === "workspace") {
    return path.relative(input.cwd, input.filePath).replaceAll(path.sep, "/");
  }
  const home = os.homedir();
  if (input.filePath.startsWith(home)) {
    const relativeToHome = path.relative(home, input.filePath).replaceAll(path.sep, "/");
    return `~/${relativeToHome}`;
  }
  return input.filePath.replaceAll(path.sep, "/");
}

function parseSkillFile(input: {
  readonly cwd: string;
  readonly directoryPath: string;
  readonly scope: "workspace" | "global";
}): {
  readonly skill: ResolvedProjectSkill | null;
  readonly issue: ProjectSkillIssue | null;
} {
  const skillFilePath = path.join(input.directoryPath, SKILL_FILE_NAME);
  const displayPath = displayPathForSkillFile({
    cwd: input.cwd,
    filePath: skillFilePath,
    scope: input.scope,
  });
  const raw = safeReadTextFile(skillFilePath);
  if (raw === null) {
    return {
      skill: null,
      issue: {
        path: displayPath,
        message: "Failed to read skill file.",
      },
    };
  }

  try {
    const { frontmatter, body } = parseFrontmatterSection(raw);
    const parsedFrontmatter = parseFlatFrontmatter(frontmatter);
    const directoryName = path.basename(input.directoryPath);
    if (parsedFrontmatter.name !== directoryName) {
      throw new Error("Skill frontmatter 'name' must match the directory name.");
    }
    return {
      skill: {
        name: parsedFrontmatter.name,
        scope: input.scope,
        path: displayPath,
        description: parsedFrontmatter.description ?? "",
        contents: body,
      },
      issue: null,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message.trim() : String(error).trim();
    return {
      skill: null,
      issue: {
        path: displayPath,
        message: detail.length > 0 ? detail : "Invalid skill.",
      },
    };
  }
}

function collectDirectorySkills(input: {
  readonly cwd: string;
  readonly directoryPath: string;
  readonly scope: "workspace" | "global";
}): ProjectListSkillsResult {
  const directoryNames = safeReadDirectoryNames(input.directoryPath);
  const skills: ProjectSkill[] = [];
  const issues: ProjectSkillIssue[] = [];

  for (const directoryName of directoryNames) {
    const parsed = parseSkillFile({
      cwd: input.cwd,
      directoryPath: path.join(input.directoryPath, directoryName),
      scope: input.scope,
    });
    if (parsed.skill) {
      skills.push({
        name: parsed.skill.name,
        scope: parsed.skill.scope,
        path: parsed.skill.path,
        description: parsed.skill.description,
      });
    }
    if (parsed.issue) {
      issues.push(parsed.issue);
    }
  }

  return { skills, issues };
}

export const makeProjectSkills = Effect.sync(() => {
  const listSkills: ProjectSkillsShape["listSkills"] = (input: ProjectListSkillsInput) =>
    Effect.sync(() => {
      const workspaceResult = collectDirectorySkills({
        cwd: input.cwd,
        directoryPath: path.join(input.cwd, WORKSPACE_SKILLS_DIRECTORY),
        scope: "workspace",
      });
      const globalResult = collectDirectorySkills({
        cwd: input.cwd,
        directoryPath: path.join(os.homedir(), GLOBAL_SKILLS_DIRECTORY),
        scope: "global",
      });

      const skillsByName = new Map<string, ProjectSkill>();
      for (const skill of globalResult.skills) {
        skillsByName.set(skill.name, skill);
      }
      for (const skill of workspaceResult.skills) {
        skillsByName.set(skill.name, skill);
      }

      return {
        skills: Array.from(skillsByName.values()).toSorted((left, right) =>
          left.name.localeCompare(right.name),
        ),
        issues: [...workspaceResult.issues, ...globalResult.issues],
      };
    });

  const resolveSelection: ProjectSkillsShape["resolveSelection"] = (input) =>
    Effect.sync(() => {
      const resolvedSkills: ResolvedProjectSkill[] = [];
      const seen = new Set<ProjectSkill["name"]>();

      for (const skillName of input.skillNames) {
        if (seen.has(skillName)) {
          continue;
        }
        seen.add(skillName);

        const workspaceSkill = parseSkillFile({
          cwd: input.cwd,
          directoryPath: path.join(input.cwd, WORKSPACE_SKILLS_DIRECTORY, skillName),
          scope: "workspace",
        }).skill;
        if (workspaceSkill) {
          resolvedSkills.push(workspaceSkill);
          continue;
        }

        const globalSkill = parseSkillFile({
          cwd: input.cwd,
          directoryPath: path.join(os.homedir(), GLOBAL_SKILLS_DIRECTORY, skillName),
          scope: "global",
        }).skill;
        if (globalSkill) {
          resolvedSkills.push(globalSkill);
        }
      }

      return resolvedSkills;
    });

  return {
    listSkills,
    resolveSelection,
  } satisfies ProjectSkillsShape;
});

export const ProjectSkillsLive = Layer.effect(ProjectSkills, makeProjectSkills);
