//! Desktop-shell heartbeat (W-M6-7).
//!
//! After dsh is reachable the shell POSTs `{version, platform, pid}` to
//! `/friend/shell/heartbeat` every **20 seconds**. The host online window is
//! 90 s; 20 s is inside the 15–30 s contract and leaves four missed beats
//! before the pane flips offline (enough for a brief stall, not a lie).
//!
//! Unreachable dsh: exponential backoff, one log line per outage, then silence.
//! `HeartbeatStop` ends the loop on quit so the thread does not outlive the app.

use crate::probe::parse_http_url;
use serde::Serialize;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Steady interval while heartbeats succeed. See module docs for the 20 s pick.
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(20);
/// Poll while the probe says dsh is down — do not POST, do not log.
pub const HEARTBEAT_OFFLINE_POLL: Duration = Duration::from_secs(1);
pub const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(3);
pub const HEARTBEAT_SLEEP_TICK: Duration = Duration::from_millis(200);
pub const HEARTBEAT_PATH: &str = "/friend/shell/heartbeat";

const BACKOFF_START_MS: u64 = 2_000;
const BACKOFF_CAP_MS: u64 = 30_000;
const VERSION_MAX: usize = 64;
const PID_MAX: u32 = 2_147_483_647;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HeartbeatPayload {
    pub version: String,
    pub platform: String,
    pub pid: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PayloadError {
    Version,
    Platform,
    Pid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeartbeatLog {
    None,
    FirstFailure,
    Restored,
}

/// Shared by the loop thread and `quit_clean`.
#[derive(Debug, Clone)]
pub struct HeartbeatStop {
    inner: Arc<AtomicBool>,
}

impl HeartbeatStop {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn request(&self) {
        self.inner.store(true, Ordering::Relaxed);
    }

    pub fn is_requested(&self) -> bool {
        self.inner.load(Ordering::Relaxed)
    }
}

impl Default for HeartbeatStop {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone)]
pub struct HeartbeatMachine {
    failures: u32,
    announced_down: bool,
}

impl Default for HeartbeatMachine {
    fn default() -> Self {
        Self::new()
    }
}

impl HeartbeatMachine {
    pub fn new() -> Self {
        Self {
            failures: 0,
            announced_down: false,
        }
    }

    #[cfg(test)]
    pub fn failures(&self) -> u32 {
        self.failures
    }

    pub fn on_result(&mut self, ok: bool) -> HeartbeatLog {
        if ok {
            self.failures = 0;
            if self.announced_down {
                self.announced_down = false;
                HeartbeatLog::Restored
            } else {
                HeartbeatLog::None
            }
        } else {
            self.failures = self.failures.saturating_add(1);
            if self.announced_down {
                HeartbeatLog::None
            } else {
                self.announced_down = true;
                HeartbeatLog::FirstFailure
            }
        }
    }

    /// Probe says dsh is gone: stop POSTing and forget the outage so the next
    /// reconnect starts from a clean interval (no leftover backoff).
    pub fn note_disconnected(&mut self) {
        self.failures = 0;
        self.announced_down = false;
    }

    pub fn next_delay(&self) -> Duration {
        if self.failures == 0 {
            return HEARTBEAT_INTERVAL;
        }
        let shift = (self.failures - 1).min(4);
        let ms = BACKOFF_START_MS
            .saturating_mul(1 << shift)
            .min(BACKOFF_CAP_MS);
        Duration::from_millis(ms)
    }
}

/// One scheduler step. `send` runs only while the probe reports connected.
pub fn tick_heartbeat(
    machine: &mut HeartbeatMachine,
    connected: bool,
    send: impl FnOnce() -> bool,
) -> (Duration, HeartbeatLog) {
    if !connected {
        machine.note_disconnected();
        return (HEARTBEAT_OFFLINE_POLL, HeartbeatLog::None);
    }
    let ok = send();
    let log = machine.on_result(ok);
    (machine.next_delay(), log)
}

pub fn version_chars_ok(trimmed: &str) -> bool {
    !trimmed.is_empty()
        && trimmed.len() <= VERSION_MAX
        && trimmed.bytes().all(|byte| {
            matches!(
                byte,
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'.' | b'_' | b'+' | b'-'
            )
        })
}

pub fn map_platform(os: &str) -> Option<&'static str> {
    match os {
        "macos" | "darwin" => Some("darwin"),
        "windows" | "win32" => Some("win32"),
        "linux" => Some("linux"),
        _ => None,
    }
}

