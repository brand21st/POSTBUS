"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Package } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import styles from "./inventory.module.css";
import { useMe } from "@/lib/hooks/use-me";
import { hasPermission } from "@/lib/permissions/rbac";

const TABS = ["overview", "products", "categories", "covers", "storefront"] as const;
type Tab = (typeof TABS)[number];

const loading = () => <div role="status" aria-label="Loading inventory" className="h-64 animate-pulse rounded-lg bg-surface-soft motion-reduce:animate-none" />;
const InventoryOverview = dynamic(() => import("./overview-cards").then((m) => m.InventoryOverview), { loading });
const InventoryProducts = dynamic(() => import("./products-panel").then((m) => m.InventoryProducts), { loading });
const InventoryCategoriesManager = dynamic(() => import("./categories-manager").then((m) => m.InventoryCategoriesManager), { loading });
const InventoryStorefront = dynamic(() => import("./storefront-panel").then((m) => m.InventoryStorefront), { loading });
const InventoryCovers = dynamic(() => import("./covers-panel").then((m) => m.InventoryCovers), { loading });

export default function InventoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const me = useMe();
  const canWrite = hasPermission(me.data?.role ?? "VIEWER", "products.write");
  const tab = (TABS.includes(searchParams.get("tab") as Tab) ? searchParams.get("tab") : "overview") as Tab;
  const range = (["today", "7d", "30d"].includes(searchParams.get("range") ?? "")
    ? searchParams.get("range")
    : "30d") as "today" | "7d" | "30d";
  const params = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams]);

  function setTab(next: string) {
    const copy = new URLSearchParams(searchParams.toString());
    copy.set("tab", next);
    if (next !== "products") {
      copy.delete("page");
      copy.delete("q");
    }
    router.replace(`/dashboard/inventory?${copy.toString()}`, { scroll: false });
  }

  return (
    <div className={`${styles.inventory} w-full min-w-0 space-y-3`}>
      <PageHeader
        title="Inventory"
        icon={<Package className="size-6 text-brand" />}
      />
      <Tabs value={tab} onValueChange={setTab} className="w-full min-w-0">
        <TabsList className="h-9 w-full min-w-0 max-w-full overflow-x-auto rounded-lg sm:w-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="covers">Covers</TabsTrigger>
          <TabsTrigger value="storefront">Storefront</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <InventoryOverview
            range={range}
            onRangeChange={(next) => {
              const copy = new URLSearchParams(searchParams.toString());
              copy.set("tab", "overview");
              copy.set("range", next);
              router.replace(`/dashboard/inventory?${copy.toString()}`);
            }}
          />
        </TabsContent>
        <TabsContent value="products">
          <InventoryProducts canWrite={canWrite} searchParams={params} />
        </TabsContent>
        <TabsContent value="categories">
          <InventoryCategoriesManager canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="covers" className="w-full min-w-0">
          <InventoryCovers canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="storefront" className="w-full min-w-0">
          <InventoryStorefront canWrite={canWrite} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
