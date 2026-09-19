"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Globe, Trash2 } from "lucide-react";
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
import { hasPermission } from "@/lib/permissions/rbac";
import { trackingHostSuffix } from "@/modules/tracking-pages/host";
import { updateTrackingPageSchema } from "@/modules/tracking-pages/schema";
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
  const role = (me.data?.role ?? "VIEWER") as MemberRole;
  const canManage = hasPermission(role, "tracking.pages");
  const pageQuery = useQuery({
    queryKey: ["tracking-page"],
    queryFn: () => api<TrackingPageRecord | null>("/api/v1/tracking-pages"),
  });

  if (pageQuery.isLoading) {
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
  const previewPage = useMemo(
    () => ({
      ...page,
      ...values,
      storeName: values.storeName || page.storeName,
      primaryColor: values.primaryColor || page.primaryColor,
      backgroundColor: values.backgroundColor || page.backgroundColor,
      social: {
        instagram: values.social?.instagram || page.social.instagram,
        facebook: values.social?.facebook || page.social.facebook,
        website: values.social?.website || page.social.website,
      },
    }),
    [page, values]
  );

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

  async function copyUrl() {
    await navigator.clipboard.writeText(page.publicUrl);
    toast.success("Tracking URL copied.");
  }

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
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Customer URL</CardTitle>
              <CardDescription>{page.publicUrl}</CardDescription>
            </div>
            <StatusBadge value={page.status} />
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
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
            {canManage && page.status === "PUBLISHED" ? (
              <Button type="button" variant="secondary" onClick={() => unpublish.mutate()} disabled={unpublish.isPending}>
                Unpublish
              </Button>
            ) : null}
            {canManage && page.status !== "PUBLISHED" ? (
              <Button type="button" onClick={() => publish.mutate()} disabled={publish.isPending}>
                Publish
              </Button>
            ) : null}
          </CardContent>
        </Card>

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
              <Field label="Accent color">
                <div className="flex items-center gap-2">
                  <Input type="color" disabled={!canManage} className="h-11 w-16 p-1" {...form.register("primaryColor")} />
                  <Input disabled={!canManage} {...form.register("primaryColor")} />
                </div>
              </Field>
              <Field label="Background">
                <div className="flex items-center gap-2">
                  <Input type="color" disabled={!canManage} className="h-11 w-16 p-1" {...form.register("backgroundColor")} />
                  <Input disabled={!canManage} {...form.register("backgroundColor")} />
                </div>
              </Field>
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
