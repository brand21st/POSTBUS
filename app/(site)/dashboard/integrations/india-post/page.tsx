"use client";

import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { IndiaPostLogo } from "@/components/brand/india-post-logo";
import { IndiaPostGuideBanner } from "@/components/integrations/india-post-guide-banner";
import { IndiaPostWatchTutorialLink } from "@/components/integrations/india-post-watch-tutorial-link";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate, formatNumber } from "@/lib/format";
import {
  BARCODE_ALLOTMENT_DIGITS,
  INDIA_POST_COD_PREFIX,
  INDIA_POST_COD_RANGE_CODE,
  barcodePrefixAllowedForService,
  barcodePrefixServiceMessage,
  barcodeStockForService,
  barcodesLeft,
  LOW_BARCODE_THRESHOLD,
  formatStoredSerial,
  sanitizeBarcodeAllotmentField,
} from "@/modules/india-post/barcode";
import { api } from "@/lib/hooks/use-api";
import { INDIA_POST_QUERY_KEY, useIndiaPost } from "@/lib/hooks/use-india-post";
import { cn } from "@/lib/utils";
import { AlertTriangle, Check, Copy, Eye, EyeOff, MapPin } from "lucide-react";
import { IndiaPostOfficeFinder, type IndiaPostOfficeRow } from "@/components/integrations/india-post-office-finder";
import { notifyIndiaPostSaved } from "@/components/integrations/india-post-saved-toast";
import { indiaPostOfficeWritePayload, indiaPostPickupOfficeWritePayload } from "@/modules/india-post/office-patch";
import {
  DEFAULT_INDIA_POST_SERVICE,
  DEFAULT_PROVIDER_ENVIRONMENT,
  INDIA_POST_SERVICES,
  indiaPostServiceLabel,
} from "@/types/domain";
import type { IndiaPostConfig } from "@/types/api";

// Shared spacing so every setup card lines up: paired cards stretch to equal
// height and their action footers sit on the same baseline.
const SECTION_GRID = "grid items-stretch gap-5 xl:grid-cols-2";
const CARD = "flex h-full flex-col";
const CARD_HEADER = "gap-1.5 p-5 pb-4 sm:p-6 sm:pb-4";
const CARD_CONTENT = "flex-1 px-5 pb-5 sm:px-6 sm:pb-6";
const CARD_FOOTER =
  "mt-auto flex flex-wrap items-center gap-2 rounded-b-2xl border-t border-border bg-surface-soft/40 px-5 py-2.5 sm:px-6";
const PREFIX_FIELD = "col-span-2 max-w-[6rem] sm:col-span-1 sm:max-w-none";
const SUB_PANEL = "space-y-3 rounded-xl border border-border p-4";

type ContractRow = { serviceCode: string; contractId: string };

type SeriesDraft = {
  serviceCode: string;
  prefix: string;
  suffix: string;
  startNumber: string;
  endNumber: string;
};

type FormState = {
  environment: string;
  customerId: string;
  password: string;
  pickupDropoffOfficeId: string;
  pickupDropoffOfficeName: string;
  pickupDropoffOfficePincode: string;
  pickupOfficeId: string;
  pickupOfficeName: string;
  pickupOfficePincode: string;
  pickupOfficeTypeCode: string;
  pickupOfficeCity: string;
  pickupOfficeState: string;
  contracts: ContractRow[];
  defaultServiceCode: string;
  ranges: SeriesDraft[];
};

