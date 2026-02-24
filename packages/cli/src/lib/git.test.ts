import { describe, expect, it } from "vitest";
import { normalizeGitUrl } from "./git.js";

describe("normalizeGitUrl", () => {
  it("normalizes common git remote URL formats", () => {
    const samples: Array<[string, string]> = [
      ["git@github.com:webrenew/memories.git", "github.com/webrenew/memories"],
      ["https://github.com/webrenew/memories.git", "github.com/webrenew/memories"],
      ["https://github.com/webrenew/memories/", "github.com/webrenew/memories"],
      ["ssh://git@github.com/webrenew/memories.git", "github.com/webrenew/memories"],
      ["git+ssh://git@github.com/webrenew/memories.git", "github.com/webrenew/memories"],
      ["git://github.com/webrenew/memories.git", "github.com/webrenew/memories"],
      ["git@github.com:webrenew/memories.git/", "github.com/webrenew/memories"],
    ];

    for (const [input, expected] of samples) {
      expect(normalizeGitUrl(input)).toBe(expected);
    }
  });

  it("returns unknown remotes in trimmed form", () => {
    expect(normalizeGitUrl("  custom-remote-format  ")).toBe("custom-remote-format");
  });
});
