import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/api/errors";
import {
  readInvoicePdfIfPresent,
  relativeInvoicePath,
  resolveSafeInvoicePath,
  saveInvoicePdf,
} from "@/modules/invoices/storage";

const org = "11111111-1111-4111-8111-111111111111";
const invoice = "22222222-2222-4222-8222-222222222222";

describe("invoice filesystem storage", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  async function tempRoot() {
    root = await mkdtemp(path.join(os.tmpdir(), "postbus-invoices-"));
    return root;
  }

  it("builds a relative org/invoice pdf path", () => {
    expect(relativeInvoicePath(org, invoice)).toBe(`${org}/${invoice}.pdf`);
  });

  it("rejects path traversal and absolute paths", () => {
    const cases = [
      "../etc/passwd",
      `${org}/../../etc/passwd`,
      "/etc/passwd",
      `${org}/../../../etc/passwd.pdf`,
      `..\\${org}\\${invoice}.pdf`,
      `${org}/../${invoice}.pdf`,
      "",
      `${org}//${invoice}.pdf`,
    ];
    for (const value of cases) {
      expect(() => resolveSafeInvoicePath(value, org, "/data/invoices")).toThrow(AppError);
    }
  });

  it("rejects a path that belongs to another organization", () => {
    expect(() =>
      resolveSafeInvoicePath(`${org}/${invoice}.pdf`, "33333333-3333-4333-8333-333333333333", "/data/invoices")
    ).toThrow(AppError);
  });

  it("writes and reads a pdf under the storage root", async () => {
    const dir = await tempRoot();
    const bytes = Buffer.from("%PDF-1.4 test");
    const relative = await saveInvoicePdf({
      organizationId: org,
      invoiceId: invoice,
      bytes,
      root: dir,
    });
    expect(relative).toBe(`${org}/${invoice}.pdf`);
    const read = await readInvoicePdfIfPresent({
      relativePath: relative,
      organizationId: org,
      invoiceId: invoice,
      root: dir,
    });
    expect(read?.equals(bytes)).toBe(true);
  });

  it("replaces the same invoice file on regenerate", async () => {
    const dir = await tempRoot();
    await saveInvoicePdf({ organizationId: org, invoiceId: invoice, bytes: Buffer.from("first"), root: dir });
    await saveInvoicePdf({ organizationId: org, invoiceId: invoice, bytes: Buffer.from("second"), root: dir });
    const read = await readInvoicePdfIfPresent({
      relativePath: `${org}/${invoice}.pdf`,
      organizationId: org,
      root: dir,
    });
    expect(read?.toString()).toBe("second");
  });

  it("returns null when the vps file is missing", async () => {
    const dir = await tempRoot();
    const read = await readInvoicePdfIfPresent({
      relativePath: `${org}/${invoice}.pdf`,
      organizationId: org,
      root: dir,
    });
    expect(read).toBeNull();
  });
});