function withReadableWebhookId(url: string, customerId: string) {
  const id = customerId.replace(/\D/g, "");
  if (!url || id.length < 6) return url;
  return url.replace(/\/india-post\/[^/]+\//, `/india-post/${id}/`);
}

function emptySeries(serviceCode: string): SeriesDraft {
  return {
    serviceCode,
    prefix: serviceCode === INDIA_POST_COD_RANGE_CODE ? INDIA_POST_COD_PREFIX : "",
    suffix: "IN",
    startNumber: "",
    endNumber: "",
  };
}

function seriesDraftsFromConfig(
  config?: Pick<IndiaPostConfig, "barcodeRanges" | "barcodeRange"> | null
): SeriesDraft[] {
  const codes = [...INDIA_POST_SERVICES.map((service) => service.code), INDIA_POST_COD_RANGE_CODE];
  return codes.map((serviceCode) => {
    const saved =
      config?.barcodeRanges?.find((range) => range.serviceCode === serviceCode) ??
      (serviceCode !== INDIA_POST_COD_RANGE_CODE && config?.barcodeRange?.serviceCode === serviceCode
        ? config.barcodeRange
        : undefined);
    if (!saved) return emptySeries(serviceCode);
    return {
      serviceCode,
      prefix: serviceCode === INDIA_POST_COD_RANGE_CODE ? INDIA_POST_COD_PREFIX : String(saved.prefix ?? ""),
      suffix: "IN",
      startNumber:
        saved.startNumber != null ? formatStoredSerial(Number(saved.startNumber)) : "",
      endNumber: saved.endNumber != null ? formatStoredSerial(Number(saved.endNumber)) : "",
    };
  });
}

function barcodeRangeWritePayload(draft: SeriesDraft) {
  const cod = draft.serviceCode === INDIA_POST_COD_RANGE_CODE;
  const prefix = cod ? INDIA_POST_COD_PREFIX : draft.prefix.trim();
  const startNumber = draft.startNumber.trim();
  const endNumber = draft.endNumber.trim();
  if (cod && !startNumber && !endNumber) return null;
  if (!prefix && !startNumber && !endNumber) return null;
  if (!prefix || !startNumber || !endNumber) return undefined;
  return {
    prefix,
    suffix: "IN",
    startNumber,
    endNumber,
    serviceCode: draft.serviceCode,
  };
}

const EMPTY: FormState = {
  environment: DEFAULT_PROVIDER_ENVIRONMENT,
  customerId: "",
  password: "",
  pickupDropoffOfficeId: "",
  pickupDropoffOfficeName: "",
  pickupDropoffOfficePincode: "",
  pickupOfficeId: "",
  pickupOfficeName: "",
  pickupOfficePincode: "",
  pickupOfficeTypeCode: "",
  pickupOfficeCity: "",
  pickupOfficeState: "",
  contracts: [],
  defaultServiceCode: DEFAULT_INDIA_POST_SERVICE,
  ranges: [...INDIA_POST_SERVICES.map((service) => emptySeries(service.code)), emptySeries(INDIA_POST_COD_RANGE_CODE)],
};

export default function IndiaPostPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [replaceSecrets, setReplaceSecrets] = useState(false);
  const [highlightConnection, setHighlightConnection] = useState(false);
  const [prefixErrors, setPrefixErrors] = useState<Record<string, string>>({});

  const query = useIndiaPost();

  const config = query.data;
  const hasSecrets = Boolean(
    config?.hasPassword ?? config?.has_password ?? config?.usernameMasked ?? config?.username_masked
  );
  const prodConfigured = Boolean(config?.prodConfigured);
  const productionBlocked = !prodConfigured;
  const lastError = config?.lastError || config?.last_error;
  const lastVerified = config?.lastVerifiedAt ?? config?.last_verified_at;
  const bookingWebhookUrl = withReadableWebhookId(
    config?.bookingWebhookUrl ?? config?.booking_webhook_url ?? "",
    form.customerId
  );
  const eventsWebhookUrl = withReadableWebhookId(
    config?.eventsWebhookUrl ?? config?.events_webhook_url ?? "",
    form.customerId
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#india-post-connection") return;
    const el = document.getElementById("india-post-connection");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    const show = window.setTimeout(() => setHighlightConnection(true), 0);
    const hide = window.setTimeout(() => setHighlightConnection(false), 2400);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, []);

  const [appliedConfig, setAppliedConfig] = useState(config);
  if (config && config !== appliedConfig) {
    setAppliedConfig(config);
    const legacyContract = String(config.contractId ?? config.contract_id ?? "");
    const knownService = new Set<string>(INDIA_POST_SERVICES.map((service) => service.code));
    const contracts: ContractRow[] = config.contracts?.length
      ? config.contracts
          .filter((contract) => knownService.has(contract.serviceCode))
          .map((contract) => ({
            serviceCode: contract.serviceCode,
            contractId: contract.contractId,
          }))
      : legacyContract
        ? [{ serviceCode: DEFAULT_INDIA_POST_SERVICE, contractId: legacyContract }]
        : [];

    const savedDefault = config.defaultServiceCode ?? DEFAULT_INDIA_POST_SERVICE;

    setForm((current) => ({
      ...current,
      environment: DEFAULT_PROVIDER_ENVIRONMENT,
      customerId: String(config.bulkCustomerId ?? config.bulk_customer_id ?? ""),
      pickupDropoffOfficeId: String(
        config.pickupDropoffOfficeId ?? config.pickup_dropoff_office_id ?? ""
      ),
      pickupDropoffOfficeName: String(
        config.pickupDropoffOfficeName ?? config.pickup_dropoff_office_name ?? ""
      ),
      pickupDropoffOfficePincode: String(
        config.pickupDropoffOfficePincode ?? config.pickup_dropoff_office_pincode ?? ""
      ),
      pickupOfficeId: String(config.pickupOfficeId ?? config.pickup_office_id ?? ""),
      pickupOfficeName: String(config.pickupOfficeName ?? config.pickup_office_name ?? ""),
      pickupOfficePincode: String(config.pickupOfficePincode ?? config.pickup_office_pincode ?? ""),
      pickupOfficeTypeCode: String(config.pickupOfficeTypeCode ?? config.pickup_office_type_code ?? ""),
      pickupOfficeCity: String(config.pickupOfficeCity ?? config.pickup_office_city ?? ""),
      pickupOfficeState: String(config.pickupOfficeState ?? config.pickup_office_state ?? ""),
      contracts,
      defaultServiceCode: knownService.has(savedDefault) ? savedDefault : DEFAULT_INDIA_POST_SERVICE,
      ranges: seriesDraftsFromConfig(config),
    }));
  }

  const savedOfficeId = String(
    config?.pickupDropoffOfficeId ?? config?.pickup_dropoff_office_id ?? ""
  );
  const savedOfficeName = String(
    config?.pickupDropoffOfficeName ?? config?.pickup_dropoff_office_name ?? ""
  );
  const savedOfficePincode = String(
    config?.pickupDropoffOfficePincode ?? config?.pickup_dropoff_office_pincode ?? ""
  );
  const savedPickupOfficeId = String(config?.pickupOfficeId ?? config?.pickup_office_id ?? "");
  const savedPickupOfficeName = String(config?.pickupOfficeName ?? config?.pickup_office_name ?? "");
  const savedPickupOfficePincode = String(
    config?.pickupOfficePincode ?? config?.pickup_office_pincode ?? ""
  );
  const savedPickupOfficeTypeCode = String(
    config?.pickupOfficeTypeCode ?? config?.pickup_office_type_code ?? ""
  );
  const savedPickupOfficeCity = String(config?.pickupOfficeCity ?? config?.pickup_office_city ?? "");
  const savedPickupOfficeState = String(config?.pickupOfficeState ?? config?.pickup_office_state ?? "");
  const savedRanges = seriesDraftsFromConfig(config);

  const dirty = useMemo(() => {
    if (!config) return false;
    const savedCustomer = String(config.bulkCustomerId ?? config.bulk_customer_id ?? "");
    const savedDefault = config.defaultServiceCode ?? DEFAULT_INDIA_POST_SERVICE;
    if (form.environment !== (config.environment ?? DEFAULT_PROVIDER_ENVIRONMENT)) return true;
    if (form.customerId !== savedCustomer) return true;
    if (replaceSecrets || form.password.trim()) return true;
    if (form.pickupDropoffOfficeId !== savedOfficeId) return true;
    if (form.pickupDropoffOfficeName !== savedOfficeName) return true;
    if (form.pickupDropoffOfficePincode !== savedOfficePincode) return true;
    if (form.pickupOfficeId !== savedPickupOfficeId) return true;
    if (form.pickupOfficeName !== savedPickupOfficeName) return true;
    if (form.pickupOfficePincode !== savedPickupOfficePincode) return true;
    if (form.pickupOfficeTypeCode !== savedPickupOfficeTypeCode) return true;
    if (form.pickupOfficeCity !== savedPickupOfficeCity) return true;
    if (form.pickupOfficeState !== savedPickupOfficeState) return true;
    if (form.defaultServiceCode !== savedDefault) return true;
    return INDIA_POST_SERVICES.some((service) => {
      const current = form.contracts.find((item) => item.serviceCode === service.code)?.contractId ?? "";
      const saved = config.contracts?.find((item) => item.serviceCode === service.code)?.contractId ?? "";
      return current !== saved;
    });
  }, [config, form, replaceSecrets, savedOfficeId, savedOfficeName, savedOfficePincode, savedPickupOfficeId, savedPickupOfficeName, savedPickupOfficePincode, savedPickupOfficeTypeCode, savedPickupOfficeCity, savedPickupOfficeState]);

  const saveOffice = useMutation({
    mutationFn: ({
      officeId,
      officeName,
      pincode,
    }: {
      officeId: string;
      officeName?: string | null;
      pincode?: string | null;
    }) => {
      const payload = indiaPostOfficeWritePayload(officeId, officeName, pincode);
      if ("error" in payload) throw new Error(payload.error);
      return api<{
        pickupDropoffOfficeId: string | null;
        pickupDropoffOfficeName: string | null;
        pickupDropoffOfficePincode: string | null;
      }>("/api/v1/integrations/india-post/office", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async (data) => {
      await queryClient.cancelQueries({ queryKey: INDIA_POST_QUERY_KEY });
      const saved = data.pickupDropoffOfficeId ?? null;
      const savedName = data.pickupDropoffOfficeName ?? null;
      const savedPin = data.pickupDropoffOfficePincode ?? null;
      setForm((current) => ({
        ...current,
        pickupDropoffOfficeId: saved ?? "",
        pickupDropoffOfficeName: savedName ?? "",
        pickupDropoffOfficePincode: savedPin ?? "",
      }));
      queryClient.setQueryData<IndiaPostConfig>(INDIA_POST_QUERY_KEY, (current) =>
        current
          ? {
              ...current,
              pickupDropoffOfficeId: saved,
              pickup_dropoff_office_id: saved,
              pickupDropoffOfficeName: savedName,
              pickup_dropoff_office_name: savedName,
              pickupDropoffOfficePincode: savedPin,
              pickup_dropoff_office_pincode: savedPin,
            }
          : current
      );
      toast.success(
        saved
          ? savedName
            ? `${savedName} (${saved}) saved.`
            : `Office ID ${saved} saved.`
          : "Drop-off office cleared."
      );
      queryClient.invalidateQueries({ queryKey: INDIA_POST_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const [finderEpoch, setFinderEpoch] = useState(0);
  const officeSaveFlight = useRef<string | null>(null);

  function persistOfficeId(
    value: string,
    options?: { force?: boolean; name?: string | null; pincode?: string | null }
  ) {
    const payload = indiaPostOfficeWritePayload(value, options?.name, options?.pincode);
    if ("error" in payload) {
      setForm((current) => ({ ...current, pickupDropoffOfficeId: savedOfficeId }));
      toast.error(payload.error);
      return;
    }
    const next = payload.pickupDropoffOfficeId ?? "";
    if (!options?.force && next === savedOfficeId && options?.name === undefined && options?.pincode === undefined) {
      return;
    }
    const flight = `${next}:${options?.name === undefined ? "_" : JSON.stringify(options.name)}:${options?.pincode === undefined ? "_" : JSON.stringify(options.pincode)}`;
    if (!options?.force && officeSaveFlight.current === flight) return;
    officeSaveFlight.current = flight;
    saveOffice.mutate(
      { officeId: next, officeName: options?.name, pincode: options?.pincode },
      {
        onSettled: () => {
          if (officeSaveFlight.current === flight) officeSaveFlight.current = null;
        },
      }
    );
  }

  type PickupOfficeSave = {
    officeId: string;
    officeName?: string | null;
    pincode?: string | null;
    officeTypeCode?: string | null;
    city?: string | null;
    state?: string | null;
  };

  const savePickupOffice = useMutation({
    mutationFn: (input: PickupOfficeSave) => {
      const payload = indiaPostPickupOfficeWritePayload(input);
      if ("error" in payload) throw new Error(payload.error);
      return api<{
        pickupOfficeId: string | null;
        pickupOfficeName: string | null;
        pickupOfficePincode: string | null;
        pickupOfficeTypeCode: string | null;
        pickupOfficeCity: string | null;
        pickupOfficeState: string | null;
      }>("/api/v1/integrations/india-post/pickup-office", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async (data) => {
      await queryClient.cancelQueries({ queryKey: INDIA_POST_QUERY_KEY });
      const saved = data.pickupOfficeId ?? null;
      const savedName = data.pickupOfficeName ?? null;
      const savedPin = data.pickupOfficePincode ?? null;
      const savedType = data.pickupOfficeTypeCode ?? null;
      const savedCity = data.pickupOfficeCity ?? null;
      const savedState = data.pickupOfficeState ?? null;
      setForm((current) => ({
        ...current,
        pickupOfficeId: saved ?? "",
        pickupOfficeName: savedName ?? "",
        pickupOfficePincode: savedPin ?? "",
        pickupOfficeTypeCode: savedType ?? "",
        pickupOfficeCity: savedCity ?? "",
        pickupOfficeState: savedState ?? "",
      }));
      queryClient.setQueryData<IndiaPostConfig>(INDIA_POST_QUERY_KEY, (current) =>
        current
          ? {
              ...current,
              pickupOfficeId: saved,
              pickup_office_id: saved,
              pickupOfficeName: savedName,
              pickup_office_name: savedName,
              pickupOfficePincode: savedPin,
              pickup_office_pincode: savedPin,
              pickupOfficeTypeCode: savedType,
              pickup_office_type_code: savedType,
              pickupOfficeCity: savedCity,
              pickup_office_city: savedCity,
              pickupOfficeState: savedState,
              pickup_office_state: savedState,
            }
          : current
      );
      toast.success(
        saved
          ? savedName
            ? `${savedName} (${saved}) saved.`
            : `Office ID ${saved} saved.`
          : "Pickup location cleared."
      );
      queryClient.invalidateQueries({ queryKey: INDIA_POST_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const [pickupFinderEpoch, setPickupFinderEpoch] = useState(0);
  const pickupSaveFlight = useRef<string | null>(null);

  function persistPickupOffice(input: PickupOfficeSave, options?: { force?: boolean }) {
    const payload = indiaPostPickupOfficeWritePayload(input);
    if ("error" in payload) {
      setForm((current) => ({
        ...current,
        pickupOfficeId: savedPickupOfficeId,
        pickupOfficeName: savedPickupOfficeName,
        pickupOfficePincode: savedPickupOfficePincode,
        pickupOfficeTypeCode: savedPickupOfficeTypeCode,
        pickupOfficeCity: savedPickupOfficeCity,
        pickupOfficeState: savedPickupOfficeState,
      }));
      toast.error(payload.error);
      return;
    }
    const next = payload.pickupOfficeId ?? "";
    if (
      !options?.force &&
      next === savedPickupOfficeId &&
      (input.officeName === undefined || (input.officeName ?? "") === savedPickupOfficeName)
    ) {
      return;
    }
    const flight = JSON.stringify(payload);
    if (!options?.force && pickupSaveFlight.current === flight) return;
    pickupSaveFlight.current = flight;
    savePickupOffice.mutate(input, {
      onSettled: () => {
        if (pickupSaveFlight.current === flight) pickupSaveFlight.current = null;
      },
    });
  }

  function applyPickupOffice(office: IndiaPostOfficeRow) {
    const next = office.officeId.replace(/\D/g, "").slice(0, 8);
    setForm((current) => ({
      ...current,
      pickupOfficeId: next,
      pickupOfficeName: office.name ?? "",
      pickupOfficePincode: office.pincode ?? "",
      pickupOfficeTypeCode: office.officeTypeCode ?? "",
      pickupOfficeCity: office.city ?? "",
      pickupOfficeState: office.state ?? "",
    }));
    persistPickupOffice(
      {
        officeId: next,
        officeName: office.name ?? null,
        pincode: office.pincode ?? null,
        officeTypeCode: office.officeTypeCode ?? null,
        city: office.city ?? null,
        state: office.state ?? null,
      },
      { force: true }
    );
  }

  const save = useMutation({
    mutationFn: (snapshot: FormState) => {
      const customerId = snapshot.customerId.trim();
      if (!prodConfigured) {
        throw new Error("Live booking is not ready yet.");
      }
      return api<{ saved: boolean; status: string }>("/api/v1/integrations/india-post", {
        method: "POST",
        body: JSON.stringify({
          connect: false,
          environment: DEFAULT_PROVIDER_ENVIRONMENT,
          username: replaceSecrets || !hasSecrets ? customerId || undefined : undefined,
          password: replaceSecrets || (!hasSecrets && snapshot.password.trim()) ? snapshot.password || undefined : undefined,
          bulkCustomerId: customerId || undefined,
          pickupDropoffOfficeId: snapshot.pickupDropoffOfficeId.trim() || null,
          pickupDropoffOfficeName: snapshot.pickupDropoffOfficeName.trim() || null,
          pickupOfficeId: snapshot.pickupOfficeId.trim() || null,
          pickupOfficeName: snapshot.pickupOfficeName.trim() || null,
          pickupOfficePincode: snapshot.pickupOfficePincode.trim() || null,
          pickupOfficeTypeCode: snapshot.pickupOfficeTypeCode.trim() || null,
          pickupOfficeCity: snapshot.pickupOfficeCity.trim() || null,
          pickupOfficeState: snapshot.pickupOfficeState.trim() || null,
          contracts: INDIA_POST_SERVICES.map((service) => {
            const row = snapshot.contracts.find((item) => item.serviceCode === service.code);
            return {
              serviceCode: service.code,
              contractId: row?.contractId.trim() ?? "",
              isDefault: snapshot.defaultServiceCode === service.code,
            };
          }),
        }),
      });
    },
    onSuccess: () => {
      notifyIndiaPostSaved();
      setForm((current) => ({ ...current, password: "" }));
      setReplaceSecrets(false);
      queryClient.invalidateQueries({ queryKey: INDIA_POST_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const login = useMutation({
    mutationFn: (snapshot: FormState) => {
      const customerId = snapshot.customerId.trim();
      const needsCredentials = replaceSecrets || !hasSecrets;
      if (!prodConfigured) {
        throw new Error("Live booking is not ready yet.");
      }
      if (!customerId) {
        throw new Error("Enter your India Post customer ID.");
      }
      if (needsCredentials && !snapshot.password.trim()) {
        throw new Error("Enter your India Post password.");
      }
      if (!needsCredentials) {
        return api("/api/v1/integrations/india-post/verify", { method: "POST" });
      }
      return api("/api/v1/integrations/india-post", {
        method: "POST",
        body: JSON.stringify({
          environment: DEFAULT_PROVIDER_ENVIRONMENT,
          username: customerId,
          password: snapshot.password,
          bulkCustomerId: customerId,
          pickupDropoffOfficeId: snapshot.pickupDropoffOfficeId.trim() || null,
          pickupDropoffOfficeName: snapshot.pickupDropoffOfficeName.trim() || null,
          pickupOfficeId: snapshot.pickupOfficeId.trim() || null,
          pickupOfficeName: snapshot.pickupOfficeName.trim() || null,
          pickupOfficePincode: snapshot.pickupOfficePincode.trim() || null,
          pickupOfficeTypeCode: snapshot.pickupOfficeTypeCode.trim() || null,
          pickupOfficeCity: snapshot.pickupOfficeCity.trim() || null,
          pickupOfficeState: snapshot.pickupOfficeState.trim() || null,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Logged in to India Post.");
      setForm((current) => ({ ...current, password: "" }));
      setReplaceSecrets(false);
      queryClient.invalidateQueries({ queryKey: INDIA_POST_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const loggedIn =
    hasSecrets || config?.status === "CONNECTED" || config?.status === "PENDING";

  const logout = useMutation({
    mutationFn: () =>
      api<{ loggedOut: boolean; status: string }>("/api/v1/integrations/india-post", {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("Logged out of India Post. Saved login was cleared.");
      setReplaceSecrets(false);
      setForm((current) => ({
        ...current,
        customerId: "",
        password: "",
      }));
      queryClient.invalidateQueries({ queryKey: INDIA_POST_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveContract = useMutation({
    mutationFn: ({ serviceCode, contractId }: { serviceCode: string; contractId: string }) =>
      api<{
        contracts: IndiaPostConfig["contracts"];
        defaultServiceCode: string;
      }>("/api/v1/integrations/india-post/contracts", {
        method: "PATCH",
        body: JSON.stringify({ serviceCode, contractId }),
      }),
    onSuccess: (data, variables) => {
      setForm((current) => ({
        ...current,
        contracts: (data.contracts ?? []).map((contract) => ({
          serviceCode: contract.serviceCode,
          contractId: contract.contractId,
        })),
        defaultServiceCode: data.defaultServiceCode,
      }));
      queryClient.setQueryData<IndiaPostConfig>(INDIA_POST_QUERY_KEY, (current) =>
        current
          ? {
              ...current,
              contracts: data.contracts,
              defaultServiceCode: data.defaultServiceCode,
            }
          : current
      );
      queryClient.invalidateQueries({ queryKey: INDIA_POST_QUERY_KEY });
      toast.success(
        variables.contractId
          ? `${indiaPostServiceLabel(variables.serviceCode)} contract saved.`
          : `${indiaPostServiceLabel(variables.serviceCode)} contract cleared.`
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const contractSaveFlight = useRef<string | null>(null);

  function savedContractId(serviceCode: string) {
    return (
      config?.contracts?.find((contract) => contract.serviceCode === serviceCode)?.contractId ?? ""
    );
  }

  function persistContract(serviceCode: string, contractId: string, options?: { force?: boolean }) {
    const next = contractId.replace(/\D/g, "").slice(0, 20);
    const saved = savedContractId(serviceCode);
    if (next && !/^\d{4,20}$/.test(next)) {
      setContract(serviceCode, saved);
      toast.error("Contract ID must be the numeric ID from the India Post portal.");
      return;
    }
    if (!options?.force && next === saved) return;
    const flight = `${serviceCode}:${next}`;
    if (contractSaveFlight.current === flight && !options?.force) return;
    contractSaveFlight.current = flight;
    saveContract.mutate(
      { serviceCode, contractId: next },
      {
        onSettled: () => {
          if (contractSaveFlight.current === flight) contractSaveFlight.current = null;
        },
      }
    );
  }

  const setDefault = useMutation({
    mutationFn: (serviceCode: string) =>
      api<{ defaultServiceCode: string; bookingServiceOverride: null }>(
        "/api/v1/integrations/india-post/default-service",
        {
          method: "PATCH",
          body: JSON.stringify({ serviceCode }),
        }
      ),
    onSuccess: (data) => {
      queryClient.setQueryData<IndiaPostConfig>(INDIA_POST_QUERY_KEY, (current) =>
        current
          ? {
              ...current,
              defaultServiceCode: data.defaultServiceCode,
              bookingServiceOverride: null,
              contracts: current.contracts?.map((contract) => ({
                ...contract,
                isDefault: contract.serviceCode === data.defaultServiceCode,
              })),
            }
          : current
      );
      queryClient.invalidateQueries({ queryKey: INDIA_POST_QUERY_KEY });
      toast.success("Default service saved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateSeries(serviceCode: string, patch: Partial<SeriesDraft>) {
    setForm((current) => ({
      ...current,
      ranges: current.ranges.map((row) =>
        row.serviceCode === serviceCode ? { ...row, ...patch } : row
      ),
    }));
  }

  function savedSeries(serviceCode: string) {
    return savedRanges.find((row) => row.serviceCode === serviceCode) ?? emptySeries(serviceCode);
  }

  const saveRange = useMutation({
    mutationFn: ({
      barcodeRange,
      serviceCode,
      prefix,
    }: {
      barcodeRange: ReturnType<typeof barcodeRangeWritePayload>;
      serviceCode: string;
      prefix?: string;
    }) =>
      api<{
        barcodeRange: IndiaPostConfig["barcodeRange"];
        barcodeRanges: IndiaPostConfig["barcodeRanges"];
      }>("/api/v1/integrations/india-post/barcode-range", {
        method: "PATCH",
        body: JSON.stringify({ barcodeRange, serviceCode, prefix }),
      }),
    onSuccess: (data, variables) => {
      const ranges = seriesDraftsFromConfig({
        barcodeRanges: data.barcodeRanges ?? [],
        barcodeRange: data.barcodeRange,
      });
      setForm((current) => ({ ...current, ranges }));
      queryClient.setQueryData<IndiaPostConfig>(INDIA_POST_QUERY_KEY, (current) =>
        current
          ? {
              ...current,
              barcodeRange: data.barcodeRange ?? null,
              barcodeRanges: data.barcodeRanges ?? [],
            }
          : current
      );
      queryClient.invalidateQueries({ queryKey: INDIA_POST_QUERY_KEY });
      const label = variables.serviceCode === INDIA_POST_COD_RANGE_CODE ? "COD" : indiaPostServiceLabel(variables.serviceCode);
      toast.success(variables.barcodeRange ? `${label} barcode range saved.` : `${label} barcode range cleared.`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rangeSaveFlight = useRef<string | null>(null);

  function persistSeries(draft: SeriesDraft, options?: { force?: boolean; clearPrefix?: string }) {
    const prefix = draft.prefix.trim().toUpperCase();
    if (prefix && !barcodePrefixAllowedForService(prefix, draft.serviceCode)) {
      toast.error(barcodePrefixServiceMessage(prefix));
      return;
    }
    const nextDraft = { ...draft, prefix };
    const payload = barcodeRangeWritePayload(nextDraft);
    if (payload === undefined) return;
    if (payload === null && !options?.force) return;
    const saved = savedSeries(draft.serviceCode);
    const hasSaved = Boolean(saved.prefix || saved.startNumber || saved.endNumber);
    const sameAsSaved =
      !payload && !hasSaved
        ? true
        : Boolean(payload) &&
          nextDraft.prefix === saved.prefix &&
          nextDraft.suffix === saved.suffix &&
          nextDraft.startNumber === saved.startNumber &&
          nextDraft.endNumber === saved.endNumber;
    if (!options?.force && sameAsSaved) return;
    const flight = payload
      ? `${payload.serviceCode}:${payload.prefix}:${payload.suffix}:${payload.startNumber}:${payload.endNumber}`
      : `clear:${draft.serviceCode}:${options?.clearPrefix ?? prefix}`;
    if (!options?.force && rangeSaveFlight.current === flight) return;
    rangeSaveFlight.current = flight;
    saveRange.mutate(
      {
        barcodeRange: payload,
        serviceCode: draft.serviceCode,
        prefix: payload ? undefined : options?.clearPrefix || prefix || saved.prefix,
      },
      {
        onSettled: () => {
          if (rangeSaveFlight.current === flight) rangeSaveFlight.current = null;
        },
      }
    );
  }

  function clearSeries(serviceCode: string) {
    const current = form.ranges.find((row) => row.serviceCode === serviceCode) ?? emptySeries(serviceCode);
    const prefix = current.prefix.trim() || savedSeries(serviceCode).prefix;
    const cleared = emptySeries(serviceCode);
    updateSeries(serviceCode, cleared);
    persistSeries(cleared, { force: true, clearPrefix: prefix });
  }

  function setContract(serviceCode: string, contractId: string) {
    setForm((current) => {
      const contracts = current.contracts.some((item) => item.serviceCode === serviceCode)
        ? current.contracts.map((item) =>
            item.serviceCode === serviceCode ? { ...item, contractId } : item
          )
        : [...current.contracts, { serviceCode, contractId }];
      return { ...current, contracts };
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={<IndiaPostLogo className="h-12 max-w-[12rem]" />}
        description="Sign in with your India Post customer ID and password, then add your post office and barcode series."
        actions={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <IndiaPostWatchTutorialLink />
            <StatusBadge value={config?.status ?? "NOT_CONNECTED"} />
            <Button
              type="button"
              size="sm"
              variant={dirty ? "primary" : "secondary"}
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate(form)}
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      />

      <IndiaPostGuideBanner selectedService={form.defaultServiceCode} />

      <div className={SECTION_GRID}>
      <Card
        id="india-post-connection"
        className={cn(
          CARD,
          "scroll-mt-24",
          highlightConnection && "ring-2 ring-brand ring-offset-2 ring-offset-background"
        )}
      >
        <CardHeader className={CARD_HEADER}>
          <StepTitle step={1}>Connection</StepTitle>
          <CardDescription>
            Use the customer ID and password from your India Post booking account. Your password is saved securely.
          </CardDescription>
          {lastVerified ? (
            <p className="text-xs text-muted">Last checked {formatDate(lastVerified, true)}</p>
          ) : null}
        </CardHeader>
        <CardContent className={cn(CARD_CONTENT, "grid content-start gap-4 sm:grid-cols-2")}>
          <Field
            label="Customer ID"
            value={form.customerId}
            onChange={(value) => set("customerId", value)}
            autoComplete="off"
            placeholder="e.g. 1788590988"
          />
          {hasSecrets && !replaceSecrets ? (
            <div className="space-y-2">
              <Label>Password</Label>
              <div className="flex h-11 items-center justify-between gap-3 rounded-[var(--radius-btn)] border border-border bg-surface px-3 text-sm text-muted">
                Saved securely
                <button
                  type="button"
                  className="shrink-0 font-medium text-brand hover:underline"
                  onClick={() => setReplaceSecrets(true)}
                >
                  Replace
                </button>
              </div>
            </div>
          ) : (
            <Field
              label="Password"
              type="password"
              value={form.password}
              onChange={(value) => set("password", value)}
              autoComplete="new-password"
            />
          )}
          {productionBlocked ? (
            <p className="rounded-xl border border-border bg-surface-soft px-3 py-2 text-sm text-muted sm:col-span-2">
              Live booking is not ready yet.
            </p>
          ) : null}
          {lastError ? (
            <p
              role="alert"
              className="rounded-xl border border-error/20 bg-error/5 px-3 py-2 text-sm text-error sm:col-span-2"
            >
              {lastError}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className={CARD_FOOTER}>
          <Button
            type="button"
            size="sm"
            variant={loggedIn && !replaceSecrets ? "secondary" : "primary"}
            onClick={() => login.mutate(form)}
            disabled={
              login.isPending ||
              productionBlocked ||
              !form.customerId.trim() ||
              !(hasSecrets || form.password.trim())
            }
          >
            {login.isPending ? "Logging in…" : loggedIn && !replaceSecrets ? "Check login" : "Login"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto text-error hover:bg-error/5"
            disabled={!loggedIn || logout.isPending}
            onClick={() => {
              if (
                !window.confirm(
                  "Log out of India Post for this workspace? This clears the saved customer ID, password, and session tokens. Office ID, barcodes, and contracts stay."
                )
              ) {
                return;
              }
              logout.mutate();
            }}
          >
            {logout.isPending ? "Logging out…" : "Logout"}
          </Button>
        </CardFooter>
      </Card>

      <Card className={CARD}>
        <CardHeader className={CARD_HEADER}>
          <StepTitle step={2}>Webhook URLs</StepTitle>
          <CardDescription>
            Copy these links into your India Post portal. PostBus uses them to receive booking confirmations and
            Shipment Tracking updates for this workspace.
            {bookingWebhookUrl || eventsWebhookUrl
              ? ""
              : " Log in to India Post above to generate the links."}
          </CardDescription>
        </CardHeader>
        <CardContent className={cn(CARD_CONTENT, "grid gap-5")}>
          <CopyField
            id="india-post-booking-webhook"
            label="Booking"
            hint="India Post sends a notice here when a shipment is booked."
            value={bookingWebhookUrl}
            placeholder="Log in to India Post to generate this link"
          />
          <CopyField
            id="india-post-events-webhook"
            label="Shipment Tracking"
            hint="India Post sends scan updates here as the parcel moves — bagged, in transit, out for delivery, and delivered."
            value={eventsWebhookUrl}
            placeholder="Log in to India Post to generate this link"
          />
        </CardContent>
      </Card>
      </div>

      <div className={SECTION_GRID}>
      <Card className={CARD}>
        <CardHeader className={CARD_HEADER}>
          <StepTitle step={3}>Pickup location</StepTitle>
          <CardDescription>
            Search the 6-digit pincode and select the office used as the pickup origin.
          </CardDescription>
        </CardHeader>
        <CardContent className={cn(CARD_CONTENT, "flex flex-wrap items-start gap-x-4 gap-y-3")}>
          {savedPickupOfficeId && !savedPickupOfficePincode ? (
            <InlineWarning>This pickup office is missing its pincode. Search and select it again.</InlineWarning>
          ) : null}
          <IndiaPostOfficeFinder
            key={pickupFinderEpoch}
            idPrefix="pickup-office"
            label="Pickup pincode"
            officeId={form.pickupOfficeId}
            onSelect={applyPickupOffice}
            canSearch={Boolean(form.customerId && (hasSecrets || form.password))}
          />
          <Field
            className="w-[9.5rem]"
            label="Office ID"
            value={form.pickupOfficeId}
            placeholder="21360043"
            onChange={(value) => {
              const next = value.replace(/\D/g, "").slice(0, 8);
              setForm((current) => ({
                ...current,
                pickupOfficeId: next,
                pickupOfficeName: next === savedPickupOfficeId ? current.pickupOfficeName : "",
                pickupOfficePincode: next === savedPickupOfficeId ? current.pickupOfficePincode : "",
                pickupOfficeTypeCode: next === savedPickupOfficeId ? current.pickupOfficeTypeCode : "",
                pickupOfficeCity: next === savedPickupOfficeId ? current.pickupOfficeCity : "",
                pickupOfficeState: next === savedPickupOfficeId ? current.pickupOfficeState : "",
              }));
            }}
            onBlur={(value) => persistPickupOffice({ officeId: value })}
          />
          {form.pickupOfficeName ? (
            <SelectedOffice
              name={form.pickupOfficeName}
              officeId={form.pickupOfficeId}
              meta={[form.pickupOfficePincode, form.pickupOfficeCity, form.pickupOfficeState]}
            />
          ) : null}
        </CardContent>
        <CardFooter className={CARD_FOOTER}>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() =>
              persistPickupOffice(
                {
                  officeId: form.pickupOfficeId,
                  officeName: form.pickupOfficeName.trim() || null,
                  pincode: form.pickupOfficePincode.trim() || null,
                  officeTypeCode: form.pickupOfficeTypeCode.trim() || null,
                  city: form.pickupOfficeCity.trim() || null,
                  state: form.pickupOfficeState.trim() || null,
                },
                { force: true }
              )
            }
            disabled={savePickupOffice.isPending}
          >
            {savePickupOffice.isPending ? "Saving…" : "Save pickup location"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setForm((current) => ({
                ...current,
                pickupOfficeId: "",
                pickupOfficeName: "",
                pickupOfficePincode: "",
                pickupOfficeTypeCode: "",
                pickupOfficeCity: "",
                pickupOfficeState: "",
              }));
              setPickupFinderEpoch((current) => current + 1);
              persistPickupOffice(
                {
                  officeId: "",
                  officeName: null,
                  pincode: null,
                  officeTypeCode: null,
                  city: null,
                  state: null,
                },
                { force: true }
              );
            }}
            disabled={savePickupOffice.isPending || (!savedPickupOfficeId && !form.pickupOfficeId)}
          >
            Change pickup location
          </Button>
        </CardFooter>
      </Card>

        <Card className={CARD}>
          <CardHeader className={CARD_HEADER}>
            <StepTitle step={4}>Drop-off office</StepTitle>
            <CardDescription>
              Search the 6-digit pincode and select the office used as the booking origin.
            </CardDescription>
          </CardHeader>
          <CardContent className={cn(CARD_CONTENT, "flex flex-wrap items-start gap-x-4 gap-y-3")}>
            {savedOfficeId && !savedOfficePincode ? (
              <InlineWarning>This office is missing its pincode. Search and select it again.</InlineWarning>
            ) : null}
            <IndiaPostOfficeFinder
              key={finderEpoch}
              idPrefix="drop-office"
              officeId={form.pickupDropoffOfficeId}
              onSelect={(office) => {
                setForm((current) => ({
                  ...current,
                  pickupDropoffOfficeId: office.officeId,
                  pickupDropoffOfficeName: office.name,
                  pickupDropoffOfficePincode: office.pincode,
                }));
                persistOfficeId(office.officeId, {
                  force: true,
                  name: office.name,
                  pincode: office.pincode,
                });
              }}
              canSearch={Boolean(form.customerId && (hasSecrets || form.password))}
            />
            <Field
              className="w-[9.5rem]"
              label="Office ID"
              value={form.pickupDropoffOfficeId}
              placeholder="22660454"
              onChange={(value) => {
                const next = value.replace(/\D/g, "").slice(0, 8);
                setForm((current) => ({
                  ...current,
                  pickupDropoffOfficeId: next,
                  pickupDropoffOfficeName:
                    next === savedOfficeId ? current.pickupDropoffOfficeName : "",
                  pickupDropoffOfficePincode:
                    next === savedOfficeId ? current.pickupDropoffOfficePincode : "",
                }));
              }}
              onBlur={(value) => persistOfficeId(value)}
            />
            {form.pickupDropoffOfficeName ? (
              <SelectedOffice
                name={form.pickupDropoffOfficeName}
                officeId={form.pickupDropoffOfficeId}
                meta={[form.pickupDropoffOfficePincode]}
              />
            ) : null}
          </CardContent>
          <CardFooter className={CARD_FOOTER}>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                persistOfficeId(form.pickupDropoffOfficeId, {
                  force: true,
                  name: form.pickupDropoffOfficeName.trim() || null,
                  pincode: form.pickupDropoffOfficePincode.trim() || null,
                })
              }
              disabled={saveOffice.isPending}
            >
              {saveOffice.isPending ? "Saving…" : "Save office ID"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setForm((current) => ({
                  ...current,
                  pickupDropoffOfficeId: "",
                  pickupDropoffOfficeName: "",
                  pickupDropoffOfficePincode: "",
                }));
                setFinderEpoch((current) => current + 1);
                persistOfficeId("", { force: true, name: null, pincode: null });
              }}
              disabled={saveOffice.isPending || (!savedOfficeId && !form.pickupDropoffOfficeId)}
            >
              Clear office
            </Button>
          </CardFooter>
        </Card>
      </div>

      <div className={SECTION_GRID}>
        <Card className={CARD}>
          <CardHeader className={CARD_HEADER}>
            <StepTitle step={5}>Barcode range</StepTitle>
            <CardDescription>
              Get the barcode series from your nearest post office. Enter the prefix and the start and end numbers
              they allotted you. Paste the 8-digit serial, or the 9-digit number that includes the check digit.
            </CardDescription>
          </CardHeader>
          <CardContent className={cn(CARD_CONTENT, "space-y-3")}>
            {INDIA_POST_SERVICES.map((service) => {
              const draft =
                form.ranges.find((row) => row.serviceCode === service.code) ?? emptySeries(service.code);
              const saved = savedSeries(service.code);
              const hasSaved = Boolean(saved.prefix || saved.startNumber || saved.endNumber);
              const payload = barcodeRangeWritePayload(draft);
              return (
                <div
                  key={service.code}
                  className={SUB_PANEL}
                >
                  <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{service.label}</p>
                    <p className="text-xs text-muted">
                      {service.code === "BUSINESS_PARCEL"
                        ? "Books as India Post Parcel Contractual. Prefix CX or CL."
                        : "Books as SP Inland Parcel. Prefix EY or EL."}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="xs"
                                            onClick={() => persistSeries(draft, { force: true })}
                      disabled={saveRange.isPending || !payload}
                    >
                      {saveRange.isPending ? "Saving…" : "Save"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                                            onClick={() => clearSeries(service.code)}
                      disabled={
                        saveRange.isPending ||
                        (!hasSaved && !draft.prefix && !draft.startNumber && !draft.endNumber)
                      }
                    >
                      Clear
                    </Button>
                  </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1fr)]">
                    <Field
                      className={PREFIX_FIELD}
                      label="Prefix"
                      value={draft.prefix}
                      placeholder={service.code === "BUSINESS_PARCEL" ? "CL" : "EY"}
                      maxLength={2}
                      error={prefixErrors[service.code] || undefined}
                      onChange={(value) => {
                        const prefix = value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
                        setPrefixErrors((current) => ({
                          ...current,
                          [service.code]:
                            prefix === INDIA_POST_COD_PREFIX
                              ? "EZ belongs in the COD series below."
                              : "",
                        }));
                        updateSeries(service.code, { prefix });
                      }}
                      onBlur={(value) => {
                        const prefix = value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
                        updateSeries(service.code, { prefix });
                        if (prefix === INDIA_POST_COD_PREFIX) return;
                        persistSeries({ ...draft, prefix, suffix: "IN" });
                      }}
                    />
                    <Field
                      label="Start number"
                      value={draft.startNumber}
                      placeholder="7536320"
                      maxLength={BARCODE_ALLOTMENT_DIGITS}
                      inputMode="numeric"
                      onChange={(value) =>
                        updateSeries(service.code, { startNumber: sanitizeBarcodeAllotmentField(value) })
                      }
                      onBlur={(value) =>
                        persistSeries({
                          ...draft,
                          startNumber: sanitizeBarcodeAllotmentField(value),
                        })
                      }
                    />
                    <Field
                      label="End number"
                      value={draft.endNumber}
                      placeholder="7537319"
                      maxLength={BARCODE_ALLOTMENT_DIGITS}
                      inputMode="numeric"
                      onChange={(value) =>
                        updateSeries(service.code, { endNumber: sanitizeBarcodeAllotmentField(value) })
                      }
                      onBlur={(value) =>
                        persistSeries({
                          ...draft,
                          endNumber: sanitizeBarcodeAllotmentField(value),
                        })
                      }
                    />
                  </div>
                </div>
              );
            })}
            {(() => {
              const draft =
                form.ranges.find((row) => row.serviceCode === INDIA_POST_COD_RANGE_CODE) ??
                emptySeries(INDIA_POST_COD_RANGE_CODE);
              const saved = savedSeries(INDIA_POST_COD_RANGE_CODE);
              const hasSaved = Boolean(saved.startNumber || saved.endNumber);
              const payload = barcodeRangeWritePayload(draft);
              const stock = barcodeStockForService(config?.barcodeRanges ?? [], INDIA_POST_COD_RANGE_CODE);
              const left = barcodesLeft(stock);
              return (
                <div className={SUB_PANEL}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">COD</p>
                        <span className="rounded-md border border-border px-1.5 py-0.5 text-xs font-medium text-foreground">
                          Optional
                        </span>
                      </div>
                      <p className="text-xs text-muted">
                        Cash on delivery only. Prefix EZ. Leave blank to book COD on the Speed Post or Business
                        Parcel series.
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="xs"
                                                onClick={() => persistSeries(draft, { force: true })}
                        disabled={saveRange.isPending || !payload}
                      >
                        {saveRange.isPending ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                                                onClick={() => clearSeries(INDIA_POST_COD_RANGE_CODE)}
                        disabled={saveRange.isPending || (!hasSaved && !draft.startNumber && !draft.endNumber)}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1fr)]">
                    <Field
                      className={PREFIX_FIELD}
                      label="Prefix"
                      value={INDIA_POST_COD_PREFIX}
                      readOnly
                      onChange={() => undefined}
                    />
                    <Field
                      label="Start number"
                      value={draft.startNumber}
                      placeholder="7536320"
                      maxLength={BARCODE_ALLOTMENT_DIGITS}
                      inputMode="numeric"
                      onChange={(value) =>
                        updateSeries(INDIA_POST_COD_RANGE_CODE, {
                          prefix: INDIA_POST_COD_PREFIX,
                          startNumber: sanitizeBarcodeAllotmentField(value),
                        })
                      }
                      onBlur={(value) =>
                        persistSeries({
                          ...draft,
                          prefix: INDIA_POST_COD_PREFIX,
                          startNumber: sanitizeBarcodeAllotmentField(value),
                        })
                      }
                    />
                    <Field
                      label="End number"
                      value={draft.endNumber}
                      placeholder="7537319"
                      maxLength={BARCODE_ALLOTMENT_DIGITS}
                      inputMode="numeric"
                      onChange={(value) =>
                        updateSeries(INDIA_POST_COD_RANGE_CODE, {
                          prefix: INDIA_POST_COD_PREFIX,
                          endNumber: sanitizeBarcodeAllotmentField(value),
                        })
                      }
                      onBlur={(value) =>
                        persistSeries({
                          ...draft,
                          prefix: INDIA_POST_COD_PREFIX,
                          endNumber: sanitizeBarcodeAllotmentField(value),
                        })
                      }
                    />
                  </div>
                  {left != null && stock ? (
                    <p
                      role="status"
                      className={
                        left <= LOW_BARCODE_THRESHOLD ? "text-xs font-medium text-warning" : "text-xs text-muted"
                      }
                    >
                      {formatNumber(left)} barcodes left · EZ series
                    </p>
                  ) : null}
                </div>
              );
            })()}
          </CardContent>
        </Card>

      <Card className={CARD}>
        <CardHeader className={CARD_HEADER}>
          <StepTitle step={6}>Service contracts</StepTitle>
          <CardDescription>
            One contract number per service you ship. Leave unused rows blank. New shipments use the default.
          </CardDescription>
        </CardHeader>
        <CardContent className={cn(CARD_CONTENT, "space-y-3")}>
          {INDIA_POST_SERVICES.map((service) => {
            const row = form.contracts.find((item) => item.serviceCode === service.code);
            const value = row?.contractId ?? "";
            const isDefault = form.defaultServiceCode === service.code;
            const stock = value.trim()
              ? barcodeStockForService(config?.barcodeRanges ?? [], service.code)
              : null;
            const left = barcodesLeft(stock);
            const inputId = `india-post-contract-${service.code}`;
            return (
              <div
                key={service.code}
                className={cn(SUB_PANEL, isDefault && "border-brand/40 bg-brand/[0.03]")}
              >
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Label htmlFor={inputId} className="text-sm font-medium text-foreground">
                        {service.label}
                      </Label>
                      {isDefault ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-white">
                          <Check className="size-3" aria-hidden="true" />
                          Default
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted">{service.description}</p>
                  </div>
                  {left != null && stock ? (
                    <p
                      className={cn(
                        "shrink-0 text-xs tabular-nums",
                        left <= LOW_BARCODE_THRESHOLD ? "font-medium text-warning" : "text-muted"
                      )}
                    >
                      {formatNumber(left)} barcodes left
                      {stock.prefix ? ` · ${stock.prefix}` : ""}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id={inputId}
                    value={value}
                    placeholder="Contract ID"
                    inputMode="numeric"
                    className="min-w-[10rem] flex-1 font-mono tabular-nums"
                    onChange={(event) => setContract(service.code, event.target.value.replace(/\D/g, "").slice(0, 20))}
                    onBlur={(event) => persistContract(service.code, event.target.value)}
                  />
                  {!isDefault ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="shrink-0"
                      title={`Set ${service.label} as the India Post default`}
                      disabled={!value.trim() || setDefault.isPending}
                      onClick={() => setDefault.mutate(service.code)}
                    >
                      Set default
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    disabled={!value.trim() || saveContract.isPending}
                    onClick={() => {
                      setContract(service.code, "");
                      persistContract(service.code, "", { force: true });
                    }}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

function CopyField({
  id,
  label,
  value,
  placeholder,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      <div className="flex items-center gap-2">
        <Input
          id={id}
          readOnly
          value={value}
          placeholder={placeholder}
          className="font-mono text-sm tracking-tight"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="shrink-0"
          disabled={!value}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            toast.success(`${label} link copied.`);
          }}
        >
          <Copy />
          Copy
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  onBlur,
  type = "text",
  autoComplete,
  placeholder,
  hint,
  error,
  maxLength,
  inputMode,
  readOnly,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: (value: string) => void;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  hint?: string;
  error?: string;
  maxLength?: number;
  inputMode?: "numeric" | "text" | "tel";
  readOnly?: boolean;
  className?: string;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";
  const inputId = useId();
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <Label htmlFor={inputId}>{label}</Label>
      <div className={isPassword ? "relative" : undefined}>
        <Input
          id={inputId}
          type={isPassword && showPassword ? "text" : type}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          maxLength={maxLength}
          inputMode={inputMode}
          readOnly={readOnly}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          aria-readonly={readOnly || undefined}
          className={isPassword ? "pr-11" : readOnly ? "bg-muted/40" : undefined}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur ? (event) => onBlur(event.target.value) : undefined}
        />
        {isPassword ? (
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted hover:text-foreground"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((current) => !current)}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} className="text-sm text-warning">
          {error}
        </p>
      ) : null}
      {hint ? <p className="text-sm font-medium text-foreground">{hint}</p> : null}
    </div>
  );
}

function StepTitle({ step, children }: { step: number; children: ReactNode }) {
  return (
    <CardTitle as="h2" className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold tabular-nums text-brand"
      >
        {step}
      </span>
      {children}
    </CardTitle>
  );
}

function InlineWarning({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex basis-full items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function SelectedOffice({
  name,
  officeId,
  meta,
}: {
  name: string;
  officeId: string;
  meta: string[];
}) {
  const details = meta.filter(Boolean).join(" · ");
  return (
    <div className="flex basis-full items-start gap-3 rounded-xl border border-border bg-surface-soft/60 px-3 py-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
        <MapPin className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{name}</p>
        {details ? <p className="truncate text-xs text-muted">{details}</p> : null}
      </div>
      {officeId ? (
        <span className="shrink-0 self-center font-mono text-xs tabular-nums text-muted">{officeId}</span>
      ) : null}
    </div>
  );
}
