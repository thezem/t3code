import { describe, expect, it, vi } from "vitest";

const { resolvePrimaryEnvironmentBootstrapUrlMock } = vi.hoisted(() => ({
  resolvePrimaryEnvironmentBootstrapUrlMock: vi.fn(() => "http://bootstrap.test:4321"),
}));

vi.mock("../environmentBootstrap", () => ({
  resolvePrimaryEnvironmentBootstrapUrl: resolvePrimaryEnvironmentBootstrapUrlMock,
}));

import { isWindowsPlatform } from "./utils";
import { resolveDesktopBrowserUrl } from "./utils";
import { resolveServerUrl } from "./utils";

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

describe("resolveServerUrl", () => {
  it("falls back to the bootstrap environment URL when the explicit URL is empty", () => {
    expect(resolveServerUrl({ url: "" })).toBe("http://bootstrap.test:4321/");
  });

  it("uses the bootstrap environment URL when no explicit URL is provided", () => {
    expect(resolveServerUrl()).toBe("http://bootstrap.test:4321/");
  });

  it("prefers an explicit URL override", () => {
    expect(
      resolveServerUrl({
        url: "https://override.test:9999",
        protocol: "wss",
        pathname: "/rpc",
        searchParams: { hello: "world" },
      }),
    ).toBe("wss://override.test:9999/rpc?hello=world");
  });

  it("does not evaluate the bootstrap resolver when an explicit URL is provided", () => {
    resolvePrimaryEnvironmentBootstrapUrlMock.mockImplementationOnce(() => {
      throw new Error("bootstrap unavailable");
    });

    expect(resolveServerUrl({ url: "https://override.test:9999" })).toBe(
      "https://override.test:9999/",
    );
  });
});
