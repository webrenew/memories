import React from "react"
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';
import { source } from '@/lib/source';
import Image from 'next/image';

export default function Layout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <RootProvider theme={{ enabled: false }}>
      <DocsLayout
        tree={source.pageTree}
        nav={{
          title: (
            <div className="flex items-center gap-3">
              <Image
                src="/memories.svg"
                alt="memories.sh logo"
                width={32}
                height={32}
                className="w-8 h-8 dark:invert"
              />
              <span
                className="text-sm font-bold tracking-[0.2em] uppercase"
                style={{ fontFamily: 'var(--font-departure-mono), var(--font-geist-mono), monospace' }}
              >
                memories.sh
              </span>
            </div>
          ),
        }}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
