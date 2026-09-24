export const PLATFORM_ADMIN_HOME = "/admin";
export const MERCHANT_HOME = "/dashboard";

export function matchesPlatformAdminEmail(
  userEmail: string | null | undefined,
  configuredEmail: string
) {
  const email = (userEmail ?? "").trim().toLowerCase();
  const configured = configuredEmail.trim().toLowerCase();
  return Boolean(email && configured && email === configured);
}

export function signedInHomePath(isPlatformAdmin: boolean) {
  return isPlatformAdmin ? PLATFORM_ADMIN_HOME : MERCHANT_HOME;
}

type AdminLookupClient = {
  from: (table: string) => {
    select: (columns: string) => {
      or: (filter: string) => {
        maybeSingle: () => Promise<{ data: { id?: string } | null }>;
      };
    };
  };
};

export async function hasPlatformAdminRow(
  supabase: AdminLookupClient,
  userId: string,
  email: string
) {
  const normalized = email.trim().toLowerCase();
  const { data } = await supabase
    .from("platform_admins")
    .select("id")
    .or(`user_id.eq.${userId}${normalized ? `,email.eq.${normalized}` : ""}`)
    .maybeSingle();
  return Boolean(data);
}
