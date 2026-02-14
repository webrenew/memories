import React from "react"
import Link from "next/link"
import Image from "next/image"
import { OAuthButtons } from "./oauth-buttons"

export const metadata = {
  title: "Sign In or Sign Up",
}

export default function LoginPage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-6 relative overflow-hidden">
      {/* Background texture */}
      <div
        className="absolute inset-0 opacity-15 dark:opacity-25 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url(/bg-texture_memories.webp)" }}
      />
      {/* Diamond gradient overlay — opaque center, transparent at corners */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, transparent 0%, transparent 5%, var(--background) 25%, var(--background) 75%, transparent 95%, transparent 100%)",
        }}
      />

      <div className="w-full max-w-sm relative z-10">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 justify-center mb-12 group">
          <Image
            src="/memories.svg"
            alt="memories.sh logo"
            width={32}
            height={32}
            className="w-8 h-8 dark:invert group-hover:scale-110 transition-transform duration-500"
          />
          <span className="font-mono text-sm font-bold tracking-tighter uppercase text-foreground">
            memories.sh
          </span>
        </Link>

        {/* Card */}
        <div className="border border-border bg-card/20 p-8 rounded-md">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold tracking-tight mb-2">Sign in or create account</h1>
            <p className="text-sm text-muted-foreground italic">
              Access your memory dashboard
            </p>
          </div>

          <OAuthButtons />

          <p className="text-xs text-muted-foreground text-center mt-8 leading-relaxed">
            By continuing, you agree to our{" "}
            <Link href="/terms" className="underline hover:text-foreground transition-colors">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline hover:text-foreground transition-colors">
              Privacy Policy
            </Link>
            .
          </p>
        </div>

        <div className="text-center mt-6">
          <Link
            href="/"
            className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  )
}
