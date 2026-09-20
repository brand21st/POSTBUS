import { Worker } from "bullmq";
import { getRedis } from "@/lib/queue/connection";
import { QUEUE_NAMES } from "@/lib/queue/queues";
import { processJob } from "@/workers/processor";
import { delayForAttempt } from "@/lib/jobs/retry";
import { logError, logInfo } from "@/lib/logger";

const names = Object.values(QUEUE_NAMES);

for (const name of names) {
  const worker = new Worker(
    name,
    async (job) => {
      logInfo("worker.start", { queue: name, jobId: job.data.jobId, organizationId: job.data.organizationId });
      await processJob(name, job.data);
    },
    {
      connection: getRedis(),
      concurrency: name === "shipment-booking" ? 4 : 2,
      settings: {
        backoffStrategy: (attemptsMade: number) => delayForAttempt(attemptsMade),
      },
    }
  );

  worker.on("failed", (job, error) => {
    logError("worker.failed", {
      queue: name,
      jobId: job?.id,
      message: error.message,
    });
  });
}

logInfo("workers.started", { queues: names });
