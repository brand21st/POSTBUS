import Script from "next/script";

const TAWK_PROPERTY_ID = "6ad4a16139cf4334c7c2518b";
const TAWK_WIDGET_ID = "1k579cq4i";
const TAWK_EMBED_SRC = `https://embed.tawk.to/${TAWK_PROPERTY_ID}/${TAWK_WIDGET_ID}`;

export function TawkChat() {
  return (
    <>
      <Script id="tawk-to-init" strategy="afterInteractive">
        {`window.Tawk_API=window.Tawk_API||{};window.Tawk_LoadStart=new Date();`}
      </Script>
      <Script id="tawk-to-embed" src={TAWK_EMBED_SRC} strategy="afterInteractive" />
    </>
  );
}
