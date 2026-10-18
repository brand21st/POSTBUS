import { merchantOpenApiYaml } from "@/modules/merchant-api/openapi-document";

export function GET() {
  return new Response(merchantOpenApiYaml(), {
    headers: {
      "Content-Type": "application/yaml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
