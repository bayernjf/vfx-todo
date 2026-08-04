import { Component, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ══════════════════════════════════════════
// 错误边界
// ══════════════════════════════════════════

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary" data-testid="error-boundary">
          <h2>出错了</h2>
          <p className="error-message">
            {this.state.error?.message || "未知错误"}
          </p>
          <button
            className="error-retry-btn"
            onClick={this.handleRetry}
            data-testid="error-retry"
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// 与后端 VFX_EFFECTS 保持一致（danmaku 排第一）
type EffectType =
  | "danmaku"
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
  completed: boolean;
  created_at: number;
  due_at: number | null;
  screen?: number;
  recurrence?: string | null;
  effect?: EffectType | null;
  tag?: TagType | null;
  order?: number;
  repeat_count?: number;
  play_duration?: number;
  danmaku_speed?: number;
}

interface ScreenInfo {
  id: number;
  name: string;
  is_primary: boolean;
}

interface Preferences {
  default_screen: number;
  theme?: string;
  default_effect?: string;
}

const EFFECT_LABEL: Record<EffectType, string> = {
  danmaku: "弹幕",
  shatter: "破碎",
  particle: "粒子",
  rain: "雨",
  firework: "烟花",
  ripple: "水波",
  laser: "激光",
  glitch: "故障",
};

const EFFECT_COLOR: Record<EffectType, string> = {
  danmaku: "#ff6b6b",
  shatter: "#ff6b6b",
  particle: "#ffe66d",
  rain: "#88c0ff",
  firework: "#ff9f1c",
  ripple: "#4ecdc4",
  laser: "#ff006e",
  glitch: "#c77dff",
};

const EFFECT_COLOR_LIGHT: Record<EffectType, string> = {
  danmaku: "#d63a3a",
  shatter: "#d63a3a",
  particle: "#a07a00",
  rain: "#2f6fb0",
  firework: "#c47a00",
  ripple: "#0e8e85",
  laser: "#c20056",
  glitch: "#9b3fbf",
};
const TAG_COLOR_LIGHT: Record<TagType, string> = {
  工作: "#d63a3a",
  生活: "#0e8e85",
  紧急: "#a07a00",
};

const TAGS: TagType[] = ["工作", "生活", "紧急"];

const TAG_COLOR: Record<TagType, string> = {
  工作: "#ff6b6b",
  生活: "#4ecdc4",
  紧急: "#f9ca24",
};

