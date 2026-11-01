"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VachatSignupLink } from "@/components/integrations/vachat-signup-link";
import { api } from "@/lib/hooks/use-api";

const VACHAT_BASE_URL = "https://cloud.vachat.in";

type VachatConfig = {
  status?: string;
  apiBaseUrl?: string;
  api_base_url?: string;
  hasApiKey?: boolean;
  has_api_key?: boolean;
  lastVerifiedAt?: string | null;
  last_verified_at?: string | null;
  lastError?: string | null;
  last_error?: string | null;
};

export default function VachatIntegrationPage() {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const query = useQuery({
    queryKey: ["vachat"],
    queryFn: () => api<VachatConfig>("/api/v1/integrations/vachat"),
  });
  const config = query.data;
  const hasKey = Boolean(config?.hasApiKey ?? config?.has_api_key);
  const baseUrl = config?.apiBaseUrl || config?.api_base_url || VACHAT_BASE_URL;

  const save = useMutation({
    mutationFn: () => {
      if (!hasKey && !apiKey.trim()) throw new Error("Paste a Vachat API key (wacrm_live_…).");
      return api<VachatConfig>("/api/v1/integrations/vachat", {
        method: "POST",
        body: JSON.stringify({
          apiKey: apiKey.trim() || undefined,
          apiBaseUrl: baseUrl,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Vachat connected. Keys are stored encrypted.");
      setApiKey("");
      queryClient.invalidateQueries({ queryKey: ["vachat"] });
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const test = useMutation({
    mutationFn: () => api("/api/v1/integrations/vachat/test", { method: "POST" }),
    onSuccess: () => {
      toast.success("Vachat API key verified (GET /api/v1/me). No WhatsApp was sent.");
      queryClient.invalidateQueries({ queryKey: ["vachat"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const disconnect = useMutation({
    mutationFn: () => api("/api/v1/integrations/vachat", { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Vachat disconnected.");
      queryClient.invalidateQueries({ queryKey: ["vachat"] });
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const sendTest = useMutation({
    mutationFn: () => {
      if (!testPhone.trim()) throw new Error("Enter your WhatsApp number.");
      return api<{ sent: boolean; to: string; event: string }>("/api/v1/integrations/vachat/send-test", {
        method: "POST",
        body: JSON.stringify({ phone: testPhone }),
      });
    },
    onSuccess: (result) => {
      toast.success(`Booked test WhatsApp sent to ${result.to}.`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vachat"
        description="Direct VaChat for this workspace. When connected, PostBus WhatsApp Notifications are paused."
        actions={<StatusBadge value={config?.status ?? "NOT_CONNECTED"} />}
      />
      <Card>
        <CardHeader>
          <CardTitle>API key</CardTitle>
          <CardDescription>
            Create a Vachat key with messages:send (and webhooks:manage to receive delivery status).
            The plaintext key is never shown after save.
            {config?.lastError || config?.last_error
              ? ` Last error: ${config?.lastError ?? config?.last_error}`
              : ""}
          </CardDescription>
          <VachatSignupLink className="mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vachat-url">Vachat base URL</Label>
            <div className="flex gap-2">
              <Input id="vachat-url" readOnly value={baseUrl} className="font-mono text-xs" />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-11"
                disabled={!baseUrl}
                onClick={async () => {
                  await navigator.clipboard.writeText(baseUrl);
                  toast.success("Vachat base URL copied.");
                }}
              >
                <Copy />
                Copy
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="vachat-key">{hasKey ? "Replace API key" : "Vachat API key"}</Label>
            <Input
              id="vachat-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="new-password"
              placeholder={hasKey ? "••••••••" : "wacrm_live_…"}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              Save
            </Button>
            <Button variant="secondary" onClick={() => test.mutate()} disabled={test.isPending || !hasKey}>
              Test Connection
            </Button>
            <Button
              variant="secondary"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending || !hasKey}
            >
              Disconnect
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Automation test</CardTitle>
          <CardDescription>
            Enter your WhatsApp number and send a Booked test through your VaChat account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vachat-test-phone">Test WhatsApp number</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="vachat-test-phone"
                inputMode="tel"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="Enter your WhatsApp number"
              />
              <Button
                onClick={() => sendTest.mutate()}
                disabled={sendTest.isPending || !hasKey || !testPhone.trim()}
                className="sm:h-11"
              >
                {sendTest.isPending ? "Sending…" : "Test"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
