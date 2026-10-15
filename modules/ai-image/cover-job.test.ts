import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/api/context";
import { AppError } from "@/lib/api/errors";

const getImageStudioConfig = vi.hoisted(() => vi.fn());
const getAiCreditsRemaining = vi.hoisted(() => vi.fn());
const reserveAiCredits = vi.hoisted(() => vi.fn());
const releaseAiCreditReservation = vi.hoisted(() => vi.fn());
const finalizeAiCreditReservation = vi.hoisted(() => vi.fn());
const createBackgroundJob = vi.hoisted(() => vi.fn());
const runQueuedJobsNow = vi.hoisted(() => vi.fn());
const editProductImage = vi.hoisted(() => vi.fn());
const composeOfferPoster = vi.hoisted(() => vi.fn());

vi.mock("@/modules/ai-image/config", () => ({ getImageStudioConfig }));
vi.mock("@/modules/ai-credits/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/ai-credits/service")>();
  return {
    ...actual,
    getAiCreditsRemaining,
    reserveAiCredits,
    releaseAiCreditReservation,
    finalizeAiCreditReservation,
  };
});
vi.mock("@/modules/jobs/service", () => ({ createBackgroundJob }));
vi.mock("@/lib/jobs/drain", () => ({
  claimedJobFromRow: (row: unknown) => row,
  runQueuedJobsNow,
}));
vi.mock("@/modules/ai-image/openrouter-image", () => ({
  bufferToDataUrl: () => "data:image/png;base64,xx",
  editProductImage,
}));
vi.mock("@/modules/ai-image/offer-compose", () => ({ composeOfferPoster }));

const ctx: TenantContext = {
  userId: "user-1",
  email: "merchant@example.com",
  fullName: "Merchant",
  organizationId: "org-1",
  organizationName: "Shop",
  role: "OWNER",
  permissions: ["products.write"],
};

const SESSION = "11111111-1111-4111-8111-111111111111";
const SOURCE = "22222222-2222-4222-8222-222222222222";
const KEY = "33333333-3333-4333-8333-333333333333";

type JobRow = {
  id: string;
  status: string;
  credit_qty: number;
  background_job_id?: string | null;
  idempotency_key: string;
};

