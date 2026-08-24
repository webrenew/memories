import { describe, it, expect } from "vitest";
import { MCP_SERVER_INSTRUCTIONS, withStorageWarnings } from "./index.js";
import type { StorageWarning } from "../lib/storage-health.js";

const softDeletedWarning: StorageWarning = {
  code: "SOFT_DELETED_BACKLOG",
  message: "700 soft-deleted memories pending vacuum (78% of total records).",
  remediation: ["Run: memories doctor --fix"],
};

describe("withStorageWarnings", () => {
  it("appends storage warning block to successful text responses", async () => {
    const result = await withStorageWarnings(
      {
        content: [{ type: "text", text: "Stored memory abc123" }],
      },
      [softDeletedWarning]
    );

    expect(result.content[0].text).toContain("Stored memory abc123");
    expect(result.content[0].text).toContain("Storage warning:");
    expect(result.content[0].text).toContain("soft-deleted memories pending vacuum");
  });

  it("does not append warnings for error responses", async () => {
    const result = await withStorageWarnings(
      {
        content: [{ type: "text", text: "Failed to add memory" }],
        isError: true,
      },
      [softDeletedWarning]
    );

    expect(result.content[0].text).toBe("Failed to add memory");
  });

  it("returns unchanged payload when content is empty", async () => {
    const payload = {
      content: [],
    };
    const result = await withStorageWarnings(payload, [softDeletedWarning]);
    expect(result).toEqual(payload);
  });
});

describe("MCP server instructions", () => {
  it("asks clients to keep durable project memories current through upserts", () => {
    expect(MCP_SERVER_INSTRUCTIONS).toContain("stable upsert_key");
    expect(MCP_SERVER_INSTRUCTIONS).toContain("Before finishing a task");
    expect(MCP_SERVER_INSTRUCTIONS).toContain("Never store secrets");
  });
});
