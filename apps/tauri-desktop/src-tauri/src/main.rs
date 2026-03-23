#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Child};
use std::thread;
use std::time::Duration;

const SERVER_PORT: u16 = 9998;
const SERVER_STARTUP_TIMEOUT: u64 = 30;
const SERVER_READY_CHECK_INTERVAL: u64 = 100;

fn get_t3_home() -> PathBuf {
    if let Ok(home) = env::var("HOME") {
        PathBuf::from(home).join(".t3")
    } else if let Ok(userprofile) = env::var("USERPROFILE") {
        PathBuf::from(userprofile).join(".t3")
    } else {
        PathBuf::from(".").join(".t3")
    }
}

fn wait_for_server(port: u16) -> bool {
    use std::net::TcpStream;

    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(SERVER_STARTUP_TIMEOUT);

    loop {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            thread::sleep(Duration::from_millis(200));
            return true;
        }

        if start.elapsed() > timeout {
            eprintln!("Server failed to start within {} seconds", SERVER_STARTUP_TIMEOUT);
            return false;
        }

        thread::sleep(Duration::from_millis(SERVER_READY_CHECK_INTERVAL));
    }
}

fn spawn_server() -> std::io::Result<Child> {
    let t3_home = get_t3_home();
    fs::create_dir_all(&t3_home)?;

    // Navigate to monorepo root (../../.. from src-tauri)
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let monorepo_root = manifest_dir
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    eprintln!("Starting server from: {}", monorepo_root.display());

    let mut cmd = Command::new("bun");
    cmd.current_dir(&monorepo_root);
    cmd.arg("run");
    cmd.arg("dev:server");

    cmd.env("T3CODE_PORT", SERVER_PORT.to_string());
    cmd.env("T3CODE_HOME", &t3_home);
    cmd.env("T3CODE_MODE", "desktop");
    cmd.env("T3CODE_NO_BROWSER", "1");

    // Don't pipe - let output go to console for debugging
    cmd.spawn()
}

fn main() {
    // Spawn the server process
    let mut server_process = match spawn_server() {
        Ok(process) => {
            println!("Server process spawned");
            process
        }
        Err(e) => {
            eprintln!("Failed to spawn server: {}", e);
            std::process::exit(1);
        }
    };

    // Wait for server to be ready
    if !wait_for_server(SERVER_PORT) {
        let _ = server_process.kill();
        eprintln!("Server did not become ready in time");
        std::process::exit(1);
    }

    println!("Server is ready on port {}", SERVER_PORT);

    // Build and run Tauri app
    let _app = tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    // Kill server when app closes
    let _ = server_process.kill();
    println!("Shutdown complete");
}
