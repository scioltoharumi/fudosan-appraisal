// site/templates/formula.js — 成約事例ベースの算出ロジック図解「値段の解剖」
// 総額 = 土地実勢単価×土地坪数 + 建物残価 + 売主の期待、の3層を実物件(赤羽西4)の数字で図解する。
// 図中の値はすべてビルド時にエンジンから再計算され、台帳と常に一致する。
import { COEFFS, fmtMan } from "../../engine/appraise.js";
import { RETAIL, ADJACENT_DISTRICTS, districtOf } from "../../engine/retail.js";
import { layout, esc } from "./layout.js";

// 公示地価2025 赤羽西・住宅地平均(万円/坪)。出典: 国交省 地価公示
// (トチノカチ 13117-U0045 / 土地代データ akabanenishi で確認 2026-08-11)
const KOJI_PPT = 190;
const RULE_LO = 1.1, RULE_HI = 1.2;   // 経験則: 実勢 ≒ 公示×1.1〜1.2(人気エリア論の検証はページ本文)

// ---- 生の残余単価(時点修正なし・徒歩10分標準へ正規化) ----
// 「補正後単価」から時点修正(上昇継続の仮定)を外した、実際に払われた瞬間の水準。
// フィルタ: 隣接地区・中古実需帯(築3〜25年・土地40〜120m2)。normalizeLandUnitと同じ控除規則。
function rawResidualStats(houseDeals, subjectDistrict) {
  const allowed = new Set(ADJACENT_DISTRICTS[subjectDistrict] ?? []);
  const rows = [];
  for (const d of houseDeals ?? []) {
    if (!allowed.has(d.district)) continue;
    if (d.age_y < 3 || d.age_y > 25) continue;
    if (d.land_m2 < 40 || d.land_m2 > 120) continue;
    const bldg = Math.max(0, COEFFS.DEFAULT_REBUILD_PPT * (d.floor_m2 / COEFFS.TSUBO_M2) * Math.max(0, 1 - d.age_y / COEFFS.BUILDING_LIFE_Y)
      - Math.min(COEFFS.DEFAULT_REPAIR_MAN, RETAIL.REPAIR_PER_YEAR * d.age_y));
    const resid = Math.max(d.price_man - bldg, d.price_man * RETAIL.LAND_RESID_MIN_RATIO);
    const denom = Math.min(RETAIL.WALK_DENOM_CLAMP[1], Math.max(RETAIL.WALK_DENOM_CLAMP[0],
      1 + COEFFS.WALK_ADJ_PER_MIN * (d.walk_min - COEFFS.WALK_BASE_MIN)));
    rows.push({ q: d.quarter, u: resid / (d.land_m2 / COEFFS.TSUBO_M2) / denom });
  }
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const byQ = {};
  for (const r of rows) (byQ[r.q] ??= []).push(r.u);
  const quarters = Object.keys(byQ).sort().map((q) => ({
    q, n: byQ[q].length, med: Math.round(med(byQ[q])), over300: byQ[q].filter((u) => u >= 300).length,
  }));
  const all = rows.map((r) => r.u).sort((x, y) => x - y);
  const pct = (p) => (all.length ? Math.round(all[Math.floor(all.length * p)]) : 0);
  return { quarters, n: all.length, med: Math.round(med(all)), p75: pct(0.75), p90: pct(0.9), over300: all.filter((u) => u >= 300).length };
}

