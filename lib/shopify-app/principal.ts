import { randomBytes } from "node:crypto";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError, logInfo } from "@/lib/logger";
import { encryptSecret } from "@/lib/security/crypto";
import { SHOPIFY_APP_ORG_ORIGIN } from "@/lib/shopify-app/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MemberRole } from "@/types/domain";

export const SHOPIFY_PRINCIPAL_KIND = "shopify_app_principal";
const PRINCIPAL_EMAIL_DOMAIN = "principals.postbus.in";

export type PrincipalCredentials = { email: string; password: string };

export type PrincipalInstallation = {
  id: string;
  organization_id: string;
  shop_domain: string;
  principal_user_id: string | null;
};

export type PrincipalDeps = {
  createUser: (input: {
    email: string;
    password: string;
    installationId: string;
    shopDomain: string;
  }) => Promise<string>;
  deleteUser: (userId: string) => Promise<void>;
  organizationOrigin: (organizationId: string) => Promise<string | null>;
  attach: (input: {
    installationId: string;
    userId: string;
    encryptedSecret: string;
    role: MemberRole;
  }) => Promise<{ principalUserId: string; attached: boolean }>;
};

export function isShopifyPrincipalEmail(email: string | null | undefined) {
  return Boolean(email && email.toLowerCase().endsWith(`@${PRINCIPAL_EMAIL_DOMAIN}`));
}

export function encodePrincipalCredentials(credentials: PrincipalCredentials) {
  return encryptSecret(JSON.stringify(credentials));
}

/** App-created workspaces belong to the shop, so its principal is OWNER; linked ones stay ADMIN. */
export function principalRoleForOrigin(origin: string | null): MemberRole {
  return origin === SHOPIFY_APP_ORG_ORIGIN ? "OWNER" : "ADMIN";
}

function defaultDeps(): PrincipalDeps {
  const admin = createAdminClient();
  return {
    async createUser({ email, password, installationId, shopDomain }) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { kind: SHOPIFY_PRINCIPAL_KIND, installation_id: installationId },
        user_metadata: { full_name: `Shopify app (${shopDomain})` },
      });
      if (error || !data.user) {
        throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "Could not prepare the Shopify app account.");
      }
      return data.user.id;
    },
    async deleteUser(userId) {
      await admin.auth.admin.deleteUser(userId);
    },
    async organizationOrigin(organizationId) {
      const { data } = await admin.from("organizations").select("origin").eq("id", organizationId).maybeSingle();
      return (data?.origin as string | undefined) ?? null;
    },
    async attach({ installationId, userId, encryptedSecret, role }) {
      const { data, error } = await admin.rpc("attach_shopify_app_principal", {
        p_installation_id: installationId,
        p_user_id: userId,
        p_encrypted_secret: encryptedSecret,
        p_role: role,
      });
      const row = (Array.isArray(data) ? data[0] : data) as
        | { principal_user_id: string; attached: boolean }
        | null;
      if (error || !row?.principal_user_id) {
        throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "Could not prepare the Shopify app account.");
      }
      return { principalUserId: row.principal_user_id, attached: row.attached };
    },
  };
}

/**
 * Returns the auth user the embedded app acts as for this installation, creating it on first use.
 * Concurrent first launches may each create a user; the database keeps one and the losers are deleted.
 */
export async function ensureInstallationPrincipal(
  installation: PrincipalInstallation,
  deps: PrincipalDeps = defaultDeps()
): Promise<string> {
  if (installation.principal_user_id) return installation.principal_user_id;

  const credentials: PrincipalCredentials = {
    // Random suffix: a crashed earlier attempt can never block this one with a duplicate email.
    email: `shopify-app+${installation.id}-${randomBytes(4).toString("hex")}@${PRINCIPAL_EMAIL_DOMAIN}`,
    password: randomBytes(32).toString("base64url"),
  };
  const userId = await deps.createUser({
    ...credentials,
    installationId: installation.id,
    shopDomain: installation.shop_domain,
  });

  let result: { principalUserId: string; attached: boolean };
  try {
    const role = principalRoleForOrigin(await deps.organizationOrigin(installation.organization_id));
    result = await deps.attach({
      installationId: installation.id,
      userId,
      encryptedSecret: encodePrincipalCredentials(credentials),
      role,
    });
  } catch (error) {
    await deps.deleteUser(userId).catch(() => undefined);
    throw error;
  }

  if (!result.attached) {
    await deps.deleteUser(userId).catch((error: unknown) => {
      logError("shopify_app.principal.orphan_delete_failed", {
        userId,
        message: error instanceof Error ? error.message : "unknown",
      });
    });
  } else {
    logInfo("shopify_app.principal.created", { installationId: installation.id, organizationId: installation.organization_id });
  }

  installation.principal_user_id = result.principalUserId;
  return result.principalUserId;
}
