import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/api/errors";
import { hashSecret } from "@/lib/security/crypto";
import {
  PRINTING_STALE_MS,
  authenticatePrintAgent,
  claimNextPrintJob,
  enqueueAutoPrintJob,
  isPrintAgentApiPath,
  isPrintAgentOnline,
  loadPrintJobPdf,
  printStatusForJob,
  recoverStalePrintJobs,
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
};

function printClient(state: {
  jobs: Job[];
  settings?: { selected_printer_name: string | null };
  agent?: { printers: string[]; token_hash?: string; token_prefix?: string };
  insertErrors?: Array<{ code?: string; message?: string } | null>;
}) {
  const settings = {
    organization_id: "org-1",
    selected_printer_name: state.settings?.selected_printer_name ?? "Epson TM",
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
              lt: () => {
                const cutoff = Date.now() - PRINTING_STALE_MS / 2;
                for (const job of state.jobs) {
                  if (job.status === "PRINTING") {
                    Object.assign(job, payload);
                  }
                }
                void cutoff;
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
    expect(state.jobs).toHaveLength(1);
  });

  it("maps job status for the labels page", () => {
    expect(printStatusForJob({ status: "PRINTED" })).toBe("PRINTED");
    expect(printStatusForJob({ status: "PENDING" })).toBe("WAITING");
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
    expect(claimed?.copies).toBe(2);
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

  it("resets stale PRINTING jobs to PENDING", async () => {
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
    expect(state.jobs[0].status).toBe("PENDING");
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

  it("only exposes print-agent API paths", () => {
    expect(isPrintAgentApiPath("print-agent/heartbeat")).toBe(true);
    expect(isPrintAgentApiPath("print-agent/jobs/claim")).toBe(true);
    expect(isPrintAgentApiPath("print-jobs/job-1/pdf")).toBe(true);
    expect(isPrintAgentApiPath("print-jobs/job-1")).toBe(true);
    expect(isPrintAgentApiPath("print-station")).toBe(false);
    expect(isPrintAgentApiPath("labels/job-1/download")).toBe(false);
  });
});