// ---- 図1: 総額の解剖(積み上げ+売主の期待) ----
// ラベルは縦3段(y=14売出 / y=30市場水準 / y=46建物)に分離し重なりを防ぐ
function anatomySvg(v) {
  const W = 640, barY = 58, barH = 30, axisY = 104;
  const max = Math.max(v.ask, v.fairHi) * 1.06;
  const X = (val) => 24 + (val / max) * 592;
  const el = [];
  // 目盛(1000万刻み)
  for (let m = 0; m <= max; m += 1000) {
    const x = X(m);
    el.push(`<line x1="${x}" y1="${axisY}" x2="${x}" y2="${axisY + 5}" stroke="#43566B" stroke-width="1"/>`);
    el.push(`<text x="${x}" y="${axisY + 17}" font-size="9" text-anchor="middle" fill="#43566B" font-family="monospace">${m / 1000 > 0 ? (m / 1000) + "千万" : "0"}</text>`);
  }
  el.push(`<line x1="24" y1="${axisY}" x2="616" y2="${axisY}" stroke="#16232E" stroke-width="1"/>`);
  // 積み上げバー: 土地 + 建物 = 市場水準(リテール中央値)
  el.push(`<rect x="${X(0)}" y="${barY}" width="${X(v.landPart) - X(0)}" height="${barH}" fill="#2E6E8E"/>`);
  el.push(`<text x="${X(v.landPart / 2)}" y="${barY + 19}" font-size="11" font-weight="700" text-anchor="middle" fill="#FFFFFF">土地 ${fmtMan(Math.round(v.landPart))}</text>`);
  el.push(`<rect x="${X(v.landPart)}" y="${barY}" width="${X(v.landPart + v.bldg) - X(v.landPart)}" height="${barH}" fill="#B07C10"/>`);
  const bcx = X(v.landPart + v.bldg / 2);
  el.push(`<text x="${bcx}" y="46" font-size="10" text-anchor="middle" fill="#B07C10">建物 ${fmtMan(Math.round(v.bldg))}</text>`);
  el.push(`<line x1="${bcx}" y1="49" x2="${bcx}" y2="${barY}" stroke="#B07C10" stroke-width="1"/>`);
  // 売主の期待(市場水準→売出)。幅が狭いため差額のみバー内に表記(全文は図下の注記)
  const gx0 = X(v.retailMid), gx1 = X(v.ask);
  el.push(`<rect x="${gx0}" y="${barY}" width="${Math.max(2, gx1 - gx0)}" height="${barH}" fill="#C93A2B" opacity="0.14" stroke="#C93A2B" stroke-width="1.2" stroke-dasharray="5,3"/>`);
  el.push(`<text x="${(gx0 + gx1) / 2}" y="${barY + 19}" font-size="10" font-weight="700" text-anchor="middle" fill="#C93A2B">+${fmtMan(Math.round(v.ask - v.retailMid))}</text>`);
  // 市場水準・売出・適正レンジのマーカー(各ラベルは専用の段)
  el.push(`<line x1="${gx0}" y1="33" x2="${gx0}" y2="${axisY}" stroke="#16232E" stroke-width="1.2"/>`);
  el.push(`<text x="${gx0}" y="30" font-size="10" text-anchor="middle" fill="#16232E">市場水準 ${fmtMan(Math.round(v.retailMid))}</text>`);
  el.push(`<line x1="${X(v.ask)}" y1="27" x2="${X(v.ask)}" y2="${axisY}" stroke="#C93A2B" stroke-width="2"/>`);
  el.push(`<polygon points="${X(v.ask) - 5},18 ${X(v.ask) + 5},18 ${X(v.ask)},27" fill="#C93A2B"/>`);
  el.push(`<text x="${X(v.ask)}" y="14" font-size="11.5" font-weight="700" text-anchor="middle" fill="#C93A2B">売出 ${fmtMan(Math.round(v.ask))}</text>`);
  const fy = axisY + 26;
  el.push(`<rect x="${X(v.fairLo)}" y="${fy}" width="${Math.max(2, X(v.fairHi) - X(v.fairLo))}" height="10" fill="#BFD7E4"/>`);
  el.push(`<line x1="${X(v.fairMid)}" y1="${fy - 3}" x2="${X(v.fairMid)}" y2="${fy + 13}" stroke="#16232E" stroke-width="1.4"/>`);
  el.push(`<text x="24" y="${fy + 24}" font-size="9.5" fill="#43566B">適正レンジ ${fmtMan(Math.round(v.fairLo))}〜${fmtMan(Math.round(v.fairHi))}(中央 ${fmtMan(Math.round(v.fairMid))} = 原価法との重み付き)</text>`);
  return `<svg viewBox="0 0 ${W} 162" role="img" aria-label="総額の分解: 土地+建物+売主の期待" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 図2: 土地坪単価の物差し(素の単価・2025年1月基準) ----
// ラベルは上2段(y28/46)+下2段(y136/150)に明示配置し、重なり・見切れを防ぐ
function pptGaugeSvg(g) {
  const W = 640, axisY = 104, MIN = 80, MAX = 310;
  const X = (v) => 24 + ((v - MIN) / (MAX - MIN)) * 592;
  const el = [];
  for (let m = 100; m <= 300; m += 50) {
    el.push(`<line x1="${X(m)}" y1="${axisY}" x2="${X(m)}" y2="${axisY + 5}" stroke="#43566B" stroke-width="1"/>`);
    el.push(`<text x="${X(m)}" y="${axisY + 17}" font-size="9" text-anchor="middle" fill="#43566B" font-family="monospace">${m}万</text>`);
  }
  el.push(`<line x1="24" y1="${axisY}" x2="616" y2="${axisY}" stroke="#16232E" stroke-width="1"/>`);
  // 経験則帯(公示×1.1〜1.2)
  const bx0 = X(g.ruleLo), bx1 = X(g.ruleHi);
  el.push(`<rect x="${bx0}" y="${axisY - 34}" width="${bx1 - bx0}" height="34" fill="#BFD7E4" opacity="0.75"/>`);
  el.push(`<text x="${(bx0 + bx1) / 2}" y="${axisY - 40}" font-size="9.5" text-anchor="middle" fill="#2E6E8E">経験則 公示×1.1〜1.2</text>`);
  const pin = (v, label, color, ly, { bold = false, anchor = "middle", tx = null } = {}) => {
    const x = X(v);
    const yA = ly < axisY ? ly + 4 : axisY + 8, yB = ly < axisY ? axisY : ly - 9;
    el.push(`<line x1="${x}" y1="${yA}" x2="${x}" y2="${yB}" stroke="${color}" stroke-width="1" stroke-dasharray="2,2"/>`);
    el.push(`<circle cx="${x}" cy="${axisY}" r="4" fill="${color}"/>`);
    el.push(`<text x="${tx ?? x}" y="${ly}" font-size="${bold ? 10.5 : 9.5}" ${bold ? 'font-weight="700"' : ""} text-anchor="${anchor}" fill="${color}">${label}</text>`);
  };
  // 個別成約の帯と左端寄せラベル(下段2)
  el.push(`<rect x="${X(g.dealLo)}" y="${axisY - 3}" width="${X(g.dealHi) - X(g.dealLo)}" height="6" fill="#43566B" opacity="0.5"/>`);
  el.push(`<text x="26" y="150" font-size="9.5" text-anchor="start" fill="#43566B">個別成約 ${g.dealLo}〜${g.dealHi}(極小地・業者仕入れ)</text>`);
  pin(g.mixedAvg, `混合平均 ${g.mixedAvg}(31件)`, "#43566B", 28);
  pin(g.configured, `初期推定 ${g.configured}(公示×${(g.configured / g.koji).toFixed(2)})`, "#B07C10", 28);
  pin(g.koji, `公示地価 ${g.koji}`, "#16232E", 46, { bold: true });
  pin(g.rule15, `×1.5なら ${g.rule15} ← 観測なし`, "#C93A2B", 46, { anchor: "end", tx: 616 });
  pin(g.cal, `成約較正 ${g.cal}`, "#2E6E8E", 136, { bold: true });
  pin(g.adopted, `採用 ${g.adopted}`, "#2C6E49", 150, { bold: true });
  return `<svg viewBox="0 0 ${W} 158" role="img" aria-label="土地坪単価の物差し" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 図3: 建物残価の築年カーブ ----
function bldgCurveSvg(c) {
  const W = 640, H = 210, padL = 50, padB = 30, padT = 14;
  const yMax = Math.max(2600, c.atNew * 1.05);
  const X = (age) => padL + (age / 30) * (W - padL - 16);
  const Y = (v) => padT + (1 - v / yMax) * (H - padT - padB);
  const val = (a) => Math.max(0, c.rebuild * c.floorTsubo * Math.max(0, 1 - a / COEFFS.BUILDING_LIFE_Y) * (1 + c.bm)
    - Math.min(c.repairCap, RETAIL.REPAIR_PER_YEAR * a));
  // リフォーム・大規模修繕済み(繰延修繕の控除なし)の上側カーブ
  const valFull = (a) => Math.max(0, c.rebuild * c.floorTsubo * Math.max(0, 1 - a / COEFFS.BUILDING_LIFE_Y) * (1 + c.bm));
  const el = [];
  for (let m = 0; m <= yMax; m += 500) {
    el.push(`<line x1="${padL}" y1="${Y(m)}" x2="${W - 16}" y2="${Y(m)}" stroke="#DCE3EA" stroke-width="1"/>`);
    el.push(`<text x="${padL - 6}" y="${Y(m) + 3}" font-size="9" text-anchor="end" fill="#43566B" font-family="monospace">${m}万</text>`);
  }
  for (let a = 0; a <= 30; a += 5) {
    el.push(`<text x="${X(a)}" y="${H - padB + 16}" font-size="9" text-anchor="middle" fill="#43566B" font-family="monospace">築${a}年</text>`);
  }
  el.push(`<line x1="${padL}" y1="${H - padB}" x2="${W - 16}" y2="${H - padB}" stroke="#16232E" stroke-width="1"/>`);
  // 上側: リフォーム済みカーブ(破線)
  const ptsF = [];
  for (let a = 0; a <= 30; a += 0.25) ptsF.push(`${X(a).toFixed(1)},${Y(valFull(a)).toFixed(1)}`);
  el.push(`<polyline points="${ptsF.join(" ")}" fill="none" stroke="#2E6E8E" stroke-width="1.8" stroke-dasharray="6,4"/>`);
  // 下側: 未修繕(現況)カーブ(実線)。曲線への直接ラベルはやめ、右上に凡例2行で表示(重なり防止)
  const pts = [];
  for (let a = 0; a <= 30; a += 0.25) pts.push(`${X(a).toFixed(1)},${Y(val(a)).toFixed(1)}`);
  el.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="#B07C10" stroke-width="2.5"/>`);
  el.push(`<text x="${W - 18}" y="20" font-size="9.5" text-anchor="end"><tspan fill="#B07C10">━ 実線: 未修繕(繰延修繕を控除)</tspan><tspan fill="#2E6E8E">　┅ 破線: 修繕・リフォーム済み(控除なし)</tspan></text>`);
  for (const m of [0, 5, 10]) {
    el.push(`<circle cx="${X(m)}" cy="${Y(val(m))}" r="3.5" fill="#B07C10"/>`);
    el.push(`<text x="${X(m) + 6}" y="${Y(val(m)) - 7}" font-size="9.5" fill="#43566B">築${m}: ${Math.round(val(m))}万</text>`);
  }
  // 対象物件とゼロ着地。リフォーム状態の差を両カーブ間の縦矢印で示す
  el.push(`<line x1="${X(c.age)}" y1="${Y(val(c.age))}" x2="${X(c.age)}" y2="${H - padB}" stroke="#C93A2B" stroke-width="1.4" stroke-dasharray="4,3"/>`);
  el.push(`<line x1="${X(c.age)}" y1="${Y(valFull(c.age))}" x2="${X(c.age)}" y2="${Y(val(c.age))}" stroke="#2C6E49" stroke-width="1.6"/>`);
  el.push(`<polygon points="${X(c.age) - 4},${Y(valFull(c.age)) + 7} ${X(c.age) + 4},${Y(valFull(c.age)) + 7} ${X(c.age)},${Y(valFull(c.age)) + 1}" fill="#2C6E49"/>`);
  el.push(`<circle cx="${X(c.age)}" cy="${Y(valFull(c.age))}" r="4" fill="#2E6E8E"/>`);
  el.push(`<text x="${X(c.age) + 7}" y="${Y(valFull(c.age)) - 6}" font-size="10" font-weight="700" fill="#2E6E8E">修繕済みなら ${Math.round(valFull(c.age))}万</text>`);
  el.push(`<text x="${X(c.age) + 7}" y="${(Y(valFull(c.age)) + Y(val(c.age))) / 2 + 4}" font-size="9.5" font-weight="700" fill="#2C6E49">リフォームで埋まる差 ${Math.round(valFull(c.age) - val(c.age))}万</text>`);
  el.push(`<circle cx="${X(c.age)}" cy="${Y(val(c.age))}" r="4.5" fill="#C93A2B"/>`);
  el.push(`<text x="${X(c.age) + 7}" y="${Y(val(c.age)) + 14}" font-size="10.5" font-weight="700" fill="#C93A2B">本物件(未修繕) 築${c.age.toFixed(1)}年: ${Math.round(val(c.age))}万</text>`);
  let zeroAge = 30;
  for (let a = 0; a <= 30; a += 0.05) if (val(a) <= 0) { zeroAge = a; break; }
  el.push(`<text x="${W - 18}" y="${H - padB - 8}" font-size="9.5" text-anchor="end" fill="#43566B">築${zeroAge.toFixed(0)}年前後でゼロ着地(税法22年とほぼ一致)</text>`);
  el.push(`<text x="${W - 18}" y="40" font-size="9.5" text-anchor="end" fill="#B07C10">未修繕の減少ペース ≒ 年${Math.round(c.rebuild * c.floorTsubo * (1 + c.bm) / 30 + RETAIL.REPAIR_PER_YEAR)}万(償却+修繕負債の積み上がり)</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="建物残価の築年カーブ" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 図-1: 意思決定の二軸(データ軸×満足軸の四象限) ----
function decisionAxesSvg(d) {
  const W = 640, H = 292, x0 = 70, x1 = 610, y0 = 30, y1 = 250;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const el = [];
  // 象限の面(右上=買い / 左上=危険地帯 / 右下=条件次第 / 左下=論外)
  el.push(`<rect x="${cx}" y="${y0}" width="${x1 - cx}" height="${cy - y0}" fill="#2C6E49" opacity="0.08"/>`);
  el.push(`<rect x="${x0}" y="${y0}" width="${cx - x0}" height="${cy - y0}" fill="#C93A2B" opacity="0.07"/>`);
  el.push(`<rect x="${cx}" y="${cy}" width="${x1 - cx}" height="${y1 - cy}" fill="#2E6E8E" opacity="0.06"/>`);
  el.push(`<rect x="${x0}" y="${cy}" width="${cx - x0}" height="${y1 - cy}" fill="#43566B" opacity="0.10"/>`);
  // 軸
  el.push(`<line x1="${x0}" y1="${cy}" x2="${x1}" y2="${cy}" stroke="#16232E" stroke-width="1.4"/>`);
  el.push(`<line x1="${cx}" y1="${y0}" x2="${cx}" y2="${y1}" stroke="#16232E" stroke-width="1.4"/>`);
  el.push(`<text x="${x1}" y="${cy - 8}" font-size="10" font-weight="700" text-anchor="end" fill="#16232E">割安 →</text>`);
  el.push(`<text x="${x0}" y="${cy - 8}" font-size="10" font-weight="700" text-anchor="start" fill="#16232E">← 割高</text>`);
  el.push(`<text x="${cx}" y="${y0 - 8}" font-size="10" font-weight="700" text-anchor="middle" fill="#16232E">満足 高(判定できるのは自分だけ)</text>`);
  el.push(`<text x="${cx}" y="${y1 + 16}" font-size="10" text-anchor="middle" fill="#43566B">満足 低</text>`);
  // 象限ラベル
  const q = (x, y, l1, l2, color, bold = true) => {
    el.push(`<text x="${x}" y="${y}" font-size="10.5" ${bold ? 'font-weight="700"' : ""} text-anchor="middle" fill="${color}">${l1}</text>`);
    el.push(`<text x="${x}" y="${y + 15}" font-size="9" text-anchor="middle" fill="${color}">${l2}</text>`);
  };
  q((cx + x1) / 2, 62, "割安 × 満足高", "迷わず買い", "#2C6E49");
  q((x0 + cx) / 2 - 20, 62, "割高 × 満足高", "満足プレミアム上限内のみ可 ── 営業の狩場", "#C93A2B");
  q((cx + x1) / 2, 210, "割安 × 満足低", "住まないなら買わない(投資は別基準)", "#2E6E8E");
  q((x0 + cx) / 2 - 20, 210, "割高 × 満足低", "論外", "#43566B");
  // 満足プレミアム上限(左上象限内の縦破線)
  const px = cx - 62;
  el.push(`<line x1="${px}" y1="${y0 + 62}" x2="${px}" y2="${cy}" stroke="#C93A2B" stroke-width="1.4" stroke-dasharray="5,3"/>`);
  el.push(`<text x="${px}" y="${y0 + 56}" font-size="9" text-anchor="middle" fill="#C93A2B">満足プレミアム上限(事前に自分で決める)</text>`);
  el.push(`<text x="${px - 6}" y="${cy - 10}" font-size="8.5" text-anchor="end" fill="#C93A2B">これより左は満足が高くても降りる</text>`);
  // 営業トークの矢印(縦位置の錯覚)
  const axx = x0 + 24;
  el.push(`<line x1="${axx}" y1="${y1 - 28}" x2="${axx}" y2="${y0 + 66}" stroke="#B07C10" stroke-width="1.6" stroke-dasharray="4,3"/>`);
  el.push(`<polygon points="${axx - 4},${y0 + 70} ${axx + 4},${y0 + 70} ${axx},${y0 + 62}" fill="#B07C10"/>`);
  el.push(`<text x="${axx + 8}" y="${cy + 46}" font-size="8.5" fill="#B07C10">感情トークは縦位置の</text>`);
  el.push(`<text x="${axx + 8}" y="${cy + 58}" font-size="8.5" fill="#B07C10">錯覚を作る(価格は不動)</text>`);
  // データ軸上の実例(横位置=台帳の計算値、縦位置は読者が置く)
  if (d) {
    el.push(`<circle cx="150" cy="${cy}" r="5" fill="#C93A2B"/>`);
    el.push(`<text x="150" y="${cy + 20}" font-size="9" text-anchor="middle" fill="#C93A2B">売出 ${fmtMan(d.ask)}</text>`);
    el.push(`<circle cx="${cx - 12}" cy="${cy}" r="5" fill="#2C6E49"/>`);
    el.push(`<text x="${cx - 12}" y="${cy + 20}" font-size="9" text-anchor="middle" fill="#2C6E49">指値 ${fmtMan(d.bidLo)}〜${fmtMan(d.bidHi)}</text>`);
  }
  el.push(`<text x="${x1}" y="${H - 6}" font-size="9" text-anchor="end" fill="#43566B">横位置(データ軸)は台帳が計算する ／ 縦位置(満足軸)はあなたにしか置けない</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="意思決定の二軸: データ(割安か)×満足" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 図0: 一般形 ── 価格形成の模式図(特定物件に依存しない) ----
function genericSvg() {
  const W = 640, barY = 52, barH = 38, x0 = 24, x1 = 616;
  const seg = (a, b) => [x0 + (x1 - x0) * a, (x1 - x0) * (b - a)];
  const [lx, lw] = seg(0, 0.60);
  const [bx, bw] = seg(0.60, 0.78);
  const [ex, ew] = seg(0.78, 0.95);
  const el = [];
  // 土地(青): 価値の土台。残る資産
  el.push(`<rect x="${lx}" y="${barY}" width="${lw}" height="${barH}" fill="#2E6E8E"/>`);
  el.push(`<text x="${lx + lw / 2}" y="${barY + 17}" font-size="12" font-weight="700" text-anchor="middle" fill="#FFFFFF">土地</text>`);
  el.push(`<text x="${lx + lw / 2}" y="${barY + 31}" font-size="9.5" text-anchor="middle" fill="#DCE8F0">実勢単価 × 土地坪数 × 個別補正</text>`);
  // 建物(琥珀): 築年で消える部分
  el.push(`<rect x="${bx}" y="${barY}" width="${bw}" height="${barH}" fill="#B07C10"/>`);
  el.push(`<text x="${bx + bw / 2}" y="${barY + 17}" font-size="11" font-weight="700" text-anchor="middle" fill="#FFFFFF">建物残価</text>`);
  el.push(`<text x="${bx + bw / 2}" y="${barY + 31}" font-size="9" text-anchor="middle" fill="#F2E4C4">再調達×残存率−修繕</text>`);
  // 売主の期待(赤点線): 交渉で削る部分
  el.push(`<rect x="${ex}" y="${barY}" width="${ew}" height="${barH}" fill="#C93A2B" opacity="0.13" stroke="#C93A2B" stroke-width="1.4" stroke-dasharray="6,3"/>`);
  el.push(`<text x="${ex + ew / 2}" y="${barY + 17}" font-size="11" font-weight="700" text-anchor="middle" fill="#C93A2B">売主の期待</text>`);
  el.push(`<text x="${ex + ew / 2}" y="${barY + 31}" font-size="9" text-anchor="middle" fill="#C93A2B">査定インフレ+希望</text>`);
  // 上側マーカー: 成約価格の見込み / 売出価格
  const mx = ex, ax = ex + ew;
  el.push(`<line x1="${mx}" y1="${barY - 22}" x2="${mx}" y2="${barY + barH}" stroke="#16232E" stroke-width="1.4"/>`);
  el.push(`<text x="${mx - 8}" y="${barY - 27}" font-size="10.5" font-weight="700" text-anchor="end" fill="#16232E">成約価格の見込み(=市場水準)</text>`);
  el.push(`<line x1="${ax}" y1="${barY - 6}" x2="${ax}" y2="${barY + barH}" stroke="#C93A2B" stroke-width="2"/>`);
  el.push(`<polygon points="${ax - 5},${barY - 14} ${ax + 5},${barY - 14} ${ax},${barY - 5}" fill="#C93A2B"/>`);
  el.push(`<text x="${ax - 2}" y="${barY - 18}" font-size="10.5" font-weight="700" text-anchor="end" fill="#C93A2B">売出価格</text>`);
  // 下側注記: 行を2段に分けて重なりを防ぐ(1段目=左2区分の性質、2段目=右の交渉区間)
  const y2 = barY + barH + 16;
  el.push(`<path d="M ${ax} ${barY + barH + 4} L ${ax} ${y2} L ${mx} ${y2} L ${mx} ${barY + barH + 4}" fill="none" stroke="#C93A2B" stroke-width="1" stroke-dasharray="3,2"/>`);
  el.push(`<text x="${lx + lw / 2}" y="${y2 + 14}" font-size="9.5" text-anchor="middle" fill="#43566B">解体しても残る価値(下値フロアの源泉)</text>`);
  el.push(`<text x="${bx + bw / 2}" y="${y2 + 14}" font-size="9.5" text-anchor="middle" fill="#B07C10">住みながら消費する価値</text>`);
  el.push(`<text x="${x1}" y="${y2 + 30}" font-size="9.5" text-anchor="end" fill="#C93A2B">↑ 値下げ・指値交渉で削られていく区間</text>`);
  return `<svg viewBox="0 0 ${W} 158" role="img" aria-label="価格形成の一般形: 土地+建物+売主の期待" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 図0b: 築年帯で構成比がどう変わるか(総額≒土地×係数の暗算式を可視化) ----
function ageBarsSvg() {
  const W = 640, x0 = 150, unit = 240;   // 土地=unit px で固定し、建物比率で伸びを変える
  const rows = [
    { label: "築5年", bldg: 0.34, note: "総額 ≒ 土地×1.34" },
    { label: "築15年", bldg: 0.13, note: "総額 ≒ 土地×1.13" },
    { label: "築25年〜", bldg: 0.0, note: "総額 ≒ 土地×1.0(土地値買い)" },
  ];
  const el = [];
  rows.forEach((r0, i) => {
    const y = 18 + i * 42, h = 24;
    el.push(`<text x="${x0 - 10}" y="${y + 16}" font-size="10.5" text-anchor="end" fill="#16232E">${r0.label}</text>`);
    el.push(`<rect x="${x0}" y="${y}" width="${unit}" height="${h}" fill="#2E6E8E"/>`);
    if (r0.bldg > 0) el.push(`<rect x="${x0 + unit}" y="${y}" width="${unit * r0.bldg}" height="${h}" fill="#B07C10"/>`);
    const ex = x0 + unit * (1 + r0.bldg);
    el.push(`<rect x="${ex}" y="${y}" width="${unit * 0.11}" height="${h}" fill="#C93A2B" opacity="0.13" stroke="#C93A2B" stroke-width="1" stroke-dasharray="4,2"/>`);
    el.push(`<text x="${ex + unit * 0.11 + 8}" y="${y + 16}" font-size="9.5" fill="#43566B">${r0.note}</text>`);
  });
  el.push(`<text x="${x0}" y="${18 + 3 * 42 + 4}" font-size="9" fill="#43566B">■土地(同じ土地なら一定) ■建物残価(築年で縮む) ▨売主の期待(築年と無関係に乗る)</text>`);
  return `<svg viewBox="0 0 ${W} 152" role="img" aria-label="築年帯による価格構成の変化" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 変数辞典: 成約事例・売出情報のどこを見るか ----
function variableDictHtml() {
  const rows = [
    ["成約価格・成約年月", "分子と時点修正の基準", "年月がないと時点修正できず、上昇局面では古い事例ほど過小評価になる。四半期単位で記録する",
      "quarter列。年次別上昇率(2024:+9%・2025:+12%・2026:+6%想定)で基準日へ補正"],
    ["土地面積(公簿/実測、私道負担の内外)", "分母", "<b>私道負担・セットバック込みの面積で割ると単価が過小に出る</b>。逆に対象物件を公簿のまま計算すると過大評価。実測(確定測量)の有無で数%動く",
      "対象=登記面積−セットバック(有効宅地)。事例側は内外不明→単価がやや低めに出る事例が混入(保守側の誤差)"],
    ["建物延床面積・構造・築年月", "建物残価控除の3変数", "延床に車庫・小屋裏を含むかで坪単価が振れる。構造(木造/S/RC/混構造)で再調達単価と寿命が変わる。築年月は残存率の起点",
      "再調達95万/坪(木造)×(1−築年/30)−繰延修繕。構造はデータに列がなく木造想定──混構造・RCは個別上書き"],
    ["接道の方位・幅員・公私道別・間口、土地形状、高低差", "個別補正(±数%〜−25%)", "図面があれば旗竿・不整形は一目で判定できる。南面・広幅員・整形は上振れ、旗竿・狭間口・高低差(擁壁)は下振れ。<b>崖・擁壁は検査済証の有無まで確認</b>",
      "対象=YAMLのdir/roadq/shape/extra。事例側は観測不能→形状補正は半減適用(混入分との二重減価回避)"],
    ["用途地域・建ぺい率・容積率、再建築可否、セットバック要否", "土地の法的スペック差", "容積率が違う事例と比べると単価がズレる(商業系ほど高い)。<b>再建築不可は別の市場</b>(現金・投資家のみ、−3〜5割)。42条2項道路はセットバック分の面積減",
      "対象=zoning/bcr/far/rebuildable。再建築不可は両手法に大減価が伝搬。事例側は不明→分布(四分位)に吸収"],
    ["備考欄(リフォーム歴・告知事項・隣地関係)", "建物残価と個別補正の前提を変える", "<b>残価前提を変える情報はここに出る</b>。大規模修繕済みなら残価+数百万、心理的瑕疵・越境・隣地紛争は価格外の減点。成約事例側の備考はレインズでしか見えない",
      "データに列なし→全事例「年式相応の未修繕」と対称仮定。上の建物パネルの2本カーブの差がこの影響量"],
    ["駅徒歩(時間距離)", "個別補正(±1.2%/分)", "実測の徒歩分数(80m/分)か、バス便かを確認。複数路線はプラス材料だが事例側の駅属性は通常不明",
      "徒歩10分標準へ正規化(発散防止のため±の頭打ちあり)。事例=データのwalk_min、30分超は除外"],
    ["権利形態(所有権/借地権)", "土地部分の係数(借地は×0.4〜0.6)", "借地権・底地は所有権と別の市場。地代・更新料・譲渡承諾の条件で大きく変わる",
      "所有権のみ査定対象。借地はlc係数で減額の上、参考扱い"],
  ];
  return `<div style="overflow-x:auto"><table class="list">
    <tr><th>変数</th><th>式のどこに効くか</th><th>見るポイント(誤差の向き)</th><th>本モデルでの扱い</th></tr>
    ${rows.map(([a, b, c, d]) => `<tr><td style="white-space:normal;min-width:120px"><b>${a}</b></td><td style="white-space:normal;min-width:90px">${b}</td><td style="white-space:normal;font-size:.78rem">${c}</td><td style="white-space:normal;font-size:.78rem;color:var(--ink-soft)">${d}</td></tr>`).join("")}
  </table></div>`;
}

// 建物残価(万円)。repaired=true なら繰延修繕の控除なし(カーブ・早見表・実例で共通)
function bldgResid(cfg, age, repaired) {
  const base = cfg.rebuild * cfg.floorTsubo * Math.max(0, 1 - age / COEFFS.BUILDING_LIFE_Y) * (1 + cfg.bm);
  const rep = repaired ? 0 : Math.min(cfg.repairCap, RETAIL.REPAIR_PER_YEAR * age);
  return Math.max(0, base - rep);
}

// ---- 早見表: 実際何年だったら残価いくらか ----
function bldgTableHtml(cfg, subjectAge, landPartExample) {
  const ages = [0, 5, 10, 15, 20, 25, 30].filter((a) => Math.abs(a - subjectAge) > 0.6);
  const all = [...ages, subjectAge].sort((a, b) => a - b);
  const rows = all.map((a) => {
    const isSubj = a === subjectAge;
    const un = bldgResid(cfg, a, false), full = bldgResid(cfg, a, true);
    const total = landPartExample + un;
    return `<tr${isSubj ? ' style="background:#F4E9DA;font-weight:700"' : ""}>
      <td>築${isSubj ? a.toFixed(1) + "年(本物件)" : a + "年"}</td>
      <td class="num">${Math.max(0, (1 - a / COEFFS.BUILDING_LIFE_Y) * 100).toFixed(0)}%</td>
      <td class="num">${fmtMan(Math.round(un))}</td>
      <td class="num">${fmtMan(Math.round(full))}</td>
      <td class="num">${fmtMan(Math.round(total))}</td>
      <td class="num">×${((total) / landPartExample).toFixed(2)}</td>
    </tr>`;
  }).join("");
  return `<div style="overflow-x:auto;margin-top:12px"><table class="list">
    <tr><th>築年数</th><th>残存率</th><th>建物残価(未修繕)</th><th>同(修繕・リフォーム済)</th><th>総額のめやす※</th><th>対土地倍率</th></tr>
    ${rows}
  </table></div>
  <div class="note" style="margin-top:6px">※ 土地部分を実例の${fmtMan(Math.round(landPartExample))}に固定し、<b>築年数だけを動かした場合の総額(未修繕)</b>。延床${cfg.floorTsubo.toFixed(1)}坪・木造(再調達${cfg.rebuild}万/坪)の場合で、延床が変われば建物側は比例して増減する。</div>`;
}

// ---- シミュレーター: 変数を入れると総額がその場で変わる ----
function simulatorHtml(d) {
  const inp = 'style="font-family:var(--mono);font-size:.85rem;padding:5px 7px;border:1px solid var(--ink-soft);width:110px;background:#FDFDFC"';
  const lbl = 'style="font-size:.72rem;color:var(--ink-soft);display:block;margin-bottom:3px;letter-spacing:.05em"';
  return `
    <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end">
      <div><span ${lbl}>土地面積(m²)</span><input id="sim-land" type="number" step="0.01" value="${d.landM2}" ${inp}><span id="sim-land-t" class="note" style="margin:2px 0 0;display:block"></span></div>
      <div><span ${lbl}>土地実勢単価(万/坪・残余)</span><input id="sim-unit" type="number" step="1" value="${d.unit}" ${inp}>
        <div style="margin-top:4px;display:flex;gap:4px">
          <button type="button" class="sim-preset" data-v="${d.unitRawMed}" style="font-size:.68rem;padding:2px 6px;cursor:pointer">実績${d.unitRawMed}</button>
          <button type="button" class="sim-preset" data-v="${d.unit}" style="font-size:.68rem;padding:2px 6px;cursor:pointer">中央値${d.unit}</button>
          <button type="button" class="sim-preset" data-v="${d.unitP90}" style="font-size:.68rem;padding:2px 6px;cursor:pointer">上位${d.unitP90}</button>
        </div></div>
      <div><span ${lbl}>延床面積(m²)</span><input id="sim-floor" type="number" step="0.01" value="${d.floorM2}" ${inp}><span id="sim-floor-t" class="note" style="margin:2px 0 0;display:block"></span></div>
      <div><span ${lbl}>個別補正(%)</span><input id="sim-adj" type="number" step="1" min="-30" max="10" value="0" ${inp}></div>
      <div><span ${lbl}>修繕状態</span><select id="sim-repair" ${inp.replace('width:110px', 'width:150px')}><option value="none">未修繕(築年相応控除)</option><option value="done">大規模修繕・リフォーム済</option></select></div>
      <div><span ${lbl}>売出価格(万円)</span><input id="sim-ask" type="number" step="10" value="${d.ask}" ${inp}></div>
    </div>
    <div style="margin-top:16px">
      <span style="font-size:.78rem;color:var(--ink-soft);letter-spacing:.05em">築年数(スライダーを動かして体感): <b id="sim-age-v" style="font-family:var(--mono);color:var(--ink);font-size:.95rem"></b></span>
      <input id="sim-age" type="range" min="0" max="35" step="1" value="${d.age}" style="width:100%;accent-color:#B07C10">
    </div>
    <div id="sim-bar" style="position:relative;height:42px;border:1px solid var(--ink);background:#FDFDFC;margin-top:14px;overflow:hidden">
      <div id="seg-land" style="position:absolute;left:0;top:0;bottom:0;background:#2E6E8E"></div>
      <div id="seg-bldg" style="position:absolute;top:0;bottom:0;background:#B07C10"></div>
      <div id="seg-exp" style="position:absolute;top:0;bottom:0;background:rgba(201,58,43,.13);border-left:none;border:1.5px dashed #C93A2B;box-sizing:border-box"></div>
      <div id="seg-ask" style="position:absolute;top:0;bottom:0;width:2px;background:#C93A2B"></div>
    </div>
    <div id="sim-out" style="font-family:var(--mono);font-size:.85rem;margin-top:10px;line-height:1.9"></div>
    <script>
    (function () {
      var el = function (id) { return document.getElementById(id); };
      var fmt = function (n) { return Math.round(n).toLocaleString('en-US') + '万'; };
      var T = ${COEFFS.TSUBO_M2}, REBUILD = ${COEFFS.DEFAULT_REBUILD_PPT}, LIFE = ${COEFFS.BUILDING_LIFE_Y};
      var BM = ${(1 + d.bm).toFixed(2)}, REPCAP = ${Math.round(d.repairCap)}, REPYR = ${RETAIL.REPAIR_PER_YEAR};
      function calc() {
        var landM2 = parseFloat(el('sim-land').value) || 0;
        var unit = parseFloat(el('sim-unit').value) || 0;
        var floorM2 = parseFloat(el('sim-floor').value) || 0;
        var age = parseFloat(el('sim-age').value) || 0;
        var repaired = el('sim-repair').value === 'done';
        var adj = (parseFloat(el('sim-adj').value) || 0) / 100;
        var ask = parseFloat(el('sim-ask').value) || 0;
        var landTsubo = landM2 / T, floorTsubo = floorM2 / T;
        var base = REBUILD * floorTsubo * Math.max(0, 1 - age / LIFE) * BM;
        var rep = repaired ? 0 : Math.min(REPCAP, REPYR * age);
        var bldg = Math.max(0, base - rep);
        var land = unit * landTsubo * (1 + adj);
        var total = land + bldg;
        var scale = Math.max(total, ask, 1) * 1.05;
        el('seg-land').style.width = (100 * land / scale) + '%';
        el('seg-bldg').style.left = (100 * land / scale) + '%';
        el('seg-bldg').style.width = (100 * bldg / scale) + '%';
        var hasExp = ask > total;
        el('seg-exp').style.display = hasExp ? 'block' : 'none';
        if (hasExp) {
          el('seg-exp').style.left = (100 * total / scale) + '%';
          el('seg-exp').style.width = (100 * (ask - total) / scale) + '%';
        }
        el('seg-ask').style.left = 'calc(' + (100 * ask / scale) + '% - 1px)';
        el('seg-ask').style.display = ask > 0 ? 'block' : 'none';
        el('sim-age-v').textContent = '築' + age + '年';
        el('sim-land-t').textContent = '= ' + landTsubo.toFixed(1) + '坪';
        el('sim-floor-t').textContent = '= ' + floorTsubo.toFixed(1) + '坪';
        var line1 = '<span style="color:#2E6E8E">■土地 ' + fmt(land) + '</span> + <span style="color:#B07C10">■建物残価 ' + fmt(bldg) + '</span>' +
          (repaired ? '(修繕済)' : '(未修繕・控除' + fmt(rep) + ')') +
          ' = <b>成約価格の見込み ' + fmt(total) + '</b>';
        var line2 = '';
        if (ask > 0) {
          var gap = ask - total;
          if (gap > 0) line2 = '<span style="color:#C93A2B">売出 ' + fmt(ask) + ' との差 = 売主の期待 +' + fmt(gap) + '(見込み比 +' + (100 * gap / total).toFixed(1) + '%)</span>';
          else line2 = '<span style="color:#2C6E49">売出 ' + fmt(ask) + ' は見込みを ' + fmt(-gap) + ' 下回る(理論上は割安圏──理由の確認を)</span>';
        }
        el('sim-out').innerHTML = line1 + '<br>' + line2;
      }
      var ids = ['sim-land', 'sim-unit', 'sim-floor', 'sim-age', 'sim-repair', 'sim-adj', 'sim-ask'];
      for (var i = 0; i < ids.length; i++) el(ids[i]).addEventListener('input', calc);
      var ps = document.getElementsByClassName('sim-preset');
      for (var j = 0; j < ps.length; j++) ps[j].addEventListener('click', function (e) {
        el('sim-unit').value = e.target.getAttribute('data-v'); calc();
      });
      calc();
    })();
    </script>`;
}

export function renderFormula({ r, rRef, property }, calArea, houseDeals) {
  const rt = r.retail;
  const s = r.state;
  const landTsubo = r.mid.tsubo;
  const floorTsubo = s.floor / COEFFS.TSUBO_M2;
  const district = districtOf(property.location?.address) ?? "—";
  const raw = rawResidualStats(houseDeals, district);
  const bench = calArea?.benches?.[0] ?? null;
  const dealPpts = (calArea?.deals?.rows ?? []).map((d) => Math.round(d.ppt_norm)).sort((a, b) => a - b);
  const askUnitResid = Math.round((s.ask - rt.bldgSubj) / (landTsubo * rt.subjectFactor));
  const midUnitResid = Math.round(rt.unitMid);
  const quarterRows = raw.quarters.map((q) =>
    `<tr><td>${esc(q.q)}</td><td class="num">${q.n}件</td><td class="num">${q.med}万/坪</td><td class="num">${q.over300 > 0 ? `<span style="color:var(--stamp)">${q.over300}件</span>` : "0件"}</td></tr>`).join("");

  const boxStyle = 'border:1.5px solid var(--ink);background:#FDFDFC;padding:12px 14px;flex:1;min-width:250px';
  const stepStyle = 'font-size:.8rem;line-height:1.8;margin-top:8px';
  const body = `
  <div class="panel">
    <h2>意思決定の二軸 ── 「相場としてお得か」と「自分が満足するか」</h2>
    <div class="logic-body">
      <p class="why">家の購入判断は<b>データ軸(相場と比べてお得か)</b>と<b>満足軸(自分と家族が満足するか)</b>の二軸で決まる。どちらも本物の判断材料で、どちらか一方では買えない。ただし性質が正反対──データ軸は台帳が計算でき、満足軸はあなたにしか測れない。この2つを混ぜた瞬間に判断はブレる。</p>
      ${decisionAxesSvg({ ask: Math.round(s.ask), bidLo: 5900, bidHi: 6100 })}
      <div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:14px">
        <div style="${boxStyle}">
          <div style="font-weight:700;color:#2E6E8E;border-bottom:1px solid var(--grid);padding-bottom:6px">データ軸 ── 台帳が固定する</div>
          <div style="${stepStyle}">
            適正価格・指値の底は<b>家を見る前に確定済み</b>(下の評価の型1〜3)。内見や交渉の最中に動かさない──動かしたくなったら、それがブレのサイン。<br>
            <b>相場価格で買えば、満足はタダで付いてくる</b>。周辺の買主はみな同じ値段で家+満足を手に入れている。
          </div>
        </div>
        <div style="${boxStyle};border-color:#2C6E49">
          <div style="font-weight:700;color:#2C6E49;border-bottom:1px solid var(--grid);padding-bottom:6px">満足軸 ── 上限を事前に自分で決める</div>
          <div style="${stepStyle}">
            相場を超えて払う分だけが<b>満足の購入代金</b>で、転売時に回収できない。だから「気に入ったら+○○万円まで」と<b>内見の前に紙に書く</b>。<br>
            本物の個人的事情(学区・親との距離・介護の間取り)は正当なプレミアム。見分け方は「その理由を言い出したのは自分か、営業か」。
          </div>
        </div>
      </div>
      <div class="note" style="margin-top:12px;border:1px dashed var(--stamp);padding:10px 12px"><b style="color:var(--stamp)">営業トークの切り替わりを検知する</b> ── データで勝てないと見込んだ営業は、満足軸へ話を切り替えてくる。兆候は4つ: <b>①主語が物件→あなたに</b>変わる(「お客様にとって」) / <b>②時間軸が長期→短期に</b>変わる(「今週末には」「他の方が」) / <b>③数字が消える</b>(単価・成約事例→「ご縁」「出会い」) / <b>④反証不能な言葉</b>(「こういう物件はもう出ません」──実際は同条件帯の成約が約2ヶ月に1件ある)。検知したら<b>「相手は相場では勝てないと認めた」というシグナル</b>として読み、感情は否定せずに土俵を戻す:「気に入っているからこそ、数字はきちんと詰めさせてください」。データを先に固めてあるから、感情は安心して感じてよい──この順序が全て。</div>
    </div>
  </div>

  <div class="panel">
    <h2>買付側の評価の型 ── このページの使い方</h2>
    <div class="logic-body">
      <p class="why">不動産価格の変数の核は<b>①土地実勢単価</b>と<b>②修繕負債</b>の2つ(+踏むと一撃の③地雷)。この3つを自分の数字で固める<b>【評価】</b>と、売出価格との差=売主の期待を削る<b>【交渉】</b>は別のフェーズで、両者はループする──交渉で得た情報が評価の確度を上げ、評価の根拠が交渉の材料になる。</p>
      <div style="display:flex;flex-wrap:wrap;gap:0;align-items:stretch;margin-top:6px">
        <div style="${boxStyle}">
          <div style="font-weight:700;border-bottom:1px solid var(--grid);padding-bottom:6px">【評価】自分の数字を固める(推定の作業)</div>
          <div style="${stepStyle}">
            <b>1. 土地実勢単価を測る</b> ── 成約データで自分で較正(→第1項)。業者の提示単価には「その単価で成約した事例はどれか」と根拠を要求<br>
            <b>2. 修繕負債を確定する</b> ── 履歴確認+実見積り(→第2項)。不明なら築年×${RETAIL.REPAIR_PER_YEAR}万/年で仮置きし、契約前に実額へ置き換える<br>
            <b>3. 地雷を潰す</b> ── 再建築可否・崖/擁壁・私道・告知事項(→変数辞典)。見積もる変数ではなく、黒なら単価の議論以前
          </div>
        </div>
        <div style="display:flex;flex-direction:column;justify-content:center;align-items:center;padding:8px 10px;min-width:110px">
          <div style="font-size:.68rem;color:var(--ink-soft);text-align:center">根拠を材料に<br>指値を出す</div>
          <div style="font-size:1.3rem;color:var(--ink);line-height:1.1">⇄</div>
          <div style="font-size:.68rem;color:var(--ink-soft);text-align:center">売出履歴・売主事情で<br>評価の確度を更新</div>
        </div>
        <div style="${boxStyle};border-color:var(--stamp)">
          <div style="font-weight:700;color:var(--stamp);border-bottom:1px solid var(--grid);padding-bottom:6px">【交渉】売主の期待を削る(駆け引きの作業)</div>
          <div style="${stepStyle}">
            <b>4. 売出履歴・値下げ・媒介の経過を調べ、1〜3の根拠を突きつける</b><br>
            値下げ済み・長期滞留・媒介更新期限はすべて圧力材料。売主の期待は「見積もる」対象ではなく「払わないと決めて削る」対象。<b>指値の底は1+2の合計(3が全て白の場合)で、そこを超えたら降りる</b>
          </div>
        </div>
      </div>
      <div class="note" style="margin-top:10px">1〜3は精度を上げるほど得をする推定、4は情報の非対称を潰すほど得をする駆け引き。そして4の最強の材料は1〜3を先に済ませてあること──成約事例・修繕見積り・検査済証を持って座る買主には、期待分の上乗せが最初から通らない。以下、この型に必要な部品を順に図解する。</div>
    </div>
  </div>

  <div class="panel">
    <h2>一般形 ── 中古戸建の値段はこう積み上がる</h2>
    <div class="logic-body">
      <pre style="font-family:var(--mono);font-size:.86rem;line-height:2;background:#F7F9FA;border:1px solid var(--grid);padding:14px 16px;overflow-x:auto"><b>成約価格</b> = <span style="color:#2E6E8E"><b>土地実勢単価 × 土地坪数 × 個別補正</b></span> + <span style="color:#B07C10"><b>建物残価(修繕控除後)</b></span>
<b>売出価格</b> = 成約価格の見込み + <span style="color:var(--stamp)"><b>売主の期待(査定インフレ+希望上乗せ)</b></span></pre>
      ${genericSvg()}
      <div class="note">3つの塊は性質が違う: <b style="color:#2E6E8E">土地</b>は解体しても残る資産で下値フロアの源泉。<b style="color:#B07C10">建物</b>は住みながら消費する価値で築年とともに消える。<b style="color:var(--stamp)">売主の期待</b>は資産価値ゼロの上乗せで、時間経過と値下げ・指値交渉で削られていく部分──買い手の仕事はこの赤い区間を払わないこと。</div>
      <p class="why" style="margin-top:14px">同じ土地でも、築年帯によって構成比は大きく変わる(暗算式: 総額 ≒ 土地実勢 × 係数):</p>
      ${ageBarsSvg()}
      <div class="note">築浅は建物が総額の3割超を占める「別の乗り物」(新築なら分譲利益も乗る)。築22〜25年で建物はゼロに収束し、以降は「土地値買い」の世界。どの築年帯でも売主の期待は同じように乗ってくるため、<b>築古ほど期待の相対的な歪みが大きくなりやすい</b>。</div>
    </div>
  </div>

  <div class="panel">
    <h2>実例 ── ${esc(property.location?.address ?? r.id)}(売出${fmtMan(Math.round(s.ask))})を式に当てはめる</h2>
    <div class="logic-body">
      <p class="why">上の一般形に実物件の数字を入れたのが下図。図中の数値はすべて査定基準日 ${esc(r.asOf)} 時点のエンジン再計算値。</p>
      ${anatomySvg({ landPart: rt.landPart, bldg: rt.bldgSubj, retailMid: rt.mid, fairLo: r.fairFinal.lo, fairMid: r.fairFinal.mid, fairHi: r.fairFinal.hi, ask: s.ask })}
      <div class="note">市場水準 = 周辺の戸建成約${rt.n}件から時点・徒歩・規模を補正した中央値(リテール比較法)。適正レンジは原価法との重み付き調整(重み ${(r.fairFinal.weights.cost * 100).toFixed(0)}:${(r.fairFinal.weights.retail * 100).toFixed(0)})。売出と市場水準の差 <b>+${fmtMan(Math.round(s.ask - rt.mid))}</b> が「売主の期待」──媒介獲得競争で上振れした査定額に、売主の希望が上乗せされた部分で、値下げ交渉の主戦場になる。</div>
    </div>
  </div>

  <div class="panel">
    <h2>シミュレーター ── 変数を動かして総額の出方を体感する</h2>
    <div class="logic-body">
      <p class="why">簡略式 <b>総額 = 残余単価 × 土地坪数 × (1+個別補正) + 建物残価(築年・修繕状態)</b> をその場で計算する。初期値は${esc(property.location?.address ?? r.id)}のもの。<b>築年数のスライダーを動かす</b>と、青(土地)は動かず琥珀(建物)だけが伸び縮みし、売出価格との赤い差分がどう変わるかが見える。</p>
      ${simulatorHtml({ landM2: s.land, floorM2: s.floor, age: Math.round(s.age), unit: midUnitResid, unitRawMed: raw.med, unitP90: raw.p90, ask: Math.round(s.ask), bm: s.bm, repairCap: s.repair })}
      <div class="note" style="margin-top:12px"><b>物差しに注意</b>: ここで入れる「土地実勢単価」は建物控除後・現在時点の<b>残余単価</b>で、プリセットはこの地区の実測(生の実績中央値${raw.med} / 時点修正後中央値${midUnitResid} / 上位10% ${raw.p90}万/坪)。第1項の公示系の素の単価(190〜245万/坪)とは物差しが違う(あちらは×1.1〜1.2の実勢化と時点修正を経てこちらの水準になる)。簡略式のため徒歩・形状等の細目は「個別補正」1本に集約し、原価法とのブレンド・下値フロア・時点修正の将来分は含まない──登録物件の正式な査定値は各物件ページを参照。</div>
    </div>
  </div>

  <div class="panel">
    <h2>変数辞典 ── 成約事例・売出情報のどこを見るか</h2>
    <div class="logic-body">
      <p class="why">式の各項に入る変数と、取り違えたときに誤差がどちらへ出るか。成約事例を自分で検分するときのチェックリストとして使う。</p>
      ${variableDictHtml()}
      <div class="note">国交省の公開データに存在しない列(構造・修繕歴・接道方位・備考)は観測不能のため、本モデルは「対象と事例に同じ仮定を対称に置いて誤差を相殺する」方針を取る。個別事例の実態を確定させたい場合はレインズ(買側仲介経由)の成約図面・備考欄が唯一の情報源。</div>
    </div>
  </div>

  <div class="panel">
    <h2>第1項: 土地の坪単価 ── 公示地価から実勢までの物差し</h2>
    <div class="logic-body">
      ${pptGaugeSvg({
        koji: KOJI_PPT, ruleLo: Math.round(KOJI_PPT * RULE_LO), ruleHi: Math.round(KOJI_PPT * RULE_HI),
        mixedAvg: bench?.avg_ppt ?? 178,
        cal: calArea?.chosen?.ppt ?? 205, adopted: Math.round(s.ppt), configured: Math.round(rRef.state.ppt),
        dealLo: dealPpts[0] ?? 96, dealHi: dealPpts[dealPpts.length - 1] ?? 110,
        rule15: Math.round(KOJI_PPT * 1.5),
      })}
      <pre style="font-family:var(--mono);font-size:.8rem;line-height:1.9;background:#F7F9FA;border:1px solid var(--grid);padding:12px 14px;overflow-x:auto">公示地価(官報の実数)                       ${KOJI_PPT}万/坪
経験則: 実勢 ≒ 公示 × 1.1〜1.2       → ${Math.round(KOJI_PPT * RULE_LO)}〜${Math.round(KOJI_PPT * RULE_HI)}万/坪
成約較正: 地区平均${bench?.avg_ppt ?? 178}万(${bench?.n ?? 31}件) × 時点修正 × 混合平均補正1.10 → ${calArea?.chosen?.ppt ?? 205}万/坪
採用値: 較正${calArea?.chosen?.ppt ?? 205}と初期推定${Math.round(rRef.state.ppt)}の50:50ブレンド(標本僅少のため) → <b>${Math.round(s.ppt)}万/坪</b></pre>
      <div class="note"><b>読み方</b>: 経験則(×1.1〜1.2)と成約実測(較正${calArea?.chosen?.ppt ?? 205})は独立に同じ帯に着地しており、互いを裏付けている。下限側の個別成約(${dealPpts[0] ?? 96}〜${dealPpts[dealPpts.length - 1] ?? 110}万)は極小地の業者仕入れ水準、上限側の初期推定${Math.round(rRef.state.ppt)}万(公示×${(rRef.state.ppt / KOJI_PPT).toFixed(2)})は経験則の上を行く強気値。「人気エリアは×1.5」(=${Math.round(KOJI_PPT * 1.5)}万)を支持する取引はこの地区に存在しない。注意: 公示地価の「全用途平均」には駅前商業地点が混ざり数倍の値が出る。ここでは住宅地平均を使うこと。</div>
    </div>
  </div>

  <div class="panel">
    <h2>第2項: 建物残価 ── 築年数の一次関数で、築22年前後でゼロになる</h2>
    <div class="logic-body">
      ${bldgCurveSvg({ rebuild: s.rebuild ?? COEFFS.DEFAULT_REBUILD_PPT, floorTsubo, bm: s.bm, age: s.age, repairCap: s.repair, atNew: (s.rebuild ?? COEFFS.DEFAULT_REBUILD_PPT) * floorTsubo * (1 + s.bm) })}
      <pre style="font-family:var(--mono);font-size:.8rem;line-height:1.9;background:#F7F9FA;border:1px solid var(--grid);padding:12px 14px;overflow-x:auto">建物残価 = 再調達${s.rebuild ?? COEFFS.DEFAULT_REBUILD_PPT}万/坪 × 延床${floorTsubo.toFixed(1)}坪 × (1 − 築年/${COEFFS.BUILDING_LIFE_Y}) × 市場性${(1 + s.bm).toFixed(2)}
         − 繰延修繕 min(想定${Math.round(s.repair)}万, ${RETAIL.REPAIR_PER_YEAR}万×築年)   ← リフォーム状態でここが大きく動く
本物件(築${s.age.toFixed(1)}年・未修繕) = ${fmtMan(Math.round(rt.bldgSubj))} / 修繕・リフォーム済みなら ${fmtMan(Math.round(rt.bldgSubj + (rt.repairSubj ?? 0)))}(差 ${fmtMan(Math.round(rt.repairSubj ?? 0))})</pre>
      ${bldgTableHtml({ rebuild: s.rebuild ?? COEFFS.DEFAULT_REBUILD_PPT, floorTsubo, bm: s.bm, repairCap: s.repair }, Math.round(s.age * 10) / 10, rt.landPart)}
      <div class="note"><b>読み方</b>: 税法耐用年数22年(木造)は帳簿の話で、市場は「解体せず住める家」に新築回避価値を払う──だから30年直線。ただし償却(年約${Math.round((s.rebuild ?? COEFFS.DEFAULT_REBUILD_PPT) * floorTsubo * (1 + s.bm) / COEFFS.BUILDING_LIFE_Y)}万)に修繕負債の積み上がり(年${RETAIL.REPAIR_PER_YEAR}万)が重なり、実質ゼロ着地は偶然にも税法と同じ築22年前後。<b>築浅は建物が総額の3〜4割を占める別の乗り物</b>で、新築には分譲利益も乗る(本エンジンは新築の査定を新築成約とだけ比較する対称ルールで隔離)。この式は比較事例側の建物控除にも同じ形で使っており(配分法の対称性)、カーブの多少の誤差は引く側と足す側で相殺される。</div>
      <div class="note" style="margin-top:8px"><b>リフォーム済みか否かで大きく変わる</b>: 図の2本のカーブの差が繰延修繕で、同じ築年でも大規模修繕・リフォーム済みなら上の破線(本物件なら+${fmtMan(Math.round(rt.repairSubj ?? 0))}=総額の約${(100 * (rt.repairSubj ?? 0) / rt.mid).toFixed(0)}%)、放置で劣化が想定超なら実額控除でさらに下へ動く。売出情報で「大規模修繕の実施歴」を必ず確認し、未実施なら実見積りを指値の根拠にすること。なお比較事例側の修繕状態はデータに記録がなく、本モデルは「全事例とも年式相応の未修繕」と対称に仮定している。実際には売却前に化粧直しされた事例が混ざりやすい(=中央値がやや修繕済み寄りに上振れ)ため、<b>未修繕の物件は市場中央値そのままではなく、中央値−リフォーム差分の間を等価点と見るのが保守的</b>。</div>
    </div>
  </div>

  <div class="panel">
    <h2>検算: 残余単価 ── 「その総額は土地1坪あたり幾ら払うことになるか」</h2>
    <div class="logic-body">
      <p class="why">総額から建物残価を引き土地坪数で割った<b>残余単価</b>は、条件の違う物件同士を比べる共通の物差しになる(比較表の「補正後単価」はこれ)。ただし<b>時点修正込み</b>の値なので、「実際に払われた瞬間」の生の水準と並べて検算する。</p>
      <div style="display:flex;gap:20px;flex-wrap:wrap">
        <div style="flex:1;min-width:260px">
        <table class="list">
          <tr><th>四半期</th><th>件数</th><th>生の残余単価 中央値</th><th>300万/坪超</th></tr>
          ${quarterRows}
        </table>
        <div class="note" style="margin-top:6px">隣接${(ADJACENT_DISTRICTS[district] ?? []).length}地区・築3〜25年・土地40〜120m2の${raw.n}件。徒歩10分標準へ正規化、時点修正なし。</div>
        </div>
        <div style="flex:1;min-width:260px">
        <table class="list">
          <tr><th>指標</th><th class="num">残余単価</th><th>意味</th></tr>
          <tr><td>生の全期間中央値</td><td class="num">${raw.med}万/坪</td><td>実際に払われてきた中心水準</td></tr>
          <tr><td>生の上位10%</td><td class="num">${raw.p90}万/坪</td><td>駅近・築浅・上位地区の水準</td></tr>
          <tr><td>時点修正後の中央値</td><td class="num">${midUnitResid}万/坪</td><td>上昇継続を仮定した「今」の推計中心</td></tr>
          <tr><td><b>売出${fmtMan(Math.round(s.ask))}の要求水準</b></td><td class="num" style="color:var(--stamp)"><b>${askUnitResid}万/坪</b></td><td style="color:var(--stamp)">観測分布の最上位圏</td></tr>
        </table>
        <div class="note" style="margin-top:6px">300万/坪超の生の観測は${raw.over300}件のみ(うち2件は同一取引の重複記録疑い)。直近四半期は反落しており、時点修正(上昇継続)は現在検証中の仮定。</div>
        </div>
      </div>
    </div>
  </div>

  <div class="panel">
    <h2>第3項: 売主の期待 ── なぜ売出は市場水準より高いのか</h2>
    <div class="logic-body">
      <p class="why">査定は媒介獲得の入札を兼ねる(高い査定を出した業者が売主に選ばれやすい=査定インフレ)。そこに売主の希望が上乗せされ、売出価格は市場水準+5〜15%から始まるのが通例。上昇相場では「待てば市場が追いつく」ため高値スタートが正当化されてきたが、相場が止まると値下げの階段(1回3〜5%)を降りることになる。本物件も売出約1ヶ月で1回目の値下げ済み(旧価格は非公開)。<b>適正に値付けされた物件はポータルに滞留しない</b>ため、検索で見える在庫は構造的に高値側へ偏ることにも注意。</p>
      <div class="note">この分解の各項の詳細: 土地単価の較正過程は<a href="property/${esc(r.id)}-market.html">成約事例ベースの根拠ページ</a>、係数の意味は<a href="guide.html">前提知識ガイド</a>、事例の生データ全件は<a href="data.html">成約データ台帳</a>(1行ずつ出所リンク付き)。本ページは検討用の簡易整理であり不動産鑑定評価ではない。</div>
    </div>
  </div>`;

  return layout({
    title: "値段の解剖 ── 成約事例ベースの算出ロジック図解",
    subtitle: `総額 = 土地単価×坪数 + 建物残価 + 売主の期待 ── ${esc(property.location?.address ?? r.id)}を例に`,
    docNo: `算出ロジック図解<br>査定基準日 ${esc(r.asOf)}`,
    body,
  });
}
