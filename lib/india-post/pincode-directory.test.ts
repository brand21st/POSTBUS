import { describe, expect, it, vi } from "vitest";
import {
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
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.postalpincode.in/pincode/560001",
      expect.objectContaining({ headers: { Accept: "application/json" } })
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
});
