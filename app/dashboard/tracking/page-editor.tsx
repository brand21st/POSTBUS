"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Globe, Pencil, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { PublicTrackingPage } from "@/components/tracking-page/public-tracking-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { api } from "@/lib/hooks/use-api";
import { useMe } from "@/lib/hooks/use-me";
import { usePlanEntitlements } from "@/lib/hooks/use-plan-entitlements";
import { FEATURE } from "@/modules/billing/entitlements";
import { hasPermission } from "@/lib/permissions/rbac";
import { trackingHostSuffix } from "@/modules/tracking-pages/host";
import { subdomainSchema, updateTrackingPageSchema } from "@/modules/tracking-pages/schema";
import type { SubdomainAvailability, TrackingPageRecord } from "@/types/api";
import type { MemberRole } from "@/types/domain";

const createSchema = z.object({
  subdomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$/, "Use lowercase letters, numbers, and hyphens."),
});

type CreateValues = z.infer<typeof createSchema>;
type EditorValues = z.infer<typeof updateTrackingPageSchema>;

function availabilityLabel(reason?: SubdomainAvailability["reason"]) {
  if (reason === "available") return { text: "Available", className: "text-success" };
  if (reason === "taken") return { text: "Taken", className: "text-error" };
  if (reason === "reserved") return { text: "Reserved", className: "text-error" };
  if (reason === "invalid") return { text: "Invalid", className: "text-error" };
  return null;
}

export function TrackingPageEditor() {
  const me = useMe();
  const entitlements = usePlanEntitlements();
  const trackingAllowed = entitlements.allows(FEATURE.trackingPage);
  const role = (me.data?.role ?? "VIEWER") as MemberRole;
  const canManage = hasPermission(role, "tracking.pages");
  const pageQuery = useQuery({
    queryKey: ["tracking-page"],
    enabled: trackingAllowed,
    queryFn: () => api<TrackingPageRecord | null>("/api/v1/tracking-pages"),
  });

  if (entitlements.loading || !trackingAllowed || pageQuery.isLoading) {
    return <p className="text-sm text-muted">Loading tracking page…</p>;
  }

  if (pageQuery.isError) {
    return (
      <EmptyState
        icon={Globe}
        title="Tracking page unavailable"
        description={pageQuery.error instanceof Error ? pageQuery.error.message : "Try again shortly."}
      />
    );
  }

  if (!pageQuery.data) {
    if (!canManage) {
      return (
        <EmptyState
          icon={Globe}
          title="No tracking page yet"
          description="Ask a workspace owner, admin, or manager to create a customer tracking page."
        />
      );
    }
    return <CreateTrackingPageForm organizationName={me.data?.organization?.name} />;
  }

  return <EditTrackingPageForm page={pageQuery.data} canManage={canManage} />;
}

