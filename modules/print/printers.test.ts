import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AppError } from "@/lib/api/errors";
import { registerPrinterSchema } from "@/lib/api/v1-schemas";
import type { TenantContext } from "@/lib/api/context";
import { AUTOMATION_DEFAULTS } from "@/modules/automation/service";
import {
  applySingleDefault,
  clearDefaultsForAgentPrinter,
  listPrinters,
  registerPrinter,
  removePrinter,
  setDefaultPrinter,
} from "@/modules/print/printers";

const ctx: TenantContext = {
  userId: "user-1",
  email: "owner@example.com",
  fullName: "Owner",
  organizationId: "org-1",
  organizationName: "Acme",
  role: "OWNER",
  permissions: [],
};

type Row = {
  id: string;
  organization_id: string;
  display_name: string;
  connection_type: "webusb";
  device_key: string;
  protocol: "tspl";
  is_default: boolean;
  last_seen_at: string | null;
  created_at: string;
};

function printer(partial: Partial<Row> & Pick<Row, "id" | "organization_id" | "device_key">): Row {
  return {
    display_name: "Xprinter XP-420B",
    connection_type: "webusb",
    protocol: "tspl",
    is_default: false,
    last_seen_at: null,
    created_at: new Date().toISOString(),
    ...partial,
  };
}

function client(state: { rows: Row[]; failDefault?: boolean }) {
  const audits: { action: string; organization_id: string; entity_id: string }[] = [];
  return {
    audits,
    from(table: string) {
      if (table === "audit_logs") {
        return {
          insert: async (row: { action: string; organization_id: string; entity_id: string }) => {
            audits.push(row);
            return { error: null };
          },
        };
      }
      if (table === "automation_settings") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { organization_id: "org-1", ...AUTOMATION_DEFAULTS, auto_label_printing: true },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: () => {
          const filters: Record<string, string> = {};
          const chain = {
            eq(column: string, value: string) {
              filters[column] = value;
              return chain;
            },
            order() {
              return Promise.resolve({
                data: state.rows.filter((row) => row.organization_id === filters.organization_id),
                error: null,
              });
            },
            maybeSingle: async () => ({
              data:
                state.rows.find((row) =>
                  Object.entries(filters).every(([key, value]) => String(row[key as keyof Row]) === String(value))
                ) ?? null,
              error: null,
            }),
          };
          return chain;
        },
        insert(payload: Omit<Row, "id" | "created_at">) {
          const row = printer({
            ...payload,
            id: `printer-${state.rows.length + 1}`,
            organization_id: payload.organization_id,
            device_key: payload.device_key,
          });
          state.rows.push(row);
          return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
        },
        update(payload: Partial<Row>) {
          return {
            eq(column: string, value: string) {
              const filters: Record<string, string> = { [column]: value };
              const apply = () => {
                const row = state.rows.find((item) =>
                  Object.entries(filters).every(([key, expected]) => String(item[key as keyof Row]) === String(expected))
                );
                if (row) Object.assign(row, payload);
                return row ?? null;
              };
              return {
                eq(column2: string, value2: string) {
                  filters[column2] = value2;
                  return {
                    select: () => ({
                      single: async () => ({ data: apply(), error: null }),
                    }),
                  };
                },
              };
            },
          };
        },
        delete() {
          return {
            eq(column: string, value: string) {
              return {
                eq(column2: string, value2: string) {
                  state.rows = state.rows.filter(
                    (row) => !(String(row[column as keyof Row]) === value && String(row[column2 as keyof Row]) === value2)
                  );
                  return Promise.resolve({ error: null });
                },
              };
            },
          };
        },
      };
    },
    rpc(_name: string, args: { p_printer_id: string }) {
      if (state.failDefault) {
        state.failDefault = false;
        return Promise.resolve({ data: null, error: { code: "23505", message: "printers_one_default" } });
      }
      const row = state.rows.find((item) => item.id === args.p_printer_id && item.organization_id === ctx.organizationId);
      if (!row) return Promise.resolve({ data: null, error: { code: "P0002", message: "Printer not found" } });
      for (const item of state.rows) {
        if (item.organization_id === row.organization_id) item.is_default = item.id === row.id;
      }
      return Promise.resolve({ data: { ...row, is_default: true }, error: null });
    },
  };
}

