"use client";

import { useState, useCallback } from "react";
import { Check, Copy, ChevronDown, ArrowDown, ExternalLink } from "lucide-react";
import { CursorIcon } from "@/components/icons/CursorIcon";
import { ClaudeIcon } from "@/components/icons/ClaudeIcon";
import { AnthropicIcon } from "@/components/icons/AnthropicIcon";
import { V0Icon } from "@/components/icons/V0Icon";
import { WindsurfIcon } from "@/components/icons/WindsurfIcon";

// Placeholder that's obviously meant to be replaced
const API_KEY_PLACEHOLDER = "REPLACE_WITH_YOUR_API_KEY";

// SSE endpoint for cloud-based MCP
const SSE_ENDPOINT = "https://memories.sh/api/mcp";

// Cursor deeplink config - SSE URL to cloud server
const CURSOR_DEEPLINK_CONFIG = {
  url: `${SSE_ENDPOINT}?api_key=${API_KEY_PLACEHOLDER}`,
};

// Base64 encode for Cursor deeplink
const CURSOR_CONFIG_BASE64 =
  typeof window !== "undefined"
    ? btoa(JSON.stringify(CURSOR_DEEPLINK_CONFIG))
    : Buffer.from(JSON.stringify(CURSOR_DEEPLINK_CONFIG)).toString("base64");

const CURSOR_INSTALL_URL = `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent("memories")}&config=${CURSOR_CONFIG_BASE64}`;

// Manual config uses direct URL (simpler, no CLI needed)
const CURSOR_MANUAL_CONFIG = `{
  "mcpServers": {
    "memories": {
      "url": "${SSE_ENDPOINT}?api_key=${API_KEY_PLACEHOLDER}"
    }
  }
}`;

const CLAUDE_CODE_COMMAND = `claude mcp add memories --url "https://memories.sh/api/mcp?api_key=${API_KEY_PLACEHOLDER}"`;

interface CopyButtonProps {
  value: string;
  className?: string;
}

function CopyButton({ value, className = "" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  }, [value]);

  return (
    <button
      onClick={handleCopy}
      className={`p-1.5 rounded-md hover:bg-foreground/10 transition-colors ${className}`}
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <Check className="w-4 h-4 text-green-500" />
      ) : (
        <Copy className="w-4 h-4 text-muted-foreground" />
      )}
    </button>
  );
}

