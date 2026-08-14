//! Tauri wiring: window, tray, shortcuts, probe loop, hosted dsh.

use crate::asr::SHELL_USER_AGENT;
use crate::bridge::initialization_script;
use crate::config::{
    load_from_path, save_to_path, sync_parent_dir, PathResolver, ShellConfig, TalkMode,
    CONFIG_FILE_NAME,
};
use crate::heartbeat::{
    post_heartbeat, sleep_until_stop, tick_heartbeat, HeartbeatLog, HeartbeatMachine,
    HeartbeatPayload, HeartbeatStop, HEARTBEAT_SLEEP_TICK, HEARTBEAT_TIMEOUT,
};
use crate::probe::{probe_http, ProbeMachine, ProbeState, PROBE_TIMEOUT};
use crate::process::{resolve_dsh_command, spawn_hosted, HostedProcess, DSH_LOG_FILE_NAME};
use crate::shortcuts::{
    auto_start_pet_on_launch, normalize_shortcut, ShortcutBackend, ShortcutKind, ShortcutRegistry,
    ShortcutSpec,
};
use mouse_position::mouse_position::Mouse;
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, SystemTime};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{
    AppHandle, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;

pub const PET_WINDOW_LABEL: &str = "pet";

pub struct AppState {
    pub config_path: PathBuf,
    pub config: Mutex<ShellConfig>,
    pub probe: Mutex<ProbeMachine>,
    pub hosted: Mutex<Option<HostedProcess>>,
    pub shortcuts: Mutex<ShortcutRegistry<TauriShortcutBackend>>,
    pub last_ignore: Mutex<Option<bool>>,
    pub showing_pet: Mutex<bool>,
    pub guide_url: Mutex<Option<tauri::Url>>,
    pub save_gen: AtomicU64,
    pub heartbeat_stop: HeartbeatStop,
}

pub struct TauriShortcutBackend {
    app: AppHandle,
}

impl ShortcutBackend for TauriShortcutBackend {
    fn is_registered(&self, shortcut: &str) -> bool {
        shortcut
            .parse::<Shortcut>()
            .map(|parsed| self.app.global_shortcut().is_registered(parsed))
            .unwrap_or(false)
    }

    fn unregister(&mut self, shortcut: &str) -> Result<(), String> {
        let parsed = parse_os_shortcut(shortcut)?;
        self.app
            .global_shortcut()
            .unregister(parsed)
            .map_err(|error| error.to_string())
    }

    fn register(&mut self, shortcut: &str, kind: ShortcutKind) -> Result<(), String> {
        let parsed = parse_os_shortcut(shortcut)?;
        self.app
            .global_shortcut()
            .on_shortcut(parsed, move |app, _shortcut, event| {
                on_global_shortcut(app, kind, event.state());
            })
            .map_err(|error| error.to_string())
    }
}

fn parse_os_shortcut(shortcut: &str) -> Result<Shortcut, String> {
    shortcut
        .parse::<Shortcut>()
        .map_err(|error| format!("{error}"))
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}

fn on_global_shortcut(app: &AppHandle, kind: ShortcutKind, state: ShortcutState) {
    match (kind, state) {
        (ShortcutKind::Toggle, ShortcutState::Pressed) => toggle_pet_window(app),
        (ShortcutKind::Talk, ShortcutState::Pressed) => inject_talk(app, "pressed"),
        (ShortcutKind::Talk, ShortcutState::Released) => {
            let mode = lock(&app.state::<AppState>().config).talk_mode;
            if mode == TalkMode::Hold {
                inject_talk(app, "released");
            }
        }
        _ => {}
    }
}

fn inject_talk(app: &AppHandle, phase: &str) {
    let mode = match lock(&app.state::<AppState>().config).talk_mode {
        TalkMode::Hold => "hold",
        TalkMode::Toggle => "toggle",
    };
    if let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) {
        let _ = win.eval(format!(
            "window.__DSH_FRIEND_SHELL__&&window.__DSH_FRIEND_SHELL__.talk({phase:?},{mode:?})"
        ));
    }
}

fn inject_mute(app: &AppHandle, muted: bool) {
    if let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) {
        let _ = win.eval(format!(
            "window.__DSH_FRIEND_SHELL__&&window.__DSH_FRIEND_SHELL__.applyMute({muted})"
        ));
    }
}

