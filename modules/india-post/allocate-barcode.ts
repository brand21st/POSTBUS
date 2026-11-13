import type { SupabaseClient } from "@supabase/supabase-js";
import {
  INDIA_POST_COD_RANGE_CODE,
  formatBarcode,
  isCeptUatTestSeries,
  isCodPaymentMode,
  selectBarcodeRangeForBooking,
} from "@/modules/india-post/barcode";
import { indiaPostServiceLabel } from "@/types/domain";

export async function allocateNextBarcode(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    serviceCode: string;
    environment?: string | null;
    paymentMode?: string | null;
  }
) {
  const clauses = [`service_code.eq.${input.serviceCode}`, "service_code.is.null"];
  if (isCodPaymentMode(input.paymentMode)) clauses.push(`service_code.eq.${INDIA_POST_COD_RANGE_CODE}`);
  const { data: ranges, error } = await supabase
    .from("barcode_ranges")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("is_active", true)
    .or(clauses.join(","));
  if (error) {
    throw Object.assign(new Error(error.message), { code: "INVALID_BARCODE" });
  }
  const picked = selectBarcodeRangeForBooking(ranges ?? [], input);
  const range = picked.range;
  if (picked.exhausted && range) {
    throw Object.assign(
      new Error(
        picked.codSeriesRequired
          ? `The COD barcode range is used up (ended at ${range.end_number}). Add a new EZ series.`
          : `The barcode range for ${indiaPostServiceLabel(input.serviceCode)} is used up (ended at ${range.end_number}). Add a new series.`
      ),
      { code: "INVALID_BARCODE" }
    );
  }
  if (!range) {
    throw Object.assign(
      new Error(
        `No barcode range is set for ${indiaPostServiceLabel(input.serviceCode)}. Add the series India Post allotted you.`
      ),
      { code: "INVALID_BARCODE" }
    );
  }
  if (
    input.environment === "PRODUCTION" &&
    isCeptUatTestSeries(String(range.prefix), Number(range.start_number), Number(range.end_number))
  ) {
    throw Object.assign(
      new Error(
        "21433001–21434000 is the CEPT UAT test serial range. India Post will not show those articles in your production dashboard. Save the CL series from My Bookings (for example CL556973995IN uses serial 55697399)."
      ),
      { code: "INVALID_BARCODE" }
    );
  }

  const { data: allocated, error: rpcError } = await supabase.rpc("allocate_barcode_serial", {
    p_range_id: range.id,
  });
  if (!rpcError && allocated) {
    const row = Array.isArray(allocated) ? allocated[0] : allocated;
    if (row?.serial != null) {
      return formatBarcode(String(row.prefix), Number(row.serial), String(row.suffix));
    }
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data: current } = await supabase
      .from("barcode_ranges")
      .select("*")
      .eq("id", range.id)
      .maybeSingle();
    if (!current) {
      throw Object.assign(new Error("Barcode range was removed."), { code: "INVALID_BARCODE" });
    }
    if (current.next_number > current.end_number) {
      throw Object.assign(
        new Error(
          picked.codSeriesRequired
            ? `The COD barcode range is used up (ended at ${current.end_number}). Add a new EZ series.`
            : `The barcode range for ${indiaPostServiceLabel(input.serviceCode)} is used up (ended at ${current.end_number}). Add a new series.`
        ),
        { code: "INVALID_BARCODE" }
      );
    }
    const serial = Number(current.next_number);
    const { data: updated } = await supabase
      .from("barcode_ranges")
      .update({ next_number: serial + 1 })
      .eq("id", current.id)
      .eq("next_number", serial)
      .select("id")
      .maybeSingle();
    if (updated) {
      return formatBarcode(String(current.prefix), serial, String(current.suffix));
    }
  }
  throw Object.assign(new Error("Could not allocate a unique barcode. Try again."), { code: "INVALID_BARCODE" });
}
