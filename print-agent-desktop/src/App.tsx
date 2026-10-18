import { useCallback, useEffect, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { UpdateBanner } from "./UpdateBanner";

type PrinterInfo = {
  localId: string;
  name: string;
  port?: string;
  connectionType: "USB" | "NETWORK" | "UNKNOWN";
  status: "ready" | "offline" | "UNKNOWN";
  isDefault: boolean;
  supportsPdf: null;
};

type PrintResult = {
  printerName: string;
  pdfPath: string;
};

type PrinterSelection = {
  name: string | null;
  localId: string | null;
};

type PrintStatus = {
  currentJob: string;
  jobId: string | null;
  printerName: string | null;
  pdfPath: string | null;
  lastAttemptAt: string | null;
  lastResult: string | null;
  lastError: string | null;
};

type Connection = {
  state: "disconnected" | "pairing" | "connected" | "revoked" | "error";
  code: string | null;
  expiresAt: string | null;
  organizationName: string | null;
  deviceName: string | null;
  message: string | null;
};

function printerStatusLabel(printers: PrinterInfo[], selectedName: string, selectedLocalId: string) {
  if (!selectedName) return "Not Found";
  const match = selectedLocalId
    ? printers.find((printer) => printer.localId === selectedLocalId)
    : printers.filter((printer) => printer.name === selectedName).length === 1
      ? printers.find((printer) => printer.name === selectedName)
      : undefined;
  if (!match) return "Not Found";
  if (match.status === "offline") return "Offline";
  if (match.status === "ready") return "Available";
  return "Unknown";
}

function jobLabel(current: string) {
  if (current === "queued") return "Queued";
  if (current === "processing") return "Processing";
  if (current === "submitted") return "Submitted";
  if (current === "failed") return "Failed";
  return "Idle";
}

function formatAttempt(value: string | null) {
  if (!value) return "None";
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) return value;
  return new Date(asNumber).toLocaleString();
}

export function ConnectionCard({
  connection,
  onGenerate,
  onDisconnect,
  error,
  selectedPrinter,
}: {
  connection: Connection | null;
  onGenerate: () => void;
  onDisconnect: () => void;
  error: string;
  selectedPrinter?: string;
}) {
  const state = connection?.state ?? "disconnected";
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    const code = connection?.code?.trim();
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const field = document.createElement("textarea");
      field.value = code;
      field.setAttribute("readonly", "");
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="card">
      {state === "connected" ? (
        <>
          <div className="connected-header">
            <h2>Connected to PostBus</h2>
            <span className="status-connected">Connected</span>
          </div>
          <p>Organization: {connection?.organizationName || "PostBus"}</p>
          <p>Device: {connection?.deviceName || "This computer"}</p>
          <p>Selected printer: {selectedPrinter || "None"}</p>
          {error ? <p className="message error">{error}</p> : null}
          <div className="row">
            <button type="button" onClick={onDisconnect}>Disconnect</button>
          </div>
        </>
      ) : null}
      {state === "pairing" ? (
        <>
          <h2>Your pairing code</h2>
          <p className="code">{connection?.code}</p>
          <p className="muted">Expires in 10 minutes. Open PostBus, go to Settings, then Printing, and enter this code.</p>
          <div className="row">
            <button type="button" className="primary" onClick={() => void copyCode()} disabled={!connection?.code}>
              {copied ? "Copied" : "Copy code"}
            </button>
            <button type="button" onClick={onGenerate}>Generate new code</button>
          </div>
        </>
      ) : null}
      {state === "revoked" ? (
        <>
          <h2>This computer has been disconnected</h2>
          <p>It is no longer connected to your PostBus organization.</p>
          <div className="row">
            <button type="button" className="primary" onClick={onGenerate}>Pair again</button>
          </div>
        </>
      ) : null}
      {state === "error" ? (
        <>
          <h2>Unable to connect to PostBus</h2>
          <p>{connection?.message || "Check your internet connection."}</p>
          <div className="row">
            <button type="button" className="primary" onClick={onGenerate}>Retry</button>
          </div>
        </>
      ) : null}
      {state === "disconnected" ? (
        <>
          <h2>Connect your computer to PostBus</h2>
          <p className="muted">No merchant password is entered in this app.</p>
          <div className="row">
            <button type="button" className="primary" onClick={onGenerate}>Generate pairing code</button>
          </div>
          {error ? <p className="message error">{error}</p> : null}
        </>
      ) : null}
    </section>
  );
}

