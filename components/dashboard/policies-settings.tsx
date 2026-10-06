"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/hooks/use-api";
import { useMe } from "@/lib/hooks/use-me";
import { hasPermission } from "@/lib/permissions/rbac";
import {
  DEFAULT_POLICY_KEYWORDS,
  POLICY_BODY_MAX,
  POLICY_TITLES,
  type PolicyKind,
} from "@/modules/vachat/policies";
import type { OrganizationPoliciesSettings } from "@/types/api";
import type { MemberRole } from "@/types/domain";

export const POLICIES_QUERY_KEY = ["settings", "policies"] as const;

type PolicyDraft = {
  body: string;
  keywords: string;
  enabled: boolean;
};

const SECTIONS: Array<{
  kind: PolicyKind;
  description: string;
  bodyKey: keyof OrganizationPoliciesSettings;
  keywordsKey: keyof OrganizationPoliciesSettings;
  enabledKey: keyof OrganizationPoliciesSettings;
}> = [
  {
    kind: "shipping_policy",
    description: "Delivery time, charges, and dispatch rules customers ask about on WhatsApp.",
    bodyKey: "shippingPolicyBody",
    keywordsKey: "shippingPolicyKeywords",
    enabledKey: "shippingPolicyEnabled",
  },
  {
    kind: "contact",
    description: "Support hours and how to reach you. Store phone, email, and address are added when this is empty.",
    bodyKey: "contactBody",
    keywordsKey: "contactKeywords",
    enabledKey: "contactEnabled",
  },
  {
    kind: "returns",
    description: "Return, exchange, refund, and replacement rules.",
    bodyKey: "returnsBody",
    keywordsKey: "returnsKeywords",
    enabledKey: "returnsEnabled",
  },
  {
    kind: "terms",
    description: "Terms and conditions and privacy notes for the WhatsApp assistant.",
    bodyKey: "termsBody",
    keywordsKey: "termsKeywords",
    enabledKey: "termsEnabled",
  },
];

function keywordsToInput(value: string[] | undefined) {
  return (value ?? []).join(", ");
}

export function PoliciesSettings() {
  const queryClient = useQueryClient();
  const me = useMe();
  const canManage = hasPermission((me.data?.role ?? "VIEWER") as MemberRole, "settings.manage");
  const query = useQuery({
    queryKey: POLICIES_QUERY_KEY,
    queryFn: () => api<OrganizationPoliciesSettings>("/api/v1/settings/policies"),
  });
  const [drafts, setDrafts] = useState<Record<PolicyKind, PolicyDraft>>({
    shipping_policy: { body: "", keywords: "", enabled: true },
    contact: { body: "", keywords: "", enabled: true },
    returns: { body: "", keywords: "", enabled: true },
    terms: { body: "", keywords: "", enabled: true },
  });

  useEffect(() => {
    const data = query.data;
    if (!data) return;
    setDrafts({
      shipping_policy: {
        body: data.shippingPolicyBody ?? "",
        keywords: keywordsToInput(data.shippingPolicyKeywords),
        enabled: data.shippingPolicyEnabled !== false,
      },
      contact: {
        body: data.contactBody ?? "",
        keywords: keywordsToInput(data.contactKeywords),
        enabled: data.contactEnabled !== false,
      },
      returns: {
        body: data.returnsBody ?? "",
        keywords: keywordsToInput(data.returnsKeywords),
        enabled: data.returnsEnabled !== false,
      },
      terms: {
        body: data.termsBody ?? "",
        keywords: keywordsToInput(data.termsKeywords),
        enabled: data.termsEnabled !== false,
      },
    });
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api<OrganizationPoliciesSettings>("/api/v1/settings/policies", {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success("Policy saved for the PostBus WhatsApp assistant.");
      queryClient.invalidateQueries({ queryKey: POLICIES_QUERY_KEY });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        These answers are used by the PostBus WhatsApp assistant. Matching is keyword-based (not AI
        search). Order and tracking questions still use live shipment data.
      </p>
      {SECTIONS.map((section) => {
        const draft = drafts[section.kind];
        return (
          <Card key={section.kind}>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>{POLICY_TITLES[section.kind]}</CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor={`${section.kind}-enabled`} className="text-sm">
                  Answer on WhatsApp
                </Label>
                <Switch
                  id={`${section.kind}-enabled`}
                  checked={draft.enabled}
                  disabled={!canManage}
                  onCheckedChange={(checked) =>
                    setDrafts((current) => ({
                      ...current,
                      [section.kind]: { ...current[section.kind], enabled: checked },
                    }))
                  }
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor={`${section.kind}-body`}>Policy text</Label>
                <Textarea
                  id={`${section.kind}-body`}
                  maxLength={POLICY_BODY_MAX}
                  disabled={!canManage}
                  value={draft.body}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [section.kind]: { ...current[section.kind], body: event.target.value },
                    }))
                  }
                />
                <p className="text-xs text-muted">
                  {draft.body.length} / {POLICY_BODY_MAX}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${section.kind}-keywords`}>Extra keywords</Label>
                <Input
                  id={`${section.kind}-keywords`}
                  disabled={!canManage}
                  placeholder="Optional, comma-separated"
                  value={draft.keywords}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [section.kind]: { ...current[section.kind], keywords: event.target.value },
                    }))
                  }
                />
                <p className="text-xs text-muted">
                  Also matches: {DEFAULT_POLICY_KEYWORDS[section.kind].join(", ")}
                </p>
              </div>
              <Button
                disabled={!canManage || mutation.isPending}
                onClick={() =>
                  mutation.mutate({
                    [section.bodyKey]: draft.body,
                    [section.keywordsKey]: draft.keywords,
                    [section.enabledKey]: draft.enabled,
                  })
                }
              >
                Save {POLICY_TITLES[section.kind]}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
