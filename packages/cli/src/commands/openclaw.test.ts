import { describe, expect, it } from "vitest";
import { openclawCommand } from "./openclaw.js";

describe("openclaw command", () => {
  it("registers openclaw memory subcommands", () => {
    const memoryCommand = openclawCommand.commands.find((command) => command.name() === "memory");
    expect(memoryCommand).toBeDefined();
    const names = (memoryCommand?.commands ?? []).map((command) => command.name());
    expect(names).toEqual(expect.arrayContaining(["bootstrap", "flush", "snapshot", "sync"]));
  });
});
