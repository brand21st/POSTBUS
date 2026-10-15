mod credentials;
mod pairing;
mod print_pdf;
mod printers;
mod test_pdf;

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use print_pdf::PrintResult;
use printers::PrinterInfo;
use serde::Deserialize;
use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default)]
struct Settings {
    selected_printer: Option<String>,
    #[serde(alias = "apiBaseUrl")]
    api_base_url: Option<String>,
}

struct PairingSession {
    verifier: Mutex<Option<String>>,
    code: Mutex<Option<String>>,
    expires_at: Mutex<Option<String>>,
    message: Mutex<Option<String>>,
}

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

#[tauri::command]
fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    printers::list_installed_printers()
}

#[tauri::command]
fn selected_printer(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(read_settings(&app)?.selected_printer)
}

#[tauri::command]
fn set_selected_printer(app: tauri::AppHandle, printer_name: String) -> Result<(), String> {
    let printer_name = printer_name.trim().to_string();
    let installed = printers::list_installed_printers()?;
    if !installed.iter().any(|printer| printer.name == printer_name) {
        return Err("That printer is not installed in Windows.".into());
    }
    let mut settings = read_settings(&app)?;
    settings.selected_printer = Some(printer_name.clone());
    write_settings(&app, &settings)?;
    report_printers(&app);
    Ok(())
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
    let names = printers::list_installed_printers()
        .unwrap_or_default()
        .into_iter()
        .map(|printer| printer.name)
        .collect::<Vec<_>>();
    let selected = read_settings(app).ok().and_then(|settings| settings.selected_printer);
    if let Err(message) = pairing::heartbeat(&base, &names, selected.as_deref()) {
        if let Some(session) = app.try_state::<PairingSession>() {
            if let Ok(mut slot) = session.message.lock() {
                *slot = Some(message);
            }
        }
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
        Err(_) => return,
    };
    let Some(claimed) = claimed else { return };
    let printer = claimed.job.printer_name.unwrap_or_default();
    let Ok(directory) = app.path().app_data_dir() else { return };
    let pdf_path = directory.join(format!("job-{}.pdf", claimed.job.id));
    match pairing::job_pdf(&base, &claimed.job.id) {
        Ok(bytes) => {
            if fs::write(&pdf_path, &bytes).is_err() {
                let _ = pairing::complete_job(&base, &claimed.job.id, "FAILED", Some("Could not save the label PDF."));
                return;
            }
        }
        Err(message) => {
            let _ = pairing::complete_job(&base, &claimed.job.id, "FAILED", Some(&message));
            return;
        }
    }
    let copies = claimed.copies.unwrap_or(1);
    let paper = claimed.paper_size.unwrap_or_else(|| "A6".into());
    match print_pdf::print_label_pdf(&pdf_path, &printer, &paper, copies) {
        Ok(()) => {
            let _ = pairing::complete_job(&base, &claimed.job.id, "PRINTED", None);
        }
        Err(message) => {
            let retryable = ["offline", "unavailable", "not installed", "could not open"]
                .iter()
                .any(|part| message.to_ascii_lowercase().contains(part));
            let _ = pairing::complete_job(
                &base,
                &claimed.job.id,
                if retryable { "PENDING" } else { "FAILED" },
                Some(&message),
            );
        }
    }
    let _ = fs::remove_file(pdf_path);
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
fn print_test_pdf(app: tauri::AppHandle, printer_name: String) -> Result<PrintResult, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    print_pdf::print_test_pdf(&directory, &printer_name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PairingSession {
            verifier: Mutex::new(None),
            code: Mutex::new(None),
            expires_at: Mutex::new(None),
            message: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            list_printers,
            selected_printer,
            set_selected_printer,
            print_test_pdf,
            agent_connection,
            start_device_pairing,
            check_device_pairing,
            disconnect_device
        ])
        .setup(|app| {
            let handle = app.handle().clone();
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
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
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
