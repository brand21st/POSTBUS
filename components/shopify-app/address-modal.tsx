"use client";

import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { errorMessage, useShopifyApi } from "@/components/shopify-app/api";
import { showToast } from "@/components/shopify-app/app-bridge";
import type { OrderAddress } from "@/components/shopify-app/types";

type AddressForm = { name: string; phone: string; line1: string; line2: string; city: string; state: string; pincode: string };

function fromAddress(address: OrderAddress | null): AddressForm {
  return {
    name: address?.name ?? "",
    phone: address?.phone ?? "",
    line1: address?.line1 ?? address?.address1 ?? "",
    line2: address?.line2 ?? address?.address2 ?? "",
    city: address?.city ?? "",
    state: address?.state ?? "",
    pincode: address?.pincode ?? "",
  };
}

/** First problem India Post would reject, checked before saving so the merchant fixes it here. */
export function addressProblem(form: AddressForm) {
  if (form.line1.trim().length < 3) return "Enter the street address.";
  if (form.city.trim().length < 2) return "Enter the city.";
  if (form.state.trim().length < 2) return "Enter the state.";
  if (!/^\d{6}$/.test(form.pincode.trim())) return "PIN code must be 6 digits.";
  const digits = form.phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  if (form.phone.trim() && !/^[6-9]\d{9}$/.test(digits)) return "Enter a 10-digit Indian mobile number.";
  return null;
}

export function AddressModal({
  open,
  orderId,
  address,
  onClose,
  onSaved,
}: {
  open: boolean;
  orderId: string;
  address: OrderAddress | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const api = useShopifyApi();
  const modal = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const [form, setForm] = useState<AddressForm>(() => fromAddress(address));
  const [error, setError] = useState<string | null>(null);

  // The parent remounts this component per open (see `key`), so form state starts from `address`.
  useEffect(() => {
    if (open) modal.current?.showOverlay();
    else modal.current?.hideOverlay();
  }, [open]);

  const save = useMutation({
    mutationFn: (value: AddressForm) =>
      api(`orders/${orderId}/address`, {
        method: "PATCH",
        body: {
          name: value.name.trim() || undefined,
          phone: value.phone.trim() || undefined,
          line1: value.line1.trim(),
          line2: value.line2.trim() || undefined,
          city: value.city.trim(),
          state: value.state.trim(),
          pincode: value.pincode.trim(),
          country: "IN",
        },
      }),
    onSuccess: () => {
      showToast("Address updated");
      onSaved();
    },
    onError: (caught) => setError(errorMessage(caught, "Couldn't save the address.")),
  });

  function field(key: keyof AddressForm, label: string, extra?: { required?: boolean }) {
    return (
      <s-text-field
        label={label}
        required={extra?.required}
        value={form[key]}
        onInput={(event) => {
          const value = event.currentTarget.value;
          setForm((current) => ({ ...current, [key]: value }));
          setError(null);
        }}
      />
    );
  }

  function submit() {
    const problem = addressProblem(form);
    if (problem) {
      setError(problem);
      return;
    }
    save.mutate(form);
  }

  return (
    <s-modal ref={modal} heading="Edit shipping address" onHide={onClose}>
      <s-stack gap="base">
        <s-paragraph color="subdued">This changes the address PostBus sends to India Post. Shopify isn&apos;t updated.</s-paragraph>
        {error ? <s-banner tone="critical">{error}</s-banner> : null}
        {field("name", "Recipient name")}
        {field("phone", "Mobile number")}
        {field("line1", "Address", { required: true })}
        {field("line2", "Apartment, landmark")}
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(140px, 1fr))" gap="base">
          {field("city", "City", { required: true })}
          {field("state", "State", { required: true })}
          {field("pincode", "PIN code", { required: true })}
        </s-grid>
      </s-stack>
      <s-button slot="primary-action" variant="primary" loading={save.isPending} onClick={submit}>
        Save address
      </s-button>
      <s-button slot="secondary-actions" onClick={() => modal.current?.hideOverlay()}>
        Cancel
      </s-button>
    </s-modal>
  );
}
