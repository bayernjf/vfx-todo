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

function TodoItem({
  todo,
  onComplete,
  onDelete,
  onTrigger,
}: {
  todo: Todo;
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  onTrigger: (todo: Todo) => void;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!todo.due_at || todo.completed) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [todo.due_at, todo.completed]);

  return (
    <div
      className={`todo-item ${todo.completed ? "completed" : ""} ${todo.due_at && !todo.completed ? "has-due" : ""}`}
    >
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
          <span className="todo-due">{formatDue(todo.due_at)}</span>
        )}
      </div>
      {!todo.completed && (
        <button className="todo-btn complete" onClick={() => onComplete(todo.id)}>
          完成
        </button>
      )}
      <button className="todo-btn delete" onClick={() => onDelete(todo.id)}>
        删除
      </button>
    </div>
  );
}

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
  // 选具体特效时覆盖 level 默认派发；空字符串 = 按 level 默认
  const [effect, setEffect] = useState<EffectType | "">("");
  // 标签筛选：空 = 全部，否则只看该标签的待办
  const [filterTag, setFilterTag] = useState<TagType | "">("");
  // 新建待办时选的标签
  const [newTag, setNewTag] = useState<TagType | "">("");

  const refresh = (tag?: string) => {
    invoke<Todo[]>("todo_list", { tag: tag || null })
      .then(setTodos)
      .catch(console.error);
  };

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

  const triggerTodoDanmaku = (todo: Todo) => {
    // 统一走 Rust trigger_todo，按 level 自动路由弹幕/特效
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

  // 演示面板：直接派发具体特效（不依赖 todo）
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

  const activeCount = todos.filter((t) => !t.completed).length;

  return (
    <div className="console">
      <header className="console-header">
        <span className="badge">vfx-todo</span>
        <span className="counter">{activeCount} 待办 · {todos.length} 总计</span>
        <div className="header-actions">
          <button className="icon-btn" onClick={() => handleExport("json")} title="导出 JSON">⬇️</button>
          <button className="icon-btn" onClick={() => handleImport("json")} title="导入 JSON">⬆️</button>
        </div>
      </header>

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

      <div className="todo-list">
        {todos.length === 0 ? (
          <div className="todo-empty">暂无待办，添加一个试试</div>
        ) : (
          todos.map((todo) => (
            <TodoItem
              key={todo.id}
              todo={todo}
              onComplete={completeTodo}
              onDelete={deleteTodo}
              onTrigger={triggerTodoDanmaku}
            />
          ))
        )}
      </div>

      <div className="todo-input">
        <select value={level} onChange={(e) => setLevel(e.target.value as Level)}>
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
        <select value={targetScreen} onChange={(e) => setTargetScreen(Number(e.target.value))}>
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
