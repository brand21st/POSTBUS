"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { CoverStudio } from "@/components/dashboard/cover-studio";

export default function CoverStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const search = useSearchParams();
  return <CoverStudio coverId={id} initialType={search.get("type") ?? undefined} initialPreset={search.get("preset") ?? undefined} />;
}
