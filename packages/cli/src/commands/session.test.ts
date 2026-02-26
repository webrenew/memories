import { describe, it, expect } from "vitest";
import { sessionCommand } from "./session.js";

describe("session command", () => {
  it("registers section 2.2 session subcommands", () => {
    const names = sessionCommand.commands.map((command) => command.name());
    expect(names).toEqual(expect.arrayContaining(["start", "checkpoint", "status", "end", "snapshot"]));
  });
});
