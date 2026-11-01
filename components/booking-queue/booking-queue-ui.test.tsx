import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { enqueueResultMessage } from "@/components/booking-queue/add-to-queue-button";
import { QueueKpiStrip } from "@/components/booking-queue/queue-kpi-strip";
import {
  parseQueueUrl,
  QUEUE_KPI_CARDS,
  QUEUE_STATE_LABELS,
  QUEUE_SUMMARY_KEY,
  queueApiQuery,
  queueRefetchInterval,
  queueStateVariant,
  queueUrl,
} from "@/components/booking-queue/view";
import { wizardStepForImportStatus } from "@/components/bookings/bulk-excel-wizard";
import { BOOKING_QUEUE_STATES, QUEUE_SUMMARY_BUCKETS } from "@/modules/booking-queue/state";
import { historyItemsByShipment, publicHistoryRow, type QueueSummary } from "@/modules/booking-queue/service";

vi.mock("@/lib/hooks/use-api", () => ({ api: vi.fn(() => new Promise(() => undefined)) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboard/orders/bulk-excel",
  useSearchParams: () => new URLSearchParams("bucket=ready&q=asha"),
}));

const { BulkBookingPage } = await import("@/components/booking-queue/bulk-booking-page");

function summary(overrides: Partial<QueueSummary> = {}): QueueSummary {
  return {
    enabled: true,
    counts: { total: 12, waitingApproval: 3, invalid: 1, ready: 4, processing: 0, booked: 2, failed: 1, recovery: 1, excluded: 0 },
    oldestReadyAt: null,
    activeRuns: 0,
    settings: { mode: "MANUAL", batchThreshold: 50, maxWaitMinutes: null, paused: false },
    ...overrides,
  };
}

