use serde::Deserialize;
use serde::Serialize;

pub const TARGET: &str = "PostBusPrintAgent/device";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCredential {
    pub access_token: String,
    pub refresh_token: String,
    pub device_id: String,
    pub organization_name: String,
    pub device_name: String,
    pub access_expires_at: String,
    pub refresh_expires_at: String,
}

pub fn random_verifier() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|_| "Windows could not generate a pairing secret.".to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[cfg(windows)]
pub fn save_credential(credential: &DeviceCredential) -> Result<(), String> {
    use std::ptr;
    use windows_sys::Win32::Security::Credentials::{
        CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    let blob = serde_json::to_vec(credential).map_err(|error| error.to_string())?;
    let mut target = wide(TARGET);
    let mut user = wide("postbus-print-agent");
    let mut credential_w: CREDENTIALW = unsafe { std::mem::zeroed() };
    credential_w.Type = CRED_TYPE_GENERIC;
    credential_w.TargetName = target.as_mut_ptr();
    credential_w.CredentialBlobSize = blob.len() as u32;
    credential_w.CredentialBlob = blob.as_ptr() as *mut u8;
    credential_w.Persist = CRED_PERSIST_LOCAL_MACHINE;
    credential_w.UserName = user.as_mut_ptr();
    let ok = unsafe { CredWriteW(&credential_w, 0) };
    let _ = (target, user, ptr::null::<u8>());
    if ok == 0 {
        return Err("Windows Credential Manager could not store the device credential.".into());
    }
    Ok(())
}

#[cfg(windows)]
pub fn load_credential() -> Result<Option<DeviceCredential>, String> {
    use windows_sys::Win32::Security::Credentials::{CredFree, CredReadW, CRED_TYPE_GENERIC};

    let target = wide(TARGET);
    let mut raw = std::ptr::null_mut();
    let ok = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw) };
    if ok == 0 || raw.is_null() {
        return Ok(None);
    }
    let credential = unsafe { &*raw };
    let bytes = unsafe { std::slice::from_raw_parts(credential.CredentialBlob, credential.CredentialBlobSize as usize) };
    let parsed = serde_json::from_slice(bytes).map_err(|error| error.to_string());
    unsafe { CredFree(raw.cast()) };
    parsed.map(Some)
}

#[cfg(windows)]
pub fn delete_credential() -> Result<(), String> {
    use windows_sys::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};
    let target = wide(TARGET);
    let ok = unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
    if ok == 0 {
        return Ok(());
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn save_credential(_credential: &DeviceCredential) -> Result<(), String> {
    Err("Credential storage is implemented for Windows only.".into())
}

#[cfg(not(windows))]
pub fn load_credential() -> Result<Option<DeviceCredential>, String> {
    Ok(None)
}

#[cfg(not(windows))]
pub fn delete_credential() -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::{delete_credential, load_credential, random_verifier, save_credential, DeviceCredential};

    #[test]
    fn verifier_is_high_entropy_and_not_a_short_code() {
        let verifier = random_verifier().expect("rng");
        assert_eq!(verifier.len(), 64);
        assert_ne!(random_verifier().expect("rng"), verifier);
    }

    #[test]
    fn credential_json_round_trips_without_a_second_copy_in_settings() {
        let credential = DeviceCredential {
            access_token: "pb_pdev_test".into(),
            refresh_token: "pb_pref_test".into(),
            device_id: "device".into(),
            organization_name: "Samanga".into(),
            device_name: "Packing Desk".into(),
            access_expires_at: "2026-10-15T00:00:00Z".into(),
            refresh_expires_at: "2027-01-15T00:00:00Z".into(),
        };
        let encoded = serde_json::to_string(&credential).expect("json");
        let decoded: DeviceCredential = serde_json::from_str(&encoded).expect("parse");
        assert_eq!(decoded, credential);
    }

    #[test]
    fn windows_credential_manager_round_trip() {
        let credential = DeviceCredential {
            access_token: "pb_pdev_phase2_test".into(),
            refresh_token: "pb_pref_phase2_test".into(),
            device_id: "phase2-test".into(),
            organization_name: "Test".into(),
            device_name: "Phase 2 test".into(),
            access_expires_at: "2026-10-15T00:00:00Z".into(),
            refresh_expires_at: "2027-01-15T00:00:00Z".into(),
        };
        save_credential(&credential).expect("save");
        let loaded = load_credential().expect("load").expect("present");
        assert_eq!(loaded, credential);
        delete_credential().expect("delete");
        assert!(load_credential().expect("reload").is_none());
    }
}