fn toggle_pet_window(app: &AppHandle) {
    let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) else {
        return;
    };
    let visible = win.is_visible().unwrap_or(false);
    if visible {
        let _ = win.hide();
        set_enabled(app, false);
    } else {
        let _ = win.show();
        let _ = win.set_focus();
        set_enabled(app, true);
    }
}

fn set_enabled(app: &AppHandle, enabled: bool) {
    let state = app.state::<AppState>();
    lock(&state.config).enabled = enabled;
    schedule_save(app);
}

fn show_pet_page(app: &AppHandle) {
    let state = app.state::<AppState>();
    if *lock(&state.showing_pet) {
        return;
    }
    let url = lock(&state.config).pet_url();
    let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) else {
        return;
    };
    if let Ok(parsed) = url.parse() {
        if win.navigate(parsed).is_ok() {
            *lock(&state.showing_pet) = true;
        }
    }
}

fn show_guide_page(app: &AppHandle) {
    let state = app.state::<AppState>();
    if !*lock(&state.showing_pet) {
        return;
    }
    let Some(url) = lock(&state.guide_url).clone() else {
        return;
    };
    let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) else {
        return;
    };
    if win.navigate(url).is_ok() {
        *lock(&state.showing_pet) = false;
    }
}

fn schedule_save(app: &AppHandle) {
    let state = app.state::<AppState>();
    let generation = state.save_gen.fetch_add(1, Ordering::Relaxed) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(150));
        let state = app.state::<AppState>();
        if state.save_gen.load(Ordering::Relaxed) != generation {
            return;
        }
        let config = lock(&state.config).clone();
        if let Err(error) = save_to_path(&state.config_path, &config) {
            eprintln!("friend-shell: failed to save {CONFIG_FILE_NAME}: {error}");
        } else {
            let _ = sync_parent_dir(&state.config_path);
        }
    });
}

fn persist_window_frame(app: &AppHandle, win: &WebviewWindow) {
    let state = app.state::<AppState>();
    let mut config = lock(&state.config);
    if let Ok(pos) = win.outer_position() {
        config.position_x = pos.x;
        config.position_y = pos.y;
    }
    if let (Ok(size), Ok(factor)) = (win.inner_size(), win.scale_factor()) {
        let logical = size.to_logical::<u32>(factor);
        config.window_width = logical.width;
        config.window_height = logical.height;
    }
    drop(config);
    schedule_save(app);
}

fn build_pet_window(app: &AppHandle, config: &ShellConfig) -> tauri::Result<WebviewWindow> {
    let (width, height) = config.effective_size();
    let (x, y) = config.effective_position();
    let window =
        WebviewWindowBuilder::new(app, PET_WINDOW_LABEL, WebviewUrl::App("index.html".into()))
            .title("dsh-Friend")
            .inner_size(f64::from(width), f64::from(height))
            .decorations(false)
            .transparent(true)
            .always_on_top(config.always_on_top)
            .skip_taskbar(config.skip_taskbar)
            .resizable(true)
            .shadow(false)
            .visible(false)
            .user_agent(SHELL_USER_AGENT)
            .initialization_script(initialization_script())
            .build()?;
    window.set_position(PhysicalPosition::new(x, y))?;
    Ok(window)
}

fn spec_from_config(config: &ShellConfig) -> ShortcutSpec {
    ShortcutSpec {
        toggle: config.shortcut.clone(),
        talk: config.talk_shortcut.clone(),
    }
}

fn apply_live_config(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let config = lock(&state.config).clone();
    lock(&state.shortcuts)
        .apply(&spec_from_config(&config))
        .map_err(|error| error.to_string())?;
    if let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) {
        let _ = win.set_skip_taskbar(config.skip_taskbar);
        let _ = win.set_always_on_top(config.always_on_top);
        if !config.click_through {
            let _ = win.set_ignore_cursor_events(false);
            *lock(&state.last_ignore) = Some(false);
        }
    }
    sync_autostart(app, config.autostart);
    sync_hosted_process(app);
    Ok(())
}

fn sync_autostart(app: &AppHandle, enabled: bool) {
    let launcher = app.autolaunch();
    let result = if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    };
    if let Err(error) = result {
        eprintln!("friend-shell: autostart: {error}");
    }
}

