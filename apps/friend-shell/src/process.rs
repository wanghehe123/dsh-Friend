//! Optional hosted `dsh web` child (W-M6-2). Default off.
//! Tests spawn a short-lived local binary and never touch a real dsh profile.

use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

pub const DSH_LOG_FILE_NAME: &str = "shell-dsh.log";

#[derive(Debug)]
pub struct HostedProcess {
    child: Child,
    pub log_path: PathBuf,
}

impl HostedProcess {
    pub fn id(&self) -> u32 {
        self.child.id()
    }

    #[allow(dead_code)]
    pub fn try_wait(&mut self) -> io::Result<Option<std::process::ExitStatus>> {
        self.child.try_wait()
    }

    pub fn stop(&mut self) -> io::Result<()> {
        let _ = self.child.kill();
        let _ = self.child.wait();
        Ok(())
    }
}

impl Drop for HostedProcess {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpawnPlan {
    pub program: String,
    pub args: Vec<String>,
}

/// Prefer a `dsh` on PATH; otherwise `npx --yes @deepseek-ai/dsh web`.
pub fn resolve_dsh_command(path_var: Option<&str>) -> SpawnPlan {
    if command_exists("dsh", path_var) {
        return SpawnPlan {
            program: "dsh".into(),
            args: vec!["web".into()],
        };
    }
    SpawnPlan {
        program: "npx".into(),
        args: vec!["--yes".into(), "@deepseek-ai/dsh".into(), "web".into()],
    }
}

pub fn command_exists(name: &str, path_var: Option<&str>) -> bool {
    let Some(raw) = path_var else {
        return false;
    };
    std::env::split_paths(raw).any(|dir| {
        let unix = dir.join(name);
        let windows = dir.join(format!("{name}.exe"));
        unix.is_file() || windows.is_file()
    })
}

pub fn spawn_hosted(plan: &SpawnPlan, log_path: &Path) -> io::Result<HostedProcess> {
    if let Some(parent) = log_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let log = open_log(log_path)?;
    let err = log.try_clone()?;
    let mut command = Command::new(&plan.program);
    command
        .args(&plan.args)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(err));
    apply_no_window(&mut command);
    let child = command.spawn()?;
    Ok(HostedProcess {
        child,
        log_path: log_path.to_path_buf(),
    })
}

fn open_log(path: &Path) -> io::Result<File> {
    OpenOptions::new().create(true).append(true).open(path)
}

#[cfg(windows)]
fn apply_no_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn apply_no_window(_command: &mut Command) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;
    use tempfile::TempDir;

    #[test]
    fn resolve_falls_back_to_npx_when_dsh_missing() {
        let plan = resolve_dsh_command(Some("/definitely-missing-dsh-bin"));
        assert_eq!(plan.program, "npx");
        assert_eq!(plan.args, vec!["--yes", "@deepseek-ai/dsh", "web"]);
    }

    #[test]
    fn resolve_uses_dsh_when_present_on_injected_path() {
        let dir = TempDir::new().expect("tempdir");
        let stub = if cfg!(windows) {
            dir.path().join("dsh.exe")
        } else {
            dir.path().join("dsh")
        };
        std::fs::write(&stub, b"#!/bin/sh\n").expect("stub");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&stub).unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&stub, perms).unwrap();
        }
        let plan = resolve_dsh_command(Some(dir.path().to_str().unwrap()));
        assert_eq!(plan.program, "dsh");
        assert_eq!(plan.args, vec!["web"]);
    }

    #[cfg(unix)]
    #[test]
    fn hosted_process_writes_log_and_dies_on_stop() {
        let dir = TempDir::new().expect("tempdir");
        let log = dir.path().join(DSH_LOG_FILE_NAME);
        let plan = SpawnPlan {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), "echo hosted-ok; sleep 30".into()],
        };
        let mut child = spawn_hosted(&plan, &log).expect("spawn");
        let pid = child.id();
        thread::sleep(Duration::from_millis(80));
        child.stop().expect("stop");
        thread::sleep(Duration::from_millis(40));
        let text = std::fs::read_to_string(&log).expect("log");
        assert!(text.contains("hosted-ok"), "log was {text:?}");
        assert!(!pid_is_alive(pid), "child {pid} still alive after stop");
    }

    #[cfg(unix)]
    fn pid_is_alive(pid: u32) -> bool {
        let status = Command::new("/bin/kill")
            .args(["-0", &pid.to_string()])
            .status();
        matches!(status, Ok(s) if s.success())
    }
}
