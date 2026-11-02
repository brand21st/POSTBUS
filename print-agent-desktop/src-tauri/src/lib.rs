mod credentials;
mod diagnostics;
mod pairing;
mod print_pdf;
mod printers;
mod test_pdf;
mod toast;

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use print_pdf::{is_print_error_retryable, PrintResult};
use printers::{list_installed_printers, resolve_printer, PrinterInfo};
use serde::Deserialize;
use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Listener, Manager};
use tauri_plugin_notification::NotificationExt;
use toast::toast_for_claimed_job;

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default)]
struct Settings {
    selected_printer: Option<String>,
    selected_printer_local_id: Option<String>,
    #[serde(alias = "apiBaseUrl")]
    api_base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrintStatusView {
    current_job: String,
    job_id: Option<String>,
    printer_name: Option<String>,
    pdf_path: Option<String>,
    last_attempt_at: Option<String>,
    last_result: Option<String>,
    last_error: Option<String>,
}

impl Default for PrintStatusView {
    fn default() -> Self {
        Self {
            current_job: "idle".into(),
            job_id: None,
            printer_name: None,
            pdf_path: None,
            last_attempt_at: None,
            last_result: None,
            last_error: None,
        }
    }
}

struct PairingSession {
    verifier: Mutex<Option<String>>,
    code: Mutex<Option<String>>,
    expires_at: Mutex<Option<String>>,
    message: Mutex<Option<String>>,
}

struct PrintStatusState(Mutex<PrintStatusView>);

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("settings.json"))
}

fn read_settings(app: &tauri::AppHandle) -> Result<Settings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(Settings::default());
    }
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&text).map_err(|error| error.to_string())
}

fn write_settings(app: &tauri::AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    let text = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(path, text).map_err(|error| error.to_string())
}

fn now_iso() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    millis.to_string()
}

fn set_print_status(app: &tauri::AppHandle, view: PrintStatusView) {
    if let Some(state) = app.try_state::<PrintStatusState>() {
        if let Ok(mut slot) = state.0.lock() {
            *slot = view.clone();
        }
    }
    let _ = app.emit("print-agent-status", &view);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PrinterSelection {
    name: Option<String>,
    local_id: Option<String>,
}

#[tauri::command]
fn agent_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    let printers = printers::list_installed_printers()?;
    diagnostics::event(
        "printers.enumerated",
        serde_json::json!({
            "count": printers.len(),
            "names": printers.iter().map(|printer| format!("{} ({})", printer.name, printer.port)).collect::<Vec<_>>(),
        }),
    );
    Ok(printers)
}

#[tauri::command]
fn selected_printer(app: tauri::AppHandle) -> Result<PrinterSelection, String> {
    let settings = read_settings(&app)?;
    Ok(PrinterSelection {
        name: settings.selected_printer,
        local_id: settings.selected_printer_local_id,
    })
}

#[tauri::command]
fn set_selected_printer(
    app: tauri::AppHandle,
    printer_name: String,
    local_id: Option<String>,
) -> Result<(), String> {
    let installed = list_installed_printers()?;
    let printer = resolve_printer(&installed, &printer_name, local_id.as_deref())?;
    let mut settings = read_settings(&app)?;
    settings.selected_printer = Some(printer.name.clone());
    settings.selected_printer_local_id = Some(printer.local_id.clone());
    write_settings(&app, &settings)?;
    diagnostics::event(
        "printer.selected",
        serde_json::json!({
            "name": printer.name,
            "localId": printer.local_id,
            "status": format!("{:?}", printer.status),
        }),
    );
    report_printers(&app);
    Ok(())
}

#[tauri::command]
fn print_status(app: tauri::AppHandle) -> Result<PrintStatusView, String> {
    if let Some(state) = app.try_state::<PrintStatusState>() {
        if let Ok(slot) = state.0.lock() {
            return Ok(slot.clone());
        }
    }
    Ok(PrintStatusView::default())
}

