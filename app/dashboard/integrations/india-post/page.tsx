"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate, formatNumber } from "@/lib/format";
import {
  BARCODE_ALLOTMENT_DIGITS,
  barcodeStockForService,
  barcodesLeft,
  formatStoredSerial,
  primaryActiveBarcodeRange,
  sanitizeBarcodeAllotmentField,
} from "@/modules/india-post/barcode";
import { api } from "@/lib/hooks/use-api";
import { INDIA_POST_QUERY_KEY, useIndiaPost } from "@/lib/hooks/use-india-post";
import { cn } from "@/lib/utils";
import { Copy, Eye, EyeOff } from "lucide-react";
import { IndiaPostOfficeFinder, type IndiaPostOfficeRow } from "@/components/integrations/india-post-office-finder";
import { notifyIndiaPostSaved } from "@/components/integrations/india-post-saved-toast";
import { indiaPostOfficeWritePayload, indiaPostPickupOfficeWritePayload } from "@/modules/india-post/office-patch";
import {
  DEFAULT_INDIA_POST_SERVICE,
  DEFAULT_PROVIDER_ENVIRONMENT,
  INDIA_POST_SERVICES,
  PROVIDER_ENVIRONMENTS,
  indiaPostServiceLabel,
} from "@/types/domain";
import type { IndiaPostConfig } from "@/types/api";

type ContractRow = { serviceCode: string; contractId: string };

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
  rangeServiceCode: string;
  prefix: string;
  suffix: string;
  startNumber: string;
  endNumber: string;
};

const ANY_SERVICE = "ANY";

function displayedIndiaPostRange(config: IndiaPostConfig | undefined) {
  if (!config) return null;
  return config.barcodeRange ?? primaryActiveBarcodeRange(config.barcodeRanges ?? []) ?? null;
}

