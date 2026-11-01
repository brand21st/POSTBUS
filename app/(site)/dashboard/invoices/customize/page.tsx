import { InvoiceEditor } from "@/components/invoices/invoice-editor";
import { SalesInvoiceSettingsForm } from "@/components/invoices/sales-invoice-settings";

export default function CustomizeInvoicePage() {
  return (
    <div className="space-y-6">
      <InvoiceEditor />
      <SalesInvoiceSettingsForm />
    </div>
  );
}
