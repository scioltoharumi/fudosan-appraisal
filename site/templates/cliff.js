// site/templates/cliff.js — 「30年の崖」の検証ページ(cliff.html)
// formula.html 補論の結論(築31年からの崖)について、①データが何か ②ハザード該当地区の
// 成約が結論を歪めていないか ③条件がバラバラの成約をどう正規化したか、を
// 不動産初心者向けに一から図解する。2026-08-15ユーザー要望
// (「このデータをどうやって作り上げているか、全くわからない」)。
// 図中の数値はすべてビルド時にエンジン(ageRatioBuckets / ageCurveStats / ageCurveCI)から
// 再計算され、台帳と常に一致する。乱数は固定シードのため同じ台帳なら同じ数字が出る。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COEFFS, walkAdjOf, WALK_KNOTS } from "../../engine/appraise.js";
import { RETAIL, loadVerification } from "../../engine/retail.js";
import { ROOT } from "../../engine/io.js";
import { ageRatioBuckets, ageCurveStats, ageCurveCI, KOJI_PPT, RULE_LO, RULE_HI } from "./formula.js";
import { layout, esc } from "./layout.js";

// ---- 地区のハザード分類(market/area-scan.json = 丁目単位の機械判定の正本から導出) ----
// 境界は台帳の掲載条件「台地側」と同じ**「丁目のほぼ全域が荒川低地の深い浸水想定(exclude)か」**で引く。
// lowland  : 全丁目が exclude(丁目のほぼ全域が荒川低地の深い浸水想定)
// mixed    : exclude の丁目とそれ以外が同居(上中里=1丁目台地・2/3丁目低地、赤羽北)。
//            成約データの住所は地区までしか公開されないため、丁目単位で分けられない
// tableland: exclude の丁目なし。**caution(浅い浸水0.5〜3m・土砂イエロー)や edge(丁目の縁が
//            低地・レッドに掛かる)は含む** ── 台地上でも浅い着色は普通に出るため(area-scan.mjs)。
//            この含みはページ本文でも開示する(「全部外した」と読ませない)
export function hazardClassOf(areaScan) {
  const byTown = {};
  for (const r of areaScan.rows ?? []) (byTown[r.town] ??= []).push(r.verdict);
  const cls = {};
  for (const [town, verds] of Object.entries(byTown)) {
    const nEx = verds.filter((v) => v === "exclude").length;
    cls[town] = nEx === verds.length ? "lowland" : nEx > 0 ? "mixed" : "tableland";
  }
  return cls;
}
const CLS_LABEL = { tableland: "台地", lowland: "低地", mixed: "混在(丁目で台地/低地が分かれる)", unscanned: "未照合" };

const fmt = (n) => Math.round(n).toLocaleString("en-US");
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const wdenOf = (w) => clamp(1 + walkAdjOf(w), RETAIL.WALK_DENOM_CLAMP[0], RETAIL.WALK_DENOM_CLAMP[1]);
const qYear = (q) => +String(q).slice(0, 4) + (+String(q)[5] - 1) / 4;