export function App() {
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selected, setSelected] = useState("");
  const [selectedLocalId, setSelectedLocalId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<Connection | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [printStatus, setPrintStatus] = useState<PrintStatus>({
    currentJob: "idle",
    jobId: null,
    printerName: null,
    pdfPath: null,
    lastAttemptAt: null,
    lastResult: null,
    lastError: null,
  });

  const load = useCallback(async () => {
    setError("");
    try {
      const [found, saved] = await Promise.all([
        invoke<PrinterInfo[]>("list_printers"),
        invoke<PrinterSelection>("selected_printer"),
      ]);
      setPrinters(found);
      const savedName = saved?.name ?? "";
      const savedId = saved?.localId ?? "";
      const stillThere = savedId
        ? found.some((printer) => printer.localId === savedId)
        : savedName
          ? found.filter((printer) => printer.name === savedName).length === 1
          : false;
      if (stillThere) {
        const match = savedId
          ? found.find((printer) => printer.localId === savedId)
          : found.find((printer) => printer.name === savedName);
        setSelected(match?.name ?? savedName);
        setSelectedLocalId(match?.localId ?? savedId);
      } else {
        setSelected("");
        setSelectedLocalId("");
        if (savedName || savedId) {
          setError("The previously selected printer was not found. Choose a printer from the list.");
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const refreshConnection = useCallback(async () => {
    const next = await invoke<Connection>("agent_connection");
    setConnection(next);
    if (next.state === "pairing") {
      const polled = await invoke<Connection>("check_device_pairing");
      setConnection(polled);
    }
  }, []);

  useEffect(() => {
    void load();
    void refreshConnection().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
    void invoke<PrintStatus>("print_status").then(setPrintStatus).catch(() => undefined);
    void invoke<string>("agent_version").then(setAppVersion).catch(() => undefined);
  }, [load, refreshConnection]);

  useEffect(() => {
    if (connection?.state !== "pairing") return;
    const timer = window.setInterval(() => {
      void refreshConnection().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [connection?.state, refreshConnection]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<PrintStatus>("print-agent-status", (event) => {
      setPrintStatus(event.payload);
      if (event.payload.lastError) setError(event.payload.lastError);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  async function choose(printer: PrinterInfo) {
    if (printer.status === "offline") {
      setError("The selected printer is offline or unavailable.");
      return;
    }
    setSelected(printer.name);
    setSelectedLocalId(printer.localId);
    setError("");
    try {
      await invoke("set_selected_printer", { printerName: printer.name, localId: printer.localId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function clearStatus() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await invoke<PrintStatus>("clear_print_status");
      setPrintStatus(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function printTest() {
    if (!selected) return;
    if (!window.confirm(`Send a local 4×6 test page to ${selected}? This does not print a customer label.`)) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await invoke<PrintResult>("print_test_pdf", { printerName: selected, localId: selectedLocalId || null });
      setMessage(`Submitted the test PDF to the Windows spooler for ${result.printerName}. This does not confirm that paper came out.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const connected = connection?.state === "connected";
  const printerState = printerStatusLabel(printers, selected, selectedLocalId);

  return (
    <div className="app">
      <header>
        <div className="header-brand">
          <img src="/favicon.png" alt="" width={28} height={28} className="header-icon" />
          <div>
          <h1>PostBus Print Agent</h1>
          <p>Pair this computer with your PostBus organization.</p>
          </div>
        </div>
        {appVersion ? <span className="header-version">Version {appVersion}</span> : null}
      </header>
      <main>
        <UpdateBanner />
        <ConnectionCard
          connection={connection}
          selectedPrinter={selected}
          onGenerate={() =>
            void invoke<Connection>("start_device_pairing")
              .then(setConnection)
              .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
          }
          onDisconnect={() =>
            void invoke<Connection>("disconnect_device")
              .then(setConnection)
              .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
          }
          error={error}
        />
        {connected ? (
          <section className="card">
            <div className="connected-header">
              <h2>Print status</h2>
              <button type="button" disabled={busy} onClick={() => void clearStatus()}>
                Clear
              </button>
            </div>
            <dl className="status-grid">
              <div><dt>Agent connection</dt><dd>{connected ? "Connected" : "Disconnected"}</dd></div>
              <div><dt>Windows print queue</dt><dd>{printStatus.printerName || selected || "None"}</dd></div>
              <div><dt>Printer status</dt><dd>{printerState}</dd></div>
              <div><dt>Current print job</dt><dd>{jobLabel(printStatus.currentJob)}</dd></div>
              <div><dt>Last print attempt</dt><dd>{formatAttempt(printStatus.lastAttemptAt)} — {printStatus.lastResult || "none"}</dd></div>
              <div><dt>Last error</dt><dd>{printStatus.lastError || connection?.message || "None"}</dd></div>
            </dl>
            {printStatus.pdfPath ? (
              <iframe
                className="label-preview"
                title="Label PDF"
                src={convertFileSrc(printStatus.pdfPath)}
              />
            ) : (
              <p className="muted">The label PDF appears here when a job is claimed.</p>
            )}
            {printers.length ? (
              <p className="muted queues">
                Queues: {printers.map((printer) => printer.name).join(", ")}
              </p>
            ) : null}
          </section>
        ) : null}
        <section className="card">
          <h2>Installed printers</h2>
          <p className="muted">
            Names come from Windows. A printer is marked USB only when its port says USB. Install the manufacturer driver if a printer does not appear.
          </p>
          <div className="row">
            <button type="button" onClick={() => void load()} disabled={busy}>Refresh printers</button>
          </div>
          {printers.length === 0 ? (
            <p className="empty">No installed printers were found.</p>
          ) : (
            <div className="printers">
              {printers.map((printer) => (
                <button
                  key={printer.localId}
                  type="button"
                  className={printer.localId === selectedLocalId || printer.name === selected ? "printer selected" : "printer"}
                  onClick={() => void choose(printer)}
                >
                  <input type="radio" checked={printer.localId === selectedLocalId || (!selectedLocalId && printer.name === selected)} readOnly aria-label={`Select ${printer.name}`} />
                  <span>
                    <strong>{printer.name}</strong>
                    <span className="muted">{printer.isDefault ? "Windows default" : printer.port || "Installed printer"}</span>
                  </span>
                  <span className="badges">
                    <span className={printer.connectionType === "USB" ? "badge usb" : "badge"}>{printer.connectionType}</span>
                    <span className="badge">{printer.status}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="card">
          <h2>Test print</h2>
          <p className="muted">
            Prints a local 4×6 inch PDF through the selected Windows printer driver. Nothing is uploaded and no customer label is sent.
          </p>
          <div className="row">
            <button type="button" className="primary" disabled={!selected || busy} onClick={() => void printTest()}>
              {busy ? "Sending…" : "Print test PDF"}
            </button>
            <button type="button" disabled={busy} onClick={() => void clearStatus()}>
              Clear
            </button>
          </div>
          {message ? <p className="message">{message}</p> : null}
          {(connection?.state ?? "disconnected") === "disconnected" ? null : error ? <p className="message error">{error}</p> : null}
        </section>
      </main>
    </div>
  );
}
