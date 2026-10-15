import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { UpdateBanner } from "./UpdateBanner";

type PrinterInfo = {
  localId: string;
  name: string;
  connectionType: "USB" | "NETWORK" | "UNKNOWN";
  status: "ready" | "offline" | "UNKNOWN";
  isDefault: boolean;
  supportsPdf: null;
};

type PrintResult = {
  printerName: string;
  pdfPath: string;
};

type Connection = {
  state: "disconnected" | "pairing" | "connected" | "revoked" | "error";
  code: string | null;
  expiresAt: string | null;
  organizationName: string | null;
  deviceName: string | null;
  message: string | null;
};

export function ConnectionCard({
  connection,
  onGenerate,
  onDisconnect,
  onPrinters,
  error,
}: {
  connection: Connection | null;
  onGenerate: () => void;
  onDisconnect: () => void;
  onPrinters: () => void;
  error: string;
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
      field.style.position = "fixed";
      field.style.left = "-9999px";
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
          <p className="muted">This connection does not print shipping labels yet.</p>
          <div className="row">
            <button type="button" onClick={onPrinters}>View printers</button>
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<Connection | null>(null);
  const [showPrinters, setShowPrinters] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const [found, saved] = await Promise.all([
        invoke<PrinterInfo[]>("list_printers"),
        invoke<string | null>("selected_printer"),
      ]);
      setPrinters(found);
      const stillThere = saved && found.some((printer) => printer.name === saved);
      setSelected(stillThere ? saved : found.find((printer) => printer.isDefault)?.name ?? found[0]?.name ?? "");
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
  }, [load, refreshConnection]);

  useEffect(() => {
    if (connection?.state !== "pairing") return;
    const timer = window.setInterval(() => {
      void refreshConnection().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [connection?.state, refreshConnection]);

  async function choose(name: string) {
    setSelected(name);
    setError("");
    try {
      await invoke("set_selected_printer", { printerName: name });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function printTest() {
    if (!selected) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await invoke<PrintResult>("print_test_pdf", { printerName: selected });
      setMessage(`Sent the test PDF to ${result.printerName} through its Windows printer driver. This does not confirm that paper came out.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

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
      </header>
      <main>
        <UpdateBanner />
        <ConnectionCard
          connection={connection}
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
          onPrinters={() => setShowPrinters(true)}
          error={error}
        />
        {connection?.state === "connected" && !showPrinters ? null : (
        <>
        <section className="card">
          <h2>Installed printers</h2>
          <p className="muted">
            Names come from Windows. A printer is marked USB only when its port says USB. Install the manufacturer driver if a printer does not appear.
          </p>
          <div className="row">
            <button type="button" onClick={() => void load()} disabled={busy}>Refresh</button>
          </div>
          {printers.length === 0 ? (
            <p className="empty">No installed printers were found.</p>
          ) : (
            <div className="printers">
              {printers.map((printer) => (
                <button
                  key={printer.localId}
                  type="button"
                  className={printer.name === selected ? "printer selected" : "printer"}
                  onClick={() => void choose(printer.name)}
                >
                  <input type="radio" checked={printer.name === selected} readOnly aria-label={`Select ${printer.name}`} />
                  <span>
                    <strong>{printer.name}</strong>
                    <span className="muted">{printer.isDefault ? "Windows default" : "Installed printer"}</span>
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
            Prints a local 4×6 inch PDF through the selected Windows printer driver. Nothing is uploaded.
          </p>
          <div className="row">
            <button type="button" className="primary" disabled={!selected || busy} onClick={() => void printTest()}>
              {busy ? "Sending…" : "Print test PDF"}
            </button>
          </div>
          {message ? <p className="message">{message}</p> : null}
          {(connection?.state ?? "disconnected") === "disconnected" ? null : error ? <p className="message error">{error}</p> : null}
        </section>
        </>
        )}
      </main>
    </div>
  );
}
