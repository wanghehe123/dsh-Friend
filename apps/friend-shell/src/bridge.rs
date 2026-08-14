//! Injected into every pet / guide navigation. Window-level only:
//! hit probe, hold-to-talk dispatch, eight-way resize, right-drag.
//! Does not render Live2D or run ASR engines.

use crate::asr::ASR_BOTH_DOWN_GUIDANCE;

pub fn initialization_script() -> String {
    format!(
        r#"(function () {{
  if (window.__DSH_FRIEND_SHELL__) return;
  var GUIDANCE = {guidance};
  var invoke = function (cmd, args) {{
    var core = window.__TAURI__ && window.__TAURI__.core;
    if (core && typeof core.invoke === 'function') {{
      return core.invoke(cmd, args || {{}});
    }}
    return Promise.resolve();
  }};
  var shownGuidance = false;
  var lastIgnore = null;

  function overChrome(x, y) {{
    var el = document.elementFromPoint(x, y);
    if (!el) return false;
    if (el.closest('button, input, textarea, a, label, .installer, .bubble, .toolbar, [data-friend-bubble], [data-friend-shell-guide-card], .shell-asr-guide')) {{
      return true;
    }}
    return false;
  }}

  function modelHits(x, y) {{
    var pet = window.__DSH_FRIEND_PET__;
    if (!pet || typeof pet.hitTest !== 'function') return [];
    try {{
      var hits = pet.hitTest(x, y);
      return Array.isArray(hits) ? hits : [];
    }} catch (e) {{
      return [];
    }}
  }}

  function setIgnore(ignore) {{
    if (lastIgnore === ignore) return;
    lastIgnore = ignore;
    invoke('set_cursor_ignore', {{ ignore: ignore }});
  }}

  function probeHit(x, y, overWindow) {{
    if (document.documentElement.hasAttribute('data-friend-shell-guide')) {{
      setIgnore(false);
      return;
    }}
    if (overWindow === false) {{
      setIgnore(true);
      return;
    }}
    var chrome = overChrome(x, y);
    var hits = modelHits(x, y);
    setIgnore(!(chrome || hits.length > 0));
  }}

  function showGuidanceOnce() {{
    if (shownGuidance) return;
    shownGuidance = true;
    var host = document.createElement('div');
    host.className = 'shell-asr-guide';
    host.setAttribute('role', 'status');
    host.textContent = GUIDANCE;
    host.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483646;padding:10px 12px;border-radius:12px;background:rgba(15,23,42,.92);color:#e2e8f0;font:13px/1.5 system-ui,sans-serif;pointer-events:auto;';
    document.documentElement.appendChild(host);
    setTimeout(function () {{ host.remove(); }}, 12000);
  }}

  function talk(phase, mode) {{
    try {{
      window.dispatchEvent(new CustomEvent('dsh-friend:shell-talk', {{ detail: {{ phase: phase, mode: mode || 'hold' }} }}));
    }} catch (e) {{}}
    var asr = window.__DSH_FRIEND_ASR__;
    if (asr && asr.session && typeof asr.session.dispatch === 'function') {{
      asr.session.dispatch({{ type: phase === 'pressed' ? 'hotkey-down' : 'hotkey-up' }});
      return;
    }}
    var voice = document.getElementById('friend-voice');
    if (voice && !voice.hidden) {{
      voice.dispatchEvent(new PointerEvent(phase === 'pressed' ? 'pointerdown' : 'pointerup', {{ bubbles: true }}));
      return;
    }}
    var Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech && phase === 'pressed') {{
      showGuidanceOnce();
    }}
  }}

  function applyMute(muted) {{
    try {{
      window.dispatchEvent(new CustomEvent(muted ? 'dsh-friend:mute' : 'dsh-friend:unmute'));
    }} catch (e) {{}}
    try {{
      var playback = window.__DSH_FRIEND_PLAYBACK__;
      if (playback && typeof playback.setMuted === 'function') playback.setMuted(muted);
      var tts = window.__DSH_FRIEND_TTS__;
      if (muted && tts && typeof tts.stopAll === 'function') tts.stopAll();
      var stopAll = window.__dshFriendStopAllTts__;
      if (muted && typeof stopAll === 'function') stopAll();
      if (muted && window.speechSynthesis) window.speechSynthesis.cancel();
      document.querySelectorAll('audio,video').forEach(function (el) {{
        if (muted) {{ el.pause(); el.muted = true; }}
        else {{ el.muted = false; }}
      }});
    }} catch (e) {{}}
  }}

  function currentWindow() {{
    var api = window.__TAURI__ && window.__TAURI__.window;
    if (api && typeof api.getCurrentWindow === 'function') return api.getCurrentWindow();
    return null;
  }}

  function detectEdge(event) {{
    var edge = 8;
    var w = window.innerWidth;
    var h = window.innerHeight;
    var x = event.clientX;
    var y = event.clientY;
    var nearLeft = x <= edge;
    var nearRight = x >= w - edge;
    var nearTop = y <= edge;
    var nearBottom = y >= h - edge;
    if (nearTop && nearLeft) return 'NorthWest';
    if (nearTop && nearRight) return 'NorthEast';
    if (nearBottom && nearLeft) return 'SouthWest';
    if (nearBottom && nearRight) return 'SouthEast';
    if (nearTop) return 'North';
    if (nearBottom) return 'South';
    if (nearLeft) return 'West';
    if (nearRight) return 'East';
    return null;
  }}

  var cursors = {{
    North: 'ns-resize', South: 'ns-resize', East: 'ew-resize', West: 'ew-resize',
    NorthEast: 'nesw-resize', NorthWest: 'nwse-resize', SouthEast: 'nwse-resize', SouthWest: 'nesw-resize'
  }};

  document.addEventListener('mousemove', function (event) {{
    var edge = detectEdge(event);
    document.body.style.cursor = edge ? cursors[edge] : '';
    probeHit(event.clientX, event.clientY, true);
  }}, true);

  document.addEventListener('mousedown', function (event) {{
    var edge = detectEdge(event);
    if (edge && event.button === 0) {{
      event.preventDefault();
      var win = currentWindow();
      if (win && typeof win.startResizeDragging === 'function') {{
        win.startResizeDragging(edge).catch(function () {{ invoke('start_os_resize', {{ edge: edge }}); }});
      }} else {{
        invoke('start_os_resize', {{ edge: edge }});
      }}
      return;
    }}
    if (event.button === 2) {{
      var win = currentWindow();
      if (win && typeof win.startDragging === 'function') {{
        win.startDragging().catch(function () {{ invoke('start_os_drag'); }});
      }} else {{
        invoke('start_os_drag');
      }}
    }}
  }}, true);

  document.addEventListener('contextmenu', function (event) {{
    event.preventDefault();
  }}, true);

  window.addEventListener('dsh-friend:hit', function (event) {{
    var hits = event && event.detail && event.detail.hits;
    if (Array.isArray(hits)) {{
      setIgnore(hits.length === 0 && !overChrome(event.clientX || 0, event.clientY || 0));
    }}
  }});

  window.__DSH_FRIEND_SHELL__ = {{
    probeHit: probeHit,
    talk: talk,
    applyMute: applyMute,
    showGuidanceOnce: showGuidanceOnce
  }};
}})();"#,
        guidance = serde_json::to_string(ASR_BOTH_DOWN_GUIDANCE).expect("guidance json")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::asr::ASR_BOTH_DOWN_GUIDANCE;

    #[test]
    fn bridge_wires_asr_session_and_voice_button() {
        let script = initialization_script();
        assert!(script.contains("__DSH_FRIEND_ASR__"));
        assert!(script.contains("hotkey-down"));
        assert!(script.contains("hotkey-up"));
        assert!(script.contains("friend-voice"));
        assert!(script.contains("dsh-friend:shell-talk"));
        assert!(script.contains("probeHit"));
        assert!(script.contains("__DSH_FRIEND_PET__"));
        assert!(script.contains("hitTest"));
        assert!(script.contains("set_cursor_ignore"));
        assert!(script.contains("startResizeDragging"));
        assert!(script.contains(ASR_BOTH_DOWN_GUIDANCE));
        assert!(script.contains("SpeechRecognition"));
        assert!(script.contains("__DSH_FRIEND_TTS__"));
        assert!(script.contains("stopAll"));
        assert!(script.contains("__DSH_FRIEND_PLAYBACK__"));
        assert!(script.contains("__dshFriendStopAllTts__"));
    }
}