pub fn pid_ok(pid: u32) -> bool {
    (1..=PID_MAX).contains(&pid)
}

impl HeartbeatPayload {
    pub fn build(version: &str, os: &str, pid: u32) -> Result<Self, PayloadError> {
        let version = version.trim();
        if !version_chars_ok(version) {
            return Err(PayloadError::Version);
        }
        let platform = map_platform(os).ok_or(PayloadError::Platform)?;
        if !pid_ok(pid) {
            return Err(PayloadError::Pid);
        }
        Ok(Self {
            version: version.to_string(),
            platform: platform.to_string(),
            pid,
        })
    }

    pub fn from_process() -> Result<Self, PayloadError> {
        Self::build(
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS,
            std::process::id(),
        )
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("heartbeat payload is always JSON")
    }
}

pub fn post_heartbeat(url: &str, payload: &HeartbeatPayload, timeout: Duration) -> bool {
    match post_json(url, &payload.to_json(), timeout) {
        Ok(status) => (200..300).contains(&status),
        Err(_) => false,
    }
}

pub fn post_json(url: &str, body: &str, timeout: Duration) -> Result<u16, String> {
    let target = parse_http_url(url).ok_or_else(|| "invalid heartbeat url".to_string())?;
    let addr = (target.host.as_str(), target.port)
        .to_socket_addrs()
        .ok()
        .and_then(|mut addrs| addrs.next())
        .ok_or_else(|| "heartbeat dns failed".to_string())?;
    let mut stream = TcpStream::connect_timeout(&addr, timeout)
        .map_err(|error| format!("heartbeat connect: {error}"))?;
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let request = format!(
        "POST {} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nUser-Agent: dsh-friend-shell\r\n\r\n{body}",
        target.path,
        target.host_header,
        body.len(),
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("heartbeat write: {error}"))?;
    let _ = stream.flush();
    let mut buf = [0_u8; 96];
    let n = match stream.read(&mut buf) {
        Ok(0) | Err(_) => return Err("heartbeat empty response".into()),
        Ok(n) => n,
    };
    parse_http_status(&buf[..n]).ok_or_else(|| "heartbeat bad status line".to_string())
}

fn parse_http_status(head: &[u8]) -> Option<u16> {
    let text = std::str::from_utf8(head).ok()?;
    let line = text.split(['\r', '\n']).next()?;
    let mut parts = line.split_whitespace();
    let proto = parts.next()?;
    if !proto.starts_with("HTTP/") {
        return None;
    }
    parts.next()?.parse().ok()
}

