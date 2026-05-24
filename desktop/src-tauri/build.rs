use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    stage_officecli_for_target().expect("failed to stage OfficeCLI for desktop bundle");
    tauri_build::build()
}

fn stage_officecli_for_target() -> Result<(), String> {
    let manifest_dir = PathBuf::from(
        env::var("CARGO_MANIFEST_DIR").map_err(|e| format!("missing CARGO_MANIFEST_DIR: {e}"))?,
    );
    let target = env::var("TARGET").map_err(|e| format!("missing TARGET: {e}"))?;

    println!("cargo:rerun-if-env-changed=TARGET");
    println!(
        "cargo:rerun-if-changed={}",
        manifest_dir.join("vendor/officecli").display()
    );

    let source_name = officecli_vendor_name(&target)
        .ok_or_else(|| format!("unsupported desktop target for bundled OfficeCLI: {target}"))?;
    let source_path = manifest_dir.join("vendor/officecli").join(source_name);
    if !source_path.is_file() {
        return Err(format!(
            "missing bundled OfficeCLI asset for target {target}: {}",
            source_path.display()
        ));
    }

    let resources_dir = manifest_dir.join("resources/officecli");
    fs::create_dir_all(&resources_dir).map_err(|e| {
        format!(
            "failed to create resources dir {}: {e}",
            resources_dir.display()
        )
    })?;

    let staged_name = if target.contains("windows") {
        "officecli.exe"
    } else {
        "officecli"
    };
    let staged_path = resources_dir.join(staged_name);
    if should_refresh_staged_file(&source_path, &staged_path)? {
        fs::copy(&source_path, &staged_path).map_err(|e| {
            format!(
                "failed to copy OfficeCLI from {} to {}: {e}",
                source_path.display(),
                staged_path.display()
            )
        })?;
    }
    mark_executable_if_needed(&staged_path)?;
    remove_stale_sibling(&resources_dir, staged_name)?;
    Ok(())
}

fn should_refresh_staged_file(source_path: &Path, staged_path: &Path) -> Result<bool, String> {
    if !staged_path.exists() {
        return Ok(true);
    }

    let source_meta = fs::metadata(source_path)
        .map_err(|e| format!("failed to stat {}: {e}", source_path.display()))?;
    let staged_meta = fs::metadata(staged_path)
        .map_err(|e| format!("failed to stat {}: {e}", staged_path.display()))?;
    if source_meta.len() != staged_meta.len() {
        return Ok(true);
    }

    let source_bytes = fs::read(source_path)
        .map_err(|e| format!("failed to read {}: {e}", source_path.display()))?;
    let staged_bytes = fs::read(staged_path)
        .map_err(|e| format!("failed to read {}: {e}", staged_path.display()))?;
    Ok(source_bytes != staged_bytes)
}

fn officecli_vendor_name(target: &str) -> Option<&'static str> {
    match target {
        "aarch64-apple-darwin" => Some("officecli-mac-arm64"),
        "x86_64-apple-darwin" => Some("officecli-mac-x64"),
        "x86_64-pc-windows-msvc" | "x86_64-pc-windows-gnu" => Some("officecli-win-x64.exe"),
        "aarch64-pc-windows-msvc" => Some("officecli-win-arm64.exe"),
        "x86_64-unknown-linux-gnu" | "x86_64-unknown-linux-musl" => Some("officecli-linux-x64"),
        "aarch64-unknown-linux-gnu" | "aarch64-unknown-linux-musl" => Some("officecli-linux-arm64"),
        _ => None,
    }
}

#[cfg(unix)]
fn mark_executable_if_needed(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = fs::metadata(path)
        .map_err(|e| format!("failed to stat {}: {e}", path.display()))?
        .permissions();
    if permissions.mode() & 0o111 == 0o111 {
        return Ok(());
    }
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions)
        .map_err(|e| format!("failed to set executable bit on {}: {e}", path.display()))
}

#[cfg(not(unix))]
fn mark_executable_if_needed(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn remove_stale_sibling(resources_dir: &Path, active_name: &str) -> Result<(), String> {
    for candidate in ["officecli", "officecli.exe"] {
        if candidate == active_name {
            continue;
        }
        let stale_path = resources_dir.join(candidate);
        if stale_path.exists() {
            fs::remove_file(&stale_path).map_err(|e| {
                format!(
                    "failed to remove stale resource {}: {e}",
                    stale_path.display()
                )
            })?;
        }
    }
    Ok(())
}
