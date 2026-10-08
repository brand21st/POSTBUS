import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/api/errors";

const findReadyIndiaPostLabel = vi.fn();
const findReadyMerchantLabel = vi.fn();
const generateAndStoreOfficialIndiaPostLabelPdf = vi.fn();
const persistPackingSlip = vi.fn();

vi.mock("@/modules/labels/ready", () => ({
  findReadyIndiaPostLabel: (...args: unknown[]) => findReadyIndiaPostLabel(...args),
  findReadyMerchantLabel: (...args: unknown[]) => findReadyMerchantLabel(...args),
}));

vi.mock("@/modules/labels/official-fetch", () => ({
  generateAndStoreOfficialIndiaPostLabelPdf: (...args: unknown[]) =>
    generateAndStoreOfficialIndiaPostLabelPdf(...args),
}));

vi.mock("@/modules/labels/packing-fetch", () => ({
  persistPackingSlip: (...args: unknown[]) => persistPackingSlip(...args),
}));

import {
  RETRY_INCOMPLETE_MAX,
  retryIncompleteLabelById,
  retryIncompleteLabelsByIds,
  retryIncompleteShipmentLabels,
} from "@/modules/labels/retry";

function supabaseForLabels(rows: Array<{ id: string; shipment_id: string | null }> | { id: string; shipment_id: string | null } | null) {
  const api = {
    select: () => api,
    eq: () => api,
    in: () => api,
    maybeSingle: async () => ({ data: Array.isArray(rows) ? rows[0] ?? null : rows, error: null }),
    then(resolve: (value: { data: unknown; error: null }) => unknown) {
      return Promise.resolve({ data: Array.isArray(rows) ? rows : rows ? [rows] : [], error: null }).then(resolve);
    },
  };
  return {
    from: () => api,
  };
}

describe("retryIncompleteShipmentLabels", () => {
  beforeEach(() => {
    findReadyIndiaPostLabel.mockReset();
    findReadyMerchantLabel.mockReset();
    generateAndStoreOfficialIndiaPostLabelPdf.mockReset();
    persistPackingSlip.mockReset();
  });

  it("skips when both files are already ready", async () => {
    findReadyIndiaPostLabel.mockResolvedValue({ id: "india-1", file_path: "a.pdf", file_url: null, status: "READY" });
    findReadyMerchantLabel.mockResolvedValue({ id: "pack-1", file_path: "b.pdf", file_url: null, status: "READY" });
    const result = await retryIncompleteShipmentLabels({} as never, "org-1", "ship-1");
    expect(result.skipped).toBe(true);
    expect(generateAndStoreOfficialIndiaPostLabelPdf).not.toHaveBeenCalled();
    expect(persistPackingSlip).not.toHaveBeenCalled();
  });

  it("generates only the packing slip when the India Post label is ready", async () => {
    findReadyIndiaPostLabel.mockResolvedValue({ id: "india-1", file_path: "a.pdf", file_url: null, status: "READY" });
    findReadyMerchantLabel.mockResolvedValue(null);
    persistPackingSlip.mockResolvedValue({ id: "pack-1" });
    const result = await retryIncompleteShipmentLabels({} as never, "org-1", "ship-1");
    expect(result).toMatchObject({
      skipped: false,
      generatedOfficial: false,
      indiaPostLabelId: "india-1",
      packingLabelId: "pack-1",
      message: "Packing slip was generated.",
    });
    expect(generateAndStoreOfficialIndiaPostLabelPdf).not.toHaveBeenCalled();
    expect(persistPackingSlip).toHaveBeenCalledWith(expect.anything(), "org-1", "ship-1");
  });

  it("generates the official label when it is missing", async () => {
    findReadyIndiaPostLabel.mockResolvedValue(null);
    findReadyMerchantLabel.mockResolvedValue(null);
    generateAndStoreOfficialIndiaPostLabelPdf.mockResolvedValue({ labelId: "india-2", shipmentId: "ship-1" });
    persistPackingSlip.mockResolvedValue({ id: "pack-2" });
    const result = await retryIncompleteShipmentLabels({} as never, "org-1", "ship-1");
    expect(result.generatedOfficial).toBe(true);
    expect(result.message).toBe("India Post label and packing slip were generated.");
    expect(generateAndStoreOfficialIndiaPostLabelPdf).toHaveBeenCalled();
  });

  it("does not swallow packing slip errors", async () => {
    findReadyIndiaPostLabel.mockResolvedValue({ id: "india-1", file_path: "a.pdf", file_url: null, status: "READY" });
    findReadyMerchantLabel.mockResolvedValue(null);
    persistPackingSlip.mockRejectedValue(new Error("Packing template is invalid."));
    await expect(retryIncompleteShipmentLabels({} as never, "org-1", "ship-1")).rejects.toMatchObject({
      message: "Packing template is invalid.",
      code: "LABEL_GENERATION_FAILED",
    });
  });

  it("hides native canvas module paths from the merchant", async () => {
    findReadyIndiaPostLabel.mockResolvedValue({ id: "india-1", file_path: "a.pdf", file_url: null, status: "READY" });
    findReadyMerchantLabel.mockResolvedValue(null);
    persistPackingSlip.mockRejectedValue(
      new Error("Cannot find module '@napi-rs/canvas'\nRequire stack:\n- /ROOT/modules/labels/unicode/canvas-native.ts")
    );
    await expect(retryIncompleteShipmentLabels({} as never, "org-1", "ship-1")).rejects.toMatchObject({
      message: "Could not generate the packing slip. Unicode text rendering is unavailable on this server.",
    });
  });

  it("fails when the official label cannot be saved", async () => {
    findReadyIndiaPostLabel.mockResolvedValue(null);
    findReadyMerchantLabel.mockResolvedValue(null);
    generateAndStoreOfficialIndiaPostLabelPdf.mockResolvedValue({ labelId: null, shipmentId: "ship-1" });
    await expect(retryIncompleteShipmentLabels({} as never, "org-1", "ship-1")).rejects.toBeInstanceOf(AppError);
    expect(persistPackingSlip).not.toHaveBeenCalled();
  });
});

