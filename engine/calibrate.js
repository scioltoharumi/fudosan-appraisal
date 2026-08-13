// engine/calibrate.js — 成約事例による基準坪単価の較正(Phase 3)
// 「査定は帳簿(公示地価)ベースで市場価格と無関係」という批判に答えるため、
// 国交省 不動産取引価格情報(再掲)由来の成約事例を標準地条件・2025年1月基準に正規化し、
// エリアごとの「成約ベース坪単価」を算出して公示ベースの採用単価と突き合わせる。
//
// 正規化の考え方(appraise.jsの補正モデルの逆適用):
//   ppt_norm = 成約坪単価 ÷ (1 + 徒歩補正 + 形状補正) ÷ 時点係数(年次別レート・timeadjust.js)
//   - 経過年は公示基準日(2025-01-01)からの取引時期のズレ。過去の取引は上方修正される
//   - 方位・接道の質・角地は成約データに属性がないため補正しない(=正規化残差として誤差に含む)
// 全期間平均のベンチマークは時点補正できないため参考表示のみ(recent: false)。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COEFFS, walkAdjOf } from "./appraise.js";
import { ROOT, loadYaml } from "./io.js";
import { growthFactor } from "./timeadjust.js";

const KOJI_BASE_DATE = new Date(COEFFS.KOJI_BASE_UTC);

// 成約データの形状表記 → appraise.jsの形状補正への写像
// (2026-08監査: 台形0/ほぼ台形-5%の序列逆転を修正。台形系はいずれも整形扱い)
export const SHAPE_NORM_ADJ = {
  "長方形": 0, "ほぼ長方形": 0, "正方形": 0, "ほぼ正方形": 0, "台形": 0, "ほぼ台形": 0,
  "やや不整形": -0.05, "不整形": -0.05,
  "旗竿地": -0.25, "袋地等": -0.25, "袋地": -0.25,
  "不明": 0,
};

// 地区平均ベンチマークの混合バイアス補正(2026-08監査)
// 地区平均には旗竿・不整形・古家付き(解体費控除)・業者仕入れ(卸値)が混入し、
// 標準的な整形地の実勢より10〜20%低く出る。保守側の+10%で補正し、basisに明記する。
export const MIXED_AVG_CORRECTION = 1.10;

export function loadDeals() {
  const text = readFileSync(join(ROOT, "market", "deals.csv"), "utf8");
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row = Object.fromEntries(header.map((h, i) => [h, cells[i]]));
    return {
      date: row.date,
      area: row.area,
      district: row.district,
      price_man: +row.price_man,
      land_tsubo: +row.land_tsubo,
      ppt_man: +row.ppt_man,
      walk_min: +row.walk_min,
      shape: row.shape,
      zoning: row.zoning,
      source_url: row.source_url,
    };
  }).filter((d) =>
    // データ検収(retail側と対称): 徒歩0〜30分・正の面積/価格のみ
    Number.isFinite(d.walk_min) && d.walk_min >= 0 && d.walk_min <= 30 &&
    Number.isFinite(d.price_man) && d.price_man > 0 && Number.isFinite(d.land_tsubo) && d.land_tsubo > 0
  );
}

export function loadBenchmarks() {
  return loadYaml(join(ROOT, "market", "benchmarks.yaml")).benchmarks;
}

// 個別成約1件を「標準地条件・2025年1月基準」の坪単価に正規化する
// 時点修正は年次別レート(timeadjust.js)。一律10%は2022〜23年に対し過大だった(2026-08監査)
export function normalizeDeal(deal) {
  const walkAdj = walkAdjOf(deal.walk_min);
  const shapeAdj = SHAPE_NORM_ADJ[deal.shape] ?? 0;
  const attr = Math.max(0.6, 1 + walkAdj + shapeAdj);   // 分母クランプ(発散防止・retail側と対称)
  const time = 1 / growthFactor(deal.date, KOJI_BASE_DATE);   // 取引時点→2025-01の換算(÷time)
  const ppt_norm = deal.ppt_man / (attr * time);
  return { ...deal, walkAdj, shapeAdj, attrFactor: attr, timeFactor: time, ppt_norm };
}

const median = (xs) => {
  const a = [...xs].sort((p, q) => p - q);
  const n = a.length;
  return n === 0 ? null : n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
};

