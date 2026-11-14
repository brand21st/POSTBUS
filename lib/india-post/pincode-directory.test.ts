import { describe, expect, it, vi } from "vitest";
import {
  indiaPostDirectoryOfficesFromFallbackResponse,
  indiaPostDirectoryOfficesFromResponse,
  lookupIndiaPostPincodeDirectory,
} from "./pincode-directory";

const sample = [
  {
    Status: "Success",
    PostOffice: [
      {
        Name: "Bangalore G.P.O.",
        District: "Bengaluru",
        State: "Karnataka",
        Block: "Bangalore North",
      },
      {
        Name: "Bangalore G.P.O.",
        District: "Bengaluru",
        State: "Karnataka",
      },
    ],
  },
];

describe("indiaPostDirectoryOfficesFromResponse", () => {
  it("maps District as city and drops duplicate offices", () => {
    expect(indiaPostDirectoryOfficesFromResponse(sample)).toEqual([
      { name: "Bangalore G.P.O.", city: "Bengaluru", state: "Karnataka" },
    ]);
  });

  it("returns no offices when the PIN is unknown", () => {
    expect(indiaPostDirectoryOfficesFromResponse([{ Status: "Error", PostOffice: null }])).toEqual([]);
  });
});

describe("lookupIndiaPostPincodeDirectory", () => {
  it("calls the India Post PIN directory for a 6-digit PIN", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => sample,
    });
    const result = await lookupIndiaPostPincodeDirectory("560001", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.postalpincode.in/pincode/560001",
      expect.objectContaining({ cache: "no-store", headers: { Accept: "application/json" } })
    );
    expect(result).toEqual({
      pincode: "560001",
      offices: [{ name: "Bangalore G.P.O.", city: "Bengaluru", state: "Karnataka" }],
    });
  });

  it("does not call the directory for an incomplete PIN", async () => {
    const fetchImpl = vi.fn();
    const result = await lookupIndiaPostPincodeDirectory("56001", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toEqual({ pincode: "56001", offices: [] });
  });

  it("falls back when postalpincode.in has no records for a real PIN", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ Message: "No records found", Status: "Error", PostOffice: null }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            pincode: "673323",
            post_offices: [
              {
                office_name: "Modakkallur Bo",
                district: "Kozhikode",
                state: "Kerala",
                office_type: "BO",
              },
              {
                office_name: "Ulliyeri So",
                district: "Kozhikode",
                state: "Kerala",
                office_type: "PO",
              },
            ],
          },
        }),
      });

    const result = await lookupIndiaPostPincodeDirectory("673323", fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://api.postalpincode.in/pincode/673323",
      expect.objectContaining({ cache: "no-store", headers: { Accept: "application/json" } })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.pincodeapi.in/api/v1/pincode/673323",
      expect.objectContaining({ cache: "no-store", headers: { Accept: "application/json" } })
    );
    expect(result).toEqual({
      pincode: "673323",
      offices: [
        { name: "Ulliyeri So", city: "Kozhikode", state: "Kerala" },
        { name: "Modakkallur Bo", city: "Kozhikode", state: "Kerala" },
      ],
    });
  });
});

describe("indiaPostDirectoryOfficesFromFallbackResponse", () => {
  it("maps district as city and lists the sub office first", () => {
    expect(
      indiaPostDirectoryOfficesFromFallbackResponse({
        success: true,
        data: {
          post_offices: [
            { office_name: "Oravil Bo", district: "Kozhikode", state: "Kerala", office_type: "BO" },
            { office_name: "Ulliyeri So", district: "Kozhikode", state: "Kerala", office_type: "PO" },
          ],
        },
      })
    ).toEqual([
      { name: "Ulliyeri So", city: "Kozhikode", state: "Kerala" },
      { name: "Oravil Bo", city: "Kozhikode", state: "Kerala" },
    ]);
  });
});
