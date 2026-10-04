"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/hooks/use-api";

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
  platformManaged?: boolean;
};

export default function VachatIntegrationPage() {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [testPhone, setTestPhone] = useState("918618456029");
  const query = useQuery({
    queryKey: ["vachat"],
    queryFn: () => api<VachatConfig>("/api/v1/integrations/vachat"),
  });
  const config = query.data;
  const hasKey = Boolean(config?.hasApiKey ?? config?.has_api_key);
  const platformManaged = Boolean(config?.platformManaged);

  const save = useMutation({
    mutationFn: () => {
      if (!hasKey && !apiKey.trim()) throw new Error("Paste a Vachat API key (wacrm_live_…).");
      return api<VachatConfig>("/api/v1/integrations/vachat", {
        method: "POST",
        body: JSON.stringify({
          apiKey: apiKey.trim() || undefined,
          apiBaseUrl: baseUrl.trim() || config?.apiBaseUrl || config?.api_base_url,
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
    mutationFn: () =>
      api<{ sent: boolean; to: string; event: string }>("/api/v1/integrations/vachat/send-test", {
        method: "POST",
        body: JSON.stringify({ phone: testPhone }),
      }),
    onSuccess: (result) => {
      toast.success(`Booked test WhatsApp sent to ${result.to}.`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const canSendTest = platformManaged || hasKey;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vachat"
        description={
          platformManaged
            ? "WhatsApp is managed by PostBus. Turn shipment events on or off under Automation."
            : "Send PostBus shipment WhatsApp notices through Vachat Cloud API. Test Connection only calls GET /api/v1/me."
        }
        actions={<StatusBadge value={config?.status ?? "NOT_CONNECTED"} />}
      />
      {platformManaged ? (
        <Card>
          <CardHeader>
            <CardTitle>Managed by PostBus</CardTitle>
            <CardDescription>
              Super Admin connected a global VaChat account. This organization cannot paste its own API key
              while global WhatsApp is enabled. Event toggles stay under Automation.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
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
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vachat-url">Vachat base URL</Label>
            <Input
              id="vachat-url"
              value={baseUrl || config?.apiBaseUrl || config?.api_base_url || ""}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://cloud.vachat.in"
            />
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
      )}
      <Card>
        <CardHeader>
          <CardTitle>Automation test</CardTitle>
          <CardDescription>
            Send a Booked template to this WhatsApp number through VaChat. Shipment automations still go to the
            customer on the order.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vachat-test-phone">Test WhatsApp number</Label>
            <Input
              id="vachat-test-phone"
              inputMode="tel"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="918618456029"
            />
          </div>
          <Button onClick={() => sendTest.mutate()} disabled={sendTest.isPending || !canSendTest}>
            {sendTest.isPending ? "Sending…" : "Send booked test"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
