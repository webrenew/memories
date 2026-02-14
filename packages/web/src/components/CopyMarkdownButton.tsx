"use client";

import React, { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyMarkdownButtonProps {
  slug?: string[];
}

export function CopyMarkdownButton({ slug }: CopyMarkdownButtonProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      // Build the raw MDX URL path
      const path = slug?.length ? slug.join("/") : "index";
      const response = await fetch(`/api/docs/raw?path=${encodeURIComponent(path)}`);
      
      if (!response.ok) {
        throw new Error("Failed to fetch markdown");
      }
      
      const markdown = await response.text();
      await navigator.clipboard.writeText(markdown);
      
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy markdown:", error);
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-accent rounded-md transition-colors"
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 text-emerald-500" />
          <span>Copied!</span>
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" />
          <span>Copy as Markdown</span>
        </>
      )}
    </button>
  );
}