function CreateTrackingPageForm({ organizationName }: { organizationName?: string }) {
  const queryClient = useQueryClient();
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema) as never,
    defaultValues: { subdomain: "" },
  });
  const [debounced, setDebounced] = useState("");
  // eslint-disable-next-line react-hooks/incompatible-library -- form.watch subscription
  const subdomain = form.watch("subdomain");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(subdomain.trim().toLowerCase()), 300);
    return () => window.clearTimeout(timer);
  }, [subdomain]);

  const availability = useQuery({
    queryKey: ["subdomain-availability", debounced],
    enabled: debounced.length > 0,
    queryFn: () =>
      api<SubdomainAvailability>(
        `/api/v1/tracking-pages/subdomain-availability?subdomain=${encodeURIComponent(debounced)}`
      ),
  });

  const create = useMutation({
    mutationFn: (values: CreateValues) =>
      api<TrackingPageRecord>("/api/v1/tracking-pages", {
        method: "POST",
        body: JSON.stringify({
          subdomain: values.subdomain,
          storeName: organizationName,
        }),
      }),
    onSuccess: (page) => {
      queryClient.setQueryData(["tracking-page"], page);
      toast.success("Tracking page created as a draft.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not create the page."),
  });

  const hint = availabilityLabel(availability.data?.reason);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create a tracking page</CardTitle>
        <CardDescription>
          Customers will look up shipments at your PostBus subdomain. Choose a name that matches your store.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="max-w-xl space-y-4" onSubmit={form.handleSubmit((values) => create.mutate(values))}>
          <div className="space-y-2">
            <Label htmlFor="subdomain">Subdomain</Label>
            <div className="flex items-center gap-2">
              <Input id="subdomain" placeholder="priya-stores" {...form.register("subdomain")} />
              <span className="whitespace-nowrap text-sm text-muted">{trackingHostSuffix()}</span>
            </div>
            {hint ? <p className={`text-sm font-medium ${hint.className}`}>{hint.text}</p> : null}
            {form.formState.errors.subdomain ? (
              <p className="text-sm text-error">{form.formState.errors.subdomain.message}</p>
            ) : null}
          </div>
          <Button type="submit" disabled={create.isPending || availability.data?.available === false}>
            {create.isPending ? "Creating…" : "Create tracking page"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;

function parseHex(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return HEX_COLOR.test(trimmed) ? trimmed : null;
}

function toFormValues(page: TrackingPageRecord): EditorValues {
  return {
    storeName: page.storeName,
    tagline: page.tagline ?? "",
    about: page.about ?? "",
    primaryColor: page.primaryColor,
    backgroundColor: page.backgroundColor,
    locationName: page.locationName ?? "",
    line1: page.line1 ?? "",
    line2: page.line2 ?? "",
    city: page.city ?? "",
    state: page.state ?? "",
    pincode: page.pincode ?? "",
    phone: page.phone ?? "",
    email: page.email ?? "",
    whatsapp: page.whatsapp ?? "",
    mapUrl: page.mapUrl ?? "",
    social: {
      instagram: page.social.instagram ?? "",
      facebook: page.social.facebook ?? "",
      website: page.social.website ?? "",
    },
  };
}

function EditTrackingPageForm({ page, canManage }: { page: TrackingPageRecord; canManage: boolean }) {
  const queryClient = useQueryClient();
  const form = useForm<EditorValues>({
    resolver: zodResolver(updateTrackingPageSchema) as never,
    defaultValues: toFormValues(page),
  });
  // eslint-disable-next-line react-hooks/incompatible-library -- form.watch subscription
  const values = form.watch();
  const primaryColor = values.primaryColor ?? "";
  const backgroundColor = values.backgroundColor ?? "";
  const [colorStatus, setColorStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const colorSaveLock = useRef(false);
  const latestColors = useRef({ primary: primaryColor, background: backgroundColor });
  latestColors.current = { primary: primaryColor, background: backgroundColor };
  const livePrimaryRef = useRef(page.primaryColor);
  const liveBackgroundRef = useRef(page.backgroundColor);
  const parsedPrimary = parseHex(primaryColor);
  const parsedBackground = parseHex(backgroundColor);
  if (parsedPrimary) livePrimaryRef.current = parsedPrimary;
  if (parsedBackground) liveBackgroundRef.current = parsedBackground;
  const livePrimary = livePrimaryRef.current;
  const liveBackground = liveBackgroundRef.current;
  const previewPage = useMemo(
    () => ({
      ...page,
      ...values,
      storeName: values.storeName || page.storeName,
      primaryColor: livePrimary,
      backgroundColor: liveBackground,
      social: {
        instagram: values.social?.instagram || page.social.instagram,
        facebook: values.social?.facebook || page.social.facebook,
        website: values.social?.website || page.social.website,
      },
    }),
    [liveBackground, livePrimary, page, values]
  );

  useEffect(() => {
    if (!canManage) return;
    const primary = parseHex(primaryColor);
    const background = parseHex(backgroundColor);
    if (!primary || !background) return;
    if (primary === page.primaryColor && background === page.backgroundColor) return;

    async function persistColors() {
      if (colorSaveLock.current) return;
      const nextPrimary = parseHex(latestColors.current.primary);
      const nextBackground = parseHex(latestColors.current.background);
      const current = queryClient.getQueryData<TrackingPageRecord>(["tracking-page"]);
      if (!nextPrimary || !nextBackground || !current) return;
      if (nextPrimary === current.primaryColor && nextBackground === current.backgroundColor) return;

      colorSaveLock.current = true;
      setColorStatus("saving");
      try {
        const next = await api<TrackingPageRecord>("/api/v1/tracking-pages", {
          method: "PATCH",
          body: JSON.stringify({ primaryColor: nextPrimary, backgroundColor: nextBackground }),
        });
        queryClient.setQueryData(["tracking-page"], next);
        const pendingPrimary = parseHex(latestColors.current.primary);
        const pendingBackground = parseHex(latestColors.current.background);
        const dirty = pendingPrimary !== next.primaryColor || pendingBackground !== next.backgroundColor;
        colorSaveLock.current = false;
        if (dirty && pendingPrimary && pendingBackground) {
          await persistColors();
          return;
        }
        setColorStatus("saved");
      } catch (error) {
        colorSaveLock.current = false;
        setColorStatus("error");
        toast.error(error instanceof Error ? error.message : "Could not save colors.");
      }
    }

    const timer = window.setTimeout(() => {
      void persistColors();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [backgroundColor, canManage, page.backgroundColor, page.primaryColor, primaryColor, queryClient]);

  const save = useMutation({
    mutationFn: (payload: EditorValues) =>
      api<TrackingPageRecord>("/api/v1/tracking-pages", {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(["tracking-page"], next);
      toast.success("Tracking page saved.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save."),
  });

  const publish = useMutation({
    mutationFn: () => api<TrackingPageRecord>("/api/v1/tracking-pages/publish", { method: "POST" }),
    onSuccess: (next) => {
      queryClient.setQueryData(["tracking-page"], next);
      toast.success("Tracking page published.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not publish."),
  });

  const unpublish = useMutation({
    mutationFn: () => api<TrackingPageRecord>("/api/v1/tracking-pages/unpublish", { method: "POST" }),
    onSuccess: (next) => {
      queryClient.setQueryData(["tracking-page"], next);
      toast.success("Tracking page unpublished.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not unpublish."),
  });

  async function onLogoChange(file: File | undefined) {
    if (!file) return;
    const body = new FormData();
    body.append("logo", file);
    try {
      const next = await api<TrackingPageRecord>("/api/v1/tracking-pages", { method: "PATCH", body });
      queryClient.setQueryData(["tracking-page"], next);
      toast.success("Logo uploaded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload the logo.");
    }
  }

  async function onBannerUpload(file: File | undefined) {
    if (!file) return;
    const body = new FormData();
    body.append("image", file);
    try {
      await api("/api/v1/tracking-pages/banners", { method: "POST", body });
      await queryClient.invalidateQueries({ queryKey: ["tracking-page"] });
      toast.success("Banner uploaded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload the banner.");
    }
  }

  async function onDeleteBanner(id: string) {
    try {
      const next = await api<TrackingPageRecord>(`/api/v1/tracking-pages/banners?id=${id}`, {
        method: "DELETE",
      });
      queryClient.setQueryData(["tracking-page"], next);
      toast.success("Banner removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the banner.");
    }
  }

  async function onToggleBanner(id: string, enabled: boolean) {
    const next = await api<TrackingPageRecord>("/api/v1/tracking-pages/banners", {
      method: "POST",
      body: JSON.stringify({ banners: [{ id, enabled }] }),
    });
    queryClient.setQueryData(["tracking-page"], next);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
      <div className="space-y-6">
        <CustomerUrlCard
          page={page}
          canManage={canManage}
          publishing={publish.isPending}
          unpublishing={unpublish.isPending}
          onPublish={() => publish.mutate()}
          onUnpublish={() => unpublish.mutate()}
        />

        <form className="space-y-6" onSubmit={form.handleSubmit((payload) => save.mutate(payload))}>
          <Card>
            <CardHeader>
              <CardTitle>Brand</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Store name" error={form.formState.errors.storeName?.message}>
                <Input disabled={!canManage} {...form.register("storeName")} />
              </Field>
              <Field label="Tagline">
                <Input disabled={!canManage} {...form.register("tagline")} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="About">
                  <Textarea disabled={!canManage} {...form.register("about")} />
                </Field>
              </div>
              <ColorField
                label="Accent color"
                name="primaryColor"
                value={primaryColor}
                fallback={livePrimary}
                disabled={!canManage}
                onChange={(next) => form.setValue("primaryColor", next, { shouldDirty: true, shouldTouch: true })}
              />
              <ColorField
                label="Background"
                name="backgroundColor"
                value={backgroundColor}
                fallback={liveBackground}
                disabled={!canManage}
                onChange={(next) =>
                  form.setValue("backgroundColor", next, { shouldDirty: true, shouldTouch: true })
                }
              />
              {canManage && colorStatus !== "idle" ? (
                <p
                  className={`sm:col-span-2 text-xs ${colorStatus === "error" ? "text-error" : "text-muted"}`}
                  aria-live="polite"
                >
                  {colorStatus === "saving"
                    ? "Saving colors…"
                    : colorStatus === "saved"
                      ? "Colors saved"
                      : "Colors could not be saved"}
                </p>
              ) : null}
              <div className="sm:col-span-2">
                <Label>Logo</Label>
                <Input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  disabled={!canManage}
                  className="mt-2"
                  onChange={(event) => onLogoChange(event.target.files?.[0])}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Store location</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Location name">
                <Input disabled={!canManage} {...form.register("locationName")} />
              </Field>
              <Field label="Phone">
                <Input disabled={!canManage} {...form.register("phone")} />
              </Field>
              <Field label="Address line 1" className="sm:col-span-2">
                <Input disabled={!canManage} {...form.register("line1")} />
              </Field>
              <Field label="Address line 2" className="sm:col-span-2">
                <Input disabled={!canManage} {...form.register("line2")} />
              </Field>
              <Field label="City">
                <Input disabled={!canManage} {...form.register("city")} />
              </Field>
              <Field label="State">
                <Input disabled={!canManage} {...form.register("state")} />
              </Field>
              <Field label="Pincode">
                <Input disabled={!canManage} {...form.register("pincode")} />
              </Field>
              <Field label="Email">
                <Input disabled={!canManage} {...form.register("email")} />
              </Field>
              <Field label="WhatsApp">
                <Input disabled={!canManage} {...form.register("whatsapp")} />
              </Field>
              <Field label="Map URL" className="sm:col-span-2">
                <Input disabled={!canManage} {...form.register("mapUrl")} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Social</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Website">
                <Input disabled={!canManage} {...form.register("social.website")} />
              </Field>
              <Field label="Instagram">
                <Input disabled={!canManage} {...form.register("social.instagram")} />
              </Field>
              <Field label="Facebook">
                <Input disabled={!canManage} {...form.register("social.facebook")} />
              </Field>
            </CardContent>
          </Card>

          {canManage ? (
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          ) : null}
        </form>

        <Card>
          <CardHeader>
            <CardTitle>Ad banners</CardTitle>
            <CardDescription>Up to 3 images. Optional links open in a new tab.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {page.banners.map((banner) => (
              <div key={banner.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                {banner.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={banner.imageUrl} alt={banner.alt || "Banner"} className="h-16 w-24 rounded-lg object-cover" />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{banner.href || "No link"}</p>
                  <p className="text-xs text-muted">{banner.alt || "No alt text"}</p>
                </div>
                {canManage ? (
                  <>
                    <Switch
                      checked={banner.enabled !== false}
                      onCheckedChange={(enabled) => onToggleBanner(banner.id, enabled)}
                    />
                    <Button type="button" variant="ghost" size="icon" onClick={() => onDeleteBanner(banner.id)}>
                      <Trash2 />
                    </Button>
                  </>
                ) : null}
              </div>
            ))}
            {canManage && page.banners.length < 3 ? (
              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(event) => onBannerUpload(event.target.files?.[0])}
              />
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="xl:sticky xl:top-6 xl:self-start">
        <p className="mb-2 text-sm font-medium text-muted">Live preview</p>
        <div className="overflow-hidden rounded-2xl border border-border shadow-sm">
          <PublicTrackingPage
            page={previewPage}
            preview={page.status !== "PUBLISHED"}
            lookupEnabled={page.status === "PUBLISHED"}
            compact
          />
        </div>
      </div>
    </div>
  );
}

function CustomerUrlCard({
  page,
  canManage,
  publishing,
  unpublishing,
  onPublish,
  onUnpublish,
}: {
  page: TrackingPageRecord;
  canManage: boolean;
  publishing: boolean;
  unpublishing: boolean;
  onPublish: () => void;
  onUnpublish: () => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [subdomain, setSubdomain] = useState(page.subdomain);
  const [debounced, setDebounced] = useState(page.subdomain);
  const normalized = subdomain.trim().toLowerCase();
  const changed = normalized !== page.subdomain;
  const parsed = subdomainSchema.safeParse(normalized);

  useEffect(() => {
    if (!editing) {
      setSubdomain(page.subdomain);
      setDebounced(page.subdomain);
    }
  }, [editing, page.subdomain]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(normalized), 300);
    return () => window.clearTimeout(timer);
  }, [normalized]);

  const settled = debounced === normalized;
  const availability = useQuery({
    queryKey: ["subdomain-availability", debounced],
    enabled: editing && changed && settled && parsed.success,
    queryFn: () =>
      api<SubdomainAvailability>(
        `/api/v1/tracking-pages/subdomain-availability?subdomain=${encodeURIComponent(debounced)}`
      ),
  });

  const save = useMutation({
    mutationFn: () =>
      api<TrackingPageRecord>("/api/v1/tracking-pages", {
        method: "PATCH",
        body: JSON.stringify({ subdomain: normalized }),
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(["tracking-page"], next);
      setEditing(false);
      toast.success("Customer URL updated.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update the URL."),
  });

  const hint = changed && settled ? availabilityLabel(availability.data?.reason) : null;
  const canSave =
    changed && settled && parsed.success && availability.data?.available === true && !save.isPending;

  async function copyUrl() {
    await navigator.clipboard.writeText(page.publicUrl);
    toast.success("Tracking URL copied.");
  }

  function cancel() {
    setSubdomain(page.subdomain);
    setDebounced(page.subdomain);
    setEditing(false);
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <CardTitle>Customer URL</CardTitle>
          {editing ? (
            <div className="mt-3 space-y-2">
              <Label htmlFor="customer-subdomain">Subdomain</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="customer-subdomain"
                  value={subdomain}
                  autoFocus
                  onChange={(event) => setSubdomain(event.target.value)}
                />
                <span className="whitespace-nowrap text-sm text-muted">{trackingHostSuffix()}</span>
              </div>
              {changed && !parsed.success ? (
                <p className="text-sm text-error">{parsed.error.issues[0]?.message}</p>
              ) : null}
              {hint ? <p className={`text-sm font-medium ${hint.className}`}>{hint.text}</p> : null}
              <p className="text-sm text-muted">The previous address stops working after you save.</p>
            </div>
          ) : (
            <CardDescription className="break-all">{page.publicUrl}</CardDescription>
          )}
        </div>
        <StatusBadge value={page.status} />
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <Button type="button" onClick={() => save.mutate()} disabled={!canSave}>
              {save.isPending ? "Saving…" : "Save URL"}
            </Button>
            <Button type="button" variant="secondary" onClick={cancel} disabled={save.isPending}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="secondary" onClick={copyUrl}>
              <Copy />
              Copy URL
            </Button>
            <a href={page.publicUrl} target="_blank" rel="noopener noreferrer">
              <Button type="button" variant="secondary">
                <ExternalLink />
                Open
              </Button>
            </a>
            {canManage ? (
              <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
                <Pencil />
                Edit URL
              </Button>
            ) : null}
          </>
        )}
        {canManage && page.status === "PUBLISHED" ? (
          <Button type="button" variant="secondary" onClick={onUnpublish} disabled={unpublishing}>
            Unpublish
          </Button>
        ) : null}
        {canManage && page.status !== "PUBLISHED" ? (
          <Button type="button" onClick={onPublish} disabled={publishing}>
            Publish
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ColorField({
  label,
  name,
  value,
  fallback,
  disabled,
  onChange,
}: {
  label: string;
  name: "primaryColor" | "backgroundColor";
  value: string;
  fallback: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const valid = parseHex(value);
  const pickerValue = valid ?? parseHex(fallback) ?? "#000000";

  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <Input
          type="color"
          name={name}
          aria-label={`${label} picker`}
          disabled={disabled}
          className="h-11 w-16 shrink-0 p-1"
          value={pickerValue}
          onChange={(event) => onChange(event.target.value)}
        />
        <Input
          name={name}
          aria-label={`${label} hex`}
          spellCheck={false}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </Field>
  );
}

function Field({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <Label className="mb-2 block">{label}</Label>
      {children}
      {error ? <p className="mt-1 text-sm text-error">{error}</p> : null}
    </div>
  );
}
