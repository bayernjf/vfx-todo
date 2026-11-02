use serde::{Deserialize, Serialize};

/// 公告远程 JSON 地址。
///
/// 选用 raw.githubusercontent.com 而不是 Gist：公告内容和代码一起进 PR review，
/// 散落在 Gist 上的 JSON 出错了别人也看不到。
///
/// 注意：dev 分支上读不到 main 的 raw 文件，所以公告通常要在合并到 main 后才生效。
const ANNOUNCEMENTS_URL: &str =
    "https://raw.githubusercontent.com/bayernjf/vfx-todo/main/announcements.json";

/// 单条公告。前端 `Announcement` interface 的镜像（id / title / body / date / url?）。
#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Announcement {
    pub id: String,
    pub title: String,
    pub body: String,
    pub date: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// 从仓库根目录 `announcements.json` 拉取公告列表。
///
/// 必须是 `async fn`：Tauri v2 的非 async command 在主线程执行，而这里内嵌了
/// 最长 10s 超时的 HTTP 请求，前端启动即调（App.tsx），网络不佳时 UI 冻结最长
/// 约 10 秒（review P1-6）。async command 由 Tauri 自动丢入运行时线程池。
///
/// 行为：
/// 1. dev / debug 构建：优先读本地 `announcements.json`（项目根），便于开发时改完即生效。
/// 2. 否则：HTTP 拉取 `ANNOUNCEMENTS_URL`。失败一律返回空 Vec（公告是"增强"而不是"必需"，
///    静默失败比弹错更友好）。
#[tauri::command]
pub async fn fetch_announcements() -> Vec<Announcement> {
    // Debug 模式：CARGO_MANIFEST_DIR = src-tauri/，项目根是其 parent。
    #[cfg(debug_assertions)]
    {
        let local = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(|p| p.join("announcements.json"));
        if let Some(path) = local {
            if path.exists() {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if let Ok(list) = serde_json::from_str::<Vec<Announcement>>(&content) {
                        return list;
                    }
                }
            }
        }
    }

    let client = match reqwest::Client::builder()
        .user_agent("vfx-todo-announcements")
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log::warn!("announcements: build HTTP client failed: {e}");
            return Vec::new();
        }
    };

    let resp = match client.get(ANNOUNCEMENTS_URL).send().await {
        Ok(r) => r,
        Err(e) => {
            log::info!("announcements: fetch failed (silent): {e}");
            return Vec::new();
        }
    };

    if !resp.status().is_success() {
        log::info!("announcements: non-success status {}", resp.status());
        return Vec::new();
    }

    match resp.json::<Vec<Announcement>>().await {
        Ok(list) => list,
        Err(e) => {
            log::warn!("announcements: parse failed: {e}");
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn announcement_roundtrip() {
        let a = Announcement {
            id: "2026-08-12-welcome".into(),
            title: "欢迎".into(),
            body: "正文".into(),
            date: "2026-08-12".into(),
            url: Some("https://example.com".into()),
        };
        let json = serde_json::to_string(&a).unwrap();
        let parsed: Announcement = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, "2026-08-12-welcome");
        assert_eq!(parsed.url.as_deref(), Some("https://example.com"));
    }

    #[test]
    fn announcement_optional_url_omitted() {
        let a = Announcement {
            id: "x".into(),
            title: "t".into(),
            body: "b".into(),
            date: "2026-01-01".into(),
            url: None,
        };
        let json = serde_json::to_string(&a).unwrap();
        // url 是 Option，未设时应不出现在 JSON 中（serde 默认行为）
        assert!(!json.contains("url"));
    }

    #[test]
    fn announcement_list_roundtrip() {
        let list = vec![
            Announcement {
                id: "a".into(),
                title: "A".into(),
                body: "ba".into(),
                date: "2026-01-01".into(),
                url: None,
            },
            Announcement {
                id: "b".into(),
                title: "B".into(),
                body: "bb".into(),
                date: "2026-01-02".into(),
                url: Some("https://b".into()),
            },
        ];
        let json = serde_json::to_string(&list).unwrap();
        let parsed: Vec<Announcement> = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[1].url.as_deref(), Some("https://b"));
    }

    #[test]
    fn announcement_url_field_accepts_omitted_in_json() {
        // 前端 example.json 的某些条目可能没 url 字段
        let json = r#"{"id":"x","title":"t","body":"b","date":"2026-01-01"}"#;
        let a: Announcement = serde_json::from_str(json).unwrap();
        assert_eq!(a.id, "x");
        assert!(a.url.is_none());
    }

    // ---------- P1-6 回归：command 必须是 async（主线程不跑 10s 阻塞 HTTP） ----------

    #[test]
    fn fetch_announcements_returns_future() {
        // 若退回同步 fn（主线程执行、UI 冻结），本断言无法通过编译——
        // Vec<Announcement> 不是 Future。
        fn assert_future<F: std::future::Future<Output = Vec<Announcement>>>(_: &F) {}
        assert_future(&fetch_announcements());
    }

    #[test]
    fn fetch_announcements_debug_reads_local_file_first_poll() {
        // debug 构建走项目根 announcements.json（不触网），首轮 poll 即 Ready；
        // 若哪天 debug 路径也引入真正 Pending 的 await，这里会暴露。
        use std::future::Future;
        use std::sync::Arc;
        use std::task::{Context, Poll, Wake, Waker};

        struct Noop;
        impl Wake for Noop {
            fn wake(self: Arc<Self>) {}
        }
        let waker = Waker::from(Arc::new(Noop));
        let mut cx = Context::from_waker(&waker);
        let mut fut = Box::pin(fetch_announcements());
        match fut.as_mut().poll(&mut cx) {
            Poll::Ready(list) => assert!(!list.is_empty()),
            Poll::Pending => panic!("debug local path must complete on first poll"),
        }
    }
}
