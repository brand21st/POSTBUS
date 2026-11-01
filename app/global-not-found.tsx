import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { siteConfig } from "@/lib/site-config";
import SiteNotFound from "./(site)/not-found";
import "./globals.css";

// The app has two root layouts ((site) and (shopify)), so unmatched URLs render this full document.
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: `Page not found · ${siteConfig.name}`,
  robots: { index: false, follow: true },
};

export default function GlobalNotFound() {
  return (
    <html lang={siteConfig.language} className={`${geistSans.variable} h-full antialiased`}>
      <body className="flex min-h-full min-w-0 flex-col overflow-x-hidden bg-background font-sans text-foreground">
        <SiteNotFound />
      </body>
    </html>
  );
}
