/**
 * Spec for the BEFORE UPDATE trigger in
 * supabase/migrations/20261009021000_protect_profile_whatsapp_number.sql.
 * Authenticated merchants cannot change profiles.whatsapp_number.
 * Service role and a no-JWT database session still can.
 */
export function profileWhatsappChangeAllowed(input: {
  jwtRole: string | null;
  userId: string | null;
  previousNumber: string | null;
  nextNumber: string | null;
}) {
  if ((input.previousNumber ?? null) === (input.nextNumber ?? null)) return true;
  if (input.jwtRole === "service_role") return true;
  if (!input.jwtRole && !input.userId) return true;
  return false;
}