function createClient(state: { jobs: JobRow[]; running: number }) {
  return {
    from(table: string) {
      const filters: Record<string, string> = {};
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: string) {
          filters[column] = value;
          return query;
        },
        in() {
          return query;
        },
        maybeSingle: async () => {
          if (table === "ai_image_sessions") {
            return { data: { id: SESSION, organization_id: "org-1", expires_at: null }, error: null };
          }
          if (table === "ai_image_assets") {
            return {
              data: { id: SOURCE, kind: "source", storage_path: "org/source.png" },
              error: null,
            };
          }
          if (table === "ai_image_jobs") {
            const existing = state.jobs.find((job) => job.idempotency_key === filters.idempotency_key);
            return { data: existing ?? null, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => {
          const job: JobRow = {
            id: "job-1",
            status: "QUEUED",
            credit_qty: 20,
            idempotency_key: KEY,
          };
          state.jobs.push(job);
          return { data: job, error: null };
        },
        then(resolve: (value: { count: number; error: null; data: JobRow | null }) => void) {
          resolve({ count: state.running, error: null, data: null });
        },
        update() {
          return {
            eq() {
              return { eq: () => Promise.resolve({ error: null }) };
            },
          };
        },
      };
      return {
        ...query,
        insert() {
          return query;
        },
      };
    },
    storage: {
      from() {
        return {
          download: async () => ({
            data: new Blob([Buffer.from("89504e47", "hex")]),
            error: null,
          }),
          upload: async () => ({ error: null }),
        };
      },
    },
  };
}

describe("enqueueCoverJob", () => {
  beforeEach(() => {
    getImageStudioConfig.mockResolvedValue({
      enabled: true,
      apiKey: "sk-or-test",
      model: "google/gemini-2.5-flash-image",
      creditCost: 10,
      coverCreditCost: 10,
      maxVariations: 3,
    });
    getAiCreditsRemaining.mockResolvedValue(100);
    reserveAiCredits.mockResolvedValue({ reserved: true, remaining: 80, status: "RESERVED", duplicate: false });
    releaseAiCreditReservation.mockResolvedValue(undefined);
    createBackgroundJob.mockResolvedValue({ id: "bg-1" });
    runQueuedJobsNow.mockResolvedValue(undefined);
  });

  const body = {
    sessionId: SESSION,
    sourceAssetId: SOURCE,
    preset: "luxury" as const,
    variants: ["desktop", "mobile"] as Array<"desktop" | "mobile">,
    variationCount: 1,
    idempotencyKey: KEY,
  };

  it("blocks when credits are insufficient", async () => {
    getAiCreditsRemaining.mockResolvedValue(0);
    const { enqueueCoverJob } = await import("@/modules/ai-image/service");
    await expect(enqueueCoverJob(createClient({ jobs: [], running: 0 }) as never, ctx, body)).rejects.toBeInstanceOf(
      AppError
    );
    expect(reserveAiCredits).not.toHaveBeenCalled();
  });

  it("blocks a second concurrent job", async () => {
    const { enqueueCoverJob } = await import("@/modules/ai-image/service");
    await expect(enqueueCoverJob(createClient({ jobs: [], running: 1 }) as never, ctx, body)).rejects.toThrow(
      /Wait for the current image job/
    );
  });

  it("returns the existing job for a duplicate idempotency key", async () => {
    const existing = { id: "job-dup", status: "QUEUED", credit_qty: 20, idempotency_key: KEY };
    const { enqueueCoverJob } = await import("@/modules/ai-image/service");
    const result = await enqueueCoverJob(createClient({ jobs: [existing], running: 0 }) as never, ctx, body);
    expect(result.jobId).toBe("job-dup");
    expect(createBackgroundJob).not.toHaveBeenCalled();
  });

  it("queues a cover job and reserves credits", async () => {
    const { enqueueCoverJob } = await import("@/modules/ai-image/service");
    const result = await enqueueCoverJob(createClient({ jobs: [], running: 0 }) as never, ctx, body);
    expect(result.jobId).toBe("job-1");
    expect(reserveAiCredits).toHaveBeenCalledWith(
      expect.anything(),
      "org-1",
      expect.objectContaining({ qty: 20, idempotencyKey: KEY })
    );
  });
});

describe("processAiImageJob cover purpose", () => {
  it("releases credits and skips offer compose when the provider fails", async () => {
    editProductImage.mockRejectedValue(new Error("provider down"));
    getImageStudioConfig.mockResolvedValue({
      enabled: true,
      apiKey: "sk-or-test",
      model: "google/gemini-2.5-flash-image",
      creditCost: 10,
      coverCreditCost: 10,
      maxVariations: 3,
    });
    const updates: Array<Record<string, unknown>> = [];
    const supabase = {
      from(table: string) {
        if (table === "ai_image_jobs") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: "job-1",
                      purpose: "cover",
                      idempotency_key: KEY,
                      source_asset_id: SOURCE,
                      variation_count: 1,
                      brief: { variants: ["desktop"] },
                      preset: "luxury",
                      festival: null,
                      custom_prompt: null,
                      category_hint: null,
                      cover_type: "homepage_hero",
                      model: null,
                      session_id: SESSION,
                      role: "banner",
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            update: (patch: Record<string, unknown>) => {
              updates.push(patch);
              return { eq: async () => ({ error: null }) };
            },
          };
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { storage_path: "org/source.png" }, error: null }),
              }),
            }),
          }),
        };
      },
      storage: {
        from() {
          return {
            download: async () => ({ data: new Blob([Buffer.from("png")]), error: null }),
          };
        },
      },
    };
    const { processAiImageJob } = await import("@/modules/ai-image/process");
    await expect(processAiImageJob(supabase as never, "org-1", "job-1")).rejects.toThrow("provider down");
    expect(composeOfferPoster).not.toHaveBeenCalled();
    expect(releaseAiCreditReservation).toHaveBeenCalled();
    expect(updates.some((patch) => patch.status === "FAILED")).toBe(true);
  });
});
