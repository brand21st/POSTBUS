import { merchantOpenApiDocument } from "@/modules/merchant-api/openapi-document";

export function GET() {
  return Response.json(merchantOpenApiDocument(), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
