import dynamic from "next/dynamic";
import { TopNav } from "@/components/TopNav";
import { Hero } from "@/components/Hero";
import { MemorySegmentationSection } from "@/components/MemorySegmentationSection";
import { FeaturesGrid } from "@/components/FeaturesGrid";
import { SDKSection } from "@/components/SDKSection";
import { Integrations } from "@/components/Integrations";
import type { ReactNode } from "react";

const HowItWorks = dynamic(
  () => import("@/components/HowItWorks").then((mod) => mod.HowItWorks),
  { loading: () => <SectionPlaceholder minHeightClassName="min-h-[640px]" /> },
);
const ApiSection = dynamic(
  () => import("@/components/ApiSection").then((mod) => mod.ApiSection),
  { loading: () => <SectionPlaceholder minHeightClassName="min-h-[620px]" /> },
);
const Pricing = dynamic(
  () => import("@/components/Pricing").then((mod) => mod.Pricing),
  { loading: () => <SectionPlaceholder minHeightClassName="min-h-[680px]" /> },
);
const FAQ = dynamic(
  () => import("@/components/FAQ").then((mod) => mod.FAQ),
  { loading: () => <SectionPlaceholder minHeightClassName="min-h-[540px]" /> },
);
const Footer = dynamic(
  () => import("@/components/Footer").then((mod) => mod.Footer),
  { loading: () => <FooterPlaceholder /> },
);

function SectionPlaceholder({ minHeightClassName }: { minHeightClassName: string }): ReactNode {
  return (
    <section
      className={`w-full px-6 lg:px-16 xl:px-24 border-t border-border ${minHeightClassName}`}
      aria-hidden="true"
    >
      <div className="mx-auto h-full max-w-6xl py-16">
        <div className="h-7 w-48 rounded-md bg-foreground/10 animate-pulse" />
        <div className="mt-6 h-4 w-full max-w-3xl rounded-md bg-foreground/10 animate-pulse" />
        <div className="mt-3 h-4 w-full max-w-2xl rounded-md bg-foreground/10 animate-pulse" />
      </div>
    </section>
  );
}

function FooterPlaceholder(): ReactNode {
  return (
    <footer className="border-t border-border px-6 lg:px-16 xl:px-24 py-12" aria-hidden="true">
      <div className="mx-auto h-6 w-56 rounded-md bg-foreground/10 animate-pulse" />
    </footer>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
      
      <TopNav />
      
      <main className="relative text-[15px] leading-7">
        <Hero />
        <MemorySegmentationSection />
        <HowItWorks />
        <FeaturesGrid />
        <SDKSection />
        <ApiSection />
        <Integrations />
        <Pricing />
        <FAQ />
      </main>

      <Footer />
    </div>
  );
}