// ---- 図1: データのファネル(767件 → 551件) ----
function funnelSvg(f) {
  const W = 640, rowH = 58, x0 = 208, barMax = 300, y0 = 26;
  const el = [];
  f.stages.forEach((s, i) => {
    const y = y0 + i * rowH;
    const w = (s.n / f.stages[0].n) * barMax;
    if (s.drop) {
      el.push(`<text x="${x0 + 10}" y="${y - 7}" font-size="8.5" fill="#C93A2B">↓ ${esc(s.drop)}</text>`);
    }
    el.push(`<text x="24" y="${y + 14}" font-size="9.5" font-weight="700" fill="#16232E">${esc(s.label)}</text>`);
    if (s.sub) el.push(`<text x="24" y="${y + 27}" font-size="8" fill="#8A97A5">${esc(s.sub)}</text>`);
    el.push(`<rect x="${x0}" y="${y}" width="${w.toFixed(1)}" height="24" fill="${i === f.stages.length - 1 ? "#2E6E8E" : "#BFD7E4"}"/>`);
    el.push(`<text x="${x0 + w + 8}" y="${y + 16}" font-size="10.5" font-weight="700" fill="${i === f.stages.length - 1 ? "#2E6E8E" : "#43566B"}" font-family="monospace">${s.n}件${s.tail ? " " + esc(s.tail) : ""}</text>`);
  });
  const H = y0 + f.stages.length * rowH + 4;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="データのファネル: ${f.stages[0].n}件から有効標本${f.stages[f.stages.length - 1].n}件まで" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 図2: ハザード地区を除いた再計算の比較(帯別中央値2本 + 崖の差の95%区間) ----
function hazardCompareSvg(v) {
  const W = 640, H = 296;
  const el = [];
  // 左: 帯別中央値の2本線
  const padL = 52, plotR = 396, axisY = 226, topY = 56;
  const bks = v.all.filter((b) => b.n > 0);
  const X = (i) => padL + ((i + 0.5) / bks.length) * (plotR - padL);
  const MIN = 0.42, MAX = 1.2;
  const Y = (r) => topY + (1 - (clamp(r, MIN, MAX) - MIN) / (MAX - MIN)) * (axisY - topY);
  const cliffIdx = bks.findIndex((b) => b.lo >= 31);
  if (cliffIdx > 0) {
    const zx = (X(cliffIdx - 1) + X(cliffIdx)) / 2;
    el.push(`<rect x="${zx}" y="${topY}" width="${plotR - zx}" height="${axisY - topY}" fill="#C93A2B" opacity="0.06"/>`);
    el.push(`<text x="${(zx + plotR) / 2}" y="${topY - 6}" font-size="8.5" font-weight="700" text-anchor="middle" fill="#C93A2B">崖</text>`);
  }
  el.push(`<text x="24" y="20" font-size="10" font-weight="700" fill="#16232E">築年帯ごとの中央値(実際÷ものさし)</text>`);
  el.push(`<text x="24" y="36" font-size="9" fill="#2E6E8E">● 全${v.districtsAll}地区(${v.totalAll}件)</text>`);
  el.push(`<text x="150" y="36" font-size="9" fill="#2C6E49">○ 台地側${v.districtsTab}地区のみ(${v.totalTab}件・低地/混在を除外)</text>`);
  for (const g of [0.6, 0.8, 1.2]) {
    el.push(`<line x1="${padL}" y1="${Y(g)}" x2="${plotR}" y2="${Y(g)}" stroke="#DCE3EA" stroke-width="1"/>`);
    el.push(`<text x="${padL - 5}" y="${Y(g) + 3}" font-size="8.5" text-anchor="end" fill="#43566B" font-family="monospace">${g.toFixed(1)}</text>`);
  }
  el.push(`<line x1="${padL}" y1="${Y(1)}" x2="${plotR}" y2="${Y(1)}" stroke="#16232E" stroke-width="1.1" stroke-dasharray="5,3"/>`);
  el.push(`<text x="${padL - 5}" y="${Y(1) + 3}" font-size="8.5" font-weight="700" text-anchor="end" fill="#16232E" font-family="monospace">1.0</text>`);
  el.push(`<line x1="${padL}" y1="${axisY}" x2="${plotR}" y2="${axisY}" stroke="#16232E" stroke-width="1"/>`);
  el.push(`<polyline points="${bks.map((b, i) => `${X(i).toFixed(1)},${Y(b.ratio).toFixed(1)}`).join(" ")}" fill="none" stroke="#2E6E8E" stroke-width="1.6"/>`);
  const tabByLo = new Map(v.tab.map((b) => [b.lo, b]));
  const tabPts = bks.map((b, i) => ({ i, t: tabByLo.get(b.lo) })).filter((p) => p.t && p.t.n > 0);
  el.push(`<polyline points="${tabPts.map((p) => `${X(p.i).toFixed(1)},${Y(p.t.ratio).toFixed(1)}`).join(" ")}" fill="none" stroke="#2C6E49" stroke-width="1.4" stroke-dasharray="5,3"/>`);
  bks.forEach((b, i) => {
    el.push(`<circle cx="${X(i)}" cy="${Y(b.ratio)}" r="3.5" fill="#2E6E8E"/>`);
    el.push(`<text x="${X(i)}" y="${axisY + 13}" font-size="8" text-anchor="middle" fill="#43566B">${b.lo}${b.hi === Infinity ? "〜" : "-" + b.hi}</text>`);
  });
  tabPts.forEach((p) => {
    el.push(`<circle cx="${X(p.i)}" cy="${Y(p.t.ratio)}" r="3.5" fill="#FFFFFF" stroke="#2C6E49" stroke-width="1.5"/>`);
  });
  el.push(`<text x="${(padL + plotR) / 2}" y="${axisY + 27}" font-size="8.5" text-anchor="middle" fill="#8A97A5">築年帯(年)</text>`);
  // 右: 崖の差の95%区間
  const gx0 = 452, gx1 = 632, gAxis = 226, gTop = 56;
  const GY = (d) => gAxis - (clamp(d, 0, 0.5) / 0.5) * (gAxis - gTop);
  el.push(`<text x="${gx0 - 12}" y="20" font-size="10" font-weight="700" fill="#16232E">崖の差(95%区間)</text>`);
  el.push(`<text x="${gx0 - 12}" y="36" font-size="8.5" fill="#8A97A5">築31年未満の中央値 − 31年以上の中央値</text>`);
  el.push(`<line x1="${gx0 - 6}" y1="${GY(0)}" x2="${gx1}" y2="${GY(0)}" stroke="#C93A2B" stroke-width="1.2" stroke-dasharray="4,2"/>`);
  el.push(`<text x="${gx1}" y="${GY(0) - 5}" font-size="8.5" text-anchor="end" fill="#C93A2B">0 = 崖が無い状態</text>`);
  for (const g of [0.1, 0.2, 0.3, 0.4]) {
    el.push(`<line x1="${gx0 - 6}" y1="${GY(g)}" x2="${gx1}" y2="${GY(g)}" stroke="#DCE3EA" stroke-width="1"/>`);
    el.push(`<text x="${gx0 - 10}" y="${GY(g) + 3}" font-size="8.5" text-anchor="end" fill="#43566B" font-family="monospace">${g.toFixed(1)}</text>`);
  }
  const whisk = (x, ci, color, label) => {
    el.push(`<line x1="${x}" y1="${GY(ci.lo)}" x2="${x}" y2="${GY(ci.hi)}" stroke="${color}" stroke-width="2"/>`);
    el.push(`<line x1="${x - 7}" y1="${GY(ci.lo)}" x2="${x + 7}" y2="${GY(ci.lo)}" stroke="${color}" stroke-width="2"/>`);
    el.push(`<line x1="${x - 7}" y1="${GY(ci.hi)}" x2="${x + 7}" y2="${GY(ci.hi)}" stroke="${color}" stroke-width="2"/>`);
    el.push(`<circle cx="${x}" cy="${GY(ci.mid)}" r="4.5" fill="${color}"/>`);
    el.push(`<text x="${x + 11}" y="${GY(ci.mid) + 3}" font-size="9.5" font-weight="700" fill="${color}" font-family="monospace">${ci.mid.toFixed(2)}</text>`);
    el.push(`<text x="${x}" y="${gAxis + 13}" font-size="8.5" text-anchor="middle" fill="#43566B">${label}</text>`);
  };
  whisk(gx0 + 40, v.diffAll, "#2E6E8E", `全${v.districtsAll}地区`);
  whisk(gx0 + 130, v.diffTab, "#2C6E49", "台地のみ");
  el.push(`<text x="24" y="${H - 10}" font-size="9" fill="#43566B">低地・混在の${v.nHazDist}地区(${v.nHazard}件=標本の${v.pctHazard}%)を丸ごと外しても、崖の差は ${v.diffAll.mid.toFixed(2)} → ${v.diffTab.mid.toFixed(2)} とほぼ動かない</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="ハザード地区を除いた再計算でも崖は不変" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 図3: ものさし価格の実例(実在の成約2件を式に通す) ----
function exampleSvg(v) {
  const W = 640, x0 = 24, x1 = 616, barH = 22;
  const maxV = Math.max(v.ex1.monosashi, v.ex2.monosashi, v.ex1.price, v.ex2.price) * 1.06;
  const PX = (m) => ((x1 - x0) * m) / maxV;
  const el = [];
  const group = (ex, y, priceColor, verdictColor) => {
    el.push(`<text x="${x0}" y="${y}" font-size="10" font-weight="700" fill="#16232E">${esc(ex.title)}</text>`);
    // ものさし合計はバー右横だと建物ラベルと重なるため、タイトル行の右端に置く(機械検査で判明)。
    // 表示は「丸めた部品の和」(monosashiDisp)にする ── 部品と合計を別々に丸めると1万円ずれて見える
    el.push(`<text x="${x1}" y="${y}" font-size="10" font-weight="700" text-anchor="end" fill="#16232E" font-family="monospace">ものさし ${fmt(ex.monosashiDisp)}万</text>`);
    const by = y + 10;
    const lw = PX(ex.landPart), bw = PX(ex.bldgPart);
    el.push(`<rect x="${x0}" y="${by}" width="${lw.toFixed(1)}" height="${barH}" fill="#2E6E8E"/>`);
    el.push(`<text x="${x0 + lw / 2}" y="${by + 15}" font-size="9.5" font-weight="700" text-anchor="middle" fill="#FFFFFF">土地 ${fmt(ex.landPart)}万</text>`);
    if (bw > 4) {
      el.push(`<rect x="${x0 + lw}" y="${by}" width="${bw.toFixed(1)}" height="${barH}" fill="#B07C10"/>`);
      const inBar = bw > 92;
      el.push(`<text x="${inBar ? x0 + lw + bw / 2 : x0 + lw + bw + 6}" y="${by + 15}" font-size="9.5" font-weight="700" text-anchor="${inBar ? "middle" : "start"}" fill="${inBar ? "#FFFFFF" : "#B07C10"}">建物 ${fmt(ex.bldgPart)}万</text>`);
    } else {
      // 建物ゼロ: ものさしバーがほぼ全幅に達するため、右横に置くとはみ出す(機械検査で判明)。
      // バーの内側右端(白)へ退避し、収まる場合のみ従来どおり右横に置く
      const inside = lw > (x1 - x0) - 122;
      el.push(`<text x="${inside ? x0 + lw - 8 : x0 + lw + 6}" y="${by + 15}" font-size="9.5" font-weight="700" text-anchor="${inside ? "end" : "start"}" fill="${inside ? "#FFFFFF" : "#B07C10"}">建物 0万(残価ゼロ)</text>`);
    }
    const py = by + barH + 8;
    el.push(`<rect x="${x0}" y="${py}" width="${PX(ex.price).toFixed(1)}" height="${barH}" fill="none" stroke="${priceColor}" stroke-width="2"/>`);
    el.push(`<text x="${x0 + 8}" y="${py + 15}" font-size="9.5" font-weight="700" fill="${priceColor}">実際の成約 ${fmt(ex.price)}万</text>`);
    el.push(`<text x="${x0 + PX(ex.price) + 8}" y="${py + 15}" font-size="10.5" font-weight="700" fill="${verdictColor}" font-family="monospace">比率 ${ex.ratio.toFixed(2)}</text>`);
    el.push(`<text x="${x0}" y="${py + barH + 16}" font-size="8.5" fill="#43566B">${esc(ex.note)}</text>`);
  };
  group(v.ex1, 22, "#16232E", "#2C6E49");
  group(v.ex2, 130, "#C93A2B", "#C93A2B");
  return `<svg viewBox="0 0 ${W} 238" role="img" aria-label="ものさし価格の実例2件" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 図4: 散布図(有効標本の全点 + 帯中央値) ----
function scatterSvg(v) {
  const W = 640, H = 330, padL = 50, padR = 14, axisY = 268, topY = 48;
  const XMAX = 75, YMIN = 0.2, YMAX = 1.6;
  const X = (a) => padL + (Math.min(a, XMAX) / XMAX) * (W - padL - padR);
  const Y = (r) => topY + (1 - (clamp(r, YMIN, YMAX) - YMIN) / (YMAX - YMIN)) * (axisY - topY);
  const el = [];
  el.push(`<rect x="${X(31)}" y="${topY}" width="${W - padR - X(31)}" height="${axisY - topY}" fill="#C93A2B" opacity="0.05"/>`);
  el.push(`<text x="${(X(31) + W - padR) / 2}" y="${topY - 6}" font-size="9" font-weight="700" text-anchor="middle" fill="#C93A2B">築31年〜(崖)</text>`);
  el.push(`<text x="24" y="16" font-size="9" fill="#2E6E8E">● 台地側の地区の成約</text>`);
  el.push(`<text x="160" y="16" font-size="9" fill="#8A97A5">● 低地・混在の地区の成約</text>`);
  el.push(`<text x="310" y="16" font-size="9" fill="#16232E">━ 築年帯の中央値(赤=崖の帯)</text>`);
  el.push(`<text x="24" y="32" font-size="8.5" fill="#8A97A5">縦軸=実際の成約価格÷ものさし価格(枠外の${v.nClip}件は縁に▲で表示)</text>`);
  for (let g = 0.2; g <= 1.61; g += 0.2) {
    el.push(`<line x1="${padL}" y1="${Y(g)}" x2="${W - padR}" y2="${Y(g)}" stroke="#DCE3EA" stroke-width="1"/>`);
    el.push(`<text x="${padL - 5}" y="${Y(g) + 3}" font-size="8.5" text-anchor="end" fill="#43566B" font-family="monospace">${g.toFixed(1)}</text>`);
  }
  el.push(`<line x1="${padL}" y1="${Y(1)}" x2="${W - padR}" y2="${Y(1)}" stroke="#16232E" stroke-width="1.2" stroke-dasharray="5,3"/>`);
  el.push(`<line x1="${padL}" y1="${axisY}" x2="${W - padR}" y2="${axisY}" stroke="#16232E" stroke-width="1"/>`);
  for (let a = 0; a <= 70; a += 10) {
    el.push(`<line x1="${X(a)}" y1="${axisY}" x2="${X(a)}" y2="${axisY + 4}" stroke="#43566B" stroke-width="1"/>`);
    el.push(`<text x="${X(a)}" y="${axisY + 15}" font-size="8.5" text-anchor="middle" fill="#43566B" font-family="monospace">${a === 0 ? "新築" : "築" + a}</text>`);
  }
  for (const s of v.pts) {
    const color = s.hazard ? "#98A5B3" : "#2E6E8E";
    if (s.ratio > YMAX) {
      el.push(`<polygon points="${X(s.age) - 3},${topY + 8} ${X(s.age) + 3},${topY + 8} ${X(s.age)},${topY + 2}" fill="${color}" opacity="0.75"/>`);
    } else if (s.ratio < YMIN) {
      el.push(`<polygon points="${X(s.age) - 3},${axisY - 8} ${X(s.age) + 3},${axisY - 8} ${X(s.age)},${axisY - 2}" fill="${color}" opacity="0.75"/>`);
    } else {
      el.push(`<circle cx="${X(s.age).toFixed(1)}" cy="${Y(s.ratio).toFixed(1)}" r="2.1" fill="${color}" opacity="0.5"/>`);
    }
  }
  // 帯中央値: 帯の幅いっぱいの水平線分
  for (const b of v.buckets) {
    if (!b.n) continue;
    const xA = X(b.lo), xB = X(b.hi === Infinity ? XMAX : b.hi);
    const color = b.lo >= 31 ? "#C93A2B" : "#16232E";
    el.push(`<line x1="${xA}" y1="${Y(b.ratio)}" x2="${xB}" y2="${Y(b.ratio)}" stroke="${color}" stroke-width="3"/>`);
    if (b.labelled) {
      el.push(`<text x="${(xA + xB) / 2}" y="${Y(b.ratio) - 7}" font-size="9.5" font-weight="700" text-anchor="middle" fill="${color}" font-family="monospace">${b.ratio.toFixed(2)}</text>`);
    }
  }
  el.push(`<text x="24" y="${H - 8}" font-size="9" fill="#43566B">1点=成約1件。個別の道路・形状・改装歴は観測できないため点は大きく散らばるが、帯の中央値(━)は築30年まで1.0近辺に並び、築31年から沈む</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="有効標本${v.pts.length}件の散布図と帯中央値" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 図5: 帯別の95%信頼区間(エラーバー) ----
function ciBarsSvg(v) {
  const W = 640, H = 282, padL = 52, padR = 16, axisY = 208, topY = 44;
  const rows = v.rows;
  const X = (i) => padL + ((i + 0.5) / rows.length) * (W - padL - padR);
  const MIN = 0.42, MAX = 1.56;
  const Y = (r) => topY + (1 - (clamp(r, MIN, MAX) - MIN) / (MAX - MIN)) * (axisY - topY);
  const el = [];
  const iFrom = rows.findIndex((b) => b.lo === 7), iTo = rows.findIndex((b) => b.lo === 26);
  if (iFrom >= 0 && iTo >= 0) {
    const bx0 = X(iFrom) - 18, bx1 = X(iTo) + 18;
    el.push(`<path d="M ${bx0} 30 L ${bx0} 24 L ${bx1} 24 L ${bx1} 30" fill="none" stroke="#8A97A5" stroke-width="1.2"/>`);
    el.push(`<text x="${(bx0 + bx1) / 2}" y="18" font-size="8.5" text-anchor="middle" fill="#8A97A5">この5帯は区間が1.00を含む=ものさしと区別できない(築26-31は幅が広すぎ実質情報なし)</text>`);
  }
  for (const g of [0.6, 0.8, 1.2, 1.4]) {
    el.push(`<line x1="${padL}" y1="${Y(g)}" x2="${W - padR}" y2="${Y(g)}" stroke="#DCE3EA" stroke-width="1"/>`);
    el.push(`<text x="${padL - 5}" y="${Y(g) + 3}" font-size="8.5" text-anchor="end" fill="#43566B" font-family="monospace">${g.toFixed(1)}</text>`);
  }
  el.push(`<line x1="${padL}" y1="${Y(1)}" x2="${W - padR}" y2="${Y(1)}" stroke="#16232E" stroke-width="1.2" stroke-dasharray="5,3"/>`);
  el.push(`<text x="${padL - 5}" y="${Y(1) + 3}" font-size="8.5" font-weight="700" text-anchor="end" fill="#16232E" font-family="monospace">1.0</text>`);
  el.push(`<line x1="${padL}" y1="${axisY}" x2="${W - padR}" y2="${axisY}" stroke="#16232E" stroke-width="1"/>`);
  rows.forEach((b, i) => {
    const x = X(i);
    const decided = b.hi95 < 1 || b.lo95 > 1;
    const color = b.lo >= 31 ? "#C93A2B" : decided ? "#B07C10" : "#8A97A5";
    el.push(`<line x1="${x}" y1="${Y(b.lo95)}" x2="${x}" y2="${Y(b.hi95)}" stroke="${color}" stroke-width="2"/>`);
    el.push(`<line x1="${x - 6}" y1="${Y(b.lo95)}" x2="${x + 6}" y2="${Y(b.lo95)}" stroke="${color}" stroke-width="2"/>`);
    el.push(`<line x1="${x - 6}" y1="${Y(b.hi95)}" x2="${x + 6}" y2="${Y(b.hi95)}" stroke="${color}" stroke-width="2"/>`);
    el.push(`<circle cx="${x}" cy="${Y(b.m)}" r="4" fill="${color}"/>`);
    el.push(`<text x="${x}" y="${axisY + 13}" font-size="8" text-anchor="middle" fill="#43566B">${b.lo}${b.hi === Infinity ? "〜" : "-" + b.hi}</text>`);
    el.push(`<text x="${x}" y="${axisY + 26}" font-size="8" text-anchor="middle" fill="#8A97A5" font-family="monospace">n=${b.n}</text>`);
  });
  el.push(`<text x="24" y="${H - 38}" font-size="9" fill="#43566B">縦棒=95%信頼区間(その帯の中央値が偶然でブレうる幅)。<tspan fill="#C93A2B" font-weight="700">赤</tspan>=区間ごと1.00の下に沈む(崖)、<tspan fill="#B07C10" font-weight="700">琥珀</tspan>=1.00未満だが崖ではない帯、灰=判別不能</text>`);
  el.push(`<text x="24" y="${H - 24}" font-size="9" fill="#43566B">築0-3年の区間上限${v.newHi.toFixed(2)}&lt;1.00 →「新築プレミアムの山」は無い。築31年以上の2帯は区間の上限でも${v.cliffTopHi.toFixed(2)}止まり → 崖は偶然では出ない</text>`);
  el.push(`<text x="24" y="${H - 10}" font-size="9" fill="#43566B">築3-7年(琥珀)も1.00を下回るが、標本${v.n37}件と薄くエリア拡張と同時に現れたため<tspan font-weight="700">判断の根拠にしない</tspan>(STEP 6の留保)</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="築年帯別の95%信頼区間" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 図6: 崖の差のブートストラップ分布(4,000回の引き直しのヒストグラム) ----
function diffHistSvg(v) {
  const W = 640, H = 216, padL = 44, padR = 16, axisY = 168, topY = 40;
  const XMAX = Math.max(0.48, v.max * 1.08);
  const X = (d) => padL + (d / XMAX) * (W - padL - padR);
  const el = [];
  const binW = 0.005;
  const bins = new Map();
  for (const d of v.diffs) {
    const k = Math.floor(d / binW);
    bins.set(k, (bins.get(k) ?? 0) + 1);
  }
  const peak = Math.max(...bins.values());
  const Yh = (c) => (c / peak) * (axisY - topY);
  for (const [k, c] of bins) {
    const x = X(k * binW), w = X((k + 1) * binW) - x;
    el.push(`<rect x="${x.toFixed(1)}" y="${(axisY - Yh(c)).toFixed(1)}" width="${Math.max(1, w - 0.6).toFixed(1)}" height="${Yh(c).toFixed(1)}" fill="#2E6E8E" opacity="0.8"/>`);
  }
  el.push(`<line x1="${padL}" y1="${axisY}" x2="${W - padR}" y2="${axisY}" stroke="#16232E" stroke-width="1"/>`);
  for (const g of [0, 0.1, 0.2, 0.3, 0.4]) {
    el.push(`<line x1="${X(g)}" y1="${axisY}" x2="${X(g)}" y2="${axisY + 4}" stroke="#43566B" stroke-width="1"/>`);
    el.push(`<text x="${X(g)}" y="${axisY + 15}" font-size="8.5" text-anchor="middle" fill="#43566B" font-family="monospace">${g.toFixed(1)}</text>`);
  }
  el.push(`<line x1="${X(0)}" y1="${topY - 14}" x2="${X(0)}" y2="${axisY}" stroke="#C93A2B" stroke-width="1.6"/>`);
  el.push(`<text x="${X(0) + 6}" y="${topY - 4}" font-size="9.5" font-weight="700" fill="#C93A2B">0 =「崖は無い」── ${v.nZero === 0 ? `4,000回中0回。最小でも${v.min.toFixed(2)}` : `0以下は4,000回中${v.nZero}回`}</text>`);
  el.push(`<line x1="${X(v.lo)}" y1="${topY + 6}" x2="${X(v.lo)}" y2="${axisY}" stroke="#16232E" stroke-width="1" stroke-dasharray="3,2"/>`);
  el.push(`<line x1="${X(v.hi)}" y1="${topY + 6}" x2="${X(v.hi)}" y2="${axisY}" stroke="#16232E" stroke-width="1" stroke-dasharray="3,2"/>`);
  el.push(`<text x="${(X(v.lo) + X(v.hi)) / 2}" y="${topY + 1}" font-size="8.5" text-anchor="middle" fill="#16232E">95%区間 ${v.lo.toFixed(2)}〜${v.hi.toFixed(2)}</text>`);
  el.push(`<text x="24" y="16" font-size="10" font-weight="700" fill="#16232E">崖の差の引き直し4,000回の分布${v.nZero === 0 ? " ── 「差が0(崖なし)」は一度も出ない" : ""}</text>`);
  el.push(`<text x="24" y="${H - 10}" font-size="9" fill="#43566B">横軸: 引き直した標本での「築31年未満の中央値 − 31年以上の中央値」。${v.nZero === 0 ? `データの偶然のブレを4,000回シミュレートしても、崖は常に${v.min.toFixed(2)}以上残る` : `4,000回中${v.nZero}回で差が0以下になった`}</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="崖の差のブートストラップ分布" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 図8(よくある疑問A-1): 引き算する建物分は成約価格の何割か ----
function faqShareSvg(rows) {
  const W = 640, x0 = 170, barW = 290, barH = 22;   // barWは右横の注記(最長142px)が枠に収まる幅にする
  const el = [];
  el.push(`<text x="24" y="16" font-size="10" font-weight="700" fill="#16232E">ものさしが「建物分」として引き算する割合(成約価格に対する中央値・実測)</text>`);
  rows.forEach((r, i) => {
    const y = 30 + i * 40;
    const bw = barW * r.share;
    el.push(`<text x="${x0 - 10}" y="${y + 15}" font-size="9.5" font-weight="700" text-anchor="end" fill="#16232E">${esc(r.label)}</text>`);
    el.push(`<rect x="${x0}" y="${y}" width="${(barW - bw).toFixed(1)}" height="${barH}" fill="#2E6E8E"/>`);
    el.push(`<text x="${x0 + (barW - bw) / 2}" y="${y + 15}" font-size="9" font-weight="700" text-anchor="middle" fill="#FFFFFF">土地 ${(100 - r.share * 100).toFixed(0)}%</text>`);
    if (bw > 2) {
      el.push(`<rect x="${x0 + barW - bw}" y="${y}" width="${bw.toFixed(1)}" height="${barH}" fill="#B07C10"/>`);
      el.push(`<text x="${x0 + barW + 8}" y="${y + 15}" font-size="9.5" font-weight="700" fill="#B07C10">建物 ${(r.share * 100).toFixed(0)}%${esc(r.note ?? "")}</text>`);
    } else {
      el.push(`<text x="${x0 + barW + 8}" y="${y + 15}" font-size="9.5" font-weight="700" fill="#B07C10">建物 0%${esc(r.note ?? "")}</text>`);
    }
    el.push(`<text x="${x0 - 10}" y="${y + 28}" font-size="8" text-anchor="end" fill="#8A97A5" font-family="monospace">n=${r.n}</text>`);
  });
  const H = 30 + rows.length * 40 + 8;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="築年帯別の建物控除シェア" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 図9(よくある疑問A-2): 基準帯の選び方の検算 ── 出てくる土地相場は公示と整合するか ----
function faqBaseGaugeSvg(g) {
  const W = 640, axisY = 104, MIN = 80, MAX = 320;
  const X = (v) => 24 + ((v - MIN) / (MAX - MIN)) * 592;
  const el = [];
  for (let m = 100; m <= 300; m += 50) {
    el.push(`<line x1="${X(m)}" y1="${axisY}" x2="${X(m)}" y2="${axisY + 5}" stroke="#43566B" stroke-width="1"/>`);
    el.push(`<text x="${X(m)}" y="${axisY + 17}" font-size="9" text-anchor="middle" fill="#43566B" font-family="monospace">${m}万</text>`);
  }
  el.push(`<line x1="24" y1="${axisY}" x2="616" y2="${axisY}" stroke="#16232E" stroke-width="1"/>`);
  // 実勢の目安帯(公示×1.1〜1.2)
  const bx0 = X(g.koji * RULE_LO), bx1 = X(g.koji * RULE_HI);
  el.push(`<rect x="${bx0}" y="${axisY - 34}" width="${bx1 - bx0}" height="34" fill="#BFD7E4" opacity="0.75"/>`);
  el.push(`<text x="${(bx0 + bx1) / 2}" y="${axisY - 40}" font-size="9.5" text-anchor="middle" fill="#2E6E8E">実勢の目安 = 公示×1.1〜1.2</text>`);
  // 公示地価
  el.push(`<circle cx="${X(g.koji)}" cy="${axisY}" r="4" fill="#16232E"/>`);
  el.push(`<line x1="${X(g.koji)}" y1="${50}" x2="${X(g.koji)}" y2="${axisY}" stroke="#16232E" stroke-width="1" stroke-dasharray="2,2"/>`);
  el.push(`<text x="${X(g.koji)}" y="${46}" font-size="9.5" font-weight="700" text-anchor="middle" fill="#16232E">公示地価 ${g.koji}万</text>`);
  // 崖の帯から作った場合(✗)
  el.push(`<circle cx="${X(g.baseAlt)}" cy="${axisY}" r="4.5" fill="#C93A2B"/>`);
  el.push(`<line x1="${X(g.baseAlt)}" y1="${50}" x2="${X(g.baseAlt)}" y2="${axisY}" stroke="#C93A2B" stroke-width="1" stroke-dasharray="2,2"/>`);
  el.push(`<text x="${X(g.baseAlt)}" y="${32}" font-size="9.5" font-weight="700" text-anchor="middle" fill="#C93A2B">築31年〜(崖の帯)から作ると ${Math.round(g.baseAlt)}万</text>`);
  el.push(`<text x="${X(g.baseAlt)}" y="${46}" font-size="8.5" text-anchor="middle" fill="#C93A2B">✗ 崖の値引きが混入した「安すぎる土地相場」</text>`);
  // 現行基準(✓)
  el.push(`<circle cx="${X(g.baseNow)}" cy="${axisY}" r="4.5" fill="#2C6E49"/>`);
  el.push(`<line x1="${X(g.baseNow)}" y1="${axisY}" x2="${X(g.baseNow)}" y2="${axisY + 28}" stroke="#2C6E49" stroke-width="1" stroke-dasharray="2,2"/>`);
  el.push(`<text x="${X(g.baseNow)}" y="${axisY + 40}" font-size="9.5" font-weight="700" text-anchor="middle" fill="#2C6E49">築11〜25年から作った基準 ${Math.round(g.baseNow)}万</text>`);
  el.push(`<text x="${X(g.baseNow)}" y="${axisY + 54}" font-size="8.5" text-anchor="middle" fill="#2C6E49">✓ 公示からの目安とほぼ整合(独立の物差しで検算できている)</text>`);
  return `<svg viewBox="0 0 ${W} 168" role="img" aria-label="基準帯の選び方の検算(赤羽西の例)" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 図10(よくある疑問B): 売出価格と成約価格 ── このページが使うのはどちらか ----
function faqAskSvg() {
  const W = 640, x0 = 130, full = 470, barH = 24;
  const dealW = full * 0.86, expW = full * 0.14;
  const el = [];
  const y1 = 26, y2 = 96;
  el.push(`<text x="${x0 - 10}" y="${y1 + 16}" font-size="9.5" font-weight="700" text-anchor="end" fill="#16232E">売出価格</text>`);
  el.push(`<rect x="${x0}" y="${y1}" width="${dealW}" height="${barH}" fill="#BFD7E4"/>`);
  el.push(`<text x="${x0 + dealW / 2}" y="${y1 + 16}" font-size="9.5" text-anchor="middle" fill="#16232E">成約価格の見込み</text>`);
  el.push(`<rect x="${x0 + dealW}" y="${y1}" width="${expW}" height="${barH}" fill="rgba(201,58,43,.13)" stroke="#C93A2B" stroke-width="1.4" stroke-dasharray="5,3"/>`);
  el.push(`<text x="${x0 + dealW + expW / 2}" y="${y1 + 16}" font-size="9" font-weight="700" text-anchor="middle" fill="#C93A2B">売主の期待</text>`);
  el.push(`<text x="${x0}" y="${y1 - 8}" font-size="8.5" fill="#8A97A5">SUUMO等の広告に出る数字(売主の希望)</text>`);
  // 削られる矢印
  const ax = x0 + dealW + expW / 2;
  el.push(`<line x1="${ax}" y1="${y1 + barH + 4}" x2="${ax}" y2="${y2 - 12}" stroke="#C93A2B" stroke-width="1.4"/>`);
  el.push(`<polygon points="${ax - 4},${y2 - 14} ${ax + 4},${y2 - 14} ${ax},${y2 - 6}" fill="#C93A2B"/>`);
  el.push(`<text x="${ax - 8}" y="${(y1 + barH + y2) / 2 + 2}" font-size="8.5" text-anchor="end" fill="#C93A2B">値引き・指値交渉で削られて消える</text>`);
  el.push(`<text x="${x0 - 10}" y="${y2 + 16}" font-size="9.5" font-weight="700" text-anchor="end" fill="#16232E">成約価格</text>`);
  el.push(`<rect x="${x0}" y="${y2}" width="${dealW}" height="${barH}" fill="#2E6E8E"/>`);
  el.push(`<text x="${x0 + dealW / 2}" y="${y2 + 16}" font-size="9.5" font-weight="700" text-anchor="middle" fill="#FFFFFF">実際に売買が成立した価格</text>`);
  el.push(`<text x="${x0}" y="${y2 + barH + 16}" font-size="8.5" fill="#2E6E8E" font-weight="700">国の成約記録に残る数字 ── このページが使うのは(ものさしも比率の分子も)全部こちら</text>`);
  return `<svg viewBox="0 0 ${W} 150" role="img" aria-label="売出価格と成約価格の関係" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 図11(よくある疑問C): 再調達単価±20%の感度 ── 崖の差はどの仮定でも0に届かない ----
function faqSensSvg(rows) {
  const W = 640, axisY = 190, topY = 40, gx = [180, 330, 480];
  const GY = (d) => axisY - (clamp(d, 0, 0.5) / 0.5) * (axisY - topY);
  const el = [];
  el.push(`<text x="24" y="16" font-size="10" font-weight="700" fill="#16232E">再調達単価を±20%動かして全部再計算した「崖の差」(95%区間)</text>`);
  for (const g of [0.1, 0.2, 0.3, 0.4]) {
    el.push(`<line x1="120" y1="${GY(g)}" x2="560" y2="${GY(g)}" stroke="#DCE3EA" stroke-width="1"/>`);
    el.push(`<text x="112" y="${GY(g) + 3}" font-size="8.5" text-anchor="end" fill="#43566B" font-family="monospace">${g.toFixed(1)}</text>`);
  }
  el.push(`<line x1="120" y1="${GY(0)}" x2="560" y2="${GY(0)}" stroke="#C93A2B" stroke-width="1.2" stroke-dasharray="4,2"/>`);
  el.push(`<text x="560" y="${GY(0) - 5}" font-size="8.5" text-anchor="end" fill="#C93A2B">0 = 崖が無い状態 ── どの仮定でも届かない</text>`);
  rows.forEach((r, i) => {
    const x = gx[i], color = i === 1 ? "#2E6E8E" : "#43566B";
    el.push(`<line x1="${x}" y1="${GY(r.lo)}" x2="${x}" y2="${GY(r.hi)}" stroke="${color}" stroke-width="2"/>`);
    el.push(`<line x1="${x - 7}" y1="${GY(r.lo)}" x2="${x + 7}" y2="${GY(r.lo)}" stroke="${color}" stroke-width="2"/>`);
    el.push(`<line x1="${x - 7}" y1="${GY(r.hi)}" x2="${x + 7}" y2="${GY(r.hi)}" stroke="${color}" stroke-width="2"/>`);
    el.push(`<circle cx="${x}" cy="${GY(r.mid)}" r="4.5" fill="${color}"/>`);
    el.push(`<text x="${x + 11}" y="${GY(r.mid) + 3}" font-size="9.5" font-weight="700" fill="${color}" font-family="monospace">${r.mid.toFixed(2)}</text>`);
    el.push(`<text x="${x}" y="${axisY + 14}" font-size="9" ${i === 1 ? 'font-weight="700"' : ""} text-anchor="middle" fill="${color}">${esc(r.label)}</text>`);
    el.push(`<text x="${x}" y="${axisY + 27}" font-size="8" text-anchor="middle" fill="#8A97A5" font-family="monospace">${esc(r.sub)}</text>`);
  });
  return `<svg viewBox="0 0 ${W} 226" role="img" aria-label="再調達単価±20%でも崖の差は0を跨がない" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 図7: 出口の築年タイムライン(15年住んだら、売るとき築何年か) ----
function exitTimelineSvg() {
  const W = 640, x0 = 168, x1 = 616, axisY = 252, topY = 34;
  const AMAX = 46;
  const X = (a) => x0 + (a / AMAX) * (x1 - x0);
  const el = [];
  el.push(`<rect x="${X(31)}" y="${topY}" width="${x1 - X(31)}" height="${axisY - topY}" fill="#C93A2B" opacity="0.07"/>`);
  el.push(`<text x="${(X(31) + x1) / 2}" y="${topY - 8}" font-size="9" font-weight="700" text-anchor="middle" fill="#C93A2B">崖(築31年〜): 土地値まで2〜4割引の世界</text>`);
  el.push(`<line x1="${X(31)}" y1="${topY}" x2="${X(31)}" y2="${axisY}" stroke="#C93A2B" stroke-width="1.2" stroke-dasharray="4,2"/>`);
  const rows = [
    { entry: 0, label: "新築で買う", verdict: "出口は築15年 ── 崖の遥か手前。売り時を選べる", color: "#2C6E49" },
    { entry: 10, label: "築10年で買う", verdict: "出口は築25年 ── 崖の手前(開始が早ければ余裕は縮む)", color: "#2C6E49" },
    { entry: 16, label: "築16年で買う", verdict: "出口は築31年 ── ちょうど崖に着地(最も損な帯)", color: "#C93A2B" },
    { entry: 25, label: "築25年で買う(土地値)", verdict: "出口は築40年 ── 失う建物代が最初から無い", color: "#2E6E8E" },
  ];
  rows.forEach((r, i) => {
    const y = topY + 14 + i * 52;
    el.push(`<text x="24" y="${y + 11}" font-size="9.5" font-weight="700" fill="#16232E">${esc(r.label)}</text>`);
    el.push(`<rect x="${X(r.entry)}" y="${y}" width="${X(r.entry + 15) - X(r.entry)}" height="15" fill="${r.color}" opacity="0.28"/>`);
    el.push(`<circle cx="${X(r.entry)}" cy="${y + 7.5}" r="3.5" fill="${r.color}"/>`);
    el.push(`<polygon points="${X(r.entry + 15) - 1},${y + 1} ${X(r.entry + 15) + 7},${y + 7.5} ${X(r.entry + 15) - 1},${y + 14}" fill="${r.color}"/>`);
    el.push(`<text x="${X(r.entry)}" y="${y + 29}" font-size="8.5" fill="${r.color}">${esc(r.verdict)}</text>`);
  });
  el.push(`<line x1="${x0}" y1="${axisY}" x2="${x1}" y2="${axisY}" stroke="#16232E" stroke-width="1"/>`);
  for (let a = 0; a <= 45; a += 5) {
    el.push(`<line x1="${X(a)}" y1="${axisY}" x2="${X(a)}" y2="${axisY + 4}" stroke="#43566B" stroke-width="1"/>`);
    el.push(`<text x="${X(a)}" y="${axisY + 15}" font-size="8.5" text-anchor="middle" fill="#43566B" font-family="monospace">${a}</text>`);
  }
  el.push(`<text x="${(x0 + x1) / 2}" y="${axisY + 29}" font-size="8.5" text-anchor="middle" fill="#8A97A5">売るときの築年数(●=購入 ▶=15年後に売却)</text>`);
  return `<svg viewBox="0 0 ${W} 290" role="img" aria-label="15年保有の出口築年と崖の位置関係" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 本体 ----
export function renderCliff({ houseDeals, areaScan, asOf }) {
  const cls = hazardClassOf(areaScan);
  // area-scan に無い地区は「未照合」とし、台地側には**入れない**(感度検算の保守側)。
  // tests/agecurve.test.js の台地のみ回帰も同じ向き(=== "tableland")で固定してある
  const hazardOf = (dist) => cls[dist] ?? "unscanned";

  // 基本統計(formula.htmlの補論と同じ関数・同じ値)
  const arb = ageRatioBuckets(houseDeals);
  if (!arb.samples.length) throw new Error("築年カーブの有効標本が0件 ── cliff.html を生成できません");
  const ac = ageCurveStats(houseDeals);
  const ci = ageCurveCI(houseDeals);

  // ハザード感度: 台地のみ(excludeの丁目を1つでも含む地区を除外)と、明確な低地のみ除外の2段階
  const tabDeals = houseDeals.filter((d) => hazardOf(d.district) === "tableland");
  const acTab = ageCurveStats(tabDeals);
  const ciTab = ageCurveCI(tabDeals);
  const mildDeals = houseDeals.filter((d) => hazardOf(d.district) !== "lowland");
  const ciMild = ageCurveCI(mildDeals);

  // ファネルの内訳。rangeDropN は「conflict以外の検収落ち」の残差なので、
  // verification.json が古い(conflict行がCSVに無い)場合に負へ振れないようクランプする
  const csvLines = readFileSync(join(ROOT, "market", "house-deals.csv"), "utf8")
    .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const rawN = csvLines.length - 1;
  const conflictN = (loadVerification()?.rows ?? []).filter((r) => r.status === "conflict").length;
  const rangeDropN = Math.max(0, rawN - houseDeals.length - conflictN);
  const quarters = houseDeals.map((d) => d.quarter).sort();
  const qMin = quarters[0], qMax = quarters[quarters.length - 1];

  // 地区の内訳表
  const inSample = [...new Set(arb.samples.map((s) => s.district))];
  const distRows = inSample.map((dist) => {
    const ss = arb.samples.filter((s) => s.district === dist);
    return {
      dist, cls: hazardOf(dist), unit: arb.base[dist],
      matureN: ss.filter((s) => s.age >= 11 && s.age < 26).length,
      n: ss.length, oldN: ss.filter((s) => s.age >= 31).length,
    };
  }).sort((a, b) => b.n - a.n);
  const nHazard = distRows.filter((r) => r.cls !== "tableland").reduce((a, r) => a + r.n, 0);
  const lowNames = distRows.filter((r) => r.cls === "lowland").map((r) => r.dist);
  const mixNames = distRows.filter((r) => r.cls === "mixed").map((r) => r.dist);
  const nHazDist = distRows.filter((r) => r.cls !== "tableland").length;
  const droppedDistricts = [...new Set(houseDeals.map((d) => d.district))].filter((d) => !inSample.includes(d));
  // ブートストラップの説明・図に使う件数(崖の差は2つの袋を別々に引き直す=層別)
  const youngN = arb.samples.filter((s) => s.age < 31).length;
  const oldN = arb.samples.length - youngN;
  // 保有中の値減りの目安(formula.html補論と同じ式: 延床95m2の償却+年30万の修繕負債)
  const carryExample = Math.round(COEFFS.DEFAULT_REBUILD_PPT * (95 / COEFFS.TSUBO_M2) / COEFFS.BUILDING_LIFE_Y + RETAIL.REPAIR_PER_YEAR);

  // 帯ごとの取引時期の偏り(時点修正を掛けない根拠)
  const bandYearMeans = ac.buckets.filter((b) => b.n > 0).map((b) => {
    const ys = arb.samples.filter((s) => s.age >= b.lo && s.age < b.hi).map((s) => qYear(s.deal.quarter));
    return ys.reduce((a, c) => a + c, 0) / ys.length;
  });
  const yMeanMin = Math.min(...bandYearMeans), yMeanMax = Math.max(...bandYearMeans);

  // 実例の選定(実在の成約から機械的に選ぶ。データが増えても壊れない)
  const EX_DISTRICT = distRows.find((r) => r.dist === "赤羽西")?.dist ?? distRows[0].dist;
  const bandMedOf = (age) => {
    const b = ac.buckets.find((x) => age >= x.lo && age < x.hi);
    return b?.ratio ?? 1;
  };
  const pick = (cands, target) => cands.length ? cands.reduce((best, s) =>
    Math.abs(s.ratio - target(s)) < Math.abs(best.ratio - target(best)) ? s : best) : null;
  const midCands = arb.samples.filter((s) => s.district === EX_DISTRICT && s.age >= 11 && s.age < 21);
  const oldCands = arb.samples.filter((s) => s.district === EX_DISTRICT && s.age >= 31);
  const s1 = pick(midCands, () => 1) ?? pick(arb.samples.filter((s) => s.age >= 11 && s.age < 21), () => 1) ?? arb.samples[0];
  const s2 = pick(oldCands, (s) => bandMedOf(s.age)) ?? pick(arb.samples.filter((s) => s.age >= 31), (s) => bandMedOf(s.age)) ?? arb.samples[arb.samples.length - 1];
  const exOf = (s, title, note) => ({
    title, note,
    landPart: s.landPart, bldgPart: s.bldgPart, monosashi: s.landPart + s.bldgPart,
    // 表示上の合計は「丸めた部品の和」。合計を独立に丸めると 4,961+959=5,921 のような1万円ずれが出る
    monosashiDisp: Math.round(s.landPart) + Math.round(s.bldgPart),
    price: s.deal.price_man, ratio: s.ratio, deal: s.deal, age: s.age,
  });
  const tsubo1 = s1.deal.land_m2 / COEFFS.TSUBO_M2;
  const tsubo2 = s2.deal.land_m2 / COEFFS.TSUBO_M2;
  const baseU = arb.base[EX_DISTRICT];
  const base1 = arb.base[s1.district], base2 = arb.base[s2.district];
  const ex1 = exOf(s1,
    `実例① ${s1.district}・築${Math.round(s1.age)}年(${s1.deal.quarter}成約・土地${s1.deal.land_m2}m²・延床${s1.deal.floor_m2}m²・徒歩${s1.deal.walk_min}分)`,
    `土地 = 相場${Math.round(base1)}万/坪 × ${tsubo1.toFixed(1)}坪 × 徒歩補正${wdenOf(s1.deal.walk_min).toFixed(2)} ／ 建物 = ${COEFFS.DEFAULT_REBUILD_PPT}万/坪 × ${(s1.deal.floor_m2 / COEFFS.TSUBO_M2).toFixed(1)}坪 × 残存${Math.max(0, Math.round((1 - s1.age / COEFFS.BUILDING_LIFE_Y) * 100))}% − 修繕${Math.round(Math.min(COEFFS.DEFAULT_REPAIR_MAN, RETAIL.REPAIR_PER_YEAR * s1.age))}万 → ほぼ、ものさしどおり`);
  const ex2 = exOf(s2,
    `実例② ${s2.district}・築${Math.round(s2.age)}年(${s2.deal.quarter}成約・土地${s2.deal.land_m2}m²・延床${s2.deal.floor_m2}m²・徒歩${s2.deal.walk_min}分)`,
    `ものさしはほぼ全部が土地(${Math.round(base2)}万/坪 × ${tsubo2.toFixed(1)}坪 × 徒歩補正${wdenOf(s2.deal.walk_min).toFixed(2)})なのに、実際は土地相場の${Math.round(s2.ratio * 100)}%でしか売れていない ── これが崖の中身`);

  // ---- よくある疑問(2026-08-15ユーザー質問による追記)の実測データ ----
  const medOf = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  // A: ものさしが引き算する建物分は成約価格の何割か(帯別中央値)
  const shareOf = (lo, hi) => {
    const xs = arb.samples.filter((s) => s.age >= lo && s.age < hi).map((s) => s.bldgPart / s.deal.price_man);
    return { n: xs.length, m: medOf(xs) ?? 0 };
  };
  const sh03 = shareOf(0, 3), sh1116 = shareOf(11, 16), sh2126 = shareOf(21, 26);
  // A: 「基準を建物が完全に消えた築31年〜から取ったら」実験(崖が基準に焼き込まれることの実演)
  const arbAlt = ageRatioBuckets(houseDeals, { matureLo: 31, matureHi: Infinity });
  const altFlat = medOf(arbAlt.samples.filter((s) => s.age < 31).map((s) => s.ratio));
  const altOld = medOf(arbAlt.samples.filter((s) => s.age >= 31).map((s) => s.ratio));
  const baseAlt = arbAlt.base[EX_DISTRICT] ?? null;
  // C: 再調達単価±20%の感度(全パイプラインを差し替えて再計算)
  const pptLow = Math.round(COEFFS.DEFAULT_REBUILD_PPT * 0.8), pptHigh = Math.round(COEFFS.DEFAULT_REBUILD_PPT * 1.2);
  const ciLow = ageCurveCI(houseDeals, 4000, { rebuildPpt: pptLow });
  const ciHigh = ageCurveCI(houseDeals, 4000, { rebuildPpt: pptHigh });
  const nb0 = (c) => c.rows.find((b) => b.lo === 0);

  // 散布図
  const nClip = arb.samples.filter((s) => s.ratio > 1.6 || s.ratio < 0.2).length;
  const labelled = new Set([0, 31, 41]);
  const scatterBuckets = ac.buckets.map((b) => ({ ...b, labelled: labelled.has(b.lo) }));

  // CI図
  const newHi = ci.rows.find((b) => b.lo === 0).hi95;
  const cliffTopHi = ci.rows.find((b) => b.lo === 31).hi95;
  const cliffB = ac.buckets.find((b) => b.lo === 31), oldB = ac.buckets.find((b) => b.lo === 41);

  const anchorNav = `
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
      ${[["#q-data", "STEP 1 データは何か"], ["#q-hazard", "STEP 2 ハザードの影響"], ["#q-norm", "STEP 3 ものさし価格"],
    ["#q-bundle", "STEP 4 束ねて比べる"], ["#q-ci", "STEP 5 どこまで信じるか"], ["#q-faq", "よくある疑問(ものさしの検算)"], ["#q-concl", "STEP 6 結論と限界"]]
      .map(([href, t]) => `<a href="${href}" style="font-size:.74rem;border:1px solid var(--band);padding:3px 10px;text-decoration:none;background:#FDFDFC">${t}</a>`).join("")}
    </div>`;

  const body = `
  <div class="panel">
    <h2>この頁は何か ── 「30年の崖」の作られ方を、材料から全部見せる</h2>
    <div class="logic-body">
      <p class="why"><a href="formula.html">値段の解剖</a>の補論はこう主張している: <b>中古戸建の値段は築30年まで「土地代+目減りした建物代」のものさしどおりに動き、築31年を越えると土地の値段まで2〜4割引かれる崖がある</b>。この主張が正しいかどうかで「築10年超の中古を検討対象に入れるか」「いつ売る前提で買うか」が変わる ── つまり<b>この台帳で最も重い結論のひとつ</b>だ。重い結論ほど、根拠は開いて見せる必要がある。この頁は次の3つの疑問に、実際の計算をそのまま見せて答える。</p>
      <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:12px">
        <div style="border:1.5px solid var(--ink);background:#FDFDFC;padding:11px 13px;flex:1;min-width:190px">
          <div style="font-weight:700;font-size:.82rem">疑問① 「数百件のデータ」とは何か</div>
          <div style="font-size:.76rem;color:var(--ink-soft);margin-top:5px">誰かの言い値ではなく、国土交通省が買主に照会して公開している<b>実際の成約価格</b> ${rawN}件。検収と絞り込みで<b>有効${ci.total}件</b>になる過程を全部見せる。→ <a href="#q-data">STEP 1</a></div>
        </div>
        <div style="border:1.5px solid var(--stamp);background:#FDFDFC;padding:11px 13px;flex:1;min-width:190px">
          <div style="font-weight:700;font-size:.82rem;color:var(--stamp)">疑問② ハザード地区の成約が混ざっていないか</div>
          <div style="font-size:.76rem;color:var(--ink-soft);margin-top:5px">混ざっている(${nHazard}件=${Math.round(100 * nHazard / ci.total)}%)。そこで<b>荒川低地の浸水想定に掛かる${nHazDist}地区を丸ごと除いて計算し直した</b> ── 崖の差は ${ci.cliffDiff.toFixed(2)} → ${ciTab.cliffDiff.toFixed(2)} と<b>ほぼ動かない</b>。→ <a href="#q-hazard">STEP 2</a></div>
        </div>
        <div style="border:1.5px solid var(--band);background:#FDFDFC;padding:11px 13px;flex:1;min-width:190px">
          <div style="font-weight:700;font-size:.82rem;color:var(--band)">疑問③ 条件がバラバラの成約をどう比べたか</div>
          <div style="font-size:.76rem;color:var(--ink-soft);margin-top:5px">1件ずつ「その条件ならいくらのはず」という<b>ものさし価格</b>を作り、実際の価格÷ものさしの<b>比率</b>に直してから並べる。実在の2件で手順を再現する。→ <a href="#q-norm">STEP 3</a></div>
        </div>
      </div>
      ${anchorNav}
    </div>
  </div>

  <div class="panel" id="q-data">
    <h2>STEP 1: データは何か ── 国が公開している「実際に売れた値段」${rawN}件</h2>
    <div class="logic-body">
      <p class="why">まず大前提から。SUUMOなどに出ている価格は<b>売出価格(売主の希望)</b>で、実際にいくらで売れたかは載らない。一方、国土交通省は不動産の買主にアンケートを送り、登記の異動と突き合わせて<b>実際の成約価格</b>を「不動産取引価格情報」として公開している(個人が特定されないよう、住所は「北区赤羽西」など<b>地区まで</b>・価格は100万円単位・面積は5m²単位に丸めてある)。この台帳が使うのはこの成約データで、対象は<b>北区の${[...new Set(houseDeals.map((d) => d.district))].length}地区・${qMin}〜${qMax}の中古/新築戸建 ${rawN}件</b>。1件ずつの数字と出所リンクは<a href="data.html">成約データ台帳</a>で全件確認できる。</p>
      ${funnelSvg({
    stages: [
      { n: rawN, label: "国交省の成約記録(戸建)", sub: `北区${[...new Set(houseDeals.map((d) => d.district))].length}地区・${qMin}〜${qMax}` },
      { n: houseDeals.length, label: "検収を通過", sub: "原典と突き合わせて矛盾した行は使わない", drop: `${conflictN + rangeDropN}件除外: 原典と数値が食い違う${conflictN}件・検収の範囲外${rangeDropN}件(徒歩90分の異常値など)` },
      { n: arb.nLandFiltered, label: "実需帯に限定", sub: "土地40〜120m²(住宅として普通の区画)", drop: `${houseDeals.length - arb.nLandFiltered}件除外: 極端な狭小地・大区画(別の市場)` },
      { n: ci.total, label: "測定に使う有効標本", sub: `${ci.districts}地区。地区ごとの土地相場が立つところだけ`, drop: `${arb.nLandFiltered - ci.total}件除外: 基準が立たない${droppedDistricts.length}地区(STEP 3の成熟帯が5件未満)`, tail: `/ ${ci.districts}地区` },
    ],
  })}
      <div class="note"><b>検収の中身</b>: この${rawN}件は再掲サイト経由で取得したものなので、国交省の原典API(不動産情報ライブラリ)と四半期・地区・価格・面積で突き合わせてある。数値が食い違った行は原因が確定するまで自動的に計算から外れる(現在${conflictN}件)。「実需帯」で外す${houseDeals.length - arb.nLandFiltered}件は、極小地(業者仕入れ・投資向け)や大区画(アパート用地等)で、住宅を買う市場とは値付けの論理が違うため。最後の${arb.nLandFiltered - ci.total}件は、崖の測定に必要な「地区の土地相場」(STEP 3)が立たない${droppedDistricts.length}地区(${droppedDistricts.map((d) => esc(d)).join("・")})のもの ── データが悪いのではなく、<b>ものさしを作れない地区は測定から外す</b>という意味。</div>
    </div>
  </div>

  <div class="panel" id="q-hazard">
    <h2>STEP 2: ハザード地区の成約は結論を歪めていないか ── 除いて計算し直しても崖は不変</h2>
    <div class="logic-body">
      <p class="why">この台帳は<b>買う候補にはハザード該当物件を一切載せない</b>(<a href="map.html">ハザードマップ対照</a>)。しかし上の有効${ci.total}件は「相場のものさし」を作るためのデータで、<b>荒川低地(浸水想定域)の地区の成約も含まれている</b>。内訳は下表のとおり: 台地側${distRows.filter((r) => r.cls === "tableland").length}地区に対し、低地(${lowNames.map((d) => esc(d)).join("・") || "—"})と、丁目単位で台地/低地が分かれる混在地区(${mixNames.map((d) => esc(d)).join("・") || "—"})が計${nHazard}件=<b>標本の${Math.round(100 * nHazard / ci.total)}%</b>を占める。</p>
      <div style="overflow-x:auto"><table class="list">
        <tr><th>地区</th><th>地形の区分</th><th class="num">土地相場(万/坪)</th><th class="num">有効件数</th><th class="num">うち築31年〜</th></tr>
        ${distRows.map((r) => `<tr${r.cls !== "tableland" ? ' style="background:#FBF4F2"' : ""}><td><b>${esc(r.dist)}</b></td><td>${esc(CLS_LABEL[r.cls])}</td><td class="num">${Math.round(r.unit)}</td><td class="num">${r.n}件</td><td class="num">${r.oldN}件</td></tr>`).join("")}
      </table></div>
      <div class="note">地形の区分は<a href="map.html">公式ハザードマップの機械照合</a>(丁目ごとに代表点±200mの25点を判定した area-scan)から機械的に導出。境界は台帳の掲載条件「台地側」と同じ<b>「丁目のほぼ全域が3m超の浸水想定に掛かるか」</b>で引いており、台地側に分類した地区にも浅い浸水(0.5〜3m)や土砂災害警戒区域(イエロー)が丁目内にある地区は含まれる(台地上でも浅い着色は普通に出るため)。また、成約データの住所は地区までしか公開されないため、<b>1件ずつ「この成約はハザード区域内か」を確かめることは原理的にできない</b>。できる最大限は「疑わしい地区を丸ごと外して、結論が変わるかを見る」ことで、それを下でやる。</div>
      <p class="why" style="margin-top:14px"><b>そもそも、なぜ低地の成約が混ざっていても崖の測定を歪めにくいのか</b>。低地の土地が安いこと自体は問題にならない ── STEP 3で見るとおり、各成約は<b>自分の地区の土地相場</b>と比較されるからだ(志茂の成約は志茂の相場と比べる。志茂の安さは志茂の相場に織り込まれ、比率には現れない)。歪みうるとすれば「低地では<b>築年の効き方そのもの</b>が台地と違う」場合だけ。それは理屈では否定しきれないので、<b>低地・混在の${nHazDist}地区(${nHazard}件)を丸ごと外して全部計算し直した</b>:</p>
      ${hazardCompareSvg({
    all: ac.buckets, tab: acTab.buckets,
    totalAll: ci.total, totalTab: ciTab.total,
    districtsAll: ci.districts, districtsTab: ciTab.districts, nHazDist,
    diffAll: { mid: ci.cliffDiff, lo: ci.cliffLo, hi: ci.cliffHi },
    diffTab: { mid: ciTab.cliffDiff, lo: ciTab.cliffLo, hi: ciTab.cliffHi },
    nHazard, pctHazard: Math.round(100 * nHazard / ci.total),
  })}
      <div style="overflow-x:auto;margin-top:10px"><table class="list">
        <tr><th>計算対象</th><th class="num">有効標本</th><th class="num">地区数</th><th class="num">崖の差</th><th class="num">95%信頼区間</th><th>崖の判定</th></tr>
        ${[
      ["全地区(formula.htmlの数字)", ci, ""],
      [`明確な低地(${lowNames.join("・") || "—"})のみ除外`, ciMild, ""],
      ["<b>台地側のみ(低地+混在も除外)</b>", ciTab, ' style="background:#F2F7F4"'],
    ].map(([label, c, style]) => `<tr${style}><td>${label}</td><td class="num">${c.total}件</td><td class="num">${c.districts}</td><td class="num"><b>${c.cliffDiff.toFixed(3)}</b></td><td class="num">${c.cliffLo.toFixed(3)}〜${c.cliffHi.toFixed(3)}</td><td>${c.cliffLo > 0 ? "0を跨がない=崖あり" : "0を跨ぐ=判別不能"}</td></tr>`).join("")}
      </table></div>
      <div class="note"><b>結論</b>: 荒川低地の浸水想定に掛かる地区(低地・混在の${nHazDist}地区)の成約を全部外しても、崖の大きさは ${ci.cliffDiff.toFixed(2)} → ${ciTab.cliffDiff.toFixed(2)}(95%区間 ${ciTab.cliffLo.toFixed(2)}〜${ciTab.cliffHi.toFixed(2)})で<b>実質的に同じ</b>。つまり「30年の崖」は低地の安い成約が作った見かけの現象ではなく、<b>台帳の掲載対象である台地側だけで測っても同じ大きさで存在する</b>。なお上の注記のとおり、ここで言う「台地側」にも浅い浸水・土砂イエローの丁目を含む地区はある ── 地区単位の除外はこの粒度が上限で、「ハザードの影響を完全にゼロにした」わけではない。この検算は回帰テストに固定してあり、データを追加してこの性質が崩れると台帳のテストが落ちる。</div>
    </div>
  </div>

  <div class="panel" id="q-norm">
    <h2>STEP 3: ものさし価格 ── 地区も築年も広さも違う${ci.total}件を、同じ土俵に乗せる</h2>
    <div class="logic-body">
      <p class="why">有効${ci.total}件は地区(坪単価の水準)も築年数も土地の広さも駅距離もバラバラで、価格をそのまま並べても何も分からない。そこで発想を変える ── <b>1件ずつ「この条件なら、いくらで売れるのが標準か」を機械的に計算し(=ものさし価格)、実際の成約価格をものさしで割った比率だけを取り出す</b>。比率1.00なら「ものさしどおり」、0.70なら「ものさしより3割安い」。単位が消えるので、全${ci.total}件を1枚のグラフに並べられる。ものさしは次の3部品でできている:</p>
      <div class="logic-step"><div class="t"><span class="no">部品1</span>地区の土地相場(万/坪。坪は土地の慣用単位で1坪≒3.3m²)</div>
        <div class="formula">土地相場 = その地区の築11〜25年の成約から建物分を引いた残り ÷ 土地坪数 の中央値(駅徒歩10分の条件に揃える。やり方は部品3)</div>
        <div class="why">崖を測るのに崖を使わないよう、基準は<b>建物の値段がほぼ消えかけた成熟帯(築11〜25年)</b>から立てる。この帯なら「価格≒土地+わずかな建物」なので、土地の相場が最も素直に読める。この成約が5件未満の地区は基準が立たないため測定から外す(STEP 1の最後の絞り込み)。各地区の値は上のSTEP 2の表のとおり(例: ${esc(EX_DISTRICT)}=${Math.round(baseU)}万/坪)。なおこれは<b>崖測定専用に立て直した値</b>で、物件査定に使う基準坪単価(公示地価ベース・<a href="formula.html">値段の解剖</a>第1項)とは出所が別 ── 崖の測定が査定側の仮定に依存しないようにするためで、数字が一致しないのは仕様。<b>「築11年ならまだ建物価値が残っているのでは?」「なぜ建物が完全に消えた築31年〜から取らないのか?」という疑問には<a href="#q-faq">よくある疑問A</a>で、実際に計算をやり直して答えている。</b></div></div>
      <div class="logic-step"><div class="t"><span class="no">部品2</span>建物の残り価値(万円)</div>
        <div class="formula">建物 = ${COEFFS.DEFAULT_REBUILD_PPT}万/坪 × 延床坪数 × (1 − 築年数/${COEFFS.BUILDING_LIFE_Y}) − 繰延修繕 min(${COEFFS.DEFAULT_REPAIR_MAN}万, ${RETAIL.REPAIR_PER_YEAR}万×築年数)</div>
        <div class="why">新築時の建築費${COEFFS.DEFAULT_REBUILD_PPT}万/坪が${COEFFS.BUILDING_LIFE_Y}年かけて直線でゼロになる、という<a href="formula.html">値段の解剖・第2項</a>と同じ単純な引き算。築${COEFFS.BUILDING_LIFE_Y}年超は残価ゼロ。修繕やリフォームの履歴はデータに無いので、全件「年式相応の未修繕」と置く ── この仮定が帯ごとに大きく偏らない限り、帯どうしの比較は歪みにくい。実際には売却前に手を入れた家が築古ほど混ざりやすく、その場合は築古帯の比率が上振れする=<b>崖はむしろ控えめに出る</b>(保守側の誤差)。${COEFFS.DEFAULT_REBUILD_PPT}万/坪という数字の<b>出所と、±20%動かした場合の感度は<a href="#q-faq">よくある疑問C</a></b>。</div></div>
      <div class="logic-step"><div class="t"><span class="no">部品3</span>駅距離の補正</div>
        <div class="formula">徒歩補正 = ${WALK_KNOTS[0][0]}分以内 ±0% / ${WALK_KNOTS.slice(1).map(([m, p]) => `${m}分 ${Math.round(p * 100)}%`).join(" / ")}(間は直線でつなぎ、${WALK_KNOTS[WALK_KNOTS.length - 1][0]}分以降は頭打ち)</div>
        <div class="why">台帳479件の実測(2026-08-12時点。<a href="formula.html">値段の解剖</a>の変数辞典と同じ折れ線)から作った補正。駅から遠い成約を安いまま比べると「遠い=築年のせい」と誤読するため、距離のぶんを先に取り除く。</div></div>
      <div class="note" style="margin-top:4px"><b>時点(いつ売れたか)の補正を掛けない理由</b>: ${qMin}〜${qMax}(Q1=1〜3月期の四半期表記)は地価の上昇局面で、古い成約ほど安く見える。ただしこの歪みが崖に化けるのは「築古の成約だけが古い時期に偏っている」場合に限られる。実測すると、どの築年帯も取引時期の平均は${yMeanMin.toFixed(1)}〜${yMeanMax.toFixed(1)}年に揃っており偏りがない。時点のブレは帯の中の散らばりとして残り、STEP 5の信頼区間の幅に織り込まれる。</div>
      <p class="why" style="margin-top:14px">実在の成約2件を、この3部品に実際に通してみる(2件とも上の有効標本の中の実データ。出所は<a href="data.html">成約データ台帳</a>):</p>
      ${exampleSvg({ ex1, ex2 })}
      <div class="note"><b>実例①(築${Math.round(ex1.age)}年)</b>は、ものさし${fmt(ex1.monosashiDisp)}万に対し成約${fmt(ex1.price)}万で比率${ex1.ratio.toFixed(2)} ── ものさしどおりの値付け。<b>実例②(築${Math.round(ex2.age)}年)</b>は建物の項がゼロなので、ものさし${fmt(ex2.monosashiDisp)}万は<b>ほぼ丸ごと土地の相場</b>。それでも成約は${fmt(ex2.price)}万=比率${ex2.ratio.toFixed(2)}で、<b>土地の値段そのものが${Math.round((1 - ex2.ratio) * 100)}%引かれている</b>。この「建物がゼロになったあと、土地まで引かれる」帯が崖の正体で、次のSTEPで${ci.total}件全部について同じ比率を出して並べる。</div>
    </div>
  </div>

  <div class="panel" id="q-bundle">
    <h2>STEP 4: 束ねて比べる ── ${ci.total}件全部の比率を築年順に並べる</h2>
    <div class="logic-body">
      <p class="why">全${ci.total}件について「実際÷ものさし」の比率を計算し、横軸に築年数を取って1点ずつ置いたのが下の散布図。個々の点は大きく散らばる ── 道路の幅・土地の形・リフォーム歴・売り急ぎといった個別事情はこのデータでは観測できないからだ。だから<b>個々の点ではなく、築年帯(0〜3年、3〜7年、…)ごとに束ねた中央値(━の線分)</b>を読む。中央値とは<b>小さい順に並べたときの真ん中の値</b>のことで、平均と違い、極端な1件(縁故売買・記録の癖など)に引っ張られない。</p>
      ${scatterSvg({ pts: arb.samples.map((s) => ({ age: s.age, ratio: s.ratio, hazard: hazardOf(s.district) !== "tableland" })), buckets: scatterBuckets, nClip })}
      <div class="note"><b>読み方</b>: 帯の中央値は築0〜3年${ac.buckets[0].ratio.toFixed(2)}、築7〜30年はどの帯も1.00近辺 ── そして築31〜41年${cliffB.ratio.toFixed(2)}、築41年〜${oldB.ratio.toFixed(2)}へ沈む。なお築11〜25年の帯が1.00付近に出るのは<b>大部分が仕組みどおり</b>(その帯を基準にものさしを作ったから。ただし基準は地区ごとに1本の値なので、11〜16 / 16〜21 / 21〜26の各帯が個別に1.00へ寄る保証まではない)。この方法が本当に測っているのは「<b>基準帯に対して、他の帯がどれだけズレるか</b>」で、意味のある発見は ①新築側にプレミアムの山が立たない ②築31年から先が大きく沈む、の2つ。灰色の点(低地・混在の地区)が青い点と同じように散らばっていることも、STEP 2の「低地を除いても変わらない」を目で確認できる。</div>
    </div>
  </div>

  <div class="panel" id="q-ci">
    <h2>STEP 5: どこまで信じてよいか ── 「たまたまそう見えただけ」を4,000回の引き直しで潰す</h2>
    <div class="logic-body">
      <p class="why">中央値が沈んで見えても、件数が少なければ偶然かもしれない。そこで<b>ブートストラップ法</b>で確かめる。やることは単純だ。<b>帯ごとに、その帯の成約が入った袋から「戻しながら」同じ件数を引き直して(例: 築31〜41年の帯なら${ci.rows.find((b) => b.lo === 31)?.n ?? "—"}件)、ありえた別の標本を作り、中央値を取り直す ── これを4,000回繰り返す</b>。4,000個の中央値がどの範囲に散らばるかが「偶然でブレうる幅」で、その中央95%を<b>95%信頼区間</b>と呼ぶ。件数が少ない帯ほど袋が小さく、引き直すたびに中央値が大きく振れる=区間が広くなる(築26〜31年の帯が典型)。区間が1.00を含む帯は「ものさしどおりと区別がつかない」、含まない帯だけが「本当にズレている」と言える。</p>
      ${ciBarsSvg({ rows: ci.rows, newHi, cliffTopHi, n37: ci.rows.find((b) => b.lo === 3)?.n ?? 0 })}
      <div style="overflow-x:auto;margin-top:10px"><table class="list">
        <tr><th>築年帯</th><th class="num">件数</th><th class="num">実際÷ものさし</th><th class="num">95%信頼区間</th><th>読み取れること</th></tr>
        ${ci.rows.map((b) => {
    const extra = b.lo === 3 ? "。ただしエリア拡張と同時に現れた帯で標本も薄い ── 判断の根拠にしない(STEP 6)"
      : b.lo === 11 || b.lo === 16 || b.lo === 21 ? "(ものさしの基準帯 ── 1.00近辺は仕組みどおり)" : "";
    return `<tr${b.lo >= 31 ? ' style="background:#FBF4F2"' : ""}><td>${esc(b.label)}</td><td class="num">${b.n}</td><td class="num">${b.m.toFixed(2)}</td><td class="num">${b.lo95.toFixed(2)}〜${b.hi95.toFixed(2)}</td><td style="white-space:normal">${esc(b.verdict)}${extra}</td></tr>`;
  }).join("")}
      </table></div>
      <p class="why" style="margin-top:14px">最後に、結論の本丸である<b>崖の差そのもの</b>を検定する。今度は<b>築31年未満(${youngN}件)と築31年以上(${oldN}件)の2つの袋をそれぞれ引き直して「中央値の差」を計算する</b> ── これを同じ要領で4,000回。その分布が下図で、<b>もし崖が偶然の産物なら、差が0近辺に落ちる回があるはず</b>だが ──</p>
      ${diffHistSvg({ diffs: ci.diffs, lo: ci.cliffLo, hi: ci.cliffHi, min: ci.diffs[0], max: ci.diffs[ci.diffs.length - 1], nZero: ci.diffs.filter((d) => d <= 0).length })}
      <div class="note">4,000回の引き直しで差の最小値は${ci.diffs[0].toFixed(2)}${ci.diffs[0] > 0 ? "、0(崖なし)は一度も出ない。<b>この崖はデータの偶然では説明できない</b>" : ""}。同じ計算は乱数の種を固定してあり、同じ台帳なら誰がいつビルドしても同じ数字が出る(再現性)。</div>
    </div>
  </div>

  <div class="panel" id="q-faq">
    <h2>よくある疑問 ── ものさしそのものを疑う3つの検算</h2>
    <div class="logic-body">
      <p class="why">ここまでの計算は「地区の土地相場は築11〜25年から立てる」「建物は${COEFFS.DEFAULT_REBUILD_PPT}万/坪から直線で目減り」という<b>仮定</b>の上に立っている。仮定が怪しければ結論も怪しい。そこで、よく出る3つの疑問に、<b>実際に計算をやり直して</b>答える(数値はすべてビルド時の実測)。</p>

      <h2 class="sub" style="margin-top:16px">疑問A: 築11〜25年の家にはまだ建物の価値が残っているのでは? なぜ「完全に消えた帯」を基準にしないのか</h2>
      <p class="why">前半はそのとおりで、残っている。だからこの方法は建物価値を「無いとみなす」のではなく、<b>部品2で見積もった建物分を成約価格から引き算してから</b>土地の相場を出している(残差法)。では引き算する建物分はどれくらいの大きさか ── 実測するとこうなる:</p>
      ${faqShareSvg([
    { label: "築0〜3年(新築)", share: sh03.m, n: sh03.n, note: " ── 価格の4割弱が建物" },
    { label: "築11〜16年", share: sh1116.m, n: sh1116.n, note: " ── 引き算はこの程度" },
    { label: "築21〜26年", share: sh2126.m, n: sh2126.n, note: "(修繕の負債と相殺)" },
  ])}
      <div class="note">土地が価格の大半を占めるエリアなので、築11年時点でも建物分は<b>価格の2割弱</b>しかない(新築の半分以下)。引き算がこの大きさなら、建物モデルが多少ズレても土地相場への影響は限定的に収まる ── これが下限を築11年に置ける理由。</div>
      <p class="why" style="margin-top:12px">では上限側 ── 建物が完全に消えた<b>築31年〜を基準にすればもっときれいでは?</b> 実際にやってみた:</p>
      <div style="overflow-x:auto"><table class="list">
        <tr><th>基準の取り方</th><th class="num">${esc(EX_DISTRICT)}の土地相場</th><th class="num">フラット圏(築31年未満)の読み</th><th class="num">崖の差</th></tr>
        <tr style="background:#F2F7F4"><td><b>築11〜25年(現行)</b></td><td class="num"><b>${Math.round(baseU)}万/坪</b></td><td class="num">${medOf(arb.samples.filter((s) => s.age < 31).map((s) => s.ratio)).toFixed(2)}(≒ものさしどおり)</td><td class="num">${ci.cliffDiff.toFixed(2)}</td></tr>
        <tr style="background:#FBF4F2"><td>築31年〜(建物ゼロの帯)</td><td class="num">${baseAlt ? Math.round(baseAlt) + "万/坪" : "—"}</td><td class="num">${altFlat ? altFlat.toFixed(2) + "(全部が「2〜3割高」に見える)" : "—"}</td><td class="num">${altFlat && altOld ? (altFlat - altOld).toFixed(2) : "—"}</td></tr>
      </table></div>
      ${baseAlt ? faqBaseGaugeSvg({ koji: KOJI_PPT, baseNow: baseU, baseAlt }) : ""}
      <div class="note"><b>何が起きたか</b>: 築31年〜の成約は「土地相場から2〜4割引かれた価格」── つまり<b>崖そのもの</b>だ。そこから土地相場を逆算すると、崖の値引きが混入した「安すぎる相場」(${esc(EX_DISTRICT)}で${baseAlt ? Math.round(baseAlt) : "—"}万/坪)が出てくる。これは公示地価から見た実勢の目安(${KOJI_PPT}×1.1〜1.2=${Math.round(KOJI_PPT * RULE_LO)}〜${Math.round(KOJI_PPT * RULE_HI)}万/坪)と大きく矛盾する。崖の帯を基準に使うと<b>崖が基準に焼き込まれ</b>、「普通の中古はどこも2〜3割高く売れている」という逆立ちした読みになってしまう。築11〜25年を選ぶのは ①崖の外側で ②建物の引き算が小さく ③地区ごとに件数を確保でき ④<b>出てくる相場が公示という独立の物差しと整合する</b>、の4条件を同時に満たす帯だから。④が効いていて、この帯選びは「答えを見て選んだ」のではなく外部の物差しで検算できている。</div>

      <h2 class="sub" style="margin-top:20px">疑問B: ものさし価格には「売主の期待(上乗せ)」も乗っているのではないか</h2>
      <p class="why"><b>乗っていない。</b>このページの材料は最初から最後まで<b>成約価格</b>(実際に売買が成立した価格)で、SUUMO等の売出価格は1件も使っていない。</p>
      ${faqAskSvg()}
      <div class="note">「売主の期待」は売出価格にだけ乗っている部分で、成約に至るまでの値引き・交渉で削られた後の姿がこのデータ。ものさしの土地相場も成約から作り、比率の分子も成約なので、<b>式のどこにも売出価格は登場しない</b>。ただし正確に言うと、ものさしには「実需の買い手が実際に払っている水準」(分譲利益や住宅地としての人気を含む、成約ベースの小売水準)は乗っている ── これは意図的で、同じ市場の成約同士を比べないと築年の効果だけを取り出せないため。売出と成約の差(=売主の期待)の話は<a href="formula.html">値段の解剖・第3項</a>が扱う。</div>

      <h2 class="sub" style="margin-top:20px">疑問C: 「再調達${COEFFS.DEFAULT_REBUILD_PPT}万/坪」とは何で、どこから来た数字か。違っていたら結論は変わるのか</h2>
      <p class="why"><b>「同じ家をいま新築で建て直したら幾らかかるか」という工事費の坪単価</b>のこと(だから「再調達」と呼ぶ)。2026年時点の木造戸建の実勢建築費<b>90〜110万円/坪というレンジの保守側(下寄り)</b>として${COEFFS.DEFAULT_REBUILD_PPT}万を置いている。公的統計の一次値そのものではなく実勢レンジからの設定値なので、<b>この数字を±20%動かして全部再計算した</b>:</p>
      ${faqSensSvg([
    { label: `−20%(${pptLow}万/坪)`, sub: "建物を安く見積もる側", mid: ciLow.cliffDiff, lo: ciLow.cliffLo, hi: ciLow.cliffHi },
    { label: `採用値 ${COEFFS.DEFAULT_REBUILD_PPT}万/坪`, sub: "実勢90〜110万の保守側", mid: ci.cliffDiff, lo: ci.cliffLo, hi: ci.cliffHi },
    { label: `+20%(${pptHigh}万/坪)`, sub: "建物を高く見積もる側", mid: ciHigh.cliffDiff, lo: ciHigh.cliffLo, hi: ciHigh.cliffHi },
  ])}
      <div style="overflow-x:auto;margin-top:8px"><table class="list">
        <tr><th>再調達単価</th><th class="num">崖の差(95%区間)</th><th class="num">築0〜3年の比率(95%区間)</th><th>読み</th></tr>
        ${[
    [`−20% = ${pptLow}万/坪`, ciLow, nb0(ciLow), ""],
    [`<b>採用 ${COEFFS.DEFAULT_REBUILD_PPT}万/坪</b>`, ci, nb0(ci), ' style="background:#F2F7F4"'],
    [`+20% = ${pptHigh}万/坪`, ciHigh, nb0(ciHigh), ""],
  ].map(([label, c, nb, style]) => `<tr${style}><td>${label}</td><td class="num">${c.cliffDiff.toFixed(2)}(${c.cliffLo.toFixed(2)}〜${c.cliffHi.toFixed(2)})</td><td class="num">${nb.m.toFixed(2)}(${nb.lo95.toFixed(2)}〜${nb.hi95.toFixed(2)})</td><td style="white-space:normal">${c.cliffLo > 0 ? "崖あり(0を跨がない)" : "崖の判別不能"}。新築の山${nb.hi95 < 1 ? "なし" : "は立たないが、区間が1.00に触れ「新築が安い」とまでは言えない"}</td></tr>`).join("")}
      </table></div>
      <div class="note"><b>読み方</b>: 崖の大きさ自体は動く(建物を高く見積もるほどものさしが膨らみ、相対的に崖は浅く出る)が、<b>どの仮定でも95%区間が0を跨がず「崖がある」は不変</b>。理由は構造的で、崖の帯(築31年〜)ではものさしの建物項がもともとゼロなので、再調達単価の仮定は崖側にほぼ効かないから。もう一つの結論「新築に上乗せの山なし」は、−20%側では区間の上限が1.00に触れて「ものさしどおりと区別できない」まで弱まる ── それでも<b>山(1.00を明確に超える上乗せ)はどの仮定でも観測されない</b>。なお同じ${COEFFS.DEFAULT_REBUILD_PPT}万を事例側の引き算と対象側の足し算の両方に使う対称設計なので、誤差の一部は比率の上で打ち消し合う。</div>
    </div>
  </div>

  <div class="panel" id="q-concl">
    <h2>STEP 6: 結論と限界 ── 言えることは2つ、言えないことも書いておく</h2>
    <div class="logic-body">
      <div style="display:flex;flex-wrap:wrap;gap:12px">
        <div style="border:1.5px solid #2C6E49;background:#FDFDFC;padding:11px 13px;flex:1;min-width:250px">
          <div style="font-weight:700;color:#2C6E49;border-bottom:1px solid var(--grid);padding-bottom:5px">この検証から言えること</div>
          <div style="font-size:.78rem;line-height:1.9;margin-top:6px">
            <b>① 築31年からの崖は本物</b> ── 差${ci.cliffDiff.toFixed(2)}(95%区間${ci.cliffLo.toFixed(2)}〜${ci.cliffHi.toFixed(2)})。低地・混在の${nHazDist}地区を除いても${ciTab.cliffDiff.toFixed(2)}で不変(STEP 2)、再調達単価を±20%動かしても不変(よくある疑問C)。<br>
            <b>② 新築プレミアムの山は無い</b> ── 築0〜3年は${ac.buckets[0].ratio.toFixed(2)}(区間上限${newHi.toFixed(2)}&lt;1.00)。「新築は買った瞬間2割下がる」はこの市場では観測されない(ただし①より仮定への依存が強い ── よくある疑問C)。<br>
            <span style="color:var(--ink-soft)">(参考: 築3〜7年帯も1.00を下回るが、標本${ci.rows.find((b) => b.lo === 3).n}件と薄く、エリア拡張と同時に現れたため母集団の変化と切り分けられない ── 判断の根拠にしない)</span>
          </div>
        </div>
        <div style="border:1.5px solid var(--ink-soft);background:#FDFDFC;padding:11px 13px;flex:1;min-width:250px">
          <div style="font-weight:700;color:var(--ink-soft);border-bottom:1px solid var(--grid);padding-bottom:5px">言えないこと(この台帳の限界)</div>
          <div style="font-size:.78rem;line-height:1.9;margin-top:6px;color:var(--ink-soft)">
            ・築7〜30年の<b>細かい起伏は判別不能</b>(全帯が1.00を含む)。「築15年で建物が何%残るか」は断定できない<br>
            ・<b>崖の開始が築31年ちょうどか</b>は未特定(帯の切り方の産物でありうる。手前かもしれない)<br>
            ・築古帯には再建築不可・借地・旗竿などの「訳あり」が構造的に混ざりやすく、データに列が無いため<b>分離できない</b>(崖の一部はこの混入かもしれないが、量を測れない)<br>
            ・丁目・道路・リフォーム歴は観測不能 ── 点の散らばりとして残る
          </div>
        </div>
      </div>
      <p class="why" style="margin-top:14px"><b>なぜ崖ができるのか(解釈 ── ここは実測ではなく仮説)</b>: 築31年を越えた家の買い手は建て替え・更地化を前提に見るため、解体費(150〜200万)と手間・リスクのぶん土地を買い叩く。加えて築41年超には1981年以前の旧耐震が混ざり始め、住宅ローンの担保評価・地震保険の壁で買い手が現金層に狭まる。どれがいくら効いているかはこのデータでは分解できないが、「建物がゼロになった後、土地まで引かれる」という観測事実そのものは上のSTEPのとおり動かない。</p>
      <p class="why" style="margin-top:12px"><b>買う側への含意 ── 「築10年超は見ない」ではなく「出口の築年で選ぶ」</b>。持っている間の値減り(建物の目減り+修繕負債)は入口の築年によらずほぼ一定(延床95m²で年約${carryExample}万)なので、効いてくるのは<b>売るときの築年が崖を越えているか</b>だけ。15年住む前提なら:</p>
      ${exitTimelineSvg()}
      <div class="note"><b>崖は「売るとき」に実現する損</b>なので、住み切る(売らない)前提なら効かない ── その場合の判断軸は価格の妥当性(<a href="formula.html">値段の解剖</a>)とハザード(<a href="map.html">対照マップ</a>)に戻る。売る可能性を残すなら、<b>新築〜築10年で入る(出口が崖の手前)か、築25年超を土地値で買う(最初から建物代を払わない)かの二択</b>で、その中間(築12〜18年)は出口がちょうど崖に着地する ── 「築10年以上を全部避ける」のは過剰反応で、<b>避けるべきは中間帯だけ</b>、というのがこのデータの読みだ。ただし崖の開始が築31年より手前である可能性は残る(限界欄)ので、<b>中間帯の境界は保守的に(広めに)見る</b>こと。</div>
      <div class="note" style="margin-top:10px"><b>再現性と関連ページ</b>: この頁の数字はすべてビルド時に査定エンジンから再計算され(乱数は固定シード)、<a href="formula.html">値段の解剖・補論</a>と常に同じ値を指す。生データ全件は<a href="data.html">成約データ台帳</a>(1行ずつ出所リンク・照合結果つき)、地形とハザードの対照は<a href="map.html">ハザードマップ対照</a>、係数の意味は<a href="guide.html">前提知識ガイド</a>。本頁は検討用の統計整理であり不動産鑑定評価ではない。</div>
    </div>
  </div>`;

  return layout({
    title: "30年の崖の検証 ── データの出所から結論まで",
    subtitle: `国交省の成約${rawN}件 → 有効${ci.total}件・${ci.districts}地区 ── 低地(浸水想定)の地区を除いても崖は${ciTab.cliffDiff.toFixed(2)}で不変`,
    docNo: `築年カーブ検証<br>査定基準日 ${esc(asOf)}`,
    body,
  });
}
