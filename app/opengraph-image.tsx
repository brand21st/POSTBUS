import { ImageResponse } from "next/og";

export const alt = "India Post shipping software for ecommerce | PostBus";
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
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
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
              fontSize: 56,
              fontWeight: 650,
              letterSpacing: -2.5,
              lineHeight: 1.05,
              maxWidth: 980,
            }}
          >
            Already shipping with India Post? Ship smarter with PostBus.
          </div>
          <div style={{ color: "#A1A1AA", fontSize: 26, maxWidth: 820 }}>
            Connect your existing Customer ID. Manage orders, labels, tracking and invoices from one
            dashboard.
          </div>
        </div>
        <div style={{ color: "#E11D48", fontSize: 22, fontWeight: 600 }}>www.postbus.in</div>
      </div>
    ),
    { ...size }
  );
}
