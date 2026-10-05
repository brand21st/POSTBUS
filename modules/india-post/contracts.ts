import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { DEFAULT_INDIA_POST_SERVICE, INDIA_POST_SERVICES } from "@/types/domain";

export type ContractInput = {
  serviceCode: string;
  contractId: string;
  isDefault?: boolean;
  isActive?: boolean;
};

export type ContractRecord = {
  id: string;
  serviceCode: string;
  contractId: string;
  isDefault: boolean;
  isActive: boolean;
  label: string;
};

const KNOWN_CODES = new Set<string>(INDIA_POST_SERVICES.map((service) => service.code));

function labelFor(code: string) {
  return INDIA_POST_SERVICES.find((service) => service.code === code)?.label ?? code;
}

export type SelectableIndiaPostService = {
  code: string;
  label: string;
  isDefault: boolean;
};

type IndiaPostServiceConfig = {
  contracts?: Array<{
    serviceCode: string;
    contractId?: string | null;
    isDefault?: boolean;
    isActive?: boolean;
    label?: string | null;
  }>;
  defaultServiceCode?: string | null;
} | null;

export function savedParcelContracts(config?: IndiaPostServiceConfig) {
  return (config?.contracts ?? []).filter(
    (contract) =>
      KNOWN_CODES.has(contract.serviceCode) &&
      Boolean(contract.contractId?.trim()) &&
      contract.isActive !== false
  );
}

export function hideWorkspaceBookingToggle(config?: IndiaPostServiceConfig) {
  return savedParcelContracts(config).length === 1;
}

export function parcelServiceToggleOptions(config?: IndiaPostServiceConfig) {
  const short: Record<string, { label: string; title: string }> = {
    SP_INLAND_PARCEL: { label: "SP", title: "Speed Post Parcel Domestic" },
    BUSINESS_PARCEL: { label: "BP", title: "Business Parcel" },
  };
  return selectableIndiaPostServices(config).map((service) => ({
    value: service.code,
    label: short[service.code]?.label ?? service.label,
    title: short[service.code]?.title ?? service.label,
  }));
}

export function selectableIndiaPostServices(config?: IndiaPostServiceConfig): SelectableIndiaPostService[] {
  const defaultCode = config?.defaultServiceCode ?? DEFAULT_INDIA_POST_SERVICE;
  const contracts = savedParcelContracts(config);
  if (contracts.length) {
    return contracts.map((contract) => ({
      code: contract.serviceCode,
      label: contract.label?.trim() || labelFor(contract.serviceCode),
      isDefault: Boolean(contract.isDefault) || contract.serviceCode === defaultCode,
    }));
  }
  return INDIA_POST_SERVICES.map((service) => ({
    code: service.code,
    label: service.label,
    isDefault: service.code === defaultCode,
  }));
}

export async function listContracts(
  supabase: SupabaseClient,
  organizationId: string
): Promise<ContractRecord[]> {
  const { data, error } = await supabase
    .from("india_post_contracts")
    .select("*")
    .eq("organization_id", organizationId)
    .order("service_code");
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    serviceCode: row.service_code as string,
    contractId: row.contract_id as string,
    isDefault: Boolean(row.is_default),
    isActive: Boolean(row.is_active),
    label: (row.label as string | null) ?? labelFor(row.service_code as string),
  }));
}

export function validateContracts(contracts: ContractInput[]) {
  const seen = new Set<string>();
  for (const contract of contracts) {
    const code = contract.serviceCode?.trim();
    if (!code) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Pick a service for every contract.");
    }
    if (!KNOWN_CODES.has(code)) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        `${code} is not a service India Post accepts as article_type.`
      );
    }
    if (seen.has(code)) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        `${labelFor(code)} is listed twice. One contract per service.`
      );
    }
    seen.add(code);

    if (!/^\d{4,20}$/.test(contract.contractId?.trim() ?? "")) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        `Contract ID for ${labelFor(code)} must be the numeric ID from the India Post portal.`
      );
    }
  }

  const defaults = contracts.filter((contract) => contract.isDefault);
  if (defaults.length > 1) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Only one service can be the default.");
  }
}

