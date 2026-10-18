import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/api/errors";
import { hashSecret } from "@/lib/security/crypto";
import {
  PRINTING_STALE_MS,
  authenticatePrintAgent,
  claimNextPrintJob,
  completePrintJob,
  enqueueAutoPrintJob,
  enqueueManualPrintJob,
  isPrintAgentApiPath,
  isPrintAgentOnline,
  loadPrintJobPdf,
  printStatusForJob,
  recoverStalePrintJobs,
  reprintPrintJob,
  updatePrintSettings,
} from "@/modules/print/service";

type Job = {
  id: string;
  organization_id: string;
  shipment_id: string;
  label_id: string;
  printer_name: string | null;
  source: string;
  status: string;
  error_message: string | null;
  claimed_at: string | null;
  printed_at: string | null;
  created_at: string;
  paper_size?: string | null;
  copies?: number | null;
  delivery?: string | null;
  device_id?: string | null;
  claimed_by_device_id?: string | null;
  claim_id?: string | null;
};

type Device = {
  id: string;
  device_name: string;
  last_seen_at: string;
  last_printers: string[];
  status: string;
};

function printClient(state: {
  jobs: Job[];
  settings?: { selected_printer_name: string | null; selected_device_id?: string | null };
  agent?: { printers: string[]; token_hash?: string; token_prefix?: string };
  insertErrors?: Array<{ code?: string; message?: string } | null>;
  labels?: Array<{
    id: string;
    kind?: string;
    status?: string;
    shipment_id?: string;
    template_snapshot?: unknown;
  }>;
  devices?: Device[];
}) {
  const settings = {
    organization_id: "org-1",
    selected_printer_name: state.settings?.selected_printer_name ?? "Epson TM",
    selected_device_id: state.settings?.selected_device_id ?? null,
    paper_size: "A6",
    orientation: "portrait",
    copies: 1,
  };
  let insertCalls = 0;

  return {
    from: vi.fn((table: string) => {
      if (table === "print_settings") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: settings, error: null }),
              select: () => ({ single: async () => ({ data: settings, error: null }) }),
            }),
          }),
          insert: () => ({
            select: () => ({ single: async () => ({ data: settings, error: null }) }),
          }),
        };
      }
      if (table === "labels") {
        return {
          select: () => ({
            eq: () => ({
              eq: (_column: string, id: string) => ({
                maybeSingle: async () => ({
                  data: state.labels?.find((label) => label.id === id) ?? {
                    id,
                    shipment_id: "ship-1",
                    status: "READY",
                    kind: "INDIA_POST",
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "print_devices") {
        const chain = {
          eq: () => chain,
          maybeSingle: async () => ({ data: (state.devices ?? [])[0] ?? null, error: null }),
          then: (resolve: (value: { data: Device[]; error: null }) => void) =>
            resolve({ data: state.devices ?? [], error: null }),
        };
        return { select: () => chain };
      }
      if (table === "printers") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "audit_logs") {
        return { insert: async () => ({ error: null }) };
      }
      if (table === "print_agents") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "agent-1",
                  organization_id: "org-1",
                  printers: state.agent?.printers ?? ["Epson TM"],
                  token_hash: state.agent?.token_hash,
                  token_prefix: state.agent?.token_prefix,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: (column: string, value: string) => {
            const chain = {
              eq: (column2: string, value2: string) => {
                chain._filters[column2] = value2;
                return chain;
              },
              maybeSingle: async () => {
                const found = state.jobs.find((job) => {
                  return Object.entries(chain._filters).every(([key, expected]) =>
                    String((job as Record<string, unknown>)[key]) === String(expected)
                  );
                });
                return { data: found ?? null, error: null };
              },
              order: () => ({
                limit: async () => ({
                  data: state.jobs.filter((job) => {
                    return Object.entries(chain._filters).every(([key, expected]) =>
                      String((job as Record<string, unknown>)[key]) === String(expected)
                    );
                  }),
                  error: null,
                }),
              }),
              _filters: { [column]: value } as Record<string, string>,
            };
            return chain;
          },
        }),
        insert: (payload: Job) => {
          const err = state.insertErrors?.[insertCalls++] ?? null;
          if (err) {
            return { select: () => ({ single: async () => ({ data: null, error: err }) }) };
          }
          const row = {
            ...payload,
            id: payload.id ?? `job-${state.jobs.length + 1}`,
            created_at: new Date().toISOString(),
            claimed_at: null,
            printed_at: null,
            error_message: null,
          };
          state.jobs.push(row as Job);
          return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
        },
        update: (payload: Record<string, unknown>) => ({
          eq: (column: string, value: string) => {
            const chain = {
              eq: () => chain,
              lt: (_column: string, cutoff: string) => {
                for (const job of state.jobs) {
                  if (job.status === "PRINTING" && job.claimed_at && job.claimed_at < cutoff) {
                    Object.assign(job, payload);
                  }
                }
                return chain;
              },
              select: () => ({
                maybeSingle: async () => {
                  const job = state.jobs.find((item) => item.id === value || item[column as keyof Job] === value);
                  if (job && job.status === "PENDING") {
                    Object.assign(job, payload);
                    return { data: job, error: null };
                  }
                  return { data: job && payload.status ? { ...job, ...payload } : job, error: null };
                },
                single: async () => {
                  const job = state.jobs[0];
                  if (job) Object.assign(job, payload);
                  return { data: job, error: null };
                },
              }),
            };
            return chain;
          },
        }),
      };
    }),
  };
}

describe("print jobs", () => {
  it("treats an agent as online only within the heartbeat window", () => {
    expect(isPrintAgentOnline(new Date().toISOString())).toBe(true);
    expect(isPrintAgentOnline(new Date(Date.now() - 60_000).toISOString())).toBe(false);
    expect(isPrintAgentOnline(null)).toBe(false);
  });

  it("does not insert a second AUTO job for the same label", async () => {
    const existing: Job = {
      id: "job-1",
      organization_id: "org-1",
      shipment_id: "ship-1",
      label_id: "label-1",
      printer_name: "Epson TM",
      source: "AUTO",
      status: "PRINTED",
      error_message: null,
      claimed_at: null,
      printed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    const state = { jobs: [existing], insertErrors: [{ code: "23505", message: "duplicate key" }] };
    const supabase = printClient(state);
    const job = await enqueueAutoPrintJob(supabase as never, {
      organizationId: "org-1",
      shipmentId: "ship-1",
      labelId: "label-1",
    });
    expect(job.id).toBe("job-1");
    expect(state.jobs).toHaveLength(1);
  });

  it("creates an AUTO job when none exists", async () => {
    const state = { jobs: [] as Job[] };
    const supabase = printClient(state);
    const job = await enqueueAutoPrintJob(supabase as never, {
      organizationId: "org-1",
      shipmentId: "ship-1",
      labelId: "label-1",
    });
    expect(job.source).toBe("AUTO");
    expect(job.status).toBe("PENDING");
    expect(job.delivery).toBe("agent");
    expect(state.jobs).toHaveLength(1);
  });

  it("maps job status for the labels page", () => {
    expect(printStatusForJob({ status: "PRINTED" })).toBe("PRINTED");
    expect(printStatusForJob({ status: "PENDING" })).toBe("WAITING");
    expect(printStatusForJob({ status: "PRINTING" })).toBe("PRINTING");
    expect(printStatusForJob({ status: "NEEDS_REVIEW" })).toBe("NEEDS_REVIEW");
    expect(printStatusForJob({ status: "FAILED" })).toBe("FAILED");
    expect(printStatusForJob(null)).toBeNull();
  });

  it("rejects a missing print agent token", async () => {
    const supabase = printClient({ jobs: [] });
    await expect(authenticatePrintAgent(supabase as never, null)).rejects.toBeInstanceOf(AppError);
  });

  it("accepts a matching print agent bearer token", async () => {
    const token = "pb_print_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const supabase = printClient({
      jobs: [],
      agent: { printers: ["Epson TM"], token_hash: hashSecret(token), token_prefix: token.slice(0, 16) },
    });
    const agent = await authenticatePrintAgent(supabase as never, `Bearer ${token}`);
    expect(agent.organizationId).toBe("org-1");
  });

  it("returns the job paper size on claim so a test print can differ from station settings", async () => {
    const state = {
      jobs: [
        {
          id: "job-1",
          organization_id: "org-1",
          shipment_id: "ship-1",
          label_id: "label-1",
          printer_name: "Epson TM",
          source: "AUTO",
          status: "PENDING",
          error_message: null,
          claimed_at: null,
          printed_at: null,
          created_at: new Date().toISOString(),
          paper_size: "A5",
          copies: 2,
        },
      ] as Job[],
      settings: { selected_printer_name: "Epson TM" },
      agent: { printers: ["Epson TM"] },
    };
    const claimed = await claimNextPrintJob(printClient(state) as never, {
      agentId: "agent-1",
      organizationId: "org-1",
    });
    expect(claimed?.paperSize).toBe("A5");
    expect(claimed?.orientation).toBe("portrait");
    expect(claimed?.copies).toBe(2);
  });

  it("claims a custom label at the template page size and orientation", async () => {
    const state = {
      jobs: [
        {
          id: "job-1",
          organization_id: "org-1",
          shipment_id: "ship-1",
          label_id: "label-1",
          printer_name: "Epson TM",
          source: "MANUAL",
          status: "PENDING",
          error_message: null,
          claimed_at: null,
          printed_at: null,
          created_at: new Date().toISOString(),
          paper_size: "A4",
          copies: 1,
        },
      ] as Job[],
      settings: { selected_printer_name: "Epson TM" },
      agent: { printers: ["Epson TM"] },
      labels: [
        {
          id: "label-1",
          kind: "CUSTOM_SHIPPING",
          template_snapshot: {
            page: { widthMm: 297, heightMm: 210, widthPt: 841.89, heightPt: 595.28 },
          },
        },
      ],
    };
    const claimed = await claimNextPrintJob(printClient(state) as never, {
      agentId: "agent-1",
      organizationId: "org-1",
    });
    expect(claimed?.paperSize).toBe("A4");
    expect(claimed?.orientation).toBe("landscape");
    expect(claimed?.widthMm).toBeCloseTo(297, 1);
    expect(claimed?.heightMm).toBeCloseTo(210, 1);
  });

  it("keeps official and packing jobs portrait when a landscape snapshot is stored", async () => {
    for (const kind of ["INDIA_POST", "MERCHANT"] as const) {
      const state = {
        jobs: [
          {
            id: "job-1",
            organization_id: "org-1",
            shipment_id: "ship-1",
            label_id: "label-1",
            printer_name: "Epson TM",
            source: "MANUAL",
            status: "PENDING",
            error_message: null,
            claimed_at: null,
            printed_at: null,
            created_at: new Date().toISOString(),
            paper_size: kind === "INDIA_POST" ? "A6" : "A4",
            copies: 1,
          },
        ] as Job[],
        settings: { selected_printer_name: "Epson TM" },
        agent: { printers: ["Epson TM"] },
        labels: [
          {
            id: "label-1",
            kind,
            template_snapshot: {
              page: { widthMm: 297, heightMm: 210, widthPt: 841.89, heightPt: 595.28 },
            },
          },
        ],
      };
      const claimed = await claimNextPrintJob(printClient(state) as never, {
        agentId: "agent-1",
        organizationId: "org-1",
      });
      expect(claimed?.orientation).toBe("portrait");
      expect(claimed?.paperSize).toBe(kind === "INDIA_POST" ? "A6" : "A4");
    }
  });

  it("claims a job using printers reported by a paired Windows device", async () => {
    const state = {
      jobs: [
        {
          id: "job-1",
          organization_id: "org-1",
          shipment_id: "ship-1",
          label_id: "label-1",
          printer_name: "Microsoft Print to PDF",
          source: "AUTO",
          status: "PENDING",
          error_message: null,
          claimed_at: null,
          printed_at: null,
          created_at: new Date().toISOString(),
        },
      ] as Job[],
      settings: { selected_printer_name: "Microsoft Print to PDF" },
      agent: { printers: [] },
    };
    const claimed = await claimNextPrintJob(
      printClient(state) as never,
      { agentId: "device-1", organizationId: "org-1" },
      { printers: ["Microsoft Print to PDF"] }
    );
    expect(claimed?.job.id).toBe("job-1");
    expect(state.jobs[0].status).toBe("PRINTING");
  });

  it("does not claim a job when the selected printer is offline", async () => {
    const state = {
      jobs: [
        {
          id: "job-1",
          organization_id: "org-1",
          shipment_id: "ship-1",
          label_id: "label-1",
          printer_name: "Epson TM",
          source: "AUTO",
          status: "PENDING",
          error_message: null,
          claimed_at: null,
          printed_at: null,
          created_at: new Date().toISOString(),
        },
      ] as Job[],
      settings: { selected_printer_name: "Epson TM" },
      agent: { printers: ["Office Laser"] },
    };
    const claimed = await claimNextPrintJob(printClient(state) as never, {
      agentId: "agent-1",
      organizationId: "org-1",
    });
    expect(claimed).toBeNull();
    expect(state.jobs[0].status).toBe("PENDING");
  });

  it("moves stale PRINTING jobs to NEEDS_REVIEW", async () => {
    const state = {
      jobs: [
        {
          id: "job-1",
          organization_id: "org-1",
          shipment_id: "ship-1",
          label_id: "label-1",
          printer_name: "Epson TM",
          source: "AUTO",
          status: "PRINTING",
          error_message: null,
          claimed_at: new Date(Date.now() - PRINTING_STALE_MS - 1_000).toISOString(),
          printed_at: null,
          created_at: new Date().toISOString(),
        },
      ] as Job[],
    };
    await recoverStalePrintJobs(printClient(state) as never, "org-1");
    expect(state.jobs[0].status).toBe("NEEDS_REVIEW");
  });

  it("rejects a bearer token from another agent", async () => {
    const token = "pb_print_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const supabase = printClient({
      jobs: [],
      agent: {
        printers: ["Epson TM"],
        token_hash: hashSecret("pb_print_cccccccccccccccccccccccccccccccccccccccccccccccc"),
        token_prefix: token.slice(0, 16),
      },
    });
    await expect(authenticatePrintAgent(supabase as never, `Bearer ${token}`)).rejects.toBeInstanceOf(AppError);
  });

  it("does not return another organization's print job PDF", async () => {
    const state = {
      jobs: [
        {
          id: "job-1",
          organization_id: "org-1",
          shipment_id: "ship-1",
          label_id: "label-1",
          printer_name: "Epson TM",
          source: "AUTO",
          status: "PENDING",
          error_message: null,
          claimed_at: null,
          printed_at: null,
          created_at: new Date().toISOString(),
        },
      ] as Job[],
    };
    await expect(
      loadPrintJobPdf(printClient(state) as never, { agentId: "agent-2", organizationId: "org-2" }, "job-1")
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  it("does not claim a direct USB job", async () => {
    const state = {
      jobs: [
        {
          id: "usb-job",
          organization_id: "org-1",
          shipment_id: "ship-1",
          label_id: "label-1",
          printer_name: "Xprinter",
          source: "AUTO",
          status: "PENDING",
          error_message: null,
          claimed_at: null,
          printed_at: null,
          created_at: new Date().toISOString(),
          delivery: "webusb",
        },
        {
          id: "agent-job",
          organization_id: "org-1",
          shipment_id: "ship-2",
          label_id: "label-2",
          printer_name: "Epson TM",
          source: "AUTO",
          status: "PENDING",
          error_message: null,
          claimed_at: null,
          printed_at: null,
          created_at: new Date().toISOString(),
          delivery: "agent",
        },
      ] as Job[],
      settings: { selected_printer_name: "Epson TM" },
      agent: { printers: ["Epson TM"] },
    };
    const claimed = await claimNextPrintJob(printClient(state) as never, {
      agentId: "agent-1",
      organizationId: "org-1",
    });
    expect(claimed?.job.id).toBe("agent-job");
    expect(state.jobs[0].status).toBe("PENDING");
    expect(state.jobs[1].status).toBe("PRINTING");
  });

  it("does not let the print agent finish a direct USB job", async () => {
    const state = {
      jobs: [
        {
          id: "usb-job",
          organization_id: "org-1",
          shipment_id: "ship-1",
          label_id: "label-1",
          printer_name: "Xprinter",
          source: "AUTO",
          status: "PRINTING",
          error_message: null,
          claimed_at: new Date().toISOString(),
          printed_at: null,
          created_at: new Date().toISOString(),
          delivery: "webusb",
        },
      ] as Job[],
    };
    await expect(
      completePrintJob(printClient(state) as never, { agentId: "agent-1", organizationId: "org-1" }, "usb-job", {
        status: "PRINTED",
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(state.jobs[0].status).toBe("PRINTING");
  });

  it("claims an A3 sheet instead of remapping it to A6", async () => {
    const state = {
      jobs: [
        {
          id: "job-1",
          organization_id: "org-1",
          shipment_id: "ship-1",
          label_id: "label-1",
          printer_name: "Epson TM",
          source: "MANUAL",
          status: "PENDING",
          error_message: null,
          claimed_at: null,
          printed_at: null,
          created_at: new Date().toISOString(),
          paper_size: "A3",
          copies: 1,
        },
      ] as Job[],
      settings: { selected_printer_name: "Epson TM" },
      agent: { printers: ["Epson TM"] },
      labels: [
        {
          id: "label-1",
          kind: "CUSTOM_SHIPPING",
          template_snapshot: {
            page: { widthMm: 297, heightMm: 420, widthPt: 841.89, heightPt: 1190.55 },
          },
        },
      ],
    };
    const claimed = await claimNextPrintJob(printClient(state) as never, {
      agentId: "agent-1",
      organizationId: "org-1",
    });
    expect(claimed?.paperSize).toBe("A3");
    expect(claimed?.orientation).toBe("portrait");
  });

  it("saves A3 station paper and queues an A3 print job", async () => {
    let paperSize = "A6";
    const inserted: Array<Record<string, unknown>> = [];
    const settingsRow = () => ({
      organization_id: "org-1",
      selected_printer_name: "Epson TM",
      paper_size: paperSize,
      orientation: "portrait",
      copies: 1,
      auto_print_merchant: true,
    });
    const supabase = {
      from(table: string) {
        if (table === "print_settings") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: settingsRow(), error: null }),
              }),
            }),
            update: (patch: { paper_size?: string }) => ({
              eq: () => ({
                select: () => ({
                  single: async () => {
                    if (patch.paper_size) paperSize = patch.paper_size;
                    return { data: settingsRow(), error: null };
                  },
                }),
              }),
            }),
          };
        }
        if (table === "labels") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { id: "label-1", shipment_id: "ship-1", status: "READY", kind: "CUSTOM_SHIPPING" },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "print_devices") {
          const chain = {
            eq: () => chain,
            maybeSingle: async () => ({ data: null, error: null }),
            then: (resolve: (value: { data: never[]; error: null }) => void) => resolve({ data: [], error: null }),
          };
          return { select: () => chain };
        }
        if (table === "printers") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        return {
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                const saved = { ...row, id: "job-a3", created_at: new Date().toISOString() };
                inserted.push(saved);
                return { data: saved, error: null };
              },
            }),
          }),
        };
      },
    };
    const ctx = { organizationId: "org-1", userId: "user-1", role: "OWNER" as const };
    const settings = await updatePrintSettings(supabase as never, ctx, { paperSize: "A3" });
    expect(settings.paperSize).toBe("A3");
    const job = await enqueueManualPrintJob(supabase as never, ctx, "label-1", { paperSize: "A3", copies: 1 });
    expect(job.paper_size).toBe("A3");
    expect(inserted[0]?.paper_size).toBe("A3");
  });

  it("only exposes print-agent API paths", () => {
    expect(isPrintAgentApiPath("print-agent/heartbeat")).toBe(true);
    expect(isPrintAgentApiPath("print-agent/jobs/claim")).toBe(true);
    expect(isPrintAgentApiPath("print-jobs/job-1/pdf")).toBe(true);
    expect(isPrintAgentApiPath("print-jobs/job-1")).toBe(true);
    expect(isPrintAgentApiPath("print-jobs/job-1/claim")).toBe(false);
    expect(isPrintAgentApiPath("print-jobs/job-1/complete")).toBe(false);
    expect(isPrintAgentApiPath("print-jobs/job-1/reprint")).toBe(false);
    expect(isPrintAgentApiPath("print-station")).toBe(false);
    expect(isPrintAgentApiPath("labels/job-1/download")).toBe(false);
  });

  it("does not auto-claim a stale job after NEEDS_REVIEW", async () => {
    const state = {
      jobs: [
        {
          id: "job-1",
          organization_id: "org-1",
          shipment_id: "ship-1",
          label_id: "label-1",
          printer_name: "Epson TM",
          source: "AUTO",
          status: "PRINTING",
          error_message: null,
          claimed_at: new Date(Date.now() - PRINTING_STALE_MS - 1_000).toISOString(),
          printed_at: null,
          created_at: new Date().toISOString(),
        },
      ] as Job[],
      settings: { selected_printer_name: "Epson TM" },
      agent: { printers: ["Epson TM"] },
    };
    const claimed = await claimNextPrintJob(printClient(state) as never, {
      agentId: "agent-1",
      organizationId: "org-1",
    });
    expect(claimed).toBeNull();
    expect(state.jobs[0].status).toBe("NEEDS_REVIEW");
  });

  it("lets a pre-submit PENDING retry be claimed again", async () => {
    const state = {
      jobs: [
        {
          id: "job-1",
          organization_id: "org-1",
          shipment_id: "ship-1",
          label_id: "label-1",
          printer_name: "Epson TM",
          source: "MANUAL",
          status: "PRINTING",
          error_message: null,
          claimed_at: new Date().toISOString(),
          printed_at: null,
          created_at: new Date().toISOString(),
          claimed_by_device_id: null,
          claim_id: "claim-1",
        },
      ] as Job[],
      settings: { selected_printer_name: "Epson TM" },
      agent: { printers: ["Epson TM"] },
    };
    await completePrintJob(
      printClient(state) as never,
      { agentId: "agent-1", organizationId: "org-1" },
      "job-1",
      { status: "PENDING", errorMessage: "Printer offline" }
    );
    expect(state.jobs[0].status).toBe("PENDING");
    const claimed = await claimNextPrintJob(printClient(state) as never, {
      agentId: "agent-1",
      organizationId: "org-1",
    });
    expect(claimed?.job.id).toBe("job-1");
    expect(state.jobs[0].status).toBe("PRINTING");
  });

  it("accepts a late PRINTED ack on NEEDS_REVIEW from the same device", async () => {
    const state = {
      jobs: [
        {
          id: "job-1",
          organization_id: "org-1",
          shipment_id: "ship-1",
          label_id: "label-1",
          printer_name: "Epson TM",
          source: "MANUAL",
          status: "NEEDS_REVIEW",
          error_message: "verify",
          claimed_at: new Date().toISOString(),
          printed_at: null,
          created_at: new Date().toISOString(),
          device_id: "device-1",
          claimed_by_device_id: "device-1",
          claim_id: "claim-1",
        },
      ] as Job[],
    };
    const done = await completePrintJob(
      printClient(state) as never,
      { agentId: "device-1", organizationId: "org-1" },
      "job-1",
      { status: "PRINTED" },
      { source: "device" }
    );
    expect(done.status).toBe("PRINTED");
  });

  it("rejects a late ack from another device", async () => {
    const state = {
      jobs: [
        {
          id: "job-1",
          organization_id: "org-1",
          shipment_id: "ship-1",
          label_id: "label-1",
          printer_name: "Epson TM",
          source: "MANUAL",
          status: "NEEDS_REVIEW",
          error_message: "verify",
          claimed_at: new Date().toISOString(),
          printed_at: null,
          created_at: new Date().toISOString(),
          device_id: "device-1",
          claimed_by_device_id: "device-1",
          claim_id: "claim-1",
        },
      ] as Job[],
    };
    await expect(
      completePrintJob(
        printClient(state) as never,
        { agentId: "device-2", organizationId: "org-1" },
        "job-1",
        { status: "PRINTED" },
        { source: "device" }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.jobs[0].status).toBe("NEEDS_REVIEW");
  });

  it("only lets the owning device claim a job with the same printer name", async () => {
    const now = new Date().toISOString();
    const state = {
      jobs: [
        {
          id: "job-1",
          organization_id: "org-1",
          shipment_id: "ship-1",
          label_id: "label-1",
          printer_name: "Epson TM",
          source: "MANUAL",
          status: "PENDING",
          error_message: null,
          claimed_at: null,
          printed_at: null,
          created_at: now,
          device_id: "device-1",
        },
      ] as Job[],
      settings: { selected_printer_name: "Epson TM", selected_device_id: "device-1" },
      devices: [
        {
          id: "device-1",
          device_name: "Desk A",
          last_seen_at: now,
          last_printers: ["Epson TM"],
          status: "active",
        },
        {
          id: "device-2",
          device_name: "Desk B",
          last_seen_at: now,
          last_printers: ["Epson TM"],
          status: "active",
        },
      ],
    };
    const other = await claimNextPrintJob(
      printClient(state) as never,
      { agentId: "device-2", organizationId: "org-1" },
      { printers: ["Epson TM"], source: "device" }
    );
    expect(other).toBeNull();
    const owned = await claimNextPrintJob(
      printClient(state) as never,
      { agentId: "device-1", organizationId: "org-1" },
      { printers: ["Epson TM"], source: "device" }
    );
    expect(owned?.job.id).toBe("job-1");
  });

  it("lets the legacy agent claim only jobs with a null device_id", async () => {
    const now = new Date().toISOString();
    const state = {
      jobs: [
        {
          id: "paired",
          organization_id: "org-1",
          shipment_id: "ship-1",
          label_id: "label-1",
          printer_name: "Epson TM",
          source: "AUTO",
          status: "PENDING",
          error_message: null,
          claimed_at: null,
          printed_at: null,
          created_at: now,
          device_id: "device-1",
        },
        {
          id: "legacy",
          organization_id: "org-1",
          shipment_id: "ship-2",
          label_id: "label-2",
          printer_name: "Epson TM",
          source: "AUTO",
          status: "PENDING",
          error_message: null,
          claimed_at: null,
          printed_at: null,
          created_at: now,
          device_id: null,
        },
      ] as Job[],
      settings: { selected_printer_name: "Epson TM" },
      agent: { printers: ["Epson TM"] },
    };
    const claimed = await claimNextPrintJob(printClient(state) as never, {
      agentId: "agent-1",
      organizationId: "org-1",
    });
    expect(claimed?.job.id).toBe("legacy");
    expect(state.jobs[0].status).toBe("PENDING");
  });

  it("does not let a paired device claim a legacy null device_id job", async () => {
    const now = new Date().toISOString();
    const state = {
      jobs: [
        {
          id: "legacy",
          organization_id: "org-1",
          shipment_id: "ship-1",
          label_id: "label-1",
          printer_name: "Epson TM",
          source: "AUTO",
          status: "PENDING",
          error_message: null,
          claimed_at: null,
          printed_at: null,
          created_at: now,
          device_id: null,
        },
      ] as Job[],
      settings: { selected_printer_name: "Epson TM" },
      agent: { printers: ["Epson TM"] },
    };
    const claimed = await claimNextPrintJob(
      printClient(state) as never,
      { agentId: "device-1", organizationId: "org-1" },
      { printers: ["Epson TM"], source: "device" }
    );
    expect(claimed).toBeNull();
    expect(state.jobs[0].status).toBe("PENDING");
  });

  it("ignores a late ACK after the job is already PRINTED", async () => {
    const state = {
      jobs: [
        {
          id: "job-1",
          organization_id: "org-1",
          shipment_id: "ship-1",
          label_id: "label-1",
          printer_name: "Epson TM",
          source: "MANUAL",
          status: "PRINTED",
          error_message: null,
          claimed_at: new Date().toISOString(),
          printed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
      ] as Job[],
    };
    const done = await completePrintJob(
      printClient(state) as never,
      { agentId: "agent-1", organizationId: "org-1" },
      "job-1",
      { status: "FAILED", errorMessage: "too late" }
    );
    expect(done.status).toBe("PRINTED");
    expect(state.jobs[0].status).toBe("PRINTED");
  });

  it("creates a new MANUAL job on reprint and leaves the original in NEEDS_REVIEW", async () => {
    const state = {
      jobs: [
        {
          id: "job-old",
          organization_id: "org-1",
          shipment_id: "ship-1",
          label_id: "label-1",
          printer_name: "Epson TM",
          source: "MANUAL",
          status: "NEEDS_REVIEW",
          error_message: "verify",
          claimed_at: new Date().toISOString(),
          printed_at: null,
          created_at: new Date().toISOString(),
        },
      ] as Job[],
      settings: { selected_printer_name: "Epson TM" },
    };
    const reprinted = await reprintPrintJob(
      printClient(state) as never,
      { organizationId: "org-1", userId: "user-1", role: "OWNER" } as never,
      "job-old",
      { idempotencyKey: "print:manual:reprint-1" }
    );
    expect(reprinted.id).not.toBe("job-old");
    expect(reprinted.status).toBe("PENDING");
    expect(state.jobs[0].status).toBe("NEEDS_REVIEW");
    expect(reprinted.reprinted_from_job_id).toBe("job-old");
  });
});
