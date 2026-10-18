import { notFound } from "next/navigation";
import { MultiPrintScreen } from "@/components/labels/multi-print-screen";
import { multiUpPrintEnabled } from "@/modules/labels/multi-up/flag";

export default function MultiPrintPage() {
  if (!multiUpPrintEnabled()) notFound();
  return <MultiPrintScreen />;
}
