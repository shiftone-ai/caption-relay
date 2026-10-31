#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const SERVICE: &str = "ai.shiftone.caption-relay";
const ACCOUNT: &str = "provider-credentials";
const KEY_NAMES: [&str; 5] = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "CAPTION_RELAY_OPENAI_API_KEY",
    "CAPTION_RELAY_STT_JPY_PER_USD",
];

struct Backend {
    child: Mutex<Option<Child>>,
    origin: String,
}

impl Backend {
    fn stop(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                drop(child.stdin.take());
                let deadline = Instant::now() + Duration::from_secs(8);
                loop {
                    match child.try_wait() {
                        Ok(Some(_)) => break,
                        _ if Instant::now() < deadline => {
                            std::thread::sleep(Duration::from_millis(50))
                        }
                        _ => {
                            let _ = child.kill();
                            let _ = child.wait();
                            break;
                        }
                    }
                }
            }
        }
    }
}

impl Drop for Backend {
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(Deserialize)]
struct Ready {
    port: u16,
    token: String,
}

#[derive(Serialize)]
struct CredentialError {
    message: String,
}
impl From<String> for CredentialError {
    fn from(message: String) -> Self {
        Self { message }
    }
}
impl From<&str> for CredentialError {
    fn from(message: &str) -> Self {
        Self {
            message: message.into(),
        }
    }
}

#[derive(Serialize)]
struct CredentialStatus {
    configured: BTreeMap<String, bool>,
    stt_rate: String,
}

fn read_credentials() -> Result<BTreeMap<String, String>, String> {
    match security_framework::passwords::generic_password(
        security_framework::passwords::PasswordOptions::new_generic_password(SERVICE, ACCOUNT),
    ) {
        Ok(value) => serde_json::from_slice(&value)
            .map_err(|_| "APIキーを読み込めません。設定を確認してください。".into()),
        Err(error) if error.code() == -25300 => Ok(BTreeMap::new()),
        Err(_) => Err("キーチェーンを開けません。アクセスを許可して再起動してください。".into()),
    }
}

fn check_settings(window: &WebviewWindow, backend: &Backend) -> Result<(), String> {
    let location = window.url().map_err(|_| "設定画面を確認できません。")?;
    if window.label() != "settings"
        || location.origin().ascii_serialization() != backend.origin
        || location.path() != "/desktop/settings"
    {
        return Err("この画面からAPIキーを変更できません。".into());
    }
    Ok(())
}

#[tauri::command]
fn credential_status(
    window: WebviewWindow,
    backend: tauri::State<Backend>,
) -> Result<CredentialStatus, CredentialError> {
    check_settings(&window, &backend)?;
    let values = read_credentials()?;
    Ok(CredentialStatus {
        configured: KEY_NAMES
            .into_iter()
            .map(|key| {
                (
                    key.into(),
                    values.get(key).is_some_and(|value| !value.is_empty()),
                )
            })
            .collect(),
        stt_rate: values
            .get("CAPTION_RELAY_STT_JPY_PER_USD")
            .cloned()
            .unwrap_or_default(),
    })
}

#[tauri::command]
fn save_credentials(
    window: WebviewWindow,
    app: tauri::AppHandle,
    backend: tauri::State<Backend>,
    changes: BTreeMap<String, Option<String>>,
) -> Result<(), CredentialError> {
    check_settings(&window, &backend)?;
    let mut values = read_credentials()?;
    for (key, value) in changes {
        if !KEY_NAMES.contains(&key.as_str()) {
            return Err("設定項目が正しくありません。".into());
        }
        if let Some(value) = value {
            let value = value.trim();
            if value.len() > 8192 || value.contains(['\r', '\n', '\0']) {
                return Err("APIキーの形式を確認してください。".into());
            }
            if key == "CAPTION_RELAY_STT_JPY_PER_USD" && !value.is_empty() {
                let rate: f64 = value
                    .parse()
                    .map_err(|_| "円換算には正の数値を入力してください。")?;
                if !rate.is_finite() || rate <= 0.0 {
                    return Err("円換算には正の数値を入力してください。".into());
                }
            }
            if value.is_empty() {
                values.remove(&key);
            } else {
                values.insert(key, value.into());
            }
        }
    }
    let data = serde_json::to_vec(&values).map_err(|_| "設定を保存できません。")?;
    security_framework::passwords::set_generic_password(SERVICE, ACCOUNT, &data)
        .map_err(|_| "キーチェーンへ保存できません。アクセス権を確認してください。")?;
    backend.stop();
    app.restart();
}

fn open_settings(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(window) = app.get_webview_window("settings") {
        window.show()?;
        return Ok(());
    }
    let backend = app.state::<Backend>();
    WebviewWindowBuilder::new(
        app,
        "settings",
        WebviewUrl::External(format!("{}/desktop/settings", backend.origin).parse()?),
    )
    .title("APIキー — Caption Relay")
    .inner_size(640.0, 720.0)
    .min_inner_size(400.0, 480.0)
    .focused(false)
    .build()?;
    Ok(())
}

