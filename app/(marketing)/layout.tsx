import type { ReactNode } from "react";
import { ClarityScript } from "@/components/analytics/clarity-script";
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { WhatsappSupportButton } from "@/components/layout/whatsapp-support-button";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {process.env.NEXT_PUBLIC_ENABLE_CLARITY === "true" ? <ClarityScript /> : null}
      <Navbar />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <Footer />
      <WhatsappSupportButton />
    </>
  );
}
