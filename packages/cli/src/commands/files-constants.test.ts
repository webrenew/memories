import { describe, expect, it } from "vitest";
import {
  joinSyncedPath,
  listOptionalConfigPaths,
  normalizeSyncedPath,
  OPTIONAL_CONFIG_INTEGRATIONS,
} from "./files-constants.js";

describe("files-constants path normalization", () => {
  it("normalizes windows separators and relative prefixes", () => {
    expect(normalizeSyncedPath(".\\.openclaw\\openclaw.json")).toBe(".openclaw/openclaw.json");
    expect(normalizeSyncedPath("./.config/opencode/opencode.json")).toBe(".config/opencode/opencode.json");
  });

  it("joins synced path keys in canonical POSIX format", () => {
    expect(joinSyncedPath(".config/opencode", "opencode.json")).toBe(".config/opencode/opencode.json");
    expect(joinSyncedPath(".openclaw", "openclaw.json")).toBe(".openclaw/openclaw.json");
  });

  it("keeps optional config keys compatible with normalized paths", () => {
    const paths = listOptionalConfigPaths();
    expect(paths).toContain(".config/opencode/opencode.json");
    expect(paths).toContain(".openclaw/openclaw.json");
    expect(paths.every((path) => !path.includes("\\"))).toBe(true);

    expect(OPTIONAL_CONFIG_INTEGRATIONS.get(".config/opencode/opencode.json")).toBe("opencode");
    expect(OPTIONAL_CONFIG_INTEGRATIONS.get(".openclaw/openclaw.json")).toBe("openclaw");
  });
});
