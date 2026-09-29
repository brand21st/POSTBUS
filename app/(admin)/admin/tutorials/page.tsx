"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Clapperboard } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type DataTableColumn } from "@/components/dashboard/data-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { TutorialThumbnail } from "@/components/tutorials/thumbnail";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { api, toSearchParams } from "@/lib/hooks/use-api";
import { parseYoutubeUrl, YOUTUBE_URL_ERROR } from "@/modules/tutorials/youtube";
import type { AdminTutorial, AdminTutorialCategory, Paginated } from "@/types/api";

type TutorialRow = AdminTutorial & Record<string, unknown>;

type TutorialForm = {
  title: string;
  youtubeUrl: string;
  categoryId: string;
  description: string;
  status: "draft" | "published";
  sortOrder: string;
};

type CategoryForm = {
  name: string;
  description: string;
  sortOrder: string;
  isActive: boolean;
};

const emptyTutorialForm = (): TutorialForm => ({
  title: "",
  youtubeUrl: "",
  categoryId: "",
  description: "",
  status: "draft",
  sortOrder: "0",
});

const emptyCategoryForm = (): CategoryForm => ({
  name: "",
  description: "",
  sortOrder: "0",
  isActive: true,
});

export default function AdminTutorialsPage() {
  const client = useQueryClient();
  const [tab, setTab] = useState("tutorials");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tutorialDialog, setTutorialDialog] = useState<"create" | "edit" | null>(null);
  const [activeTutorial, setActiveTutorial] = useState<AdminTutorial | null>(null);
  const [tutorialForm, setTutorialForm] = useState<TutorialForm>(emptyTutorialForm());
  const [deleteTutorialId, setDeleteTutorialId] = useState<AdminTutorial | null>(null);
  const [categoryDialog, setCategoryDialog] = useState<"create" | "edit" | null>(null);
  const [activeCategory, setActiveCategory] = useState<AdminTutorialCategory | null>(null);
  const [categoryForm, setCategoryForm] = useState<CategoryForm>(emptyCategoryForm());
  const [deleteCategory, setDeleteCategory] = useState<AdminTutorialCategory | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const categoriesQuery = useQuery({
    queryKey: ["admin", "tutorial-categories"],
    queryFn: () => api<{ categories: AdminTutorialCategory[] }>("/api/admin/tutorial-categories"),
  });

  const tutorialsQuery = useQuery({
    queryKey: ["admin", "tutorials", { q: debounced, categoryFilter, statusFilter, page }],
    queryFn: () =>
      api<Paginated<AdminTutorial>>(
        `/api/admin/tutorials?${toSearchParams({
          q: debounced || undefined,
          categoryId: categoryFilter !== "all" ? categoryFilter : undefined,
          status: statusFilter !== "all" ? statusFilter : undefined,
          page,
          pageSize: 20,
        })}`
      ),
  });

  const categories = categoriesQuery.data?.categories ?? [];
  const items = (tutorialsQuery.data?.items ?? []) as TutorialRow[];
  const youtubePreview = parseYoutubeUrl(tutorialForm.youtubeUrl);
  const youtubeInvalid = tutorialForm.youtubeUrl.trim().length > 0 && !youtubePreview;

  const saveTutorial = useMutation({
    mutationFn: (input: { id?: string; body: Record<string, unknown> }) =>
      input.id
        ? api(`/api/admin/tutorials/${input.id}`, { method: "PATCH", body: JSON.stringify(input.body) })
        : api("/api/admin/tutorials", { method: "POST", body: JSON.stringify(input.body) }),
    onSuccess: (_data, variables) => {
      toast.success(variables.id ? "Tutorial saved." : "Tutorial created.");
      closeTutorialDialog();
      client.invalidateQueries({ queryKey: ["admin", "tutorials"] });
      client.invalidateQueries({ queryKey: ["admin", "tutorial-categories"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleStatus = useMutation({
    mutationFn: (input: { id: string; status: "draft" | "published" }) =>
      api(`/api/admin/tutorials/${input.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: input.status }),
      }),
    onSuccess: (_data, variables) => {
      toast.success(variables.status === "published" ? "Tutorial published." : "Tutorial unpublished.");
      client.invalidateQueries({ queryKey: ["admin", "tutorials"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeTutorial = useMutation({
    mutationFn: (id: string) => api(`/api/admin/tutorials/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Tutorial deleted.");
      setDeleteTutorialId(null);
      client.invalidateQueries({ queryKey: ["admin", "tutorials"] });
      client.invalidateQueries({ queryKey: ["admin", "tutorial-categories"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveCategory = useMutation({
    mutationFn: (input: { id?: string; body: Record<string, unknown> }) =>
      input.id
        ? api(`/api/admin/tutorial-categories/${input.id}`, {
            method: "PATCH",
            body: JSON.stringify(input.body),
          })
        : api("/api/admin/tutorial-categories", { method: "POST", body: JSON.stringify(input.body) }),
    onSuccess: (_data, variables) => {
      toast.success(variables.id ? "Category saved." : "Category created.");
      closeCategoryDialog();
      client.invalidateQueries({ queryKey: ["admin", "tutorial-categories"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleCategory = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      api(`/api/admin/tutorial-categories/${input.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: input.isActive }),
      }),
    onSuccess: () => {
      toast.success("Category updated.");
      client.invalidateQueries({ queryKey: ["admin", "tutorial-categories"] });
      client.invalidateQueries({ queryKey: ["admin", "tutorials"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeCategory = useMutation({
    mutationFn: (id: string) => api(`/api/admin/tutorial-categories/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Category deleted.");
      setDeleteCategory(null);
      client.invalidateQueries({ queryKey: ["admin", "tutorial-categories"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function closeTutorialDialog() {
    setTutorialDialog(null);
    setActiveTutorial(null);
    setTutorialForm(emptyTutorialForm());
  }

  function closeCategoryDialog() {
    setCategoryDialog(null);
    setActiveCategory(null);
    setCategoryForm(emptyCategoryForm());
  }

  function openCreateTutorial() {
    setActiveTutorial(null);
    setTutorialForm(emptyTutorialForm());
    setTutorialDialog("create");
  }

  function openEditTutorial(tutorial: AdminTutorial) {
    setActiveTutorial(tutorial);
    setTutorialForm({
      title: tutorial.title,
      youtubeUrl: tutorial.youtubeUrl,
      categoryId: tutorial.categoryId,
      description: tutorial.description ?? "",
      status: tutorial.status,
      sortOrder: String(tutorial.sortOrder),
    });
    setTutorialDialog("edit");
  }

  function submitTutorial() {
    if (!youtubePreview) {
      toast.error(YOUTUBE_URL_ERROR);
      return;
    }
    saveTutorial.mutate({
      id: tutorialDialog === "edit" ? activeTutorial?.id : undefined,
      body: {
        title: tutorialForm.title.trim(),
        youtubeUrl: tutorialForm.youtubeUrl.trim(),
        categoryId: tutorialForm.categoryId,
        description: tutorialForm.description.trim() || null,
        status: tutorialForm.status,
        sortOrder: Number(tutorialForm.sortOrder) || 0,
      },
    });
  }

  function submitCategory() {
    saveCategory.mutate({
      id: categoryDialog === "edit" ? activeCategory?.id : undefined,
      body: {
        name: categoryForm.name.trim(),
        description: categoryForm.description.trim() || null,
        sortOrder: Number(categoryForm.sortOrder) || 0,
        isActive: categoryForm.isActive,
      },
    });
  }

  const columns = useMemo<DataTableColumn<TutorialRow>[]>(
    () => [
      {
        id: "thumbnail",
        header: "Thumbnail",
        cell: (row) => (
          <TutorialThumbnail
            src={String(row.thumbnailUrl ?? "")}
            alt={String(row.title ?? "")}
            className="h-12 w-20 rounded-lg"
            showPlay={false}
          />
        ),
      },
      {
        id: "title",
        header: "Title",
        cell: (row) => (
          <div>
            <p className="font-medium text-ink">{String(row.title)}</p>
            {row.description ? (
              <p className="max-w-xs truncate text-xs text-muted">{String(row.description)}</p>
            ) : null}
          </div>
        ),
      },
      {
        id: "category",
        header: "Category",
        cell: (row) => row.category && typeof row.category === "object" && "name" in row.category
          ? String((row.category as { name: string }).name)
          : "—",
      },
      {
        id: "status",
        header: "Status",
        cell: (row) => <StatusBadge value={String(row.status).toUpperCase()} />,
      },
      {
        id: "sortOrder",
        header: "Sort Order",
        cell: (row) => String(row.sortOrder ?? 0),
      },
      {
        id: "createdAt",
        header: "Created Date",
        cell: (row) => formatDate(String(row.createdAt)),
      },
      {
        id: "actions",
        header: "Actions",
        cell: (row) => (
          <div className="flex flex-wrap justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
            <Button size="sm" variant="ghost" onClick={() => openEditTutorial(row as AdminTutorial)}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                toggleStatus.mutate({
                  id: row.id,
                  status: row.status === "published" ? "draft" : "published",
                })
              }
              disabled={toggleStatus.isPending}
            >
              {row.status === "published" ? "Unpublish" : "Publish"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDeleteTutorialId(row as AdminTutorial)}>
              Delete
            </Button>
          </div>
        ),
      },
    ],
    [toggleStatus]
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tutorials"
        description="Paste a YouTube link, pick a category, and publish guides for merchants."
        actions={
          tab === "tutorials" ? (
            <Button size="sm" onClick={openCreateTutorial} disabled={categories.length === 0}>
              <Plus />
              New tutorial
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => {
                setCategoryForm(emptyCategoryForm());
                setCategoryDialog("create");
              }}
            >
              <Plus />
              New category
            </Button>
          )
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="tutorials">Tutorials</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>
        <TabsContent value="tutorials" className="space-y-4">
          {categories.length === 0 && !categoriesQuery.isLoading ? (
            <EmptyState
              icon={Clapperboard}
              title="Create a category first"
              description="Tutorials need a category before you can publish them."
              action={
                <Button size="sm" onClick={() => setTab("categories")}>
                  Manage categories
                </Button>
              }
            />
          ) : (
            <>
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search tutorials"
                  className="md:max-w-xs"
                />
                <Select
                  value={categoryFilter}
                  onValueChange={(value) => {
                    setCategoryFilter(value);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="md:w-48">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {categories.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={statusFilter}
                  onValueChange={(value) => {
                    setStatusFilter(value);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="md:w-40">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DataTable
                columns={columns}
                data={items}
                loading={tutorialsQuery.isLoading}
                error={tutorialsQuery.error instanceof Error ? tutorialsQuery.error : null}
                emptyTitle="No tutorials yet"
                emptyDescription="Create a tutorial by pasting a YouTube URL."
                page={page}
                pageSize={20}
                total={tutorialsQuery.data?.total ?? 0}
                onPageChange={setPage}
                getRowId={(row) => row.id}
              />
            </>
          )}
        </TabsContent>
        <TabsContent value="categories" className="space-y-3">
          {categoriesQuery.isLoading ? (
            <EmptyState icon={Clapperboard} title="Loading categories" />
          ) : categories.length === 0 ? (
            <EmptyState
              icon={Clapperboard}
              title="No categories yet"
              description="Create categories such as Shopify, Orders, or Settings."
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    setCategoryForm(emptyCategoryForm());
                    setCategoryDialog("create");
                  }}
                >
                  <Plus />
                  New category
                </Button>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b border-border bg-surface-soft/70 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Sort</th>
                    <th className="px-4 py-3">Tutorials</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((item) => (
                    <tr key={item.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink">{item.name}</p>
                        <p className="text-xs text-muted">{item.slug}</p>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{item.sortOrder}</td>
                      <td className="px-4 py-3 tabular-nums">{item.tutorialCount ?? 0}</td>
                      <td className="px-4 py-3">
                        <StatusBadge value={item.isActive ? "ACTIVE" : "DISABLED"} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setActiveCategory(item);
                              setCategoryForm({
                                name: item.name,
                                description: item.description ?? "",
                                sortOrder: String(item.sortOrder),
                                isActive: item.isActive,
                              });
                              setCategoryDialog("edit");
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => toggleCategory.mutate({ id: item.id, isActive: !item.isActive })}
                            disabled={toggleCategory.isPending}
                          >
                            {item.isActive ? "Deactivate" : "Activate"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDeleteCategory(item)}>
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(tutorialDialog)} onOpenChange={(open) => !open && closeTutorialDialog()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tutorialDialog === "edit" ? "Edit tutorial" : "Create tutorial"}</DialogTitle>
            <DialogDescription>Paste a YouTube link. The thumbnail loads automatically.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Title">
              <Input
                value={tutorialForm.title}
                onChange={(event) => setTutorialForm((form) => ({ ...form, title: event.target.value }))}
              />
            </Field>
            <Field label="YouTube Video Link">
              <Input
                value={tutorialForm.youtubeUrl}
                onChange={(event) => setTutorialForm((form) => ({ ...form, youtubeUrl: event.target.value }))}
                placeholder="https://www.youtube.com/watch?v=XXXXXXXX"
              />
              {youtubeInvalid ? <p className="text-sm text-error">{YOUTUBE_URL_ERROR}</p> : null}
              {youtubePreview ? (
                <TutorialThumbnail
                  src={youtubePreview.thumbnailUrl}
                  alt="YouTube thumbnail preview"
                  className="mt-2 aspect-video w-full rounded-xl"
                />
              ) : null}
            </Field>
            <Field label="Category">
              <Select
                value={tutorialForm.categoryId}
                onValueChange={(value) => setTutorialForm((form) => ({ ...form, categoryId: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Description">
              <Textarea
                value={tutorialForm.description}
                onChange={(event) => setTutorialForm((form) => ({ ...form, description: event.target.value }))}
                rows={3}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status">
                <Select
                  value={tutorialForm.status}
                  onValueChange={(value) =>
                    setTutorialForm((form) => ({ ...form, status: value as "draft" | "published" }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Sort Order">
                <Input
                  type="number"
                  value={tutorialForm.sortOrder}
                  onChange={(event) => setTutorialForm((form) => ({ ...form, sortOrder: event.target.value }))}
                />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={closeTutorialDialog}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={submitTutorial}
              disabled={
                saveTutorial.isPending ||
                !tutorialForm.title.trim() ||
                !tutorialForm.categoryId ||
                !youtubePreview
              }
            >
              {saveTutorial.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(categoryDialog)} onOpenChange={(open) => !open && closeCategoryDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{categoryDialog === "edit" ? "Edit category" : "Create category"}</DialogTitle>
            <DialogDescription>Categories appear as filters on the merchant tutorials page.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Name">
              <Input
                value={categoryForm.name}
                onChange={(event) => setCategoryForm((form) => ({ ...form, name: event.target.value }))}
              />
            </Field>
            <Field label="Description">
              <Textarea
                value={categoryForm.description}
                onChange={(event) => setCategoryForm((form) => ({ ...form, description: event.target.value }))}
                rows={2}
              />
            </Field>
            <Field label="Sort Order">
              <Input
                type="number"
                value={categoryForm.sortOrder}
                onChange={(event) => setCategoryForm((form) => ({ ...form, sortOrder: event.target.value }))}
              />
            </Field>
            <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
              <Label htmlFor="category-active">Active</Label>
              <Switch
                id="category-active"
                checked={categoryForm.isActive}
                onCheckedChange={(checked) => setCategoryForm((form) => ({ ...form, isActive: checked }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={closeCategoryDialog}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={submitCategory}
              disabled={saveCategory.isPending || !categoryForm.name.trim()}
            >
              {saveCategory.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTutorialId)} onOpenChange={(open) => !open && setDeleteTutorialId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete tutorial</DialogTitle>
            <DialogDescription>
              {deleteTutorialId ? `Delete “${deleteTutorialId.title}”? This cannot be undone.` : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setDeleteTutorialId(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => deleteTutorialId && removeTutorial.mutate(deleteTutorialId.id)}
              disabled={removeTutorial.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteCategory)} onOpenChange={(open) => !open && setDeleteCategory(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete category</DialogTitle>
            <DialogDescription>
              {deleteCategory
                ? (deleteCategory.tutorialCount ?? 0) > 0
                  ? "Move or delete tutorials in this category first."
                  : `Delete “${deleteCategory.name}”? This cannot be undone.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setDeleteCategory(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => deleteCategory && removeCategory.mutate(deleteCategory.id)}
              disabled={removeCategory.isPending || (deleteCategory?.tutorialCount ?? 0) > 0}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
