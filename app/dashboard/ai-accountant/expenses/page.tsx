"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Paperclip, Plus, Trash2 } from "lucide-react";
import { useReadOnly } from "@/components/ai-accountant/shell";
import {
  CATEGORY_LABELS,
  ExportButtons,
  GST_RATES,
  Kpi,
  Money,
  NativeSelect,
  PAYMENT_LABELS,
  PeriodPicker,
  TableShell,
  istToday,
  qs,
  rupeesToPaiseInput,
  td,
  th,
  usePeriod,
} from "@/components/ai-accountant/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";

type Expense = { id: string; incurred_on: string; category: string; vendor_name: string | null; amount_paise: number; tax_paise: number; memo: string | null; payment_account_key: string; receipt_path: string | null };
type Purchase = { id: string; vendor_name: string; invoice_number: string | null; invoice_date: string; gstin: string | null; taxable_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number; total_paise: number; itc_eligible: boolean; category: string; receipt_path: string | null };

const EXPENSE_CATEGORIES = Object.keys(CATEGORY_LABELS).filter((key) => key !== "inventory");

function Field({ label, children, id }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function ExpenseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const client = useQueryClient();
  const [form, setForm] = useState({ incurredOn: istToday(), category: "packaging", amount: "", rateBps: 0, itcClaimable: false, vendorName: "", memo: "", paymentAccount: "bank" });
  const save = useMutation({
    mutationFn: () =>
      api("/api/v1/ai-accountant/expenses", {
        method: "POST",
        body: JSON.stringify({ ...form, amountPaise: rupeesToPaiseInput(form.amount), vendorName: form.vendorName || null, memo: form.memo || null }),
      }),
    onSuccess: () => {
      toast.success("Expense recorded and posted to the ledger.");
      client.invalidateQueries({ queryKey: ["ai-accountant"] });
      onOpenChange(false);
      setForm((f) => ({ ...f, amount: "", vendorName: "", memo: "" }));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add expense</DialogTitle>
          <DialogDescription>Enter the amount you paid, including GST.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date" id="ex-date">
            <Input id="ex-date" type="date" value={form.incurredOn} onChange={(e) => setForm({ ...form, incurredOn: e.target.value })} />
          </Field>
          <Field label="Category" id="ex-cat">
            <NativeSelect id="ex-cat" className="w-full" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {EXPENSE_CATEGORIES.map((key) => (
                <option key={key} value={key}>
                  {CATEGORY_LABELS[key]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Amount paid (₹)" id="ex-amt">
            <Input id="ex-amt" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="1180.00" />
          </Field>
          <Field label="GST rate on bill" id="ex-rate">
            <NativeSelect id="ex-rate" className="w-full" value={form.rateBps} onChange={(e) => setForm({ ...form, rateBps: Number(e.target.value) })}>
              {GST_RATES.map((rate) => (
                <option key={rate} value={rate}>
                  {rate / 100}%
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Vendor" id="ex-vendor">
            <Input id="ex-vendor" value={form.vendorName} maxLength={160} onChange={(e) => setForm({ ...form, vendorName: e.target.value })} />
          </Field>
          <Field label="Paid from" id="ex-pay">
            <NativeSelect id="ex-pay" className="w-full" value={form.paymentAccount} onChange={(e) => setForm({ ...form, paymentAccount: e.target.value })}>
              {Object.entries(PAYMENT_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Note" id="ex-memo">
              <Input id="ex-memo" value={form.memo} maxLength={500} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.itcClaimable} disabled={form.rateBps === 0} onChange={(e) => setForm({ ...form, itcClaimable: e.target.checked })} />
            I have a GST tax invoice for this and will claim input tax credit
          </label>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !rupeesToPaiseInput(form.amount)} onClick={() => save.mutate()}>
            Save expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PurchaseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const client = useQueryClient();
  const [form, setForm] = useState({ vendorName: "", invoiceNumber: "", invoiceDate: istToday(), gstin: "", taxable: "", rateBps: 500, category: "inventory", itcEligible: true, paymentAccount: "accounts_payable" });
  const save = useMutation({
    mutationFn: () =>
      api("/api/v1/ai-accountant/purchases", {
        method: "POST",
        body: JSON.stringify({ ...form, taxablePaise: rupeesToPaiseInput(form.taxable), gstin: form.gstin || null, invoiceNumber: form.invoiceNumber || null }),
      }),
    onSuccess: () => {
      toast.success("Purchase invoice recorded.");
      client.invalidateQueries({ queryKey: ["ai-accountant"] });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add purchase invoice</DialogTitle>
          <DialogDescription>Stock and supplier bills. Enter the taxable value before GST; tax is split by the supplier&apos;s state.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Supplier" id="pi-vendor">
            <Input id="pi-vendor" value={form.vendorName} maxLength={160} onChange={(e) => setForm({ ...form, vendorName: e.target.value })} />
          </Field>
          <Field label="Supplier GSTIN" id="pi-gstin">
            <Input id="pi-gstin" value={form.gstin} maxLength={15} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Invoice number" id="pi-no">
            <Input id="pi-no" value={form.invoiceNumber} maxLength={60} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} />
          </Field>
          <Field label="Invoice date" id="pi-date">
            <Input id="pi-date" type="date" value={form.invoiceDate} onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })} />
          </Field>
          <Field label="Taxable value (₹)" id="pi-tax">
            <Input id="pi-tax" inputMode="decimal" value={form.taxable} onChange={(e) => setForm({ ...form, taxable: e.target.value })} />
          </Field>
          <Field label="GST rate" id="pi-rate">
            <NativeSelect id="pi-rate" className="w-full" value={form.rateBps} onChange={(e) => setForm({ ...form, rateBps: Number(e.target.value) })}>
              {GST_RATES.map((rate) => (
                <option key={rate} value={rate}>
                  {rate / 100}%
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Category" id="pi-cat">
            <NativeSelect id="pi-cat" className="w-full" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Payment" id="pi-pay">
            <NativeSelect id="pi-pay" className="w-full" value={form.paymentAccount} onChange={(e) => setForm({ ...form, paymentAccount: e.target.value })}>
              {Object.entries(PAYMENT_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.itcEligible} onChange={(e) => setForm({ ...form, itcEligible: e.target.checked })} />
            Eligible for input tax credit (needs supplier GSTIN and your GST registration)
          </label>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !form.vendorName || rupeesToPaiseInput(form.taxable) === null} onClick={() => save.mutate()}>
            Save purchase
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceiptButton({ resource, id, path, readOnly }: { resource: "expenses" | "purchases"; id: string; path: string | null; readOnly: boolean }) {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return api(`/api/v1/ai-accountant/${resource}/${id}/receipt`, { method: "POST", body });
    },
    onSuccess: () => (toast.success("Receipt attached."), client.invalidateQueries({ queryKey: ["ai-accountant", resource] })),
    onError: (error: Error) => toast.error(error.message),
  });
  const open = async () => {
    try {
      const { url } = await api<{ url: string }>(`/api/v1/ai-accountant/${resource}/${id}/receipt`);
      window.open(url, "_blank", "noopener");
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  return (
    <>
      <input ref={input} type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={path ? "View receipt" : "Attach receipt"}
        title={path ? "View receipt" : "Attach receipt"}
        disabled={(!path && readOnly) || upload.isPending}
        onClick={() => (path ? open() : input.current?.click())}
      >
        <Paperclip className={cn("size-4", path && "text-brand")} />
      </Button>
    </>
  );
}

export default function ExpensesPage() {
  const readOnly = useReadOnly();
  const client = useQueryClient();
  const [tab, setTab] = useState<"expenses" | "purchases">("expenses");
  const [open, setOpen] = useState(false);
  const { period, setPeriod } = usePeriod("this_month");
  const list = useQuery({
    queryKey: ["ai-accountant", tab, period.from, period.to],
    queryFn: () =>
      api<{ expenses?: Expense[]; purchases?: Purchase[]; totalPaise: number; itcPaise?: number; byCategory?: Record<string, number> }>(
        `/api/v1/ai-accountant/${tab}${qs(period)}`
      ),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/v1/ai-accountant/${tab}/${id}`, { method: "DELETE" }),
    onSuccess: () => (toast.success("Removed and reversed in the ledger."), client.invalidateQueries({ queryKey: ["ai-accountant"] })),
    onError: (error: Error) => toast.error(error.message),
  });
  const topCategory = Object.entries(list.data?.byCategory ?? {}).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label={tab === "expenses" ? "Expenses in period" : "Purchases in period"} value={<Money paise={list.data?.totalPaise ?? 0} />} />
        {tab === "expenses" ? (
          <Kpi label="Largest category" value={topCategory ? CATEGORY_LABELS[topCategory[0]] ?? topCategory[0] : "—"} hint={topCategory ? <Money paise={topCategory[1]} /> : undefined} />
        ) : (
          <Kpi label="Input tax credit" value={<Money paise={list.data?.itcPaise ?? 0} />} hint="From eligible supplier invoices" />
        )}
        <Kpi label="Entries" value={(tab === "expenses" ? list.data?.expenses : list.data?.purchases)?.length ?? 0} />
      </div>
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1 rounded-xl border border-border p-1">
              {(["expenses", "purchases"] as const).map((key) => (
                <button key={key} type="button" onClick={() => setTab(key)} className={cn("rounded-lg px-3 py-1.5 text-sm", tab === key ? "bg-surface-soft font-medium text-ink" : "text-muted hover:text-ink")}>
                  {key === "expenses" ? "Expenses" : "Purchase invoices"}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              {tab === "expenses" ? <ExportButtons kind="EXPENSES" period={period} /> : null}
              <Button size="sm" disabled={readOnly} onClick={() => setOpen(true)}>
                <Plus className="size-4" /> {tab === "expenses" ? "Add expense" : "Add purchase"}
              </Button>
            </div>
          </div>
          <PeriodPicker value={period} onChange={setPeriod} />
          <CardTitle className="sr-only">{tab}</CardTitle>
          <CardDescription>Every entry posts to the ledger. Deleting reverses it.</CardDescription>
        </CardHeader>
        <CardContent>
          <TableShell>
            <thead>
              {tab === "expenses" ? (
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Category</th>
                  <th className={th}>Vendor</th>
                  <th className={th}>Paid from</th>
                  <th className={cn(th, "text-right")}>Amount</th>
                  <th className={cn(th, "text-right")}>GST credit</th>
                  <th className={th} />
                </tr>
              ) : (
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Supplier</th>
                  <th className={th}>Invoice</th>
                  <th className={cn(th, "text-right")}>Taxable</th>
                  <th className={cn(th, "text-right")}>GST</th>
                  <th className={cn(th, "text-right")}>Total</th>
                  <th className={th} />
                </tr>
              )}
            </thead>
            <tbody>
              {tab === "expenses"
                ? (list.data?.expenses ?? []).map((row) => (
                    <tr key={row.id}>
                      <td className={td}>{row.incurred_on}</td>
                      <td className={td}>{CATEGORY_LABELS[row.category] ?? row.category}</td>
                      <td className={td}>{row.vendor_name ?? "—"}</td>
                      <td className={cn(td, "text-xs text-muted")}>{PAYMENT_LABELS[row.payment_account_key] ?? row.payment_account_key}</td>
                      <td className={cn(td, "text-right")}>
                        <Money paise={row.amount_paise} />
                      </td>
                      <td className={cn(td, "text-right text-muted")}>{row.tax_paise ? <Money paise={row.tax_paise} /> : "—"}</td>
                      <td className={cn(td, "whitespace-nowrap text-right")}>
                        <ReceiptButton resource="expenses" id={row.id} path={row.receipt_path} readOnly={readOnly} />
                        <Button size="icon-xs" variant="ghost" aria-label="Delete expense" disabled={readOnly || remove.isPending} onClick={() => confirm("Delete this expense? The ledger entry will be reversed.") && remove.mutate(row.id)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))
                : (list.data?.purchases ?? []).map((row) => (
                    <tr key={row.id}>
                      <td className={td}>{row.invoice_date}</td>
                      <td className={td}>
                        {row.vendor_name}
                        {row.gstin ? <span className="block text-xs text-muted">{row.gstin}</span> : null}
                      </td>
                      <td className={td}>{row.invoice_number ?? "—"}</td>
                      <td className={cn(td, "text-right")}>
                        <Money paise={row.taxable_paise} />
                      </td>
                      <td className={cn(td, "text-right")}>
                        <Money paise={row.cgst_paise + row.sgst_paise + row.igst_paise} />
                        {!row.itc_eligible ? <span className="block text-xs text-muted">No ITC</span> : null}
                      </td>
                      <td className={cn(td, "text-right font-medium")}>
                        <Money paise={row.total_paise} />
                      </td>
                      <td className={cn(td, "whitespace-nowrap text-right")}>
                        <ReceiptButton resource="purchases" id={row.id} path={row.receipt_path} readOnly={readOnly} />
                        <Button size="icon-xs" variant="ghost" aria-label="Delete purchase" disabled={readOnly || remove.isPending} onClick={() => confirm("Delete this purchase? The ledger entry will be reversed.") && remove.mutate(row.id)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
              {list.data && !(tab === "expenses" ? list.data.expenses : list.data.purchases)?.length ? (
                <tr>
                  <td colSpan={7} className={cn(td, "py-10 text-center text-muted")}>
                    Nothing recorded in this period.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </TableShell>
        </CardContent>
      </Card>
      {tab === "expenses" ? <ExpenseDialog open={open} onOpenChange={setOpen} /> : <PurchaseDialog open={open} onOpenChange={setOpen} />}
    </div>
  );
}
