// Iris shell: spawns the Python engine sidecar and tears it down on exit.
//
// Packaged builds run the PyInstaller binary bundled via `bundle.externalBin`
// (installed next to this executable). If no bundled sidecar is present —
// the walking-skeleton dev mode — falls back to system Python with the
// engine package on disk (IRIS_PYTHON / IRIS_ENGINE_DIR override).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

struct Engine(Mutex<Option<Child>>);
struct EnginePort(u16);

/// Prefer the default port so dev-mode frontends (which assume 8765) keep
/// working; if something else holds it, let the OS pick a free one.
fn pick_port() -> u16 {
    for candidate in [8765u16, 8766, 8767] {
        if TcpListener::bind(("127.0.0.1", candidate)).is_ok() {
            return candidate;
        }
    }
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(8765)
}

fn sidecar_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let name = if cfg!(windows) { "iris-engine.exe" } else { "iris-engine" };
    let path = exe.parent()?.join(name);
    path.is_file().then_some(path)
}

fn spawn_engine(port: u16) -> Option<Child> {
    let mut cmd = match sidecar_path() {
        Some(bin) => Command::new(bin),
        None => {
            let python =
                std::env::var("IRIS_PYTHON").unwrap_or_else(|_| "python3".into());
            let engine_dir =
                std::env::var("IRIS_ENGINE_DIR").unwrap_or_else(|_| "engine".into());
            let mut c = Command::new(python);
            c.args(["-m", "iris_engine.main"]).current_dir(engine_dir);
            c
        }
    };
    // piped stdin + IRIS_WATCH_STDIN: the engine exits when the pipe
    // closes, so it never outlives the shell even on SIGKILL (Tauri's
    // exit handlers only cover a normal window close)
    cmd.env("ENGINE_PORT", port.to_string())
        .env("IRIS_WATCH_STDIN", "1")
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| eprintln!("engine spawn failed: {e}"))
        .ok()
}

fn kill_engine(engine: &Engine) {
    if let Some(mut child) = engine.0.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[tauri::command]
fn engine_port(port: tauri::State<EnginePort>) -> u16 {
    port.0
}

fn main() {
    let port = pick_port();
    tauri::Builder::default()
        .manage(EnginePort(port))
        .manage(Engine(Mutex::new(spawn_engine(port))))
        .invoke_handler(tauri::generate_handler![engine_port])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(engine) = window.app_handle().try_state::<Engine>() {
                    kill_engine(&engine);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // belt-and-braces: window Destroyed handles the normal path,
            // this catches exits that never destroy a window
            if let tauri::RunEvent::Exit = event {
                if let Some(engine) = app.try_state::<Engine>() {
                    kill_engine(&engine);
                }
            }
        });
}
