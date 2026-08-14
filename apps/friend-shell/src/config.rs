//! `shell-config.json` — field semantics follow Kokoro `pet_config.json`.
//!
//! Production path (mirrors `resolveFriendDataDir` in dsh-friend-shared):
//! 1. `FRIEND_SHELL_CONFIG_PATH` (exact file)
//! 2. `FRIEND_DATA_DIR/shell-config.json`
//! 3. `DSH_HOME/friend/shell-config.json`
//! 4. `<homedir>/.dsh/friend/shell-config.json`
//!
//! Tests MUST inject a temp directory. They never call [`PathResolver::from_process_env`].

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const CONFIG_FILE_NAME: &str = "shell-config.json";
pub const DEFAULT_BASE_URL: &str = "http://127.0.0.1:3080";
pub const DEFAULT_TOGGLE_SHORTCUT: &str = "CmdOrCtrl+Shift+Space";
pub const DEFAULT_TALK_SHORTCUT: &str = "CmdOrCtrl+Shift+M";
pub const DEFAULT_POSITION: i32 = 100;
pub const DEFAULT_WINDOW_WIDTH: u32 = 400;
pub const DEFAULT_WINDOW_HEIGHT: u32 = 600;
pub const MIN_SAVED_SIZE: u32 = 100;

const ENV_CONFIG_PATH: &str = "FRIEND_SHELL_CONFIG_PATH";
const ENV_FRIEND_DATA_DIR: &str = "FRIEND_DATA_DIR";
const ENV_DSH_HOME: &str = "DSH_HOME";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TalkMode {
    #[default]
    Hold,
    Toggle,
}

/// Window / OS preferences. Unknown keys are kept in [`ShellConfig::extra`]
/// so a save cannot drop fields written by a newer shell or the settings UI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ShellConfig {
    /// Visibility remembered across restarts (old `enabled`).
    /// Dedicated shell defaults to visible; Kokoro defaulted to `false`
    /// because the pet was a secondary window of a larger app.
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// Physical pixels (old `move_pet_window` used `PhysicalPosition`).
    #[serde(default = "default_position")]
    pub position_x: i32,
    #[serde(default = "default_position")]
    pub position_y: i32,
    /// Toggle-visibility shortcut. Same default as Kokoro `PetConfig.shortcut`.
    #[serde(default = "default_toggle_shortcut")]
    pub shortcut: String,
    #[serde(default)]
    pub model_url: Option<String>,
    /// Logical CSS pixels (old `resize_pet_window` used `LogicalSize`).
    #[serde(default)]
    pub window_width: u32,
    #[serde(default)]
    pub window_height: u32,
    #[serde(default)]
    pub model_scale: f32,
    #[serde(default = "default_render_fps")]
    pub render_fps: u32,
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default = "default_true")]
    pub skip_taskbar: bool,
    #[serde(default = "default_true")]
    pub always_on_top: bool,
    #[serde(default)]
    pub click_through: bool,
    #[serde(default)]
    pub autostart: bool,
    #[serde(default)]
    pub spawn_dsh: bool,
    #[serde(default = "default_talk_shortcut")]
    pub talk_shortcut: String,
    #[serde(default)]
    pub talk_mode: TalkMode,
    #[serde(default)]
    pub muted: bool,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

fn default_enabled() -> bool {
    true
}

fn default_position() -> i32 {
    DEFAULT_POSITION
}

fn default_toggle_shortcut() -> String {
    DEFAULT_TOGGLE_SHORTCUT.to_string()
}

fn default_talk_shortcut() -> String {
    DEFAULT_TALK_SHORTCUT.to_string()
}

fn default_render_fps() -> u32 {
    60
}

fn default_base_url() -> String {
    DEFAULT_BASE_URL.to_string()
}

fn default_true() -> bool {
    true
}

impl Default for ShellConfig {
    fn default() -> Self {
        Self {
            enabled: default_enabled(),
            position_x: DEFAULT_POSITION,
            position_y: DEFAULT_POSITION,
            shortcut: default_toggle_shortcut(),
            model_url: None,
            window_width: 0,
            window_height: 0,
            model_scale: 0.0,
            render_fps: default_render_fps(),
            base_url: default_base_url(),
            skip_taskbar: true,
            always_on_top: true,
            click_through: false,
            autostart: false,
            spawn_dsh: false,
            talk_shortcut: default_talk_shortcut(),
            talk_mode: TalkMode::Hold,
            muted: false,
            extra: BTreeMap::new(),
        }
    }
}

