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
    #[serde(default)]
    screen: i32, // 目标屏幕 index，0 = 主屏
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

#[derive(Clone, serde::Serialize)]
struct ScreenInfo {
    id: i32,
    name: String,
    is_primary: bool,
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

fn dispatch_danmaku(app: &tauri::AppHandle, text: &str, level: &str, screen: i32) {
    let payload = DanmakuPayload {
        id: js_sys_now() as f64,
        text: text.to_string(),
        color: level_to_color(level).to_string(),
        speed: level_to_speed(level),
    };
    let label = format!("overlay-{}", screen);
    // 注意：Tauri v2 中 WebviewWindow::emit 会广播给所有窗口
    // 必须用 emit_to 精确指定目标窗口，否则三块屏会同时出现特效
    if app.get_webview_window(&label).is_some() {
        let _ = app.emit_to(&label, "danmaku", payload);
    } else {
        log::warn!("overlay-{} not found, danmaku dropped", screen);
    }
}

/// 按 level 路由：low → 弹幕事件，mid → 粒子特效，high → 破碎特效
fn dispatch_by_level(app: &tauri::AppHandle, text: &str, level: &str, screen: i32) {
    match level {
        "mid" | "high" => {
            let effect = if level == "high" { "shatter" } else { "particle" };
            let payload = VfxPayload {
                id: js_sys_now() as f64,
                effect: effect.to_string(),
                text: text.to_string(),
                color: level_to_color(level).to_string(),
            };
            log::info!("dispatch vfx: effect={} text={} screen={}", effect, text, screen);
            let label = format!("overlay-{}", screen);
            // 必须用 emit_to 精确指定目标窗口，避免广播到所有 overlay
            if app.get_webview_window(&label).is_some() {
                let _ = app.emit_to(&label, "vfx", payload);
            } else {
                log::warn!("overlay-{} not found, fallback to overlay-0", screen);
                if app.get_webview_window("overlay-0").is_some() {
                    let _ = app.emit_to("overlay-0", "vfx", payload);
                }
            }
        }
        _ => {
            dispatch_danmaku(app, text, level, screen);
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
                            dispatch_by_level(&app, &todo.title, &todo.level, todo.screen);
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
                // 用 emit_to 只通知主窗口，避免广播到 overlay
                if app.get_webview_window("main").is_some() {
                    let _ = app.emit_to("main", "todos-updated", ());
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
    screen: Option<i32>,
) -> Result<Todo, String> {
    let mut todos = load_todos(&app);
    let todo = Todo {
        id: gen_id(),
        title,
        level,
        completed: false,
        created_at: js_sys_now(),
        due_at,
        screen: screen.unwrap_or(0),
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
    dispatch_by_level(&app, &todo.title, &todo.level, todo.screen);
    Ok(())
}

/// 返回所有屏幕列表，供前端选择目标屏幕
#[tauri::command]
fn list_screens(app: tauri::AppHandle) -> Result<Vec<ScreenInfo>, String> {
    let primary = app.primary_monitor().map_err(|e| e.to_string())?;
    let mut all_monitors = app.available_monitors().map_err(|e| e.to_string())?;
    if let Some(p) = &primary {
        if !all_monitors.iter().any(|m| m.name() == p.name()) {
            all_monitors.insert(0, p.clone());
        }
    }
    let primary_name: Option<&str> = primary.as_ref().and_then(|m| m.name()).map(|s| s.as_str());
    let screens = all_monitors
        .iter()
        .enumerate()
        .map(|(idx, m)| ScreenInfo {
            id: idx as i32,
            name: m
                .name()
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("Screen {}", idx)),
            is_primary: m.name().map(|s| s.as_str()) == primary_name,
        })
        .collect();
    Ok(screens)
}

#[tauri::command]
fn send_danmaku(app: tauri::AppHandle, text: String, color: String, speed: f64, screen: Option<i32>) -> Result<(), String> {
    let payload = DanmakuPayload {
        id: js_sys_now() as f64,
        text,
        color,
        speed,
    };
    let target = screen.unwrap_or(0);
    let label = format!("overlay-{}", target);
    // 用 emit_to 精确发给指定 overlay，避免广播到所有屏幕
    if app.get_webview_window(&label).is_some() {
        let _ = app.emit_to(&label, "danmaku", payload);
    } else {
        log::warn!("overlay-{} not found, danmaku dropped", target);
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
            list_screens,
            todo_list,
            todo_create,
            todo_complete,
            todo_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
