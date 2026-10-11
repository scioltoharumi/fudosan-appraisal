// site/templates/flood.js — 水の確率(神谷2-24-11 の深さ別の30年確率を図で読む・共有用)
// 2026-10-11ユーザー要望「何が2.2%なのか、複数破堤なら3%とはどういう意味なのか、初心者には分からない。
// 文字量は少なめに、他の人にも伝わるようにグラフィカルに、ページを構成して」。
//
// 設計方針:
//   - 数値はすべてビルド時に engine/flood.js + スナップショット(浸水ナビ)から計算して注入する。手書きの数字を持たない。
//   - 文字は結論・図のキャプション・誤解3つに絞る。根拠の全文は物件ページ(深さ別の確率の表)に正本がある。
//   - 図1=確率の3因子(どれが公式データでどれが仮定か) / 図2=破堤点のドット図(包絡と確率の違い) /
//     図3=30年の確率の横棒(幅・複数破堤・100軒のうち何軒) / 図4=家の断面に水位(深さの意味)
//   - 判定はしない。「桁の目安」「公式の確率ではない」を必ず出す。
//   - SVGの縦軸ラベルに rotate(-90) は使わない(運用ルール5)。
import { layout, esc } from "./layout.js";
import { exceedance, groupStats, oneInN, DEFAULT_BANDS } from "../../engine/flood.js";

const C = { ink: "#16232E", soft: "#43566B", deep: "#1F4E79", mid: "#2E6E8E", light: "#8FBBD3", pale: "#D6E6EF", none: "#D9DEE3", warn: "#B07C10", stop: "#C93A2B", ok: "#2C6E49" };

const pct1 = (p) => `${(p * 100).toFixed(1)}%`;
const houses = (p) => { const n = p * 100; return n >= 1 ? `100軒のうち約${Math.round(n)}軒` : n >= 0.1 ? `1,000軒のうち約${Math.round(n * 10)}軒` : "1,000軒に1軒未満"; };

function text(el, x, y, t, { fs = 9.5, color = C.ink, bold = false, anchor = "start" } = {}) {
  el.push(`<text x="${x}" y="${y}" font-size="${fs}" fill="${color}"${bold ? ' font-weight="700"' : ""} text-anchor="${anchor}">${esc(t)}</text>`);
}
function box(el, x, y, w, h, lines, { stroke = C.ink, fill = "#fff", sw = 1.2 } = {}) {
  el.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
  lines.forEach((ln, i) => { const [t, o = {}] = Array.isArray(ln) ? ln : [ln]; text(el, x + w / 2, y + (o.y ?? 18 + i * 15), t, { ...o, anchor: "middle" }); });
}
const svg = (W, H, label, el) => `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" style="width:100%;height:auto;max-width:${W}px">${el.join("")}</svg>`;

// ---- 図1: 確率の3因子 ----
function figFactors(rows, l2) {
  const W = 760, H = 230, el = [];
  const r1 = rows.find((r) => r.depth_m === 1);
  const bw = 200, by = 40, bh = 120;
  const xs = [20, 280, 540];
  box(el, xs[0], by, bw, bh, [
    ["① どのくらい大きな洪水か", { fs: 10.5, bold: true, y: 20 }],
    ["200年に1回 〜 1,000年に1回級", { fs: 9.5, y: 44 }],
    ["の洪水が来る確率", { fs: 9.5, y: 58 }],
    ["公式の定義 + 置いた帯", { fs: 8.5, y: 84, color: C.warn, bold: true }],
    ["(年あたり 0.1〜1%)", { fs: 8.5, y: 100, color: C.soft }],
  ], { stroke: C.warn });
  box(el, xs[1], by, bw, bh, [
    ["② 堤防が切れるか", { fs: 10.5, bold: true, y: 20 }],
    ["大洪水でも必ず切れるわけではない", { fs: 9, y: 44 }],
    ["1947年は堤防の高さまで来て保った", { fs: 9, y: 58 }],
    ["置いた仮定", { fs: 8.5, y: 84, color: C.stop, bold: true }],
    ["(0.3〜0.7 / 想定最大なら 0.6〜0.9)", { fs: 8.5, y: 100, color: C.soft }],
  ], { stroke: C.stop });
  box(el, xs[2], by, bw, bh, [
    ["③ 切れた場所の水がここに届くか", { fs: 10.5, bold: true, y: 20 }],
    [`荒川の破堤点 ${l2.total}か所のうち`, { fs: 9.5, y: 44 }],
    [`ここに届くのは ${l2.reaching}か所`, { fs: 9.5, y: 58, bold: true }],
    ["公式データ(国交省 浸水ナビ)", { fs: 8.5, y: 84, color: C.ok, bold: true }],
    ["(破堤点ごとの水の深さを数える)", { fs: 8.5, y: 100, color: C.soft }],
  ], { stroke: C.ok });
  text(el, 250, 106, "×", { fs: 22, bold: true, anchor: "middle", color: C.soft });
  text(el, 510, 106, "×", { fs: 22, bold: true, anchor: "middle", color: C.soft });
  // 下段: 積の結果
  el.push(`<path d="M380,170 L380,185" stroke="${C.soft}" stroke-width="1.5"/>`);
  text(el, 380, 204, `1m以上の水が来る確率 = 年あたり 1/${oneInN(r1.annual.mid).toLocaleString("ja-JP")}年 → 30年住むと ${pct1(r1.cum.mid)}(${houses(r1.cum.mid)})`, { fs: 11, bold: true, anchor: "middle", color: C.deep });
  text(el, 380, 222, "3つを掛け算して「年あたり」を出し、それを住む年数(30年)ぶん積み上げる", { fs: 9, anchor: "middle", color: C.soft });
  return svg(W, H, "確率の3因子: 洪水の大きさ × 堤防が切れるか × 切れた場所の水がここに届くか", el);
}

