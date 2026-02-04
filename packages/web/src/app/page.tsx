import { createClient } from "@/lib/supabase/server"
import { TopNav } from "@/components/TopNav";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { FeaturesGrid } from "@/components/FeaturesGrid";
import { Integrations } from "@/components/Integrations";
import { WhyItMatters } from "@/components/WhyItMatters";
import { Quickstart } from "@/components/Quickstart";
import { Pricing } from "@/components/Pricing";
import { FAQ } from "@/components/FAQ";
import { Footer } from "@/components/Footer";

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30 home-theme dark">
      
      <TopNav user={user} />
      
      <main className="relative">
        <Hero />
        <HowItWorks />
        <WhyItMatters />
        <FeaturesGrid />
        <Integrations />
        <Quickstart />
        <Pricing user={user} />
        <FAQ />
      </main>

      <Footer />
    </div>
  );
}
