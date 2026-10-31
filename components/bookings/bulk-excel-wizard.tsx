"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/hooks/use-api";

type Field = { key: string; label: string };
type ImportRow = {
  id: string;
  excelRowNumber: number;
  status: string;
  barcode?: string | null;
  shipmentId?: string | null;
  mapped: Record<string, string>;
  unmapped: Record<string, string>;
  issues: Array<{ error?: string; field?: string }>;
  receiverName?: string;
  mobile?: string;
  pincode?: string;
  reference?: string;
  weight?: string | number;
  codAmount?: string | number;
  shipmentStatus?: string;
  shipmentError?: string;
  retryable?: boolean;
};
type ImportBatch = {
  id: string;
  filename: string;
  profile: string;
  status: string;
  sheetName?: string | null;
  headerRow?: number | null;
  headers: string[];
  columnMap: Record<string, string>;
  unmappedHeaders: string[];
  otherSheets: string[];
  serviceCode?: string | null;
  total: number;
  valid: number;
  invalid: number;
  fields: Field[];
  preview?: ImportRow[];
  rows?: ImportRow[];
};
type Progress = ImportBatch & {
  rows: ImportRow[];
  queued: number;
  processing: number;
  booked: number;
  failed: number;
  uncertain: number;
  pendingMaterialize: number;
  labelShipmentIds: string[];
};
type Profile = { id: string; name: string; format: string; columnMap: Record<string, string> };

const STEPS = ["Upload", "Map columns", "Validate", "Review", "Progress", "Results"];
const SERVICES = [
  { code: "SP_INLAND_PARCEL", label: "Speed Post Parcel" },
  { code: "BUSINESS_PARCEL", label: "Business Parcel" },
];

function issuesOf(row: ImportRow) {
  return (row.issues ?? []).map((issue) => issue.error).filter(Boolean).join("; ");
}

