import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";


type Level = "low" | "mid" | "high";

// 与后端 VFX_EFFECTS 保持一致
type EffectType =
  | "shatter"
  | "particle"
  | "rain"
  | "firework"
  | "ripple"
  | "laser"
  | "glitch";

// 与后端 PREDEFINED_TAGS 保持一致
type TagType = "工作" | "生活" | "紧急";

interface Todo {
  id: string;
  title: string;
  level: Level;
  completed: boolean;
  created_at: number;
  due_at: number | null;
  screen?: number;
  recurrence?: string | null;
  effect?: EffectType | null;
  tag?: TagType | null;
}

interface ScreenInfo {
  id: number;
  name: string;
  is_primary: boolean;
}

interface Preferences {
  default_screen: number;
  default_level: string;
  theme?: string;
}

const LEVEL_LABEL: Record<Level, string> = {
  low: "弹幕",
  mid: "粒子",
  high: "破碎",
};

const LEVEL_COLOR: Record<Level, string> = {
  low: "#4ecdc4",
  mid: "#ffe66d",
  high: "#ff6b6b",
};

const EFFECT_LABEL: Record<EffectType, string> = {
  shatter: "破碎",
  particle: "粒子",
  rain: "雨",
  firework: "烟花",
  ripple: "水波",
  laser: "激光",
  glitch: "故障",
};

const EFFECT_COLOR: Record<EffectType, string> = {
  shatter: "#ff6b6b",
  particle: "#ffe66d",
  rain: "#88c0ff",
  firework: "#ff9f1c",
  ripple: "#4ecdc4",
  laser: "#ff006e",
  glitch: "#c77dff",
};

const TAGS: TagType[] = ["工作", "生活", "紧急"];

const TAG_COLOR: Record<TagType, string> = {
  工作: "#ff6b6b",
  生活: "#4ecdc4",
  紧急: "#f9ca24",
};

const DUE_PRESETS: { label: string; mins: number }[] = [
  { label: "+1m", mins: 1 },
  { label: "+5m", mins: 5 },
  { label: "+30m", mins: 30 },
];

// ══════════════════════════════════════════
// 工具函数
// ══════════════════════════════════════════

function formatDue(dueAt: number | null): string {
  if (!dueAt) return "";
  const now = Date.now();
  const diff = dueAt - now;
  if (diff <= 0) return "已到期";
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  if (mins >= 1) return `${mins}分${secs.toString().padStart(2, "0")}秒后`;
  return `${secs}秒后`;
}