// ---- 図2: 破堤点のドット図(想定最大規模) ----
function depthClass(d) { return d >= 4 ? 4 : d >= 3 ? 3 : d >= 1 ? 2 : d > 0 ? 1 : 0; }
const CLS = [
  { k: 0, label: "届かない", color: C.none },
  { k: 1, label: "1m未満", color: C.pale },
  { k: 2, label: "1〜3m", color: C.light },
  { k: 3, label: "3〜4m", color: C.mid },
  { k: 4, label: "4m以上(最大4.4m)", color: C.deep },
];
function dotGrid(el, x0, y0, group, title, perRow = 22) {
  const depths = group.rows.map((r) => Number(r.depth_m)).sort((a, b) => b - a);
  const all = [...depths, ...Array(Math.max(0, group.breakpoints_total - depths.length)).fill(0)];
  const step = 13, r = 5;
  text(el, x0, y0 - 8, title, { fs: 10.5, bold: true });
  all.forEach((d, i) => {
    const cx = x0 + (i % perRow) * step + r, cy = y0 + Math.floor(i / perRow) * step + r + 4;
    el.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${CLS[depthClass(d)].color}" stroke="#fff" stroke-width="0.8"/>`);
  });
  return y0 + Math.ceil(all.length / perRow) * step + 10;
}
function figDots(l1g, l2g, l1, l2) {
  const W = 760, H = 330, el = [];
  const yEnd2 = dotGrid(el, 20, 28, l2g, `想定最大規模(1,000年に1回級)の破堤点 ${l2.total}か所 ── 色がついた ${l2.reaching}か所の水だけがここに届く`, 24);
  const yEnd1 = dotGrid(el, 20, yEnd2 + 24, l1g, `計画規模(200年に1回級)の破堤点 ${l1.total}か所 ── 届くのは ${l1.reaching}か所・最大 ${l1.max}m`, 24);
  // 凡例
  let lx = 390, ly = 40;
  text(el, lx, ly, "ここでの水の深さ", { fs: 10, bold: true });
  CLS.slice().reverse().forEach((c, i) => {
    const y = ly + 16 + i * 17;
    el.push(`<circle cx="${lx + 6}" cy="${y - 3}" r="5" fill="${c.color}" stroke="#bbb" stroke-width="0.6"/>`);
    const n = c.k === 0 ? l2.total - l2.reaching : l2g.rows.filter((r) => depthClass(Number(r.depth_m)) === c.k).length;
    text(el, lx + 18, y, `${c.label}: ${n}か所(想定最大)`, { fs: 9.5 });
  });
  text(el, lx, ly + 112, `5mにする破堤点: 0か所(最大 ${l2.max}m・右岸21km=岩淵水門のすぐ下流)`, { fs: 9.5, bold: true, color: C.deep });
  text(el, lx, ly + 130, "ハザードマップの「3〜5m」は、この中で最も深い", { fs: 9.5, color: C.soft });
  text(el, lx, ly + 144, "破堤点を重ねた「最悪の絵」。確率ではない", { fs: 9.5, color: C.soft });
  text(el, 20, Math.max(yEnd1, H - 10), "灰色は、そこが切れてもここには水が来ない破堤点(対岸=左岸の全部と、遠い右岸)", { fs: 9, color: C.soft });
  return svg(W, H, "破堤点のドット図: 想定最大規模211か所・計画規模182か所のうち、この地点に届く破堤点を深さで色分け", el);
}

