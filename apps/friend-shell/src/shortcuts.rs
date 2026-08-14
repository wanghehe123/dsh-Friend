//! Global shortcut register / unregister / reregister.
//!
//! Control flow is a direct translation of Kokoro
//! `src-tauri/src/commands/pet.rs` `register_pet_shortcut`:
//! same-key no-op, unregister the previous key, drop a leftover registration
//! of the new key, then register. The OS backend is injected so unit tests
//! never touch the real `tauri-plugin-global-shortcut` dispatcher.

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShortcutKind {
    Toggle,
    Talk,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShortcutSpec {
    pub toggle: String,
    pub talk: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShortcutError {
    Empty,
    Invalid(String),
    Conflict,
    Backend(String),
}

impl fmt::Display for ShortcutError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => write!(f, "Pet shortcut cannot be empty"),
            Self::Invalid(message) => write!(f, "{message}"),
            Self::Conflict => write!(f, "toggle and talk shortcuts must be different"),
            Self::Backend(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for ShortcutError {}

pub trait ShortcutBackend {
    fn is_registered(&self, shortcut: &str) -> bool;
    fn unregister(&mut self, shortcut: &str) -> Result<(), String>;
    fn register(&mut self, shortcut: &str, kind: ShortcutKind) -> Result<(), String>;
}

#[derive(Debug, Clone, Default)]
pub struct ShortcutRegistry<B> {
    backend: B,
    toggle: Option<String>,
    talk: Option<String>,
}

impl<B> ShortcutRegistry<B> {
    pub fn new(backend: B) -> Self {
        Self {
            backend,
            toggle: None,
            talk: None,
        }
    }

    #[allow(dead_code)]
    pub fn registered_toggle(&self) -> Option<&str> {
        self.toggle.as_deref()
    }

    #[allow(dead_code)]
    pub fn registered_talk(&self) -> Option<&str> {
        self.talk.as_deref()
    }

    #[allow(dead_code)]
    pub fn backend(&self) -> &B {
        &self.backend
    }

    #[allow(dead_code)]
    pub fn backend_mut(&mut self) -> &mut B {
        &mut self.backend
    }
}

impl<B: ShortcutBackend> ShortcutRegistry<B> {
    pub fn apply(&mut self, spec: &ShortcutSpec) -> Result<(), ShortcutError> {
        let toggle = normalize_shortcut(&spec.toggle)?;
        let talk = normalize_shortcut(&spec.talk)?;
        if toggle == talk {
            return Err(ShortcutError::Conflict);
        }
        self.apply_slot(ShortcutKind::Toggle, &toggle)?;
        self.apply_slot(ShortcutKind::Talk, &talk)?;
        Ok(())
    }

    fn apply_slot(&mut self, kind: ShortcutKind, shortcut: &str) -> Result<(), ShortcutError> {
        let current = match kind {
            ShortcutKind::Toggle => self.toggle.clone(),
            ShortcutKind::Talk => self.talk.clone(),
        };

        // Kokoro: same string AND still registered → no-op (repeat toggle is safe).
        if current.as_deref() == Some(shortcut) && self.backend.is_registered(shortcut) {
            return Ok(());
        }

        if let Some(old) = current.as_deref() {
            if old != shortcut {
                match normalize_shortcut(old) {
                    Ok(_) if self.backend.is_registered(old) => {
                        if let Err(error) = self.backend.unregister(old) {
                            // Kokoro warns and continues.
                            let _ = error;
                        }
                    }
                    Ok(_) => {}
                    Err(_) => {}
                }
            }
        }

        if self.backend.is_registered(shortcut) {
            self.backend
                .unregister(shortcut)
                .map_err(ShortcutError::Backend)?;
        }

        self.backend
            .register(shortcut, kind)
            .map_err(ShortcutError::Backend)?;

        match kind {
            ShortcutKind::Toggle => self.toggle = Some(shortcut.to_string()),
            ShortcutKind::Talk => self.talk = Some(shortcut.to_string()),
        }
        Ok(())
    }
}

/// Trim + reject empty, then parse with the same `Shortcut` type Kokoro used.
pub fn normalize_shortcut(raw: &str) -> Result<String, ShortcutError> {
    let shortcut = raw.trim();
    if shortcut.is_empty() {
        return Err(ShortcutError::Empty);
    }
    parse_tauri_shortcut(shortcut)?;
    Ok(shortcut.to_string())
}

fn parse_tauri_shortcut(shortcut: &str) -> Result<(), ShortcutError> {
    shortcut
        .parse::<tauri_plugin_global_shortcut::Shortcut>()
        .map(|_| ())
        .map_err(|error| {
            ShortcutError::Invalid(format!("Invalid pet shortcut '{shortcut}': {error}"))
        })
}

/// Kokoro `auto_start_pet_on_launch` without the tokio sleep (delay is applied
/// by the caller). Dedicated-shell default is visible.
pub fn auto_start_pet_on_launch<F>(enabled: bool, show_pet: F)
where
    F: FnOnce(),
{
    if enabled {
        show_pet();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[derive(Default)]
    struct MockBackend {
        registered: BTreeSet<String>,
        register_calls: Vec<(String, ShortcutKind)>,
        unregister_calls: Vec<String>,
        fail_register: bool,
        fail_unregister: bool,
    }

    impl ShortcutBackend for MockBackend {
        fn is_registered(&self, shortcut: &str) -> bool {
            self.registered.contains(shortcut)
        }

        fn unregister(&mut self, shortcut: &str) -> Result<(), String> {
            self.unregister_calls.push(shortcut.to_string());
            if self.fail_unregister {
                return Err("unregister failed".into());
            }
            self.registered.remove(shortcut);
            Ok(())
        }

        fn register(&mut self, shortcut: &str, kind: ShortcutKind) -> Result<(), String> {
            self.register_calls.push((shortcut.to_string(), kind));
            if self.fail_register {
                return Err("register failed".into());
            }
            self.registered.insert(shortcut.to_string());
            Ok(())
        }
    }

    fn spec(toggle: &str, talk: &str) -> ShortcutSpec {
        ShortcutSpec {
            toggle: toggle.into(),
            talk: talk.into(),
        }
    }

    #[test]
    fn first_apply_registers_both_defaults() {
        let mut registry = ShortcutRegistry::new(MockBackend::default());
        registry
            .apply(&spec("CmdOrCtrl+Shift+Space", "CmdOrCtrl+Shift+M"))
            .expect("apply");
        assert_eq!(registry.registered_toggle(), Some("CmdOrCtrl+Shift+Space"));
        assert_eq!(registry.registered_talk(), Some("CmdOrCtrl+Shift+M"));
        assert_eq!(registry.backend().register_calls.len(), 2);
    }

    #[test]
    fn reapply_same_spec_is_noop() {
        let mut registry = ShortcutRegistry::new(MockBackend::default());
        let spec = spec("CmdOrCtrl+Shift+Space", "CmdOrCtrl+Shift+M");
        registry.apply(&spec).unwrap();
        registry.apply(&spec).unwrap();
        registry.apply(&spec).unwrap();
        assert_eq!(registry.backend().register_calls.len(), 2);
        assert!(registry.backend().unregister_calls.is_empty());
    }

    #[test]
    fn changing_toggle_unregisters_old_and_registers_new() {
        let mut registry = ShortcutRegistry::new(MockBackend::default());
        registry
            .apply(&spec("CmdOrCtrl+Shift+Space", "CmdOrCtrl+Shift+M"))
            .unwrap();
        registry
            .apply(&spec("CmdOrCtrl+Shift+H", "CmdOrCtrl+Shift+M"))
            .unwrap();
        assert_eq!(
            registry.backend().unregister_calls,
            vec!["CmdOrCtrl+Shift+Space".to_string()]
        );
        assert_eq!(registry.registered_toggle(), Some("CmdOrCtrl+Shift+H"));
        assert_eq!(registry.registered_talk(), Some("CmdOrCtrl+Shift+M"));
        assert_eq!(registry.backend().register_calls.len(), 3);
    }

    #[test]
    fn leftover_registration_is_dropped_then_registered() {
        let mut backend = MockBackend::default();
        backend.registered.insert("CmdOrCtrl+Shift+Space".into());
        let mut registry = ShortcutRegistry::new(backend);
        registry
            .apply(&spec("CmdOrCtrl+Shift+Space", "CmdOrCtrl+Shift+M"))
            .unwrap();
        assert_eq!(
            registry
                .backend()
                .unregister_calls
                .first()
                .map(String::as_str),
            Some("CmdOrCtrl+Shift+Space")
        );
        assert!(registry
            .backend()
            .registered
            .contains("CmdOrCtrl+Shift+Space"));
    }

    #[test]
    fn empty_shortcut_is_rejected_and_keeps_previous() {
        let mut registry = ShortcutRegistry::new(MockBackend::default());
        registry
            .apply(&spec("CmdOrCtrl+Shift+Space", "CmdOrCtrl+Shift+M"))
            .unwrap();
        let error = registry
            .apply(&spec("   ", "CmdOrCtrl+Shift+M"))
            .expect_err("empty");
        assert_eq!(error, ShortcutError::Empty);
        assert_eq!(registry.registered_toggle(), Some("CmdOrCtrl+Shift+Space"));
    }

    #[test]
    fn invalid_shortcut_is_rejected() {
        let mut registry = ShortcutRegistry::new(MockBackend::default());
        let error = registry
            .apply(&spec("NotAKey+++", "CmdOrCtrl+Shift+M"))
            .expect_err("invalid");
        assert!(matches!(error, ShortcutError::Invalid(_)));
        assert!(registry.registered_toggle().is_none());
    }

    #[test]
    fn identical_toggle_and_talk_conflict() {
        let mut registry = ShortcutRegistry::new(MockBackend::default());
        let error = registry
            .apply(&spec("CmdOrCtrl+Shift+Space", "CmdOrCtrl+Shift+Space"))
            .expect_err("conflict");
        assert_eq!(error, ShortcutError::Conflict);
    }

    #[test]
    fn failed_reregister_does_not_update_stored_toggle() {
        let mut registry = ShortcutRegistry::new(MockBackend::default());
        registry
            .apply(&spec("CmdOrCtrl+Shift+Space", "CmdOrCtrl+Shift+M"))
            .unwrap();
        registry.backend_mut().fail_register = true;
        let error = registry
            .apply(&spec("CmdOrCtrl+Shift+H", "CmdOrCtrl+Shift+M"))
            .expect_err("backend");
        assert!(matches!(error, ShortcutError::Backend(_)));
        assert_eq!(registry.registered_toggle(), Some("CmdOrCtrl+Shift+Space"));
    }

    #[test]
    fn auto_start_pet_on_launch_calls_show_when_enabled() {
        let mut calls = 0;
        auto_start_pet_on_launch(true, || calls += 1);
        assert_eq!(calls, 1);
    }

    #[test]
    fn auto_start_pet_on_launch_skips_show_when_disabled() {
        let mut calls = 0;
        auto_start_pet_on_launch(false, || calls += 1);
        assert_eq!(calls, 0);
    }
}