const keyA = "a".repeat(64);
const keyB = "b".repeat(64);

describe("printer configuration", () => {
  it("keeps one default and leaves other tenants alone", () => {
    const rows = applySingleDefault(
      [
        { id: "a", organizationId: "org-1", isDefault: true },
        { id: "b", organizationId: "org-1", isDefault: true },
        { id: "c", organizationId: "org-2", isDefault: true },
      ],
      "org-1",
      "b"
    );
    expect(rows.filter((row) => row.organizationId === "org-1" && row.isDefault).map((row) => row.id)).toEqual(["b"]);
    expect(rows.find((row) => row.id === "c")?.isDefault).toBe(true);
    expect(() => applySingleDefault(rows, "org-1", "missing")).toThrow(AppError);
  });

  it("clears USB defaults when an agent printer is selected", () => {
    expect(clearDefaultsForAgentPrinter([true, false], "Epson TM")).toEqual([false, false]);
    expect(clearDefaultsForAgentPrinter([true], null)).toEqual([true]);
  });

  it("rejects a malformed printer payload", () => {
    expect(() => registerPrinterSchema.parse({})).toThrow(ZodError);
    expect(() =>
      registerPrinterSchema.parse({ displayName: "XP", deviceKey: "nope", protocol: "escpos" })
    ).toThrow(ZodError);
    expect(
      registerPrinterSchema.parse({ displayName: "Xprinter XP-420B", deviceKey: keyA.toUpperCase(), protocol: "tspl" })
        .deviceKey
    ).toBe(keyA);
  });

  it("saves a printer for the signed-in organization only", async () => {
    const state = {
      rows: [
        printer({ id: "other", organization_id: "org-2", device_key: keyB, is_default: true }),
      ],
    };
    const supabase = client(state);
    await registerPrinter(supabase as never, ctx, {
      displayName: "Xprinter XP-420B",
      deviceKey: keyA,
      protocol: "tspl",
    });
    const listed = await listPrinters(supabase as never, ctx.organizationId);
    expect(listed.printers.map((item) => item.id)).toEqual(["printer-2"]);
    expect(listed.autoLabelPrinting).toBe(true);
    expect(listed.printers[0]?.isDefault).toBe(false);
    expect(state.rows.some((row) => row.organization_id === "org-2")).toBe(true);
    expect(supabase.audits.some((row) => row.action === "printer.connected" && row.organization_id === "org-1")).toBe(
      true
    );
  });

  it("moves the default and rejects a conflicting update", async () => {
    const state = {
      rows: [
        printer({ id: "a", organization_id: "org-1", device_key: keyA, is_default: true }),
        printer({ id: "b", organization_id: "org-1", device_key: keyB, is_default: false }),
      ],
    };
    const supabase = client(state);
    await setDefaultPrinter(supabase as never, ctx, "b");
    expect(state.rows.find((row) => row.id === "a")?.is_default).toBe(false);
    expect(state.rows.find((row) => row.id === "b")?.is_default).toBe(true);
    expect(supabase.audits.at(-1)?.action).toBe("printer.default_changed");

    state.failDefault = true;
    await expect(setDefaultPrinter(supabase as never, ctx, "a")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(state.rows.filter((row) => row.is_default)).toHaveLength(1);
  });

  it("does not set another tenant's printer as the default", async () => {
    const state = { rows: [printer({ id: "other", organization_id: "org-2", device_key: keyB, is_default: false })] };
    await expect(setDefaultPrinter(client(state) as never, ctx, "other")).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
    expect(state.rows[0]?.is_default).toBe(false);
  });

  it("leaves no default after the default printer is removed", async () => {
    const state = {
      rows: [
        printer({ id: "a", organization_id: "org-1", device_key: keyA, is_default: true }),
        printer({ id: "b", organization_id: "org-1", device_key: keyB, is_default: false }),
      ],
    };
    const supabase = client(state);
    await removePrinter(supabase as never, ctx, "a");
    expect(state.rows.map((row) => row.id)).toEqual(["b"]);
    expect(state.rows.some((row) => row.is_default)).toBe(false);
    await expect(removePrinter(supabase as never, ctx, "other")).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
  });
});
