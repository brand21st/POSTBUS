import { ImageResponse } from "next/og";

export const alt = "Shopify India Post Shipping Automation | PostBus";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#09090B",
          padding: "64px",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "#E11D48",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: 28,
              fontWeight: 700,
            }}
          >
            P
          </div>
          <div style={{ color: "white", fontSize: 32, fontWeight: 700, letterSpacing: -1 }}>
            POSTBUS
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              color: "white",
              fontSize: 64,
              fontWeight: 650,
              letterSpacing: -2.5,
              lineHeight: 1.05,
              maxWidth: 900,
            }}
          >
            Shopify India Post shipping automation
          </div>
          <div style={{ color: "#A1A1AA", fontSize: 28, maxWidth: 780 }}>
            Sync orders, book shipments, generate labels, track deliveries and send WhatsApp updates.
          </div>
        </div>
        <div style={{ color: "#E11D48", fontSize: 22, fontWeight: 600 }}>postbus.in</div>
      </div>
    ),
    { ...size }
  );
}