fn sync_hosted_process(app: &AppHandle) {
    let state = app.state::<AppState>();
    let spawn = lock(&state.config).spawn_dsh;
    let mut hosted = lock(&state.hosted);
    if spawn {
        if hosted.is_some() {
            return;
        }
        let log = state
            .config_path
            .parent()
            .map(|parent| parent.join(DSH_LOG_FILE_NAME))
            .unwrap_or_else(|| PathBuf::from(DSH_LOG_FILE_NAME));
        let path_var = std::env::var("PATH").ok();
        let plan = resolve_dsh_command(path_var.as_deref());
        match spawn_hosted(&plan, &log) {
            Ok(child) => {
                eprintln!(
                    "friend-shell: spawned dsh pid={} log={}",
                    child.id(),
                    child.log_path.display()
                );
                *hosted = Some(child);
            }
            Err(error) => eprintln!("friend-shell: failed to spawn dsh: {error}"),
        }
    } else if let Some(mut child) = hosted.take() {
        let _ = child.stop();
    }
}

fn quit_clean(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.heartbeat_stop.request();
    if let Some(mut child) = lock(&state.hosted).take() {
        let _ = child.stop();
    }
    app.exit(0);
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示/隐藏", true, None::<&str>)?;
    let mute = MenuItem::with_id(app, "mute", "静音", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "打开配置中心", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &mute, &settings, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("bundle icon is required for the tray");
    TrayIconBuilder::with_id("friend-tray")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => toggle_pet_window(app),
            "mute" => {
                let _ = toggle_muted(app.clone());
            }
            "settings" => {
                let _ = open_settings(app.clone());
            }
            "quit" => quit_clean(app),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn spawn_probe_loop(app: AppHandle) {
    let _ = std::thread::Builder::new()
        .name("friend-shell-probe".into())
        .spawn(move || loop {
            let url = lock(&app.state::<AppState>().config).probe_url();
            let ok = probe_http(&url, PROBE_TIMEOUT);
            let (state_now, delay) = {
                let state = app.state::<AppState>();
                let mut machine = lock(&state.probe);
                let now = machine.on_result(ok);
                (now, machine.next_delay())
            };
            match state_now {
                ProbeState::Recovered | ProbeState::Reachable => show_pet_page(&app),
                ProbeState::Unreachable => show_guide_page(&app),
            }
            std::thread::sleep(delay);
        });
}

fn spawn_heartbeat_loop(app: AppHandle) {
    let stop = app.state::<AppState>().heartbeat_stop.clone();
    let _ =
        std::thread::Builder::new()
            .name("friend-shell-heartbeat".into())
            .spawn(move || {
                let mut machine = HeartbeatMachine::new();
                loop {
                    if stop.is_requested() {
                        break;
                    }
                    let connected = matches!(
                        lock(&app.state::<AppState>().probe).state(),
                        ProbeState::Recovered | ProbeState::Reachable
                    );
                    let (delay, log) = tick_heartbeat(&mut machine, connected, || {
                        match HeartbeatPayload::from_process() {
                            Ok(payload) => {
                                let url = lock(&app.state::<AppState>().config).heartbeat_url();
                                post_heartbeat(&url, &payload, HEARTBEAT_TIMEOUT)
                            }
                            Err(_) => false,
                        }
                    });
                    match log {
                        HeartbeatLog::FirstFailure => {
                            eprintln!(
                            "friend-shell: heartbeat failed; backing off (further errors silenced)"
                        );
                        }
                        HeartbeatLog::Restored => {
                            eprintln!("friend-shell: heartbeat restored");
                        }
                        HeartbeatLog::None => {}
                    }
                    if !sleep_until_stop(&stop, delay, HEARTBEAT_SLEEP_TICK) {
                        break;
                    }
                }
            });
}

fn mouse_xy() -> Option<(i32, i32)> {
    match Mouse::get_mouse_position() {
        Mouse::Position { x, y } => Some((x, y)),
        Mouse::Error => None,
    }
}

fn spawn_hit_loop(app: AppHandle) {
    let _ = std::thread::Builder::new()
        .name("friend-shell-hit".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_millis(32));
            let state = app.state::<AppState>();
            let click_through = lock(&state.config).click_through;
            let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) else {
                continue;
            };
            if !click_through {
                if *lock(&state.last_ignore) != Some(false) {
                    let _ = win.set_ignore_cursor_events(false);
                    *lock(&state.last_ignore) = Some(false);
                }
                continue;
            }
            let Some((mx, my)) = mouse_xy() else {
                continue;
            };
            let Ok(pos) = win.outer_position() else {
                continue;
            };
            let Ok(size) = win.outer_size() else {
                continue;
            };
            let factor = win.scale_factor().unwrap_or(1.0);
            let local_x = (f64::from(mx) - f64::from(pos.x)) / factor;
            let local_y = (f64::from(my) - f64::from(pos.y)) / factor;
            let width = f64::from(size.width) / factor;
            let height = f64::from(size.height) / factor;
            let over = local_x >= 0.0 && local_y >= 0.0 && local_x < width && local_y < height;
            let _ = win.eval(format!(
                "window.__DSH_FRIEND_SHELL__&&window.__DSH_FRIEND_SHELL__.probeHit({local_x},{local_y},{over})"
            ));
        });
}