export function MCPInstallButtons() {
  const [showCursorConfig, setShowCursorConfig] = useState(false);
  const [showClaudeCodeCommand, setShowClaudeCodeCommand] = useState(false);
  const [copiedSSE, setCopiedSSE] = useState(false);

  const handleCopySSE = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(SSE_ENDPOINT);
      setCopiedSSE(true);
      setTimeout(() => setCopiedSSE(false), 2000);
    } catch (error) {
      console.error("Failed to copy endpoint:", error);
    }
  }, []);

  return (
    <div className="space-y-6 my-8">
      {/* Quick Install Section */}
      <div className="p-6 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
        <h3 className="text-lg font-semibold mb-2">Quick Install</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Add memories.sh to your AI assistant. You&apos;ll need an{" "}
          <a href="/app" className="underline hover:text-foreground">
            API key
          </a>{" "}
          from the dashboard.
        </p>

        {/* Row 1: Primary installs */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Cursor Button */}
          <button
            onClick={() => setShowCursorConfig(!showCursorConfig)}
            className="flex items-center gap-3 p-4 rounded-lg border border-border bg-card hover:bg-accent/50 hover:border-primary/50 transition-all group text-left"
          >
            <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
              <CursorIcon className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">Cursor</div>
              <div className="text-xs text-muted-foreground">Config file</div>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-muted-foreground group-hover:text-primary transition-all ${
                showCursorConfig ? "rotate-180" : ""
              }`}
            />
          </button>

          {/* Claude Code Button */}
          <button
            onClick={() => setShowClaudeCodeCommand(!showClaudeCodeCommand)}
            className="flex items-center gap-3 p-4 rounded-lg border border-border bg-card hover:bg-accent/50 hover:border-orange-500/50 transition-all group text-left"
          >
            <div className="p-2 rounded-lg bg-orange-500/10 group-hover:bg-orange-500/20 transition-colors">
              <ClaudeIcon className="w-5 h-5 text-orange-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">Claude Code</div>
              <div className="text-xs text-muted-foreground">CLI command</div>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-muted-foreground group-hover:text-orange-500 transition-all ${
                showClaudeCodeCommand ? "rotate-180" : ""
              }`}
            />
          </button>
        </div>

        {/* Cursor Config (Expandable) */}
        {showCursorConfig && (
          <div className="mt-4 p-4 rounded-lg border border-border bg-muted/40">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-mono text-muted-foreground">
                Add to <code className="bg-muted px-1 rounded">.cursor/mcp.json</code>:
              </span>
              <CopyButton value={CURSOR_MANUAL_CONFIG} />
            </div>
            <pre className="text-sm font-mono text-foreground/80 overflow-x-auto whitespace-pre-wrap">
              {CURSOR_MANUAL_CONFIG}
            </pre>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                <strong>Replace</strong> <code className="bg-muted px-1 rounded">{API_KEY_PLACEHOLDER}</code> with your{" "}
                <a href="/app/settings" className="underline hover:text-foreground">API key</a>.
              </p>
              <a
                href={CURSOR_INSTALL_URL}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                One-click install
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        )}

        {/* Claude Code Command (Expandable) */}
        {showClaudeCodeCommand && (
          <div className="mt-4 p-4 rounded-lg border border-border bg-muted/40">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-mono text-muted-foreground">Run in terminal:</span>
              <CopyButton value={CLAUDE_CODE_COMMAND} />
            </div>
            <pre className="text-sm font-mono text-foreground/80 overflow-x-auto whitespace-pre-wrap break-all">
              {CLAUDE_CODE_COMMAND}
            </pre>
            <p className="text-xs text-muted-foreground mt-2">
              <strong>Replace</strong> <code className="bg-muted px-1 rounded">{API_KEY_PLACEHOLDER}</code> with your key from
              the dashboard.
            </p>
          </div>
        )}

        {/* Row 2: Secondary installs */}
        <div className="grid gap-4 sm:grid-cols-2 mt-4">
          {/* Claude Desktop Button */}
          <a
            href="#claude-desktop"
            className="flex items-center gap-3 p-4 rounded-lg border border-border bg-card hover:bg-accent/50 hover:border-amber-600/50 transition-all group no-underline"
          >
            <div className="p-2 rounded-lg bg-amber-600/10 group-hover:bg-amber-600/20 transition-colors">
              <AnthropicIcon className="w-5 h-5 text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">Claude Desktop</div>
              <div className="text-xs text-muted-foreground">Config file</div>
            </div>
            <ArrowDown className="w-4 h-4 text-muted-foreground group-hover:text-amber-600 transition-colors" />
          </a>

          {/* v0 Button - Copy SSE endpoint */}
          <button
            onClick={handleCopySSE}
            className="flex items-center gap-3 p-4 rounded-lg border border-border bg-card hover:bg-accent/50 hover:border-foreground/30 transition-all group text-left"
          >
            <div className="p-2 rounded-lg bg-foreground/5 group-hover:bg-foreground/10 transition-colors">
              <V0Icon className="w-5 h-5 text-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">v0 / Web Tools</div>
              <div className="text-xs text-muted-foreground">
                {copiedSSE ? "Copied!" : "Copy endpoint URL"}
              </div>
            </div>
            {copiedSSE ? (
              <Check className="w-4 h-4 text-green-500 transition-colors" />
            ) : (
              <Copy className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            )}
          </button>
        </div>

        {/* Row 3: More tools */}
        <div className="grid gap-4 sm:grid-cols-2 mt-4">
          {/* Windsurf */}
          <a
            href="#windsurf"
            className="flex items-center gap-3 p-4 rounded-lg border border-border bg-card hover:bg-accent/50 hover:border-cyan-500/50 transition-all group no-underline"
          >
            <div className="p-2 rounded-lg bg-cyan-500/10 group-hover:bg-cyan-500/20 transition-colors">
              <WindsurfIcon className="w-5 h-5 text-cyan-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">Windsurf</div>
              <div className="text-xs text-muted-foreground">Config file</div>
            </div>
            <ArrowDown className="w-4 h-4 text-muted-foreground group-hover:text-cyan-500 transition-colors" />
          </a>

          {/* VS Code */}
          <a
            href="#vscode"
            className="flex items-center gap-3 p-4 rounded-lg border border-border bg-card hover:bg-accent/50 hover:border-blue-500/50 transition-all group no-underline"
          >
            <div className="p-2 rounded-lg bg-blue-500/10 group-hover:bg-blue-500/20 transition-colors">
              <svg className="w-5 h-5 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
                <path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">VS Code</div>
              <div className="text-xs text-muted-foreground">Config file</div>
            </div>
            <ArrowDown className="w-4 h-4 text-muted-foreground group-hover:text-blue-500 transition-colors" />
          </a>
        </div>
      </div>

      {/* Manual Setup Links */}
      <div className="flex flex-wrap gap-4 text-sm">
        <span className="text-muted-foreground">Jump to:</span>
        <a
          href="#cursor"
          className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5 no-underline"
        >
          <CursorIcon className="w-4 h-4" />
          Cursor
        </a>
        <a
          href="#claude-code"
          className="text-muted-foreground hover:text-orange-500 transition-colors flex items-center gap-1.5 no-underline"
        >
          <ClaudeIcon className="w-4 h-4" />
          Claude Code
        </a>
        <a
          href="#claude-desktop"
          className="text-muted-foreground hover:text-amber-600 transition-colors flex items-center gap-1.5 no-underline"
        >
          <AnthropicIcon className="w-4 h-4" />
          Claude Desktop
        </a>
        <a
          href="#windsurf"
          className="text-muted-foreground hover:text-cyan-500 transition-colors flex items-center gap-1.5 no-underline"
        >
          <WindsurfIcon className="w-4 h-4" />
          Windsurf
        </a>
      </div>
    </div>
  );
}
