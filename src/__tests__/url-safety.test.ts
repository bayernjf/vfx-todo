/**
 * 公告链接协议白名单测试（P2-13）
 * 远程公告 JSON 的 url 会进入 <a href>，必须只放行 http/https。
 */
import { describe, it, expect } from "vitest";
import { isSafeExternalUrl } from "../App";

describe("isSafeExternalUrl", () => {
  it.each([
    "https://example.com/release",
    "http://example.com",
    "HTTPS://EXAMPLE.COM/PATH",
    "  https://example.com/announcement  ",
  ])("allows http/https url: %s", (url) => {
    expect(isSafeExternalUrl(url)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "file:///etc/passwd",
    "vbscript:msgbox(1)",
    "mailto:someone@example.com",
    "//example.com/path",
    "example.com",
    "",
    "   ",
    null,
    undefined,
  ])("rejects unsafe or non-http url: %s", (url) => {
    expect(isSafeExternalUrl(url as string | null | undefined)).toBe(false);
  });
});
