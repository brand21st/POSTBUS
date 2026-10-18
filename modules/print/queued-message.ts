export function queuedPrintMessage(input: {
  connected: boolean;
  delivery?: string | null;
}) {
  if (input.delivery === "webusb") {
    return "Queued for direct USB printing.";
  }
  if (input.connected) {
    return "Queued for the Print Agent. Windows will receive the job when this computer claims it.";
  }
  return "Queued. The job will send to Windows when the selected Print Agent reconnects.";
}

export const STALE_PRINT_REVIEW_MESSAGE =
  "The Print Agent did not confirm this job. Check the printer before reprinting. PostBus will not send it again automatically.";
