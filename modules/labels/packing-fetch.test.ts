import { describe, expect, it, vi } from "vitest";
import { fetchPackingSlipPdf, packingParty } from "@/modules/labels/packing-fetch";

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
}) {
  const address = overrides?.address === undefined ? goodAddress : overrides.address;
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
          },
          customers: { name: "Priya Nair", phone: overrides?.customerPhone ?? "9876501234" },
          addresses: address,
        });
      }
      if (table === "pickup_locations") return query(null);
      if (table === "organizations") return query(goodOrg);
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
});
