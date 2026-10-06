import { createRequestId } from "@/lib/logger";

export type PlatformSupportMcpContext = {
  mode: "platform_support";
  supportSessionId: string;
  requestId: string;
};

export function platformSupportMcpContext(supportSessionId: string, requestId?: string): PlatformSupportMcpContext {
  return {
    mode: "platform_support",
    supportSessionId: supportSessionId.trim(),
    requestId: requestId ?? createRequestId(),
  };
}

export function resolveTrustedSupportSessionId(trusted?: PlatformSupportMcpContext | null) {
  if (trusted?.mode !== "platform_support") return null;
  const id = trusted.supportSessionId.trim();
  return id || null;
}
