use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::{Emitter, Manager, WebviewWindowBuilder};

// ============ 数据模型 ============

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Todo {
    id: String,
    title: String,
    level: String, // "low" | "mid" | "high"
    completed: bool,
    created_at: i64,
    due_at: Option<i64>,
}

#[derive(Clone, serde::Serialize)]
struct DanmakuPayload {
    id: f64,
    text: String,
    color: String,
    speed: f64,
}

#[derive(Clone, serde::Serialize)]
struct VfxPayload {
    id: f64,
    effect: String, // "shatter" | "particle"
    text: String,
    color: String,
}

// ============ 存储 ============

fn storage_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("todos.json"))
}

fn load_todos(app: &tauri::AppHandle) -> Vec<Todo> {
    match storage_path(app) {
        Ok(path) if path.exists() => {
            let data = std::fs::read_to_string(&path).unwrap_or_default();
            serde_json::from_str(&data).unwrap_or_default()
        }
        _ => Vec::new(),
    }
}

fn save_todos(app: &tauri::AppHandle, todos: &[Todo]) -> Result<(), String> {
    let path = storage_path(app)?;
    let data = serde_json::to_string_pretty(todos).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())
}

// ============ ID 生成 ============

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn gen_id() -> String {
    let ts = js_sys_now();
    let c = COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("{}-{}", ts, c)
}

fn js_sys_now() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ============ 弹幕/特效派发 ============

fn level_to_color(level: &str) -> &'static str {
    match level {
        "high" => "#ff6b6b",
        "mid" => "#ffe66d",
        _ => "#4ecdc4",
    }
}

fn level_to_speed(level: &str) -> f64 {
    match level {
        "high" => 80.0,
        "mid" => 100.0,
        _ => 140.0,
    }
}

fn dispatch_danmaku(app: &tauri::AppHandle, text: &str, level: &str) {
    let payload = DanmakuPayload {
        id: js_sys_now() as f64,
        text: text.to_string(),
        color: level_to_color(level).to_string(),
        speed: level_to_speed(level),
    };
    for (label, window) in app.webview_windows() {
        if label.starts_with("overlay-") {
            let _ = window.emit("danmaku", payload.clone());
        }
    }
}

/// 按 level 路由：low → 弹幕事件，mid → 粒子特效，high → 破碎特效
fn dispatch_by_level(app: &tauri::AppHandle, text: &str, level: &str) {
    match level {
        "mid" | "high" => {
            let effect = if level == "high" { "shatter" } else { "particle" };
            let payload = VfxPayload {
                id: js_sys_now() as f64,
                effect: effect.to_string(),
                text: text.to_string(),
                color: level_to_color(level).to_string(),
            };
            log::info!("dispatch vfx: effect={} text={}", effect, text);
            for (label, window) in app.webview_windows() {
                if label.starts_with("overlay-") {
                    let _ = window.emit("vfx", payload.clone());
                }
            }
        }
        _ => {
            dispatch_danmaku(app, text, level);
        }
    }
}

// ============ 调度引擎：后台轮询到期 ToDo ============

fn start_scheduler(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let now = js_sys_now();
            let mut todos = load_todos(&app);
            let mut changed = false;

            for todo in todos.iter_mut() {
                // 未完成 + 有到期时间 + 已到期 → 按 level 触发 + 标记完成
                if !todo.completed {
                    if let Some(due) = todo.due_at {
                        if due <= now {
                            dispatch_by_level(&app, &todo.title, &todo.level);
                            todo.completed = true;
                            changed = true;
                        }
                    }
                }
            }

            if changed {
                if let Err(e) = save_todos(&app, &todos) {
                    log::warn!("scheduler save failed: {e}");
                }
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.emit("todos-updated", ());
                }
            }
        }
    });
}

// ============ Overlay 窗口管理 ============

fn spawn_overlay_windows(app: &tauri::AppHandle) -> Result<(), String> {
    let primary = app.primary_monitor().map_err(|e| e.to_string())?;
    let mut all_monitors = app.available_monitors().map_err(|e| e.to_string())?;
    if let Some(p) = primary {
        if !all_monitors.iter().any(|m| m.name() == p.name()) {
            all_monitors.insert(0, p);
        }
    }

    for (idx, monitor) in all_monitors.iter().enumerate() {
        let label = format!("overlay-{}", idx);
        if app.get_webview_window(&label).is_some() {
            continue;
        }
        let pos = monitor.position();
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let logical_w = size.width as f64 / scale;
        let logical_h = size.height as f64 / scale;
        let logical_x = pos.x as f64 / scale;
        let logical_y = pos.y as f64 / scale;

        let url = "index.html?view=overlay".to_string();
        WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App(url.into()))
            .title("")
            .inner_size(logical_w, logical_h)
            .position(logical_x, logical_y)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false)
            .build()
            .map_err(|e| e.to_string())?
            .set_ignore_cursor_events(true)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ============ Tauri 命令 ============

#[tauri::command]
fn todo_list(app: tauri::AppHandle) -> Result<Vec<Todo>, String> {
    Ok(load_todos(&app))
}

#[tauri::command]
fn todo_create(
    app: tauri::AppHandle,
    title: String,
    level: String,
    due_at: Option<i64>,
) -> Result<Todo, String> {
    let mut todos = load_todos(&app);
    let todo = Todo {
        id: gen_id(),
        title,
        level,
        completed: false,
        created_at: js_sys_now(),
        due_at,
    };
    todos.push(todo.clone());
    save_todos(&app, &todos)?;
    Ok(todo)
}

#[tauri::command]
fn todo_complete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let mut todos = load_todos(&app);
    for t in todos.iter_mut() {
        if t.id == id {
            t.completed = true;
            break;
        }
    }
    save_todos(&app, &todos)
}

#[tauri::command]
fn todo_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let mut todos = load_todos(&app);
    todos.retain(|t| t.id != id);
    save_todos(&app, &todos)
}

#[tauri::command]
fn trigger_todo(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let todos = load_todos(&app);
    let todo = todos
        .iter()
        .find(|t| t.id == id)
        .ok_or("todo not found")?;
    dispatch_by_level(&app, &todo.title, &todo.level);
    Ok(())
}

#[tauri::command]
fn send_danmaku(app: tauri::AppHandle, text: String, color: String, speed: f64) -> Result<(), String> {
    let payload = DanmakuPayload {
        id: js_sys_now() as f64,
        text,
        color,
        speed,
    };
    for (label, window) in app.webview_windows() {
        if label.starts_with("overlay-") {
            let _ = window.emit("danmaku", payload.clone());
        }
    }
    Ok(())
}

#[tauri::command]
fn set_cursor_passthrough(window: tauri::WebviewWindow, ignore: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}

// ============ 启动 ============

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            if let Err(e) = spawn_overlay_windows(app.handle()) {
                log::warn!("spawn overlay windows failed: {e}");
            }
            start_scheduler(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_cursor_passthrough,
            send_danmaku,
            trigger_todo,
            todo_list,
            todo_create,
            todo_complete,
            todo_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
