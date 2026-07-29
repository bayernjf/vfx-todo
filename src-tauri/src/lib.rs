use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::{Emitter, Manager, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};



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
    #[serde(default)]
    recurrence: Option<String>, // "daily" | "weekly"
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

#[derive(Clone)]
struct AppState {
    todos: std::sync::Arc<std::sync::Mutex<Vec<Todo>>>,
    dirty: std::sync::Arc<std::sync::Mutex<bool>>,
}

impl AppState {
    fn new() -> Self {
        Self {
            todos: std::sync::Arc::new(std::sync::Mutex::new(Vec::new())),
            dirty: std::sync::Arc::new(std::sync::Mutex::new(false)),
        }
    }
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

fn start_scheduler(app: tauri::AppHandle, state: AppState) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let now = js_sys_now();
            let mut todos = state.todos.lock().unwrap();
            let mut changed = false;

            let mut new_todos = Vec::new();
            for todo in todos.iter_mut() {
                // 未完成 + 有到期时间 + 已到期 → 按 level 触发 + 标记完成
                if !todo.completed {
                    if let Some(due) = todo.due_at {
                        if due <= now {
                            dispatch_by_level(&app, &todo.title, &todo.level, todo.screen);
                            todo.completed = true;
                            changed = true;

                            // 重复任务：自动创建下一个实例
                            if let Some(ref rec) = todo.recurrence {
                                let next_due = match rec.as_str() {
                                    "daily" => due + 24 * 60 * 60 * 1000,
                                    "weekly" => due + 7 * 24 * 60 * 60 * 1000,
                                    _ => due,
                                };
                                if next_due > due {
                                    new_todos.push(Todo {
                                        id: gen_id(),
                                        title: todo.title.clone(),
                                        level: todo.level.clone(),
                                        completed: false,
                                        created_at: now,
                                        due_at: Some(next_due),
                                        screen: todo.screen,
                                        recurrence: todo.recurrence.clone(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
            if !new_todos.is_empty() {
                todos.extend(new_todos);
                changed = true;
            }

            if changed {
                *state.dirty.lock().unwrap() = true;
                // 用 emit_to 只通知主窗口，避免广播到 overlay
                if app.get_webview_window("main").is_some() {
                    let _ = app.emit_to("main", "todos-updated", ());
                }
            }
        }
    });
}

fn start_persist_thread(app: tauri::AppHandle, state: AppState) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(5));
            let dirty = *state.dirty.lock().unwrap();
            if dirty {
                let todos = state.todos.lock().unwrap().clone();
                if let Err(e) = save_todos(&app, &todos) {
                    log::warn!("persist failed: {e}");
                } else {
                    *state.dirty.lock().unwrap() = false;
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
fn todo_list(state: tauri::State<'_, AppState>) -> Result<Vec<Todo>, String> {
    Ok(state.todos.lock().unwrap().clone())
}

#[tauri::command]
fn todo_create(
    state: tauri::State<'_, AppState>,
    title: String,
    level: String,
    due_at: Option<i64>,
    screen: Option<i32>,
    recurrence: Option<String>,
) -> Result<Todo, String> {
    let mut todos = state.todos.lock().unwrap();
    let todo = Todo {
        id: gen_id(),
        title,
        level,
        completed: false,
        created_at: js_sys_now(),
        due_at,
        screen: screen.unwrap_or(0),
        recurrence,
    };
    todos.push(todo.clone());
    *state.dirty.lock().unwrap() = true;
    Ok(todo)
}

#[tauri::command]
fn todo_complete(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let mut todos = state.todos.lock().unwrap();
    for t in todos.iter_mut() {
        if t.id == id {
            t.completed = true;
            break;
        }
    }
    *state.dirty.lock().unwrap() = true;
    Ok(())
}

#[tauri::command]
fn todo_delete(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let mut todos = state.todos.lock().unwrap();
    todos.retain(|t| t.id != id);
    *state.dirty.lock().unwrap() = true;
    Ok(())
}

#[tauri::command]
fn trigger_todo(app: tauri::AppHandle, state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let todos = state.todos.lock().unwrap();
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

fn setup_tray(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::menu::{Menu, MenuItem};

    let show_i = MenuItem::with_id(app, "show", "Show", true, None::<&str>).map_err(|e| e.to_string())?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&show_i, &quit_i]).map_err(|e| e.to_string())?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                let app = tray.app_handle();
                if let Some(win) = app.get_webview_window("main") {
                    if win.is_visible().unwrap_or(true) {
                        let _ = win.hide();
                    } else {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            }
        })
        .on_menu_event(|app, event| {
            match event.id.as_ref() {
                "show" => {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .build(app)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(target_os = "macos")]
fn hide_dock_icon(_app: &tauri::AppHandle) {
    use objc2::runtime::AnyObject;
    use objc2::{msg_send, class};
    unsafe {
        let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        // NSApplicationActivationPolicyAccessory = 1
        let _: () = msg_send![ns_app, setActivationPolicy: 1i64];
    }
}

#[cfg(not(target_os = "macos"))]
fn hide_dock_icon(_app: &tauri::AppHandle) {}

#[tauri::command]
async fn export_todos(app: tauri::AppHandle, state: tauri::State<'_, AppState>, format: String) -> Result<(), String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app.dialog()
        .file()
        .add_filter(format.to_uppercase(), &[&format])
        .set_file_name(&format!("vfx-todos.{format}"))
        .blocking_save_file();
    let path = path.ok_or("cancelled")?;

    let todos = state.todos.lock().unwrap().clone();
    let content = match format.as_str() {
        "json" => serde_json::to_string_pretty(&todos).map_err(|e| e.to_string())?,
        "csv" => {
            let mut csv = String::from("id,title,level,completed,created_at,due_at,screen,recurrence\n");
            for t in todos {
                csv.push_str(&format!(
                    "{},{},{},{},{},{},{},{}\n",
                    t.id,
                    t.title.replace(",", "\\,"),
                    t.level,
                    t.completed,
                    t.created_at,
                    t.due_at.map(|v| v.to_string()).unwrap_or_default(),
                    t.screen,
                    t.recurrence.unwrap_or_default()
                ));
            }
            csv
        }
        _ => return Err("unsupported format".to_string()),
    };

    std::fs::write(path.as_path().unwrap(), content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn import_todos(app: tauri::AppHandle, state: tauri::State<'_, AppState>, format: String) -> Result<usize, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app.dialog()
        .file()
        .add_filter(format.to_uppercase(), &[&format])
        .blocking_pick_file();
    let path = path.ok_or("cancelled")?;

    let data = std::fs::read_to_string(path.as_path().unwrap()).map_err(|e| e.to_string())?;
    let imported: Vec<Todo> = match format.as_str() {
        "json" => serde_json::from_str(&data).map_err(|e| e.to_string())?,
        "csv" => {
            let mut result = Vec::new();
            for (i, line) in data.lines().enumerate() {
                if i == 0 { continue; }
                let parts: Vec<&str> = line.split(',').collect();
                if parts.len() < 7 { continue; }
                result.push(Todo {
                    id: parts[0].to_string(),
                    title: parts[1].replace("\\,", ","),
                    level: parts[2].to_string(),
                    completed: parts[3].parse().unwrap_or(false),
                    created_at: parts[4].parse().unwrap_or(0),
                    due_at: parts[5].parse().ok(),
                    screen: parts[6].parse().unwrap_or(0),
                    recurrence: parts.get(7).and_then(|s| if s.is_empty() { None } else { Some(s.to_string()) }),
                });
            }
            result
        }
        _ => return Err("unsupported format".to_string()),
    };
    let count = imported.len();
    let mut todos = state.todos.lock().unwrap();
    todos.extend(imported);
    *state.dirty.lock().unwrap() = true;
    Ok(count)
}

fn register_global_shortcuts(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let shortcuts = [
        "Cmd+Shift+D",
        "Cmd+Shift+C",
        "Cmd+Shift+1",
        "Cmd+Shift+2",
        "Cmd+Shift+3",
    ];
    for s in shortcuts {
        let shortcut: Shortcut = s.parse().map_err(|e| format!("{e}"))?;
        app.global_shortcut().register(shortcut).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, shortcut, event| {
            if event.state == ShortcutState::Pressed {
                match shortcut.id {
                    0 => {
                        let _ = send_danmaku(app.clone(), "🔥".to_string(), "#ff6b6b".to_string(), 120.0, Some(0));
                    }
                    1 => {
                        let state = app.state::<AppState>();
                        let mut todos = state.todos.lock().unwrap();
                        if let Some(todo) = todos.iter_mut().find(|t| !t.completed) {
                            todo.completed = true;
                            *state.dirty.lock().unwrap() = true;
                            let _ = app.emit_to("main", "todos-updated", ());
                        }
                    }
                    2 => dispatch_by_level(app, "Quick Low", "low", 0),
                    3 => dispatch_by_level(app, "Quick Mid", "mid", 0),
                    4 => dispatch_by_level(app, "Quick High", "high", 0),
                    _ => {}
                }
            }
        }).build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let state = AppState::new();
            {
                let disk_todos = load_todos(app.handle());
                *state.todos.lock().unwrap() = disk_todos;
            }
            app.manage(state.clone());
            if let Err(e) = spawn_overlay_windows(app.handle()) {
                log::warn!("spawn overlay windows failed: {e}");
            }
            start_scheduler(app.handle().clone(), state.clone());
            start_persist_thread(app.handle().clone(), state);
            if let Err(e) = register_global_shortcuts(app.handle()) {
                log::warn!("register global shortcuts failed: {e}");
            }
            if let Err(e) = setup_tray(app.handle()) {
                log::warn!("setup tray failed: {e}");
            }
            hide_dock_icon(app.handle());
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
            todo_delete,
            export_todos,
            import_todos,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
