use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;

static LOG_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

pub fn init(directory: &std::path::Path) {
    let path = directory.join("print-agent.log");
    if let Ok(mut slot) = LOG_PATH.lock() {
        *slot = Some(path);
    }
}

pub fn event(kind: &str, mut fields: serde_json::Value) {
    if !fields.is_object() {
        fields = serde_json::json!({ "detail": redact(&fields.to_string()) });
    }
    if let Some(object) = fields.as_object_mut() {
        for value in object.values_mut() {
            if let Some(text) = value.as_str() {
                *value = serde_json::Value::String(redact(text));
            }
        }
    }
    let line = serde_json::json!({
        "ts": unix_ms(),
        "kind": kind,
        "fields": fields,
    });
    let Ok(serialized) = serde_json::to_string(&line) else {
        return;
    };
    let Ok(guard) = LOG_PATH.lock() else {
        return;
    };
    let Some(path) = guard.as_ref() else {
        return;
    };
    if let Ok(meta) = fs::metadata(path) {
        if meta.len() > MAX_LOG_BYTES {
            let rotated = path.with_extension("log.1");
            let _ = fs::rename(path, rotated);
        }
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{serialized}");
    }
}

pub fn redact(input: &str) -> String {
    let without_tokens = redact_prefixed_secrets(input);
    redact_urls(&without_tokens)
}

fn redact_prefixed_secrets(input: &str) -> String {
    let prefixes = ["pb_pdev_", "pb_pref_", "pb_print_"];
    let mut out = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let mut index = 0;
    while index < chars.len() {
        let rest: String = chars[index..].iter().collect();
        if let Some(prefix) = prefixes.iter().find(|prefix| rest.starts_with(*prefix)) {
            out.push_str(prefix);
            out.push_str("[redacted]");
            index += prefix.chars().count();
            while index < chars.len() {
                let next = chars[index];
                if next.is_ascii_alphanumeric() || next == '_' || next == '-' || next == '.' {
                    index += 1;
                } else {
                    break;
                }
            }
            continue;
        }
        out.push(chars[index]);
        index += 1;
    }
    out
}

fn redact_urls(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut remaining = input;
    while let Some(start) = remaining.find("http://").or_else(|| remaining.find("https://")) {
        out.push_str(&remaining[..start]);
        out.push_str("[redacted-url]");
        let after = &remaining[start..];
        let skip = after.find(char::is_whitespace).unwrap_or(after.len());
        remaining = &after[skip..];
    }
    out.push_str(remaining);
    out
}

fn unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{redact, redact_urls};

    #[test]
    fn redacts_tokens_and_signed_urls() {
        let redacted = redact("Authorization Bearer pb_pdev_abc123-secret more");
        assert!(redacted.contains("pb_pdev_[redacted]"));
        assert!(!redacted.contains("abc123"));
        assert!(redact("refresh pb_pref_zzzz").contains("pb_pref_[redacted]"));
        assert!(!redact("https://storage.example/label.pdf?token=abc").contains("storage.example"));
        assert_eq!(redact_urls("see https://www.postbus.in/x and done"), "see [redacted-url] and done");
    }
}
