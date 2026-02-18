"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Copy } from "lucide-react";

type CommandStep = {
  id: string;
  title: string;
  command: string;
  hint?: React.ReactNode;
};

const commandSteps: CommandStep[] = [
  {
    id: "install-memories-cli",
    title: "Install memories CLI",
    command: "pnpm add -g @memories.sh/cli",
  },
  {
    id: "onboard-openclaw",
    title: "Initialize OpenClaw workspace",
    command: "openclaw onboard",
    hint: (
      <>
        If this command is missing, install OpenClaw first from{" "}
        <a
          href="https://docs.openclaw.ai/install/index"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:text-primary/80 transition-colors"
        >
          official install docs
        </a>
        .
      </>
    ),
  },
  {
    id: "enter-project",
    title: "Enter your project",
    command: "cd your-project",
  },
  {
    id: "init-memories",
    title: "Initialize memories in project",
    command: "memories init",
  },
  {
    id: "generate-agents",
    title: "Generate OpenClaw AGENTS workspace file",
    command: "memories generate claude -o ~/.openclaw/workspace/AGENTS.md --force",
  },
  {
    id: "generate-skills",
    title: "Generate skills from memories",
    command: "memories generate agents",
  },
  {
    id: "skills-dir",
    title: "Ensure OpenClaw skills directory exists",
    command: "mkdir -p ~/.openclaw/workspace/skills",
  },
  {
    id: "copy-skills",
    title: "Copy generated skills into OpenClaw workspace",
    command: "if [ -d .agents/skills ]; then cp -R .agents/skills/. ~/.openclaw/workspace/skills/; fi",
  },
  {
    id: "ingest-workspace",
    title: "Ingest workspace files (with runtime config)",
    command: "memories files ingest --global --include-config",
  },
  {
    id: "apply-workspace",
    title: "Apply workspace files (force update)",
    command: "memories files apply --global --include-config --force",
  },
];

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function OpenClawSetupCommandSequence(): React.JSX.Element {
  const [copiedStepId, setCopiedStepId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const sequenceScript = useMemo(
    () => commandSteps.map((step) => step.command).join("\n"),
    [],
  );

  const handleStepCopy = async (step: CommandStep) => {
    const ok = await writeClipboard(step.command);
    if (!ok) return;
    setCopiedStepId(step.id);
    setTimeout(() => setCopiedStepId((current) => (current === step.id ? null : current)), 1800);
  };

  const handleCopyAll = async () => {
    const ok = await writeClipboard(sequenceScript);
    if (!ok) return;
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  return (
    <div className="glass-panel p-6 rounded-xl border border-border">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-primary" />
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Recommended Flow (CLI)
          </span>
        </div>

        <button
          type="button"
          onClick={handleCopyAll}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/20 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
        >
          {copiedAll ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
          {copiedAll ? "Copied" : "Copy Full Sequence"}
        </button>
      </div>

      <div className="space-y-2">
        {commandSteps.map((step, index) => {
          const isCopied = copiedStepId === step.id;
          return (
            <div key={step.id} className="rounded-lg border border-border bg-background/55 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    Step {index + 1}: {step.title}
                  </p>
                  <code className="mt-1 block overflow-x-auto whitespace-nowrap text-[12px] text-foreground/90">
                    {step.command}
                  </code>
                </div>

                <button
                  type="button"
                  onClick={() => handleStepCopy(step)}
                  className="mt-0.5 shrink-0 rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
                  aria-label={`Copy ${step.title} command`}
                >
                  {isCopied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
              {step.hint ? <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{step.hint}</p> : null}
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
        Run top to bottom. For deeper setup context, see{" "}
        <Link href="/docs/integrations/openclaw" className="text-primary hover:text-primary/80 transition-colors">
          OpenClaw integration docs
        </Link>
        .
      </p>
    </div>
  );
}