export async function saveParcelContract(
  supabase: SupabaseClient,
  organizationId: string,
  serviceCode: string,
  contractId: string
) {
  const code = serviceCode.trim();
  if (!KNOWN_CODES.has(code)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `${code} is not a service India Post accepts as article_type.`
    );
  }
  const id = contractId.replace(/\D/g, "");
  if (!id) {
    const { data: existing, error: existingError } = await supabase
      .from("india_post_contracts")
      .select("service_code, is_default")
      .eq("organization_id", organizationId)
      .eq("service_code", code)
      .maybeSingle();
    if (existingError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, existingError.message);

    const { error: deleteError } = await supabase
      .from("india_post_contracts")
      .delete()
      .eq("organization_id", organizationId)
      .eq("service_code", code);
    if (deleteError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, deleteError.message);

    if (existing?.is_default) {
      const remaining = await listContracts(supabase, organizationId);
      const nextDefault =
        remaining.find((contract) => contract.serviceCode === DEFAULT_INDIA_POST_SERVICE) ?? remaining[0];
      if (nextDefault) {
        const { error: defaultError } = await supabase
          .from("india_post_contracts")
          .update({ is_default: true })
          .eq("organization_id", organizationId)
          .eq("service_code", nextDefault.serviceCode);
        if (defaultError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, defaultError.message);
      }
    }
    return listContracts(supabase, organizationId);
  }

  if (!/^\d{4,20}$/.test(id)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `Contract ID for ${labelFor(code)} must be the numeric ID from the India Post portal.`
    );
  }

  const existing = await listContracts(supabase, organizationId);
  const current = existing.find((contract) => contract.serviceCode === code);
  const hasDefault = existing.some((contract) => contract.isDefault);
  const isDefault = Boolean(current?.isDefault) || !hasDefault;

  const { error } = await supabase.from("india_post_contracts").upsert(
    {
      organization_id: organizationId,
      service_code: code,
      contract_id: id,
      label: labelFor(code),
      is_default: isDefault,
      is_active: true,
    },
    { onConflict: "organization_id,service_code" }
  );
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return listContracts(supabase, organizationId);
}

export async function syncPageContracts(
  supabase: SupabaseClient,
  organizationId: string,
  contracts: ContractInput[]
) {
  for (const service of INDIA_POST_SERVICES) {
    const row = contracts.find((contract) => contract.serviceCode === service.code);
    await saveParcelContract(supabase, organizationId, service.code, row?.contractId ?? "");
  }
  const remaining = await listContracts(supabase, organizationId);
  const requestedDefault = contracts.find((contract) => contract.isDefault)?.serviceCode;
  const defaultService = remaining.some((contract) => contract.serviceCode === requestedDefault)
    ? requestedDefault
    : remaining.find((contract) => contract.isDefault)?.serviceCode ?? remaining[0]?.serviceCode;
  if (defaultService && remaining.length) {
    return saveContracts(
      supabase,
      organizationId,
      remaining.map((contract) => ({
        serviceCode: contract.serviceCode,
        contractId: contract.contractId,
        isDefault: contract.serviceCode === defaultService,
        isActive: contract.isActive,
      }))
    );
  }
  return remaining;
}

export async function saveContracts(
  supabase: SupabaseClient,
  organizationId: string,
  contracts: ContractInput[]
) {
  validateContracts(contracts);
  if (!contracts.length) return [];

  const explicitDefault = contracts.find((contract) => contract.isDefault)?.serviceCode;
  const fallbackDefault =
    contracts.find((contract) => contract.serviceCode === DEFAULT_INDIA_POST_SERVICE)?.serviceCode ??
    contracts[0].serviceCode;
  const defaultService = explicitDefault ?? fallbackDefault;

  // One default per workspace is enforced by a partial unique index, so clear the
  // old default before writing the new one.
  const { error: clearError } = await supabase
    .from("india_post_contracts")
    .update({ is_default: false })
    .eq("organization_id", organizationId)
    .eq("is_default", true);
  if (clearError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, clearError.message);

  const { error } = await supabase.from("india_post_contracts").upsert(
    contracts.map((contract) => ({
      organization_id: organizationId,
      service_code: contract.serviceCode.trim(),
      contract_id: contract.contractId.trim(),
      label: labelFor(contract.serviceCode.trim()),
      is_default: contract.serviceCode.trim() === defaultService,
      is_active: contract.isActive ?? true,
    })),
    { onConflict: "organization_id,service_code" }
  );
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);

  return listContracts(supabase, organizationId);
}

export async function resolveDefaultServiceCode(
  supabase: SupabaseClient,
  organizationId: string
): Promise<string> {
  const { data } = await supabase
    .from("india_post_contracts")
    .select("service_code")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .eq("is_default", true)
    .maybeSingle();
  const code = (data?.service_code as string | undefined) ?? DEFAULT_INDIA_POST_SERVICE;
  return KNOWN_CODES.has(code) ? code : DEFAULT_INDIA_POST_SERVICE;
}
