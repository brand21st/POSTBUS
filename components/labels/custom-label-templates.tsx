"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/hooks/use-api";
import {
  indiaPostLabelTemplate,
  listedNamedTemplates,
  withDefaultNamedTemplate,
  withDuplicatedNamedTemplate,
  type LabelTemplate,
  type NamedLabelTemplate,
} from "@/modules/labels/template-schema";

type TemplateResponse = { template: LabelTemplate };

function listedTemplates(template: LabelTemplate): NamedLabelTemplate[] {
  return listedNamedTemplates(template);
}

function pageLabel(page: LabelTemplate["page"]) {
  const width = Math.round(page.widthMm ?? (page.widthPt * 25.4) / 72);
  const height = Math.round(page.heightMm ?? (page.heightPt * 25.4) / 72);
  return `${width}×${height} mm`;
}

export function CustomLabelTemplates() {
  const queryClient = useQueryClient();
  const templates = useQuery({
    queryKey: ["label-template"],
    queryFn: () => api<TemplateResponse>("/api/v1/label-template"),
  });

  const save = useMutation({
    mutationFn: (template: LabelTemplate) =>
      api<TemplateResponse>("/api/v1/label-template", {
        method: "PUT",
        body: JSON.stringify({ template }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["label-template"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const template = templates.data?.template;

  const createIndiaPost = () => {
    if (!template) return;
    const preset = indiaPostLabelTemplate();
    const library = template.library?.length
      ? template.library
      : [
          {
            id: "active",
            name: "Current template",
            isDefault: true,
            page: template.page,
            elements: template.elements,
          },
        ];
    const count = library.filter((item) => item.name.startsWith("India Post")).length;
    const entry: NamedLabelTemplate = {
      id: crypto.randomUUID(),
      name: count ? `India Post (${count + 1})` : "India Post",
      isDefault: false,
      page: preset.page,
      elements: preset.elements,
    };
    save.mutate(
      { ...template, templateVersion: Math.max(template.templateVersion, 5), library: [...library, entry] },
      { onSuccess: () => toast.success("India Post template created.") }
    );
  };

  const setDefault = (id: string) => {
    if (!template?.library?.length) return;
    save.mutate(withDefaultNamedTemplate(template, id), { onSuccess: () => toast.success("Default template updated.") });
  };

  const duplicate = (id: string) => {
    if (!template) return;
    save.mutate(withDuplicatedNamedTemplate(template, id, crypto.randomUUID()), {
      onSuccess: () => toast.success("Template duplicated."),
    });
  };

  const remove = (id: string) => {
    if (!template?.library?.length) return;
    const library = template.library.filter((item) => item.id !== id);
    if (!library.length) {
      save.mutate(
        { ...template, library: undefined, templateVersion: 4 },
        { onSuccess: () => toast.success("Template deleted.") }
      );
      return;
    }
    if (!library.some((item) => item.isDefault)) library[0] = { ...library[0], isDefault: true };
    const active = library.find((item) => item.isDefault) ?? library[0];
    save.mutate(
      { ...template, library, page: active.page, elements: active.elements },
      { onSuccess: () => toast.success("Template deleted.") }
    );
  };

  const cards = template ? listedTemplates(template) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shipping label templates"
        description="Create named labels, then place the India Post barcode as its own block."
        actions={
          <Button type="button" onClick={createIndiaPost} disabled={!template || save.isPending}>
            <Plus className="size-4" />
            New India Post template
          </Button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((item) => (
          <article key={item.id} className="rounded-2xl border border-border bg-card p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="truncate font-semibold text-ink">{item.name}</h2>
                  {item.isDefault ? (
                    <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                      Active
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-sm text-muted">{pageLabel(item.page)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <Link href={`/dashboard/labels/templates/${item.id}`}>
                  <Button type="button" variant="secondary" size="xs">
                    <Pencil className="size-3.5" />
                    Edit
                  </Button>
                </Link>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={!template || save.isPending}
                  onClick={() => duplicate(item.id)}
                  aria-label="Duplicate"
                  title="Duplicate"
                >
                  <Copy className="size-3.5" />
                </Button>
                {template?.library?.length && !item.isDefault ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={save.isPending}
                    onClick={() => setDefault(item.id)}
                    aria-label="Set as default"
                    title="Set as default"
                  >
                    <Star className="size-3.5" />
                  </Button>
                ) : null}
                {template?.library?.length ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={save.isPending}
                    onClick={() => remove(item.id)}
                    aria-label="Delete"
                    title="Delete"
                    className="text-muted hover:text-error"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
