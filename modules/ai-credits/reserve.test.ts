import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  finalizeAiCreditReservation,
  releaseAiCreditReservation,
  reserveAiCredits,
} from "@/modules/ai-credits/service";

const rpc = vi.fn();

describe("AI image credit reserve", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("returns insufficient without treating it as reserved", async () => {
    rpc.mockResolvedValue({
      data: { remaining: 2, reserved: false, duplicate: false, status: "INSUFFICIENT" },
      error: null,
    });
    const result = await reserveAiCredits({ rpc } as never, "org-1", {
      qty: 10,
      reason: "AI_IMAGE_STUDIO",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.reserved).toBe(false);
    expect(result.status).toBe("INSUFFICIENT");
  });

  it("releases a reservation on failure", async () => {
    rpc.mockResolvedValue({ data: { ok: true, status: "RELEASED", remaining: 12 }, error: null });
    const result = await releaseAiCreditReservation(
      { rpc } as never,
      "org-1",
      "11111111-1111-4111-8111-111111111111"
    );
    expect(result?.status).toBe("RELEASED");
    expect(rpc).toHaveBeenCalledWith("release_ai_credit_reservation", expect.any(Object));
  });

  it("finalize is idempotent", async () => {
    rpc.mockResolvedValue({ data: { ok: true, duplicate: true, status: "POSTED", remaining: 2 }, error: null });
    const result = await finalizeAiCreditReservation(
      { rpc } as never,
      "org-1",
      "11111111-1111-4111-8111-111111111111"
    );
    expect(result?.duplicate).toBe(true);
    expect(result?.status).toBe("POSTED");
  });
});
