import { describe, expect, it, vi } from "vitest";
import { decryptSecret } from "@/lib/security/crypto";
import {
  ensureInstallationPrincipal,
  isShopifyPrincipalEmail,
  principalRoleForOrigin,
  type PrincipalDeps,
} from "@/lib/shopify-app/principal";

const install = () => ({
  id: "inst-1",
  organization_id: "org-1",
  shop_domain: "demo.myshopify.com",
  principal_user_id: null as string | null,
});

function deps(overrides: Partial<PrincipalDeps> = {}): PrincipalDeps {
  return {
    createUser: vi.fn(async () => "user-new"),
    deleteUser: vi.fn(async () => undefined),
    organizationOrigin: vi.fn(async () => "SHOPIFY_PUBLIC_APP"),
    attach: vi.fn(async ({ userId }: { userId: string }) => ({ principalUserId: userId, attached: true })),
    ...overrides,
  };
}

describe("ensureInstallationPrincipal", () => {
  it("reuses an existing principal without touching auth", async () => {
    const d = deps();
    const row = { ...install(), principal_user_id: "user-old" };
    expect(await ensureInstallationPrincipal(row, d)).toBe("user-old");
    expect(d.createUser).not.toHaveBeenCalled();
  });

  it("creates an OWNER principal for an app-created workspace with encrypted credentials", async () => {
    const d = deps();
    const row = install();
    expect(await ensureInstallationPrincipal(row, d)).toBe("user-new");
    const attach = vi.mocked(d.attach).mock.calls[0][0];
    expect(attach.role).toBe("OWNER");
    const creds = JSON.parse(decryptSecret(attach.encryptedSecret)) as { email: string; password: string };
    expect(isShopifyPrincipalEmail(creds.email)).toBe(true);
    expect(creds.email).toContain("inst-1");
    expect(creds.password.length).toBeGreaterThanOrEqual(40);
    expect(row.principal_user_id).toBe("user-new");
  });

  it("deletes its own user when a concurrent launch attached first", async () => {
    const d = deps({ attach: vi.fn(async () => ({ principalUserId: "user-winner", attached: false })) });
    expect(await ensureInstallationPrincipal(install(), d)).toBe("user-winner");
    expect(d.deleteUser).toHaveBeenCalledWith("user-new");
  });

  it("does not leave an orphan auth user when attaching fails", async () => {
    const d = deps({
      attach: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    await expect(ensureInstallationPrincipal(install(), d)).rejects.toThrow("db down");
    expect(d.deleteUser).toHaveBeenCalledWith("user-new");
  });

  it("uses ADMIN for a linked web workspace", () => {
    expect(principalRoleForOrigin("WEB")).toBe("ADMIN");
    expect(principalRoleForOrigin(null)).toBe("ADMIN");
    expect(principalRoleForOrigin("SHOPIFY_PUBLIC_APP")).toBe("OWNER");
  });
});
