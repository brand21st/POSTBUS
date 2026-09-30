import type { SupabaseClient } from "@supabase/supabase-js";
import { formatBarcode, isCeptUatTestSeries } from "@/modules/india-post/barcode";
import { indiaPostServiceLabel } from "@/types/domain";

export async function allocateNextBarcode(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    serviceCode: string;
    environment?: string | null;
  }
) {
  const { data: ranges, error } = await supabase
    .from("barcode_ranges")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("is_active", true)
    .or(`service_code.eq.${input.serviceCode},service_code.is.null`);
  if (error) {
    throw Object.assign(new Error(error.message), { code: "INVALID_BARCODE" });
  }
  const range =
    (ranges ?? []).find((item) => item.service_code === input.serviceCode) ??
    (ranges ?? []).find((item) => item.service_code === null);
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
          `The barcode range for ${indiaPostServiceLabel(input.serviceCode)} is used up (ended at ${current.end_number}). Add a new series.`
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
