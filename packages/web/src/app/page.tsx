import React from "react"
import { TopNav } from "@/components/TopNav";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { FeaturesGrid } from "@/components/FeaturesGrid";
import { SDKSection } from "@/components/SDKSection";
import { ApiSection } from "@/components/ApiSection";
import { Integrations } from "@/components/Integrations";
import { Pricing } from "@/components/Pricing";
import { FAQ } from "@/components/FAQ";
import { Footer } from "@/components/Footer";

export default function Home(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
      
      <TopNav />
      
      <main className="relative text-[15px] leading-7">
        <Hero />
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
