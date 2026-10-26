import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { manifestCsv, manifestFileBase, manifestXlsx } from "@/modules/manifests/export";
import { renderManifestPdf } from "@/modules/manifests/pdf";
import {
  manifestAddBody,
  manifestExportFormat,
  manifestHandoverBody,
  manifestListQuery,
} from "@/modules/manifests/schema";
import {
  addShipments,
  closeManifest,
  enqueueFulfillmentForManifested,
  getManifest,
  getManifestSender,
  listEligible,
  listManifests,
  manifestProofUrl,
  markHandedOver,
  removeShipment,
  reopenManifest,
  sweepEligible,
} from "@/modules/manifests/service";

async function readHandover(request: NextRequest) {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("multipart/form-data")) {
    return { ...manifestHandoverBody.parse(await request.json().catch(() => ({}))), proof: null };
  }
  const form = await request.formData();
  const body = manifestHandoverBody.parse({
    handedOverTo: form.get("handedOverTo") ?? undefined,
    notes: form.get("notes") ?? undefined,
  });
  const file = form.get("proof");
  if (!file || typeof file === "string" || file.size === 0) return { ...body, proof: null };
  return { ...body, proof: { bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type } };
}

export async function handleManifestRoutes(
  request: NextRequest,
  supabase: SupabaseClient,
  ctx: TenantContext,
  method: string,
  slugs: string[]
) {
  if (slugs[0] !== "manifests") return null;
  const [, id, action, childId] = slugs;
  const org = ctx.organizationId;

  if (!id) {
    if (method === "GET") {
      return listManifests(supabase, org, manifestListQuery.parse(Object.fromEntries(request.nextUrl.searchParams)));
    }
    if (method === "POST") {
      const result = await sweepEligible(supabase, org, { userId: ctx.userId });
      await enqueueFulfillmentForManifested(supabase, org, result.added);
      return { added: result.added.length, manifestIds: result.manifestIds };
    }
    return null;
  }

  if (id === "eligible" && !action && method === "GET") {
    return listEligible(supabase, org);
  }

  if (!action && method === "GET") return getManifest(supabase, org, id);

  if (action === "shipments" && !childId && method === "POST") {
    const body = manifestAddBody.parse(await request.json().catch(() => ({})));
    return addShipments(supabase, org, id, body.shipmentIds, ctx.userId);
  }
  if (action === "shipments" && childId && method === "DELETE") {
    return removeShipment(supabase, org, id, childId, ctx.userId);
  }
  if (action === "close" && method === "POST") return closeManifest(supabase, org, id, ctx.userId);
  if (action === "reopen" && method === "POST") return reopenManifest(supabase, org, id, ctx.userId);
  if (action === "handover" && method === "POST") {
    return markHandedOver(supabase, org, id, await readHandover(request), ctx.userId);
  }

  if (action === "proof" && method === "GET") {
    return NextResponse.redirect(await manifestProofUrl(supabase, org, id));
  }

  if (action === "export" && method === "GET") {
    const parsed = manifestExportFormat.safeParse(request.nextUrl.searchParams.get("format") ?? undefined);
    if (!parsed.success) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Choose xlsx, csv or pdf.");
    const manifest = await getManifest(supabase, org, id);
    const base = manifestFileBase(manifest);
    if (parsed.data === "csv") {
      return new NextResponse(manifestCsv(manifest), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${base}.csv"`,
        },
      });
    }
    if (parsed.data === "pdf") {
      const bytes = await renderManifestPdf(manifest, await getManifestSender(supabase, org));
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${base}.pdf"`,
        },
      });
    }
    return new NextResponse(new Uint8Array(await manifestXlsx(manifest)), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${base}.xlsx"`,
      },
    });
  }

  return null;
}
