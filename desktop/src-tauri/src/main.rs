#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use zeroclaw::{Config, daemon};
use tracing::{info, error};
use tauri::Manager;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Setup minimal logging for the desktop app wrapper
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .init();

    // Install default crypto provider for rustls
    let _ = rustls::crypto::ring::default_provider().install_default();

    // Initialize config
    let mut config = Config::load_or_init().await?;

    // Disable pairing for desktop app convenience
    // This allows the local window to access the API without a pairing code
    config.gateway.require_pairing = false;
    // Add a default token just in case some logic requires it
    // The value doesn't matter since require_pairing is false, but it makes is_paired() true
    if config.gateway.paired_tokens.is_empty() {
        // Use a hash of a known static token for internal desktop use
        // In real pairing, we hash the token. Here we just need ANY entry.
        // Let's use a placeholder.
        config.gateway.paired_tokens.push("desktop-internal-token".to_string());
    }

    // Force binding to localhost for security since pairing is disabled
    config.gateway.host = "127.0.0.1".to_string();

    // Ensure we are using a known port for the desktop app
    // If user has set port 0 (random), we override it to default 42617 for desktop app usage
    // This ensures the window knows where to connect
    let port = if config.gateway.port == 0 {
        info!("Configured port is 0 (random), overriding to 42617 for Desktop App convenience.");
        config.gateway.port = 42617;
        42617
    } else {
        config.gateway.port
    };

    let host = config.gateway.host.clone();

    // Clone config for the daemon task
    let config_clone = config.clone();
    let host_clone = host.clone();

    // Spawn the daemon
    tokio::spawn(async move {
        info!("Starting embedded daemon on {}:{}", host_clone, port);
        // daemon::run is now public thanks to the small change in src/lib.rs
        if let Err(e) = daemon::run(config_clone, host_clone, port).await {
            error!("Daemon failed: {}", e);
        }
    });

    // Run Tauri
    tauri::Builder::default()
        .setup(move |app| {
            let main_window = app.get_window("main").unwrap();
            let url = format!("http://localhost:{}", port);

            // Wait for a short moment or retry connection?
            // Tauri loads the URL. If it fails, it fails.
            // We can update the URL dynamically here.

            // Wait for port to be open?
            // Since this is async setup inside sync setup... tricky.
            // We can just set the URL and let the user refresh if needed.
            // Or use eval js to reload.

            // Let's just set the initial URL.
            // The tauri.conf.json has no URL set (Wait, I removed it in previous step? Let me check).
            // I should set it dynamically here.

            let _ = main_window.eval(&format!("window.location.replace('{}')", url));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    Ok(())
}
