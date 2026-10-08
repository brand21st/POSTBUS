import "./load-test-env";
import { describe, expect, it } from "vitest";
import { hasAdminClient } from "@/lib/supabase/admin";
import { getPlatformOpenRouterConfig } from "@/modules/openrouter/platform-config";
import { parseWhatsAppOrderPaste } from "@/modules/openrouter/parse-whatsapp";

const CHAT = `Hi bro please dispatch today
Anitha Krishnan
+91 88487 72371
Flat 2, Beach Road
Ernakulam
Kerala 682001
COD ok thanks`;

const LABELED = `Name: Rahul
Phone: 9876543210
Address: 12 ABC House, Main Road
City: Kozhikode
State: Kerala
PIN: 673001`;

describe("live OpenRouter WhatsApp order paste", () => {
  it(
    "extracts customer fields from unstructured WhatsApp chat via the connected API",
    async () => {
      if (!hasAdminClient()) return;
      const config = await getPlatformOpenRouterConfig();
      expect(config.flagEnabled, "Super Admin OpenRouter is not enabled").toBe(true);
      expect(Boolean(config.apiKey), "OpenRouter API key is not saved").toBe(true);
      expect(config.model.startsWith("openai/")).toBe(true);

      const chat = await parseWhatsAppOrderPaste(CHAT);
      expect(chat.source).toBe("ai");
      expect(chat.fields.phone).toBe("8848772371");
      expect(chat.fields.pincode).toBe("682001");
      expect(chat.fields.state).toBe("Kerala");
      expect(String(chat.fields.name ?? "").toLowerCase()).toContain("anitha");
      expect(String(chat.fields.city ?? "").toLowerCase()).toMatch(/ernakulam|kochi/);

      const labeled = await parseWhatsAppOrderPaste(LABELED);
      expect(labeled.fields.phone).toBe("9876543210");
      expect(labeled.fields.pincode).toBe("673001");
      expect(labeled.fields.city).toBe("Kozhikode");
    },
    45_000
  );
});