// ---- 図3: 30年の確率の横棒 ----
function figBars(rows, multi, naisui) {
  const W = 760, H = 350, el = [];
  const x0 = 150, barMax = 420, scale = 0.05;   // 0〜5%
  const px = (p) => x0 + Math.min(p, scale) / scale * barMax;
  text(el, 20, 20, "30年住む間に、この深さ以上の水が来る確率(外水=荒川の破堤)", { fs: 11, bold: true });
  // 目盛り
  [0, 0.01, 0.02, 0.03, 0.04, 0.05].forEach((v) => {
    el.push(`<line x1="${px(v)}" y1="34" x2="${px(v)}" y2="${34 + 5 * 34}" stroke="#E3E8EC" stroke-width="1"/>`);
    text(el, px(v), 32, `${v * 100}%`, { fs: 8.5, anchor: "middle", color: C.soft });
  });
  const depths = [1, 2, 3, 4, 5];
  depths.forEach((d, i) => {
    const r = rows.find((x) => x.depth_m === d), m = multi.find((x) => x.depth_m === d);
    const y = 44 + i * 34, bh = 16;
    text(el, x0 - 10, y + 12, `${d}m 以上`, { fs: 10.5, bold: true, anchor: "end" });
    if (r.annual.high <= 0) {
      text(el, x0 + 6, y + 12, "0 ── 公式の計算(単一破堤・632mm以下)では出ない。上限は未計算", { fs: 9.5, color: C.soft });
      return;
    }
    // 複数破堤なら(薄い延長)
    el.push(`<rect x="${x0}" y="${y}" width="${px(m.cum.mid) - x0}" height="${bh}" fill="${C.pale}"/>`);
    // 中
    el.push(`<rect x="${x0}" y="${y}" width="${px(r.cum.mid) - x0}" height="${bh}" fill="${C.mid}"/>`);
    // 幅(低〜高)
    el.push(`<line x1="${px(r.cum.low)}" y1="${y + bh / 2}" x2="${px(r.cum.high)}" y2="${y + bh / 2}" stroke="${C.ink}" stroke-width="1.4"/>`);
    el.push(`<line x1="${px(r.cum.low)}" y1="${y + 3}" x2="${px(r.cum.low)}" y2="${y + bh - 3}" stroke="${C.ink}" stroke-width="1.4"/>`);
    el.push(`<line x1="${px(r.cum.high)}" y1="${y + 3}" x2="${px(r.cum.high)}" y2="${y + bh - 3}" stroke="${C.ink}" stroke-width="1.4"/>`);
    text(el, px(m.cum.mid) + 6, y + 12, `${pct1(r.cum.mid)}(${houses(r.cum.mid)})・複数破堤なら ${pct1(m.cum.mid)}`, { fs: 9.5, bold: true, color: C.deep });
  });
  // 凡例
  const ly = 44 + 5 * 34 + 6;
  el.push(`<rect x="${x0}" y="${ly}" width="22" height="10" fill="${C.mid}"/>`); text(el, x0 + 28, ly + 9, "中央の見積もり", { fs: 9 });
  el.push(`<line x1="${x0 + 130}" y1="${ly + 5}" x2="${x0 + 160}" y2="${ly + 5}" stroke="${C.ink}" stroke-width="1.4"/>`); text(el, x0 + 166, ly + 9, "幅(置いた仮定を弱め〜強めにした範囲)", { fs: 9 });
  el.push(`<rect x="${x0 + 380}" y="${ly}" width="22" height="10" fill="${C.pale}"/>`); text(el, x0 + 408, ly + 9, "複数破堤なら(上側の目安)", { fs: 9 });
  text(el, 20, ly + 30, "「複数破堤なら」= 計算では堤防は1つの洪水で1か所だけ切れると置いた。大洪水では2か所以上切れることがあり、それを許すとこの値まで上がる", { fs: 9, color: C.soft });
  // 内水の目安
  const ny = ly + 54;
  text(el, 20, ny, "参考 ── 内水(短時間の豪雨・下水があふれる)はこれとは別の確率:", { fs: 10, bold: true });
  naisui.forEach((n, i) => text(el, 40, ny + 16 + i * 14, `${n.rain}の雨(${n.period}) → ${n.depth} ／ 30年で約${n.cum30}`, { fs: 9.5 }));
  return svg(W, H, "30年累積の深さ別確率の横棒グラフ(中央・幅・複数破堤の場合)と内水の目安", el);
}

