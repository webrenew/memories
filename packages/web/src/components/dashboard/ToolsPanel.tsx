"use client"

import Link from "next/link"
import { ToolLogo } from "../ui/tool-logo"
import { GENERATOR_TOOLS } from "@/lib/tools"

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
        {GENERATOR_TOOLS.map((tool) => (
          <Link
            key={tool.cmd}
            href={tool.docsUrl}
            className="group flex flex-col items-center gap-3 p-4 border border-border bg-card/5 hover:bg-card/20 hover:border-primary/30 transition-all"
          >
            <ToolLogo src={tool.logo} alt={tool.name} size="lg" className="opacity-60 group-hover:opacity-100 transition-opacity" />
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