/// Sleep `total` in small ticks so quit can stop the thread without waiting
/// out a full 20 s interval. Returns `false` when stop was requested.
pub fn sleep_until_stop(stop: &HeartbeatStop, total: Duration, tick: Duration) -> bool {
    if stop.is_requested() {
        return false;
    }
    if total.is_zero() {
        return true;
    }
    let start = std::time::Instant::now();
    loop {
        if stop.is_requested() {
            return false;
        }
        let remaining = total.saturating_sub(start.elapsed());
        if remaining.is_zero() {
            return !stop.is_requested();
        }
        std::thread::sleep(remaining.min(tick));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::io::Write;
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};
    use std::thread;

    #[test]
    fn payload_accepts_contract_fields() {
        let payload = HeartbeatPayload::build("0.1.0", "macos", 4242).expect("ok");
        assert_eq!(payload.version, "0.1.0");
        assert_eq!(payload.platform, "darwin");
        assert_eq!(payload.pid, 4242);
    }

    #[test]
    fn payload_trims_version() {
        let payload = HeartbeatPayload::build("  0.1.0-rc.1  ", "linux", 1).expect("ok");
        assert_eq!(payload.version, "0.1.0-rc.1");
        assert_eq!(payload.platform, "linux");
    }

    #[test]
    fn payload_maps_windows_to_win32() {
        let payload = HeartbeatPayload::build("1.0.0", "windows", 7).expect("ok");
        assert_eq!(payload.platform, "win32");
    }

    #[test]
    fn payload_accepts_already_mapped_platform_names() {
        assert_eq!(
            HeartbeatPayload::build("1", "darwin", 1)
                .expect("ok")
                .platform,
            "darwin"
        );
        assert_eq!(
            HeartbeatPayload::build("1", "win32", 1)
                .expect("ok")
                .platform,
            "win32"
        );
    }

    #[test]
    fn payload_rejects_bad_version_platform_pid() {
        assert_eq!(
            HeartbeatPayload::build("", "darwin", 1),
            Err(PayloadError::Version)
        );
        assert_eq!(
            HeartbeatPayload::build("   ", "darwin", 1),
            Err(PayloadError::Version)
        );
        assert_eq!(
            HeartbeatPayload::build("has space", "darwin", 1),
            Err(PayloadError::Version)
        );
        assert_eq!(
            HeartbeatPayload::build(&"v".repeat(65), "darwin", 1),
            Err(PayloadError::Version)
        );
        assert_eq!(
            HeartbeatPayload::build("0.1.0", "android", 1),
            Err(PayloadError::Platform)
        );
        assert_eq!(
            HeartbeatPayload::build("0.1.0", "darwin", 0),
            Err(PayloadError::Pid)
        );
    }

    #[test]
    fn payload_json_is_exactly_three_fields() {
        let payload = HeartbeatPayload::build("0.1.0", "darwin", 99).expect("ok");
        let value: Value = serde_json::from_str(&payload.to_json()).expect("json");
        let object = value.as_object().expect("object");
        assert_eq!(object.len(), 3);
        assert_eq!(object["version"], "0.1.0");
        assert_eq!(object["platform"], "darwin");
        assert_eq!(object["pid"], 99);
        assert!(!payload.to_json().contains("token"));
    }

    #[test]
    fn from_process_matches_this_binary() {
        let payload = HeartbeatPayload::from_process().expect("supported os");
        assert_eq!(payload.version, env!("CARGO_PKG_VERSION"));
        assert!(version_chars_ok(&payload.version));
        assert!(matches!(
            payload.platform.as_str(),
            "darwin" | "win32" | "linux"
        ));
        assert!(pid_ok(payload.pid));
        assert_eq!(payload.pid, std::process::id());
    }

    #[test]
    fn success_interval_is_twenty_seconds() {
        let mut machine = HeartbeatMachine::new();
        assert_eq!(machine.next_delay(), Duration::from_secs(20));
        assert_eq!(machine.on_result(true), HeartbeatLog::None);
        assert_eq!(machine.next_delay(), Duration::from_secs(20));
    }

    #[test]
    fn backoff_grows_then_caps_and_resets() {
        let mut machine = HeartbeatMachine::new();
        assert_eq!(machine.on_result(false), HeartbeatLog::FirstFailure);
        assert_eq!(machine.next_delay(), Duration::from_secs(2));
        assert_eq!(machine.on_result(false), HeartbeatLog::None);
        assert_eq!(machine.next_delay(), Duration::from_secs(4));
        machine.on_result(false);
        assert_eq!(machine.next_delay(), Duration::from_secs(8));
        machine.on_result(false);
        assert_eq!(machine.next_delay(), Duration::from_secs(16));
        machine.on_result(false);
        assert_eq!(machine.next_delay(), Duration::from_secs(30));
        machine.on_result(false);
        assert_eq!(machine.next_delay(), Duration::from_secs(30));
        assert_eq!(machine.on_result(true), HeartbeatLog::Restored);
        assert_eq!(machine.failures(), 0);
        assert_eq!(machine.next_delay(), Duration::from_secs(20));
    }

    #[test]
    fn tick_does_not_send_when_disconnected() {
        let mut machine = HeartbeatMachine::new();
        machine.on_result(false);
        let sent = Arc::new(Mutex::new(false));
        let sent_flag = sent.clone();
        let (delay, log) = tick_heartbeat(&mut machine, false, move || {
            *sent_flag.lock().expect("lock") = true;
            true
        });
        assert_eq!(delay, HEARTBEAT_OFFLINE_POLL);
        assert_eq!(log, HeartbeatLog::None);
        assert!(!*sent.lock().expect("lock"));
        assert_eq!(machine.failures(), 0);
        assert_eq!(machine.next_delay(), HEARTBEAT_INTERVAL);
    }

    #[test]
    fn tick_sends_when_connected_and_backs_off_on_failure() {
        let mut machine = HeartbeatMachine::new();
        let (delay, log) = tick_heartbeat(&mut machine, true, || false);
        assert_eq!(log, HeartbeatLog::FirstFailure);
        assert_eq!(delay, Duration::from_secs(2));
        let (delay, log) = tick_heartbeat(&mut machine, true, || false);
        assert_eq!(log, HeartbeatLog::None);
        assert_eq!(delay, Duration::from_secs(4));
        let (delay, log) = tick_heartbeat(&mut machine, true, || true);
        assert_eq!(log, HeartbeatLog::Restored);
        assert_eq!(delay, HEARTBEAT_INTERVAL);
    }

    #[test]
    fn stop_flag_ends_sleep_immediately() {
        let stop = HeartbeatStop::new();
        stop.request();
        assert!(!sleep_until_stop(
            &stop,
            Duration::from_secs(30),
            Duration::from_millis(50)
        ));
    }

    #[test]
    fn sleep_completes_when_not_stopped() {
        let stop = HeartbeatStop::new();
        assert!(sleep_until_stop(
            &stop,
            Duration::from_millis(30),
            Duration::from_millis(10)
        ));
        assert!(!stop.is_requested());
    }

    #[test]
    fn post_heartbeat_posts_contract_body() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let seen = Arc::new(Mutex::new(String::new()));
        let seen_thread = seen.clone();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut buf = vec![0_u8; 1024];
            let n = stream.read(&mut buf).unwrap_or(0);
            *seen_thread.lock().expect("lock") = String::from_utf8_lossy(&buf[..n]).into_owned();
            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\n{\"ok\":true}");
        });
        let payload = HeartbeatPayload::build("0.1.0", "darwin", 4242).expect("ok");
        let url = format!("http://127.0.0.1:{port}{HEARTBEAT_PATH}");
        assert!(post_heartbeat(&url, &payload, Duration::from_secs(2)));
        let request = seen.lock().expect("lock").clone();
        assert!(request.starts_with("POST /friend/shell/heartbeat HTTP/1.1"));
        assert!(request.contains("Content-Type: application/json"));
        assert!(request.contains("{\"version\":\"0.1.0\",\"platform\":\"darwin\",\"pid\":4242}"));
    }

    #[test]
    fn post_heartbeat_false_on_400_and_closed_port() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut buf = [0_u8; 256];
            let _ = stream.read(&mut buf);
            let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
        });
        let payload = HeartbeatPayload::build("0.1.0", "linux", 1).expect("ok");
        let url = format!("http://127.0.0.1:{port}{HEARTBEAT_PATH}");
        assert!(!post_heartbeat(&url, &payload, Duration::from_secs(2)));
        assert!(!post_heartbeat(
            "http://127.0.0.1:1/friend/shell/heartbeat",
            &payload,
            Duration::from_millis(200)
        ));
    }
}
