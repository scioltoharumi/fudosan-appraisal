// engine/retail.js — リテール比較法(中古戸建の成約事例比較)。監査で判明した
// 「土地仕入れ値モデルは実需リテール市場の支払意思額を捕捉できない」欠陥への対応。
// market/house-deals.csv(国交省 不動産取引価格情報の再掲・北区12地区の戸建成約)から
// 対象物件と条件の近い成約を選び、時点・徒歩・築年差を補正して適正総額を推定する。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COEFFS } from "./appraise.js";
import { ROOT } from "./io.js";
import { growthFactor } from "./timeadjust.js";

export const RETAIL = {
  MIN_COMPS: 5,          // これ未満なら リテール査定を出さない
  AGE_BAND_Y: 6,         // 築年差の許容(±年)
  LAND_RATIO: [0.6, 1.6],   // 土地面積比の許容
  FLOOR_RATIO: [0.7, 1.4],  // 延床面積比の許容
  AGE_SLOPE: 0.015,      // 築1年差あたりの総額調整(±1.5%/年。残価逓減の実勢近似)
};

export function loadHouseDeals() {
  const text = readFileSync(join(ROOT, "market", "house-deals.csv"), "utf8");
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const c = line.split(",");
    const row = Object.fromEntries(header.map((h, i) => [h, c[i]]));
    return {
      quarter: row.quarter,
      district: row.district,
      price_man: +row.price_man,
      land_m2: +row.land_m2,
      floor_m2: +row.floor_m2,
      age_y: +row.age_y,
      walk_min: +row.walk_min,
      source_url: row.source_url,
    };
  });
}

const median = (xs) => {
  const a = [...xs].sort((p, q) => p - q);
  const n = a.length;
  return n === 0 ? null : n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
};
const quantile = (xs, q) => {
  const a = [...xs].sort((p, q2) => p - q2);
  return a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))];
};

// s: appraise正規化済み入力(land/setback/walk/shape/age/floor)。asOf: 査定基準日
// 戻り値: {n, comps, unitMid, lo, mid, hi} または null(事例不足)
export function retailEstimate(s, asOf, deals) {
  const landM2 = s.land;
  const comps = deals.filter((d) =>
    Math.abs(d.age_y - s.age) <= RETAIL.AGE_BAND_Y &&
    d.land_m2 >= landM2 * RETAIL.LAND_RATIO[0] && d.land_m2 <= landM2 * RETAIL.LAND_RATIO[1] &&
    d.floor_m2 >= s.floor * RETAIL.FLOOR_RATIO[0] && d.floor_m2 <= s.floor * RETAIL.FLOOR_RATIO[1]
  );
  if (comps.length < RETAIL.MIN_COMPS) return null;

  const effTsubo = Math.max(0, s.land - s.setback) / COEFFS.TSUBO_M2;
  const walkProp = COEFFS.WALK_ADJ_PER_MIN * (s.walk - COEFFS.WALK_BASE_MIN);
  const adjusted = comps.map((d) => {
    const unit = d.price_man / (d.land_m2 / COEFFS.TSUBO_M2);            // 総額の土地坪単価換算
    const time = growthFactor(d.quarter, asOf);                          // 取引時点→査定基準日
    const walkComp = COEFFS.WALK_ADJ_PER_MIN * (d.walk_min - COEFFS.WALK_BASE_MIN);
    const ageGap = d.age_y - s.age;                                      // 事例が古いほど+補正
    const unitAdj = unit * time * (1 + walkProp + s.shape) / (1 + walkComp) * (1 + RETAIL.AGE_SLOPE * ageGap);
    return { ...d, unit, time, unitAdj };
  });
  const units = adjusted.map((d) => d.unitAdj);
  const unitMid = median(units);
  return {
    n: comps.length,
    comps: adjusted,
    unitMid,
    lo: quantile(units, 0.25) * effTsubo,
    mid: unitMid * effTsubo,
    hi: quantile(units, 0.75) * effTsubo,
  };
}
