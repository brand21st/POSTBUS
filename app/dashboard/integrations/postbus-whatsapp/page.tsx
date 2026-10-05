"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isMerchantVachatConnected } from "@/lib/dashboard/records";
import { api } from "@/lib/hooks/use-api";
import type { IntegrationsResponse } from "@/types/api";

export default function PostbusWhatsappPage() {
  const [testPhone, setTestPhone] = useState("");
  const query = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api<IntegrationsResponse>("/api/v1/integrations"),
  });
  const merchantActive = isMerchantVachatConnected(query.data);
  const postbus = query.data?.postbusWhatsapp;
  const connected = (postbus?.status ?? "").toUpperCase() === "CONNECTED";

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

  if (merchantActive) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Postbus-Whatsapp Notifications"
          description="Vachat is connected for this workspace, so PostBus WhatsApp Notifications are paused."
        />
        <Card>
          <CardHeader>
            <CardTitle>Using Vachat</CardTitle>
            <CardDescription>
              Shipment templates currently send from your Vachat account. Disconnect Vachat if you want to use PostBus
              WhatsApp Notifications again.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/integrations/vachat" className="text-sm underline">
              Open Vachat
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Postbus-Whatsapp Notifications"
        description="Customers can message the PostBus WhatsApp number for order and tracking answers. Knowledge is built from this workspace’s PostBus data and stays read-only."
        actions={<StatusBadge value={postbus?.status ?? "NOT_CONNECTED"} />}
      />
      <Card>
        <CardHeader>
          <CardTitle>How it works</CardTitle>
          <CardDescription>
            {connected
              ? "Booked, in transit, and delivered templates start after the India Post label is generated. The order assistant answers where the parcel is, when it shipped, and merchant phone, website, and address from this workspace. Connect Vachat if you want to send from your own WhatsApp account instead."
              : "PostBus WhatsApp is not available for this workspace yet. You can still connect Vachat to send from your own account."}
          </CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Send a test</CardTitle>
          <CardDescription>Enter your WhatsApp number to receive a Booked test message.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="postbus-whatsapp-test-phone">Test WhatsApp number</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="postbus-whatsapp-test-phone"
                inputMode="tel"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="Enter your WhatsApp number"
              />
              <Button
                onClick={() => sendTest.mutate()}
                disabled={sendTest.isPending || !connected || !testPhone.trim()}
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
