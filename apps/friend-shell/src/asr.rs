//! Shell-side ASR fallback support (W-M6-6).
//!
//! Engine selection already lives in `dsh-friend-asr` (`resolveAsrEngine`,
//! `capabilities()`, endpoint engine). This module only:
//! - publishes the User-Agent that makes `isDesktopShellUserAgent` true
//! - mirrors the both-down guidance string so the injected bridge can show it
//!
//! Do not reimplement webspeech / endpoint engines here.

/// Must match `dsh-friend-asr` `isDesktopShellUserAgent` (`Tauri|dsh-friend-shell|FriendShell`).
pub const SHELL_USER_AGENT: &str = "Mozilla/5.0 dsh-friend-shell/0.1 Tauri/2 FriendShell";

/// Copied from `dsh-friend-asr` `renderEndpointCard` when both engines are down.
pub const ASR_BOTH_DOWN_GUIDANCE: &str =
    "当前环境没有可用识别引擎。请配置 whisper 兼容端点，或等待后续本地识别。";

#[allow(dead_code)]
pub fn asr_shell_guidance(
    webspeech_available: bool,
    endpoint_available: bool,
) -> Option<&'static str> {
    if webspeech_available || endpoint_available {
        None
    } else {
        Some(ASR_BOTH_DOWN_GUIDANCE)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_agent_trips_asr_desktop_shell_detector() {
        let ua = SHELL_USER_AGENT;
        assert!(
            ua.contains("dsh-friend-shell") && ua.contains("Tauri") && ua.contains("FriendShell"),
            "{ua}"
        );
    }

    #[test]
    fn guidance_matrix() {
        assert_eq!(asr_shell_guidance(true, true), None);
        assert_eq!(asr_shell_guidance(true, false), None);
        assert_eq!(asr_shell_guidance(false, true), None);
        assert_eq!(
            asr_shell_guidance(false, false),
            Some(ASR_BOTH_DOWN_GUIDANCE)
        );
        assert!(
            ASR_BOTH_DOWN_GUIDANCE.contains("whisper") || ASR_BOTH_DOWN_GUIDANCE.contains("端点")
        );
    }
}