// ---- 図4: 家の断面と水位 ----
function figHouse(levels, duration) {
  const W = 760, H = 300, el = [];
  const gx = 120, gy = 250, scale = 24;        // 1m = 24px、地面 y=250
  const hx = gx + 60, hw = 170;
  // 地面
  el.push(`<line x1="40" y1="${gy}" x2="${W - 20}" y2="${gy}" stroke="${C.ink}" stroke-width="1.5"/>`);
  text(el, 42, gy + 14, "地面(標高2.5m)", { fs: 9, color: C.soft });
  // 家(木造3階: 各階3m)
  const floors = [["1階 玄関・車庫・納戸・浴室", 0], ["2階 LDK", 3], ["3階 寝室", 6]];
  floors.forEach(([name, h]) => {
    const y = gy - (h + 3) * scale;
    el.push(`<rect x="${hx}" y="${y}" width="${hw}" height="${3 * scale}" fill="#fff" stroke="${C.ink}" stroke-width="1.2"/>`);
    text(el, hx + hw / 2, y + 3 * scale / 2 + 4, name, { fs: 9.5, anchor: "middle" });
  });
  el.push(`<path d="M${hx - 10},${gy - 9 * scale} L${hx + hw / 2},${gy - 10.5 * scale} L${hx + hw + 10},${gy - 9 * scale} z" fill="#fff" stroke="${C.ink}" stroke-width="1.2"/>`);
  // 水位(右側に伸ばす)
  const wx = hx + hw + 30;
  levels.forEach((L, i) => {
    const y = gy - L.m * scale;
    el.push(`<rect x="${hx - 40}" y="${y}" width="${hw + 40 + 30}" height="${gy - y}" fill="${L.color}" opacity="0.18"/>`);
    el.push(`<line x1="${hx - 40}" y1="${y}" x2="${wx + 300}" y2="${y}" stroke="${L.color}" stroke-width="1.6" stroke-dasharray="${L.dash ?? ""}"/>`);
    text(el, wx + 6, y - 3, `${L.m}m ${L.label}${L.sub ? ` ── ${L.sub}` : ""}`, { fs: 9.5, bold: true, color: L.color });
  });
  text(el, 20, 20, "深さは何を意味するか ── 木造3階建(各階約3m)に重ねる", { fs: 11, bold: true });
  text(el, 20, H - 8, `荒川が切れた水は「${duration}」引かない(国の想定)。深さ1mでも3mでも、1〜2階の全損と長期の退去はほぼ同じ`, { fs: 9.5, color: C.stop, bold: true });
  return svg(W, H, "木造3階建の断面に、内水・計画規模・想定最大の水位を重ねた図", el);
}

