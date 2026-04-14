import { Context, Schema } from "effect";
import type { Effect } from "effect";

export interface ProjectSkill {
  readonly name: string;
  readonly scope: "workspace" | "global";
  readonly path: string;
  readonly description: string;
}

export interface ProjectSkillIssue {
  readonly path: string;
  readonly message: string;
}

export interface ProjectListSkillsInput {
  readonly cwd: string;
}

export interface ProjectListSkillsResult {
  readonly skills: ReadonlyArray<ProjectSkill>;
  readonly issues: ReadonlyArray<ProjectSkillIssue>;
}

export type ProjectSkillName = ProjectSkill["name"];

interface ResolvedProjectSkill {
  readonly name: ProjectSkillName;
  readonly scope: "workspace" | "global";
  readonly path: string;
  readonly description: string;
  readonly contents: string;
}

export type { ResolvedProjectSkill };

export class ProjectSkillsError extends Schema.TaggedErrorClass<ProjectSkillsError>()(
  "ProjectSkillsError",
  {
    cwd: Schema.String,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface ProjectSkillsShape {
  readonly listSkills: (
    input: ProjectListSkillsInput,
  ) => Effect.Effect<ProjectListSkillsResult, ProjectSkillsError>;
  readonly resolveSelection: (input: {
    readonly cwd: string;
    readonly skillNames: ReadonlyArray<ProjectSkillName>;
  }) => Effect.Effect<ReadonlyArray<ResolvedProjectSkill>, ProjectSkillsError>;
}

export class ProjectSkills extends Context.Service<ProjectSkills, ProjectSkillsShape>()(
  "t3/project/Services/ProjectSkills",
) {}