const DUE_PRESETS: { label: string; secs: number }[] = [
  { label: "+3s", secs: 3 },
  { label: "+1m", secs: 60 },
  { label: "+5m", secs: 300 },
  { label: "+30m", secs: 1800 },
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

function addSecs(secs: number): number {
  return Date.now() + secs * 1000;
}

// 本地时区的 YYYY-MM-DD（用于 date 输入）
function todayDateString(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

// 当前本地时间 HH:mm（用于 time 输入的 min）
function timeStringNow(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// 默认到期时间 = 当前时间 + 1 小时
function defaultDueTimeString(): string {
  const d = new Date();
  d.setHours(d.getHours() + 1);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// 默认到期日期（处理 +1h 后跨天的情况）
function defaultDueDateString(): string {
  const d = new Date();
  d.setHours(d.getHours() + 1);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

// 校验日期+时间不能比当前早；若过期则退回到默认 now+1h
function validateDueDateTime(dateStr: string, timeStr: string): { date: string; time: string } {
  const due = new Date(`${dateStr}T${timeStr}`).getTime();
  if (due > Date.now()) return { date: dateStr, time: timeStr };
  return { date: defaultDueDateString(), time: defaultDueTimeString() };
}

// 时间戳 → 本地时区的 YYYY-MM-DDTHH:mm（用于自定义到期时间输入）
function formatLocalDT(ts: number): string {
  const d = new Date(ts);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

// ══════════════════════════════════════════
// 编辑态表单（内联渲染在 TodoItem 中）
// ══════════════════════════════════════════

interface EditState {
  title: string;
  dueAt: number | null;
  duePreset: number | null; // mins
  customDue: string; // datetime-local value
  screen: number;
  recurrence: string | null;
  effect: EffectType;
  tag: TagType | "";
  repeatCount: number;
  playDuration: number;
  danmakuSpeed: number;
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
  const [customDate, setCustomDate] = useState(
    edit.customDue ? edit.customDue.slice(0, 10) : defaultDueDateString()
  );
  const [customTime, setCustomTime] = useState(
    edit.customDue ? edit.customDue.slice(11, 16) : defaultDueTimeString()
  );
  const customDateRef = useRef<HTMLInputElement>(null);
  const customTimeRef = useRef<HTMLInputElement>(null);
  const commitCustom = () => {
    const rawD = customDateRef.current?.value || customDate || defaultDueDateString();
    const rawT = customTimeRef.current?.value || customTime || defaultDueTimeString();
    const { date: d, time: t } = validateDueDateTime(rawD, rawT);
    setCustomDate(d);
    setCustomTime(t);
    const full = `${d}T${t}`;
    onChange({ customDue: full, dueAt: new Date(full).getTime(), duePreset: null });
  };
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
          value={edit.effect}
          onChange={(e) => onChange({ effect: e.target.value as EffectType })}
        >
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
          <option value={-1}>全部</option>
          {screens.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="edit-row">
        <span className="due-label">到期：</span>
        {DUE_PRESETS.map((p) => (
          <button
            key={p.secs}
            className={`due-btn ${edit.duePreset === p.secs ? "active" : ""}`}
            onClick={() =>
              onChange({
                duePreset: edit.duePreset === p.secs ? null : p.secs,
                dueAt: edit.duePreset === p.secs ? null : addSecs(p.secs),
                customDue: "",
              })
            }
          >
            {p.label}
          </button>
        ))}
        <span className="due-datetime-group">
          <input
            ref={customDateRef}
            type="date"
            className="due-datetime"
            value={customDate}
            min={todayDateString()}
            onFocus={() => {
              if (!edit.customDue) {
                const d = defaultDueDateString();
                setCustomDate(d);
                if (customDateRef.current) customDateRef.current.value = d;
              }
            }}
            onChange={(e) => setCustomDate(e.target.value)}
            onBlur={commitCustom}
          />
          <input
            ref={customTimeRef}
            type="time"
            className="due-datetime"
            value={customTime}
            min={customDate === todayDateString() ? timeStringNow() : undefined}
            onFocus={() => {
              if (!edit.customDue) {
                const t = defaultDueTimeString();
                setCustomTime(t);
                if (customTimeRef.current) customTimeRef.current.value = t;
              }
            }}
            onChange={(e) => setCustomTime(e.target.value)}
            onBlur={commitCustom}
          />
          <button
            type="button"
            className="due-btn"
            onClick={commitCustom}
          >
            确认
          </button>
        </span>
        <span className="due-label">播放次数：</span>
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            className={`due-btn ${edit.repeatCount === n ? "active" : ""}`}
            onClick={() => onChange({ repeatCount: n })}
          >
            {n}
          </button>
        ))}
        <span className="repeat-stepper">
          <button
            className="due-btn"
            disabled={edit.repeatCount <= 1}
            onClick={() => onChange({ repeatCount: Math.max(1, edit.repeatCount - 1) })}
          >
            −
          </button>
          <span className="repeat-count">{edit.repeatCount}</span>
          <button
            className="due-btn"
            disabled={edit.repeatCount >= 10}
            onClick={() => onChange({ repeatCount: Math.min(10, edit.repeatCount + 1) })}
          >
            +
          </button>
        </span>
        <span className="due-label">播放时长（非弹幕）：</span>
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            className={`due-btn ${edit.playDuration === n ? "active" : ""}`}
            onClick={() => onChange({ playDuration: n })}
          >
            {n}s
          </button>
        ))}
        <span className="repeat-stepper">
          <button
            className="due-btn"
            disabled={edit.playDuration <= 1}
            onClick={() => onChange({ playDuration: Math.max(1, edit.playDuration - 1) })}
          >
            −
          </button>
          <span className="repeat-count">{edit.playDuration}s</span>
          <button
            className="due-btn"
            disabled={edit.playDuration >= 5}
            onClick={() => onChange({ playDuration: Math.min(5, edit.playDuration + 1) })}
          >
            +
          </button>
        </span>
        <span className="due-label">弹幕速度：</span>
        {[80, 120, 180].map((n) => (
          <button
            key={n}
            className={`due-btn ${edit.danmakuSpeed === n ? "active" : ""}`}
            onClick={() => onChange({ danmakuSpeed: n })}
          >
            {n === 80 ? "慢" : n === 120 ? "正常" : "快"}
          </button>
        ))}
        <span className="repeat-stepper">
          <button
            className="due-btn"
            disabled={edit.danmakuSpeed <= 50}
            onClick={() => onChange({ danmakuSpeed: Math.max(50, edit.danmakuSpeed - 10) })}
          >
            −
          </button>
          <span className="repeat-count">{edit.danmakuSpeed}</span>
          <button
            className="due-btn"
            disabled={edit.danmakuSpeed >= 250}
            onClick={() => onChange({ danmakuSpeed: Math.min(250, edit.danmakuSpeed + 10) })}
          >
            +
          </button>
        </span>
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
  dragOverId,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  sortBy,
  isLight,
}: {
  todo: Todo;
  screens: ScreenInfo[];
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  onTrigger: (todo: Todo) => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  dragOverId: string | null;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDrop: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  sortBy: string;
  isLight: boolean;
  }) {
  const [, setTick] = useState(0);
  const ec = isLight ? EFFECT_COLOR_LIGHT : EFFECT_COLOR;
  const tc = isLight ? TAG_COLOR_LIGHT : TAG_COLOR;
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!todo.due_at || todo.completed) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [todo.due_at, todo.completed]);

  // 编辑态 → 展示内联表单
  if (editing) {
    const editFromTodo = (): EditState => {
      const hasPreset = todo.due_at && DUE_PRESETS.some((p) => todo.due_at! <= Date.now() + p.secs * 60000 + 5000 && todo.due_at! >= Date.now() + p.secs * 60000 - 5000);
      return {
        title: todo.title,
        dueAt: todo.due_at,
        duePreset: hasPreset
          ? DUE_PRESETS.find(
              (p) => Math.abs(todo.due_at! - (Date.now() + p.secs * 1000)) < 10000
            )?.secs ?? null
          : null,
        customDue: todo.due_at ? formatLocalDT(todo.due_at) : "",
        screen: todo.screen ?? 0,
        recurrence: todo.recurrence ?? null,
        effect: todo.effect ?? "danmaku",
        tag: todo.tag ?? "",
        repeatCount: todo.repeat_count ?? 1,
        playDuration: todo.play_duration ?? 2,
        danmakuSpeed: todo.danmaku_speed ?? 120,
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
            if (edit.dueAt !== todo.due_at) patch.due_at = edit.dueAt;
            if (edit.screen !== (todo.screen ?? 0)) patch.screen = edit.screen;
            if (edit.recurrence !== (todo.recurrence ?? null)) patch.recurrence = edit.recurrence;
            if (edit.effect !== (todo.effect ?? "danmaku")) patch.effect = edit.effect;
            if (edit.tag !== (todo.tag ?? "")) patch.tag = edit.tag || null;
            if (edit.repeatCount !== (todo.repeat_count ?? 1)) patch.repeat_count = edit.repeatCount;
            if (edit.playDuration !== (todo.play_duration ?? 2)) patch.play_duration = edit.playDuration;
            if (edit.danmakuSpeed !== (todo.danmaku_speed ?? 120)) patch.danmaku_speed = edit.danmakuSpeed;
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
      draggable={sortBy === "order"}
      className={`todo-item ${todo.completed ? "completed" : ""} ${todo.due_at && !todo.completed ? "has-due" : ""} ${selected ? "selected" : ""} ${dragOverId === todo.id ? "drag-over" : ""}`}
      onDragStart={(e) => onDragStart(e, todo.id)}
      onDragOver={(e) => onDragOver(e, todo.id)}
      onDrop={(e) => onDrop(e, todo.id)}
      onDragEnd={onDragEnd}
    >
      {sortBy === "order" && (
        <span className="drag-handle" title="拖拽排序">⋮⋮</span>
      )}
      <input
        type="checkbox"
        className="todo-checkbox"
        checked={selected}
        onChange={() => onToggleSelect(todo.id)}
        onClick={(e) => e.stopPropagation()}
      />
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
          <span
            className="effect-badge"
            style={{
              color: ec[todo.effect ?? "danmaku"],
              borderColor: ec[todo.effect ?? "danmaku"],
            }}
            title={`特效：${EFFECT_LABEL[todo.effect ?? "danmaku"]}`}
          >
            {EFFECT_LABEL[todo.effect ?? "danmaku"]}
          </span>
          {todo.tag && (
            <span
              className="tag-badge"
              style={{
                backgroundColor: tc[todo.tag],
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
  // BLOCKER: revert to 300 before production launch
  const [dueInSecs, setDueInSecs] = useState<number | null>(3);
  const [customDue, setCustomDue] = useState("");
  const [customDate, setCustomDate] = useState(defaultDueDateString());
  const [customTime, setCustomTime] = useState(defaultDueTimeString());
  const customDateRef = useRef<HTMLInputElement>(null);
  const customTimeRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [danmakuInput, setDanmakuInput] = useState("");
  const [danmakuCount, setDanmakuCount] = useState(0);
  const [screens, setScreens] = useState<ScreenInfo[]>([]);
  const [targetScreen, setTargetScreen] = useState(0);
  const [recurrence, setRecurrence] = useState<string | null>(null);
  const [repeatCount, setRepeatCount] = useState(1);
  const [playDuration, setPlayDuration] = useState(2);
  const [danmakuSpeed, setDanmakuSpeed] = useState(120);
  const [effect, setEffect] = useState<EffectType | "random">("danmaku");
  const [filterTag, setFilterTag] = useState<TagType | "">("");
  const [newTag, setNewTag] = useState<TagType | "">("");

  // 特效演示区（特效演示 + 弹幕）默认折叠，降低底部信息密度
  const [debugOpen, setDebugOpen] = useState(false);
  const [personalizeOpen, setPersonalizeOpen] = useState(false);

  // Feature 3: 搜索
  const [searchQuery, setSearchQuery] = useState("");

  // Feature 2: 显示已完成
  const [showCompleted, setShowCompleted] = useState(true);

  // Feature 6: 排序
  const [sortBy, setSortBy] = useState<"created" | "due" | "order">("created");
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Feature 8: 批量选中
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Undo toast
  type UndoAction = {
    type: "complete" | "delete" | "batchComplete" | "batchDelete";
    label: string;
    revert: () => Promise<void>;
  };
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const undoRef = useRef(undoAction);
  undoRef.current = undoAction;

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
    const snaps = todos.filter((t) => selectedIds.has(t.id));
    const count = await invoke<number>("todo_batch_complete", { ids: idsArr });
    if (count > 0) {
      setTodos((prev) =>
        prev.map((t) => (selectedIds.has(t.id) ? { ...t, completed: true } : t))
      );
      deselectAll();
      setUndoAction({
        type: "batchComplete",
        label: `已完成 ${count} 条待办`,
        revert: async () => {
          for (const s of snaps) {
            await invoke("todo_update", { id: s.id, completed: false });
          }
          refresh(filterTag || undefined);
        },
      });
    }
  };

  const batchDelete = async () => {
    const idsArr = [...selectedIds];
    const snaps = todos.filter((t) => selectedIds.has(t.id));
    const count = await invoke<number>("todo_batch_delete", { ids: idsArr });
    if (count > 0) {
      setTodos((prev) => prev.filter((t) => !selectedIds.has(t.id)));
      deselectAll();
      setUndoAction({
        type: "batchDelete",
        label: `已删除 ${count} 条待办`,
        revert: async () => {
          for (const s of snaps) {
            await invoke<Todo>("todo_create", {
              title: s.title,
              dueAt: s.due_at,
              screen: s.screen ?? 0,
              recurrence: s.recurrence ?? null,
              effect: s.effect ?? null,
              tag: s.tag ?? null,
            });
          }
          refresh(filterTag || undefined);
        },
      });
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
  });

  // 主题：system / dark / light
  type Theme = "system" | "dark" | "light";
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    invoke<Preferences>("load_prefs")
      .then((p) => {
        setPrefs(p);
        setTargetScreen(p.default_screen);
        if (p.theme === "dark" || p.theme === "light") {
          setTheme(p.theme);
        }
        if (p.default_effect) {
          setEffect(p.default_effect as EffectType | "random");
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

  // 窗口聚焦时自动聚焦输入框
  useEffect(() => {
    inputRef.current?.focus();
    const onFocus = () => inputRef.current?.focus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // 检测系统是否处于浅色模式（theme=system 时需要前端同步选色）
  const [prefersLight, setPrefersLight] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    setPrefersLight(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersLight(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  const isLight = theme === "light" || (theme === "system" && prefersLight);

  // 当前主题下使用的色板
  const ec = isLight ? EFFECT_COLOR_LIGHT : EFFECT_COLOR;
  const tc = isLight ? TAG_COLOR_LIGHT : TAG_COLOR;

  // Undo toast auto-dismiss after 3s
  useEffect(() => {
    if (!undoAction) return;
    const timer = setTimeout(() => {
      if (undoRef.current) setUndoAction(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [undoAction]);

  useEffect(() => {
    refresh(filterTag || undefined);
    const refreshScreens = () => {
      invoke<ScreenInfo[]>("list_screens")
        .then(setScreens)
        .catch(console.error);
    };
    refreshScreens();
    // 定期刷新屏幕列表，检测热插拔
    const screenTimer = setInterval(refreshScreens, 5000);
    const un = listen("todos-updated", () => refresh(filterTag || undefined));
    return () => {
      clearInterval(screenTimer);
      un.then((f) => f());
    };
  }, [filterTag]);

  // 选中的屏幕被拔掉时自动切回"全部"
  useEffect(() => {
    if (targetScreen >= 0 && screens.length > 0 && !screens.some((s) => s.id === targetScreen)) {
      setTargetScreen(-1);
      savePrefs({ ...prefs, default_screen: -1 });
    }
  }, [screens, targetScreen]);

  const addTodo = async () => {
    const title = input.trim();
    if (!title) return;
    let dueAt: number | null = null;
    if (customDue) {
      dueAt = new Date(customDue).getTime();
    } else if (dueInSecs !== null) {
      dueAt = Date.now() + dueInSecs * 1000;
    }
    const todo = await invoke<Todo>("todo_create", {
      title,
      dueAt,
      screen: targetScreen,
      recurrence,
      effect: effect === "random"
        ? (Object.keys(EFFECT_LABEL) as EffectType[])[Math.floor(Math.random() * (Object.keys(EFFECT_LABEL)).length)]
        : effect,
      tag: newTag || null,
      repeatCount,
      playDuration,
      danmakuSpeed,
    });
    setTodos((prev) => [...prev, todo]);
    setInput("");
    // BLOCKER: revert to 300 before production launch
    setDueInSecs(3);
    setCustomDue("");
    setCustomDate(defaultDueDateString());
    setCustomTime(defaultDueTimeString());
    if (customDateRef.current) customDateRef.current.value = defaultDueDateString();
    if (customTimeRef.current) customTimeRef.current.value = defaultDueTimeString();
    setRecurrence(null);
    setNewTag("");
    setRepeatCount(1);
    setPlayDuration(2);
    setDanmakuSpeed(120);
  };

  const completeTodo = async (id: string) => {
    const snap = todos.find((t) => t.id === id);
    await invoke("todo_complete", { id });
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: true } : t))
    );
    if (snap) {
      setUndoAction({
        type: "complete",
        label: `「${snap.title}」已完成`,
        revert: async () => {
          await invoke("todo_update", { id, completed: false });
          refresh(filterTag || undefined);
        },
      });
    }
  };

  const deleteTodo = async (id: string) => {
    const snap = todos.find((t) => t.id === id);
    await invoke("todo_delete", { id });
    setTodos((prev) => prev.filter((t) => t.id !== id));
    if (snap) {
      setUndoAction({
        type: "delete",
        label: `「${snap.title}」已删除`,
        revert: async () => {
          await invoke<Todo>("todo_create", {
            title: snap.title,
            dueAt: snap.due_at,
            screen: snap.screen ?? 0,
            recurrence: snap.recurrence ?? null,
            effect: snap.effect ?? null,
            tag: snap.tag ?? null,
          });
          refresh(filterTag || undefined);
        },
      });
    }
  };

  const undoLast = async () => {
    if (!undoAction) return;
    const action = undoAction;
    setUndoAction(null);
    try {
      await action.revert();
    } catch (e) {
      console.error("undo failed", e);
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverId !== id) setDragOverId(id);
  };

  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverId(null);
    const draggedId = e.dataTransfer.getData("text/plain");
    if (!draggedId || draggedId === targetId) return;

    const currentIds = filteredTodos.map((t) => t.id);
    const fromIdx = currentIds.indexOf(draggedId);
    const toIdx = currentIds.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    const reordered = [...currentIds];
    reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, draggedId);

    // Optimistic UI update
    setTodos((prev) => {
      const map = new Map(prev.map((t) => [t.id, t]));
      return reordered
        .map((id, i) => {
          const t = map.get(id);
          if (!t) return null;
          return { ...t, order: i };
        })
        .filter(Boolean) as Todo[];
    });

    await invoke("todo_reorder", { ids: reordered });
  };

  const handleDragEnd = () => {
    setDragOverId(null);
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
    invoke("trigger_vfx", { effect: e, screen: targetScreen }).catch(console.error);
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
        case "order":
          return (a.order ?? 0) - (b.order ?? 0);
        default: // created
          return b.created_at - a.created_at;
      }
    });

  const activeCount = todos.filter((t) => !t.completed).length;
  const completedCount = todos.filter((t) => t.completed).length;

  return (
    <ErrorBoundary>
    <div className="console">
      <header className="console-header">
        <div className="header-title">
          <span className="app-title">VFX Todo</span>
          <span className="counter">{activeCount} 待办 · {completedCount} 已完成</span>
        </div>
        <div className="header-actions">
          <button
            className="icon-btn theme-toggle"
            onClick={() => {
              const next = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
              setTheme(next);
              savePrefs({ ...prefs, theme: next });
            }}
            title={`主题：${theme === "dark" ? "当前深色" : theme === "light" ? "当前亮色" : "当前跟随系统"} · 点击切换`}
          >
            {theme === "dark" ? "☾" : theme === "light" ? "☀" : "◐"}
          </button>
          <button className="icon-btn" onClick={() => handleExport("json")} title="导出 JSON">↓</button>
          <button className="icon-btn" onClick={() => handleImport("json")} title="导入 JSON">↑</button>
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
              borderColor: tc[t],
              color: filterTag === t ? "var(--on-accent)" : tc[t],
              backgroundColor: filterTag === t ? tc[t] : "transparent",
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
          onChange={(e) => setSortBy(e.target.value as "created" | "due" | "order")}
        >
          <option value="created">按创建时间</option>
          <option value="due">按到期时间</option>
          <option value="order">手动排序</option>
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
              isLight={isLight}
              screens={screens}
              onComplete={completeTodo}
              onDelete={deleteTodo}
              onTrigger={triggerTodoDanmaku}
              onUpdate={updateTodo}
              selected={selectedIds.has(todo.id)}
              onToggleSelect={toggleSelect}
              dragOverId={dragOverId}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              sortBy={sortBy}
            />
          ))
        )}
      </div>

      <div className="panel-area">
      <div className="panel-bar">
        <button
          className={`panel-toggle ${debugOpen ? "active" : ""}`}
          onClick={() => { setDebugOpen(!debugOpen); if (!debugOpen) setPersonalizeOpen(false); }}
          aria-expanded={debugOpen}
        >
          特效演示 {debugOpen ? "▴" : "▾"}
        </button>
        <button
          className={`panel-toggle ${personalizeOpen ? "active" : ""}`}
          onClick={() => { setPersonalizeOpen(!personalizeOpen); if (!personalizeOpen) setDebugOpen(false); }}
          aria-expanded={personalizeOpen}
        >
          个性化 {personalizeOpen ? "▴" : "▾"}
        </button>
      </div>

      {debugOpen && (
        <div className="floating-panel debug-panel">
          <div className="effect-panel">
            <span className="due-label">特效演示：</span>
            {(Object.keys(EFFECT_LABEL) as EffectType[]).map((k) => (
              <button
                key={k}
                className="effect-demo-btn"
                style={{ borderColor: ec[k], color: ec[k] }}
                onClick={() => previewEffect(k)}
                title={`预览 ${EFFECT_LABEL[k]} 特效`}
              >
                {EFFECT_LABEL[k]}
              </button>
            ))}
            <span className="effect-panel-hint">快捷键 ⌘⇧4/5/6/7/8</span>
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
        </div>
      )}

      {personalizeOpen && (
        <div className="floating-panel personalize-panel">
          <div className="due-presets">
            <span className="due-label">到期提醒：</span>
            {DUE_PRESETS.map((p) => (
              <button
                key={p.secs}
                className={`due-btn ${dueInSecs === p.secs ? "active" : ""}`}
                onClick={() => {
                  setDueInSecs(dueInSecs === p.secs ? null : p.secs);
                  setCustomDue("");
                }}
              >
                {p.label}
              </button>
            ))}
            <span className="due-datetime-group">
              <input
                ref={customDateRef}
                type="date"
                className="due-datetime"
                value={customDate}
                min={todayDateString()}
                onFocus={() => {
                  if (!customDue) {
                    const d = defaultDueDateString();
                    setCustomDate(d);
                    if (customDateRef.current) customDateRef.current.value = d;
                  }
                }}
                onChange={(e) => setCustomDate(e.target.value)}
                onBlur={() => {
                  const rawD = customDateRef.current?.value || customDate || defaultDueDateString();
                  const rawT = customTimeRef.current?.value || customTime || defaultDueTimeString();
                  const { date: d, time: t } = validateDueDateTime(rawD, rawT);
                  setCustomDate(d);
                  setCustomTime(t);
                  setCustomDue(`${d}T${t}`);
                  setDueInSecs(null);
                }}
              />
              <input
                ref={customTimeRef}
                type="time"
                className="due-datetime"
                value={customTime}
                min={customDate === todayDateString() ? timeStringNow() : undefined}
                onFocus={() => {
                  if (!customDue) {
                    const t = defaultDueTimeString();
                    setCustomTime(t);
                    if (customTimeRef.current) customTimeRef.current.value = t;
                  }
                }}
                onChange={(e) => setCustomTime(e.target.value)}
                onBlur={() => {
                  const rawD = customDateRef.current?.value || customDate || defaultDueDateString();
                  const rawT = customTimeRef.current?.value || customTime || defaultDueTimeString();
                  const { date: d, time: t } = validateDueDateTime(rawD, rawT);
                  setCustomDate(d);
                  setCustomTime(t);
                  setCustomDue(`${d}T${t}`);
                  setDueInSecs(null);
                }}
              />
              <button
                type="button"
                className="due-btn"
                onClick={() => {
                  const rawD = customDateRef.current?.value || customDate || defaultDueDateString();
                  const rawT = customTimeRef.current?.value || customTime || defaultDueTimeString();
                  const { date: d, time: t } = validateDueDateTime(rawD, rawT);
                  setCustomDate(d);
                  setCustomTime(t);
                  setCustomDue(`${d}T${t}`);
                  setDueInSecs(null);
                }}
              >
                确认
              </button>
            </span>
            {(dueInSecs !== null || customDue) && (
              <span className="due-hint">
                {customDue
                  ? `已选 ${new Date(customDue).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                  : `已选 ${dueInSecs! < 60 ? `${dueInSecs!}秒` : `${Math.round(dueInSecs! / 60)}分钟`}后触发`}
              </span>
            )}
          </div>
          <div className="recurrence-presets">
            <span className="due-label">播放次数：</span>
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                className={`due-btn ${repeatCount === n ? "active" : ""}`}
                onClick={() => setRepeatCount(n)}
              >
                {n}
              </button>
            ))}
            <span className="repeat-stepper">
              <button className="due-btn" disabled={repeatCount <= 1} onClick={() => setRepeatCount((c) => Math.max(1, c - 1))}>−</button>
              <span className="repeat-count">{repeatCount}</span>
              <button className="due-btn" disabled={repeatCount >= 10} onClick={() => setRepeatCount((c) => Math.min(10, c + 1))}>+</button>
            </span>
          </div>
          <div className="recurrence-presets">
            <span className="due-label">播放时长（非弹幕）：</span>
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                className={`due-btn ${playDuration === n ? "active" : ""}`}
                onClick={() => setPlayDuration(n)}
              >
                {n}s
              </button>
            ))}
            <span className="repeat-stepper">
              <button className="due-btn" disabled={playDuration <= 1} onClick={() => setPlayDuration((c) => Math.max(1, c - 1))}>−</button>
              <span className="repeat-count">{playDuration}s</span>
              <button className="due-btn" disabled={playDuration >= 5} onClick={() => setPlayDuration((c) => Math.min(5, c + 1))}>+</button>
            </span>
          </div>
          <div className="recurrence-presets">
            <span className="due-label">弹幕速度：</span>
            {[80, 120, 180].map((n) => (
              <button
                key={n}
                className={`due-btn ${danmakuSpeed === n ? "active" : ""}`}
                onClick={() => setDanmakuSpeed(n)}
              >
                {n === 80 ? "慢" : n === 120 ? "正常" : "快"}
              </button>
            ))}
            <span className="repeat-stepper">
              <button className="due-btn" disabled={danmakuSpeed <= 50} onClick={() => setDanmakuSpeed((c) => Math.max(50, c - 10))}>−</button>
              <span className="repeat-count">{danmakuSpeed}</span>
              <button className="due-btn" disabled={danmakuSpeed >= 250} onClick={() => setDanmakuSpeed((c) => Math.min(250, c + 10))}>+</button>
            </span>
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
        </div>
      )}
      </div>

      <div className="input-config">
        <select
          value={effect}
          onChange={(e) => {
            const v = e.target.value as EffectType | "random";
            setEffect(v);
            const p = { ...prefs, default_effect: v };
            setPrefs(p);
            savePrefs(p);
            if (v !== "random") {
              invoke("set_current_effect", { effect: v }).catch(console.error);
            }
          }}
          title="选择默认特效，快捷键 ⌘⇧2/3/4 将触发此特效"
        >
          <option value="random">随机</option>
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
          if (s >= 0) {
            const label = screens.find((sc) => sc.id === s)?.name || `屏 ${s + 1}`;
            invoke("flash_screen", { screen: s, screenName: label }).catch(console.error);
          }
        }}>
          <option value={-1}>全部</option>
          {screens.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
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
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              addTodo();
              setPersonalizeOpen(false);
            }
          }}
          onFocus={() => {
            setPersonalizeOpen(true);
            setDebugOpen(false);
          }}
          placeholder="输入待办内容，回车添加"
        />
        <button onClick={() => { addTodo(); setPersonalizeOpen(false); }}>添加</button>
      </div>

      <div className="console-hint">
        点击待办标题触发 · 到期自动派发 · 已发 {danmakuCount} 条
      </div>

      {/* Undo Toast */}
      {undoAction && (
        <div className="undo-toast">
          <span>{undoAction.label}</span>
          <button className="undo-toast-btn" onClick={undoLast}>撤销</button>
          <button className="undo-toast-close" onClick={() => setUndoAction(null)}>✕</button>
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
}

export default App;
export { ErrorBoundary };
