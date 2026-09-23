import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/api/errors";
import {
  readLabelPdfIfPresent,
  relativeLabelPath,
  resolveSafeLabelPath,
  saveLabelPdf,
} from "@/modules/labels/storage";

const org = "11111111-1111-4111-8111-111111111111";
const shipment = "22222222-2222-4222-8222-222222222222";

describe("label filesystem storage", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  async function tempRoot() {
    root = await mkdtemp(path.join(os.tmpdir(), "postbus-labels-"));
    return root;
  }

  it("builds a relative org/shipment pdf path", () => {
    expect(relativeLabelPath(org, shipment)).toBe(`${org}/${shipment}.pdf`);
  });

  it("rejects path traversal and absolute paths", () => {
    const cases = [
      "../etc/passwd",
      `${org}/../../etc/passwd`,
      "/etc/passwd",
      `${org}/../../../etc/passwd.pdf`,
      `..\\${org}\\${shipment}.pdf`,
      `${org}/../${shipment}.pdf`,
      "",
      `${org}//${shipment}.pdf`,
    ];
    for (const value of cases) {
      expect(() => resolveSafeLabelPath(value, org, "/data/labels")).toThrow(AppError);
    }
  });

  it("rejects a path that belongs to another organization", () => {
    expect(() =>
      resolveSafeLabelPath(`${org}/${shipment}.pdf`, "33333333-3333-4333-8333-333333333333", "/data/labels")
    ).toThrow(AppError);
  });

  it("writes and reads a pdf under the storage root", async () => {
    const dir = await tempRoot();
    const bytes = Buffer.from("%PDF-1.4 test");
    const relative = await saveLabelPdf({
      organizationId: org,
      shipmentId: shipment,
      bytes,
      root: dir,
    });
    expect(relative).toBe(`${org}/${shipment}.pdf`);
    const read = await readLabelPdfIfPresent({
      relativePath: relative,
      organizationId: org,
      shipmentId: shipment,
      root: dir,
    });
    expect(read?.equals(bytes)).toBe(true);
  });

  it("writes unique files so regenerate does not replace an older label", async () => {
    const dir = await tempRoot();
    const other = "33333333-3333-4333-8333-333333333333";
    await saveLabelPdf({
      organizationId: org,
      fileId: shipment,
      bytes: Buffer.from("first"),
      root: dir,
    });
    await saveLabelPdf({
      organizationId: org,
      fileId: other,
      bytes: Buffer.from("second"),
      root: dir,
    });
    const first = await readLabelPdfIfPresent({
      relativePath: `${org}/${shipment}.pdf`,
      organizationId: org,
      root: dir,
    });
    const next = await readLabelPdfIfPresent({
      relativePath: `${org}/${other}.pdf`,
      organizationId: org,
      root: dir,
    });
    expect(first?.toString()).toBe("first");
    expect(next?.toString()).toBe("second");
  });

  it("returns null when the vps file is missing", async () => {
    const dir = await tempRoot();
    const read = await readLabelPdfIfPresent({
      relativePath: `${org}/${shipment}.pdf`,
      organizationId: org,
      root: dir,
    });
    expect(read).toBeNull();
  });
});
