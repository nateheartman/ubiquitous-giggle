//! What `/meet` does where it isn't built: say so. The interface asks
//! `meeting_supported` first and hides the command when it's false, so the
//! rest are only ever reached by a mistake.

use crate::db::{Error, Result};

/// Held in the app's state on every system, so `main.rs` needs no `cfg`.
#[derive(Default)]
pub struct MeetState;

#[tauri::command]
pub fn meeting_supported() -> bool {
    false
}

#[tauri::command]
pub fn meeting_status() -> Option<()> {
    None
}

#[tauri::command]
pub fn meeting_active() -> Option<()> {
    None
}

macro_rules! unavailable {
    ($($name:ident),* $(,)?) => {$(
        #[tauri::command]
        pub fn $name() -> Result<()> {
            Err(Error("Meeting recording is only available on macOS.".into()))
        }
    )*};
}

unavailable!(
    meeting_models_status,
    meeting_models_download,
    meeting_models_cancel,
    meeting_models_delete,
    meeting_open_privacy,
    meeting_start,
    meeting_pause,
    meeting_stop,
    meeting_process,
    meeting_cancel,
    meeting_ack,
    meeting_discard,
    meeting_rediarize,
    meeting_summary_model_download,
    meeting_summary_model_delete,
    meeting_summarize,
    meeting_summary_cancel,
);
