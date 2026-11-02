/**
 * @vitest-environment happy-dom
 */
import { act, useState, type ReactNode } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataTable, type DataTableColumn } from "@/components/dashboard/data-table";
import { OrderDimensionBadge } from "@/components/orders/order-dimension-badge";
import type { OrderRecord } from "@/types/api";

vi.mock("@/lib/hooks/use-api", () => ({
  api: vi.fn(async (url: string) => {
    if (String(url).includes("shipment-presets")) return [];
    return {
      orderId: "ord-1",
      shipmentId: null,
      decision: { kind: "MANUAL_REVIEW_REQUIRED", reason: "NO_HISTORY", message: "" },
      autoSelectionEnabled: false,
    };
  }),
  ApiError: class ApiError extends Error {
    status = 0;
    body: unknown = null;
  },
}));

const order = {
  id: "ord-1",
  orderNumber: "veyncul-1145",
  source: "SHOPIFY",
  status: "READY",
  parcelWeightMode: "manual",
  parcelWeightGrams: 800,
  shipment: { id: "shp-1", status: "DRAFT", serviceCode: "SP_INLAND_PARCEL", weightGrams: 800 },
  lineItems: [],
} as OrderRecord;

const savedOrder = {
  ...order,
  id: "ord-saved",
  orderNumber: "veyncul-1143",
  shipment: {
    id: "shp-saved",
    status: "DRAFT",
    serviceCode: "SP_INLAND_PARCEL",
    weightGrams: 800,
    lengthCm: 40,
    widthCm: 35,
    heightCm: 2,
    metadata: { parcelDimensions: { source: "postbus_preset" } },
  },
} as OrderRecord;

function fieldValue(label: string) {
  const match = [...document.querySelectorAll("label")].find((node) => node.textContent?.includes(label));
  const id = match?.getAttribute("for");
  const input = id ? document.getElementById(id) : null;
  return input instanceof HTMLInputElement ? input.value : "";
}

function Probe() {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" onClick={() => setOpen(true)}>
      {open ? "cell-open" : "cell-closed"}
    </button>
  );
}

function CellTable({ tick }: { tick: number }) {
  const columns: DataTableColumn<{ id: string }>[] = [
    { id: "dimensions", header: "Parcel", cell: () => <Probe /> },
  ];
  void tick;
  return (
    <DataTable
      columns={columns}
      data={[{ id: "1" }]}
      getRowId={(row) => row.id}
      total={1}
      page={1}
      pageSize={20}
    />
  );
}

function ParcelPage({ tick }: { tick: number }) {
  const [parcel, setParcel] = useState<OrderRecord | null>(null);
  const columns: DataTableColumn<OrderRecord>[] = [
    {
      id: "dimensions",
      header: "Parcel",
      cell: (row) => (
        <OrderDimensionBadge
          order={row}
          onEdit={() => {
            window.setTimeout(() => setParcel(row), 0);
          }}
        />
      ),
    },
  ];
  void tick;
  return (
    <QueryClientProvider client={new QueryClient()}>
      {parcel ? (
        <OrderDimensionBadge
          order={parcel}
          dialogOnly
          open
          onOpenChange={(next) => {
            if (!next) setParcel(null);
          }}
        />
      ) : null}
      <DataTable
        columns={columns}
        data={[order]}
        getRowId={(row) => row.id}
        total={1}
        page={1}
        pageSize={20}
      />
      <button type="button" onClick={() => setParcel((current) => (current ? { ...current } : current))}>
        Refresh list
      </button>
    </QueryClientProvider>
  );
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(node);
  });
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = "";
});

describe("parcel editor stays open", () => {
  it("keeps cell state when the orders table rebuilds its columns", () => {
    mount(<CellTable tick={0} />);
    const button = document.querySelector("button");
    expect(button?.textContent).toContain("cell-closed");
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("cell-open");

    act(() => {
      root?.render(<CellTable tick={1} />);
    });
    expect(document.body.textContent).toContain("cell-open");
  });

  it("keeps Add parcel size open after the order list refreshes", async () => {
    mount(<ParcelPage tick={0} />);
    const noSize = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("No size")
    );
    expect(noSize).toBeTruthy();

    await act(async () => {
      noSize?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(document.body.textContent).toContain("Add parcel size");

    const refresh = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Refresh list")
    );
    await act(async () => {
      refresh?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      root?.render(<ParcelPage tick={1} />);
    });
    expect(document.body.textContent).toContain("Add parcel size");
  });

  it("opens a saved pack size with its box already filled in", async () => {
    function SavedPage() {
      const [parcel, setParcel] = useState<OrderRecord | null>(null);
      return (
        <QueryClientProvider client={new QueryClient()}>
          {parcel ? (
            <OrderDimensionBadge order={parcel} dialogOnly open onOpenChange={() => undefined} />
          ) : null}
          <OrderDimensionBadge
            order={savedOrder}
            onEdit={() => {
              window.setTimeout(() => setParcel(savedOrder), 0);
            }}
          />
        </QueryClientProvider>
      );
    }

    mount(<SavedPage />);
    const saved = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("40×35×2"));
    expect(saved?.textContent).toContain("Saved");

    await act(async () => {
      saved?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(document.body.textContent).toContain("Edit parcel");
    expect(fieldValue("Length")).toBe("40");
    expect(fieldValue("Width")).toBe("35");
    expect(fieldValue("Height")).toBe("2");
    expect(fieldValue("Box weight")).toBe("800");
  });

  it("opens the saved box when the parcel cell is clicked outside the pill", async () => {
    function SavedTable() {
      const [parcel, setParcel] = useState<OrderRecord | null>(null);
      const columns: DataTableColumn<OrderRecord>[] = [
        {
          id: "dimensions",
          header: "Parcel",
          cell: (row) => (
            <OrderDimensionBadge
              order={row}
              onEdit={() => {
                window.setTimeout(() => setParcel(row), 0);
              }}
            />
          ),
        },
      ];
      return (
        <QueryClientProvider client={new QueryClient()}>
          {parcel ? <OrderDimensionBadge order={parcel} dialogOnly open onOpenChange={() => undefined} /> : null}
          <DataTable
            columns={columns}
            data={[savedOrder]}
            getRowId={(row) => row.id}
            total={1}
            page={1}
            pageSize={20}
            onRowClick={() => {
              document.body.dataset.rowNavigated = "yes";
            }}
          />
        </QueryClientProvider>
      );
    }

    mount(<SavedTable />);
    const cell = document.querySelector("tbody [data-col-id='dimensions']");
    expect(cell).toBeTruthy();
    await act(async () => {
      cell?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(document.body.dataset.rowNavigated).toBeUndefined();
    expect(document.body.textContent).toContain("Edit parcel");
    expect(fieldValue("Length")).toBe("40");
    expect(fieldValue("Width")).toBe("35");
    expect(fieldValue("Height")).toBe("2");
  });
});
