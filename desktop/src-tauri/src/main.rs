#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use anyhow::Context;
use std::path::{Path, PathBuf};
use tauri::Manager;
use tracing::{error, info, warn};
use tracing_subscriber::{fmt, EnvFilter};
use zeroclaw::observability;
use zeroclaw::{daemon, Config};

const OFFICECLI_ENV_VAR: &str = "ZEROCLAW_OFFICECLI_PATH";
const OFFICECLI_RESOURCE_ROOT: &str = "officecli";

#[derive(Clone, Copy, Debug)]
struct OfficeCliAsset {
    resource_name: &'static str,
}

impl OfficeCliAsset {
    fn resource_rel_path(self) -> PathBuf {
        Path::new(OFFICECLI_RESOURCE_ROOT).join(self.resource_name)
    }
}

fn current_officecli_asset() -> Option<OfficeCliAsset> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Some(OfficeCliAsset {
            resource_name: "officecli",
        }),
        ("macos", "x86_64") => Some(OfficeCliAsset {
            resource_name: "officecli",
        }),
        ("windows", "x86_64") => Some(OfficeCliAsset {
            resource_name: "officecli.exe",
        }),
        ("windows", "aarch64") => Some(OfficeCliAsset {
            resource_name: "officecli.exe",
        }),
        ("linux", "x86_64") => Some(OfficeCliAsset {
            resource_name: "officecli",
        }),
        ("linux", "aarch64") => Some(OfficeCliAsset {
            resource_name: "officecli",
        }),
        _ => None,
    }
}

fn bundled_officecli_path(app: &tauri::App) -> anyhow::Result<PathBuf> {
    let asset = current_officecli_asset().with_context(|| {
        format!(
            "No bundled OfficeCLI asset mapping for platform {}-{}",
            std::env::consts::OS,
            std::env::consts::ARCH
        )
    })?;
    let resource_rel_path = asset.resource_rel_path();
    let resolved_path = app
        .path_resolver()
        .resolve_resource(&resource_rel_path)
        .with_context(|| {
            format!(
                "Failed to resolve bundled OfficeCLI resource {}",
                resource_rel_path.display()
            )
        })?;
    let resource_path = if resolved_path.is_file() {
        resolved_path
    } else {
        let dev_path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(&resource_rel_path);
        if dev_path.is_file() {
            dev_path
        } else {
            anyhow::bail!(
                "Bundled OfficeCLI resource not found at {} or {}",
                resolved_path.display(),
                dev_path.display()
            );
        }
    };
    ensure_executable_permissions(&resource_path)?;
    Ok(resource_path)
}

#[cfg(unix)]
fn ensure_executable_permissions(path: &Path) -> anyhow::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = std::fs::metadata(path)
        .with_context(|| format!("failed to stat {}", path.display()))?
        .permissions();
    if permissions.mode() & 0o111 == 0o111 {
        return Ok(());
    }
    permissions.set_mode(0o755);
    std::fs::set_permissions(path, permissions)
        .with_context(|| format!("failed to mark {} executable", path.display()))?;
    Ok(())
}

#[cfg(not(unix))]
fn ensure_executable_permissions(_path: &Path) -> anyhow::Result<()> {
    Ok(())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let subscriber = fmt::Subscriber::builder()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .finish();
    let _ = tracing::subscriber::set_global_default(subscriber);

    // Install default crypto provider for rustls
    let _ = rustls::crypto::ring::default_provider().install_default();

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
        config
            .gateway
            .paired_tokens
            .push("desktop-internal-token".to_string());
    }

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
    observability::runtime_trace::init_from_config(&config.observability, &config.workspace_dir);

    // Run Tauri
    tauri::Builder::default()
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            match bundled_officecli_path(app) {
                Ok(officecli_path) => {
                    std::env::set_var(OFFICECLI_ENV_VAR, &officecli_path);
                    info!(
                        "Configured bundled OfficeCLI for desktop runtime: {}",
                        officecli_path.display()
                    );
                }
                Err(error) => {
                    warn!("Bundled OfficeCLI is unavailable: {error}");
                }
            }

            let config_clone = config.clone();
            let host_clone = host.clone();
            tokio::spawn(async move {
                info!("Starting embedded daemon on {}:{}", host_clone, port);
                if let Err(e) = daemon::run(config_clone, host_clone, port).await {
                    error!("Daemon failed: {}", e);
                }
            });

            let main_window = app.get_window("main").unwrap();
            let update_window = main_window.clone();
            let url = format!("http://localhost:{}", port);
            let app_handle = app.handle();

            tauri::async_runtime::spawn(async move {
                match tauri::updater::builder(app_handle.clone()).check().await {
                    Ok(update) => {
                        if update.is_update_available() {
                            let latest_version = update.latest_version().to_string();
                            info!("update available: {latest_version}");
                            let should_install = tauri::api::dialog::blocking::ask(
                                Some(&update_window),
                                "发现新版本",
                                format!("检测到新版本 v{latest_version}，是否现在更新并重启应用？"),
                            );
                            if should_install {
                                match update.download_and_install().await {
                                    Ok(_) => {
                                        info!("update installed, restarting");
                                        app_handle.restart();
                                    }
                                    Err(err) => error!("failed to install update: {err}"),
                                }
                            } else {
                                info!("user skipped update: {latest_version}");
                            }
                        }
                    }
                    Err(err) => warn!("update check failed: {err}"),
                }
            });

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
            let _ = main_window.show();
            let _ = main_window.set_focus();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    Ok(())
}