fn spawn_config_watch(app: AppHandle) {
    let path = app.state::<AppState>().config_path.clone();
    let _ = std::thread::Builder::new()
        .name("friend-shell-config".into())
        .spawn(move || {
            let mut last = std::fs::metadata(&path)
                .and_then(|meta| meta.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            loop {
                std::thread::sleep(Duration::from_secs(2));
                let modified = std::fs::metadata(&path)
                    .and_then(|meta| meta.modified())
                    .unwrap_or(last);
                if modified == last {
                    continue;
                }
                last = modified;
                let loaded = load_from_path(&path);
                {
                    let state = app.state::<AppState>();
                    *lock(&state.config) = loaded;
                }
                if let Err(error) = apply_live_config(&app) {
                    eprintln!("friend-shell: reload config: {error}");
                }
            }
        });
}

fn parse_resize_edge(edge: &str) -> bool {
    matches!(
        edge,
        "North" | "South" | "East" | "West" | "NorthEast" | "NorthWest" | "SouthEast" | "SouthWest"
    )
}

#[derive(Debug, Deserialize)]
pub struct HitRectDto {
    #[allow(dead_code)]
    pub x: f64,
    #[allow(dead_code)]
    pub y: f64,
    #[allow(dead_code)]
    pub w: f64,
    #[allow(dead_code)]
    pub h: f64,
}

#[tauri::command]
fn get_shell_config(state: State<'_, AppState>) -> ShellConfig {
    lock(&state.config).clone()
}

#[tauri::command]
fn save_shell_config(app: AppHandle, config: ShellConfig) -> Result<(), String> {
    normalize_shortcut(&config.shortcut).map_err(|error| error.to_string())?;
    normalize_shortcut(&config.talk_shortcut).map_err(|error| error.to_string())?;
    {
        let state = app.state::<AppState>();
        *lock(&state.config) = config.clone();
        save_to_path(&state.config_path, &config).map_err(|error| error.to_string())?;
    }
    apply_live_config(&app)
}

#[tauri::command]
fn retry_probe(app: AppHandle) {
    std::thread::spawn(move || {
        let url = lock(&app.state::<AppState>().config).probe_url();
        let ok = probe_http(&url, PROBE_TIMEOUT);
        let now = lock(&app.state::<AppState>().probe).on_result(ok);
        match now {
            ProbeState::Recovered | ProbeState::Reachable => show_pet_page(&app),
            ProbeState::Unreachable => show_guide_page(&app),
        }
    });
}

#[tauri::command]
fn set_spawn_dsh(app: AppHandle, enabled: bool) -> Result<(), String> {
    {
        let state = app.state::<AppState>();
        lock(&state.config).spawn_dsh = enabled;
        let config = lock(&state.config).clone();
        save_to_path(&state.config_path, &config).map_err(|error| error.to_string())?;
    }
    sync_hosted_process(&app);
    Ok(())
}

#[tauri::command]
fn report_hit_regions(_regions: Vec<HitRectDto>) {
    // Live path is probeHit → set_cursor_ignore. Kept so the pet page can push rects.
}

#[tauri::command]
fn set_cursor_ignore(app: AppHandle, ignore: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let click_through = lock(&state.config).click_through;
    let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) else {
        return Ok(());
    };
    let ignore = click_through && ignore;
    if *lock(&state.last_ignore) == Some(ignore) {
        return Ok(());
    }
    *lock(&state.last_ignore) = Some(ignore);
    win.set_ignore_cursor_events(ignore)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_click_through(app: AppHandle, enabled: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    lock(&state.config).click_through = enabled;
    let config = lock(&state.config).clone();
    save_to_path(&state.config_path, &config).map_err(|error| error.to_string())?;
    if !enabled {
        if let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) {
            let _ = win.set_ignore_cursor_events(false);
        }
        *lock(&state.last_ignore) = Some(false);
    }
    Ok(())
}

