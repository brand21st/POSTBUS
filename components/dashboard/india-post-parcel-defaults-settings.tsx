"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/hooks/use-api";
import { INDIA_POST_QUERY_KEY, useIndiaPost } from "@/lib/hooks/use-india-post";
import { useMe } from "@/lib/hooks/use-me";
import { hasPermission } from "@/lib/permissions/rbac";
import type { IndiaPostConfig } from "@/types/api";
import type { MemberRole } from "@/types/domain";

function asInput(value?: number | null) {
  return value != null && Number(value) > 0 ? String(value) : "";
}

export function IndiaPostParcelDefaultsSettings() {
  const queryClient = useQueryClient();
  const me = useMe();
  const indiaPost = useIndiaPost();
  const canManage = hasPermission((me.data?.role ?? "VIEWER") as MemberRole, "org.manage");
  const [lengthCm, setLengthCm] = useState("");
  const [widthCm, setWidthCm] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightGrams, setWeightGrams] = useState("");

  useEffect(() => {
    const data = indiaPost.data;
    if (!data) return;
    setLengthCm(asInput(data.defaultLengthCm ?? data.default_length_cm));
    setWidthCm(asInput(data.defaultWidthCm ?? data.default_width_cm));
    setHeightCm(asInput(data.defaultHeightCm ?? data.default_height_cm));
    setWeightGrams(asInput(data.defaultWeightGrams ?? data.default_weight_grams));
  }, [indiaPost.data]);

  const mutation = useMutation({
    mutationFn: () =>
      api<IndiaPostConfig>("/api/v1/integrations/india-post/parcel-defaults", {
        method: "PATCH",
        body: JSON.stringify({
          lengthCm: lengthCm.trim() || null,
          widthCm: widthCm.trim() || null,
          heightCm: heightCm.trim() || null,
          weightGrams: weightGrams.trim() || null,
        }),
      }),
    onSuccess: () => {
      toast.success("India Post default size and weight saved.");
      queryClient.invalidateQueries({ queryKey: INDIA_POST_QUERY_KEY });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>India Post defaults</CardTitle>
        <CardDescription>
          Used when an order has no parcel size or weight. You can still ship; India Post booking fills
          empty fields from these values (or 14 × 9 × 1 cm and 100 g if you leave them blank).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="default-length">Length (cm)</Label>
            <Input
              id="default-length"
              type="number"
              min={14}
              max={150}
              step="0.1"
              placeholder="14"
              disabled={!canManage}
              value={lengthCm}
              onChange={(event) => setLengthCm(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="default-width">Width (cm)</Label>
            <Input
              id="default-width"
              type="number"
              min={9}
              max={150}
              step="0.1"
              placeholder="9"
              disabled={!canManage}
              value={widthCm}
              onChange={(event) => setWidthCm(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="default-height">Height (cm)</Label>
            <Input
              id="default-height"
              type="number"
              min={1}
              max={150}
              step="0.1"
              placeholder="1"
              disabled={!canManage}
              value={heightCm}
              onChange={(event) => setHeightCm(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="default-weight">Weight (g)</Label>
            <Input
              id="default-weight"
              type="number"
              min={1}
              max={35000}
              placeholder="100"
              disabled={!canManage}
              value={weightGrams}
              onChange={(event) => setWeightGrams(event.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-muted">
          Limits: length 14–150 cm, width 9–150 cm, height 1–150 cm, weight 1–35,000 g.{" "}
          <Link href="/dashboard/integrations/india-post" className="text-brand underline-offset-2 hover:underline">
            India Post connection
          </Link>
        </p>
        {canManage ? (
          <Button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Saving…" : "Save defaults"}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
