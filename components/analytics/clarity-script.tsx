"use client";

import { useSyncExternalStore } from "react";
import Script from "next/script";

const CLARITY_PROJECT_ID = "ymlhqkp345";

function isConstrainedConnection() {
  if (typeof navigator === "undefined") return true;
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (connection?.saveData) return true;
  return connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g";
}

function subscribeNever() {
  return () => {};
}

function clarityEnabledClient() {
  return process.env.NODE_ENV === "production" && !isConstrainedConnection();
}

export function ClarityScript() {
  const enabled = useSyncExternalStore(subscribeNever, clarityEnabledClient, () => false);

  if (!enabled) return null;

  return (
    <Script id="microsoft-clarity" strategy="lazyOnload">
      {`(function(c,l,a,r,i,t,y){
c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window, document, "clarity", "script", "${CLARITY_PROJECT_ID}");`}
    </Script>
  );
}
