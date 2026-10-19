"use client";

import Link from "next/link";
import { Copy, Download, Sheet } from "lucide-react";
import { toast } from "sonner";
import { GoogleSheetsLogo } from "@/components/brand/google-sheets-logo";
import { PageHeader } from "@/components/dashboard/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useMe } from "@/lib/hooks/use-me";
import {
  GOOGLE_APPS_SCRIPT_SOURCE,
  GOOGLE_SHEETS_HEADER_ROW,
  GOOGLE_SHEETS_HEADERS,
} from "@/modules/merchant-api/google-apps-script-example";
import { cn } from "@/lib/utils";

function copyText(value: string, label: string) {
  void navigator.clipboard.writeText(value);
  toast.success(`${label} copied.`);
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function GoogleSheetsIntegrationPage() {
  const me = useMe();
  const apiEnabled = Boolean(me.data?.merchantApi?.enabled);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Google Sheets"
        description="Import orders from a sheet with Apps Script. PostBus does not host the script or store your column map."
      />

      {!apiEnabled && me.isSuccess ? (
        <Card>
          <CardHeader>
            <CardTitle>Merchant API required</CardTitle>
            <CardDescription>
              This workspace is not on the Merchant API allowlist yet. Ask PostBus to enable it, then mint a key.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GoogleSheetsLogo />
          </CardTitle>
          <CardDescription>
            Use Extensions → Apps Script in your Google Sheet. Creating a row does not book India Post.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <ol className="list-decimal space-y-2 pl-5 text-zinc-700">
            <li>
              Mint a key named “Google Apps Script” with{" "}
              <code className="rounded bg-surface-soft px-1">orders:write</code>,{" "}
              <code className="rounded bg-surface-soft px-1">orders:read</code>,{" "}
              <code className="rounded bg-surface-soft px-1">shipments:book</code>,{" "}
              <code className="rounded bg-surface-soft px-1">shipments:read</code>, and{" "}
              <code className="rounded bg-surface-soft px-1">tracking:read</code>.
            </li>
            <li>
              In the Apps Script editor open Project Settings → Script properties. Add{" "}
              <code className="rounded bg-surface-soft px-1">POSTBUS_API_KEY</code> (the secret shown once) and optional{" "}
              <code className="rounded bg-surface-soft px-1">POSTBUS_API_BASE</code>{" "}
              <code className="rounded bg-surface-soft px-1">https://www.postbus.in/api/merchant/v1</code>.
            </li>
            <li>Paste the script below, save, reload the sheet. Use the PostBus menu.</li>
            <li>
              Run <strong>Write column headers</strong>, fill rows, then <strong>Import orders</strong>. Book only when
              you are ready to ship.
            </li>
            <li>
              Optional: time-driven triggers for Import and Sync tracking. Do not put Book pending on an automatic
              trigger.
            </li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/integrations/developer"
              className={cn(buttonVariants({ size: "sm" }), !apiEnabled && "pointer-events-none opacity-50")}
            >
              Mint API key
            </Link>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => copyText(GOOGLE_SHEETS_HEADER_ROW, "Header row")}
            >
              <Copy className="size-4" />
              Copy header row
            </Button>
            <a href="/developers/integrations" className={buttonVariants({ size: "sm", variant: "secondary" })} target="_blank" rel="noreferrer">
              Public docs
            </a>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Column map</CardTitle>
          <CardDescription>Rename COLUMN_MAP in the script if your headers differ. Required: name, 10-digit phone, address, city, state, 6-digit pincode, product, quantity.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead className="bg-zinc-50 text-[11px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Sheet header</th>
                  <th className="px-3 py-2 font-semibold">Use</th>
                </tr>
              </thead>
              <tbody>
                {GOOGLE_SHEETS_HEADERS.map((header) => (
                  <tr key={header} className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-ink">{header}</td>
                    <td className="px-3 py-2 text-zinc-600">
                      {header === "PostBus Order ID" || header === "AWB" || header === "Tracking URL" || header === "Last Error"
                        ? "Written by the script"
                        : header === "External ID"
                          ? "Your id. Stable; do not use a row number after sorting"
                          : header === "Payment"
                            ? "Optional, default COD"
                            : "Sent on import"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sheet className="size-5 text-brand" />
              Apps Script
            </CardTitle>
            <CardDescription>Paste into a new script file. Never put the API key in a cell or ChatGPT.</CardDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="secondary" onClick={() => copyText(GOOGLE_APPS_SCRIPT_SOURCE, "Apps Script")}>
              <Copy className="size-4" />
              Copy script
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => downloadText("PostBus.gs", GOOGLE_APPS_SCRIPT_SOURCE)}
            >
              <Download className="size-4" />
              Download .gs
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <pre className="max-h-[32rem] overflow-auto rounded-xl border border-zinc-800 bg-[#111113] p-4 text-[12px] leading-5 text-zinc-100">
            <code>{GOOGLE_APPS_SCRIPT_SOURCE}</code>
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