impl ShellConfig {
    pub fn effective_size(&self) -> (u32, u32) {
        let width = if self.window_width >= MIN_SAVED_SIZE {
            self.window_width
        } else {
            DEFAULT_WINDOW_WIDTH
        };
        let height = if self.window_height >= MIN_SAVED_SIZE {
            self.window_height
        } else {
            DEFAULT_WINDOW_HEIGHT
        };
        (width, height)
    }

    /// `0` means “unset”, same as Kokoro `show_pet_window`.
    pub fn effective_position(&self) -> (i32, i32) {
        let x = if self.position_x != 0 {
            self.position_x
        } else {
            DEFAULT_POSITION
        };
        let y = if self.position_y != 0 {
            self.position_y
        } else {
            DEFAULT_POSITION
        };
        (x, y)
    }

    pub fn trimmed_base(&self) -> &str {
        self.base_url.trim().trim_end_matches('/')
    }

    pub fn probe_url(&self) -> String {
        format!("{}/friend/pet", self.trimmed_base())
    }

    pub fn pet_url(&self) -> String {
        format!("{}/friend/pet?transparent=1&embed=1", self.trimmed_base())
    }

    pub fn settings_url(&self) -> String {
        format!("{}/#/settings", self.trimmed_base())
    }

    pub fn heartbeat_url(&self) -> String {
        format!(
            "{}{}",
            self.trimmed_base(),
            crate::heartbeat::HEARTBEAT_PATH
        )
    }

    #[allow(dead_code)]
    pub fn launch_command() -> &'static str {
        "npx @deepseek-ai/dsh web"
    }
}

#[derive(Debug, Clone, Default)]
pub struct PathResolver {
    pub config_path_override: Option<String>,
    pub friend_data_dir: Option<String>,
    pub dsh_home: Option<String>,
    pub homedir: PathBuf,
}

impl PathResolver {
    /// Production only. Tests construct [`PathResolver`] with a temp `homedir`.
    pub fn from_process_env() -> Self {
        Self {
            config_path_override: env_nonempty(ENV_CONFIG_PATH),
            friend_data_dir: env_nonempty(ENV_FRIEND_DATA_DIR),
            dsh_home: env_nonempty(ENV_DSH_HOME),
            homedir: home_dir(),
        }
    }

    pub fn config_file(&self) -> PathBuf {
        if let Some(path) = self.config_path_override.as_deref() {
            return PathBuf::from(path);
        }
        self.friend_data_root().join(CONFIG_FILE_NAME)
    }

    pub fn friend_data_root(&self) -> PathBuf {
        if let Some(dir) = self.friend_data_dir.as_deref() {
            return PathBuf::from(dir);
        }
        if let Some(home) = self.dsh_home.as_deref() {
            return PathBuf::from(home).join("friend");
        }
        self.homedir.join(".dsh").join("friend")
    }
}

fn env_nonempty(key: &str) -> Option<String> {
    std::env::var(key).ok().and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn backup_path(path: &Path) -> PathBuf {
    let mut bak = path.as_os_str().to_os_string();
    bak.push(".bak");
    PathBuf::from(bak)
}

fn load_file(path: &Path) -> Option<ShellConfig> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Never overwrites a file it cannot parse.
pub fn load_from_path(path: &Path) -> ShellConfig {
    if let Some(config) = load_file(path) {
        return config;
    }
    if let Some(config) = load_file(&backup_path(path)) {
        return config;
    }
    ShellConfig::default()
}

/// Write `tmp` → fsync → rotate `main` to `bak` → rename `tmp` to `main`.
/// A crash leaves either the new file, the previous file, or the `.bak`.
pub fn save_to_path(path: &Path, config: &ShellConfig) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "shell-config path has no parent directory",
        )
    })?;
    fs::create_dir_all(parent)?;

    let body = serde_json::to_vec_pretty(config)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let tmp = parent.join(format!(
        ".{}.{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(CONFIG_FILE_NAME),
        std::process::id(),
        nanos
    ));

    let write_tmp = || -> io::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&tmp)?;
        file.write_all(&body)?;
        file.sync_all()?;
        Ok(())
    };

    if let Err(error) = write_tmp() {
        let _ = fs::remove_file(&tmp);
        return Err(error);
    }

    let bak = backup_path(path);
    if let Err(error) = rotate_and_commit(path, &tmp, &bak) {
        let _ = fs::remove_file(&tmp);
        if !path.exists() && bak.exists() {
            let _ = fs::rename(&bak, path);
        }
        return Err(error);
    }
    Ok(())
}