function renderWith(client: QueryClient, node: React.ReactNode) {
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("URL state", () => {
  it("round-trips tab, bucket, source, search, page and import", () => {
    const state = {
      tab: "history" as const,
      bucket: "ready" as const,
      source: "SHOPIFY",
      q: "asha",
      page: 3,
      importId: "11111111-2222-4333-8444-555555555555",
    };
    expect(parseQueueUrl(new URLSearchParams(queueUrl(state).slice(1)))).toEqual(state);
  });

  it("falls back to safe defaults for unknown values", () => {
    expect(parseQueueUrl(new URLSearchParams("tab=nope&bucket=hack&page=-4&import=not-a-uuid"))).toEqual({
      tab: "queue",
      bucket: "all",
      source: "all",
      q: "",
      page: 1,
      importId: null,
    });
    expect(queueUrl({ tab: "queue", bucket: "all", source: "all", q: " ", page: 1, importId: null })).toBe("");
  });

  it("opens the imports tab for a shared import link", () => {
    expect(parseQueueUrl(new URLSearchParams("import=11111111-2222-4333-8444-555555555555")).tab).toBe("imports");
  });

  it("builds list queries from the filters", () => {
    expect(queueApiQuery({ bucket: "ready", source: "all", q: " x ", page: 2, pageSize: 25 })).toBe("page=2&pageSize=25&state=ready&q=x");
    expect(queueApiQuery({ page: 1, pageSize: 25, from: "2026-11-01T00:00:00.000Z" })).toContain("from=2026-11-01");
  });
});

describe("labels and polling", () => {
  it("names every queue state and gives booked a success badge", () => {
    for (const state of BOOKING_QUEUE_STATES) expect(QUEUE_STATE_LABELS[state]).toBeTruthy();
    expect(queueStateVariant("BOOKED")).toBe("success");
    expect(queueStateVariant("RECOVERY_REQUIRED")).toBe("error");
  });

  it("has a card for every summary bucket except excluded, plus the total", () => {
    const buckets = QUEUE_KPI_CARDS.map((card) => card.bucket);
    expect(buckets[0]).toBe("all");
    expect(new Set(buckets)).toEqual(new Set(["all", ...Object.keys(QUEUE_SUMMARY_BUCKETS).filter((b) => b !== "excluded")]));
  });

  it("polls fast only while something is processing", () => {
    expect(queueRefetchInterval(undefined)).toBe(30_000);
    expect(queueRefetchInterval(summary())).toBe(30_000);
    expect(queueRefetchInterval(summary({ activeRuns: 1 }))).toBe(3_000);
    expect(queueRefetchInterval({ counts: { processing: 5 }, activeRuns: 0 })).toBe(3_000);
  });
});

describe("history mapping", () => {
  const shipment = {
    id: "s1",
    order_id: "o1",
    barcode: null,
    tracking_number: "EA000000001IN",
    status: "LABEL_READY",
    service_code: "SP_INLAND_PARCEL",
    booked_at: "2026-11-01T10:00:00Z",
    orders: { order_number: "#1001", source: "SHOPIFY", customers: { name: "Asha", phone: "9876543210" }, shipping_address: { pincode: "682001" } },
  };

  it("labels a booking made from the Orders page as direct", () => {
    expect(publicHistoryRow(shipment, undefined)).toMatchObject({
      orderNumber: "#1001",
      source: "SHOPIFY",
      barcode: "EA000000001IN",
      bookedVia: "DIRECT",
      queueItemId: null,
    });
  });

  it("prefers the queue item that recorded the booking", () => {
    const items = historyItemsByShipment([
      { id: "newer", shipment_id: "s1", run_id: null, source: "MANUAL", state: "EXCLUDED" },
      { id: "booked", shipment_id: "s1", run_id: "run-1", source: "EXCEL", state: "BOOKED" },
    ]);
    expect(publicHistoryRow(shipment, items.get("s1"))).toMatchObject({ queueItemId: "booked", source: "EXCEL", bookedVia: "QUEUE" });
  });
});

describe("imports and enqueue feedback", () => {
  it("resumes a saved import at the matching wizard step", () => {
    expect(wizardStepForImportStatus("mapped")).toBe(1);
    expect(wizardStepForImportStatus("validated")).toBe(2);
    expect(wizardStepForImportStatus("draft")).toBe(3);
    expect(wizardStepForImportStatus("booking")).toBe(4);
    expect(wizardStepForImportStatus("completed")).toBe(4);
  });

  it("summarises an enqueue result", () => {
    expect(
      enqueueResultMessage({
        enqueued: [
          { orderId: "a", itemId: "1", state: "WAITING_APPROVAL", warnings: [] },
          { orderId: "b", itemId: "2", state: "INVALID", warnings: [] },
        ],
        skipped: [{ orderId: "c", orderNumber: "#3", code: "ALREADY_BOOKED", reason: "#3 is already booked with India Post." }],
      })
    ).toBe("2 added to Bulk Booking (1 need fixing). #3 skipped: #3 is already booked with India Post.");
    expect(enqueueResultMessage({ enqueued: [], skipped: [] })).toBe("Nothing was added.");
  });
});

describe("rendering", () => {
  it("shows the summary counts on the cards", () => {
    const html = renderWith(new QueryClient(), <QueueKpiStrip summary={summary()} active="ready" onSelect={() => undefined} />);
    expect(html).toContain("Total in queue");
    expect(html).toContain(">12<");
    expect(html).toContain('aria-pressed="true"');
  });

  it("keeps the existing Excel wizard for workspaces outside the rollout", () => {
    const client = new QueryClient();
    client.setQueryData(QUEUE_SUMMARY_KEY, summary({ enabled: false }));
    const html = renderWith(client, <BulkBookingPage />);
    expect(html).toContain("Bulk Excel Booking");
    expect(html).not.toContain("Total in queue");
  });

  it("shows the queue dashboard with URL filters applied for workspaces in the rollout", () => {
    const client = new QueryClient();
    client.setQueryData(QUEUE_SUMMARY_KEY, summary());
    const html = renderWith(client, <BulkBookingPage />);
    expect(html).toContain("Bulk Booking");
    expect(html).toContain("Total in queue");
    expect(html).toContain("Excel imports");
    expect(html).toContain("one article per request");
    expect(html).toContain('value="asha"');
  });
});
