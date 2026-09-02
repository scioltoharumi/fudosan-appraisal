// site/templates/layout.js — 共通レイアウトとHTMLヘルパー
import { CSS } from "./style.js";

export const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// YAMLの自由文で使っている **強調** を太字にする(2026-08-29)。
// 物件YAMLの caveats/source は Markdown 風の ** を使って書かれてきたが、描画側は esc() だけを
// 通していたため、全物件ページに生の ** が230箇所そのまま出ていた。
// **必ず esc() を先に通してから**マーカーを変換する(順序を逆にするとHTMLを注入できてしまう)。
// 対応するのは同一行内の **…** のみで、空文字や改行を跨ぐものは変換しない。
export const escRich = (s) => esc(s).replace(/\*\*([^*\n]+?)\*\*/g, "<b>$1</b>");

// 台帳のステータス(人が設定する検討状況)。YAMLの status: がサイト表示の初期値になり、
// 一覧ページではブラウザ側で上書きできる(2026-08-13: 機械判定の廃止に伴い、
// 「見送り」は人の判断としてここに入る。エンジンは判定を出さない)
export const STATUS_LABEL = {
  new: "新規",
  considering: "検討中",
  on_hold: "保留(値下げ待ち)",   // 物件は良いが価格が折り合わず、値下げを待つ段階(2026-08-15追加)
  viewed: "内見済",              // 旧値。2026-08-15以降は viewing へ分離(読み込み時に検討中へ読み替え)
  declined: "見送り",
  closed: "成約済",
};

// 一覧ページのプルダウンで選べる値。表示順 = ソート順(検討の進み方の順)
// 検討状況の選択肢(2026-08-15にユーザー指示で「内見済」を分離)。
// 内見は**事実**(見に行ったか)、検討状況は**判断**(進めるか)で、同時に成り立つ。
// 1つのプルダウンに同居させると「内見したうえで検討中」が表現できず情報が消えるため、
// 内見は別列のチェックボックス(property.viewed)にした。
// 旧データ(status:"内見済" / YAMLの status: viewed)は viewed=true + 検討中 へ移行する。
export const STATUS_CHOICES = ["新規", "検討中", "保留(値下げ待ち)", "見送り"];

// 内見の段階(2026-08-15にユーザー指示で3値化)。「未」と「内見済」の間に、
// 行くと決めたがまだ行っていない段階(内見希望)がある。真偽値では表現できない
export const VIEW_LABEL = { none: "未", wanted: "内見希望", done: "内見済" };
export const VIEW_CHOICES = ["未", "内見希望", "内見済"];

// YAMLの日付(Date or 文字列)を YYYY-MM-DD に整形
export const fmtDate = (d) => {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d ?? "");
};

// 外部リンクはhttpsのみ許可(YAML由来の値をhrefに入れるためのガード)
// crawl_ids(source_url に置けない掲載ID)からリンクを復元する(2026-09-02)。
// 岸町2 MIRASUMO は掲載価格(土地単体5,810万)と台帳(総額7,480万)が恒常的に食い違うため
// source_url を意図的に空にしているが、その結果**人がページから掲載元へ辿れなくなっていた**
// (ユーザー指摘「掲載元はどこにいった？」)。watch の監視対象にはせず、参照リンクとしてだけ出す。
// URL は市区固定(北区)。kind が seen.json に無い nc_ は**推測せず**出さない
export const crawlIdUrl = (id, seenEntry) => {
  const s = String(id ?? "");
  const at = s.match(/^at_(\d+)$/);
  if (at) return `https://www.athome.co.jp/kodate/${at[1]}/`;
  if (!/^nc_\d+$/.test(s)) return null;
  const path = { chuko: "chukoikkodate", shinchiku: "ikkodate", tochi: "tochi" }[seenEntry?.kind];
  return path ? `https://suumo.jp/${path}/tokyo/sc_kita/${s}/` : null;
};
export const crawlLinksOf = (property, seen) =>
  (property?.crawl_ids ?? []).map((id) => ({ id, url: crawlIdUrl(id, seen?.[id]) })).filter((x) => x.url);

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

// 物件ごとに固定の線色。simulate(購入) と rent(賃貸) の両方が使う。
// 台帳が増えると色が一周して同じ色が2本出るため、**台帳の最大件数より多い色数を持つこと**
// (賃貸側は8色しか持っておらず、9物件目で線色が重複し10物件目で凡例が枠外へ出ていた。2026-08-19の監査指摘)
export const PALETTE = [
  "#2E6E8E", "#C93A2B", "#3A8A4D", "#B8860B", "#C25596", "#1F9E9E", "#8A5A2B", "#4A6FD0",
  "#8C3A5C", "#5F7A22", "#B4471F", "#3AA0C9", "#7A4E9B", "#2F7A5F", "#A05252", "#5C6B7A",
];
