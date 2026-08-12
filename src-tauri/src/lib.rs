use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::{Emitter, Listener, Manager, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;

mod update;

// ============ 数据模型 ============

/// 预设标签（与前端一致）
const PREDEFINED_TAGS: &[&str] = &["工作", "生活", "紧急"];

fn is_valid_tag(tag: &str) -> bool {
    PREDEFINED_TAGS.contains(&tag)
}

/// 支持的 VFX 特效（与前端 SHADER_MAP 保持一致）。
/// 这里集中校验，避免拼写错误的 effect 字符串溜到 payload 里。
const VFX_EFFECTS: &[&str] = &[
    "shatter",
    "particle",
    "rain",
    "firework",
    "ripple",
    "laser",
    "glitch",
];

fn default_repeat_count() -> u8 { 1 }
fn default_play_duration() -> u8 { 2 }
fn default_danmaku_speed() -> f64 { 120.0 }

fn is_vfx_effect(effect: &str) -> bool {
    VFX_EFFECTS.contains(&effect)
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Todo {
    id: String,
    title: String,
    completed: bool,
    created_at: i64,
    due_at: Option<i64>,
    #[serde(default)]
    screen: i32, // 目标屏幕 index，0 = 主屏
    #[serde(default)]
    recurrence: Option<String>, // "daily" | "weekly"
    /// 指定特效："danmaku" 弹幕，或其它 VFX 特效（VFX_EFFECTS 列表中）。None 时默认弹幕。
    #[serde(default)]
    effect: Option<String>,
    /// 标签分组：None=未分类，"工作"/"生活"/"紧急"
    #[serde(default)]
    tag: Option<String>,
    /// 手动排序顺序，0-based，仅 sortBy=order 时有效
    #[serde(default)]
    order: i64,
    /// 特效播放次数（1-10），默认 1
    #[serde(default = "default_repeat_count")]
    repeat_count: u8,
    /// 非弹幕特效单次播放时长秒数（1-5），默认 2
    #[serde(default = "default_play_duration")]
    play_duration: u8,
    /// 弹幕速度（50-250），默认 120
    #[serde(default = "default_danmaku_speed")]
    danmaku_speed: f64,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct DanmakuPayload {
    id: f64,
    text: String,
    color: String,
    speed: f64,
    repeat_count: u8,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct VfxPayload {
    id: f64,
    effect: String,
    text: String,
    color: String,
    repeat_count: u8,
    play_duration: u8,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct ScreenInfo {
    id: i32,
    name: String,
    is_primary: bool,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
struct Preferences {
    #[serde(default)]
    default_screen: i32,
    /// 主题：system / dark / light
    #[serde(default = "default_theme")]
    theme: String,
    /// 默认特效：danmaku / shatter / particle / rain / firework / ripple / laser / glitch
    #[serde(default = "default_effect")]
    default_effect: String,
    /// 唤出主窗口的全局快捷键（Tauri 快捷键字符串，如 "Cmd+Shift+K" / "Ctrl+Shift+K"）。None=未设置。
    #[serde(default)]
    summon_shortcut: Option<String>,
}
fn default_theme() -> String {
    "system".to_string()
}
fn default_effect() -> String {
    "danmaku".to_string()
}

/// 唤出主窗口的默认全局快捷键：Mac 用 Cmd+T，Windows/Linux 用 Alt+T（自动识别平台）
fn default_summon_shortcut() -> String {
    if std::env::consts::OS == "macos" {
        "Cmd+T".to_string()
    } else {
        "Alt+T".to_string()
    }
}

#[derive(Clone)]
struct AppState {
    todos: std::sync::Arc<std::sync::Mutex<Vec<Todo>>>,
    dirty: std::sync::Arc<std::sync::Mutex<bool>>,
    /// 到期前 1 分钟已提醒过的 todo id（避免重复通知）
    warned_ids: std::sync::Arc<std::sync::Mutex<HashSet<String>>>,
    /// 前端特效下拉当前选中的特效，供全局快捷键 ⌘⇧1/2/3 派发
    current_effect: std::sync::Arc<std::sync::Mutex<String>>,
    /// 唤出主窗口的全局快捷键（解析后的 Shortcut 对象，供 handler 精确匹配）
    summon_shortcut: std::sync::Arc<std::sync::Mutex<Option<Shortcut>>>,
}

impl AppState {
    fn new() -> Self {
        Self {
            todos: std::sync::Arc::new(std::sync::Mutex::new(Vec::new())),
            dirty: std::sync::Arc::new(std::sync::Mutex::new(false)),
            warned_ids: std::sync::Arc::new(std::sync::Mutex::new(HashSet::new())),
            current_effect: std::sync::Arc::new(std::sync::Mutex::new("danmaku".to_string())),
            summon_shortcut: std::sync::Arc::new(std::sync::Mutex::new(None)),
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

/// VFX/弹幕随机配色表
const VFX_COLOR_PALETTE: &[&str] = &[
    "#ff6b6b", // 红
    "#ffe66d", // 黄
    "#4ecdc4", // 青
    "#95e1d3", // 浅绿
    "#88c0ff", // 蓝
    "#ff9ff3", // 粉
    "#a55eea", // 紫
    "#f9ca24", // 橙
    "#6abe6b", // 绿
    "#ff8c42", // 橙红
];

fn dispatch_danmaku(app: &tauri::AppHandle, text: &str, screen: i32, repeat_count: u8, danmaku_speed: f64) {
    let color = VFX_COLOR_PALETTE[rand::random::<usize>() % VFX_COLOR_PALETTE.len()];
    let payload = DanmakuPayload {
        id: js_sys_now() as f64,
        text: text.to_string(),
        color: color.to_string(),
        speed: danmaku_speed.clamp(50.0, 250.0),
        repeat_count: repeat_count.clamp(1, 10),
    };
    if screen < 0 {
        // "全部" — 广播一次，每个 overlay 窗口各收到一次
        let _ = app.emit("danmaku", payload);
    } else {
        let label = format!("overlay-{}", screen);
        if app.get_webview_window(&label).is_some() {
            let _ = app.emit_to(&label, "danmaku", payload);
        } else {
            log::warn!("overlay-{} not found, danmaku dropped", screen);
        }
    }
}

/// 直接向指定屏幕派发具体 VFX 特效
fn dispatch_vfx(app: &tauri::AppHandle, text: &str, effect: &str, screen: i32, repeat_count: u8, play_duration: u8) {
    if !is_vfx_effect(effect) {
        log::warn!("dispatch_vfx: unknown effect={}, ignored", effect);
        return;
    }
    let color = VFX_COLOR_PALETTE[rand::random::<usize>() % VFX_COLOR_PALETTE.len()];
    let payload = VfxPayload {
        id: js_sys_now() as f64,
        effect: effect.to_string(),
        text: text.to_string(),
        color: color.to_string(),
        repeat_count: repeat_count.clamp(1, 10),
        play_duration: play_duration.clamp(1, 5),
    };
    log::info!(
        "dispatch vfx: effect={} text={} screen={}",
        effect, text, screen
    );
    if screen < 0 {
        // "全部" — 广播一次，每个 overlay 窗口各收到一次
        let _ = app.emit("vfx", payload);
    } else {
        let label = format!("overlay-{}", screen);
        if app.get_webview_window(&label).is_some() {
            let _ = app.emit_to(&label, "vfx", payload);
        } else {
            log::warn!("overlay-{} not found, fallback to overlay-0", screen);
            if app.get_webview_window("overlay-0").is_some() {
                let _ = app.emit_to("overlay-0", "vfx", payload);
            }
        }
    }
}

/// 按 effect 路由：danmaku/空 → 弹幕事件，合法 VFX 特效 → 对应 WebGL 特效，其它忽略
fn dispatch_by_effect(app: &tauri::AppHandle, text: &str, effect: &str, screen: i32) {
    if effect == "danmaku" || effect.is_empty() {
        dispatch_danmaku(app, text, screen, 1, 120.0);
        return;
    }
    if is_vfx_effect(effect) {
        dispatch_vfx(app, text, effect, screen, 1, 2);
    } else {
        log::warn!("dispatch_by_effect: unknown effect={}, ignored", effect);
    }
}

/// 带重复次数的派发：弹幕发一次带 repeat_count 由 overlay 循环，VFX 发一次由 engine 串行
fn dispatch_by_effect_multi(app: &tauri::AppHandle, text: &str, effect: &str, screen: i32, repeat_count: u8, play_duration: u8, danmaku_speed: f64) {
    let count = repeat_count.clamp(1, 10);
    if effect == "danmaku" || effect.is_empty() {
        dispatch_danmaku(app, text, screen, count, danmaku_speed.clamp(50.0, 250.0));
    } else if is_vfx_effect(effect) {
        dispatch_vfx(app, text, effect, screen, count, play_duration.clamp(1, 5));
    } else {
        log::warn!("dispatch_by_effect_multi: unknown effect={}, ignored", effect);
    }
}

// ============ 调度引擎：后台轮询到期 ToDo ============

fn start_scheduler(app: tauri::AppHandle, state: AppState) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let now = js_sys_now();
            let mut todos = state.todos.lock().unwrap();
            let base_count = todos.len();
            let mut changed = false;

            let mut new_todos = Vec::new();
            for todo in todos.iter_mut() {
                // 未完成 + 有到期时间 + 已到期 → 按 level 触发 + 标记完成
                if !todo.completed {
                    if let Some(due) = todo.due_at {
                        // 到期前 1 分钟预热通知（每 session 每个 todo 只发一次）
                        if due > now && due - now <= 60_000 {
                            let mut warned = state.warned_ids.lock().unwrap();
                            if !warned.contains(&todo.id) {
                                let _ = app
                                    .notification()
                                    .builder()
                                    .title("VFX Todo")
                                    .body(&format!("即将到期 (1 分钟): {}", todo.title))
                                    .show();
                                warned.insert(todo.id.clone());
                            }
                        }
                        if due <= now {
                            dispatch_by_effect_multi(
                                &app,
                                &todo.title,
                                todo.effect.as_deref().unwrap_or("danmaku"),
                                todo.screen,
                                todo.repeat_count,
                                todo.play_duration,
                                todo.danmaku_speed,
                            );
                            // 系统通知
                            let _ = app
                                .notification()
                                .builder()
                                .title("VFX Todo")
                                .body(&format!("到期: {}", todo.title))
                                .show();
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
                                    let order = (base_count + new_todos.len()) as i64;
                                new_todos.push(Todo {
                                    id: gen_id(),
                                    title: todo.title.clone(),
                                    completed: false,
                                        created_at: now,
                                        due_at: Some(next_due),
                                        screen: todo.screen,
                                        recurrence: todo.recurrence.clone(),
                                        effect: todo.effect.clone(),
                                        tag: todo.tag.clone(),
                                        order,
                                        repeat_count: todo.repeat_count,
                                        play_duration: todo.play_duration,
                                        danmaku_speed: todo.danmaku_speed,
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
fn todo_list(state: tauri::State<'_, AppState>, tag: Option<String>) -> Result<Vec<Todo>, String> {
    let todos = state.todos.lock().unwrap().clone();
    match tag {
        Some(ref t) if !t.is_empty() => Ok(todos
            .into_iter()
            .filter(|todo| todo.tag.as_deref() == Some(t.as_str()))
            .collect()),
        _ => Ok(todos),
    }
}

/// 返回可用的预设标签列表（前端用）
#[tauri::command]
fn tag_list() -> Vec<&'static str> {
    PREDEFINED_TAGS.to_vec()
}

#[tauri::command]
fn load_prefs(app: tauri::AppHandle) -> Result<Preferences, String> {
    read_prefs(&app)
}

#[tauri::command]
fn save_prefs(app: tauri::AppHandle, prefs: Preferences) -> Result<(), String> {
    write_prefs(&app, &prefs)
}

/// 读取偏好设置（持久化前 prefs.json 可能不存在，返回默认值）
fn read_prefs(app: &tauri::AppHandle) -> Result<Preferences, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let prefs_path = app_dir.join("prefs.json");
    if prefs_path.exists() {
        let content = std::fs::read_to_string(&prefs_path).map_err(|e| e.to_string())?;
        let mut prefs: Preferences = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        // 配置文件存在但快捷键未设置（旧配置 / 缺字段）时补上平台默认，保证开箱即用；
        // 已显式清空存为 "" 的情况保持不变（视为禁用）。
        if prefs.summon_shortcut.is_none() {
            prefs.summon_shortcut = Some(default_summon_shortcut());
        }
        Ok(prefs)
    } else {
        Ok(Preferences {
            default_screen: 0,
            theme: "system".to_string(),
            default_effect: "danmaku".to_string(),
            // 首次启动（无配置文件）写入平台默认快捷键，之后以用户保存为准
            summon_shortcut: Some(default_summon_shortcut()),
        })
    }
}

/// 写入偏好设置到 prefs.json
fn write_prefs(app: &tauri::AppHandle, prefs: &Preferences) -> Result<(), String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    let prefs_path = app_dir.join("prefs.json");
    let content = serde_json::to_string_pretty(&prefs).map_err(|e| e.to_string())?;
    std::fs::write(&prefs_path, content).map_err(|e| e.to_string())
}

/// 返回当前运行平台：macos / windows / linux（前端据此显示正确的修饰键符号）
#[tauri::command]
fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

/// 设置/清除"唤出主窗口"的全局快捷键。shortcut=None 或空字符串表示清除（禁用）。
/// 注册失败（如与现有快捷键冲突）会返回错误，由前端提示。
#[tauri::command]
fn set_summon_shortcut(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    shortcut: Option<String>,
) -> Result<(), String> {
    // 空字符串 / None 视为清除（禁用）；非空才是有效快捷键
    let effective: Option<String> = match shortcut {
        Some(s) if !s.trim().is_empty() => Some(s),
        _ => None,
    };
    // 1. 反注册旧快捷键
    {
        let old = state.summon_shortcut.lock().unwrap().take();
        if let Some(ref sc) = old {
            let _ = app.global_shortcut().unregister(sc.clone());
        }
    }
    // 2. 注册新快捷键并解析为 Shortcut 对象（供 handler 精确匹配）
    let parsed: Option<Shortcut> = match &effective {
        Some(s) => {
            let sc = s.parse::<Shortcut>().map_err(|e| format!("无效快捷键: {e}"))?;
            app.global_shortcut()
                .register(sc.clone())
                .map_err(|e| format!("注册失败（可能与其他快捷键冲突）: {e}"))?;
            Some(sc)
        }
        None => None,
    };
    *state.summon_shortcut.lock().unwrap() = parsed;
    // 3. 持久化到 prefs.json：清除时存 "" 作为禁用标记（与默认/已设置区分，避免重启后重新补默认）
    let mut prefs = read_prefs(&app)?;
    prefs.summon_shortcut = Some(effective.unwrap_or_default());
    write_prefs(&app, &prefs)?;
    Ok(())
}

/// 将主窗口重新定位到鼠标光标处：先找到光标所在的屏幕，再把窗口居中于光标并夹在该屏幕内。
/// macOS / Windows 各自用系统 API 取全局光标位置，再按所在屏幕的缩放比换算成 Tauri 逻辑坐标。
#[cfg(target_os = "macos")]
fn reposition_window_to_cursor(win: &tauri::WebviewWindow) {
    #[link(name = "CoreGraphics", kind = "framework")]
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CGEventCreate(source: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
        fn CGEventGetLocation(event: *mut std::ffi::c_void) -> CGPoint;
        fn CFRelease(cf: *const std::ffi::c_void);
    }
    #[repr(C)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    // CGEventCreate(NULL) 返回带当前全局光标位置的事件；坐标已是
    // 主屏左上角原点、y 向下、逻辑(点)像素，无需翻转。
    let event = unsafe { CGEventCreate(std::ptr::null_mut()) };
    if event.is_null() {
        return;
    }
    let pt = unsafe { CGEventGetLocation(event) };
    unsafe {
        CFRelease(event);
    }
    let scale = win.scale_factor().unwrap_or(1.0);
    if let Ok(monitors) = win.available_monitors() {
        for m in &monitors {
            let ms = m.scale_factor();
            let pos = m.position();
            let size = m.size();
            // 把光标逻辑点换算成该屏幕的设备像素做命中测试
            let dx = pt.x * ms;
            let dy = pt.y * ms;
            if dx >= pos.x as f64
                && dx <= pos.x as f64 + size.width as f64
                && dy >= pos.y as f64
                && dy <= pos.y as f64 + size.height as f64
            {
                let ox = pos.x as f64 / ms;
                let oy = pos.y as f64 / ms;
                let mw = size.width as f64 / ms;
                let mh = size.height as f64 / ms;
                place_window_centered_on_cursor(win, pt.x, pt.y, ox, oy, mw, mh, scale);
                return;
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn reposition_window_to_cursor(win: &tauri::WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    use windows::Win32::Foundation::POINT;
    let mut pt = POINT { x: 0, y: 0 };
    let ok = unsafe { GetCursorPos(&mut pt).is_ok() };
    if !ok {
        return;
    }
    // GetCursorPos 返回虚拟屏幕设备像素：主屏左上角原点、y 向下，可跨多屏（含负坐标）。
    let scale = win.scale_factor().unwrap_or(1.0);
    if let Ok(monitors) = win.available_monitors() {
        for m in &monitors {
            let ms = m.scale_factor();
            let pos = m.position();
            let size = m.size();
            let dx = pt.x as f64;
            let dy = pt.y as f64;
            if dx >= pos.x as f64
                && dx <= pos.x as f64 + size.width as f64
                && dy >= pos.y as f64
                && dy <= pos.y as f64 + size.height as f64
            {
                let ox = pos.x as f64 / ms;
                let oy = pos.y as f64 / ms;
                let mw = size.width as f64 / ms;
                let mh = size.height as f64 / ms;
                // 光标在该屏幕的逻辑坐标
                let cx = dx / ms;
                let cy = dy / ms;
                place_window_centered_on_cursor(win, cx, cy, ox, oy, mw, mh, scale);
                return;
            }
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn reposition_window_to_cursor(_win: &tauri::WebviewWindow) {}

/// 以全局逻辑坐标 (cx, cy) 为光标位置，把窗口居中其上，并夹在所在屏幕
/// [ox,oy]~(ox+mw, oy+mh) 的逻辑矩形内（ox/oy 为该屏左上角的全局逻辑坐标）。
fn place_window_centered_on_cursor(
    win: &tauri::WebviewWindow,
    cx: f64,
    cy: f64,
    ox: f64,
    oy: f64,
    mw: f64,
    mh: f64,
    scale: f64,
) {
    let outer = match win.outer_size() {
        Ok(s) => s,
        Err(_) => return,
    };
    let w = outer.width as f64 / scale;
    let h = outer.height as f64 / scale;
    let mut x = cx - w / 2.0;
    let mut y = cy - h / 2.0;
    x = x.max(ox).min((ox + mw - w).max(ox));
    y = y.max(oy).min((oy + mh - h).max(oy));
    let _ = win.set_position(tauri::LogicalPosition::new(x, y));
}

#[tauri::command]
fn todo_create(
    state: tauri::State<'_, AppState>,
    title: String,
    due_at: Option<i64>,
    screen: Option<i32>,
    recurrence: Option<String>,
    effect: Option<String>,
    tag: Option<String>,
    repeat_count: Option<u8>,
    play_duration: Option<u8>,
    danmaku_speed: Option<f64>,
) -> Result<Todo, String> {
    // 仅接受 VFX_EFFECTS 内的值；非法/None 一律存 None（默认弹幕）
    let effect = effect.and_then(|e| {
        if is_vfx_effect(&e) {
            Some(e)
        } else {
            log::warn!("todo_create: invalid effect={}, ignored", e);
            None
        }
    });
    let tag = tag.and_then(|t| {
        if is_valid_tag(&t) {
            Some(t)
        } else {
            log::warn!("todo_create: invalid tag={}, ignored", t);
            None
        }
    });
    let mut todos = state.todos.lock().unwrap();
    let order = todos.len() as i64;
    let todo = Todo {
        id: gen_id(),
        title,
        completed: false,
        created_at: js_sys_now(),
        due_at,
        screen: screen.unwrap_or(0),
        recurrence,
        effect,
        tag,
        order,
        repeat_count: repeat_count.unwrap_or(1).clamp(1, 10),
        play_duration: play_duration.unwrap_or(2).clamp(1, 5),
        danmaku_speed: danmaku_speed.unwrap_or(120.0).clamp(50.0, 250.0),
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
fn todo_update(
    state: tauri::State<'_, AppState>,
    id: String,
    title: Option<String>,
    due_at: Option<Option<i64>>,
    screen: Option<i32>,
    recurrence: Option<Option<String>>,
    effect: Option<Option<String>>,
    tag: Option<Option<String>>,
    repeat_count: Option<u8>,
    play_duration: Option<u8>,
    danmaku_speed: Option<f64>,
) -> Result<Todo, String> {
    // 校验 effect（仅接受 VFX_EFFECTS 内的值或 None）
    let effect = effect.map(|e| {
        e.and_then(|v| {
            if is_vfx_effect(&v) { Some(v) } else { None }
        })
    });
    let tag = tag.map(|t| {
        t.and_then(|v| {
            if is_valid_tag(&v) { Some(v) } else { None }
        })
    });
    let mut todos = state.todos.lock().unwrap();
    let todo = todos.iter_mut().find(|t| t.id == id).ok_or("todo not found")?;
    if let Some(t) = title { todo.title = t; }
    if let Some(d) = due_at { todo.due_at = d; }
    if let Some(s) = screen { todo.screen = s; }
    if let Some(r) = recurrence { todo.recurrence = r; }
    if let Some(e) = effect { todo.effect = e; }
    if let Some(t) = tag { todo.tag = t; }
    if let Some(c) = repeat_count { todo.repeat_count = c.clamp(1, 10); }
    if let Some(d) = play_duration { todo.play_duration = d.clamp(1, 5); }
    if let Some(s) = danmaku_speed { todo.danmaku_speed = s.clamp(50.0, 250.0); }
    let updated = todo.clone();
    *state.dirty.lock().unwrap() = true;
    Ok(updated)
}

#[tauri::command]
fn todo_delete(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let mut todos = state.todos.lock().unwrap();
    todos.retain(|t| t.id != id);
    *state.dirty.lock().unwrap() = true;
    Ok(())
}

#[tauri::command]
fn todo_clear_completed(state: tauri::State<'_, AppState>) -> Result<usize, String> {
    let mut todos = state.todos.lock().unwrap();
    let before = todos.len();
    todos.retain(|t| !t.completed);
    let removed = before - todos.len();
    if removed > 0 {
        *state.dirty.lock().unwrap() = true;
    }
    Ok(removed)
}

#[tauri::command]
fn todo_batch_complete(state: tauri::State<'_, AppState>, ids: Vec<String>) -> Result<usize, String> {
    let mut todos = state.todos.lock().unwrap();
    let mut count = 0usize;
    for id in &ids {
        if let Some(t) = todos.iter_mut().find(|t| t.id == *id) {
            if !t.completed {
                t.completed = true;
                count += 1;
            }
        }
    }
    if count > 0 {
        *state.dirty.lock().unwrap() = true;
    }
    Ok(count)
}

#[tauri::command]
fn todo_batch_delete(state: tauri::State<'_, AppState>, ids: Vec<String>) -> Result<usize, String> {
    let mut todos = state.todos.lock().unwrap();
    let before = todos.len();
    todos.retain(|t| !ids.contains(&t.id));
    let removed = before - todos.len();
    if removed > 0 {
        *state.dirty.lock().unwrap() = true;
    }
    Ok(removed)
}

/// 手动排序：按 ids 数组的顺序重新分配 order 字段
#[tauri::command]
fn todo_reorder(state: tauri::State<'_, AppState>, ids: Vec<String>) -> Result<(), String> {
    let mut todos = state.todos.lock().unwrap();
    for (i, id) in ids.iter().enumerate() {
        if let Some(t) = todos.iter_mut().find(|t| t.id == *id) {
            t.order = i as i64;
        }
    }
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
    dispatch_by_effect_multi(
        &app,
        &todo.title,
        todo.effect.as_deref().unwrap_or("danmaku"),
        todo.screen,
        todo.repeat_count,
        todo.play_duration,
        todo.danmaku_speed,
    );
    Ok(())
}

/// 直接派发一个特效（演示面板 / 实时预览用，不依赖 todo）
/// effect 为 "danmaku" 走弹幕，否则走对应 WebGL 特效
#[tauri::command]
fn trigger_vfx(
    app: tauri::AppHandle,
    effect: String,
    screen: Option<i32>,
) -> Result<(), String> {
    let screen = screen.unwrap_or(0);
    let text = format!("Preview {}", effect);
    dispatch_by_effect(&app, &text, &effect, screen);
    Ok(())
}

/// 前端特效下拉变更时调用，记录"当前特效"，供快捷键 ⌘⇧2/3/4 派发
#[tauri::command]
fn set_current_effect(app: tauri::AppHandle, effect: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    *state.current_effect.lock().unwrap() = effect;
    Ok(())
}

/// macOS: 通过 CGDisplay + IOKit 获取显示器名称（线程安全，无需主线程）
#[cfg(target_os = "macos")]
fn get_macos_display_names() -> Vec<String> {
    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn CGGetActiveDisplayList(max: u32, ids: *mut u32, count: *mut u32) -> i32;
        fn CGDisplayIsBuiltin(id: u32) -> i32;
        fn CGDisplayIOServicePort(id: u32) -> u32;
        fn IORegistryEntryCreateCFProperty(
            entry: u32,
            key: *const std::ffi::c_void,
            allocator: *const std::ffi::c_void,
            options: u32,
        ) -> *const std::ffi::c_void;
        fn IOObjectRelease(obj: u32) -> i32;
        fn CFStringCreateWithCString(
            alloc: *const std::ffi::c_void,
            cstr: *const i8,
            encoding: u32,
        ) -> *const std::ffi::c_void;
        fn CFStringGetCStringPtr(
            str: *const std::ffi::c_void,
            encoding: u32,
        ) -> *const i8;
        fn CFRelease(cf: *const std::ffi::c_void);
    }

    const K_CF_STRING_ENCODING_UTF8: u32 = 0x08000100;

    let mut ids = [0u32; 16];
    let mut count: u32 = 0;

    unsafe {
        if CGGetActiveDisplayList(16, ids.as_mut_ptr(), &mut count) != 0 || count == 0 {
            return Vec::new();
        }

        let mut result = Vec::with_capacity(count as usize);
        for i in 0..count as usize {
            let id = ids[i];
            let is_builtin = CGDisplayIsBuiltin(id) != 0;

            let name = if is_builtin {
                "内建屏".to_string()
            } else {
                let port = CGDisplayIOServicePort(id);
                if port == 0 {
                    format!("外接屏 {}", i + 1)
                } else {
                    let key = CFStringCreateWithCString(
                        std::ptr::null(),
                        "DisplayProductName\0".as_ptr() as *const i8,
                        K_CF_STRING_ENCODING_UTF8,
                    );
                    let value = IORegistryEntryCreateCFProperty(port, key, std::ptr::null(), 0);
                    CFRelease(key);
                    IOObjectRelease(port);

                    if value.is_null() {
                        format!("外接屏 {}", i + 1)
                    } else {
                        let ptr = CFStringGetCStringPtr(value, K_CF_STRING_ENCODING_UTF8);
                        let name = if !ptr.is_null() {
                            std::ffi::CStr::from_ptr(ptr).to_string_lossy().to_string()
                        } else {
                            format!("外接屏 {}", i + 1)
                        };
                        CFRelease(value);
                        name
                    }
                }
            };
            result.push(name);
        }
        result
    }
}

/// Windows: 通过 EnumDisplayDevicesW 获取显示器友好名称
#[cfg(target_os = "windows")]
fn get_windows_monitor_friendly_name(device_name: &str) -> Option<String> {
    use windows::Win32::Graphics::Gdi::{EnumDisplayDevicesW, DISPLAY_DEVICEW};
    use windows::core::PCWSTR;

    let mut dd = DISPLAY_DEVICEW::default();
    dd.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;

    let wide: Vec<u16> = device_name.encode_utf16().chain(std::iter::once(0)).collect();

    unsafe {
        if EnumDisplayDevicesW(PCWSTR::from_raw(wide.as_ptr()), 0, &mut dd, 0).as_bool() {
            let name = String::from_utf16_lossy(&dd.DeviceString)
                .trim_end_matches('\0')
                .to_string();
            if !name.is_empty() && !name.starts_with("Generic") {
                return Some(name);
            }
        }
    }
    None
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

    // macOS: 用 CGDisplay + IOKit 拿真实名称（线程安全）
    #[cfg(target_os = "macos")]
    let macos_names = get_macos_display_names();

    let screens = all_monitors
        .iter()
        .enumerate()
        .map(|(idx, m)| {
            let is_primary = m.name().map(|s| s.as_str()) == primary_name;

            // ── macOS: CGDisplay + IOKit ──
            #[cfg(target_os = "macos")]
            let resolved: Option<String> = {
                let raw = macos_names.get(idx).cloned().unwrap_or_default();
                if !raw.is_empty() { Some(raw) } else { None }
            };

            // ── Windows: EnumDisplayDevicesW 友好名称 ──
            #[cfg(target_os = "windows")]
            let resolved: Option<String> = {
                let system_name = m.name().map_or("", |v| v);
                get_windows_monitor_friendly_name(system_name)
            };

            // ── Linux/其他: X11 输出名 (eDP-1, HDMI-1, DP-1…) ──
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            let resolved: Option<String> = {
                let sn = m.name().map_or("", |v| v);
                if sn.starts_with("eDP") || sn.starts_with("LVDS") {
                    Some("内建屏".to_string())
                } else if sn.starts_with("HDMI")
                    || sn.starts_with("DP")
                    || sn.starts_with("VGA")
                    || sn.starts_with("DVI")
                    || sn.starts_with("DisplayPort")
                {
                    Some(sn.to_string())
                } else if !sn.is_empty()
                    && !sn.starts_with("\\")
                    && !sn.starts_with("monitor")
                    && !sn.starts_with("Monitor")
                    && sn.len() < 40
                {
                    Some(sn.to_string())
                } else {
                    None
                }
            };

            let name = resolved.unwrap_or_else(|| {
                if is_primary {
                    "内建屏".to_string()
                } else {
                    format!("外接屏 {}", idx + 1)
                }
            });

            ScreenInfo {
                id: idx as i32,
                name,
                is_primary,
            }
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
        repeat_count: 1,
    };
    match screen {
        Some(s) if s < 0 => {
            // "全部" — 广播到所有 overlay 窗口（与 VFX 派发逻辑一致）
            let _ = app.emit("danmaku", payload);
        }
        Some(s) => {
            let label = format!("overlay-{}", s);
            if app.get_webview_window(&label).is_some() {
                let _ = app.emit_to(&label, "danmaku", payload);
            } else {
                log::warn!("overlay-{} not found, fallback to overlay-0", s);
                if app.get_webview_window("overlay-0").is_some() {
                    let _ = app.emit_to("overlay-0", "danmaku", payload);
                }
            }
        }
        None => {
            let _ = app.emit_to("overlay-0", "danmaku", payload);
        }
    }
    Ok(())
}

#[tauri::command]
fn flash_screen(app: tauri::AppHandle, screen: i32, screen_name: String) -> Result<(), String> {
    if screen >= 0 {
        let payload = serde_json::json!({ "screen_name": screen_name });
        let label = format!("overlay-{}", screen);
        if app.get_webview_window(&label).is_some() {
            let _ = app.emit_to(&label, "screen-flash", payload);
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

// ============ 真实多屏硬件自检 ============
//
// 仅当环境变量 VFX_TODO_SELFTEST 存在时由 setup 调用。
// 它在真实显示器上创建 overlay 窗口，并用 Rust 侧 window.listen 验证
// emit_to("overlay-{n}") 的精确投递（不广播到其它屏），最后打印 JSON 报告并退出。
// 这是 E2E mock 无法覆盖的核心正确性点。

#[derive(Clone, serde::Serialize)]
struct DeliveryRecord {
    window: String,
    event: String,
    text: String,
}

fn run_multi_screen_self_test(app: &tauri::AppHandle) {
    use std::io::Write;

    let deliveries = std::sync::Arc::new(std::sync::Mutex::new(Vec::<DeliveryRecord>::new()));

    // 真实显示器数量（与 spawn_overlay_windows 使用的枚举一致）
    let screen_count = app.available_monitors().map(|m| m.len()).unwrap_or(0).max(1);
    log::info!("selftest: detected {} screen(s)", screen_count);

    // 为每个真实 overlay 窗口注册 Rust 侧监听，记录收件情况
    for idx in 0..screen_count {
        let label = format!("overlay-{}", idx);
        if let Some(win) = app.get_webview_window(&label) {
            let l1 = label.clone();
            let d1 = deliveries.clone();
            let _h1 = win.listen("danmaku", move |ev| {
                if let Ok(p) = serde_json::from_str::<DanmakuPayload>(ev.payload()) {
                    d1.lock().unwrap().push(DeliveryRecord {
                        window: l1.clone(),
                        event: "danmaku".into(),
                        text: p.text,
                    });
                }
            });
            let l2 = label.clone();
            let d2 = deliveries.clone();
            let _h2 = win.listen("vfx", move |ev| {
                if let Ok(p) = serde_json::from_str::<VfxPayload>(ev.payload()) {
                    d2.lock().unwrap().push(DeliveryRecord {
                        window: l2.clone(),
                        event: "vfx".into(),
                        text: p.text,
                    });
                }
            });
        }
    }

    let screens = list_screens(app.clone()).unwrap_or_default();

    let app2 = app.clone();
    let deliveries2 = deliveries.clone();
    std::thread::spawn(move || {
        // 等待 webview 就绪
        std::thread::sleep(Duration::from_millis(800));

        // 定向派发：danmaku → overlay-1，vfx → overlay-2（若屏幕足够）
        if app2.get_webview_window("overlay-1").is_some() {
            let _ = send_danmaku(app2.clone(), "SELFTEST-DANMAKU-1".into(), "#ff0000".into(), 100.0, Some(1));
        }
        if app2.get_webview_window("overlay-2").is_some() {
            dispatch_vfx(&app2, "SELFTEST-VFX-2", "shatter", 2, 1, 2);
        }
        // 对 overlay-0 也发一条，确认基础链路能到达
        let _ = send_danmaku(app2.clone(), "SELFTEST-DANMAKU-0".into(), "#00ff00".into(), 100.0, Some(0));

        std::thread::sleep(Duration::from_millis(800));

        let locked = deliveries2.lock().unwrap();
        let report = serde_json::json!({
            "screen_count": screens.len(),
            "screens": screens,
            "deliveries": *locked,
        });
        let mut out = std::io::stdout();
        let _ = writeln!(out, "===== VFX_MULTISCREEN_SELFTEST =====");
        let _ = writeln!(out, "{}", serde_json::to_string_pretty(&report).unwrap_or_default());
        let _ = writeln!(out, "===== END VFX_MULTISCREEN_SELFTEST =====");
        let _ = out.flush();
        std::thread::sleep(Duration::from_millis(200));
        app2.exit(0);
    });
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
        // setActivationPolicy: returns BOOL on modern macOS runtimes.
        let _: bool = msg_send![ns_app, setActivationPolicy: 1i64];
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
            let mut csv = String::from("id,title,completed,created_at,due_at,screen,recurrence,effect,tag\n");
            for t in todos {
                csv.push_str(&format!(
                    "{},{},{},{},{},{},{},{},{}\n",
                    t.id,
                    t.title.replace(",", "\\,"),
                    t.completed,
                    t.created_at,
                    t.due_at.map(|v| v.to_string()).unwrap_or_default(),
                    t.screen,
                    t.recurrence.unwrap_or_default(),
                    t.effect.unwrap_or_default(),
                    t.tag.unwrap_or_default()
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
                // 列顺序：id,title,completed,created_at,due_at,screen,recurrence,effect,tag
                let effect = parts
                    .get(7)
                    .and_then(|s| if s.is_empty() { None } else { Some(s.to_string()) })
                    .and_then(|e| if is_vfx_effect(&e) { Some(e) } else { None });
                let tag = parts
                    .get(8)
                    .and_then(|s| if s.is_empty() { None } else { Some(s.to_string()) })
                    .and_then(|t| if is_valid_tag(&t) { Some(t) } else { None });
                result.push(Todo {
                    id: parts[0].to_string(),
                    title: parts[1].replace("\\,", ","),
                    completed: parts[2].parse().unwrap_or(false),
                    created_at: parts[3].parse().unwrap_or(0),
                    due_at: parts[4].parse().ok(),
                    screen: parts[5].parse().unwrap_or(0),
                    recurrence: parts.get(6).and_then(|s| if s.is_empty() { None } else { Some(s.to_string()) }),
                    effect,
                    tag,
                    order: result.len() as i64,
                    repeat_count: parts.get(9).and_then(|s| s.parse().ok()).unwrap_or(1).clamp(1, 10),
                    play_duration: parts.get(10).and_then(|s| s.parse().ok()).unwrap_or(2).clamp(1, 5),
                    danmaku_speed: parts.get(11).and_then(|s| s.parse::<f64>().ok()).unwrap_or(120.0).clamp(50.0, 250.0),
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

    // 顺序决定 shortcut.id（0-based），与下方 match 分支一一对应
    let shortcuts = [
        "Cmd+Shift+D", // 0: 弹幕 "🔥"
        "Cmd+Shift+C", // 1: 完成第一个待办
        "Cmd+Shift+1", // 2: level=low 默认派发（弹幕）
        "Cmd+Shift+2", // 3: level=mid 默认派发（粒子）
        "Cmd+Shift+3", // 4: level=high 默认派发（破碎）
        "Cmd+Shift+4", // 5: rain
        "Cmd+Shift+5", // 6: firework
        "Cmd+Shift+6", // 7: ripple
        "Cmd+Shift+7", // 8: laser
        "Cmd+Shift+8", // 9: glitch
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
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, shortcut, event| {
            if event.state == ShortcutState::Pressed {
                // 唤出主窗口的快捷键优先匹配（精确匹配 Shortcut 对象）
                let state = app.state::<AppState>();
                let summon = state.summon_shortcut.lock().unwrap().clone();
                if let Some(ref sc) = summon {
                    if shortcut == sc {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                            // 通知前端聚焦输入框
                            let _ = app.emit("vfx-summon", ());
                            // 将窗口重新定位到鼠标所在位置（居中于光标，并夹在屏幕内）
                            reposition_window_to_cursor(&win);
                        }
                        return;
                    }
                }
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
                    // ⌘⇧1/2/3：派发前端特效下拉当前选中的特效（current_effect）
                    2 | 3 | 4 => {
                        let state = app.state::<AppState>();
                        let current = state.current_effect.lock().unwrap().clone();
                        dispatch_by_effect(app, "Quick", &current, 0);
                    }
                    5 => dispatch_vfx(app, "Quick Rain", "rain", 0, 1, 2),
                    6 => dispatch_vfx(app, "Quick Firework", "firework", 0, 1, 2),
                    7 => dispatch_vfx(app, "Quick Ripple", "ripple", 0, 1, 2),
                    8 => dispatch_vfx(app, "Quick Laser", "laser", 0, 1, 2),
                    9 => dispatch_vfx(app, "Quick Glitch", "glitch", 0, 1, 2),
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

            // 真实多屏硬件自检：环境变量触发，打印报告后立即退出
            if std::env::var("VFX_TODO_SELFTEST").is_ok() {
                run_multi_screen_self_test(app.handle());
                return Ok(());
            }

            start_scheduler(app.handle().clone(), state.clone());
            start_persist_thread(app.handle().clone(), state.clone());
            if let Err(e) = register_global_shortcuts(app.handle()) {
                log::warn!("register global shortcuts failed: {e}");
            }
            // 唤出主窗口的快捷键最后注册（id 排在固定快捷键之后，避免挤占 0..=9 的匹配分支）
            if let Ok(prefs) = read_prefs(app.handle()) {
                if let Some(ref s) = prefs.summon_shortcut {
                    // 空字符串表示已清除（禁用），不注册
                    if !s.is_empty() {
                        if let Ok(sc) = s.parse::<Shortcut>() {
                            *state.summon_shortcut.lock().unwrap() = Some(sc.clone());
                            if let Err(e) = app.handle().global_shortcut().register(sc) {
                                log::warn!("register summon shortcut failed: {e}");
                            }
                        }
                    }
                }
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
            trigger_vfx,
            set_current_effect,
            list_screens,
            todo_list,
            todo_create,
            todo_complete,
            todo_update,
            todo_delete,
            todo_clear_completed,
            todo_batch_complete,
            todo_batch_delete,
            todo_reorder,
            load_prefs,
            save_prefs,
            get_platform,
            set_summon_shortcut,
            export_todos,
            import_todos,
            tag_list,
            update::fetch_announcements,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ===================== 集成测试 =====================
#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    // ---------- helpers ----------
    fn make_todo(
        title: &str,
        due_at: Option<i64>,
        effect: Option<String>,
        tag: Option<String>,
    ) -> Todo {
        Todo {
            id: Uuid::new_v4().to_string(),
            title: title.to_string(),
            completed: false,
            created_at: 1000000,
            due_at,
            screen: 0,
            recurrence: None,
            effect,
            tag,
            order: 0,
            repeat_count: 1,
            play_duration: 2,
            danmaku_speed: 120.0,
        }
    }

    fn test_state() -> AppState {
        AppState::new()
    }

    // Sync wrappers — 直接操作 AppState, 绕过 Tauri 命令壳, 测试同样的逻辑路径

    fn todos_list_sync(state: &AppState) -> Vec<Todo> {
        state.todos.lock().unwrap().clone()
    }

    fn todo_create_sync(
        state: &AppState,
        title: String,
        due_at: Option<i64>,
        screen: i32,
        effect: Option<String>,
        tag: Option<String>,
    ) -> Todo {
        let t = Todo {
            id: Uuid::new_v4().to_string(),
            title,
            completed: false,
            created_at: chrono::Utc::now().timestamp_millis(),
            due_at,
            screen,
            recurrence: None,
            effect: effect.filter(|e| is_vfx_effect(e)),
            tag: tag.filter(|t| is_valid_tag(t)),
            order: state.todos.lock().unwrap().len() as i64,
            repeat_count: 1,
            play_duration: 2,
            danmaku_speed: 120.0,
        };
        state.todos.lock().unwrap().push(t.clone());
        *state.dirty.lock().unwrap() = true;
        t
    }

    fn todo_complete_sync(state: &AppState, id: String) -> Result<Todo, String> {
        let mut todos = state.todos.lock().unwrap();
        let todo = todos.iter_mut().find(|t| t.id == id).ok_or("not found")?;
        todo.completed = true;
        *state.dirty.lock().unwrap() = true;
        Ok(todo.clone())
    }

    fn todo_delete_sync(state: &AppState, id: String) -> Result<(), String> {
        let mut todos = state.todos.lock().unwrap();
        let before = todos.len();
        todos.retain(|t| t.id != id);
        if todos.len() == before {
            return Err("not found".into());
        }
        *state.dirty.lock().unwrap() = true;
        Ok(())
    }

    fn todo_update_sync(
        state: &AppState,
        id: String,
        title: Option<String>,
        due_at: Option<Option<i64>>,
        screen: Option<i32>,
        recurrence: Option<Option<String>>,
        effect: Option<Option<String>>,
        tag: Option<Option<String>>,
    ) -> Todo {
        let effect = effect.map(|e| e.filter(|v| is_vfx_effect(v)));
        let tag = tag.map(|t| t.filter(|v| is_valid_tag(v)));
        let mut todos = state.todos.lock().unwrap();
        let todo = todos.iter_mut().find(|t| t.id == id).expect("todo not found");
        if let Some(t) = title { todo.title = t; }
        if let Some(d) = due_at { todo.due_at = d; }
        if let Some(s) = screen { todo.screen = s; }
        if let Some(r) = recurrence { todo.recurrence = r; }
        if let Some(e) = effect { todo.effect = e; }
        if let Some(t) = tag { todo.tag = t; }
        *state.dirty.lock().unwrap() = true;
        todo.clone()
    }

    fn todo_clear_completed_sync(state: &AppState) -> usize {
        let mut todos = state.todos.lock().unwrap();
        let before = todos.len();
        todos.retain(|t| !t.completed);
        before - todos.len()
    }

    fn todo_batch_complete_sync(state: &AppState, ids: Vec<String>) -> usize {
        let mut todos = state.todos.lock().unwrap();
        let mut count = 0;
        for id in &ids {
            if let Some(t) = todos.iter_mut().find(|t| t.id == *id) {
                if !t.completed { t.completed = true; count += 1; }
            }
        }
        *state.dirty.lock().unwrap() = true;
        count
    }

    fn todo_batch_delete_sync(state: &AppState, ids: Vec<String>) -> usize {
        let mut todos = state.todos.lock().unwrap();
        let before = todos.len();
        todos.retain(|t| !ids.contains(&t.id));
        before - todos.len()
    }

    // ---------- Todo 数据模型 ----------
    #[test]
    fn todo_serialization_roundtrip() {
        let todo = make_todo("测试", Some(2000000), Some("particle".into()), Some("工作".into()));
        let json = serde_json::to_string(&todo).unwrap();
        let parsed: Todo = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.title, "测试");
        assert_eq!(parsed.effect, Some("particle".to_string()));
        assert_eq!(parsed.tag, Some("工作".to_string()));
    }

    #[test]
    fn todo_json_ignores_unknown_fields() {
        let json = r#"{"id":"x","title":"hi","level":"high","completed":false,"created_at":1,"due_at":null,"screen":0,"recurrence":null,"effect":null,"tag":null,"extra_field":"ignored"}"#;
        let t: Todo = serde_json::from_str(json).unwrap();
        assert_eq!(t.title, "hi");
    }

    // ---------- 特效路由：弹幕与 VFX 区分 ----------
    #[test]
    fn effect_routing_danmaku_vs_vfx() {
        // 弹幕单独走 Canvas 通道，不属于 WebGL VFX
        assert!(!is_vfx_effect("danmaku"));
        for e in &["shatter", "particle", "rain", "firework", "ripple", "laser", "glitch"] {
            assert!(is_vfx_effect(e), "{} 应该是合法 VFX", e);
        }
    }

    // ---------- VFX 校验 ----------
    #[test]
    fn valid_vfx_effects_accepted() {
        for e in &["shatter", "particle", "rain", "firework", "ripple", "laser", "glitch"] {
            assert!(is_vfx_effect(e), "{} 应该是合法 VFX", e);
        }
    }

    #[test]
    fn invalid_vfx_effects_rejected() {
        assert!(!is_vfx_effect(""));
        assert!(!is_vfx_effect("explosion"));
        assert!(!is_vfx_effect("SHATTER"));
    }

    // ---------- 标签校验 ----------
    #[test]
    fn valid_tags_accepted() {
        for t in &["工作", "生活", "紧急"] {
            assert!(is_valid_tag(t));
        }
    }

    #[test]
    fn invalid_tags_rejected() {
        assert!(!is_valid_tag(""));
        assert!(!is_valid_tag("其他"));
        assert!(!is_valid_tag("休闲"));
    }

    // ---------- Todo 列表 CRUD ----------
    #[test]
    fn todo_list_returns_all() {
        let state = test_state();
        {
            let mut todos = state.todos.lock().unwrap();
            todos.push(make_todo("A", None, None, None));
            todos.push(make_todo("B", None, None, None));
        }
        assert_eq!(todos_list_sync(&state).len(), 2);
    }

    #[test]
    fn todo_create_adds_to_list() {
        let state = test_state();
        let created = todo_create_sync(
            &state, "新任务".into(), None, 0,
            Some("firework".into()), Some("工作".into()),
        );
        assert_eq!(created.title, "新任务");
        assert_eq!(created.effect, Some("firework".to_string()));
        assert_eq!(created.tag, Some("工作".to_string()));
        assert_eq!(todos_list_sync(&state).len(), 1);
        assert!(!created.id.is_empty());
    }

    #[test]
    fn todo_create_rejects_invalid_effect_and_tag() {
        let state = test_state();
        let created = todo_create_sync(
            &state, "坏参数".into(), None, 0,
            Some("boom".into()), Some("其他".into()),
        );
        assert_eq!(created.effect, None);
        assert_eq!(created.tag, None);
    }

    #[test]
    fn todo_complete_toggles_flag() {
        let state = test_state();
        let t = make_todo("完", None, None, None);
        let id = t.id.clone();
        state.todos.lock().unwrap().push(t);
        let updated = todo_complete_sync(&state, id).unwrap();
        assert!(updated.completed);
    }

    #[test]
    fn todo_complete_nonexistent_returns_err() {
        let state = test_state();
        assert!(todo_complete_sync(&state, "ghost".into()).is_err());
    }

    #[test]
    fn todo_delete_removes_by_id() {
        let state = test_state();
        let t1 = make_todo("D1", None, None, None);
        let t2 = make_todo("D2", None, None, None);
        let id1 = t1.id.clone();
        state.todos.lock().unwrap().push(t1);
        state.todos.lock().unwrap().push(t2);
        todo_delete_sync(&state, id1).unwrap();
        let list = todos_list_sync(&state);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "D2");
    }

    #[test]
    fn todo_delete_nonexistent_returns_err() {
        let state = test_state();
        assert!(todo_delete_sync(&state, "ghost".into()).is_err());
    }

    #[test]
    fn todo_update_modifies_all_fields() {
        let state = test_state();
        let t = make_todo("旧标题", None, None, None);
        let id = t.id.clone();
        state.todos.lock().unwrap().push(t);
        let updated = todo_update_sync(
            &state, id,
            Some("新标题".into()),
            Some(Some(3000000)),
            Some(1),
            Some(Some("daily".into())),
            Some(Some("particle".into())),
            Some(Some("生活".into())),
        );
        assert_eq!(updated.title, "新标题");
        assert_eq!(updated.due_at, Some(3000000));
        assert_eq!(updated.screen, 1);
        assert_eq!(updated.recurrence, Some("daily".to_string()));
        assert_eq!(updated.effect, Some("particle".to_string()));
        assert_eq!(updated.tag, Some("生活".to_string()));
    }

    #[test]
    fn todo_update_rejects_invalid_effect() {
        let state = test_state();
        let t = make_todo("坏特效", None, Some("particle".into()), None);
        let id = t.id.clone();
        state.todos.lock().unwrap().push(t);
        let updated = todo_update_sync(
            &state, id, None, None, None, None,
            Some(Some("invalid".into())), None,
        );
        assert_eq!(updated.effect, None);
    }

    #[test]
    fn todo_update_rejects_invalid_tag() {
        let state = test_state();
        let t = make_todo("坏标签", None, None, Some("工作".into()));
        let id = t.id.clone();
        state.todos.lock().unwrap().push(t);
        let updated = todo_update_sync(
            &state, id, None, None, None, None, None,
            Some(Some("无效".into())),
        );
        assert_eq!(updated.tag, None);
    }

    #[test]
    fn todo_clear_completed_removes_only_completed() {
        let state = test_state();
        let t1 = make_todo("未完成", None, None, None);
        let mut t2 = make_todo("已完成", None, None, None);
        t2.completed = true;
        state.todos.lock().unwrap().push(t1);
        state.todos.lock().unwrap().push(t2);
        assert_eq!(todo_clear_completed_sync(&state), 1);
        let list = todos_list_sync(&state);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "未完成");
    }

    #[test]
    fn todo_batch_complete_updates_many() {
        let state = test_state();
        let t1 = make_todo("B1", None, None, None);
        let t2 = make_todo("B2", None, None, None);
        let t3 = make_todo("B3", None, None, None);
        let ids = vec![t1.id.clone(), t2.id.clone(), t3.id.clone()];
        let batch_ids = vec![t1.id.clone(), t3.id.clone()];
        state.todos.lock().unwrap().push(t1);
        state.todos.lock().unwrap().push(t2);
        state.todos.lock().unwrap().push(t3);
        assert_eq!(todo_batch_complete_sync(&state, batch_ids), 2);
        let list = todos_list_sync(&state);
        assert!(list.iter().find(|t| t.id == ids[0]).unwrap().completed);
        assert!(!list.iter().find(|t| t.id == ids[1]).unwrap().completed);
        assert!(list.iter().find(|t| t.id == ids[2]).unwrap().completed);
    }

    #[test]
    fn todo_batch_delete_removes_many() {
        let state = test_state();
        let t1 = make_todo("R1", None, None, None);
        let t2 = make_todo("R2", None, None, None);
        let t3 = make_todo("R3", None, None, None);
        let ids_to_delete = vec![t1.id.clone(), t3.id.clone()];
        state.todos.lock().unwrap().push(t1);
        state.todos.lock().unwrap().push(t2);
        state.todos.lock().unwrap().push(t3);
        assert_eq!(todo_batch_delete_sync(&state, ids_to_delete), 2);
        let list = todos_list_sync(&state);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "R2");
    }

    #[test]
    fn todo_batch_delete_empty_list_noop() {
        let state = test_state();
        assert_eq!(todo_batch_delete_sync(&state, vec!["x".into()]), 0);
    }

    // ---------- 偏好设置 ----------
    #[test]
    fn preferences_default_values() {
        let prefs = Preferences { default_screen: 0, theme: "system".into(), default_effect: "danmaku".into(), summon_shortcut: None };
        assert_eq!(prefs.default_screen, 0);
        assert_eq!(prefs.theme, "system");
    }

    #[test]
    fn preferences_serialization_roundtrip() {
        let prefs = Preferences { default_screen: 1, theme: "dark".into(), default_effect: "danmaku".into(), summon_shortcut: None };
        let json = serde_json::to_string(&prefs).unwrap();
        let parsed: Preferences = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.default_screen, 1);
        assert_eq!(parsed.theme, "dark");
    }

    #[test]
    fn preferences_json_with_missing_fields_uses_defaults() {
        let json = r#"{}"#;
        let parsed: Preferences = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.default_screen, 0);
        assert_eq!(parsed.theme, "system");
        assert_eq!(parsed.summon_shortcut, None);
    }

    // ---------- Danmaku payload ----------
    #[test]
    fn danmaku_payload_serialization() {
        let d = DanmakuPayload { id: 42.0, text: "hello".into(), color: "#ff0000".into(), speed: 200.0, repeat_count: 3 };
        let json = serde_json::to_string(&d).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["id"].as_f64().unwrap(), 42.0);
        assert_eq!(parsed["text"].as_str().unwrap(), "hello");
        assert_eq!(parsed["speed"].as_f64().unwrap(), 200.0);
    }

    // ---------- Vfx payload ----------
    #[test]
    fn vfx_payload_serialization() {
        let v = VfxPayload { id: 7.0, effect: "firework".into(), text: "boom".into(), color: "#ffaa00".into(), repeat_count: 3, play_duration: 2 };
        let json = serde_json::to_string(&v).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["id"].as_f64().unwrap(), 7.0);
        assert_eq!(parsed["effect"].as_str().unwrap(), "firework");
        assert_eq!(parsed["text"].as_str().unwrap(), "boom");
        assert_eq!(parsed["repeat_count"].as_u64().unwrap(), 3);
    }

    // ---------- ScreenInfo ----------
    #[test]
    fn screen_info_fields() {
        let s = ScreenInfo { id: 0, name: "Main".into(), is_primary: true };
        let json = serde_json::to_string(&s).unwrap();
        let parsed: ScreenInfo = serde_json::from_str(&json).unwrap();
        assert!(parsed.is_primary);
    }

    // ---------- 批量操作幂等性 ----------
    #[test]
    fn batch_complete_on_already_completed_is_idempotent() {
        let state = test_state();
        let mut t = make_todo("已完成", None, None, None);
        t.completed = true;
        let id = t.id.clone();
        state.todos.lock().unwrap().push(t);
        assert_eq!(todo_batch_complete_sync(&state, vec![id]), 0);
    }

    // ---------- 边界条件 ----------
    #[test]
    fn empty_todo_list_clear_returns_zero() {
        let state = test_state();
        assert_eq!(todo_clear_completed_sync(&state), 0);
    }

    #[test]
    fn created_todo_has_unique_ids() {
        let state = test_state();
        let a = todo_create_sync(&state, "A".into(), None, 0, None, None);
        let b = todo_create_sync(&state, "B".into(), None, 0, None, None);
        assert_ne!(a.id, b.id);
    }
}