fn rotate_and_commit(main: &Path, tmp: &Path, bak: &Path) -> io::Result<()> {
    if bak.exists() {
        fs::remove_file(bak)?;
    }
    if main.exists() {
        fs::rename(main, bak)?;
    }
    fs::rename(tmp, main)?;
    Ok(())
}

/// Best-effort fsync of the parent directory after a rename (Unix).
pub fn sync_parent_dir(path: &Path) -> io::Result<()> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    let file = File::open(parent)?;
    file.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn isolated() -> (TempDir, PathBuf) {
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join(CONFIG_FILE_NAME);
        (dir, path)
    }

    #[test]
    fn defaults_match_old_pet_config_semantics() {
        let config = ShellConfig::default();
        assert_eq!(config.position_x, 100);
        assert_eq!(config.position_y, 100);
        assert_eq!(config.shortcut, "CmdOrCtrl+Shift+Space");
        assert_eq!(config.talk_shortcut, "CmdOrCtrl+Shift+M");
        assert_eq!(config.model_url, None);
        assert_eq!(config.window_width, 0);
        assert_eq!(config.window_height, 0);
        assert_eq!(config.model_scale, 0.0);
        assert_eq!(config.render_fps, 60);
        assert!(!config.autostart);
        assert!(!config.spawn_dsh);
        assert!(!config.click_through);
        assert!(config.skip_taskbar);
        assert!(config.always_on_top);
        assert_eq!(config.effective_size(), (400, 600));
        assert_eq!(config.effective_position(), (100, 100));
    }

    #[test]
    fn zero_position_and_tiny_size_use_kokoro_fallbacks() {
        let mut config = ShellConfig::default();
        config.position_x = 0;
        config.position_y = 0;
        config.window_width = 80;
        config.window_height = 99;
        assert_eq!(config.effective_position(), (100, 100));
        assert_eq!(config.effective_size(), (400, 600));
        config.window_width = 100;
        config.window_height = 100;
        assert_eq!(config.effective_size(), (100, 100));
        config.position_x = -20;
        assert_eq!(config.effective_position(), (-20, 100));
    }

    #[test]
    fn missing_file_returns_defaults_and_does_not_create() {
        let (_dir, path) = isolated();
        let loaded = load_from_path(&path);
        assert_eq!(loaded, ShellConfig::default());
        assert!(!path.exists());
    }

    #[test]
    fn roundtrip_preserves_fields() {
        let (_dir, path) = isolated();
        let mut config = ShellConfig::default();
        config.position_x = 320;
        config.position_y = 480;
        config.window_width = 360;
        config.window_height = 640;
        config.model_scale = 1.25;
        config.click_through = true;
        config.talk_mode = TalkMode::Toggle;
        save_to_path(&path, &config).expect("save");
        assert_eq!(load_from_path(&path), config);
    }

    #[test]
    fn corrupt_file_is_not_overwritten_on_load() {
        let (_dir, path) = isolated();
        fs::write(&path, "NOT JSON {{{").expect("seed corrupt");
        let loaded = load_from_path(&path);
        assert_eq!(loaded, ShellConfig::default());
        assert_eq!(fs::read_to_string(&path).expect("read"), "NOT JSON {{{");
    }

    #[test]
    fn unknown_fields_survive_reserialize() {
        let (_dir, path) = isolated();
        fs::write(
            &path,
            r#"{"position_x":12,"future_field":1,"nested":{"a":true}}"#,
        )
        .expect("seed");
        let loaded = load_from_path(&path);
        assert_eq!(loaded.position_x, 12);
        assert_eq!(loaded.extra.get("future_field"), Some(&Value::from(1)));
        save_to_path(&path, &loaded).expect("save");
        let text = fs::read_to_string(&path).expect("read");
        let value: Value = serde_json::from_str(&text).expect("json");
        assert_eq!(value["future_field"], 1);
        assert_eq!(value["nested"]["a"], true);
        assert_eq!(value["position_x"], 12);
    }

    #[test]
    fn save_keeps_previous_copy_as_bak() {
        let (_dir, path) = isolated();
        let mut first = ShellConfig::default();
        first.position_x = 1;
        save_to_path(&path, &first).expect("first");
        let mut second = first.clone();
        second.position_x = 2;
        save_to_path(&path, &second).expect("second");
        assert_eq!(load_from_path(&path).position_x, 2);
        let bak = load_from_path(&backup_path(&path));
        assert_eq!(bak.position_x, 1);
    }

    #[test]
    fn load_falls_back_to_bak_when_main_missing() {
        let (_dir, path) = isolated();
        let mut config = ShellConfig::default();
        config.position_x = 77;
        save_to_path(&path, &config).expect("save");
        let bak = backup_path(&path);
        fs::rename(&path, &bak).expect("simulate crash after rotate");
        assert_eq!(load_from_path(&path).position_x, 77);
    }

    #[test]
    fn failed_tmp_write_leaves_existing_main() {
        let (_dir, path) = isolated();
        let mut config = ShellConfig::default();
        config.position_x = 9;
        save_to_path(&path, &config).expect("seed");
        // Make the parent a file so create_dir_all / tmp create fails on the next save
        // by pointing at a nested path under a file.
        let blocker = path.parent().expect("parent").join("blocker");
        fs::write(&blocker, b"x").expect("blocker");
        let nested = blocker.join(CONFIG_FILE_NAME);
        let _err = save_to_path(&nested, &config).expect_err("save must fail");
        assert_eq!(load_from_path(&path).position_x, 9);
    }

    #[test]
    fn resolver_never_uses_real_home_when_injected() {
        let dir = TempDir::new().expect("tempdir");
        let resolver = PathResolver {
            homedir: dir.path().to_path_buf(),
            ..PathResolver::default()
        };
        let file = resolver.config_file();
        assert!(file.starts_with(dir.path()));
        assert!(file.ends_with(Path::new(".dsh").join("friend").join(CONFIG_FILE_NAME)));
        assert!(!file.starts_with(std::env::var_os("HOME").unwrap_or_default()));
    }

    #[test]
    fn resolver_priority_matches_friend_data_dir() {
        let dir = TempDir::new().expect("tempdir");
        let override_file = dir.path().join("custom.json");
        let friend = dir.path().join("friend-root");
        let dsh = dir.path().join("dsh-home");
        let with_override = PathResolver {
            config_path_override: Some(override_file.to_string_lossy().into_owned()),
            friend_data_dir: Some(friend.to_string_lossy().into_owned()),
            dsh_home: Some(dsh.to_string_lossy().into_owned()),
            homedir: dir.path().to_path_buf(),
        };
        assert_eq!(with_override.config_file(), override_file);

        let with_friend = PathResolver {
            friend_data_dir: Some(friend.to_string_lossy().into_owned()),
            dsh_home: Some(dsh.to_string_lossy().into_owned()),
            homedir: dir.path().to_path_buf(),
            ..PathResolver::default()
        };
        assert_eq!(with_friend.config_file(), friend.join(CONFIG_FILE_NAME));

        let with_dsh = PathResolver {
            dsh_home: Some(dsh.to_string_lossy().into_owned()),
            homedir: dir.path().to_path_buf(),
            ..PathResolver::default()
        };
        assert_eq!(
            with_dsh.config_file(),
            dsh.join("friend").join(CONFIG_FILE_NAME)
        );
    }

    #[test]
    fn pet_and_probe_urls_strip_trailing_slash() {
        let mut config = ShellConfig::default();
        config.base_url = "http://127.0.0.1:3080/".into();
        assert_eq!(config.probe_url(), "http://127.0.0.1:3080/friend/pet");
        assert_eq!(
            config.pet_url(),
            "http://127.0.0.1:3080/friend/pet?transparent=1&embed=1"
        );
        assert_eq!(
            config.heartbeat_url(),
            "http://127.0.0.1:3080/friend/shell/heartbeat"
        );
    }
}
