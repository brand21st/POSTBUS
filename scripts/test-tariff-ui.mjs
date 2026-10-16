// Isolated browser tests: bundles the real card, stubs every API, and never loads .env files.
// Supply POSTBUS_PLAYWRIGHT_MODULE when Playwright is installed outside this repository.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const { chromium } = await import(process.env.POSTBUS_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.POSTBUS_PLAYWRIGHT_MODULE).href : "playwright");
const bundle = await build({
  stdin: { contents: `
    import {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
    import {TariffEstimateCard} from './components/orders/tariff-estimate-card';
    const client = new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    function App(){
      const [weight,setWeight] = useState(550);
      const [service,setService] = useState("BUSINESS_PARCEL");
      const existing = location.pathname === '/existing';
      return <QueryClientProvider client={client}>
        <label>Manual form weight<input aria-label="Manual form weight" value={weight} onChange={e=>setWeight(Number(e.target.value))}/></label>
        <label>Existing service<select aria-label="Existing service" value={service} onChange={e=>setService(e.target.value)}><option value="BUSINESS_PARCEL">Business Parcel</option><option value="SP_INLAND_PARCEL">Speed Post parcel</option></select></label>
        <button onClick={()=>client.invalidateQueries({queryKey:['me']})}>Switch workspace</button>
        <TariffEstimateCard orderId={existing?'00000000-0000-4000-8000-000000000001':undefined} draft={existing?{weightGrams:weight,service}:{service,destinationPincode:'110001',weightGrams:weight,lengthCm:20,widthCm:15,heightCm:10}}/>
      </QueryClientProvider>
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
});
const server = createServer((request, response) => {
  response.setHeader("Content-Type", request.url === "/bundle.js" ? "text/javascript" : "text/html");
  response.end(request.url === "/bundle.js" ? bundle.outputFiles[0].text : '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let enabled = false, organization = "org-one", failure = false, delay = 0;
  const quotes = [];
  const unexpected = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (!request.url().startsWith(base)) { unexpected.push(request.url()); return route.abort(); }
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const send = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ success: status === 200, data, message: status === 200 ? "OK" : "Shipping estimate is temporarily unavailable.", errors: [] }) });
    if (url.pathname.endsWith("/me")) return send({ organization: { id: organization }, user: { id: "user" } });
    if (url.pathname.endsWith("tariff-capabilities")) return send({ enabled, organizationId: organization, senderChoices: [{ id: "pickup", pincode: "400001", label: "Configured pickup office" }], defaults: { service: "BUSINESS_PARCEL", destinationPincode: "110001", weightGrams: 550, lengthCm: 20, widthCm: 15, heightCm: 10 } });
    if (url.pathname.endsWith("tariff-quotes") || url.pathname.endsWith("tariff-quote")) {
      const body = request.postDataJSON(); quotes.push({ path: url.pathname, body });
      const shouldFail = failure;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return send({ provider: "INDIA_POST", service: body.service, physicalWeightGrams: body.weightGrams, chargeableWeightGrams: 600, estimatedTotal: 152, baseTariff: 70, vasCharges: { INSVAL: 58 }, codCharges: 0, cgst: 12, sgst: 12, totalTax: 24, currency: "INR", articleType: "Business Parcel", isEstimate: true }, shouldFail ? 503 : 200);
    }
    unexpected.push(url.pathname); return route.abort();
  });
  const total = () => page.getByLabel("Shipping tariff").getByText("₹152.00", { exact: true });
  await page.goto(base);
  await page.getByRole("button", { name: "Switch workspace" }).waitFor();
  await page.waitForTimeout(1000);
  assert.equal(await page.getByLabel("Shipping tariff").count(), 0);
  assert.equal(quotes.length, 0, "disabled feature makes no lookup");
  enabled = true; await page.reload(); await total().waitFor({ timeout: 15000 });
  assert.equal(quotes.length, 1, "valid existing form automatically estimates");
  assert.equal(await page.getByRole("button", { name: /calculate shipping/i }).count(), 0);
  assert.equal(await page.getByLabel("Estimate Physical weight (g)").count(), 0, "no duplicate parcel inputs");
  assert.equal(quotes[0].body.weightGrams, 550);
  assert.equal(quotes[0].body.organization_id, undefined);
  assert.equal(quotes[0].body.proofOfDelivery, undefined);
  await page.getByLabel("Manual form weight").fill("600");
  await total().waitFor({ state: "hidden" });
  await total().waitFor({ timeout: 15000 });
  assert.equal(quotes.at(-1).body.weightGrams, 600);
  failure = true;
  await page.getByLabel("Manual form weight").fill("650");
  await page.getByRole("alert").waitFor({ timeout: 15000 });
  assert.equal(await page.getByLabel("Manual form weight").inputValue(), "650");
  failure = false; delay = 4000;
  await page.getByLabel("Manual form weight").fill("700");
  await page.getByText("Calculating…", { exact: true }).waitFor({ timeout: 15000 });
  const beforeEdits = quotes.length;
  await page.getByLabel("Manual form weight").fill("710");
  await page.getByLabel("Manual form weight").fill("700");
  await page.waitForTimeout(4500);
  assert.equal(await total().count(), 0, "obsolete response cannot revive a quote after edit/revert");
  assert.equal(quotes.length, beforeEdits, "no overlapping provider requests");
  delay = 0;
  await total().waitFor({ timeout: 15000 });
  organization = "org-two"; await page.getByRole("button", { name: "Switch workspace" }).click();
  await total().waitFor({ state: "hidden" });
  await total().waitFor({ timeout: 15000 });
  await page.goto(`${base}/existing`); await total().waitFor({ timeout: 15000 });
  await page.getByLabel("Manual form weight").fill("750");
  await total().waitFor({ state: "hidden" });
  await total().waitFor({ timeout: 15000 });
  assert.equal(quotes.at(-1).body.weightGrams, 750);
  assert.equal(quotes.at(-1).body.destinationPincode, undefined);
  assert.match(quotes.at(-1).path, /orders\/.*\/tariff-quote$/);
  await page.getByLabel("Existing service").selectOption("SP_INLAND_PARCEL");
  await page.getByLabel("Manual form weight").fill("500");
  await total().waitFor({ state: "hidden" });
  const beforeInvalid = quotes.length;
  await page.waitForTimeout(1000);
  assert.equal(quotes.length, beforeInvalid, "invalid light parcel makes no request");
  assert.deepEqual(unexpected, [], "no provider, booking, save, or unrelated calls");
  assert.deepEqual(errors, []);
  console.log("PASS: automatic inline quotes, existing fields only, disabled flag, both order surfaces, edit debounce, no overlapping requests, stale edit/revert suppression, workspace changes, errors and validation; all APIs mocked.");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
