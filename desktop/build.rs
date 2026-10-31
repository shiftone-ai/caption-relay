fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["credential_status", "save_credentials"]),
    ))
    .expect("failed to build desktop permissions");
}
