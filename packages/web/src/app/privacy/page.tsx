import React from "react"
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { TopNav } from "@/components/TopNav";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy policy for memories.sh.",
};

const LAST_UPDATED = "February 13, 2026";

export default function PrivacyPage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />

      <main className="pt-28 pb-20 px-6 lg:px-10">
        <div className="w-full px-6 lg:px-16 xl:px-24">
          <div className="max-w-4xl mx-auto">
            <div className="mb-12">
              <div className="inline-flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="font-mono text-[12px] uppercase tracking-[0.15em] text-muted-foreground">
                  Legal
                </span>
              </div>
              <h1 className="font-mono text-3xl sm:text-5xl tracking-tight mb-4">Privacy Policy</h1>
              <p className="text-muted-foreground">Last updated: {LAST_UPDATED}</p>
            </div>

            <div className="space-y-10 text-sm sm:text-base leading-relaxed text-muted-foreground">
              <section className="space-y-3">
                <h2 className="font-mono text-xl text-foreground">1. Scope</h2>
                <p>
                  This Privacy Policy explains how Webrenew LLC, doing business as memories.sh ("we", "us", "our"),
                  collects, uses, and protects information when you use our website, web dashboard, APIs, CLI, and related services.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="font-mono text-xl text-foreground">2. Information We Collect</h2>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    <span className="text-foreground">Account data:</span> name, email, auth provider identifiers, and account metadata.
                  </li>
                  <li>
                    <span className="text-foreground">Workspace data:</span> memories, rules, notes, skills, tags, and settings you store in the product.
                  </li>
                  <li>
                    <span className="text-foreground">Billing data:</span> subscription and payment metadata from Stripe. Full card details are processed by Stripe, not stored by us.
                  </li>
                  <li>
                    <span className="text-foreground">Integration data:</span> optional data from integrations you enable (for example, GitHub capture events).
                  </li>
                  <li>
                    <span className="text-foreground">Technical and usage data:</span> IP address, device/browser info, request logs, and product telemetry used for reliability and abuse prevention.
                  </li>
                  <li>
                    <span className="text-foreground">Support communications:</span> information you provide when contacting support.
                  </li>
                </ul>
              </section>

              <section className="space-y-3">
                <h2 className="font-mono text-xl text-foreground">3. How We Use Information</h2>
                <ul className="list-disc pl-6 space-y-2">
                  <li>Provide and operate the service.</li>
                  <li>Authenticate users and secure accounts.</li>
                  <li>Process subscriptions and manage billing.</li>
                  <li>Detect abuse, prevent fraud, and enforce rate limits.</li>
                  <li>Improve performance, reliability, and product quality.</li>
                  <li>Respond to support requests and service notifications.</li>
                </ul>
              </section>

              <section className="space-y-3">
                <h2 className="font-mono text-xl text-foreground">4. Sharing and Processors</h2>
                <p>We share data with processors only as needed to operate the service. These include:</p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>Supabase (authentication and account data)</li>
                  <li>Stripe (billing and subscription processing)</li>
                  <li>Turso / libSQL (cloud memory storage and sync)</li>
                  <li>Vercel (hosting, analytics, and performance telemetry)</li>
                  <li>Upstash (rate limiting infrastructure)</li>
                  <li>Resend (transactional email delivery)</li>
                </ul>
                <p>
                  We may also disclose data when required by law, to protect our rights, or in connection with a merger,
                  acquisition, or asset transfer.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="font-mono text-xl text-foreground">5. Data Retention</h2>
                <p>
                  We retain data for as long as your account is active, as needed to provide services, resolve disputes, and
                  comply with legal obligations. You can delete memories and account data using product controls; some records
                  may remain in backups for a limited period.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="font-mono text-xl text-foreground">6. Security</h2>
                <p>
                  We use technical and organizational safeguards designed to protect data. No method of transmission or storage
                  is completely secure, so we cannot guarantee absolute security.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="font-mono text-xl text-foreground">7. Your Choices</h2>
                <ul className="list-disc pl-6 space-y-2">
                  <li>Access, update, or delete account information through the dashboard.</li>
                  <li>Manage billing through Stripe customer portal links in the app.</li>
                  <li>Disable optional integrations you no longer want connected.</li>
                </ul>
              </section>

              <section className="space-y-3">
                <h2 className="font-mono text-xl text-foreground">8. Children</h2>
                <p>
                  memories.sh is not directed to children under 13, and we do not knowingly collect personal information from children.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="font-mono text-xl text-foreground">9. Changes</h2>
                <p>
                  We may update this policy from time to time. We will post updates here and change the "Last updated" date.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="font-mono text-xl text-foreground">10. Contact</h2>
                <p>
                  Questions about this policy:{" "}
                  <a href="mailto:hello@memories.sh" className="underline hover:text-foreground transition-colors">
                    hello@memories.sh
                  </a>
                </p>
                <p>Legal entity: Webrenew LLC (d/b/a memories.sh)</p>
                <p>
                  You can also review our{" "}
                  <Link href="/terms" className="underline hover:text-foreground transition-colors">
                    Terms of Service
                  </Link>
                  .
                </p>
              </section>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
