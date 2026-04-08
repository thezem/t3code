import { assert, describe, expect, it } from "vitest";

import { getVscodeIconUrlForEntry, inferEntryKindFromPath, basenameOfPath } from "./vscode-icons";

describe("getVscodeIconUrlForEntry", () => {
  it("uses exact filename matches from the vscode-icons manifest", () => {
    const darkUrl = getVscodeIconUrlForEntry("pnpm-workspace.yaml", "file", "dark");
    const lightUrl = getVscodeIconUrlForEntry("pnpm-workspace.yaml", "file", "light");

    assert.isTrue(darkUrl.endsWith("/file_type_pnpm.svg"));
    assert.isTrue(lightUrl.endsWith("/file_type_light_pnpm.svg"));
  });

  it("uses longest extension match for compound extensions", () => {
    const iconUrl = getVscodeIconUrlForEntry("tsconfig.tsbuildinfo", "file", "dark");
    const manifestStyleUrl = getVscodeIconUrlForEntry("buf.yaml", "file", "dark");
    assert.isTrue(iconUrl.endsWith("/file_type_tsbuildinfo.svg"));
    assert.isTrue(manifestStyleUrl.endsWith("/file_type_buf.svg"));
  });

  it("uses folder mappings and light-aware filename mappings", () => {
    const folderUrl = getVscodeIconUrlForEntry("packages/src", "directory", "light");
    const fileUrl = getVscodeIconUrlForEntry("AGENTS.md", "file", "light");

    assert.isTrue(folderUrl.endsWith("/folder_type_src.svg"));
    assert.isTrue(fileUrl.endsWith("/file_type_light_agents.svg"));
  });

  it("falls back to language-based mappings for path-only cases", () => {
    const tsxUrl = getVscodeIconUrlForEntry("checkbox.tsx", "file", "light");
    const dockerfileUrl = getVscodeIconUrlForEntry("Dockerfile", "file", "dark");
    const shellUrl = getVscodeIconUrlForEntry("entrypoint.sh", "file", "dark");
    const htmlUrl = getVscodeIconUrlForEntry("index.html", "file", "dark");
    const cursorRulesUrl = getVscodeIconUrlForEntry("general.mdc", "file", "dark");
    const githubWorkflowUrl = getVscodeIconUrlForEntry(".github/workflows/ci.yml", "file", "light");

    assert.isTrue(tsxUrl.endsWith("/file_type_reactts.svg"));
    assert.isTrue(dockerfileUrl.endsWith("/file_type_docker.svg"));
    assert.isTrue(shellUrl.endsWith("/file_type_shell.svg"));
    assert.isTrue(htmlUrl.endsWith("/file_type_html.svg"));
    assert.isTrue(cursorRulesUrl.endsWith("/file_type_markdown.svg"));
    assert.isTrue(githubWorkflowUrl.endsWith("/file_type_light_yaml.svg"));
  });

  it("falls back to defaults when there is no match", () => {
    const fileUrl = getVscodeIconUrlForEntry("foo.unknown-ext", "file", "dark");
    const folderUrl = getVscodeIconUrlForEntry("totally-unknown-folder", "directory", "dark");

    assert.isTrue(fileUrl.endsWith("/default_file.svg"));
    assert.isTrue(folderUrl.endsWith("/default_folder.svg"));
  });
});

describe("inferEntryKindFromPath", () => {
  it("infers file type for paths with file extensions", () => {
    expect(inferEntryKindFromPath("src/index.ts")).toBe("file");
    expect(inferEntryKindFromPath("README.md")).toBe("file");
    expect(inferEntryKindFromPath("package.json")).toBe("file");
    expect(inferEntryKindFromPath("path/to/file.test.tsx")).toBe("file");
  });

  it("infers directory type for paths without extensions", () => {
    expect(inferEntryKindFromPath("src")).toBe("directory");
    expect(inferEntryKindFromPath("components")).toBe("directory");
    expect(inferEntryKindFromPath("src/components/ui")).toBe("directory");
  });

  it("infers directory type for dotfiles without extension", () => {
    expect(inferEntryKindFromPath(".env")).toBe("directory");
    expect(inferEntryKindFromPath(".config")).toBe("directory");
    expect(inferEntryKindFromPath("path/to/.hidden")).toBe("directory");
  });

  it("infers file type for paths with multiple dots", () => {
    expect(inferEntryKindFromPath(".prettierrc.json")).toBe("file");
    expect(inferEntryKindFromPath(".env.local")).toBe("file");
  });
});

describe("basenameOfPath", () => {
  it("extracts basename from path", () => {
    expect(basenameOfPath("src/index.ts")).toBe("index.ts");
    expect(basenameOfPath("path/to/file.tsx")).toBe("file.tsx");
    expect(basenameOfPath("README.md")).toBe("README.md");
  });

  it("extracts directory name from path", () => {
    expect(basenameOfPath("src")).toBe("src");
    expect(basenameOfPath("src/components")).toBe("components");
    expect(basenameOfPath("path/to/directory")).toBe("directory");
  });

  it("handles root-level paths", () => {
    expect(basenameOfPath("file.txt")).toBe("file.txt");
    expect(basenameOfPath("folder")).toBe("folder");
  });
});
