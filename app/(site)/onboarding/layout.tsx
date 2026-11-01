import type { ReactNode } from "react";
import type { Metadata } from "next";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = {
  ...noIndexMetadata,
  title: "Account setup",
};

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return children;
}
