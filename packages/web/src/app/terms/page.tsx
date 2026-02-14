import React from "react"
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { TopNav } from "@/components/TopNav";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms of Service for memories.sh.",
};

const LAST_UPDATED = "February 13, 2026";

export default function TermsPage(): React.JSX.Element {
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
              <h1 className="font-mono text-3xl sm:text-5xl tracking-tight mb-4">Terms of Service</h1>
              <p className="text-muted-foreground">Last updated: {LAST_UPDATED}</p>
            </div>

            <div className="space-y-10 text-sm sm:text-base leading-relaxed text-muted-foreground">
              <section className="space-y-3">
                <h2 className="font-mono text-xl text-foreground">1. Agreement</h2>
                <p>
                  These Terms of Service are a legal agreement between you and Webrenew LLC, doing business as memories.sh.
                  By accessing or using memories.sh, you agree to these Terms of Service. If you do not agree, do not use the service.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="font-mono text-xl text-foreground">2. Accounts and Eligibility</h2>
                <p>
                  You are responsible for your account credentials and all activity under your account. You must provide
                  accurate information and keep it current.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="font-mono text-xl text-foreground">3. Service Use</h2>
                <p>
                  memories.sh provides memory and configuration tooling for coding agents and AI applications, including CLI,
                  web dashboard, APIs, and integrations.
                </p>
                <p>You agree not to:</p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>Use the service in violation of applicable law.</li>
                  <li>Interfere with or disrupt service integrity or security.</li>
                  <li>Attempt unauthorized access to accounts, systems, or data.</li>
                  <li>Abuse rate limits, exploit vulnerabilities, or reverse engineer restricted components.</li>
                </ul>
              </section>

              <section className="space-y-3">
                <h2 className="font-mono text-xl text-foreground">4. Customer Content</h2>
                <p>
                  You retain ownership of content you submit (for example, memories, rules, notes, and related metadata). You
                  grant us a limited license to host, process, and transmit your content solely to provide and improve the service.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="font-mono text-xl text-foreground">5. Paid Plans and Billing</h2>
                <p>
                  Paid features are billed as subscriptions through Stripe. Pricing and plan features may change over time.
                  You may cancel according to your plan terms; cancellation applies to future billing periods unless stated otherwise.
                </p>
                <p>
                  You authorize us and our payment processor to charge the selected payment method for recurring fees, taxes, and
                  applicable charges.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="font-mono text-xl text-foreground">6. Third-Party Services</h2>
                <p>
                  The service relies on third-party providers and integrations (such as auth, hosting, payments, and storage).
                  Use of third-party services may be subject to their own terms and policies.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="font-mono text-xl text-foreground">7. Suspension and Termination</h2>
                <p>
                  We may suspend or terminate access if we reasonably believe you violated these Terms, created security risk,
                  or used the service abusively. You may stop using the service at any time.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="font-mono text-xl text-foreground">8. Intellectual Property</h2>
                <p>
                  Except for your content and open-source components under their own licenses, the service and related materials
                  are owned by Webrenew LLC and protected by applicable intellectual property laws.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="font-mono text-xl text-foreground">9. Disclaimers</h2>
                <p>
                  The service is provided "as is" and "as available" without warranties of any kind, whether express or implied,
                  including warranties of merchantability, fitness for a particular purpose, and non-infringement.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="font-mono text-xl text-foreground">10. Limitation of Liability</h2>
                <p>
                  To the maximum extent permitted by law, Webrenew LLC will not be liable for indirect, incidental, special,
                  consequential, or punitive damages, or for loss of profits, data, or goodwill arising from or related to
                  your use of the service.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="font-mono text-xl text-foreground">11. Changes to Terms</h2>
                <p>
                  We may update these Terms from time to time. Continued use of the service after updates become effective
                  means you accept the revised Terms.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="font-mono text-xl text-foreground">12. Contact</h2>
                <p>
                  Questions about these terms:{" "}
                  <a href="mailto:hello@memories.sh" className="underline hover:text-foreground transition-colors">
                    hello@memories.sh
                  </a>
                </p>
                <p>Legal entity: Webrenew LLC (d/b/a memories.sh)</p>
                <p>
                  For data handling details, see our{" "}
                  <Link href="/privacy" className="underline hover:text-foreground transition-colors">
                    Privacy Policy
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
