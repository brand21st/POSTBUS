"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/hooks/use-api";
import { PRINT_STATION_QUERY_KEY, usePrintStation } from "@/lib/hooks/use-print-station";
import type { PrintStation } from "@/types/api";

function stationField(station: PrintStation | undefined, camel: keyof PrintStation, snake: keyof PrintStation) {
  return (station?.[camel] ?? station?.[snake]) as PrintStation[typeof camel];
}

export function AutoLabelPrintingCard({ enabled, canManage }: { enabled: boolean; canManage: boolean }) {
  const queryClient = useQueryClient();
  const stationQuery = usePrintStation();
  const station = stationQuery.data;
  const printerNames = (stationField(station, "printerNames", "printer_names") as string[] | undefined) ?? [];
  const selected =
    (stationField(station, "selectedPrinterName", "selected_printer_name") as string | null | undefined) ?? "";
  const connected = Boolean(stationField(station, "connected", "connected"));
  const paperSize = String(stationField(station, "paperSize", "paper_size") ?? "A6");
  const orientation = String(stationField(station, "orientation", "orientation") ?? "portrait");
  const copies = Number(stationField(station, "copies", "copies") ?? 1);
  const autoPrintMerchant = Boolean(
    stationField(station, "autoPrintMerchant", "auto_print_merchant") ?? true
  );
  const offlineMessage = String(stationField(station, "offlineMessage", "offline_message") ?? "");
  const [token, setToken] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);

  const saveStation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api<PrintStation>("/api/v1/print-station", {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(PRINT_STATION_QUERY_KEY, data);
      toast.success("Printer settings saved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const connect = useMutation({
    mutationFn: () => api<{ token: string }>("/api/v1/print-station/token", { method: "POST" }),
    onSuccess: async (data) => {
      setToken(data.token);
      setConnectOpen(true);
      await queryClient.invalidateQueries({ queryKey: PRINT_STATION_QUERY_KEY });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <>
      <CardContent className="space-y-4 pt-0 text-sm">
        {enabled ? (
          connected && selected ? (
            <div className="space-y-1">
              <p>
                Printer: <span className="font-medium text-foreground">{selected}</span>
              </p>
              <p className="flex items-center gap-2 text-success">
                <span className="size-2 rounded-full bg-success" />
                Connected
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="flex items-center gap-2 text-error">
                <span className="size-2 rounded-full bg-error" />
                No printer detected
              </p>
              <p className="text-xs text-muted">
                {offlineMessage ||
                  "Printer unavailable. Label will print when the printer reconnects."}
              </p>
            </div>
          )
        ) : (
          <p className="text-xs text-muted">Labels will not print automatically while this is off.</p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Paper size</Label>
            <Select
              value={paperSize}
              disabled={!canManage || saveStation.isPending}
              onValueChange={(value) => saveStation.mutate({ paperSize: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="A6">A6</SelectItem>
                <SelectItem value="4x6">4 × 6 in</SelectItem>
                <SelectItem value="A5">A5</SelectItem>
                <SelectItem value="A4">A4</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Orientation</Label>
            <Select
              value={orientation}
              disabled={!canManage || saveStation.isPending}
              onValueChange={(value) => saveStation.mutate({ orientation: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="portrait">Portrait</SelectItem>
                <SelectItem value="landscape">Landscape</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Copies</Label>
            <Select
              value={String(copies)}
              disabled={!canManage || saveStation.isPending}
              onValueChange={(value) => saveStation.mutate({ copies: Number(value) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="2">2</SelectItem>
                <SelectItem value="3">3</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2">
          <div>
            <p className="text-sm font-medium text-ink">Print packing label</p>
            <p className="text-xs text-muted">Also print the merchant packing label after the official India Post PDF.</p>
          </div>
          <Switch
            checked={autoPrintMerchant}
            disabled={!canManage || saveStation.isPending}
            onCheckedChange={(checked) => saveStation.mutate({ autoPrintMerchant: checked })}
          />
        </div>

        {printerNames.length > 0 ? (
          <div className="space-y-1.5">
            <Label>Default label printer</Label>
            <Select
              value={selected || undefined}
              disabled={!canManage || saveStation.isPending}
              onValueChange={(value) => saveStation.mutate({ selectedPrinterName: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a printer" />
              </SelectTrigger>
              <SelectContent>
                {printerNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {printerNames.length > 0 ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!canManage}
              onClick={() => setConnectOpen(true)}
            >
              <Printer className="size-4" />
              Change Printer
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!canManage || connect.isPending}
              onClick={() => connect.mutate()}
            >
              <Printer className="size-4" />
              Connect Printer
            </Button>
          )}
          {printerNames.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!canManage || connect.isPending}
              onClick={() => connect.mutate()}
            >
              New agent token
            </Button>
          ) : null}
        </div>
      </CardContent>

      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect a label printer</DialogTitle>
            <DialogDescription>
              The packing computer must run the PostBus print agent. The server cannot see a USB or
              Wi-Fi printer on your desk.
            </DialogDescription>
          </DialogHeader>
          {printerNames.length > 0 ? (
            <div className="space-y-1.5">
              <Label>Choose printer</Label>
              <Select
                value={selected || undefined}
                onValueChange={(value) => saveStation.mutate({ selectedPrinterName: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a printer" />
                </SelectTrigger>
                <SelectContent>
                  {printerNames.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="text-sm text-muted">
              After the agent starts, this page lists the printers on that computer so you can pick
              the label printer. The first printer is never chosen automatically.
            </p>
          )}
          {token ? (
            <div className="space-y-2 rounded-xl border border-border bg-surface-soft p-3 text-xs">
              <p className="font-medium text-foreground">Save this token now. It is shown once.</p>
              <code className="block break-all text-foreground">{token}</code>
              <pre className="overflow-x-auto whitespace-pre-wrap text-muted">{`cd print-agent
npm install
node index.mjs --url ${typeof window !== "undefined" ? window.location.origin : "https://your-postbus-domain"} --token ${token}`}</pre>
            </div>
          ) : (
            <Button type="button" disabled={!canManage || connect.isPending} onClick={() => connect.mutate()}>
              Generate agent token
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
