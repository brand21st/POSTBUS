import { createStagingRpc } from "./pg-rpc.mjs";
import { printSafetyGate } from "./gate.mjs";

printSafetyGate({ PROCESS: "enqueue-race" });
const rpc = createStagingRpc("ok");
const a = await rpc.rpc("enqueue_shipment_booking_job", {
  p_organization_id: process.env.ORG,
  p_entity_id: process.env.SHIP,
});
console.log(JSON.stringify({ pid: process.pid, id: a.data?.id }));
