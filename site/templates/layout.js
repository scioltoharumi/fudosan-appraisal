// site/templates/layout.js — 共通レイアウトとHTMLヘルパー
import { CSS } from "./style.js";

export const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const STATUS_LABEL = {
  considering: "検討中",
  viewed: "内見済",
  declined: "見送",
  closed: "成約済",
};

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
