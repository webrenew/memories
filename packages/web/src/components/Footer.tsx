"use client";

import Link from "next/link";
import Image from "next/image";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { StatusIndicator } from "./StatusIndicator";

export function Footer() {
  return (
    <footer className="py-24 px-6 lg:px-10 border-t border-white/10 bg-background">
      <div className="w-full px-6 lg:px-16 xl:px-24">
        <div className="flex flex-col md:flex-row items-start justify-between gap-16 mb-24">
            <div>
              <div className="flex items-center gap-3 mb-8 group">
                <Image src="/memories.svg" alt="memories.sh logo" width={20} height={20} className="w-5 h-5 dark:invert group-hover:rotate-12 transition-transform duration-500" />
                <span className="font-mono text-lg font-bold tracking-tighter uppercase text-foreground">memories.sh</span>
              </div>
            <p className="max-w-xs text-[12px] text-muted-foreground/70 leading-relaxed font-light">
              One memory store for all your AI coding tools.
            </p>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-16 md:gap-24">
            <div className="flex flex-col gap-6">
              <h5 className="font-mono text-[10px] sm:text-xs uppercase tracking-wider text-white/50">Product</h5>
              <div className="flex flex-col gap-4 text-[11px] font-bold text-muted-foreground/60 uppercase tracking-[0.15em]">
                <Link href="/docs" className="hover:text-primary transition-colors">Documentation</Link>
                <Link href="/docs/cli" className="hover:text-primary transition-colors">CLI Reference</Link>
                <Link href="/docs/mcp-server" className="hover:text-primary transition-colors">MCP Server</Link>
                <Link href="/llms.txt" className="hover:text-primary transition-colors">llms.txt</Link>
              </div>
            </div>
            <div className="flex flex-col gap-6">
              <h5 className="font-mono text-[10px] sm:text-xs uppercase tracking-wider text-white/50">Network</h5>
              <div className="flex flex-col gap-4 text-[11px] font-bold text-muted-foreground/60 uppercase tracking-[0.15em]">
                <a href="https://discord.gg/2K7rhuwc" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">Discord</a>
                <a href="https://x.com/WebRenew_" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">X (Twitter)</a>
              </div>
            </div>
            <div className="flex flex-col gap-6">
              <h5 className="font-mono text-[10px] sm:text-xs uppercase tracking-wider text-white/50">Legal</h5>
              <div className="flex flex-col gap-4 text-[11px] font-bold text-muted-foreground/60 uppercase tracking-[0.15em]">
                <a href="https://www.webrenew.com/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">Privacy</a>
                <a href="https://www.webrenew.com/terms" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">Terms</a>
              </div>
            </div>
          </div>
        </div>
        
        <div className="pt-12 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-8">
          <a 
            href="https://webrenew.com?utm_source=memories.sh&utm_medium=footer&utm_campaign=copyright" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-[9px] text-muted-foreground/40 uppercase tracking-[0.2em] font-bold hover:text-muted-foreground transition-colors"
          >
            © 2026 Webrenew
          </a>
          <div className="flex items-center gap-8">
            <ThemeSwitcher />
            <StatusIndicator />
          </div>
        </div>
      </div>
    </footer>
  );
}
