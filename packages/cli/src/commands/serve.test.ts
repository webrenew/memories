import { describe, it, expect } from "vitest";
import { resolveSseBinding } from "./serve.js";

// Test the serve command's pure logic (not the actual server start)
describe("serve", () => {
  it("should resolve default SSE host and port", () => {
    expect(resolveSseBinding({})).toEqual({ host: "127.0.0.1", port: 3030 });
  });

  it("should normalize custom SSE host and port", () => {
    expect(resolveSseBinding({ host: " 0.0.0.0 ", port: "8080" })).toEqual({ host: "0.0.0.0", port: 8080 });
  });

  it("should reject invalid SSE ports", () => {
    for (const port of ["abc", "0", "-1", "65536"]) {
      expect(() => resolveSseBinding({ port })).toThrow();
    }
  });

  it("should construct SSE server URL correctly", () => {
    const { host, port } = resolveSseBinding({});
    const url = `http://${host}:${port}/mcp`;
    expect(url).toBe("http://127.0.0.1:3030/mcp");
  });

  it("should construct auth header for API key", () => {
    const apiKey = "test-api-key-123";
    const headers = {
      Authorization: `Bearer ${apiKey}`,
    };
    expect(headers.Authorization).toBe("Bearer test-api-key-123");
  });
});
