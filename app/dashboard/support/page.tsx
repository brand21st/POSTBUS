import type { Metadata } from "next";
import { SupportWorkspace } from "@/components/support/support-workspace";

export const metadata: Metadata = {
  title: "Support Center",
};

export default function SupportCenterPage() {
  return <SupportWorkspace />;
}