export function BulkExcelWizard() {
  const [step, setStep] = useState(0);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [profileName, setProfileName] = useState("");
  const [serviceCode, setServiceCode] = useState("SP_INLAND_PARCEL");
  const [query, setQuery] = useState("");
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});

  const profiles = useQuery({
    queryKey: ["bulk-excel-profiles"],
    queryFn: () => api<Profile[]>("/api/v1/bookings/excel-import-profiles"),
  });

  const batch = useQuery({
    queryKey: ["bulk-excel", batchId],
    enabled: Boolean(batchId) && step < 4,
    queryFn: () => api<ImportBatch>(`/api/v1/bookings/excel-imports/${batchId}`),
  });

  const progress = useQuery({
    queryKey: ["bulk-excel-progress", batchId],
    enabled: Boolean(batchId) && step >= 4,
    refetchInterval: step >= 4 ? 3000 : false,
    queryFn: () => api<Progress>(`/api/v1/bookings/excel-imports/${batchId}/progress`),
  });

  const serviceOptions = SERVICES.some((service) => service.code === serviceCode)
    ? SERVICES
    : [...SERVICES, { code: serviceCode, label: serviceCode }];
  const current = step >= 4 ? progress.data : batch.data;
  const rows = useMemo(() => {
    const list = current?.rows ?? current?.preview ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((row) =>
      [row.receiverName, row.mobile, row.pincode, row.reference, row.barcode, String(row.excelRowNumber)]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [current, query]);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.set("file", file);
      const selected = (document.getElementById("bulk-excel-profile") as HTMLSelectElement | null)?.value;
      if (selected) body.set("profileId", selected);
      return api<ImportBatch>("/api/v1/bookings/excel-imports", { method: "POST", body });
    },
    onSuccess: (data) => {
      setBatchId(data.id);
      setMap(data.columnMap);
      setServiceCode(data.serviceCode || "SP_INLAND_PARCEL");
      setStep(1);
      toast.success("Workbook read. Nothing has been booked.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveMap = useMutation({
    mutationFn: () =>
      api<ImportBatch>(`/api/v1/bookings/excel-imports/${batchId}`, {
        method: "PATCH",
        body: JSON.stringify({ columnMap: map, serviceCode, profile: current?.profile }),
      }),
    onSuccess: () => {
      setStep(2);
      toast.success("Mapping saved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const validate = useMutation({
    mutationFn: async () => {
      await api(`/api/v1/bookings/excel-imports/${batchId}`, {
        method: "PATCH",
        body: JSON.stringify({ columnMap: map, serviceCode, profile: current?.profile }),
      });
      return api<ImportBatch>(`/api/v1/bookings/excel-imports/${batchId}/validate`, { method: "POST" });
    },
    onSuccess: () => {
      void batch.refetch();
      toast.success("Validation finished. India Post was not booked.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveProfile = useMutation({
    mutationFn: () =>
      api("/api/v1/bookings/excel-import-profiles", {
        method: "POST",
        body: JSON.stringify({ name: profileName, format: current?.profile || "postbridge", columnMap: map }),
      }),
    onSuccess: () => {
      setProfileName("");
      void profiles.refetch();
      toast.success("Mapping profile saved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const patchRow = useMutation({
    mutationFn: (rowId: string) =>
      api(`/api/v1/bookings/excel-imports/${batchId}/rows/${rowId}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: edits[rowId] ?? {} }),
      }),
    onSuccess: () => {
      setEdits({});
      void batch.refetch();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const draft = useMutation({
    mutationFn: () => api(`/api/v1/bookings/excel-imports/${batchId}/draft`, { method: "POST" }),
    onSuccess: () => toast.success("Draft saved."),
    onError: (error: Error) => toast.error(error.message),
  });

  const confirm = useMutation({
    mutationFn: () => api(`/api/v1/bookings/excel-imports/${batchId}/confirm`, { method: "POST" }),
    onSuccess: () => {
      setStep(4);
      toast.success("Booking started. You can leave this page.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const retry = useMutation({
    mutationFn: () => api(`/api/v1/bookings/excel-imports/${batchId}/retry`, { method: "POST" }),
    onSuccess: () => {
      void progress.refetch();
      toast.success("Eligible failed shipments were queued again.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function downloadWorkbook(path: string, filename: string) {
    const response = await fetch(path, { credentials: "same-origin" });
    if (!response.ok) {
      toast.error("Could not download the workbook.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function downloadLabels() {
    const ids = progress.data?.labelShipmentIds ?? [];
    if (!ids.length) {
      toast.error("No booked shipments are ready for labels yet.");
      return;
    }
    const response = await fetch("/api/v1/labels/bulk-download", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!response.ok) {
      toast.error("Could not download labels.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "bulk-labels.pdf";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        title="Bulk Excel Booking"
        description="Upload a merchant workbook, validate it, then book with the existing India Post pipeline."
        icon={
          <span className="flex size-9 items-center justify-center rounded-xl bg-rose-100 text-brand">
            <FileSpreadsheet className="size-5" />
          </span>
        }
        actions={
          <Link href="/dashboard/orders" className="text-sm text-muted hover:text-foreground">
            Back to orders
          </Link>
        }
      />
      <ol className="flex flex-wrap gap-2 text-xs">
        {STEPS.map((label, index) => (
          <li key={label} className={index === step ? "font-semibold text-brand" : "text-muted"}>
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <section
          className="rounded-xl border border-dashed border-border p-6"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files?.[0];
            if (file) upload.mutate(file);
          }}
        >
          <p className="text-sm">Drop an .xlsx file here or browse. Upload does not book with India Post.</p>
          <p className="mt-2 text-xs text-muted">
            PostBridge-style columns are mapped automatically. Official India Post workbooks with an ArticleDetails sheet are accepted too. PIN codes, mobiles, and barcodes stay text.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Input
              type="file"
              accept=".xlsx"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload.mutate(file);
              }}
            />
            <button type="button" className="text-sm text-brand" onClick={() => void downloadWorkbook("/api/v1/bookings/excel-template", "postbus-bulk-booking.xlsx")}>
              Download template
            </button>
          </div>
          <label className="mt-4 block text-xs text-muted" htmlFor="bulk-excel-profile">
            Previous mapping
            <select id="bulk-excel-profile" className="mt-1 block rounded-md border border-border bg-card px-2 py-1 text-sm">
              <option value="">Automatic</option>
              {(profiles.data ?? []).map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
        </section>
      ) : null}

      {step === 1 && current ? (
        <section className="space-y-3">
          <p className="text-sm">
            Sheet {current.sheetName || "—"}, header row {current.headerRow || "—"}. Unmapped columns are kept.
            {current.otherSheets?.length ? ` Other sheets: ${current.otherSheets.join(", ")}.` : ""}
          </p>
          <div className="overflow-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="p-2">Excel column</th>
                  <th className="p-2">Maps to</th>
                </tr>
              </thead>
              <tbody>
                {current.headers.map((header) => (
                  <tr key={header} className="border-b border-border">
                    <td className="p-2">{header}</td>
                    <td className="p-2">
                      <select
                        className="rounded-md border border-border bg-card px-2 py-1"
                        value={map[header] ?? ""}
                        onChange={(event) => setMap({ ...map, [header]: event.target.value })}
                      >
                        <option value="">Unmapped</option>
                        {current.fields.map((field) => (
                          <option key={field.key} value={field.key}>
                            {field.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Profile name" value={profileName} onChange={(event) => setProfileName(event.target.value)} />
            <Button type="button" variant="secondary" disabled={!profileName.trim() || saveProfile.isPending} onClick={() => saveProfile.mutate()}>
              Save mapping profile
            </Button>
            <Button type="button" disabled={saveMap.isPending} onClick={() => saveMap.mutate()}>
              Continue
            </Button>
          </div>
        </section>
      ) : null}

      {step === 2 && current ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm">
              Service
              <select
                className="ml-2 rounded-md border border-border bg-card px-2 py-1"
                value={serviceCode}
                onChange={(event) => setServiceCode(event.target.value)}
              >
                {serviceOptions.map((service) => (
                  <option key={service.code} value={service.code}>
                    {service.label}
                  </option>
                ))}
              </select>
            </label>
            <Button type="button" disabled={validate.isPending} onClick={() => validate.mutate()}>
              Validate orders
            </Button>
            <button
              type="button"
              className="text-sm text-brand"
              onClick={() => void downloadWorkbook(`/api/v1/bookings/excel-imports/${batchId}/errors`, "bulk-excel-errors.xlsx")}
            >
              Download error report
            </button>
          </div>
          <Input placeholder="Search rows" value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="overflow-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {["Row", "Customer", "Mobile", "PIN", "Weight", "COD", "Barcode", "Status", "Errors"].map((label) => (
                    <th key={label} className="p-2">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border align-top">
                    <td className="p-2">{row.excelRowNumber}</td>
                    <td className="p-2">{row.receiverName}</td>
                    <td className="p-2">{row.mobile}</td>
                    <td className="p-2">{row.pincode}</td>
                    <td className="p-2">{row.weight}</td>
                    <td className="p-2">{row.codAmount}</td>
                    <td className="p-2">{row.barcode}</td>
                    <td className="p-2">{row.status}</td>
                    <td className="p-2">
                      <p>{issuesOf(row)}</p>
                      {row.status === "invalid" ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Input
                            placeholder="PIN"
                            defaultValue={row.pincode}
                            onChange={(event) =>
                              setEdits({ ...edits, [row.id]: { ...edits[row.id], receiver_pincode: event.target.value } })
                            }
                          />
                          <Input
                            placeholder="Mobile"
                            defaultValue={row.mobile}
                            onChange={(event) =>
                              setEdits({
                                ...edits,
                                [row.id]: { ...edits[row.id], receiver_mobile_no: event.target.value },
                              })
                            }
                          />
                          <Button type="button" size="xs" variant="secondary" onClick={() => patchRow.mutate(row.id)}>
                            Save row
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button type="button" onClick={() => setStep(3)}>
            Review booking
          </Button>
        </section>
      ) : null}

      {step === 3 && current ? (
        <section className="space-y-3 rounded-xl border border-border p-4">
          <p className="text-sm">Booking service: {serviceCode}. Tariff is calculated when India Post accepts the article.</p>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div><dt className="text-muted">Total</dt><dd className="font-semibold">{current.total}</dd></div>
            <div><dt className="text-muted">Valid</dt><dd className="font-semibold">{current.valid}</dd></div>
            <div><dt className="text-muted">Invalid</dt><dd className="font-semibold">{current.invalid}</dd></div>
            <div><dt className="text-muted">Status</dt><dd className="font-semibold">{current.status}</dd></div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={draft.isPending} onClick={() => draft.mutate()}>
              Save as draft
            </Button>
            <Button type="button" disabled={confirm.isPending || current.valid < 1} onClick={() => confirm.mutate()}>
              Book valid orders
            </Button>
          </div>
        </section>
      ) : null}

      {step >= 4 && !progress.data ? <p className="text-sm text-muted">Loading booking progress…</p> : null}
      {step >= 4 && progress.data ? (
        <section className="space-y-3">
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {[
              ["Total", progress.data.total],
              ["Waiting to create", progress.data.pendingMaterialize],
              ["Queued", progress.data.queued],
              ["Processing", progress.data.processing],
              ["Booked", progress.data.booked],
              ["Failed", progress.data.failed],
              ["Uncertain", progress.data.uncertain],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-border px-2 py-1.5">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={retry.isPending} onClick={() => retry.mutate()}>
              Retry eligible failures
            </Button>
            <Button type="button" variant="secondary" onClick={() => void downloadLabels()}>
              Download combined PDF
            </Button>
            <Link href="/dashboard/labels" className="text-sm text-brand">
              Print labels
            </Link>
            <Button type="button" variant="secondary" onClick={() => setStep(5)}>
              Results
            </Button>
          </div>
          <div className="overflow-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {["Row", "Customer", "Barcode", "Shipment", "Error"].map((label) => (
                    <th key={label} className="p-2">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
              {(progress.data.rows).map((row) => (
                  <tr key={row.id} className="border-b border-border">
                    <td className="p-2">{row.excelRowNumber}</td>
                    <td className="p-2">{row.receiverName}</td>
                    <td className="p-2">{row.barcode}</td>
                    <td className="p-2">{row.shipmentStatus}</td>
                    <td className="p-2">{row.shipmentError || issuesOf(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