function formatDateTime(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function addMins(mins: number): number {
  return Date.now() + mins * 60_000;
}

// ══════════════════════════════════════════
// 编辑态表单（内联渲染在 TodoItem 中）
// ══════════════════════════════════════════

interface EditState {
  title: string;
  level: Level;
  dueAt: number | null;
  duePreset: number | null; // mins
  customDue: string; // datetime-local value
  screen: number;
  recurrence: string | null;
  effect: EffectType | "";
  tag: TagType | "";
}

function EditForm({
  edit,
  screens,
  onSave,
  onCancel,
  onChange,
}: {
  edit: EditState;
  screens: ScreenInfo[];
  onSave: () => void;
  onCancel: () => void;
  onChange: (patch: Partial<EditState>) => void;
}) {
  return (
    <div className="edit-form">
      <input
        className="edit-title-input"
        value={edit.title}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder="待办标题"
        autoFocus
        onKeyDown={(e) => e.key === "Enter" && onSave()}
      />
      <div className="edit-row">
        <select
          value={edit.level}
          onChange={(e) => onChange({ level: e.target.value as Level })}
        >
          <option value="low">弹幕</option>
          <option value="mid">粒子</option>
          <option value="high">破碎</option>
        </select>
        <select
          value={edit.effect}
          onChange={(e) => onChange({ effect: e.target.value as EffectType | "" })}
        >
          <option value="">默认（按 level）</option>
          {(Object.keys(EFFECT_LABEL) as EffectType[]).map((k) => (
            <option key={k} value={k}>{EFFECT_LABEL[k]}</option>
          ))}
        </select>
        <select
          value={edit.tag}
          onChange={(e) => onChange({ tag: e.target.value as TagType | "" })}
        >
          <option value="">无标签</option>
          {TAGS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={edit.screen}
          onChange={(e) => onChange({ screen: Number(e.target.value) })}
        >
          {screens.map((s) => (
            <option key={s.id} value={s.id}>
              {s.is_primary ? "主屏" : `屏 ${s.id + 1}`}
            </option>
          ))}
        </select>
      </div>
      <div className="edit-row">
        <span className="due-label">到期：</span>
        {DUE_PRESETS.map((p) => (
          <button
            key={p.mins}
            className={`due-btn ${edit.duePreset === p.mins ? "active" : ""}`}
            onClick={() =>
              onChange({
                duePreset: edit.duePreset === p.mins ? null : p.mins,
                dueAt: edit.duePreset === p.mins ? null : addMins(p.mins),
                customDue: "",
              })
            }
          >
            {p.label}
          </button>
        ))}
        <input
          type="datetime-local"
          className="due-datetime"
          value={edit.customDue}
          min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16)}
          onChange={(e) => {
            const val = e.target.value;
            const ts = val ? new Date(val).getTime() : null;
            onChange({ customDue: val, dueAt: ts, duePreset: null });
          }}
        />
        <span className="due-label">重复：</span>
        {[
          { value: null, label: "不重复" },
          { value: "daily", label: "每天" },
          { value: "weekly", label: "每周" },
        ].map((r) => (
          <button
            key={r.label}
            className={`due-btn ${edit.recurrence === r.value ? "active" : ""}`}
            onClick={() => onChange({ recurrence: r.value })}
          >
            {r.label}
          </button>
        ))}
      </div>
      <div className="edit-actions">
        <button className="todo-btn save" onClick={onSave}>保存</button>
        <button className="todo-btn cancel" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
// TodoItem
// ══════════════════════════════════════════

function TodoItem({
  todo,
  screens,
  onComplete,
  onDelete,
  onTrigger,
  onUpdate,
  selected,
  onToggleSelect,
}: {
  todo: Todo;
  screens: ScreenInfo[];
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  onTrigger: (todo: Todo) => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const [, setTick] = useState(0);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!todo.due_at || todo.completed) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [todo.due_at, todo.completed]);

  // 编辑态 → 展示内联表单
  if (editing) {
    const editFromTodo = (): EditState => {
      const hasPreset = todo.due_at && DUE_PRESETS.some((p) => todo.due_at! <= Date.now() + p.mins * 60000 + 5000 && todo.due_at! >= Date.now() + p.mins * 60000 - 5000);
      return {
        title: todo.title,
        level: todo.level,
        dueAt: todo.due_at,
        duePreset: hasPreset
          ? DUE_PRESETS.find(
              (p) => Math.abs(todo.due_at! - (Date.now() + p.mins * 60000)) < 10000
            )?.mins ?? null
          : null,
        customDue: todo.due_at
          ? new Date(todo.due_at).toISOString().slice(0, 16)
          : "",
        screen: todo.screen ?? 0,
        recurrence: todo.recurrence ?? null,
        effect: todo.effect ?? "",
        tag: todo.tag ?? "",
      };
    };

    const edit = editFromTodo();

    return (
      <div className="todo-item editing">
        <EditForm
          edit={edit}
          screens={screens}
          onSave={() => {
            const patch: Record<string, unknown> = {};
            if (edit.title !== todo.title) patch.title = edit.title;
            if (edit.level !== todo.level) patch.level = edit.level;
            if (edit.dueAt !== todo.due_at) patch.due_at = edit.dueAt;
            if (edit.screen !== (todo.screen ?? 0)) patch.screen = edit.screen;
            if (edit.recurrence !== (todo.recurrence ?? null)) patch.recurrence = edit.recurrence;
            if (edit.effect !== (todo.effect ?? "")) patch.effect = edit.effect || null;
            if (edit.tag !== (todo.tag ?? "")) patch.tag = edit.tag || null;
            if (Object.keys(patch).length > 0) {
              onUpdate(todo.id, patch);
            }
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          onChange={(patch) => {
            // 由 EditForm 的本地状态自己管理
            Object.assign(edit, patch);
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`todo-item ${todo.completed ? "completed" : ""} ${todo.due_at && !todo.completed ? "has-due" : ""} ${selected ? "selected" : ""}`}
    >
      <input
        type="checkbox"
        className="todo-checkbox"
        checked={selected}
        onChange={() => onToggleSelect(todo.id)}
        onClick={(e) => e.stopPropagation()}
      />
      <span
        className="todo-level"
        style={{ color: LEVEL_COLOR[todo.level], borderColor: LEVEL_COLOR[todo.level] }}
      >
        {LEVEL_LABEL[todo.level]}
      </span>
      <div className="todo-content">
        <span
          className="todo-title"
          onClick={() => !todo.completed && onTrigger(todo)}
        >
          {todo.title}
          {todo.recurrence && (
            <span className="recurrence-badge">
              {todo.recurrence === "daily" ? "每天" : "每周"}
            </span>
          )}
          {todo.effect && (
            <span
              className="effect-badge"
              style={{
                color: EFFECT_COLOR[todo.effect],
                borderColor: EFFECT_COLOR[todo.effect],
              }}
              title={`特效：${EFFECT_LABEL[todo.effect]}`}
            >
              {EFFECT_LABEL[todo.effect]}
            </span>
          )}
          {todo.tag && (
            <span
              className="tag-badge"
              style={{
                backgroundColor: TAG_COLOR[todo.tag],
              }}
            >
              {todo.tag}
            </span>
          )}
        </span>
        {todo.due_at && !todo.completed && (
          <span className="todo-due" title={formatDateTime(todo.due_at)}>
            {formatDue(todo.due_at)}
          </span>
        )}
      </div>
      {!todo.completed && (
        <>
          <button className="todo-btn edit" onClick={() => setEditing(true)}>
            编辑
          </button>
          <button className="todo-btn complete" onClick={() => onComplete(todo.id)}>
            完成
          </button>
        </>
      )}
      <button className="todo-btn delete" onClick={() => onDelete(todo.id)}>
        删除
      </button>
    </div>
  );
}

// ══════════════════════════════════════════
// App 主组件
// ══════════════════════════════════════════

function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState("");
  const [level, setLevel] = useState<Level>("low");
  const [dueInMin, setDueInMin] = useState<number | null>(null);
  const [customDue, setCustomDue] = useState("");
  const [danmakuInput, setDanmakuInput] = useState("");
  const [danmakuCount, setDanmakuCount] = useState(0);
  const [screens, setScreens] = useState<ScreenInfo[]>([]);
  const [targetScreen, setTargetScreen] = useState(0);
  const [recurrence, setRecurrence] = useState<string | null>(null);
  const [effect, setEffect] = useState<EffectType | "">("");
  const [filterTag, setFilterTag] = useState<TagType | "">("");
  const [newTag, setNewTag] = useState<TagType | "">("");

  // Feature 3: 搜索
  const [searchQuery, setSearchQuery] = useState("");

  // Feature 2: 显示已完成
  const [showCompleted, setShowCompleted] = useState(true);

  // Feature 6: 排序
  const [sortBy, setSortBy] = useState<"created" | "due" | "level">("created");

  // Feature 8: 批量选中
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const activeIds = filteredTodos.filter((t) => !t.completed).map((t) => t.id);
    setSelectedIds(new Set(activeIds));
  };

  const deselectAll = () => setSelectedIds(new Set());

  const batchComplete = async () => {
    const idsArr = [...selectedIds];
    const count = await invoke<number>("todo_batch_complete", { ids: idsArr });
    if (count > 0) {
      setTodos((prev) =>
        prev.map((t) => (selectedIds.has(t.id) ? { ...t, completed: true } : t))
      );
      deselectAll();
    }
  };

  const batchDelete = async () => {
    const idsArr = [...selectedIds];
    const count = await invoke<number>("todo_batch_delete", { ids: idsArr });
    if (count > 0) {
      setTodos((prev) => prev.filter((t) => !selectedIds.has(t.id)));
      deselectAll();
    }
  };

  const refresh = (tag?: string) => {
    invoke<Todo[]>("todo_list", { tag: tag || null })
      .then(setTodos)
      .catch(console.error);
  };

  // Feature 5: 加载偏好设置
  const [prefs, setPrefs] = useState<Preferences>({
    default_screen: 0,
    default_level: "high",
  });

  // 主题：system / dark / light
  type Theme = "system" | "dark" | "light";
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    invoke<Preferences>("load_prefs")
      .then((p) => {
        setPrefs(p);
        setLevel(p.default_level as Level);
        setTargetScreen(p.default_screen);
        if (p.theme === "dark" || p.theme === "light") {
          setTheme(p.theme);
        }
      })
      .catch(() => {}); // 首次启动无文件，正常
  }, []);

  // 同步主题到 <html> data-theme 属性
  useEffect(() => {
    const el = document.documentElement;
    if (theme === "system") {
      el.removeAttribute("data-theme");
    } else {
      el.setAttribute("data-theme", theme);
    }
  }, [theme]);

  useEffect(() => {
    refresh(filterTag || undefined);
    invoke<ScreenInfo[]>("list_screens")
      .then(setScreens)
      .catch(console.error);
    const un = listen("todos-updated", () => refresh(filterTag || undefined));
    return () => {
      un.then((f) => f());
    };
  }, [filterTag]);

  const addTodo = async () => {
    const title = input.trim();
    if (!title) return;
    let dueAt: number | null = null;
    if (customDue) {
      dueAt = new Date(customDue).getTime();
    } else if (dueInMin !== null) {
      dueAt = Date.now() + dueInMin * 60_000;
    }
    const todo = await invoke<Todo>("todo_create", {
      title,
      level,
      dueAt,
      screen: targetScreen,
      recurrence,
      effect: effect || null,
      tag: newTag || null,
    });
    setTodos((prev) => [...prev, todo]);
    setInput("");
    setDueInMin(null);
    setCustomDue("");
    setRecurrence(null);
    setEffect("");
    setNewTag("");
  };

  const completeTodo = async (id: string) => {
    await invoke("todo_complete", { id });
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: true } : t))
    );
  };

  const deleteTodo = async (id: string) => {
    await invoke("todo_delete", { id });
    setTodos((prev) => prev.filter((t) => t.id !== id));
  };

  // Feature 1: 编辑待办
  const updateTodo = async (id: string, patch: Record<string, unknown>) => {
    try {
      const updated = await invoke<Todo>("todo_update", { id, ...patch });
      setTodos((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch (e) {
      console.error("todo_update failed", e);
    }
  };

  // Feature 2: 清空已完成
  const clearCompleted = async () => {
    const removed = await invoke<number>("todo_clear_completed");
    if (removed > 0) {
      setTodos((prev) => prev.filter((t) => !t.completed));
    }
  };

  const triggerTodoDanmaku = (todo: Todo) => {
    invoke("trigger_todo", { id: todo.id }).catch(console.error);
  };

  const sendDanmaku = async () => {
    const text = danmakuInput.trim();
    if (!text) return;
    const colors = ["#ffffff", "#ff6b6b", "#4ecdc4", "#ffe66d", "#a8e6cf", "#c7ceea"];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const speed = 120 + Math.random() * 80;
    try {
      await invoke("send_danmaku", { text, color, speed, screen: targetScreen });
      setDanmakuCount((c) => c + 1);
      setDanmakuInput("");
    } catch (e) {
      console.error("send_danmaku failed", e);
    }
  };

  const previewEffect = (e: EffectType) => {
    invoke("trigger_vfx", { effect: e, level, screen: targetScreen }).catch(console.error);
  };

  const handleExport = async (format: "json" | "csv") => {
    await invoke("export_todos", { format });
  };

  const handleImport = async (format: "json" | "csv") => {
    const count = await invoke<number>("import_todos", { format });
    refresh();
    alert(`成功导入 ${count} 条待办`);
  };

  // Feature 5: 保存偏好
  const savePrefs = (p: Preferences) => {
    setPrefs(p);
    invoke("save_prefs", { prefs: p }).catch(console.error);
  };

  // 客户端过滤：标签 + 搜索文字 + 已完成
  const filteredTodos = todos
    .filter((t) => {
      if (!showCompleted && t.completed) return false;
      if (searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase()))
        return false;
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "due":
          // 未完成的按 due_at 升序（越近越前），无 due 的排最后
          if (!a.due_at && !b.due_at) return b.created_at - a.created_at;
          if (!a.due_at) return 1;
          if (!b.due_at) return -1;
          return a.due_at - b.due_at;
        case "level": {
          const w = { high: 0, mid: 1, low: 2 };
          const wa = w[a.level] ?? 99;
          const wb = w[b.level] ?? 99;
          return wa - wb || b.created_at - a.created_at;
        }
        default: // created
          return b.created_at - a.created_at;
      }
    });

  const activeCount = todos.filter((t) => !t.completed).length;
  const completedCount = todos.filter((t) => t.completed).length;

  return (
    <div className="console">
      <header className="console-header">
        <span className="badge">vfx-todo</span>
        <span className="counter">{activeCount} 待办 · {completedCount} 已完成</span>
        <div className="header-actions">
          <button
            className="icon-btn theme-toggle"
            onClick={() => {
              const next = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
              setTheme(next);
              savePrefs({ ...prefs, theme: next });
            }}
            title={`主题：${theme === "dark" ? "深色" : theme === "light" ? "亮色" : "跟随系统"}`}
          >
            {theme === "dark" ? "🌙" : theme === "light" ? "☀️" : "💻"}
          </button>
          <button className="icon-btn" onClick={() => handleExport("json")} title="导出 JSON">⬇️</button>
          <button className="icon-btn" onClick={() => handleImport("json")} title="导入 JSON">⬆️</button>
        </div>
      </header>

      {/* Feature 3: 搜索 */}
      <div className="search-bar">
        <input
          className="search-input"
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索待办..."
        />
        {searchQuery && (
          <button className="search-clear" onClick={() => setSearchQuery("")}>
            ✕
          </button>
        )}
      </div>

      <div className="tag-filter">
        <button
          className={`tag-filter-pill ${filterTag === "" ? "active" : ""}`}
          onClick={() => setFilterTag("")}
        >
          全部
        </button>
        {TAGS.map((t) => (
          <button
            key={t}
            className={`tag-filter-pill ${filterTag === t ? "active" : ""}`}
            style={{
              borderColor: TAG_COLOR[t],
              color: filterTag === t ? "#fff" : TAG_COLOR[t],
              backgroundColor: filterTag === t ? TAG_COLOR[t] : "transparent",
            }}
            onClick={() => setFilterTag(filterTag === t ? "" : t)}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Feature 2: 已完成切换 + 清空 + Feature 6: 排序 + Feature 8: 批量 */}
      <div className="view-controls">
        <label className="show-completed-toggle">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
          />
          显示已完成
        </label>
        <select
          className="sort-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "created" | "due" | "level")}
        >
          <option value="created">按创建时间</option>
          <option value="due">按到期时间</option>
          <option value="level">按等级</option>
        </select>
        {completedCount > 0 && (
          <button className="clear-completed-btn" onClick={clearCompleted}>
            清空已完成 ({completedCount})
          </button>
        )}
      </div>

      {/* Feature 8: 批量操作栏 */}
      {selectedIds.size > 0 && (
        <div className="batch-bar">
          <span className="batch-info">已选 {selectedIds.size} 条</span>
          <div className="batch-actions">
            <button className="batch-btn select-all" onClick={selectAll}>全选未完成</button>
            <button className="batch-btn deselect" onClick={deselectAll}>取消全选</button>
            <button className="batch-btn complete" onClick={batchComplete}>批量完成</button>
            <button className="batch-btn delete" onClick={batchDelete}>批量删除</button>
          </div>
        </div>
      )}

      <div className="todo-list">
        {filteredTodos.length === 0 ? (
          <div className="todo-empty">
            {searchQuery ? "没有匹配的待办" : "暂无待办，添加一个试试"}
          </div>
        ) : (
          filteredTodos.map((todo) => (
            <TodoItem
              key={todo.id}
              todo={todo}
              screens={screens}
              onComplete={completeTodo}
              onDelete={deleteTodo}
              onTrigger={triggerTodoDanmaku}
              onUpdate={updateTodo}
              selected={selectedIds.has(todo.id)}
              onToggleSelect={toggleSelect}
            />
          ))
        )}
      </div>

      <div className="todo-input">
        <select value={level} onChange={(e) => {
          const l = e.target.value as Level;
          setLevel(l);
          savePrefs({ ...prefs, default_level: l });
        }}>
          <option value="low">弹幕</option>
          <option value="mid">粒子</option>
          <option value="high">破碎</option>
        </select>
        <select
          value={effect}
          onChange={(e) => setEffect(e.target.value as EffectType | "")}
          title="选择具体特效（覆盖 level 默认派发）"
        >
          <option value="">默认（按 level）</option>
          {(Object.keys(EFFECT_LABEL) as EffectType[]).map((k) => (
            <option key={k} value={k}>
              {EFFECT_LABEL[k]}
            </option>
          ))}
        </select>
        <select value={targetScreen} onChange={(e) => {
          const s = Number(e.target.value);
          setTargetScreen(s);
          savePrefs({ ...prefs, default_screen: s });
        }}>
          {screens.map((s) => (
            <option key={s.id} value={s.id}>
              {s.is_primary ? "主屏" : `屏 ${s.id + 1}`}
            </option>
          ))}
        </select>
        <select
          value={newTag}
          onChange={(e) => setNewTag(e.target.value as TagType | "")}
          title="待办分组标签"
        >
          <option value="">无标签</option>
          {TAGS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTodo()}
          placeholder="输入待办内容，回车添加"
        />
        <button onClick={addTodo}>添加</button>
      </div>
      <div className="due-presets">
        <span className="due-label">到期提醒：</span>
        {DUE_PRESETS.map((p) => (
          <button
            key={p.mins}
            className={`due-btn ${dueInMin === p.mins ? "active" : ""}`}
            onClick={() => {
              setDueInMin(dueInMin === p.mins ? null : p.mins);
              setCustomDue("");
            }}
          >
            {p.label}
          </button>
        ))}
        <input
          type="datetime-local"
          className="due-datetime"
          value={customDue}
          min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
          onChange={(e) => {
            setCustomDue(e.target.value);
            setDueInMin(null);
          }}
        />
        {(dueInMin !== null || customDue) && (
          <span className="due-hint">
            {customDue
              ? `已选 ${new Date(customDue).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
              : `已选 ${dueInMin} 分钟后触发`}
          </span>
        )}
      </div>
      <div className="recurrence-presets">
        <span className="due-label">重复：</span>
        {[
          { value: null, label: "不重复" },
          { value: "daily", label: "每天" },
          { value: "weekly", label: "每周" },
        ].map((r) => (
          <button
            key={r.label}
            className={`due-btn ${recurrence === r.value ? "active" : ""}`}
            onClick={() => setRecurrence(r.value)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="effect-panel">
        <span className="due-label">特效演示：</span>
        {(Object.keys(EFFECT_LABEL) as EffectType[]).map((k) => (
          <button
            key={k}
            className="effect-demo-btn"
            style={{ borderColor: EFFECT_COLOR[k], color: EFFECT_COLOR[k] }}
            onClick={() => previewEffect(k)}
            title={`预览 ${EFFECT_LABEL[k]} 特效`}
          >
            {EFFECT_LABEL[k]}
          </button>
        ))}
        <span className="effect-panel-hint">
          点击按钮可即时预览 · 快捷键 ⌘⇧4/5/6/7/8
        </span>
      </div>

      <div className="danmaku-bar">
        <input
          value={danmakuInput}
          onChange={(e) => setDanmakuInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendDanmaku()}
          placeholder="直接发弹幕..."
        />
        <button onClick={sendDanmaku}>发送</button>
      </div>
      <div className="console-hint">
        点击待办标题触发 · 到期自动派发 · ⌘⇧4/5/6/7/8 预览新特效 · 已发 {danmakuCount} 条
      </div>
    </div>
  );
}

export default App;
