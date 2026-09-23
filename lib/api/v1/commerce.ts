import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { orIlike } from "@/lib/api/filters";
import { getAnalytics } from "@/modules/dashboard/analytics";
import { getKpis, getPipeline } from "@/modules/dashboard/service";
import { createBackgroundJob } from "@/modules/jobs/service";
import { createOrderSchema, orderListQuery } from "@/modules/orders/schema";
import { createManualOrder, exportOrdersCsv, getOrder, listOrders } from "@/modules/orders/service";
import { labelPdfFileResponse, labelPdfViewerResponse, wantsBrowserPdfPreview } from "@/lib/labels/pdf-response";
import { loadLabelPdfBytes } from "@/modules/labels/load";
import { mapLabelRow } from "@/modules/labels/map";
import { createShipmentsForOrders, getShipment, listShipments, retryShipment } from "@/modules/shipments/service";

function dateRange(request: NextRequest) {
  const from = request.nextUrl.searchParams.get("from") || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const to = request.nextUrl.searchParams.get("to") || new Date().toISOString().slice(0, 10);
  return { from, to };
}

export async function handleCommerceRoutes(
  request: NextRequest,
  supabase: SupabaseClient,
  ctx: TenantContext,
  key: string,
  method: string,
  slugs: string[]
) {
  if (key === "GET dashboard/kpis") {
    const { from, to } = dateRange(request);
    return getKpis(supabase, ctx, from, to);
  }

  if (key === "GET dashboard/pipeline") {
    const { from, to } = dateRange(request);
    return getPipeline(supabase, ctx, from, to);
  }

  if (key === "GET dashboard/analytics") {
    return getAnalytics(supabase, ctx);
  }

  if (key === "GET orders") {
    const parsed = orderListQuery.parse(Object.fromEntries(request.nextUrl.searchParams));
    return listOrders(supabase, ctx, parsed);
  }

  if (key === "GET orders/export") {
    const parsed = orderListQuery.parse(Object.fromEntries(request.nextUrl.searchParams));
    const csv = await exportOrdersCsv(supabase, ctx, parsed);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=orders.csv",
      },
    });
  }

  if (method === "GET" && slugs[0] === "orders" && slugs[1]) {
    return getOrder(supabase, ctx, slugs[1]);
  }

  if (key === "POST orders") {
    const body = createOrderSchema.parse(await request.json());
    const order = await createManualOrder(supabase, ctx, body);
    if (body.createShipment) {
      await createShipmentsForOrders(supabase, ctx, [order.id], body.shipment);
    }
    return order;
  }

  if (key === "GET shipments") {
    return listShipments(supabase, ctx, {
      page: Number(request.nextUrl.searchParams.get("page") || 1),
      pageSize: Number(request.nextUrl.searchParams.get("pageSize") || 20),
      q: request.nextUrl.searchParams.get("q") || undefined,
      status: request.nextUrl.searchParams.get("status") || undefined,
      orderId: request.nextUrl.searchParams.get("orderId") || undefined,
      serviceCode: request.nextUrl.searchParams.get("serviceCode") || undefined,
    });
  }

  if (key === "POST shipments") {
    const body = await request.json();
    const orderIds: string[] = body.orderIds ?? (body.orderId ? [body.orderId] : []);
    return createShipmentsForOrders(supabase, ctx, orderIds, body);
  }

  if (method === "GET" && slugs[0] === "shipments" && slugs[1] && !slugs[2]) {
    return getShipment(supabase, ctx, slugs[1]);
  }

  if (method === "POST" && slugs[0] === "shipments" && slugs[2] === "retry") {
    return retryShipment(supabase, ctx, slugs[1]);
  }

  if (key === "GET labels") {
    const page = Number(request.nextUrl.searchParams.get("page") || 1);
    const pageSize = Number(request.nextUrl.searchParams.get("pageSize") || 20);
    const from = (page - 1) * pageSize;
    const { data, count, error } = await supabase
      .from("labels")
      .select("*, shipments(barcode, tracking_number, orders(order_number)), print_jobs!print_jobs_label_id_fkey(*)", { count: "exact" })
      .eq("organization_id", ctx.organizationId)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    return {
      items: (data ?? []).map((row) => mapLabelRow(row as Record<string, unknown>)),
      page,
      pageSize,
      total: count ?? 0,
    };
  }

  if (method === "GET" && slugs[0] === "labels" && slugs[2] === "download") {
    const { data } = await supabase
      .from("labels")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .eq("id", slugs[1])
      .maybeSingle();
    if (!data?.file_path && !data?.file_url) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Label file not found.");
    }
    const bytes = await loadLabelPdfBytes(supabase, ctx.organizationId, {
      id: String(data.id),
      file_path: data.file_path || "",
      file_url: data.file_url,
      shipment_id: data.shipment_id,
    });
    const filename = `${data.shipment_id || data.id}.pdf`;
    if (wantsBrowserPdfPreview(request)) {
      return labelPdfViewerResponse(filename);
    }
    return labelPdfFileResponse(bytes, filename);
  }

  if (key === "POST labels/bulk-download") {
    const body = await request.json();
    const ids: string[] = body.ids ?? [];
    const { data } = await supabase
      .from("labels")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .in("id", ids);
    const zip = new JSZip();
    for (const label of data ?? []) {
      if (!label.file_path && !label.file_url) continue;
      try {
        const bytes = await loadLabelPdfBytes(supabase, ctx.organizationId, {
          id: String(label.id),
          file_path: label.file_path || "",
          file_url: label.file_url,
          shipment_id: label.shipment_id,
        });
        zip.file(`${label.id}.pdf`, bytes);
      } catch {
        continue;
      }
    }
    const bytes = await zip.generateAsync({ type: "uint8array" });
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=labels.zip",
      },
    });
  }

  if (key === "GET manifests") {
    const page = Number(request.nextUrl.searchParams.get("page") || 1);
    const pageSize = 20;
    const from = (page - 1) * pageSize;
    const { data, count } = await supabase
      .from("manifests")
      .select("*", { count: "exact" })
      .eq("organization_id", ctx.organizationId)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    return { items: data ?? [], page, pageSize, total: count ?? 0 };
  }

  if (key === "POST manifests") {
    const job = await createBackgroundJob(supabase, {
      organizationId: ctx.organizationId,
      jobType: "manifest-generation",
      entityType: "organization",
      entityId: ctx.organizationId,
      userId: ctx.userId,
    });
    return { queued: true, jobId: job.id };
  }

  if (key === "GET tracking") {
    const q = request.nextUrl.searchParams.get("q");
    let builder = supabase
      .from("shipments")
      .select("*, orders(order_number), tracking_events(*)")
      .eq("organization_id", ctx.organizationId)
      .not("barcode", "is", null)
      .order("created_at", { ascending: false })
      .limit(50);
    const filter = q ? orIlike(["barcode", "tracking_number"], q) : null;
    if (filter) builder = builder.or(filter);
    const { data } = await builder;
    return {
      items: (data ?? []).map((row) => ({
        ...row,
        orderNumber: (row.orders as { order_number?: string } | null)?.order_number,
        events: row.tracking_events ?? [],
      })),
    };
  }

  return null;
}
