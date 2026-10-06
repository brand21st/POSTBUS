"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  applyWhatsAppCustomerFields,
  parseWhatsAppCustomerMessage,
  type WhatsAppCustomerFields,
} from "@/lib/parsers/whatsapp-customer-message";

export function WhatsAppPasteParser({
  getCurrent,
  onApply,
  overwrite = false,
}: {
  getCurrent: () => WhatsAppCustomerFields;
  onApply: (fields: WhatsAppCustomerFields) => void;
  overwrite?: boolean;
}) {
  const [text, setText] = useState("");
  const [hint, setHint] = useState<string | null>(null);

  function parse() {
    const parsed = parseWhatsAppCustomerMessage(text);
    const filled = Object.values(parsed.fields).filter(Boolean).length;
    if (!filled) {
      setHint("Could not read name, phone, or address from that message. Fill the fields manually.");
      return;
    }
    onApply(applyWhatsAppCustomerFields(getCurrent(), parsed.fields, { overwrite }));
    setHint(
      overwrite
        ? `Updated ${filled} field${filled === 1 ? "" : "s"} from the message. Review before saving.`
        : `Filled ${filled} field${filled === 1 ? "" : "s"} from the message. Empty fields only — review before saving.`
    );
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor="whatsapp-paste">
        Paste WhatsApp customer details
      </label>
      <Textarea
        id="whatsapp-paste"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setHint(null);
        }}
        placeholder={"Name: Rahul\nPhone: 9876543210\nAddress: 12 ABC House, Main Road\nCity: Kozhikode\nState: Kerala\nPIN: 673001"}
        className="min-h-32 font-mono text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={parse} disabled={!text.trim()}>
          Parse message
        </Button>
        {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      </div>
    </div>
  );
}