fn open_main(app: &tauri::AppHandle, url: url::Url) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(window) = app.get_webview_window("main") {
        window.show()?;
        window.unminimize()?;
        return Ok(());
    }
    let navigation_origin = app.state::<Backend>().origin.clone();
    let handle = app.clone();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("Caption Relay")
        .inner_size(1280.0, 840.0)
        .min_inner_size(400.0, 480.0)
        .focused(false)
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        .on_navigation(move |url| url.origin().ascii_serialization() == navigation_origin)
        .on_new_window(move |url, _| {
            let backend = handle.state::<Backend>();
            if url.origin().ascii_serialization() == backend.origin
                && url.path().starts_with("/view/")
            {
                if let Some(window) = handle.get_webview_window("audience") {
                    let _ = window.navigate(url);
                    let _ = window.show();
                } else {
                    let _ =
                        WebviewWindowBuilder::new(&handle, "audience", WebviewUrl::External(url))
                            .title("字幕 — Caption Relay")
                            .inner_size(1024.0, 720.0)
                            .focused(false)
                            .background_throttling(
                                tauri::utils::config::BackgroundThrottlingPolicy::Disabled,
                            )
                            .build();
                }
            } else if url.scheme() == "https" {
                let target = url.to_string();
                // Preserve the caption operator's focus when opening reference material.
                std::thread::spawn(move || {
                    match Command::new("/usr/bin/open").arg("-g").arg(target).status() {
                        Ok(status) if status.success() => {}
                        _ => eprintln!("公式資料をブラウザで開けませんでした。"),
                    }
                });
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .build()?;
    Ok(())
}

fn main() {
    let application = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(backend) = app.try_state::<Backend>() {
                if let Ok(url) = format!("{}/", backend.origin).parse() {
                    let _ = open_main(app, url);
                }
            }
        }))
        .invoke_handler(tauri::generate_handler![
            credential_status,
            save_credentials
        ])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let executable = app
                .path()
                .resource_dir()?
                .join("backend/caption-relay-service");
            let mut command = Command::new(executable);
            for name in KEY_NAMES {
                command.env_remove(name);
            }
            command.env_remove("CAPTION_RELAY_UDTALK_URL");
            let mut child = command
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()?;
            let startup =
                serde_json::json!({ "environment": read_credentials()?, "data_dir": data_dir });
            writeln!(
                child.stdin.as_mut().ok_or("Missing startup pipe")?,
                "{}",
                startup
            )?;
            let stdout = child.stdout.take().ok_or("Missing startup output")?;
            let (sender, receiver) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let mut line = String::new();
                let mut reader = BufReader::new(stdout);
                let ready = reader
                    .read_line(&mut line)
                    .map_err(|_| "起動情報を読み込めません。".to_string())
                    .and_then(|_| {
                        serde_json::from_str::<Ready>(&line)
                            .map_err(|_| "字幕処理を起動できません。".into())
                    });
                let _ = sender.send(ready);
                // Drain subsequent output without writing credentials into logs.
                let _ = std::io::copy(&mut reader, &mut std::io::sink());
            });
            let ready = match receiver.recv_timeout(Duration::from_secs(30)) {
                Ok(Ok(ready)) => ready,
                _ => {
                    drop(child.stdin.take());
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("字幕処理を起動できません。アプリを開き直してください。".into());
                }
            };
            let origin = format!("http://127.0.0.1:{}", ready.port);
            app.manage(Backend {
                child: Mutex::new(Some(child)),
                origin: origin.clone(),
            });
            open_main(
                app.handle(),
                format!("{origin}/_desktop/start?token={}", ready.token).parse()?,
            )?;
            use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
            let settings =
                MenuItem::with_id(app, "settings", "APIキーの設定…", true, Some("CmdOrCtrl+,"))?;
            let window_menu = Submenu::with_id_and_items(
                app,
                tauri::menu::WINDOW_SUBMENU_ID,
                "ウィンドウ",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                    &PredefinedMenuItem::close_window(app, None)?,
                ],
            )?;
            window_menu.set_as_windows_menu_for_nsapp()?;
            app.set_menu(Menu::with_items(
                app,
                &[
                    &Submenu::with_items(
                        app,
                        "Caption Relay",
                        true,
                        &[
                            &PredefinedMenuItem::about(app, None, None)?,
                            &settings,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::hide(app, None)?,
                            &PredefinedMenuItem::quit(app, None)?,
                        ],
                    )?,
                    &Submenu::with_items(
                        app,
                        "編集",
                        true,
                        &[
                            &PredefinedMenuItem::undo(app, None)?,
                            &PredefinedMenuItem::redo(app, None)?,
                            &PredefinedMenuItem::cut(app, None)?,
                            &PredefinedMenuItem::copy(app, None)?,
                            &PredefinedMenuItem::paste(app, None)?,
                            &PredefinedMenuItem::select_all(app, None)?,
                        ],
                    )?,
                    &window_menu,
                ],
            )?)?;
            app.on_menu_event(|app, event| {
                if event.id() == "settings" {
                    let _ = open_settings(app);
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Caption Relayを起動できません。");
    application.run(|app, event| {
        if matches!(event, tauri::RunEvent::Reopen { .. }) {
            if let Some(backend) = app.try_state::<Backend>() {
                if let Ok(url) = format!("{}/", backend.origin).parse() {
                    let _ = open_main(app, url);
                }
            }
        }
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            if let Some(backend) = app.try_state::<Backend>() {
                backend.stop();
            }
        }
    });
}