function barcodeRangeWritePayload(snapshot: FormState) {
  const prefix = snapshot.prefix.trim();
  const startNumber = snapshot.startNumber.trim();
  const endNumber = snapshot.endNumber.trim();
  if (!prefix && !startNumber && !endNumber) return null;
  if (!prefix || !startNumber || !endNumber) return undefined;
  return {
    prefix,
    suffix: snapshot.suffix.trim() || "IN",
    startNumber,
    endNumber,
    serviceCode: snapshot.rangeServiceCode === ANY_SERVICE ? null : snapshot.rangeServiceCode,
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
  rangeServiceCode: ANY_SERVICE,
  prefix: "",
  suffix: "IN",
  startNumber: "",
  endNumber: "",
};

export default function IndiaPostPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [replaceSecrets, setReplaceSecrets] = useState(false);

  const query = useIndiaPost();

  const config = query.data;
  const hasSecrets = Boolean(
    config?.hasPassword ?? config?.has_password ?? config?.usernameMasked ?? config?.username_masked
  );
  const prodConfigured = Boolean(config?.prodConfigured);
  const productionBlocked = form.environment === "PRODUCTION" && !prodConfigured;
  const lastError = config?.lastError || config?.last_error;
  const lastVerified = config?.lastVerifiedAt ?? config?.last_verified_at;

  useEffect(() => {
    if (!config) return;
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
    const displayedRange = displayedIndiaPostRange(config);
    const savedRange = displayedRange?.serviceCode ?? ANY_SERVICE;

    setForm((current) => ({
      ...current,
      environment: config.environment ?? DEFAULT_PROVIDER_ENVIRONMENT,
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
      rangeServiceCode:
        savedRange === ANY_SERVICE || knownService.has(savedRange) ? savedRange : ANY_SERVICE,
      prefix: String(displayedRange?.prefix ?? ""),
      suffix: String(displayedRange?.suffix ?? "IN"),
      startNumber:
        displayedRange?.startNumber != null
          ? formatStoredSerial(Number(displayedRange.startNumber))
          : "",
      endNumber:
        displayedRange?.endNumber != null
          ? formatStoredSerial(Number(displayedRange.endNumber))
          : "",
    }));
  }, [config]);

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
  const displayedSavedRange = displayedIndiaPostRange(config);
  const savedRangeService = displayedSavedRange?.serviceCode ?? ANY_SERVICE;
  const savedPrefix = String(displayedSavedRange?.prefix ?? "");
  const savedSuffix = String(displayedSavedRange?.suffix ?? "IN");
  const savedStart =
    displayedSavedRange?.startNumber != null
      ? formatStoredSerial(Number(displayedSavedRange.startNumber))
      : "";
  const savedEnd =
    displayedSavedRange?.endNumber != null
      ? formatStoredSerial(Number(displayedSavedRange.endNumber))
      : "";
  const hasSavedRange = Boolean(savedPrefix || savedStart || savedEnd);

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
    if (
      form.rangeServiceCode !== savedRangeService &&
      !(savedRangeService === ANY_SERVICE && form.rangeServiceCode === ANY_SERVICE)
    ) {
      return true;
    }
    if (form.prefix !== savedPrefix) return true;
    if (form.suffix !== savedSuffix) return true;
    if (form.startNumber !== savedStart) return true;
    if (form.endNumber !== savedEnd) return true;
    if (form.defaultServiceCode !== savedDefault) return true;
    return INDIA_POST_SERVICES.some((service) => {
      const current = form.contracts.find((item) => item.serviceCode === service.code)?.contractId ?? "";
      const saved = config.contracts?.find((item) => item.serviceCode === service.code)?.contractId ?? "";
      return current !== saved;
    });
  }, [config, form, replaceSecrets, savedOfficeId, savedOfficeName, savedOfficePincode, savedPickupOfficeId, savedPickupOfficeName, savedPickupOfficePincode, savedPickupOfficeTypeCode, savedPickupOfficeCity, savedPickupOfficeState, savedRangeService, savedPrefix, savedSuffix, savedStart, savedEnd]);

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
      if (snapshot.environment === "PRODUCTION" && !prodConfigured) {
        throw new Error("Live booking is not ready yet. Keep Sandbox / UAT selected.");
      }
      return api<{ saved: boolean; status: string }>("/api/v1/integrations/india-post", {
        method: "POST",
        body: JSON.stringify({
          connect: false,
          environment: snapshot.environment,
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
          barcodeRange: barcodeRangeWritePayload(snapshot),
          barcodePrefix: snapshot.prefix.trim() || undefined,
          rangeServiceCode:
            snapshot.rangeServiceCode === ANY_SERVICE ? null : snapshot.rangeServiceCode,
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
      if (snapshot.environment === "PRODUCTION" && !prodConfigured) {
        throw new Error("Live booking is not ready yet. Keep Sandbox / UAT selected.");
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
          environment: snapshot.environment,
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

  const test = useMutation({
    mutationFn: () => api("/api/v1/integrations/india-post/test", { method: "POST" }),
    onSuccess: () => toast.success("India Post confirmed the connection."),
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

  function applyAllotmentField(field: "startNumber" | "endNumber", value: string) {
    setForm((current) => ({ ...current, [field]: sanitizeBarcodeAllotmentField(value) }));
  }

  const saveRange = useMutation({
    mutationFn: ({
      barcodeRange,
      serviceCode,
      prefix,
    }: {
      barcodeRange: ReturnType<typeof barcodeRangeWritePayload>;
      serviceCode: string | null;
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
      const next =
        primaryActiveBarcodeRange(
          [
            ...(data.barcodeRange ? [data.barcodeRange] : []),
            ...(data.barcodeRanges ?? []),
          ].filter(Boolean)
        ) ?? (variables.barcodeRange ? data.barcodeRange ?? null : null);
      setForm((current) => ({
        ...current,
        rangeServiceCode: next?.serviceCode ?? ANY_SERVICE,
        prefix: String(next?.prefix ?? ""),
        suffix: String(next?.suffix ?? "IN"),
        startNumber:
          next?.startNumber != null ? formatStoredSerial(Number(next.startNumber)) : "",
        endNumber: next?.endNumber != null ? formatStoredSerial(Number(next.endNumber)) : "",
      }));
      queryClient.setQueryData<IndiaPostConfig>(INDIA_POST_QUERY_KEY, (current) =>
        current
          ? {
              ...current,
              barcodeRange: next,
              barcodeRanges: data.barcodeRanges ?? [],
            }
          : current
      );
      queryClient.invalidateQueries({ queryKey: INDIA_POST_QUERY_KEY });
      toast.success(variables.barcodeRange ? "Barcode range saved." : "Barcode range cleared.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rangeSaveFlight = useRef<string | null>(null);

  function persistBarcodeRange(
    snapshot: FormState,
    options?: { force?: boolean; clearPrefix?: string }
  ) {
    const payload = barcodeRangeWritePayload(snapshot);
    if (payload === undefined) return;
    if (payload === null && !options?.force) return;
    const sameAsSaved =
      !payload && !hasSavedRange
        ? true
        : Boolean(payload) &&
          snapshot.prefix === savedPrefix &&
          snapshot.suffix === savedSuffix &&
          snapshot.startNumber === savedStart &&
          snapshot.endNumber === savedEnd &&
          (snapshot.rangeServiceCode === savedRangeService ||
            (savedRangeService === ANY_SERVICE && snapshot.rangeServiceCode === ANY_SERVICE));
    if (!options?.force && sameAsSaved) return;
    const flight = payload
      ? `${payload.prefix}:${payload.suffix}:${payload.startNumber}:${payload.endNumber}:${payload.serviceCode ?? ""}`
      : `clear:${options?.clearPrefix ?? snapshot.prefix}`;
    if (!options?.force && rangeSaveFlight.current === flight) return;
    rangeSaveFlight.current = flight;
    saveRange.mutate(
      {
        barcodeRange: payload,
        serviceCode: snapshot.rangeServiceCode === ANY_SERVICE ? null : snapshot.rangeServiceCode,
        prefix: payload ? undefined : options?.clearPrefix || snapshot.prefix.trim() || savedPrefix,
      },
      {
        onSettled: () => {
          if (rangeSaveFlight.current === flight) rangeSaveFlight.current = null;
        },
      }
    );
  }

  function clearBarcodeRange() {
    const prefix = form.prefix.trim() || savedPrefix;
    const cleared: FormState = {
      ...form,
      rangeServiceCode: ANY_SERVICE,
      prefix: "",
      suffix: "IN",
      startNumber: "",
      endNumber: "",
    };
    setForm(cleared);
    persistBarcodeRange(cleared, { force: true, clearPrefix: prefix });
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

  const bookingWebhook = config?.bookingWebhookUrl ?? config?.booking_webhook_url ?? "";
  const eventsWebhook = config?.eventsWebhookUrl ?? config?.events_webhook_url ?? "";

  return (
    <div className="space-y-5">
      <PageHeader
        title={<IndiaPostLogo className="h-12 max-w-[12rem]" />}
        description="Sign in with your India Post customer ID and password, then add your post office and barcode series."
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge value={config?.status ?? "NOT_CONNECTED"} />
            <Button
              type="button"
              variant={dirty ? "primary" : "secondary"}
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate(form)}
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      />

      <IndiaPostWatchTutorialLink />

      <IndiaPostGuideBanner selectedService={form.defaultServiceCode} />

      <Card>
        <CardHeader className="pb-4">
          <CardTitle>Connection</CardTitle>
          <CardDescription>
            Use the customer ID and password from your India Post booking account. Your password is saved securely.
            {lastVerified ? ` Last checked ${formatDate(lastVerified, true)}.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-2">
            <Label>India Post Environment</Label>
            <Select
              value={form.environment}
              onValueChange={(value) => {
                if (value === "PRODUCTION" && form.environment !== "PRODUCTION") {
                  const ok = window.confirm(
                    "Switch to India Post Production? Bookings will be sent to live CEPT (app.indiapost.gov.in), not Sandbox/UAT."
                  );
                  if (!ok) return;
                }
                set("environment", value);
              }}
            >
              <SelectTrigger
                className={
                  form.environment === "PRODUCTION"
                    ? "border-error/40 bg-error/5 font-medium text-error"
                    : "border-amber-500/40 bg-amber-50 font-medium text-amber-950"
                }
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_ENVIRONMENTS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item === "UAT" ? "Sandbox / UAT" : "Production"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
          {form.environment === "UAT" ? (
            <p className="rounded-xl border border-amber-500/30 bg-amber-50 px-3 py-2 text-sm text-amber-950 sm:col-span-2 xl:col-span-3">
              Sandbox / UAT is selected. Authentication and bookings use <strong>test.cept.gov.in</strong> only.
            </p>
          ) : (
            <p className="rounded-xl border border-error/30 bg-error/5 px-3 py-2 text-sm text-error sm:col-span-2 xl:col-span-3">
              Production is selected. Bookings go to live India Post. Use Sandbox / UAT for the test organization.
            </p>
          )}
          {productionBlocked ? (
            <p className="text-sm text-muted sm:col-span-2 xl:col-span-3">
              Live booking is not ready yet. Keep <strong>Sandbox / UAT</strong> selected.
            </p>
          ) : null}
          {lastError ? (
            <p className="rounded-xl border border-error/20 bg-error/5 px-3 py-2 text-sm text-error sm:col-span-2 xl:col-span-3">
              {lastError}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => login.mutate(form)}
            disabled={
              login.isPending ||
              productionBlocked ||
              !form.customerId.trim() ||
              !(hasSecrets || form.password.trim())
            }
          >
            {login.isPending ? "Logging in…" : "Login"}
          </Button>
          {form.environment === "UAT" ? (
            <Button type="button" variant="secondary" onClick={() => test.mutate()} disabled={test.isPending}>
              {test.isPending ? "Checking…" : "Test connection"}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
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

      <Card>
        <CardHeader className="pb-4">
          <CardTitle>Pickup Location</CardTitle>
          <CardDescription className="mt-1">
            The India Post office used when a booking is pickup. Search the 6-digit office pincode and select the office
            so pickup bookings use that pin as the origin.
            {savedPickupOfficeId && !savedPickupOfficePincode
              ? " This pickup office is missing its pincode — search and select it again."
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Office ID"
            value={form.pickupOfficeId}
            placeholder="21360043"
            hint={
              form.pickupOfficeName
                ? [
                    form.pickupOfficeName,
                    [form.pickupOfficePincode, form.pickupOfficeCity, form.pickupOfficeState]
                      .filter(Boolean)
                      .join(" · "),
                  ]
                    .filter(Boolean)
                    .join(" — ")
                : undefined
            }
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
          <IndiaPostOfficeFinder
            key={pickupFinderEpoch}
            idPrefix="pickup-office"
            label="Pickup pincode"
            officeId={form.pickupOfficeId}
            onSelect={applyPickupOffice}
            canSearch={Boolean(form.customerId && (hasSecrets || form.password))}
          />
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button
            type="button"
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

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle>Drop-off office</CardTitle>
            <CardDescription className="mt-1">
              The post office where you hand over parcels. Search the 6-digit office pincode and select the office so
              every merchant booking uses that pin as the India Post origin.
              {savedOfficeId && !savedOfficePincode
                ? " This office is missing its pincode — search and select it again."
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Office ID"
              value={form.pickupDropoffOfficeId}
              placeholder="22660454"
              hint={form.pickupDropoffOfficeName || undefined}
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
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button
              type="button"
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

        <Card>
          <CardHeader className="pb-4">
            <CardTitle>Barcode range</CardTitle>
            <CardDescription className="mt-1">
              The article number series from your India Post allotment. These fields show the same start and end serials saved in the database. You can paste the 8-digit serial or the 9-digit number with check digit. CX books India Post Parcel Contractual (Business Parcel) only.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Series applies to</Label>
              <Select
                value={form.rangeServiceCode}
                onValueChange={(value) => {
                  const next = { ...form, rangeServiceCode: value };
                  setForm(next);
                  if (barcodeRangeWritePayload(next)) persistBarcodeRange(next);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_SERVICE}>Any service</SelectItem>
                  {INDIA_POST_SERVICES.map((service) => (
                    <SelectItem key={service.code} value={service.code}>
                      {service.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Field
              label="Prefix"
              value={form.prefix}
              placeholder="CL"
              maxLength={2}
              onChange={(value) => {
                const prefix = value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
                setForm((current) => ({
                  ...current,
                  prefix,
                  ...(prefix === "CX" ? { rangeServiceCode: "BUSINESS_PARCEL" } : {}),
                }));
              }}
              onBlur={(value) => {
                const prefix = value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
                persistBarcodeRange({
                  ...form,
                  prefix,
                  ...(prefix === "CX" ? { rangeServiceCode: "BUSINESS_PARCEL" } : {}),
                });
              }}
            />
            <Field
              label="Suffix"
              value={form.suffix}
              onChange={(value) => set("suffix", value)}
              onBlur={(value) => persistBarcodeRange({ ...form, suffix: value })}
            />
            <Field
              label="Start number"
              value={form.startNumber}
              placeholder="7536320"
              maxLength={BARCODE_ALLOTMENT_DIGITS}
              inputMode="numeric"
              onChange={(value) => applyAllotmentField("startNumber", value)}
              onBlur={(value) =>
                persistBarcodeRange({ ...form, startNumber: sanitizeBarcodeAllotmentField(value) })
              }
            />
            <Field
              label="End number"
              value={form.endNumber}
              placeholder="7537319"
              maxLength={BARCODE_ALLOTMENT_DIGITS}
              inputMode="numeric"
              onChange={(value) => applyAllotmentField("endNumber", value)}
              onBlur={(value) =>
                persistBarcodeRange({ ...form, endNumber: sanitizeBarcodeAllotmentField(value) })
              }
            />
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => persistBarcodeRange(form, { force: true })}
              disabled={saveRange.isPending || !barcodeRangeWritePayload(form)}
            >
              {saveRange.isPending ? "Saving…" : "Save range"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={clearBarcodeRange}
              disabled={
                saveRange.isPending ||
                (!hasSavedRange && !form.prefix && !form.startNumber && !form.endNumber)
              }
            >
              Clear
            </Button>
          </CardFooter>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle>Service contracts</CardTitle>
          <CardDescription>
            One contract number per service you ship. Leave unused rows blank. New shipments use the default.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border border-t border-border">
            {INDIA_POST_SERVICES.map((service) => {
              const row = form.contracts.find((item) => item.serviceCode === service.code);
              const value = row?.contractId ?? "";
              const isDefault = form.defaultServiceCode === service.code;
              const stock = value.trim()
                ? barcodeStockForService(config?.barcodeRanges ?? [], service.code)
                : null;
              const left = barcodesLeft(stock);
              return (
                <div
                  key={service.code}
                  className="grid gap-3 px-6 py-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto] md:items-center"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{service.label}</p>
                    <p className="truncate text-xs text-muted">{service.description}</p>
                    {left != null && stock ? (
                      <p className="text-xs text-muted">
                        {formatNumber(left)} barcodes left
                        {stock.prefix ? ` · ${stock.prefix} series` : ""}
                      </p>
                    ) : null}
                  </div>
                  <Input
                    value={value}
                    placeholder="Contract ID"
                    inputMode="numeric"
                    onChange={(event) => setContract(service.code, event.target.value.replace(/\D/g, "").slice(0, 20))}
                    onBlur={(event) => persistContract(service.code, event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-11"
                    disabled={!value.trim() || saveContract.isPending}
                    onClick={() => {
                      setContract(service.code, "");
                      persistContract(service.code, "", { force: true });
                    }}
                  >
                    Clear
                  </Button>
                  <button
                    type="button"
                    title={
                      isDefault
                        ? `Default booking service (${service.label})`
                        : `Set ${service.label} as the India Post default`
                    }
                    aria-pressed={isDefault}
                    disabled={!value.trim() || setDefault.isPending}
                    onClick={() => {
                      if (!isDefault) setDefault.mutate(service.code);
                    }}
                    className={cn(
                      "h-7 rounded-md px-2 text-xs font-semibold transition-colors",
                      isDefault ? "bg-brand text-white" : "text-muted hover:text-foreground",
                      (!value.trim() || setDefault.isPending) && "cursor-not-allowed opacity-60"
                    )}
                  >
                    {isDefault ? "Default" : "Set default"}
                  </button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {bookingWebhook || eventsWebhook ? (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle>Tracking updates</CardTitle>
            <CardDescription>
              Paste these links in your India Post portal so booking and tracking updates come back to PostBus.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 lg:grid-cols-2">
            <CopyField id="booking-webhook" label="After booking" value={bookingWebhook} />
            <CopyField id="events-webhook" label="Tracking changes" value={eventsWebhook} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function CopyField({
  id,
  label,
  value,
}: {
  id: string;
  label: string;
  value: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input id={id} readOnly value={value} className="font-mono text-xs" />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-11"
          disabled={!value}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            toast.success(`${label} copied.`);
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
  maxLength,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: (value: string) => void;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
  inputMode?: "numeric" | "text" | "tel";
}) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className={isPassword ? "relative" : undefined}>
        <Input
          type={isPassword && showPassword ? "text" : type}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          maxLength={maxLength}
          inputMode={inputMode}
          className={isPassword ? "pr-11" : undefined}
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
      {hint ? <p className="text-sm font-medium text-foreground">{hint}</p> : null}
    </div>
  );
}
