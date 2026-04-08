import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileExplorerTree } from "./FileExplorerTree";
import type { FileTreeNode } from "~/lib/buildFileTree";

describe("FileExplorerTree", () => {
  const mockNodes: FileTreeNode[] = [
    {
      kind: "directory",
      name: "src",
      path: "src",
      children: [
        {
          kind: "file",
          name: "index.ts",
          path: "src/index.ts",
        },
        {
          kind: "file",
          name: "utils.ts",
          path: "src/utils.ts",
        },
      ],
    },
    {
      kind: "file",
      name: "README.md",
      path: "README.md",
    },
  ];

  it("renders file and directory rows", () => {
    const onFileClick = vi.fn();
    const onMentionPath = vi.fn();
    const onToggleDirectory = vi.fn();

    render(
      <FileExplorerTree
        nodes={mockNodes}
        resolvedTheme="dark"
        expandedDirectoryPaths={new Set()}
        onFileClick={onFileClick}
        onMentionPath={onMentionPath}
        onToggleDirectory={onToggleDirectory}
      />,
    );

    expect(screen.getByText("src")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
  });

  it("shows plus button on file row hover", async () => {
    const onFileClick = vi.fn();
    const onMentionPath = vi.fn();
    const onToggleDirectory = vi.fn();
    const user = userEvent.setup();

    render(
      <FileExplorerTree
        nodes={mockNodes}
        resolvedTheme="dark"
        expandedDirectoryPaths={new Set()}
        onFileClick={onFileClick}
        onMentionPath={onMentionPath}
        onToggleDirectory={onToggleDirectory}
      />,
    );

    const readmeRow = screen.getByText("README.md").closest(".group");
    expect(readmeRow).toBeTruthy();

    // Find the plus button for README.md
    const readmePlusButton = readmeRow?.querySelector(
      'button[aria-label="Mention README.md in composer"]',
    );
    expect(readmePlusButton).toBeTruthy();
  });

  it("calls onMentionPath when file plus button is clicked", async () => {
    const onFileClick = vi.fn();
    const onMentionPath = vi.fn();
    const onToggleDirectory = vi.fn();
    const user = userEvent.setup();

    render(
      <FileExplorerTree
        nodes={mockNodes}
        resolvedTheme="dark"
        expandedDirectoryPaths={new Set()}
        onFileClick={onFileClick}
        onMentionPath={onMentionPath}
        onToggleDirectory={onToggleDirectory}
      />,
    );

    const readmeRow = screen.getByText("README.md").closest(".group");
    const readmePlusButton = readmeRow?.querySelector<HTMLButtonElement>(
      'button[aria-label="Mention README.md in composer"]',
    );

    if (readmePlusButton) {
      await user.click(readmePlusButton);
    }

    expect(onMentionPath).toHaveBeenCalledWith("README.md");
  });

  it("shows plus button on directory row hover", async () => {
    const onFileClick = vi.fn();
    const onMentionPath = vi.fn();
    const onToggleDirectory = vi.fn();

    render(
      <FileExplorerTree
        nodes={mockNodes}
        resolvedTheme="dark"
        expandedDirectoryPaths={new Set()}
        onFileClick={onFileClick}
        onMentionPath={onMentionPath}
        onToggleDirectory={onToggleDirectory}
      />,
    );

    const srcRow = screen.getByText("src");
    expect(srcRow).toBeInTheDocument();

    // Find the plus button for src directory
    const srcPlusButton = srcRow
      .closest(".group")
      ?.querySelector('button[aria-label="Mention src in composer"]');
    expect(srcPlusButton).toBeTruthy();
  });

  it("calls onMentionPath when directory plus button is clicked", async () => {
    const onFileClick = vi.fn();
    const onMentionPath = vi.fn();
    const onToggleDirectory = vi.fn();
    const user = userEvent.setup();

    render(
      <FileExplorerTree
        nodes={mockNodes}
        resolvedTheme="dark"
        expandedDirectoryPaths={new Set()}
        onFileClick={onFileClick}
        onMentionPath={onMentionPath}
        onToggleDirectory={onToggleDirectory}
      />,
    );

    const srcRow = screen.getByText("src");
    const srcPlusButton = srcRow
      .closest(".group")
      ?.querySelector<HTMLButtonElement>('button[aria-label="Mention src in composer"]');

    if (srcPlusButton) {
      await user.click(srcPlusButton);
    }

    expect(onMentionPath).toHaveBeenCalledWith("src");
  });

  it("does not toggle directory when plus button is clicked", async () => {
    const onFileClick = vi.fn();
    const onMentionPath = vi.fn();
    const onToggleDirectory = vi.fn();
    const user = userEvent.setup();

    render(
      <FileExplorerTree
        nodes={mockNodes}
        resolvedTheme="dark"
        expandedDirectoryPaths={new Set()}
        onFileClick={onFileClick}
        onMentionPath={onMentionPath}
        onToggleDirectory={onToggleDirectory}
      />,
    );

    const srcRow = screen.getByText("src");
    const srcPlusButton = srcRow
      .closest(".group")
      ?.querySelector<HTMLButtonElement>('button[aria-label="Mention src in composer"]');

    if (srcPlusButton) {
      await user.click(srcPlusButton);
    }

    expect(onToggleDirectory).not.toHaveBeenCalled();
  });

  it("toggles directory when directory name is clicked", async () => {
    const onFileClick = vi.fn();
    const onMentionPath = vi.fn();
    const onToggleDirectory = vi.fn();
    const user = userEvent.setup();

    render(
      <FileExplorerTree
        nodes={mockNodes}
        resolvedTheme="dark"
        expandedDirectoryPaths={new Set()}
        onFileClick={onFileClick}
        onMentionPath={onMentionPath}
        onToggleDirectory={onToggleDirectory}
      />,
    );

    const srcButton = screen.getByText("src").closest("button");
    if (srcButton) {
      await user.click(srcButton);
    }

    expect(onToggleDirectory).toHaveBeenCalledWith("src", false);
  });

  it("calls onFileClick when file is clicked", async () => {
    const onFileClick = vi.fn();
    const onMentionPath = vi.fn();
    const onToggleDirectory = vi.fn();
    const user = userEvent.setup();

    render(
      <FileExplorerTree
        nodes={mockNodes}
        resolvedTheme="dark"
        expandedDirectoryPaths={new Set()}
        onFileClick={onFileClick}
        onMentionPath={onMentionPath}
        onToggleDirectory={onToggleDirectory}
      />,
    );

    const readmeButton = screen.getByText("README.md").closest("button");
    if (readmeButton) {
      await user.click(readmeButton);
    }

    expect(onFileClick).toHaveBeenCalledWith("README.md");
  });

  it("expands directory when it has children and is expanded", () => {
    const onFileClick = vi.fn();
    const onMentionPath = vi.fn();
    const onToggleDirectory = vi.fn();

    render(
      <FileExplorerTree
        nodes={mockNodes}
        resolvedTheme="dark"
        expandedDirectoryPaths={new Set(["src"])}
        onFileClick={onFileClick}
        onMentionPath={onMentionPath}
        onToggleDirectory={onToggleDirectory}
      />,
    );

    expect(screen.getByText("index.ts")).toBeInTheDocument();
    expect(screen.getByText("utils.ts")).toBeInTheDocument();
  });
});
