import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/security/rate-limit", () => ({
  rateLimit: () => ({ ok: true, remaining: 29 }),
}));

const lookupIndiaPostPincodeDirectory = vi.fn();

vi.mock("@/lib/india-post/pincode-directory", () => ({
  lookupIndiaPostPincodeDirectory: (...args: unknown[]) => lookupIndiaPostPincodeDirectory(...args),
}));

import { GET } from "@/app/api/v1/auth/pincode/route";

function get(pincode: string) {
  return GET(
    new NextRequest(`http://localhost:3000/api/v1/auth/pincode?pincode=${encodeURIComponent(pincode)}`)
  );
}

describe("GET /api/v1/auth/pincode", () => {
  beforeEach(() => {
    lookupIndiaPostPincodeDirectory.mockReset();
  });

  it("rejects an incomplete PIN", async () => {
    const response = await get("56001");
    expect(response.status).toBe(422);
    expect(lookupIndiaPostPincodeDirectory).not.toHaveBeenCalled();
  });

  it("returns India Post directory offices for a valid PIN", async () => {
    lookupIndiaPostPincodeDirectory.mockResolvedValue({
      pincode: "560001",
      offices: [{ name: "Bangalore G.P.O.", city: "Bengaluru", state: "Karnataka" }],
    });
    const response = await get("560001");
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.data.offices[0].city).toBe("Bengaluru");
    expect(lookupIndiaPostPincodeDirectory).toHaveBeenCalledWith("560001");
  });
});
