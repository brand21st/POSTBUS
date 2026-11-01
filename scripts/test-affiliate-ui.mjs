// Isolated browser verification: real components, mocked APIs, no .env files or external requests.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
const { chromium } = await import(process.env.POSTBUS_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.POSTBUS_PLAYWRIGHT_MODULE).href : "playwright");
const bundle=await build({stdin:{contents:`
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {PartnerDashboard} from './components/affiliates/partner-dashboard';
import {AffiliateAdminDashboard} from './components/affiliates/admin-dashboard';
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}>{location.pathname==='/admin'?<AffiliateAdminDashboard/>:<PartnerDashboard/>}</QueryClientProvider>);
`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"development"'},plugins:[{name:"next-link-test",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"test"}));b.onLoad({filter:/.*/,namespace:"test"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"js",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader("Content-Type",req.url==="/bundle.js"?"text/javascript":"text/html");res.end(req.url==="/bundle.js"?bundle.outputFiles[0].text:'<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>');});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[],unexpected=[],writes=[];
 let mode="disabled",payoutFail=true,profile={id:"20000000-0000-4000-8000-000000000001",status:"APPROVED",application:{}};
 page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/*",async route=>{const r=route.request();if(!r.url().startsWith(base)){unexpected.push(r.url());return route.abort();}const url=new URL(r.url());if(!url.pathname.startsWith("/api/"))return route.continue();
 const send=(data,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify({success:status===200,data,message:status===200?"OK":mode==="disabled"?"The partner program is currently unavailable.":"Please retry.",errors:[]})});
 if(r.method()!=="GET"){writes.push({path:url.pathname,data:r.postDataJSON()});if(url.pathname.endsWith("/payouts")&&payoutFail)return send(null,503);if(url.pathname.endsWith("/application"))profile={...profile,status:"PENDING"};return send({saved:true});}
 if(url.pathname==="/api/partner/me")return mode==="disabled"?send(null,404):send({profile:mode==="application"?null:profile,payoutsEnabled:true});
 if(url.pathname==="/api/partner/summary")return send({balance:{available:"200000",recoverable:"0",paid:"50000"},clicks:10,visitors:8,signups:2,conversions:1,earned:"250000",pending:"30000",reserved:"0",daily:[]});
 if(url.pathname==="/api/partner/accounts")return send([{id:"70000000-0000-4000-8000-000000000001",masked_details:"UPI •••bank"}]);
 if(url.pathname==="/api/partner/links")return send([{id:"link",code:"abcdefghijklmnopqrstuvwx",campaign:"",enabled:true}]);
 if(url.pathname==="/api/admin/affiliates/overview")return send({partners:1,applications:1,earned:"200000"});
 if(url.pathname.startsWith("/api/partner/")||url.pathname.startsWith("/api/admin/affiliates/"))return send([]);
 unexpected.push(url.pathname);return route.abort();});
 await page.goto(base);await page.getByRole("alert").waitFor();assert.equal(writes.length,0);
 mode="application";await page.reload();await page.getByRole("heading",{name:"Apply to become a partner"}).waitFor();
 for(const [label,value] of [["Full name","Test Partner"],["Mobile number","9876543210"],["Promotional channel","Agency"],["State","Kerala"],["City","Kochi"]])await page.getByLabel(label,{exact:true}).fill(value);
 await page.getByRole("checkbox").check();await page.getByRole("button",{name:"Submit application"}).click();await page.getByText("Saved.",{exact:true}).waitFor();assert.equal(writes.at(-1).data.country,"IN");
 mode="approved";profile.status="APPROVED";await page.reload();await page.getByText("₹2,000.00",{exact:true}).waitFor();
 await page.getByRole("button",{name:"Links",exact:true}).click();await page.getByText("Primary referral link",{exact:true}).waitFor();assert.equal(await page.getByRole("link",{name:"QR code"}).count(),1);
 await page.getByRole("button",{name:"Payouts",exact:true}).click();await page.getByLabel("Amount in INR",{exact:true}).fill("1000");await page.getByRole("button",{name:"Request payout"}).click();await page.getByText("Please retry.",{exact:true}).waitFor();const failed=writes.at(-1).data;
 payoutFail=false;await page.getByRole("button",{name:"Request payout"}).click();await page.getByText("Saved.",{exact:true}).waitFor();assert.equal(writes.at(-1).data.key,failed.key,"uncertain payout retry retains idempotency key");assert.equal(writes.at(-1).data.amountPaise,100000);
 await page.setViewportSize({width:390,height:844});await page.getByRole("button",{name:"Overview",exact:true}).click();await page.getByRole("heading",{name:"Your partner dashboard"}).waitFor();
 await page.goto(base+"/admin");await page.getByRole("heading",{name:"Affiliate management"}).waitFor();await page.getByLabel("Partner ID",{exact:true}).fill(profile.id);await page.getByLabel("Reason / supporting evidence reference").fill("Verified application");await page.getByLabel("Admin action PIN").fill("123456");await page.getByRole("button",{name:"Record action"}).click();await page.getByText("Action recorded.",{exact:true}).waitFor();assert.equal(writes.at(-1).data.data.status,"APPROVED");
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);console.log("PASS: disabled state, partner application, earnings, links, QR link, payout failure/retry idempotency, mobile rendering, admin approval. All APIs mocked; no external calls.");
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
