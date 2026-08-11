// site/templates/anatomy.js — 「値段の解剖」共有部品
// formula.html の実例図(総額の解剖)と生の残余単価統計を、全物件ページでも同じ書き方で
// 使えるように formula.js から切り出したもの。図中の値はすべてビルド時のエンジン再計算値。
import { COEFFS, fmtMan } from "../../engine/appraise.js";
import { RETAIL, ADJACENT_DISTRICTS } from "../../engine/retail.js";

// ---- 生の残余単価(時点修正なし・徒歩10分標準へ正規化) ----
// 「補正後単価」から時点修正(上昇継続の仮定)を外した、実際に払われた瞬間の水準。
// フィルタ: 隣接地区・中古実需帯(築3〜25年・土地40〜120m2)。normalizeLandUnitと同じ控除規則。
export function rawResidualStats(houseDeals, subjectDistrict) {
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

// ---- 図: 総額の解剖(積み上げ+売主の期待) ----
// ラベルは縦3段(y=14売出 / y=30市場水準 / y=46建物)に分離し重なりを防ぐ
export function anatomySvg(v) {
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
  // 建物残価ゼロ(古家扱い)のときはセグメントとラベルを描かない
  if (v.bldg > 0.5) {
    el.push(`<rect x="${X(v.landPart)}" y="${barY}" width="${X(v.landPart + v.bldg) - X(v.landPart)}" height="${barH}" fill="#B07C10"/>`);
    const bcx = X(v.landPart + v.bldg / 2);
    el.push(`<text x="${bcx}" y="46" font-size="10" text-anchor="middle" fill="#B07C10">建物 ${fmtMan(Math.round(v.bldg))}</text>`);
    el.push(`<line x1="${bcx}" y1="49" x2="${bcx}" y2="${barY}" stroke="#B07C10" stroke-width="1"/>`);
  }
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
