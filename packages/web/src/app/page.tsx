import { createClient } from "@/lib/supabase/server"
import { TopNav } from "@/components/TopNav";
import { Hero } from "@/components/Hero";
import { TrustedBy } from "@/components/TrustedBy";
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
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
      <div className="memory-lattice" />
      
      <TopNav user={user} />
      
      <main>
        <Hero />
        <TrustedBy />
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
