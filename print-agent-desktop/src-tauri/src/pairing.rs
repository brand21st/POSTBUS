use std::io::Read;
use std::time::Duration;

use serde::Deserialize;
use serde_json::json;

use crate::credentials::{delete_credential, load_credential, save_credential, DeviceCredential};

#[derive(Debug, Clone, Deserialize)]
struct Envelope<T> {
    success: bool,
    message: String,
    data: Option<T>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    pub code: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Polled {
    pub status: String,
    #[allow(dead_code)]
    pub organization_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Issued {
    device_id: String,
    organization_name: String,
    device_name: String,
    access_token: String,
    refresh_token: String,
    access_expires_at: String,
    refresh_expires_at: String,
}

pub fn api_base(configured: Option<&str>) -> String {
    let raw = configured
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("https://www.postbus.in");
    let trimmed = raw.trim_end_matches('/');
    let allowed = trimmed.starts_with("https://")
        || trimmed.starts_with("http://127.0.0.1")
        || trimmed.starts_with("http://localhost");
    let chosen = if allowed { trimmed } else { "https://www.postbus.in" };
    if chosen == "https://postbus.in" {
        "https://www.postbus.in".to_string()
    } else {
        chosen.to_string()
    }
}

pub fn start_pairing(base: &str, verifier: &str, device_name: &str) -> Result<Started, String> {
    post(
        base,
        "print-devices/pair/start",
        None,
        json!({
            "verifier": verifier,
            "deviceName": device_name,
            "platform": "windows",
            "osVersion": os_label(),
            "agentVersion": env!("CARGO_PKG_VERSION")
        }),
    )
}

pub fn poll_pairing(base: &str, verifier: &str) -> Result<Polled, String> {
    post(base, "print-devices/pair/poll", None, json!({ "verifier": verifier }))
}

pub fn exchange_pairing(base: &str, verifier: &str) -> Result<DeviceCredential, String> {
    let issued: Issued = post(base, "print-devices/pair/exchange", None, json!({ "verifier": verifier }))?;
    let credential = DeviceCredential {
        access_token: issued.access_token,
        refresh_token: issued.refresh_token,
        device_id: issued.device_id,
        organization_name: issued.organization_name,
        device_name: issued.device_name,
        access_expires_at: issued.access_expires_at,
        refresh_expires_at: issued.refresh_expires_at,
    };
    save_credential(&credential)?;
    Ok(credential)
}

pub fn refresh_credential(base: &str) -> Result<Option<DeviceCredential>, String> {
    let Some(current) = load_credential()? else {
        return Ok(None);
    };
    match post::<Issued>(
        base,
        "print-devices/refresh",
        Some(&current.refresh_token),
        json!({}),
    ) {
        Ok(issued) => {
            let credential = DeviceCredential {
                access_token: issued.access_token,
                refresh_token: issued.refresh_token,
                device_id: issued.device_id,
                organization_name: issued.organization_name,
                device_name: issued.device_name,
                access_expires_at: issued.access_expires_at,
                refresh_expires_at: issued.refresh_expires_at,
            };
            save_credential(&credential)?;
            Ok(Some(credential))
        }
        Err(message) if message.contains("disconnected") => {
            delete_credential()?;
            Err(message)
        }
        Err(message) => Err(message),
    }
}

pub fn heartbeat(base: &str, printers: &[String], selected_printer: Option<&str>) -> Result<(), String> {
    let Some(current) = load_credential()? else {
        return Ok(());
    };
    let body = json!({
        "agentVersion": env!("CARGO_PKG_VERSION"),
        "printers": printers,
        "selectedPrinter": selected_printer
    });
    match post_raw(base, "print-devices/heartbeat", Some(&current.access_token), body.clone()) {
        Ok(_) => Ok(()),
        Err(message) if message.contains("disconnected") => {
            delete_credential()?;
            Err(message)
        }
        Err(message) if message.contains("not connected") => {
            refresh_credential(base)?;
            let Some(refreshed) = load_credential()? else {
                return Ok(());
            };
            post_raw(base, "print-devices/heartbeat", Some(&refreshed.access_token), body)?;
            Ok(())
        }
        Err(message) => Err(message),
    }
}

pub fn disconnect(base: &str) -> Result<(), String> {
    if let Some(current) = load_credential()? {
        let _ = post_raw(base, "print-devices/disconnect", Some(&current.access_token), json!({}));
    }
    delete_credential()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimedJob {
    pub job: ClaimJob,
    pub paper_size: Option<String>,
    pub copies: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimJob {
    pub id: String,
    pub printer_name: Option<String>,
}

pub fn claim_job(base: &str) -> Result<Option<ClaimedJob>, String> {
    let Some(current) = load_credential()? else {
        return Ok(None);
    };
    match post_raw(base, "print-devices/jobs/claim", Some(&current.access_token), json!({})) {
        Ok(value) if value.is_null() => Ok(None),
        Ok(value) => serde_json::from_value(value).map_err(|_| "PostBus returned an unexpected response.".to_string()),
        Err(message) if message.contains("not connected") => {
            refresh_credential(base)?;
            let Some(refreshed) = load_credential()? else {
                return Ok(None);
            };
            match post_raw(base, "print-devices/jobs/claim", Some(&refreshed.access_token), json!({})) {
                Ok(value) if value.is_null() => Ok(None),
                Ok(value) => serde_json::from_value(value).map_err(|_| "PostBus returned an unexpected response.".to_string()),
                Err(error) => Err(error),
            }
        }
        Err(message) => Err(message),
    }
}

pub fn job_pdf(base: &str, job_id: &str) -> Result<Vec<u8>, String> {
    let Some(current) = load_credential()? else {
        return Err("This computer is not connected to PostBus.".into());
    };
    get_bytes(base, &format!("print-devices/jobs/{job_id}/pdf"), &current.access_token)
}

pub fn complete_job(base: &str, job_id: &str, status: &str, error_message: Option<&str>) -> Result<(), String> {
    let Some(current) = load_credential()? else {
        return Ok(());
    };
    post_raw(
        base,
        &format!("print-devices/jobs/{job_id}"),
        Some(&current.access_token),
        json!({ "status": status, "errorMessage": error_message }),
    )?;
    Ok(())
}

pub fn computer_name() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Windows PC".into())
}

fn os_label() -> String {
    "Windows".into()
}

fn http_error(error: ureq::Error) -> String {
    match error {
        ureq::Error::Status(status, response) => response
            .into_string()
            .ok()
            .and_then(|text| serde_json::from_str::<Envelope<serde_json::Value>>(&text).ok())
            .map(|envelope| {
                if status == 401 && envelope.message.to_ascii_lowercase().contains("sign in") {
                    "Pairing is not available on this PostBus server yet.".to_string()
                } else {
                    envelope.message
                }
            })
            .unwrap_or_else(|| "PostBus could not complete that request.".into()),
        _ => "Unable to connect to PostBus. Check your internet connection.".into(),
    }
}

fn post<T: for<'de> Deserialize<'de>>(base: &str, path: &str, bearer: Option<&str>, body: serde_json::Value) -> Result<T, String> {
    let value = post_raw(base, path, bearer, body)?;
    serde_json::from_value(value).map_err(|_| "PostBus returned an unexpected response.".to_string())
}

fn get_bytes(base: &str, path: &str, bearer: &str) -> Result<Vec<u8>, String> {
    let url = format!("{base}/api/v1/{path}");
    let mut request = ureq::get(&url).timeout(Duration::from_secs(45));
    request = request.set("Authorization", &format!("Bearer {bearer}"));
    let response = match request.call() {
        Ok(response) => response,
        Err(ureq::Error::Status(status, response)) if (status == 301 || status == 302 || status == 307 || status == 308) => {
            let location = response.header("location").unwrap_or("").to_string();
            if !location.starts_with("https://www.postbus.in/") && !location.starts_with("https://postbus.in/") {
                return Err("PostBus could not complete that request.".into());
            }
            ureq::get(&location)
                .timeout(Duration::from_secs(45))
                .set("Authorization", &format!("Bearer {bearer}"))
                .call()
                .map_err(http_error)?
        }
        Err(error) => return Err(http_error(error)),
    };
    let mut bytes = Vec::new();
    response.into_reader().read_to_end(&mut bytes).map_err(|_| "PostBus could not send the label PDF.".to_string())?;
    Ok(bytes)
}

fn post_raw(base: &str, path: &str, bearer: Option<&str>, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let url = format!("{base}/api/v1/{path}");
    let method = if path.contains("/jobs/") && !path.ends_with("/claim") && !path.ends_with("/pdf") {
        "PATCH"
    } else {
        "POST"
    };
    let mut request = ureq::request(method, &url).timeout(Duration::from_secs(20));
    if let Some(token) = bearer {
        request = request.set("Authorization", &format!("Bearer {token}"));
    }
    let response = match request.send_json(body.clone()) {
        Ok(response) => response,
        Err(ureq::Error::Status(status, response)) if (status == 301 || status == 302 || status == 307 || status == 308) => {
            let location = response.header("location").unwrap_or("").to_string();
            if !location.starts_with("https://www.postbus.in/") && !location.starts_with("https://postbus.in/") {
                return Err("PostBus could not complete that request.".into());
            }
            let mut retry = ureq::post(&location).timeout(Duration::from_secs(20));
            if let Some(token) = bearer {
                retry = retry.set("Authorization", &format!("Bearer {token}"));
            }
            retry.send_json(body).map_err(http_error)?
        }
        Err(error) => return Err(http_error(error)),
    };
    let envelope: Envelope<serde_json::Value> = response.into_json().map_err(|_| "PostBus returned an unexpected response.".to_string())?;
    if envelope.success {
        Ok(envelope.data.unwrap_or(serde_json::Value::Null))
    } else {
        Err(envelope.message)
    }
}

#[cfg(test)]
mod tests {
    use super::api_base;

    #[test]
    fn api_base_defaults_to_postbus_and_allows_local_http() {
        assert_eq!(api_base(None), "https://www.postbus.in");
        assert_eq!(api_base(Some(" https://postbus.in/ ")), "https://www.postbus.in");
        assert_eq!(api_base(Some("http://localhost:3000")), "http://localhost:3000");
        assert_eq!(api_base(Some("http://example.com")), "https://www.postbus.in");
    }
}
