import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type Level = "low" | "mid" | "high";

interface Todo {
  id: string;
  title: string;
  level: Level;
  completed: boolean;
  created_at: number;
  due_at: number | null;
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

function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState("");
  const [level, setLevel] = useState<Level>("low");
  const [dueInMin, setDueInMin] = useState<number | null>(null);
  const [danmakuInput, setDanmakuInput] = useState("");
  const [danmakuCount, setDanmakuCount] = useState(0);
  const [, setTick] = useState(0);

  const refresh = () => {
    invoke<Todo[]>("todo_list")
      .then(setTodos)
      .catch(console.error);
  };

  useEffect(() => {
    refresh();
    // 监听调度器触发的刷新事件
    const un = listen("todos-updated", () => refresh());
    // 每秒重算倒计时显示
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      un.then((f) => f());
      clearInterval(timer);
    };
  }, []);

  const addTodo = async () => {
    const title = input.trim();
    if (!title) return;
    const dueAt =
      dueInMin !== null ? Date.now() + dueInMin * 60_000 : null;
    const todo = await invoke<Todo>("todo_create", {
      title,
      level,
      dueAt,
    });
    setTodos((prev) => [...prev, todo]);
    setInput("");
    setDueInMin(null);
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
      await invoke("send_danmaku", { text, color, speed });
      setDanmakuCount((c) => c + 1);
      setDanmakuInput("");
    } catch (e) {
      console.error("send_danmaku failed", e);
    }
  };

  const activeCount = todos.filter((t) => !t.completed).length;

  return (
    <div className="console">
      <header className="console-header">
        <span className="badge">vfx-todo</span>
        <span className="counter">{activeCount} 待办 · {todos.length} 总计</span>
      </header>

      <div className="todo-list">
        {todos.length === 0 ? (
          <div className="todo-empty">暂无待办，添加一个试试</div>
        ) : (
          todos.map((todo) => (
            <div
              key={todo.id}
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
                  onClick={() => !todo.completed && triggerTodoDanmaku(todo)}
                >
                  {todo.title}
                </span>
                {todo.due_at && !todo.completed && (
                  <span className="todo-due">{formatDue(todo.due_at)}</span>
                )}
              </div>
              {!todo.completed && (
                <button className="todo-btn complete" onClick={() => completeTodo(todo.id)}>
                  完成
                </button>
              )}
              <button className="todo-btn delete" onClick={() => deleteTodo(todo.id)}>
                删除
              </button>
            </div>
          ))
        )}
      </div>

      <div className="todo-input">
        <select value={level} onChange={(e) => setLevel(e.target.value as Level)}>
          <option value="low">弹幕</option>
          <option value="mid">粒子</option>
          <option value="high">破碎</option>
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
            onClick={() => setDueInMin(dueInMin === p.mins ? null : p.mins)}
          >
            {p.label}
          </button>
        ))}
        {dueInMin !== null && <span className="due-hint">已选 {dueInMin} 分钟后触发</span>}
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
        点击待办标题触发弹幕 · 到期自动弹幕 · 已发 {danmakuCount} 条
      </div>
    </div>
  );
}

export default App;
