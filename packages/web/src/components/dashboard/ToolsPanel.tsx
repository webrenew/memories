"use client"

import Image from "next/image"
import Link from "next/link"

const TOOLS = [
  { name: "Cursor", logo: "/logos/cursor.svg", cmd: "cursor", file: ".cursor/rules/memories.mdc" },
  { name: "Claude", logo: "/logos/claude-code.svg", cmd: "claude", file: "CLAUDE.md" },
  { name: "Copilot", logo: "/logos/copilot.svg", cmd: "copilot", file: ".github/copilot-instructions.md" },
  { name: "Windsurf", logo: "/logos/windsurf.svg", cmd: "windsurf", file: ".windsurf/rules/memories.md" },
  { name: "Gemini", logo: "/logos/gemini.svg", cmd: "gemini", file: "GEMINI.md" },
]

export function ToolsPanel({ ruleCount }: { ruleCount: number }) {
  return (
    <div className="border border-border bg-card/10 p-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Generate for Your Tools</h2>
          <p className="text-xs text-muted-foreground mt-1">
            One command syncs your rules to any AI coding tool
          </p>
        </div>
        {ruleCount > 0 && (
          <div className="text-right">
            <code className="text-xs bg-primary/10 text-primary px-3 py-1.5 font-mono border border-primary/20">
              memories generate all
            </code>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {TOOLS.map((tool) => (
          <Link
            key={tool.cmd}
            href={`/docs/integrations/${tool.cmd === "claude" ? "claude-code" : tool.cmd}`}
            className="group flex flex-col items-center gap-3 p-4 border border-border bg-card/5 hover:bg-card/20 hover:border-primary/30 transition-all"
          >
            <Image
              src={tool.logo}
              alt={tool.name}
              width={32}
              height={32}
              className="opacity-60 group-hover:opacity-100 transition-opacity"
            />
            <div className="text-center">
              <p className="text-xs font-bold">{tool.name}</p>
              <p className="text-[9px] text-muted-foreground font-mono truncate max-w-[100px]">
                {tool.file.split("/").pop()}
              </p>
            </div>
          </Link>
        ))}
      </div>

      {ruleCount === 0 && (
        <div className="mt-6 pt-6 border-t border-border">
          <p className="text-xs text-muted-foreground text-center">
            Add rules via CLI, then generate files for your tools
          </p>
        </div>
      )}
    </div>
  )
}
