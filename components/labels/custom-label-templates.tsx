"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/hooks/use-api";
import {
  indiaPostLabelTemplate,
  type LabelTemplate,
  type NamedLabelTemplate,
} from "@/modules/labels/template-schema";

type TemplateResponse = { template: LabelTemplate };

function listedTemplates(template: LabelTemplate): NamedLabelTemplate[] {
  if (template.library?.length) return template.library;
  return [
    {
      id: "active",
      name: "Current template",
      isDefault: true,
      page: template.page,
      elements: template.elements,
    },
  ];
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
    const library = template.library.map((item) => ({ ...item, isDefault: item.id === id }));
    const active = library.find((item) => item.isDefault) ?? library[0];
    save.mutate(
      {
        ...template,
        library,
        page: active.page,
        elements: active.elements,
        templateVersion: Math.max(template.templateVersion, 5),
      },
      { onSuccess: () => toast.success("Default template updated.") }
    );
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
          <article key={item.id} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{item.name}</h2>
                <p className="text-sm text-muted">{pageLabel(item.page)}</p>
              </div>
              {item.isDefault ? <span className="text-xs font-medium text-brand">Default</span> : null}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`/dashboard/labels/templates/${item.id}`}>
                <Button type="button" variant="secondary" size="sm">
                  <Pencil className="size-4" />
                  Edit
                </Button>
              </Link>
              {template?.library?.length && !item.isDefault ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => setDefault(item.id)}>
                  <Star className="size-4" />
                  Set as default
                </Button>
              ) : null}
              {template?.library?.length ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => remove(item.id)}>
                  <Trash2 className="size-4" />
                  Delete
                </Button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