describe("retryIncompleteLabelById", () => {
  beforeEach(() => {
    findReadyIndiaPostLabel.mockReset();
    findReadyMerchantLabel.mockReset();
    generateAndStoreOfficialIndiaPostLabelPdf.mockReset();
    persistPackingSlip.mockReset();
  });

  it("resolves the shipment from the label id", async () => {
    findReadyIndiaPostLabel.mockResolvedValue({ id: "india-1", file_path: "a.pdf", file_url: null, status: "READY" });
    findReadyMerchantLabel.mockResolvedValue(null);
    persistPackingSlip.mockResolvedValue({ id: "pack-1" });
    const result = await retryIncompleteLabelById(
      supabaseForLabels({ id: "label-1", shipment_id: "ship-1" }) as never,
      "org-1",
      "label-1"
    );
    expect(result.shipmentId).toBe("ship-1");
  });

  it("throws when the label is missing", async () => {
    await expect(
      retryIncompleteLabelById(supabaseForLabels(null) as never, "org-1", "missing")
    ).rejects.toThrow("Label not found.");
  });
});

describe("retryIncompleteLabelsByIds", () => {
  beforeEach(() => {
    findReadyIndiaPostLabel.mockReset();
    findReadyMerchantLabel.mockReset();
    generateAndStoreOfficialIndiaPostLabelPdf.mockReset();
    persistPackingSlip.mockReset();
  });

  it("retries unique shipments and reports failures", async () => {
    findReadyIndiaPostLabel
      .mockResolvedValueOnce({ id: "india-1", file_path: "a.pdf", file_url: null, status: "READY" })
      .mockResolvedValueOnce({ id: "india-2", file_path: "a.pdf", file_url: null, status: "READY" });
    findReadyMerchantLabel.mockResolvedValue(null);
    persistPackingSlip
      .mockResolvedValueOnce({ id: "pack-1" })
      .mockRejectedValueOnce(new Error("Could not render packing slip."));
    const result = await retryIncompleteLabelsByIds(
      supabaseForLabels([
        { id: "a", shipment_id: "ship-1" },
        { id: "b", shipment_id: "ship-2" },
        { id: "c", shipment_id: "ship-1" },
      ]) as never,
      "org-1",
      ["a", "b", "c", "missing"]
    );
    expect(result).toMatchObject({ retried: 1, failed: 2, skipped: 0 });
    expect(persistPackingSlip).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty or oversized selection", async () => {
    await expect(retryIncompleteLabelsByIds({} as never, "org-1", [])).rejects.toThrow(
      "Select at least one incomplete label."
    );
    await expect(
      retryIncompleteLabelsByIds(
        {} as never,
        "org-1",
        Array.from({ length: RETRY_INCOMPLETE_MAX + 1 }, (_, index) => `id-${index}`)
      )
    ).rejects.toThrow(`Retry at most ${RETRY_INCOMPLETE_MAX} labels at a time.`);
  });
});
