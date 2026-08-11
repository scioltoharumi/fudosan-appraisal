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
function anatomySvg(v) {
  const W = 640, axisY = 96;
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
  const barY = 52, barH = 30;
  el.push(`<rect x="${X(0)}" y="${barY}" width="${X(v.landPart) - X(0)}" height="${barH}" fill="#2E6E8E"/>`);
  el.push(`<text x="${X(v.landPart / 2)}" y="${barY + 20}" font-size="11" font-weight="700" text-anchor="middle" fill="#FFFFFF">土地 ${fmtMan(Math.round(v.landPart))}</text>`);
  el.push(`<rect x="${X(v.landPart)}" y="${barY}" width="${X(v.landPart + v.bldg) - X(v.landPart)}" height="${barH}" fill="#B07C10"/>`);
  el.push(`<text x="${X(v.landPart + v.bldg / 2)}" y="${barY - 26}" font-size="10" text-anchor="middle" fill="#B07C10">建物 ${fmtMan(Math.round(v.bldg))}</text>`);
  el.push(`<line x1="${X(v.landPart + v.bldg / 2)}" y1="${barY - 22}" x2="${X(v.landPart + v.bldg / 2)}" y2="${barY - 4}" stroke="#B07C10" stroke-width="1"/>`);
  // 売主の期待(市場水準→売出)
  const gx0 = X(v.retailMid), gx1 = X(v.ask);
  el.push(`<rect x="${gx0}" y="${barY}" width="${Math.max(2, gx1 - gx0)}" height="${barH}" fill="#C93A2B" opacity="0.14" stroke="#C93A2B" stroke-width="1.2" stroke-dasharray="5,3"/>`);
  el.push(`<text x="${(gx0 + gx1) / 2}" y="${barY + 19}" font-size="10.5" font-weight="700" text-anchor="middle" fill="#C93A2B">売主の期待 +${fmtMan(Math.round(v.ask - v.retailMid))}</text>`);
  // 市場水準・適正レンジ・売出のマーカー
  el.push(`<line x1="${gx0}" y1="${barY - 14}" x2="${gx0}" y2="${axisY}" stroke="#16232E" stroke-width="1.2"/>`);
  el.push(`<text x="${gx0}" y="${barY - 18}" font-size="10" text-anchor="middle" fill="#16232E">市場水準 ${fmtMan(Math.round(v.retailMid))}</text>`);
  const fy = axisY + 26;
  el.push(`<rect x="${X(v.fairLo)}" y="${fy}" width="${Math.max(2, X(v.fairHi) - X(v.fairLo))}" height="10" fill="#BFD7E4"/>`);
  el.push(`<line x1="${X(v.fairMid)}" y1="${fy - 3}" x2="${X(v.fairMid)}" y2="${fy + 13}" stroke="#16232E" stroke-width="1.4"/>`);
  el.push(`<text x="${X(v.fairLo)}" y="${fy + 24}" font-size="9.5" fill="#43566B">適正レンジ ${fmtMan(Math.round(v.fairLo))}〜${fmtMan(Math.round(v.fairHi))}(中央 ${fmtMan(Math.round(v.fairMid))} = 原価法との重み付き)</text>`);
  el.push(`<line x1="${X(v.ask)}" y1="30" x2="${X(v.ask)}" y2="${axisY}" stroke="#C93A2B" stroke-width="2"/>`);
  el.push(`<polygon points="${X(v.ask) - 5},22 ${X(v.ask) + 5},22 ${X(v.ask)},31" fill="#C93A2B"/>`);
  el.push(`<text x="${X(v.ask)}" y="16" font-size="11.5" font-weight="700" text-anchor="middle" fill="#C93A2B">売出 ${fmtMan(Math.round(v.ask))}</text>`);
  return `<svg viewBox="0 0 ${W} 158" role="img" aria-label="総額の分解: 土地+建物+売主の期待" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 図2: 土地坪単価の物差し(素の単価・2025年1月基準) ----
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
  const pin = (v, label, color, tier, bold = false) => {
    const x = X(v), ly = tier === 0 ? axisY - 58 : tier === 1 ? axisY - 76 : axisY + 36;
    el.push(`<line x1="${x}" y1="${Math.min(ly + 4, axisY)}" x2="${x}" y2="${Math.max(ly - 8, axisY)}" stroke="${color}" stroke-width="1" stroke-dasharray="2,2"/>`);
    el.push(`<circle cx="${x}" cy="${axisY}" r="4" fill="${color}"/>`);
    el.push(`<text x="${x}" y="${ly}" font-size="${bold ? 10.5 : 9.5}" ${bold ? 'font-weight="700"' : ""} text-anchor="middle" fill="${color}">${label}</text>`);
  };
  // 下段(axisY+36)・上段2層を交互に使い重なり回避
  el.push(`<rect x="${X(g.dealLo)}" y="${axisY - 3}" width="${X(g.dealHi) - X(g.dealLo)}" height="6" fill="#43566B" opacity="0.5"/>`);
  el.push(`<text x="${(X(g.dealLo) + X(g.dealHi)) / 2}" y="${axisY + 36}" font-size="9.5" text-anchor="middle" fill="#43566B">個別成約 ${g.dealLo}〜${g.dealHi}(極小地・業者仕入れ)</text>`);
  pin(g.mixedAvg, `混合平均 ${g.mixedAvg}(31件)`, "#43566B", 1);
  pin(g.koji, `公示地価 ${g.koji}`, "#16232E", 2, true);
  pin(g.cal, `成約較正 ${g.cal}`, "#2E6E8E", 0, true);
  pin(g.adopted, `採用 ${g.adopted}`, "#2C6E49", 1, true);
  pin(g.configured, `初期推定 ${g.configured}(公示×${(g.configured / g.koji).toFixed(2)})`, "#B07C10", 2);
  pin(g.rule15, `×1.5なら ${g.rule15} ← 観測なし`, "#C93A2B", 0);
  return `<svg viewBox="0 0 ${W} 150" role="img" aria-label="土地坪単価の物差し" style="width:100%;height:auto">${el.join("")}</svg>`;
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
  el.push(`<text x="${X(21)}" y="${Y(valFull(21)) - 8}" font-size="9.5" fill="#2E6E8E">リフォーム・大規模修繕済み(控除なし・築30年でゼロ)</text>`);
  // 下側: 未修繕(現況)カーブ(実線)
  const pts = [];
  for (let a = 0; a <= 30; a += 0.25) pts.push(`${X(a).toFixed(1)},${Y(val(a)).toFixed(1)}`);
  el.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="#B07C10" stroke-width="2.5"/>`);
  el.push(`<text x="${X(6.5)}" y="${Y(val(6.5)) + 16}" font-size="9.5" fill="#B07C10">未修繕(繰延修繕を控除)</text>`);
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
  el.push(`<text x="${X(zeroAge)}" y="${H - padB - 8}" font-size="9.5" fill="#43566B">築${zeroAge.toFixed(0)}年前後でゼロ着地(税法22年とほぼ一致)</text>`);
  el.push(`<text x="${X(2)}" y="${Y(yMax * 0.92)}" font-size="9.5" fill="#B07C10">減少ペース ≒ 年${Math.round(c.rebuild * c.floorTsubo * (1 + c.bm) / 30 + RETAIL.REPAIR_PER_YEAR)}万(償却+修繕負債の積み上がり)</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="建物残価の築年カーブ" style="width:100%;height:auto">${el.join("")}</svg>`;
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

  const body = `
  <div class="panel">
    <h2>一枚の式 ── 中古戸建の値段はこう分解できる</h2>
    <div class="logic-body">
      <pre style="font-family:var(--mono);font-size:.86rem;line-height:2;background:#F7F9FA;border:1px solid var(--grid);padding:14px 16px;overflow-x:auto"><b>成約価格</b> = 土地実勢単価 × 土地坪数 × 個別補正 + 建物残価(修繕控除後)
<b>売出価格</b> = 成約価格の見込み + <span style="color:var(--stamp)">売主の期待(査定インフレ+希望上乗せ)</span></pre>
      <p class="why">実際の市場は成約事例ベースで値付けされる。この式の各項が「どこから来る数字か」を、本物件(${esc(property.location?.address ?? r.id)}・売出${fmtMan(Math.round(s.ask))})を例に順に解剖する。図中の数値はすべて査定基準日 ${esc(r.asOf)} 時点のエンジン再計算値。</p>
      ${anatomySvg({ landPart: rt.landPart, bldg: rt.bldgSubj, retailMid: rt.mid, fairLo: r.fairFinal.lo, fairMid: r.fairFinal.mid, fairHi: r.fairFinal.hi, ask: s.ask })}
      <div class="note">市場水準 = 周辺の戸建成約${rt.n}件から時点・徒歩・規模を補正した中央値(リテール比較法)。適正レンジは原価法との重み付き調整(重み ${(r.fairFinal.weights.cost * 100).toFixed(0)}:${(r.fairFinal.weights.retail * 100).toFixed(0)})。売出と市場水準の差 <b>+${fmtMan(Math.round(s.ask - rt.mid))}</b> が「売主の期待」──媒介獲得競争で上振れした査定額に、売主の希望が上乗せされた部分で、値下げ交渉の主戦場になる。</div>
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
