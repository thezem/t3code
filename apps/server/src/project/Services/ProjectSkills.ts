import type {
  ProjectListSkillsInput,
  ProjectListSkillsResult,
  ProjectSkillName,
} from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

interface ResolvedProjectSkill {
  readonly name: ProjectSkillName;
  readonly source: "workspace" | "global";
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

export class ProjectSkills extends ServiceMap.Service<ProjectSkills, ProjectSkillsShape>()(
  "t3/project/Services/ProjectSkills",
) {}