export function renderFlood({ asOf, snapshot, property }) {
  const ff = property.hazard_check.flood_fermi;
  const g = snapshot.suibou_nav.groups;
  const l1 = groupStats(g.l1), l2 = groupStats(g.l2);
  const rows = exceedance(snapshot, { bands: ff.bands ?? DEFAULT_BANDS });
  const multi = exceedance(snapshot, { bands: ff.bands ?? DEFAULT_BANDS, multiBreach: true });
  const at = (d) => rows.find((r) => r.depth_m === d);
  const naisuiDepth = snapshot.tokyo_naisui.nearest.depth_m;
  const naisui = (ff.naisui?.rows ?? []).filter((r) => Number.isFinite(r.period_years) && !/ほぼ0/.test(r.depth)).map((r) => ({
    rain: r.rain.replace(/\(.*$/, ""), period: `${r.period_years.toLocaleString("ja-JP")}年に1回`, depth: r.depth.replace(/\*\*/g, "").replace(/\(.*$/, ""),
    cum30: `${Math.round((1 - (1 - 1 / r.period_years) ** 30) * 100)}%`,
  }));
  // 見出しの住所は番地まで(hazard_check.official.query の括弧の前=「東京都北区神谷2丁目24-11」)
  const address = String(property.hazard_check?.official?.query ?? property.location?.address ?? property.id).replace(/[(（].*$/, "");
  const levels = [
    { m: naisuiDepth, label: "内水の想定最大(都の図)", sub: "床上の縁。半日で引く", color: C.warn },
    { m: l1.median, label: "荒川・計画規模で届くときの中央値", sub: "1階が水没", color: C.mid, dash: "4 3" },
    { m: l2.median, label: "荒川・想定最大で届くときの中央値", sub: "2階の床上", color: C.deep, dash: "4 3" },
    { m: l2.max, label: "荒川・最も深い破堤点(右岸21km)", sub: "2階の天井近く。これが公式計算の最大", color: C.stop },
  ];
  const body = `
  <section class="panel">
    <h2>結論 ── ${esc(address)}</h2>
    <div class="logic-body">
      <p style="font-size:1rem;line-height:2"><b>30年住む間に、1m以上の水が来る確率は約${esc(pct1(at(1).cum.mid))}</b>(${esc(houses(at(1).cum.mid))})。
      <b>3m以上は約${esc(pct1(at(3).cum.mid))}</b>、<b>4m以上は約${esc(pct1(at(4).cum.mid))}</b>、<b>5mは公式の計算では出ない</b>。<br>
      ハザードマップの「3〜5m」は<b>最悪の絵</b>であって<b>起きやすさ</b>ではない——その違いを4枚の図で読む。</p>
      <div class="note">数値は<b>フェルミ推定=桁の目安</b>(公式の確率ではない)。根拠の全文・幅・前提は <a href="property/${esc(property.id)}.html">物件ページの「深さ別の確率」の表</a> に正本がある。2026-10-11に別コンテキストの検算を受けて改訂済み。</div>
    </div>
  </section>

  <section class="panel">
    <h2>図1 ── ${esc(pct1(at(1).cum.mid))}はこう出した(3つの掛け算)</h2>
    ${figFactors(rows, l2)}
    <div class="note">緑=公式データ、黄=公式の定義に帯を置いたもの、赤=置いた仮定。幅(弱め〜強め)が出るのは赤と黄のせいで、緑は動かない。</div>
  </section>

  <section class="panel">
    <h2>図2 ── 堤防のどこが切れると、ここに水が来るか</h2>
    ${figDots(g.l1, g.l2, l1, l2)}
    <div class="note">1つの丸が1つの破堤点(堤防が切れる場所の想定)。<b>ここに届くのは右岸(北区側)の一部だけ</b>で、深さは切れる場所で変わる。ハザードマップはこの中の最大値を塗る。</div>
  </section>

  <section class="panel">
    <h2>図3 ── 深さ別の30年確率</h2>
    ${figBars(rows, multi, naisui)}
    <div class="note">「1,000年に1回」は「30年で約3%」と同じ意味で、いつ来るかは分からない。気候変動で頻度が上がると ×1.3〜×2(1m以上で${esc(pct1(at(1).rampCum.mid))}〜${esc(pct1(at(1).climateCum.mid))})。</div>
  </section>

  <section class="panel">
    <h2>図4 ── その深さは何を意味するか</h2>
    ${figHouse(levels, "2週間以上")}
    <div class="note">決め手は確率の数字より、<b>起きたときに1〜2階の全損と長期の退去を保険(水災)と資金で受けられるか</b>、<b>3階へ逃げれば命が守れる設計か</b>(氾濫流=建物が流される区域の外・木造3階)。</div>
  </section>

  <section class="panel">
    <h2>よくある誤解 3つ</h2>
    <div class="logic-body" style="font-size:.9rem;line-height:1.9">
      <ol style="margin:0 0 0 1.2em">
        <li><b>「3〜5m」=そのくらい浸かりやすい</b> → 違う。最も深い破堤点を重ねた最悪の絵。確率は図3。</li>
        <li><b>「1,000年に1回」=自分の代では来ない</b> → 違う。30年で約3%・100軒に3軒。来るときは来る。</li>
        <li><b>この数字は公式の確率</b> → 違う。公式が出すのは「深さ」と「継続時間」だけ。確率は仮定を置いた桁の目安(<a href="map.html">ハザードマップ対照</a>・重要事項説明で公式値を確認)。</li>
      </ol>
    </div>
  </section>

  <section class="panel">
    <h2>出典・限界</h2>
    <div class="note" style="line-height:1.9">
      国交省 浸水ナビ(破堤点別の最大浸水深・${esc(snapshot.suibou_nav.fetched)}取得) / 東京都 隅田川及び新河岸川流域浸水予想区域図(内水 ${esc(naisuiDepth)}m) / 国土地理院 重ねるハザードマップ(継続時間)。
      堤防の弱点の偏り・632mmを超える雨・荒川第二・第三調節池(2030年頃)の効果は入っていない。計算は <code>engine/flood.js</code>、入力の正本は <code>market/flood-fermi-kamiya2-2026-10-11.json</code>。
      ${esc(asOf)}時点。判定はしない。
    </div>
  </section>`;
  return layout({ title: "水の確率 ── 深さ別の30年確率を図で読む", subtitle: `${address} の洪水リスクを、ハザードマップの「深さ」から「起きやすさ」に翻訳した共有用ページ`, docNo: "FLOOD", body });
}
