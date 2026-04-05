import { describe, expect, it } from "vitest";

import { isWindowsPlatform, resolveDesktopBrowserUrl } from "./utils";

describe("isWindowsPlatform", () => {
  it("matches Windows platform identifiers", () => {
    expect(isWindowsPlatform("Win32")).toBe(true);
    expect(isWindowsPlatform("Windows")).toBe(true);
    expect(isWindowsPlatform("windows_nt")).toBe(true);
  });

  it("does not match darwin", () => {
    expect(isWindowsPlatform("darwin")).toBe(false);
  });
});

describe("resolveDesktopBrowserUrl", () => {
  it("converts the desktop websocket url into an http browser url", () => {
    expect(
      resolveDesktopBrowserUrl({
        wsUrl: "ws://127.0.0.1:3773/?token=secret-token",
      }),
    ).toBe("http://127.0.0.1:3773/");
  });

  it("returns null when no websocket url is available", () => {
    expect(resolveDesktopBrowserUrl({ wsUrl: null })).toBe(null);
  });
});
