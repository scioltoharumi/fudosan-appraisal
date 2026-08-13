// site/templates/layout.js — 共通レイアウトとHTMLヘルパー
import { CSS } from "./style.js";

export const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// 台帳のステータス(人が設定する検討状況)。YAMLの status: がサイト表示の初期値になり、
// 一覧ページではブラウザ側で上書きできる(2026-08-13: 機械判定の廃止に伴い、
// 「見送り」は人の判断としてここに入る。エンジンは判定を出さない)
export const STATUS_LABEL = {
  new: "新規",
  considering: "検討中",
  viewed: "内見済",
  declined: "見送り",
  closed: "成約済",
};

// 一覧ページのプルダウンで選べる値。表示順 = ソート順(検討の進み方の順)
export const STATUS_CHOICES = ["新規", "検討中", "内見済", "見送り"];

// YAMLの日付(Date or 文字列)を YYYY-MM-DD に整形
export const fmtDate = (d) => {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d ?? "");
};

// 外部リンクはhttpsのみ許可(YAML由来の値をhrefに入れるためのガード)
export const safeUrl = (u) =>
  typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null;

export function layout({ title, subtitle, docNo, body }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="sheet">
  <header class="site">
    <div>
      <h1>${esc(title)}</h1>
      ${subtitle ? `<div style="font-size:.75rem;color:var(--ink-soft);letter-spacing:.08em">${subtitle}</div>` : ""}
    </div>
    <div class="doc-no">${docNo}</div>
  </header>
${body}
</div>
</body>
</html>
`;
}