#[tauri::command]
fn clear_print_status(app: tauri::AppHandle) -> Result<PrintStatusView, String> {
    let current = print_status(app.clone())?;
    if current.current_job == "processing" {
        return Err("A print job is still sending. Wait until it finishes, then clear.".into());
    }
    drop_preview_pdf(current.pdf_path.as_deref());
    let cleared = PrintStatusView::default();
    set_print_status(&app, cleared.clone());
    Ok(cleared)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionView {
    state: String,
    code: Option<String>,
    expires_at: Option<String>,
    organization_name: Option<String>,
    device_name: Option<String>,
    message: Option<String>,
}

fn base_url(app: &tauri::AppHandle) -> Result<String, String> {
    Ok(pairing::api_base(read_settings(app)?.api_base_url.as_deref()))
}

fn report_printers(app: &tauri::AppHandle) {
    let Ok(base) = base_url(app) else { return };
    let listed = printers::list_installed_printers().unwrap_or_default();
    let names = listed.iter().map(|printer| printer.name.clone()).collect::<Vec<_>>();
    let selected = read_settings(app).ok().and_then(|settings| settings.selected_printer);
    match pairing::heartbeat(&base, &names, selected.as_deref()) {
        Ok(()) => diagnostics::event(
            "heartbeat.ok",
            serde_json::json!({ "printerCount": names.len(), "selected": selected }),
        ),
        Err(message) => {
            diagnostics::event("heartbeat.error", serde_json::json!({ "error": message.clone() }));
            if let Some(session) = app.try_state::<PairingSession>() {
                if let Ok(mut slot) = session.message.lock() {
                    *slot = Some(message);
                }
            }
        }
    }
}

fn preferred_local_id(app: &tauri::AppHandle) -> Option<String> {
    read_settings(app).ok().and_then(|settings| settings.selected_printer_local_id)
}

fn current_pdf_path(app: &tauri::AppHandle) -> Option<String> {
    app.try_state::<PrintStatusState>()
        .and_then(|state| state.0.lock().ok().and_then(|view| view.pdf_path.clone()))
}

fn drop_preview_pdf(path: Option<&str>) {
    if let Some(path) = path.filter(|value| !value.is_empty()) {
        let _ = fs::remove_file(path);
    }
}

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn notify_claimed_job(app: &tauri::AppHandle, printer: Option<&str>) {
    let (title, body) = toast_for_claimed_job(printer);
    if let Err(error) = app.notification().builder().title(title).body(&body).show() {
        diagnostics::event(
            "toast.error",
            serde_json::json!({ "error": error.to_string() }),
        );
    }
}

fn print_queued_labels(app: &tauri::AppHandle) {
    if credentials::load_credential().ok().flatten().is_none() {
        return;
    }
    report_printers(app);
    let Ok(base) = base_url(app) else { return };
    let claimed = match pairing::claim_job(&base) {
        Ok(value) => value,
        Err(message) => {
            diagnostics::event("claim.error", serde_json::json!({ "error": message.clone() }));
            set_print_status(
                app,
                PrintStatusView {
                    current_job: "failed".into(),
                    last_attempt_at: Some(now_iso()),
                    last_result: Some("claim_failed".into()),
                    last_error: Some(message.clone()),
                    pdf_path: None,
                    ..PrintStatusView::default()
                },
            );
            if let Some(session) = app.try_state::<PairingSession>() {
                if let Ok(mut slot) = session.message.lock() {
                    *slot = Some(message);
                }
            }
            return;
        }
    };
    let Some(claimed) = claimed else {
        return;
    };
    drop_preview_pdf(current_pdf_path(app).as_deref());
    diagnostics::event(
        "claim.ok",
        serde_json::json!({
            "jobId": claimed.job.id,
            "printer": claimed.job.printer_name,
            "paper": claimed.paper_size,
            "orientation": claimed.orientation,
        }),
    );
    let printer_name = claimed.job.printer_name.clone().unwrap_or_default();
    notify_claimed_job(app, claimed.job.printer_name.as_deref());
    set_print_status(
        app,
        PrintStatusView {
            current_job: "processing".into(),
            job_id: Some(claimed.job.id.clone()),
            printer_name: Some(printer_name.clone()),
            pdf_path: None,
            last_attempt_at: Some(now_iso()),
            last_result: Some("claimed".into()),
            last_error: None,
        },
    );
    let Ok(directory) = app.path().app_data_dir() else { return };
    let pdf_path = directory.join(format!("job-{}.pdf", claimed.job.id));
    match pairing::job_pdf(&base, &claimed.job.id) {
        Ok(bytes) => {
            diagnostics::event(
                "pdf.download",
                serde_json::json!({ "jobId": claimed.job.id, "bytes": bytes.len() }),
            );
            if fs::write(&pdf_path, &bytes).is_err() {
                let message = "Could not save the label PDF.";
                let _ = pairing::complete_job(&base, &claimed.job.id, "FAILED", Some(message));
                set_print_status(
                    app,
                    PrintStatusView {
                        current_job: "failed".into(),
                        job_id: Some(claimed.job.id.clone()),
                        printer_name: Some(printer_name),
                        pdf_path: None,
                        last_attempt_at: Some(now_iso()),
                        last_result: Some("failed".into()),
                        last_error: Some(message.into()),
                    },
                );
                return;
            }
        }
        Err(message) => {
            diagnostics::event("pdf.error", serde_json::json!({ "jobId": claimed.job.id, "error": message.clone() }));
            let _ = pairing::complete_job(&base, &claimed.job.id, "FAILED", Some(&message));
            set_print_status(
                app,
                PrintStatusView {
                    current_job: "failed".into(),
                    job_id: Some(claimed.job.id.clone()),
                    printer_name: Some(printer_name),
                    pdf_path: None,
                    last_attempt_at: Some(now_iso()),
                    last_result: Some("failed".into()),
                    last_error: Some(message),
                },
            );
            return;
        }
    }
    let preview_path = pdf_path.to_string_lossy().into_owned();
    set_print_status(
        app,
        PrintStatusView {
            current_job: "processing".into(),
            job_id: Some(claimed.job.id.clone()),
            printer_name: Some(printer_name.clone()),
            pdf_path: Some(preview_path.clone()),
            last_attempt_at: Some(now_iso()),
            last_result: Some("claimed".into()),
            last_error: None,
        },
    );
    let copies = claimed.copies.unwrap_or(1);
    let paper = claimed.paper_size.clone().unwrap_or_else(|| "A6".into());
    let local_id = preferred_local_id(app);
    match print_pdf::print_label_pdf(
        &pdf_path,
        &printer_name,
        &paper,
        copies,
        claimed.orientation.as_deref(),
        local_id.as_deref(),
    ) {
        Ok(job_id) => {
            diagnostics::event(
                "spooler.submitted",
                serde_json::json!({ "jobId": claimed.job.id, "spoolerJobId": job_id, "printer": printer_name }),
            );
            match pairing::complete_job(&base, &claimed.job.id, "PRINTED", None) {
                Ok(()) => diagnostics::event("ack.ok", serde_json::json!({ "jobId": claimed.job.id, "status": "PRINTED" })),
                Err(message) => diagnostics::event("ack.error", serde_json::json!({ "jobId": claimed.job.id, "error": message })),
            }
            set_print_status(
                app,
                PrintStatusView {
                    current_job: "submitted".into(),
                    job_id: Some(claimed.job.id.clone()),
                    printer_name: Some(printer_name),
                    pdf_path: Some(preview_path),
                    last_attempt_at: Some(now_iso()),
                    last_result: Some("submitted".into()),
                    last_error: None,
                },
            );
        }
        Err(message) => {
            diagnostics::event(
                "spooler.error",
                serde_json::json!({ "jobId": claimed.job.id, "error": message.clone() }),
            );
            let retryable = is_print_error_retryable(&message);
            let status = if retryable { "PENDING" } else { "FAILED" };
            let _ = pairing::complete_job(&base, &claimed.job.id, status, Some(&message));
            set_print_status(
                app,
                PrintStatusView {
                    current_job: if retryable { "queued".into() } else { "failed".into() },
                    job_id: Some(claimed.job.id.clone()),
                    printer_name: Some(printer_name),
                    pdf_path: Some(preview_path),
                    last_attempt_at: Some(now_iso()),
                    last_result: Some(if retryable { "retry".into() } else { "failed".into() }),
                    last_error: Some(message),
                },
            );
        }
    }
}

fn connection_view(app: &tauri::AppHandle) -> Result<ConnectionView, String> {
    let session = app.state::<PairingSession>();
    let message = session.message.lock().map_err(|_| "Pairing state is busy.".to_string())?.clone();
    if message.as_deref().is_some_and(|text| text.contains("disconnected")) {
        return Ok(ConnectionView {
            state: "revoked".into(),
            code: None,
            expires_at: None,
            organization_name: None,
            device_name: None,
            message,
        });
    }
    if let Some(credential) = credentials::load_credential()? {
        return Ok(ConnectionView {
            state: "connected".into(),
            code: None,
            expires_at: None,
            organization_name: Some(credential.organization_name),
            device_name: Some(credential.device_name),
            message,
        });
    }
    let code = session.code.lock().map_err(|_| "Pairing state is busy.".to_string())?.clone();
    let expires_at = session.expires_at.lock().map_err(|_| "Pairing state is busy.".to_string())?.clone();
    Ok(ConnectionView {
        state: if code.is_some() {
            "pairing".into()
        } else if message.is_some() {
            "error".into()
        } else {
            "disconnected".into()
        },
        code,
        expires_at,
        organization_name: None,
        device_name: None,
        message,
    })
}

#[tauri::command]
fn agent_connection(app: tauri::AppHandle) -> Result<ConnectionView, String> {
    connection_view(&app)
}

#[tauri::command]
fn start_device_pairing(app: tauri::AppHandle) -> Result<ConnectionView, String> {
    let session = app.state::<PairingSession>();
    let verifier = credentials::random_verifier()?;
    diagnostics::event("pairing.start", serde_json::json!({ "device": pairing::computer_name() }));
    let started = pairing::start_pairing(&base_url(&app)?, &verifier, &pairing::computer_name())?;
    *session.verifier.lock().map_err(|_| "Pairing state is busy.".to_string())? = Some(verifier);
    *session.code.lock().map_err(|_| "Pairing state is busy.".to_string())? = Some(started.code);
    *session.expires_at.lock().map_err(|_| "Pairing state is busy.".to_string())? = Some(started.expires_at);
    *session.message.lock().map_err(|_| "Pairing state is busy.".to_string())? = None;
    connection_view(&app)
}

#[tauri::command]
fn check_device_pairing(app: tauri::AppHandle) -> Result<ConnectionView, String> {
    let session = app.state::<PairingSession>();
    let verifier = session.verifier.lock().map_err(|_| "Pairing state is busy.".to_string())?.clone();
    if let Some(verifier) = verifier {
        match pairing::poll_pairing(&base_url(&app)?, &verifier) {
            Ok(polled) if polled.status == "approved" => match pairing::exchange_pairing(&base_url(&app)?, &verifier) {
                Ok(_) => {
                    diagnostics::event("pairing.connected", serde_json::json!({}));
                    *session.verifier.lock().map_err(|_| "Pairing state is busy.".to_string())? = None;
                    *session.code.lock().map_err(|_| "Pairing state is busy.".to_string())? = None;
                    *session.message.lock().map_err(|_| "Pairing state is busy.".to_string())? = None;
                    report_printers(&app);
                }
                Err(message) => *session.message.lock().map_err(|_| "Pairing state is busy.".to_string())? = Some(message),
            },
            Ok(polled) if polled.status == "expired" || polled.status == "locked" || polled.status == "consumed" => {
                *session.verifier.lock().map_err(|_| "Pairing state is busy.".to_string())? = None;
                *session.code.lock().map_err(|_| "Pairing state is busy.".to_string())? = None;
                *session.message.lock().map_err(|_| "Pairing state is busy.".to_string())? = Some("That pairing code is no longer valid.".into());
            }
            Ok(_) => {}
            Err(message) => *session.message.lock().map_err(|_| "Pairing state is busy.".to_string())? = Some(message),
        }
    }
    connection_view(&app)
}

#[tauri::command]
fn disconnect_device(app: tauri::AppHandle) -> Result<ConnectionView, String> {
    let session = app.state::<PairingSession>();
    diagnostics::event("pairing.disconnect", serde_json::json!({}));
    if let Err(message) = pairing::disconnect(&base_url(&app)?) {
        *session.message.lock().map_err(|_| "Pairing state is busy.".to_string())? = Some(message);
    } else {
        *session.message.lock().map_err(|_| "Pairing state is busy.".to_string())? = None;
    }
    *session.verifier.lock().map_err(|_| "Pairing state is busy.".to_string())? = None;
    *session.code.lock().map_err(|_| "Pairing state is busy.".to_string())? = None;
    connection_view(&app)
}

#[tauri::command]
fn print_test_pdf(app: tauri::AppHandle, printer_name: String, local_id: Option<String>) -> Result<PrintResult, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    diagnostics::event(
        "test_print.start",
        serde_json::json!({ "printer": printer_name, "localId": local_id }),
    );
    match print_pdf::print_test_pdf(&directory, &printer_name, local_id.as_deref()) {
        Ok(result) => {
            diagnostics::event(
                "test_print.submitted",
                serde_json::json!({ "printer": result.printer_name, "spoolerJobId": result.spooler_job_id }),
            );
            set_print_status(
                &app,
                PrintStatusView {
                    current_job: "submitted".into(),
                    printer_name: Some(result.printer_name.clone()),
                    last_attempt_at: Some(now_iso()),
                    last_result: Some("submitted".into()),
                    last_error: None,
                    job_id: None,
                    pdf_path: None,
                },
            );
            Ok(result)
        }
        Err(message) => {
            diagnostics::event("test_print.error", serde_json::json!({ "error": message.clone() }));
            set_print_status(
                &app,
                PrintStatusView {
                    current_job: "failed".into(),
                    printer_name: Some(printer_name),
                    last_attempt_at: Some(now_iso()),
                    last_result: Some("failed".into()),
                    last_error: Some(message.clone()),
                    job_id: None,
                    pdf_path: None,
                },
            );
            Err(message)
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PairingSession {
            verifier: Mutex::new(None),
            code: Mutex::new(None),
            expires_at: Mutex::new(None),
            message: Mutex::new(None),
        })
        .manage(PrintStatusState(Mutex::new(PrintStatusView::default())))
        .invoke_handler(tauri::generate_handler![
            agent_version,
            list_printers,
            selected_printer,
            set_selected_printer,
            print_status,
            clear_print_status,
            print_test_pdf,
            agent_connection,
            start_device_pairing,
            check_device_pairing,
            disconnect_device
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            if let Ok(directory) = handle.path().app_data_dir() {
                let _ = fs::create_dir_all(&directory);
                diagnostics::init(&directory);
                diagnostics::event(
                    "agent.startup",
                    serde_json::json!({ "version": env!("CARGO_PKG_VERSION") }),
                );
            }
            let _ = handle.notification().request_permission();
            let notify_handle = handle.clone();
            let _ = handle.listen("notification://action", move |_| {
                focus_main_window(&notify_handle);
            });
            std::thread::spawn(move || loop {
                print_queued_labels(&handle);
                std::thread::sleep(Duration::from_secs(3));
            });
            let open = MenuItem::with_id(app, "open", "Open PostBus Print Agent", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let icon = app.default_window_icon().cloned().ok_or("Missing application icon.")?;
            TrayIconBuilder::with_id("postbus-print")
                .icon(icon)
                .tooltip("PostBus Print Agent")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => focus_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("PostBus Print Agent failed to start");
}
