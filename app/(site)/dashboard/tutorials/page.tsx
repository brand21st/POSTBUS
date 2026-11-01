"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Clapperboard, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { TutorialPlayerDialog } from "@/components/tutorials/player-dialog";
import { TutorialThumbnail } from "@/components/tutorials/thumbnail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, toSearchParams } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";
import type { Paginated, TutorialCategoryPublic, TutorialPublic } from "@/types/api";

const PAGE_SIZE = 12;

export default function TutorialsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const category = searchParams.get("category") ?? "all";
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [debounced, setDebounced] = useState(() => searchParams.get("q") ?? "");
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<TutorialPublic | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = search.trim();
      setDebounced(next);
      setPage(1);
      const params = toSearchParams({
        q: next || undefined,
        category: category !== "all" ? category : undefined,
      });
      router.replace(params ? `/dashboard/tutorials?${params}` : "/dashboard/tutorials");
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, category, router]);

  const categoriesQuery = useQuery({
    queryKey: ["tutorials", "categories"],
    queryFn: () => api<{ categories: TutorialCategoryPublic[] }>("/api/v1/tutorials/categories"),
  });

  const tutorialsQuery = useQuery({
    queryKey: ["tutorials", { q: debounced, category, page }],
    queryFn: () =>
      api<Paginated<TutorialPublic>>(
        `/api/v1/tutorials?${toSearchParams({
          q: debounced || undefined,
          category: category !== "all" ? category : undefined,
          page,
          pageSize: PAGE_SIZE,
        })}`
      ),
  });

  useEffect(() => {
    if (tutorialsQuery.error instanceof Error) {
      toast.error(tutorialsQuery.error.message);
    }
  }, [tutorialsQuery.error]);

  const categories = categoriesQuery.data?.categories ?? [];
  const items = tutorialsQuery.data?.items ?? [];
  const total = tutorialsQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function selectCategory(slug: string) {
    setPage(1);
    const params = toSearchParams({
      q: debounced || undefined,
      category: slug !== "all" ? slug : undefined,
    });
    router.replace(params ? `/dashboard/tutorials?${params}` : "/dashboard/tutorials");
  }

  const emptyTitle = debounced
    ? "No tutorials found."
    : category !== "all"
      ? "No tutorials available in this category yet."
      : "No tutorials available yet.";
  const emptyDescription = debounced
    ? "Try a different search term."
    : "Check back soon for step-by-step video guides.";

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Clapperboard className="size-7 text-brand" />
            Tutorials
          </span>
        }
        description="Learn how to use PostBus with simple step-by-step video tutorials."
      />

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search tutorials"
          className="pl-9"
          aria-label="Search tutorials"
        />
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <CategoryChip
          label="All"
          active={category === "all"}
          onClick={() => selectCategory("all")}
        />
        {categoriesQuery.isLoading
          ? Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-24 shrink-0 rounded-full" />
            ))
          : categories.map((item) => (
              <CategoryChip
                key={item.id}
                label={item.name}
                active={category === item.slug}
                onClick={() => selectCategory(item.slug)}
              />
            ))}
      </div>

      {tutorialsQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-72 rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Clapperboard} title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {items.map((tutorial) => (
              <article
                key={tutorial.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card"
              >
                <button
                  type="button"
                  className="block aspect-video w-full text-left"
                  onClick={() => setActive(tutorial)}
                  aria-label={`Watch ${tutorial.title}`}
                >
                  <TutorialThumbnail
                    src={tutorial.thumbnailUrl}
                    alt={tutorial.title}
                    className="h-full w-full"
                  />
                </button>
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <h2 className="font-semibold leading-snug text-ink">{tutorial.title}</h2>
                  {tutorial.category ? (
                    <Badge variant="brand" className="w-fit">
                      {tutorial.category.name}
                    </Badge>
                  ) : null}
                  {tutorial.description ? (
                    <p className="line-clamp-2 text-sm text-muted">{tutorial.description}</p>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    className="mt-auto w-fit"
                    onClick={() => setActive(tutorial)}
                  >
                    Watch Tutorial
                  </Button>
                </div>
              </article>
            ))}
          </div>
          {total > PAGE_SIZE ? (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
              <p className="text-sm text-muted">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  <ChevronLeft className="size-4" />
                  Previous
                </Button>
                <span className="text-sm text-muted">
                  {page} / {pageCount}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={page >= pageCount}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      <TutorialPlayerDialog tutorial={active} onOpenChange={(open) => !open && setActive(null)} />
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-brand bg-rose-100 text-brand-dark"
          : "border-border bg-card text-muted hover:bg-surface-soft hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}
