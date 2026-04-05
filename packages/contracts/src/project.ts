import { Schema } from "effect";
import { PositiveInt, ProjectSkillName, TrimmedNonEmptyString } from "./baseSchemas";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 10_000;
const PROJECT_SEARCH_ROOT_PATH_MAX_LENGTH = 1_024;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;
const PROJECT_READ_FILE_PATH_MAX_LENGTH = 512;
const PROJECT_SKILL_PATH_MAX_LENGTH = 2_048;
const PROJECT_SKILL_DESCRIPTION_MAX_LENGTH = 1_024;

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: Schema.Trim.check(Schema.isMaxLength(256)),
  rootPath: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_SEARCH_ROOT_PATH_MAX_LENGTH)),
  ),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
  maxDepth: Schema.optional(PositiveInt),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

const ProjectEntryKind = Schema.Literals(["file", "directory"]);

export const ProjectEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  parentPath: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export class ProjectSearchEntriesError extends Schema.TaggedErrorClass<ProjectSearchEntriesError>()(
  "ProjectSearchEntriesError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  contents: Schema.String,
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;

export class ProjectWriteFileError extends Schema.TaggedErrorClass<ProjectWriteFileError>()(
  "ProjectWriteFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectReadFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_READ_FILE_PATH_MAX_LENGTH)),
});
export type ProjectReadFileInput = typeof ProjectReadFileInput.Type;

export const ProjectReadFileResult = Schema.Struct({
  contents: Schema.String,
});
export type ProjectReadFileResult = typeof ProjectReadFileResult.Type;

export class ProjectReadFileError extends Schema.TaggedErrorClass<ProjectReadFileError>()(
  "ProjectReadFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectSkillSource = Schema.Literals(["workspace", "global"]);
export type ProjectSkillSource = typeof ProjectSkillSource.Type;

export const ProjectSkill = Schema.Struct({
  name: ProjectSkillName,
  source: ProjectSkillSource,
  path: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_SKILL_PATH_MAX_LENGTH)),
  description: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROJECT_SKILL_DESCRIPTION_MAX_LENGTH),
  ),
});
export type ProjectSkill = typeof ProjectSkill.Type;

export const ProjectSkillIssue = Schema.Struct({
  path: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_SKILL_PATH_MAX_LENGTH)),
  message: TrimmedNonEmptyString,
});
export type ProjectSkillIssue = typeof ProjectSkillIssue.Type;

export const ProjectListSkillsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type ProjectListSkillsInput = typeof ProjectListSkillsInput.Type;

export const ProjectListSkillsResult = Schema.Struct({
  skills: Schema.Array(ProjectSkill),
  issues: Schema.Array(ProjectSkillIssue),
});
export type ProjectListSkillsResult = typeof ProjectListSkillsResult.Type;

export class ProjectListSkillsError extends Schema.TaggedErrorClass<ProjectListSkillsError>()(
  "ProjectListSkillsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
