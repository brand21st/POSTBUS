import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { createAdminClient } from "@/lib/supabase/admin";

const FORBIDDEN_TABLES = new Set(["shopify_connections"]);

// Read-only, org-filtered access for Shopify infra lookups. The filter is applied after
// select(), because the raw query builder has no eq() until a verb is chosen.
export function createShopifyTenantAdmin(organizationId: string) {
  const org = organizationId.trim();
  if (!org) {
    throw new AppError(ERROR_CODES.TENANT_ACCESS_DENIED, "Organization is required.");
  }
  const admin = createAdminClient();
  return {
    organizationId: org,
    rpc(...args: unknown[]): never {
      void args;
      throw new AppError(ERROR_CODES.FORBIDDEN, "RPC is not available to the Shopify app BFF.");
    },
    from(table: string) {
      if (FORBIDDEN_TABLES.has(table)) {
        throw new AppError(ERROR_CODES.FORBIDDEN, "This table is not available to the Shopify app.");
      }
      const column = table === "organizations" ? "id" : "organization_id";
      return {
        select: <Columns extends string>(columns: Columns) => admin.from(table).select(columns).eq(column, org),
      };
    },
  };
}

export type TenantScopedClient = ReturnType<typeof createShopifyTenantAdmin>;

export function assertOrganizationMatch(expected: string, provided?: string | null) {
  if (provided && provided.trim() && provided.trim() !== expected) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "Organization does not match this shop.");
  }
}
