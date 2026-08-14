//! Connection probe state machine (W-M6-2).
//!
//! Three states: `Unreachable` / `Recovered` / `Reachable`.
//! HTTP GET `{base}/friend/pet` with a 3 s timeout; retry uses capped backoff
//! so a freshly started dsh is picked up within the spec's 5 s window.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::Duration;

pub const PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const BACKOFF_START_MS: u64 = 500;
const BACKOFF_CAP_MS: u64 = 2000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeState {
    Unreachable,
    Recovered,
    Reachable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpTarget {
    pub host: String,
    pub port: u16,
    pub path: String,
    pub host_header: String,
}

#[derive(Debug, Clone)]
pub struct ProbeMachine {
    state: ProbeState,
    failures: u32,
}

impl Default for ProbeMachine {
    fn default() -> Self {
        Self::new()
    }
}

impl ProbeMachine {
    pub fn new() -> Self {
        Self {
            state: ProbeState::Unreachable,
            failures: 0,
        }
    }

    pub fn state(&self) -> ProbeState {
        self.state
    }

    pub fn on_result(&mut self, ok: bool) -> ProbeState {
        if ok {
            self.failures = 0;
            self.state = match self.state {
                ProbeState::Unreachable => ProbeState::Recovered,
                ProbeState::Recovered | ProbeState::Reachable => ProbeState::Reachable,
            };
        } else {
            self.failures = self.failures.saturating_add(1);
            self.state = ProbeState::Unreachable;
        }
        self.state
    }

    pub fn next_delay(&self) -> Duration {
        if self.failures == 0 {
            return Duration::from_millis(BACKOFF_START_MS);
        }
        let shift = (self.failures - 1).min(3);
        let ms = BACKOFF_START_MS
            .saturating_mul(1 << shift)
            .min(BACKOFF_CAP_MS);
        Duration::from_millis(ms)
    }
}

pub fn parse_http_url(url: &str) -> Option<HttpTarget> {
    let rest = url.strip_prefix("http://")?;
    let (authority, path) = match rest.split_once('/') {
        Some((authority, path)) => (authority, format!("/{path}")),
        None => (rest, "/".to_string()),
    };
    if authority.is_empty() {
        return None;
    }
    let (host, port) = if let Some(inner) = authority.strip_prefix('[') {
        let (host, tail) = inner.split_once(']')?;
        let port = match tail.strip_prefix(':') {
            Some(port) => port.parse().ok()?,
            None if tail.is_empty() => 80,
            None => return None,
        };
        (host.to_string(), port)
    } else if let Some((host, port)) = authority.rsplit_once(':') {
        (host.to_string(), port.parse().ok()?)
    } else {
        (authority.to_string(), 80)
    };
    if host.is_empty() {
        return None;
    }
    Some(HttpTarget {
        host,
        port,
        path,
        host_header: authority.to_string(),
    })
}

pub fn probe_http(url: &str, timeout: Duration) -> bool {
    let Some(target) = parse_http_url(url) else {
        return false;
    };
    let addr = match (target.host.as_str(), target.port).to_socket_addrs() {
        Ok(mut addrs) => addrs.next(),
        Err(_) => None,
    };
    let Some(addr) = addr else {
        return false;
    };
    probe_addr(&target, addr, timeout)
}

fn probe_addr(target: &HttpTarget, addr: SocketAddr, timeout: Duration) -> bool {
    let mut stream = match TcpStream::connect_timeout(&addr, timeout) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let request = format!(
        "GET {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\nUser-Agent: dsh-friend-shell\r\n\r\n",
        target.path, target.host_header
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let _ = stream.flush();
    let mut buf = [0_u8; 96];
    let n = match stream.read(&mut buf) {
        Ok(0) | Err(_) => return false,
        Ok(n) => n,
    };
    let head = String::from_utf8_lossy(&buf[..n]);
    head.starts_with("HTTP/1.1 2") || head.starts_with("HTTP/1.0 2")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn starts_unreachable() {
        assert_eq!(ProbeMachine::new().state(), ProbeState::Unreachable);
    }

    #[test]
    fn fail_stays_unreachable() {
        let mut machine = ProbeMachine::new();
        assert_eq!(machine.on_result(false), ProbeState::Unreachable);
        assert_eq!(machine.on_result(false), ProbeState::Unreachable);
    }

    #[test]
    fn unreachable_then_ok_is_recovered() {
        let mut machine = ProbeMachine::new();
        machine.on_result(false);
        assert_eq!(machine.on_result(true), ProbeState::Recovered);
    }

    #[test]
    fn recovered_then_ok_is_reachable() {
        let mut machine = ProbeMachine::new();
        machine.on_result(true);
        assert_eq!(machine.on_result(true), ProbeState::Reachable);
        assert_eq!(machine.on_result(true), ProbeState::Reachable);
    }

    #[test]
    fn reachable_then_fail_is_unreachable() {
        let mut machine = ProbeMachine::new();
        machine.on_result(true);
        machine.on_result(true);
        assert_eq!(machine.on_result(false), ProbeState::Unreachable);
    }

    #[test]
    fn recovered_then_fail_is_unreachable() {
        let mut machine = ProbeMachine::new();
        machine.on_result(true);
        assert_eq!(machine.on_result(false), ProbeState::Unreachable);
    }

    #[test]
    fn backoff_grows_then_caps_under_two_seconds() {
        let mut machine = ProbeMachine::new();
        assert_eq!(machine.next_delay(), Duration::from_millis(500));
        machine.on_result(false);
        assert_eq!(machine.next_delay(), Duration::from_millis(500));
        machine.on_result(false);
        assert_eq!(machine.next_delay(), Duration::from_millis(1000));
        machine.on_result(false);
        assert_eq!(machine.next_delay(), Duration::from_millis(2000));
        machine.on_result(false);
        assert_eq!(machine.next_delay(), Duration::from_millis(2000));
        machine.on_result(true);
        assert_eq!(machine.next_delay(), Duration::from_millis(500));
    }

    #[test]
    fn parse_ipv4_and_ipv6_urls() {
        let v4 = parse_http_url("http://127.0.0.1:3080/friend/pet").expect("v4");
        assert_eq!(v4.host, "127.0.0.1");
        assert_eq!(v4.port, 3080);
        assert_eq!(v4.path, "/friend/pet");
        let v6 = parse_http_url("http://[::1]:3080/friend/pet").expect("v6");
        assert_eq!(v6.host, "::1");
        assert_eq!(v6.port, 3080);
        assert!(parse_http_url("https://example.com/x").is_none());
        assert!(parse_http_url("not-a-url").is_none());
    }

    #[test]
    fn probe_http_success_against_local_server() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut buf = [0_u8; 256];
            let _ = stream.read(&mut buf);
            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK");
        });
        let url = format!("http://127.0.0.1:{port}/friend/pet");
        assert!(probe_http(&url, Duration::from_secs(2)));
    }

    #[test]
    fn probe_http_rejects_non_2xx() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut buf = [0_u8; 256];
            let _ = stream.read(&mut buf);
            let _ =
                stream.write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n");
        });
        let url = format!("http://127.0.0.1:{port}/friend/pet");
        assert!(!probe_http(&url, Duration::from_secs(2)));
    }

    #[test]
    fn probe_http_times_out_on_silent_peer() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        thread::spawn(move || {
            let (_stream, _) = listener.accept().expect("accept");
            thread::sleep(Duration::from_secs(2));
        });
        let url = format!("http://127.0.0.1:{port}/friend/pet");
        assert!(!probe_http(&url, Duration::from_millis(200)));
    }

    #[test]
    fn probe_http_false_on_closed_port() {
        assert!(!probe_http(
            "http://127.0.0.1:1/friend/pet",
            Duration::from_millis(200)
        ));
    }
}
