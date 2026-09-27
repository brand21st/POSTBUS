"use client";

import { useParams } from "next/navigation";
import { CustomLabelEditor } from "@/components/labels/custom-label-editor";

export default function ShippingLabelEditorPage() {
  const params = useParams<{ id: string }>();
  return <CustomLabelEditor templateId={params.id} />;
}