// エリア別較正。戻り値 byArea[areaKey]:
//   deals: {n, median_norm, min_norm, max_norm, rows}
//   benches: ベンチマーク(recentは2025-01基準へ時点補正済みの avg_base / median_base 付き)
//   chosen: {ppt, basis, confidence} — 成約ベース坪単価として採用する値(データ不足ならnull)
export function calibrate() {
  const deals = loadDeals().map((d) => normalizeDeal(d));
  const benches = loadBenchmarks().map((b) => {
    if (!b.recent) return { ...b, avg_base: null, median_base: null };
    const g = growthFactor(b.window_mid, KOJI_BASE_DATE);
    return {
      ...b,
      avg_base: b.avg_ppt != null ? b.avg_ppt * g : null,
      median_base: b.median_ppt != null ? b.median_ppt * g : null,
    };
  });

  const areas = [...new Set([...deals.map((d) => d.area), ...benches.map((b) => b.area)])];
  const byArea = {};
  for (const area of areas) {
    const dRows = deals.filter((d) => d.area === area);
    const norms = dRows.map((d) => d.ppt_norm);
    const bRows = benches.filter((b) => b.area === area);
    const recentBench = bRows.find((b) => b.recent && b.avg_base != null);

    let chosen = null;
    const benchPpt = recentBench ? recentBench.avg_base * MIXED_AVG_CORRECTION : null;
    if (dRows.length >= 3) {
      const med = median(norms);
      // 乖離ガード(第2次監査): 小標本の中央値が大標本ベンチマークと±25%超乖離する場合、
      // 個別成約側に特殊取引(再建築不可・卸値等)の混入を疑い、ベンチマーク側を採用する
      if (benchPpt && Math.abs(med / benchPpt - 1) > 0.25) {
        chosen = {
          ppt: Math.round(benchPpt), level: "low",
          basis: `地区平均ベンチマーク(${recentBench.district} ${recentBench.n}件)×混合平均補正+10%`,
          confidence: `低(個別成約${dRows.length}件の中央値${Math.round(med)}万が地区平均と±25%超乖離・要人手確認)`,
        };
      } else {
        chosen = { ppt: Math.round(med), level: dRows.length >= 5 ? "mid" : "low",
          basis: "個別成約の正規化中央値", confidence: dRows.length >= 5 ? "中" : "低" };
      }
    } else if (recentBench) {
      chosen = {
        ppt: Math.round(benchPpt), level: "low",
        basis: `地区平均ベンチマーク(${recentBench.district} ${recentBench.n}件)×混合平均補正+10%`,
        confidence: "低(属性未調整の混合平均を補正した推定値)",
      };
    } else if (dRows.length >= 1) {
      chosen = { ppt: Math.round(median(norms)), level: "reference",
        basis: `個別成約の正規化中央値(${dRows.length}件のみ)`, confidence: "参考(極小標本)" };
    }
    byArea[area] = {
      deals: {
        n: dRows.length,
        median_norm: norms.length ? median(norms) : null,
        min_norm: norms.length ? Math.min(...norms) : null,
        max_norm: norms.length ? Math.max(...norms) : null,
        rows: dRows,
      },
      benches: bRows,
      chosen,
    };
  }
  return { dealCount: deals.length, byArea };
}

// ---- CLI: node engine/calibrate.js ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const cal = calibrate();
  console.log(`━━ 成約較正サマリ(個別成約 ${cal.dealCount}件 / 正規化: 標準地条件・2025-01基準・年次別レート)`);
  for (const [area, a] of Object.entries(cal.byArea)) {
    const d = a.deals;
    const lines = [
      `【${area}】 成約ベース坪単価: ${a.chosen ? a.chosen.ppt + "万/坪(" + a.chosen.basis + " / 信頼度:" + a.chosen.confidence + ")" : "データ不足"}`,
      d.n ? `  個別成約 ${d.n}件: 正規化中央値 ${Math.round(d.median_norm)}万/坪(範囲 ${Math.round(d.min_norm)}〜${Math.round(d.max_norm)})` : "  個別成約なし",
    ];
    for (const b of a.benches) {
      lines.push(`  ベンチマーク[${b.district}] ${b.period} n=${b.n}: 平均${b.avg_ppt}万/坪` +
        (b.avg_base ? `(2025-01基準 ${Math.round(b.avg_base)}万)` : "") +
        (b.median_ppt ? ` / 中央値${b.median_ppt}万` + (b.median_base ? `(同 ${Math.round(b.median_base)}万)` : "") : "") +
        (b.caveat ? ` ※${b.caveat}` : ""));
    }
    console.log(lines.join("\n"));
  }
}
