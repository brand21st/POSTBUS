import { describe, expect, it, vi } from "vitest";
import { fetchPackingSlipPdf, packingCustomerFromShopifyAddress, packingMerchantFromOrganization, packingParty, packingPartyForSlip } from "@/modules/labels/packing-fetch";

const goodAddress = {
  name: "Priya Nair",
  phone: "9876501234",
  line1: "14 Lake View",
  line2: "MG Road",
  city: "Ernakulam",
  state: "Kerala",
  pincode: "682016",
};

const goodOrg = {
  name: "Sample Store",
  phone: "9876543210",
  line1: "12 Market Road",
  line2: null,
  city: "Kochi",
  state: "Kerala",
  pincode: "682311",
  logo_path: null,
};

function query(data: unknown) {
  const list = { data: Array.isArray(data) ? data : data == null ? [] : [data], error: null };
  const single = { data, error: null };
  const self: Record<string, unknown> = {};
  self.select = () => self;
  self.eq = () => self;
  self.order = () => self;
  self.limit = () => self;
  self.maybeSingle = async () => single;
  self.single = async () => single;
  self.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(list).then(resolve, reject);
  return self;
}

function client(overrides?: {
  address?: Record<string, unknown> | null;
  customerPhone?: string;
  org?: Record<string, unknown> | null;
}) {
  const address = overrides?.address === undefined ? goodAddress : overrides.address;
  const org = overrides?.org === undefined ? goodOrg : overrides.org;
  return {
    from: vi.fn((table: string) => {
      if (table === "shipments") {
        return query({
          id: "ship-1",
          order_id: "ord-1",
          payment_mode: "COD",
          cod_amount: 799,
          orders: {
            id: "ord-1",
            order_number: "#1001",
            source_order_id: "1042",
            payment_status: "COD",
            subtotal: 799,
            discount: 0,
            shipping_amount: 0,
            total_amount: 799,
            metadata: {},
            shipping_address: address,
          },
          customers: { name: "Priya Nair", phone: overrides?.customerPhone ?? "9876501234" },
          addresses: address,
        });
      }
      if (table === "pickup_locations") return query(null);
      if (table === "organizations") return query(org);
      if (table === "shopify_stores") return query({ shop_name: "Sample Store", shop_domain: "sample.myshopify.com" });
      if (table === "order_line_items") {
        return query([{ title: "Cotton Shirt", sku: "SHIRT-BLK", quantity: 1, unit_price: 799 }]);
      }
      if (table === "label_templates") return query(null);
      return query({});
    }),
    storage: {
      from: () => ({ download: async () => ({ data: null }) }),
    },
  };
}

describe("packingParty", () => {
  it("builds receiver name, street, city/state, pincode, and phone from a Shopify address", () => {
    const party = packingParty(goodAddress, "receiver");
    expect(party.name).toBe("Priya Nair");
    expect(party.phone).toBe("9876501234");
    expect(party.lines.join(" ")).toContain("14 Lake View");
    expect(party.lines.join(" ")).toContain("Ernakulam");
    expect(party.lines.join(" ")).toContain("Kerala");
    expect(party.lines.join(" ")).toMatch(/682016/);
  });

  it("rejects Address pending", () => {
    expect(() => packingParty({ ...goodAddress, line1: "Address pending" }, "receiver")).toThrow(
      /Receiver address/
    );
  });

  it("rejects NA city and state", () => {
    expect(() => packingParty({ ...goodAddress, city: "NA" }, "receiver")).toThrow(/Receiver city/);
    expect(() => packingParty({ ...goodAddress, state: "NA" }, "receiver")).toThrow(/Receiver state/);
  });

  it("rejects placeholder phone 0000000000", () => {
    expect(() => packingParty({ ...goodAddress, phone: "0000000000" }, "receiver")).toThrow(
      /Receiver phone/
    );
  });
});

describe("packing address sources", () => {
  it("takes the merchant FROM address only from Organization", () => {
    const sender = packingParty(packingMerchantFromOrganization(goodOrg), "sender");
    expect(sender.name).toBe("Sample Store");
    expect(sender.lines.join(" ")).toContain("12 Market Road");
    expect(sender.lines.join(" ")).toContain("Kochi");
    expect(sender.lines.join(" ")).toMatch(/682311/);
  });

  it("takes SHIP TO from the Shopify shipping address", () => {
    const receiver = packingParty(
      packingCustomerFromShopifyAddress(
        {
          name: "Priya Nair",
          address1: "14 Lake View",
          city: "Ernakulam",
          province: "Kerala",
          zip: "682016",
          phone: "9876501234",
        },
        { name: "Other", phone: "9000000000" }
      ),
      "receiver"
    );
    expect(receiver.name).toBe("Priya Nair");
    expect(receiver.lines.join(" ")).toContain("14 Lake View");
    expect(receiver.phone).toBe("9876501234");
  });

  it("still builds a packing party when organization street is missing", () => {
    const sender = packingPartyForSlip(
      packingMerchantFromOrganization({ name: "AURIMO BY NISH", city: "Ernakulam", state: "Kerala", pincode: "682311", phone: "9605658104" }),
      "sender"
    );
    expect(sender.name).toBe("AURIMO BY NISH");
    expect(sender.lines.join(" ")).toContain("Ernakulam");
  });
});

describe("fetchPackingSlipPdf", () => {
  it("renders a packing slip from a stored Shopify shipping address", async () => {
    const result = await fetchPackingSlipPdf(client() as never, "org-1", "ship-1");
    expect(result.shipmentId).toBe("ship-1");
    expect(result.template.elements.receiverName?.visible).toBe(true);
    expect(Buffer.from(result.pdf).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("falls back to the customer phone when the address phone is empty", async () => {
    const result = await fetchPackingSlipPdf(
      client({ address: { ...goodAddress, phone: "" }, customerPhone: "9876501234" }) as never,
      "org-1",
      "ship-1"
    );
    expect(result.shipmentId).toBe("ship-1");
    expect(Buffer.from(result.pdf).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("still generates a packing slip when organization street is missing", async () => {
    const result = await fetchPackingSlipPdf(
      client({ org: { ...goodOrg, line1: null } }) as never,
      "org-1",
      "ship-1"
    );
    expect(Buffer.from(result.pdf).subarray(0, 4).toString()).toBe("%PDF");
  });
});
