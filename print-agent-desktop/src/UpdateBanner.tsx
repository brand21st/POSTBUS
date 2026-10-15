import { useCallback, useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

type UpdatePhase = "idle" | "checking" | "available" | "downloading" | "installing" | "error";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function isTauriRuntime() {
  return Boolean(import.meta.env.TAURI_ENV_PLATFORM);
}

export function UpdateBanner() {
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  const installUpdate = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setError("");
    setPhase("checking");
    try {
      const update = await check();
      if (!update) {
        setPhase("idle");
        return;
      }
      setVersion(update.version);
      setPhase("downloading");
      setProgress(0);
      let downloaded = 0;
      let contentLength = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setPhase("downloading");
          setProgress(0);
          contentLength = event.data.contentLength ?? 0;
          downloaded = 0;
        } else if (event.event === "Progress") {
          setPhase("downloading");
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            setProgress(Math.min(100, Math.round((downloaded / contentLength) * 100)));
          }
        } else if (event.event === "Finished") {
          setPhase("installing");
          setProgress(100);
        }
      });
      setPhase("installing");
      await relaunch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPhase("error");
    }
  }, []);

  const checkForUpdates = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setError("");
    setPhase("checking");
    try {
      const update = await check();
      if (update) {
        setVersion(update.version);
        setPhase("available");
      } else {
        setPhase("idle");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void checkForUpdates();
    const timer = window.setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [checkForUpdates]);

  const [appVersion, setAppVersion] = useState("");
  useEffect(() => {
    if (!isTauriRuntime()) return;
    void getVersion().then(setAppVersion).catch(() => undefined);
  }, []);

  if (!isTauriRuntime()) return null;
  if (phase === "idle" && !error) return null;

  return (
    <section className="update-banner" aria-live="polite">
      {phase === "checking" ? <p className="muted">Checking for updates…</p> : null}
      {phase === "available" ? (
        <>
          <p>
            <strong>Update available</strong>
            {version ? ` — version ${version}` : null}
            {appVersion ? <span className="muted"> (installed {appVersion})</span> : null}
          </p>
          <div className="row">
            <button type="button" className="primary" onClick={() => void installUpdate()}>
              Install update
            </button>
            <button type="button" onClick={() => void checkForUpdates()}>Check again</button>
          </div>
        </>
      ) : null}
      {phase === "downloading" ? (
        <p>
          Downloading update… {progress > 0 ? `${progress}%` : ""}
        </p>
      ) : null}
      {phase === "installing" ? <p>Installing update. The app will restart.</p> : null}
      {phase === "error" ? (
        <>
          <p className="message error">{error || "Update check failed."}</p>
          <div className="row">
            <button type="button" onClick={() => void checkForUpdates()}>Retry</button>
          </div>
        </>
      ) : null}
    </section>
  );
}
