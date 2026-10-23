//! macOS menu bar and app lifecycle (hide on close, Dock reopen, quit).
//!
//! Custom items emit a `td-menu` event whose payload is an id string; the
//! frontend (`src/lib/menu-events.ts`) maps ids to the same actions the
//! keyboard shortcuts run. Close and Quit are handled here because they have
//! to coordinate with the frontend's flush-before-leave step.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Set once a quit has started, so a second request doesn't start another.
static QUITTING: AtomicBool = AtomicBool::new(false);
/// How long the frontend gets to flush before we exit regardless.
const QUIT_GRACE: Duration = Duration::from_secs(3);

/// Brings the main window back (Dock click, second launch).
pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Asks the frontend to save everything and then call `quit_app`. If it
/// doesn't answer in time (still loading, wedged), exit anyway.
pub fn request_quit<R: Runtime>(app: &AppHandle<R>) {
    if QUITTING.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = app.emit("td-menu", "quit");
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(QUIT_GRACE);
        app.exit(0);
    });
}

/// Called by the frontend once it has flushed in response to a quit request.
#[tauri::command]
pub fn quit_app<R: Runtime>(app: AppHandle<R>) {
    app.exit(0);
}

/// Called by the frontend after it has flushed, to hide instead of close
/// (macOS: the red button leaves the app running in the Dock).
#[tauri::command]
pub fn hide_main_window<R: Runtime>(app: AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[cfg(target_os = "macos")]
pub fn install<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    use tauri::menu::{AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder};

    // macOS hands Cmd+key to the webview first. When the frontend's keydown
    // handler runs a shortcut it calls preventDefault, so the menu item does
    // not fire as well; keys the page leaves alone fall through to the menu.
    let handle = app.handle();
    // A custom item with an optional accelerator.
    let item = |id: &str, text: &str, accel: Option<&str>| {
        let mut b = MenuItemBuilder::with_id(id, text);
        if let Some(a) = accel {
            b = b.accelerator(a);
        }
        b.build(handle)
    };

    let about = AboutMetadataBuilder::new()
        .name(Some("ThoughtNotes"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .comments(Some("A fast, local-first notes workspace. Based on Thought Desk by Kusule."))
        .license(Some("AGPL-3.0-or-later"))
        .build();

    let app_menu = SubmenuBuilder::new(handle, "ThoughtNotes")
        .about(Some(about))
        .separator()
        .item(&item("settings", "Settings…", Some("Cmd+,"))?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&item("quit", "Quit ThoughtNotes", Some("Cmd+Q"))?)
        .build()?;

    let file = SubmenuBuilder::new(handle, "File")
        .item(&item("newPage", "New Page", Some("Cmd+N"))?)
        .separator()
        .item(&item("savePdf", "Save as PDF…", None)?)
        .separator()
        .item(&item("close", "Close Window", Some("Cmd+W"))?)
        .build()?;

    // The predefined items are what make Cmd+C/V/X/Z work in WKWebView.
    let edit = SubmenuBuilder::new(handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view = SubmenuBuilder::new(handle, "View")
        .item(&item("sidebar", "Toggle Sidebar", Some("Cmd+Ctrl+S"))?)
        .item(&item("split", "Toggle Split View", Some("Cmd+Shift+Backslash"))?)
        // No key equivalent: the editor owns Cmd+K (insert link), so JS handles it.
        .item(&item("search", "Search…", None)?)
        .item(&item("theme", "Toggle Light/Dark", Some("Cmd+Shift+L"))?)
        .separator()
        .item(&item("zoomReset", "Actual Size", Some("Cmd+0"))?)
        .item(&item("zoomIn", "Zoom In", Some("Cmd+Equal"))?)
        .item(&item("zoomOut", "Zoom Out", Some("Cmd+Minus"))?)
        .separator()
        .fullscreen()
        .build()?;

    let go = SubmenuBuilder::new(handle, "Go")
        .item(&item("back", "Back", Some("Cmd+BracketLeft"))?)
        .item(&item("forward", "Forward", Some("Cmd+BracketRight"))?)
        .separator()
        .item(&item("goHome", "Home", Some("Cmd+1"))?)
        .item(&item("goAssignments", "Assignments", Some("Cmd+2"))?)
        .item(&item("goCalendar", "Calendar", Some("Cmd+3"))?)
        .item(&item("goFiles", "Files", Some("Cmd+4"))?)
        .item(&item("goCards", "Flashcards", Some("Cmd+5"))?)
        .build()?;

    let window = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .maximize()
        .separator()
        .bring_all_to_front()
        .build()?;

    let help = SubmenuBuilder::new(handle, "Help")
        .item(&item("help", "Keyboard Shortcuts", Some("Cmd+Slash"))?)
        .build()?;

    let menu = MenuBuilder::new(handle)
        .items(&[&app_menu, &file, &edit, &view, &go, &window, &help])
        .build()?;
    app.set_menu(menu)?;
    let _ = window.set_as_windows_menu_for_nsapp();
    let _ = help.set_as_help_menu_for_nsapp();

    app.on_menu_event(|app, event| match event.id().as_ref() {
        "quit" => request_quit(app),
        "close" => {
            // Goes through CloseRequested, so the frontend flushes and hides.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.close();
            }
        }
        id @ ("settings" | "newPage" | "savePdf" | "sidebar" | "split" | "search" | "theme" | "zoomIn" | "zoomOut" | "zoomReset"
        | "back" | "forward" | "goHome" | "goAssignments" | "goCalendar" | "goFiles" | "goCards" | "help") => {
            show_main(app);
            let _ = app.emit("td-menu", id);
        }
        _ => {}
    });
    Ok(())
}
