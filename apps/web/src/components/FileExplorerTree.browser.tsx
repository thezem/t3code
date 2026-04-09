import "../index.css";

import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { FileTreeNode } from "~/lib/buildFileTree";
import { FileExplorerTree } from "./FileExplorerTree";

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

async function mountTree(input?: { expandedDirectoryPaths?: ReadonlySet<string> }) {
  const onFileClick = vi.fn();
  const onMentionPath = vi.fn();
  const onToggleDirectory = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(
    <FileExplorerTree
      nodes={mockNodes}
      resolvedTheme="dark"
      expandedDirectoryPaths={input?.expandedDirectoryPaths ?? new Set()}
      onFileClick={onFileClick}
      onMentionPath={onMentionPath}
      onToggleDirectory={onToggleDirectory}
    />,
    { container: host },
  );

  return {
    onFileClick,
    onMentionPath,
    onToggleDirectory,
    cleanup: async () => {
      await screen.unmount();
    },
  };
}

describe("FileExplorerTree", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders file and directory rows", async () => {
    const mounted = await mountTree();

    try {
      await expect.element(page.getByText("src")).toBeInTheDocument();
      await expect.element(page.getByText("README.md")).toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders mention buttons for file and directory rows", async () => {
    const mounted = await mountTree();

    try {
      expect(
        document.querySelector('button[aria-label="Mention README.md in composer"]'),
      ).toBeTruthy();
      expect(document.querySelector('button[aria-label="Mention src in composer"]')).toBeTruthy();
    } finally {
      await mounted.cleanup();
    }
  });

  it("calls onMentionPath when file plus button is clicked", async () => {
    const mounted = await mountTree();

    try {
      const readmePlusButton = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Mention README.md in composer"]',
      );
      expect(readmePlusButton).toBeTruthy();
      readmePlusButton?.click();

      expect(mounted.onMentionPath).toHaveBeenCalledWith("README.md");
    } finally {
      await mounted.cleanup();
    }
  });

  it("calls onMentionPath when directory plus button is clicked", async () => {
    const mounted = await mountTree();

    try {
      const srcPlusButton = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Mention src in composer"]',
      );
      expect(srcPlusButton).toBeTruthy();
      srcPlusButton?.click();

      expect(mounted.onMentionPath).toHaveBeenCalledWith("src");
    } finally {
      await mounted.cleanup();
    }
  });

  it("does not toggle directory when plus button is clicked", async () => {
    const mounted = await mountTree();

    try {
      const srcPlusButton = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Mention src in composer"]',
      );
      expect(srcPlusButton).toBeTruthy();
      srcPlusButton?.click();

      expect(mounted.onToggleDirectory).not.toHaveBeenCalled();
    } finally {
      await mounted.cleanup();
    }
  });

  it("toggles directory when directory name is clicked", async () => {
    const mounted = await mountTree();

    try {
      const srcButton = page.getByRole("button", { name: "src" });
      await srcButton.click();

      expect(mounted.onToggleDirectory).toHaveBeenCalledWith("src", false);
    } finally {
      await mounted.cleanup();
    }
  });

  it("calls onFileClick when file is clicked", async () => {
    const mounted = await mountTree();

    try {
      const readmeButton = page.getByRole("button", { name: "README.md" });
      await readmeButton.click();

      expect(mounted.onFileClick).toHaveBeenCalledWith("README.md");
    } finally {
      await mounted.cleanup();
    }
  });

  it("expands directory when it has children and is expanded", async () => {
    const mounted = await mountTree({ expandedDirectoryPaths: new Set(["src"]) });

    try {
      await expect.element(page.getByText("index.ts")).toBeInTheDocument();
      await expect.element(page.getByText("utils.ts")).toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });
});
