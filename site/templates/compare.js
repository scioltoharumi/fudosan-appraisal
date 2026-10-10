// site/templates/compare.js — 本命の立ち位置(神谷2-24を「条件が似た物件」と「同じ価格帯の物件」の2軸で比べる)
// 2026-10-10ユーザー要望「東十条6など条件が似ているもので並べて比べるのと、価格帯で比べるという2つの軸で分析したい」
// →「この結果をグラフィカルに分かりやすく説明するページを作って」。
//
// 設計方針:
//   - 数値の正本は market/compare-snapshot-2026-10-10.json(スナップショット)。台帳外の低地の掲載は
//     一時入力で同じエンジンに通した参考値なので、ビルドのたびに再計算せず日付つきで固定する(黙って動かさない)。
//   - 判定はしない(v3.0.0)。条件表の色は「神谷2-24を基準にした相対」で、良し悪しの判定ではない旨を明記する。
//   - 図1(散布図)が主役: 価格×延床の平面に、価格帯の帯と延床90m²の線を引き、神谷が「帯の中で上にいる唯一の新しい点」で
//     あることを目で見せる。浸水の深さは単色の濃淡(順序のある量)、新しさは塗り/白抜き(色だけに頼らない)。
//   - SVGの縦軸ラベルに rotate(-90) は使わない(運用ルール5)。軸名はグラフ上部に水平に置く。
import { layout, esc } from "./layout.js";

const C = {
  ink: "#16232E", soft: "#43566B", muted: "#7A8794", grid: "#E3E8EC", band: "#F3EBDD",
  upland: "#A9C7DA", shallow: "#4F8DB8", deep: "#1F4E79", unknown: "#9AA3AB",
  focus: "#C93A2B", below: "#2E6E8E", above: "#C9733B",
};
const FLOOD = {
  upland: { label: "台地", color: C.upland },
  shallow: { label: "浸水0.5〜3m", color: C.shallow },
  deep: { label: "浸水3〜5m", color: C.deep },
  unknown: { label: "位置未確定", color: C.unknown },
};
const KAMIYA = "kamiya2-adcast-a";
const man = (n) => Number(n).toLocaleString("ja-JP");
const nameOf = (r) => `${r.label}(${r.built.slice(0, 4)}${/新築/.test(r.label) ? "" : r.built.slice(0, 4) >= "2026" ? "新築" : "築"})`;

// ---- 図1: 価格 × 延床 の散布図 ----
// 番号つきで示す主要点(軸1=条件が似ている物件+価格帯の代表)
export const KEY_IDS = [KAMIYA, "東十条6-21711925", "akabanenishi4-21890445", "岩淵町-78266571", "上中里3-21644109",
  "神谷3新築-20184908", "東十条5-20352901"];