#[tauri::command]
fn toggle_muted(app: AppHandle) -> Result<bool, String> {
    let muted = {
        let state = app.state::<AppState>();
        let mut config = lock(&state.config);
        config.muted = !config.muted;
        let muted = config.muted;
        save_to_path(&state.config_path, &config).map_err(|error| error.to_string())?;
        muted
    };
    inject_mute(&app, muted);
    Ok(muted)
}

#[tauri::command]
fn open_settings(app: AppHandle) -> Result<(), String> {
    let url = lock(&app.state::<AppState>().config).settings_url();
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn start_os_drag(app: AppHandle) -> Result<(), String> {
    app.get_webview_window(PET_WINDOW_LABEL)
        .ok_or_else(|| "pet window missing".to_string())?
        .start_dragging()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn start_os_resize(app: AppHandle, edge: String) -> Result<(), String> {
    if !parse_resize_edge(&edge) {
        return Err(format!("invalid resize edge {edge}"));
    }
    let win = app
        .get_webview_window(PET_WINDOW_LABEL)
        .ok_or_else(|| "pet window missing".to_string())?;
    win.eval(format!(
        "window.__TAURI__&&window.__TAURI__.window&&window.__TAURI__.window.getCurrentWindow().startResizeDragging({edge:?})"
    ))
    .map_err(|error| error.to_string())
}

pub fn run() {
    let resolver = PathResolver::from_process_env();
    let config_path = resolver.config_file();
    let startup_config = load_from_path(&config_path);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(Vec::<&str>::new()),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_shell_config,
            save_shell_config,
            retry_probe,
            set_spawn_dsh,
            report_hit_regions,
            set_cursor_ignore,
            set_click_through,
            toggle_muted,
            open_settings,
            start_os_drag,
            start_os_resize,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let backend = TauriShortcutBackend {
                app: handle.clone(),
            };
            let mut registry = ShortcutRegistry::new(backend);
            if let Err(error) = registry.apply(&spec_from_config(&startup_config)) {
                eprintln!("friend-shell: shortcut registration: {error}");
            }

            let enabled = startup_config.enabled;
            app.manage(AppState {
                config_path: config_path.clone(),
                config: Mutex::new(startup_config.clone()),
                probe: Mutex::new(ProbeMachine::new()),
                hosted: Mutex::new(None),
                shortcuts: Mutex::new(registry),
                last_ignore: Mutex::new(None),
                showing_pet: Mutex::new(false),
                guide_url: Mutex::new(None),
                save_gen: AtomicU64::new(0),
                heartbeat_stop: HeartbeatStop::new(),
            });

            let window = build_pet_window(&handle, &startup_config)?;
            if let Ok(url) = window.url() {
                *lock(&handle.state::<AppState>().guide_url) = Some(url);
            }
            let persist_handle = handle.clone();
            window.on_window_event(move |event| {
                if matches!(
                    event,
                    tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
                ) {
                    if let Some(win) = persist_handle.get_webview_window(PET_WINDOW_LABEL) {
                        persist_window_frame(&persist_handle, &win);
                    }
                }
            });

            setup_tray(&handle)?;
            sync_autostart(&handle, startup_config.autostart);
            sync_hosted_process(&handle);

            auto_start_pet_on_launch(enabled, || {
                let _ = window.show();
                let _ = window.set_focus();
            });

            spawn_probe_loop(handle.clone());
            spawn_heartbeat_loop(handle.clone());
            spawn_hit_loop(handle.clone());
            spawn_config_watch(handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("friend-shell failed to start");
}
