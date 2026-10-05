import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/security/crypto";
import { IndiaPostProvider } from "@/modules/india-post/provider";

describe("IndiaPostProvider.searchPostOffices", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns offices from CEPT pincode-search data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toContain("/v1/pincode-search?pincode=682311&office-type=post");
        expect(init?.headers).toMatchObject({ Authorization: "Bearer test-token" });
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                office_id: "22660454",
                office_name: "Kolenchery SO",
                pincode: "682311",
                city_name: "Ernakulam",
                state_name: "Kerala",
                office_type_code: "SO",
              },
            ],
          }),
        };
      })
    );

    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_access_token: encryptSecret("test-token"),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });

    const offices = await provider.searchPostOffices("682311");
    expect(offices).toHaveLength(1);
    expect(offices[0]?.office_id).toBe("22660454");
    expect(offices[0]?.office_name).toBe("Kolenchery SO");
  });

  it("accepts a raw office array from pincode-search", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          {
            office_id: "21360043",
            office_name: "Mysuru H.O",
            delivery_office_flag: true,
            office_type_code: "HPO",
          },
        ],
      }))
    );

    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_access_token: encryptSecret("test-token"),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });

    const offices = await provider.searchPostOffices("570001");
    expect(offices[0]?.office_id).toBe("21360043");
  });

  it("returns an empty list for invalid pincode without calling CEPT", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_access_token: encryptSecret("test-token"),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });

    expect(await provider.searchPostOffices("12")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not expose India Post errors when pincode-search fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ message: "invalid_token secret" }),
      }))
    );

    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_access_token: encryptSecret("test-token"),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });

    await expect(provider.searchPostOffices("570001")).rejects.toThrow(
      "Unable to fetch India Post offices. Please try again."
    );
  });
});