function figScatter(rows) {
  const W = 760, H = 470, L = 64, R = 24, T = 54, B = 64;
  const x0 = 5800, x1 = 9200, y0 = 65, y1 = 140;
  const sx = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
  const sy = (v) => T + (1 - (Math.min(v, y1) - y0) / (y1 - y0)) * (H - T - B);
  const el = [];
  // 価格帯の帯(6,000〜7,100万)と延床90m²の線
  el.push(`<rect x="${sx(6000)}" y="${T}" width="${sx(7100) - sx(6000)}" height="${H - T - B}" fill="${C.band}"/>`);
  el.push(`<text x="${(sx(6000) + sx(7100)) / 2}" y="${T + 14}" font-size="10" fill="${C.soft}" text-anchor="middle" font-weight="700">同じ価格帯</text>`);
  // グリッド・目盛り
  for (let v = 6000; v <= 9000; v += 500) {
    el.push(`<line x1="${sx(v)}" y1="${T}" x2="${sx(v)}" y2="${H - B}" stroke="${C.grid}"/>`);
    el.push(`<text x="${sx(v)}" y="${H - B + 16}" font-size="10" fill="${C.muted}" text-anchor="middle">${man(v)}</text>`);
  }
  for (let v = 70; v <= 140; v += 10) {
    el.push(`<line x1="${L}" y1="${sy(v)}" x2="${W - R}" y2="${sy(v)}" stroke="${C.grid}"/>`);
    el.push(`<text x="${L - 8}" y="${sy(v) + 3.5}" font-size="10" fill="${C.muted}" text-anchor="end">${v}</text>`);
  }
  el.push(`<line x1="${L}" y1="${sy(90)}" x2="${W - R}" y2="${sy(90)}" stroke="${C.soft}" stroke-width="1.2" stroke-dasharray="5 4"/>`);
  el.push(`<text x="${W - R - 4}" y="${sy(90) - 5}" font-size="10" fill="${C.soft}" text-anchor="end">延床90m²</text>`);
  el.push(`<text x="${L}" y="${T - 12}" font-size="10.5" fill="${C.soft}">延床(m²)</text>`);
  el.push(`<text x="${(L + W - R) / 2}" y="${H - 18}" font-size="10.5" fill="${C.soft}" text-anchor="middle">売出価格(万円)</text>`);
  // 点(本命は最後に描いて最前面へ)
  const sorted = [...rows].sort((a, b) => (a.id === KAMIYA) - (b.id === KAMIYA));
  for (const r of sorted) {
    const cx = sx(r.price), cy = sy(r.floor), col = FLOOD[r.flood].color;
    const isK = r.id === KAMIYA;
    const tip = `${nameOf(r)} ${man(r.price)}万・延床${r.floor}m²・土地${r.land}m²・徒歩${r.walk}分・${FLOOD[r.flood].label}・査定の中央値との差 ${r.gap >= 0 ? "+" : ""}${man(r.gap)}万${r.floor > y1 ? "(延床が図の上限を超えるため上端に表示)" : ""}`;
    if (isK) el.push(`<circle cx="${cx}" cy="${cy}" r="11" fill="none" stroke="${C.focus}" stroke-width="2.2"/>`);
    el.push(`<circle cx="${cx}" cy="${cy}" r="5.5" fill="${r.newish ? col : "#fff"}" stroke="${r.newish ? "#fff" : col}" stroke-width="${r.newish ? 2 : 2.2}"><title>${esc(tip)}</title></circle>`);
    const k = KEY_IDS.indexOf(r.id);
    if (k > 0) el.push(`<text x="${cx + 8}" y="${cy - 7}" font-size="10" font-weight="700" fill="${C.ink}">${k}</text>`);
  }
  const k = rows.find((r) => r.id === KAMIYA);
  el.push(`<text x="${sx(k.price)}" y="${sy(k.floor) + 27}" font-size="11.5" font-weight="700" fill="${C.focus}" text-anchor="middle">神谷2-24(本命)</text>`);
  // 凡例(上部・水平)
  let lx = L + 120;
  for (const key of ["upland", "shallow", "deep", "unknown"]) {
    el.push(`<circle cx="${lx}" cy="${T - 32}" r="5" fill="${FLOOD[key].color}"/>`);
    el.push(`<text x="${lx + 9}" y="${T - 28.5}" font-size="9.5" fill="${C.soft}">${FLOOD[key].label}</text>`);
    lx += 95;
  }
  el.push(`<circle cx="${L + 120}" cy="${T - 14}" r="5" fill="${C.shallow}" stroke="#fff" stroke-width="2"/>`);
  el.push(`<text x="${L + 129}" y="${T - 10.5}" font-size="9.5" fill="${C.soft}">塗り=築5年以内</text>`);
  el.push(`<circle cx="${L + 230}" cy="${T - 14}" r="5" fill="#fff" stroke="${C.shallow}" stroke-width="2.2"/>`);
  el.push(`<text x="${L + 239}" y="${T - 10.5}" font-size="9.5" fill="${C.soft}">白抜き=それ以前</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="売出価格と延床面積の散布図。神谷2-24は同じ価格帯の中で新しい点(延床は居住部分のみ)" style="max-width:${W}px;font-family:inherit">${el.join("")}</svg>`;
}

// ---- 図3: 同じ価格帯の「査定の中央値との差」(発散棒) ----
function figGapBars(rows) {
  const band = rows.filter((r) => r.price >= 5900 && r.price <= 7100).sort((a, b) => a.gap - b.gap);
  const W = 760, L = 250, R = 70, T = 34, RH = 26, H = T + band.length * RH + 30;
  const max = Math.max(...band.map((r) => Math.abs(r.gap)), 500);
  const x0 = L + (W - L - R) * (500 / (max + 500));          // 0の位置(マイナス側に少し余白)
  const sc = (v) => ((W - L - R) * Math.abs(v)) / (max + 500);
  const el = [];
  el.push(`<text x="${L}" y="${T - 16}" font-size="10.5" fill="${C.soft}">査定との差(万円) 左=安い / 右=高い</text>`);
  el.push(`<line x1="${x0}" y1="${T - 6}" x2="${x0}" y2="${T + band.length * RH}" stroke="${C.soft}" stroke-width="1.2"/>`);
  band.forEach((r, i) => {
    const y = T + i * RH, isK = r.id === KAMIYA;
    if (isK) el.push(`<rect x="4" y="${y}" width="${W - 8}" height="${RH - 2}" fill="#FDF0EE"/>`);
    const w = Math.max(sc(r.gap), 2), x = r.gap < 0 ? x0 - w : x0;
    const nm = `${nameOf(r)}${r.src === "listing" ? "*" : ""}`;
    el.push(`<text x="${L - 10}" y="${y + 16}" font-size="10.5" fill="${isK ? C.focus : C.ink}" text-anchor="end"${isK ? ' font-weight="700"' : ""}>${esc(nm)}</text>`);
    el.push(`<rect x="${x}" y="${y + 5}" width="${w}" height="14" rx="3" fill="${r.gap < 0 ? C.below : C.above}"><title>${esc(`${nameOf(r)} 売出${man(r.price)}万 / 査定の中央値${man(r.fair)}万`)}</title></rect>`);
    if (isK && r.extra) {   // 別途費用を足した実質の幅(ひげ)
      const a = x0 + (r.gap + r.extra.min < 0 ? -sc(r.gap + r.extra.min) : sc(r.gap + r.extra.min));
      const b = x0 + sc(r.gap + r.extra.max);
      el.push(`<line x1="${a}" y1="${y + 12}" x2="${b}" y2="${y + 12}" stroke="${C.focus}" stroke-width="2"/>`);
      el.push(`<line x1="${b}" y1="${y + 6}" x2="${b}" y2="${y + 18}" stroke="${C.focus}" stroke-width="2"/>`);
    }
    const lab = `${r.gap >= 0 ? "+" : ""}${man(r.gap)}`;
    const tx = isK && r.extra ? x0 + sc(r.gap + r.extra.max) + 6 : r.gap < 0 ? x - 6 : x + w + 6;
    el.push(`<text x="${tx}" y="${y + 16}" font-size="10" fill="${C.soft}" text-anchor="${r.gap < 0 && !(isK && r.extra) ? "end" : "start"}">${lab}</text>`);
  });
  return { svg: `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="同じ価格帯の物件の、査定の中央値との差の棒グラフ" style="max-width:${W}px;font-family:inherit">${el.join("")}</svg>`, n: band.length };
}

// ---- 図2: 条件が似ている物件の比較表(神谷を基準にした相対の色) ----
function condTable(rows) {
  const ids = KEY_IDS.slice(0, 6);
  const rs = ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
  const k = rs[0];
  const tone = (d) => (d > 0 ? "background:#E6F0F5" : d < 0 ? "background:#FBEBDD" : "");
  const floodRank = { upland: 3, shallow: 2, deep: 1, unknown: 0 };
  const cells = (r) => {
    const isK = r === k;
    const t = (d) => (isK ? "" : tone(d));
    return `
      <td style="${t(k.price - r.price)}"><b>${man(r.price)}万</b></td>
      <td style="${t(Number(r.built.slice(0, 4)) - Number(k.built.slice(0, 4)) >= 0 ? 0 : -1)}">${r.built.slice(0, 4)}年</td>
      <td style="${t(Math.sign(Math.round(r.floor - k.floor) / 5 | 0))}">${r.floor}m²</td>
      <td>${esc(r.incl ?? "—")}</td>
      <td>${esc(r.layout && r.layout !== "-" ? r.layout : "—")}</td>
      <td style="${t(Math.sign(r.land - k.land))}">${r.land}m²</td>
      <td style="${t(r.lot === "旗竿?" ? -1 : 0)}">${esc(r.lot ?? "—")}</td>
      <td style="${t(k.walk - r.walk)}">徒歩${r.walk}分</td>
      <td style="${t(Math.sign((/接道幅3m/.test(r.note) ? 3 : (r.road ?? 4)) - k.road))}">${r.road ?? "-"}m</td>
      <td style="${t(floodRank[r.flood] - floodRank[k.flood])}">${FLOOD[r.flood].label}</td>
      <td style="${t(k.gap - r.gap)}">${r.gap >= 0 ? "+" : ""}${man(r.gap)}万</td>`;
  };
  return `<div style="overflow-x:auto"><table class="kv" style="min-width:720px;font-size:.78rem">
    <tr><th></th><th>価格</th><th>築年</th><th>延床</th><th>うち</th><th>間取り</th><th>土地</th><th>敷地</th><th>徒歩</th><th>道路</th><th>浸水</th><th>査定との差</th></tr>
    ${rs.map((r, i) => `<tr${r === k ? ' style="font-weight:700"' : ""}><td>${i === 0 ? "" : `<b>${i}</b> `}${r.url ? `<a href="${esc(r.url)}">${esc(nameOf(r))}</a>` : esc(nameOf(r))}${r.src === "listing" ? "*" : ""}</td>${cells(r)}</tr>`).join("")}
  </table></div>`;
}

// ---- 神谷2-24の確認事項(2026-10-10の参考プラン図から。ユーザー要望「ロフトや風呂1616の注意点を簡潔に比較ページへ」) ----
// 金額は見積前の目安。確定は設備負担金60万のみ
const CHECKS = [
  ["風呂 1316→1616", "納戸4.3帖→約3.5帖", "+10〜25万・構造計算で可否"],
  ["ロフト5.1帖", "図面にあるが価格外。約8.3m²=延床に入らない", "+50〜150万・無しの場合の天井は?"],
  ["ロフトの体感", "収納に使えば 83+8=約91m²相当", "天井1.4m以下・はしご・夏は暑い"],
  ["設備負担金", "60万(確定)", "内訳"],
  ["地盤改良", "荒川低地の軟弱地盤", "+100〜200万(想定)"],
  ["実総額", "6,580 → 6,800〜6,950万", "査定6,396万より+400〜550"],
  ["間取り", "2LDK+S(1F納戸4.3帖・3F 7.9+7.3帖)", "子供2人だと不足"],
  ["車庫", "幅2.2m(芯々)・奥行き約5.9m", "ドア全開は不可"],
  ["プラン", "天空率・真北・構造計算で変更の可能性", "確定ではない"],
  ["浸水", "3〜5m(想定最大規模)・2階床に届く", "水災補償・避難先"],
];
function checkTable() {
  return `<div style="overflow-x:auto"><table class="kv" style="min-width:560px;font-size:.78rem">
    <tr><th>項目</th><th>いま</th><th style="text-align:left">見るところ</th></tr>
    ${CHECKS.map(([a, b, c]) => `<tr><td><b>${esc(a)}</b></td><td>${esc(b)}</td><td style="text-align:left">${esc(c)}</td></tr>`).join("")}
  </table></div>`;
}

export function renderCompare({ snapshot }) {
  const rows = snapshot.rows;
  const k = rows.find((r) => r.id === KAMIYA);
  if (!k) throw new Error("compare: スナップショットに本命(kamiya2-adcast-a)が無い");
  for (const id of KEY_IDS) if (!rows.find((r) => r.id === id)) throw new Error(`compare: 主要点 ${id} がスナップショットに無い`);
  const bars = figGapBars(rows);
  const keyList = KEY_IDS.slice(1).map((id, i) => {
    const r = rows.find((x) => x.id === id);
    return `<b>${i + 1}</b> ${esc(nameOf(r))}`;
  }).join("　");
  const body = `
  <section class="panel">
    <h2>結論</h2>
    <div class="logic-body" style="font-size:.95rem;line-height:2">
      <div>① この価格帯で <b>新築・JR徒歩11分・6m公道・車庫</b> がそろうのは <b>神谷2-24だけ</b></div>
      <div>② 広さは <b>2LDK+S・83m²</b>。同じ帯の中古より1部屋小さい</div>
      <div>③ 値段は <b>査定どおり(+184万)</b>。別途込みで+250〜550万。同じ帯の他は+400〜2,500万</div>
      <div>④ 弱点は <b>浸水3〜5m・小さい土地・広さ</b></div>
    </div>
  </section>

  <section class="panel">
    <h2>価格 × 広さ</h2>
    <div class="scale-wrap">${figScatter(rows)}</div>
    <div class="note">${keyList}</div>
  </section>

  <section class="panel">
    <h2>条件が近い物件</h2>
    ${condTable(rows)}
    <div class="note"><span style="background:#E6F0F5;padding:0 4px">青=神谷より有利</span> <span style="background:#FBEBDD;padding:0 4px">橙=不利</span>　旗竿?=接道3mから推定　車庫別=神谷の延床は居住部分のみ</div>
  </section>

  <section class="panel">
    <h2>同じ価格帯で、査定と比べて</h2>
    <div class="scale-wrap">${bars.svg}</div>
  </section>

  <section class="panel">
    <h2>神谷2-24 決める前に</h2>
    ${checkTable()}
  </section>

  <p class="note">※${esc(snapshot.as_of.slice(5).replace("-", "/").replace(/^0/, ""))}時点 / *=台帳外(参考値) / 浸水=丁目の代表点 / 神谷の延床=居住部分(車庫・ポーチ除く) / 相対比較で判定ではない</p>
  <p style="margin-top:14px"><a class="src-link" href="index.html">← 物件一覧へ戻る</a></p>`;
  return layout({ title: "本命の立ち位置", subtitle: "神谷2-24を2つの軸で比べる", docNo: "COMPARE", body });
}
