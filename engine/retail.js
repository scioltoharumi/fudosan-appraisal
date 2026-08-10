// engine/retail.js — リテール比較法(中古戸建の成約事例比較)。
// 「土地仕入れ値モデルは実需リテール市場の支払意思額を捕捉できない」欠陥(2026-08第1次監査)への対応として新設し、
// 第2次監査(鑑定士レビュー+バグハント)の指摘を反映:
//   - 徒歩補正の分母爆発(徒歩90分事例で単価30倍)→ 事例フィルタ+分母クランプ
//   - 地域要因の未補正(北区12地区を単一市場扱い)→ 地区水準指数による正規化
//   - 減価要因(再建築不可・接道疑義・個別減点)がリテール経路で消滅 → 対象側係数に伝搬
//   - 新築建売(プール の約4割)の混入 → 対象が中古の場合は築1年未満の事例を除外
//   - 地価上昇率を建物込み総額に適用する過大時点修正 → 戸建総額用ブレンド率(growthFactorHouse)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COEFFS } from "./appraise.js";
import { ROOT } from "./io.js";
import { growthFactorHouse } from "./timeadjust.js";

export const RETAIL = {
  MIN_COMPS: 5,          // これ未満なら リテール査定を出さない
  AGE_BAND_Y: 6,         // 築年差の許容(±年)
  LAND_RATIO: [0.6, 1.6],   // 土地面積比の許容
  FLOOR_RATIO: [0.7, 1.4],  // 延床面積比の許容
  WALK_MAX: 25,          // 徒歩がこれを超える事例は別市場(バス便等)として除外
  WALK_DENOM_CLAMP: [0.75, 1.15],  // 徒歩正規化の分母クランプ(発散防止)
  NEWBUILD_AGE: 1,       // 築1年未満=新築建売とみなす閾値
  SUBJECT_USED_AGE: 2,   // 対象が築2年以上(=中古)なら新築事例を除外
  AGE_SLOPE: 0.015,      // 築1年差あたりの総額調整(±1.5%/年。残価逓減の実勢近似)
  DISTRICT_MIN_N: 8,     // 地区水準指数を採用する最小事例数(不足時は指数1=未補正として扱う)
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
  }).filter((d) =>
    // データ検収: 徒歩0〜30分の範囲外(例: 徒歩90分の1件)は誤記または別市場として除外
    Number.isFinite(d.walk_min) && d.walk_min >= 0 && d.walk_min <= 30 &&
    Number.isFinite(d.price_man) && Number.isFinite(d.land_m2) && d.land_m2 > 0
  );
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
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// 事例1件を「標準条件(徒歩10分)・査定基準日時点」の土地坪単価換算に正規化
function normalizeUnit(d, asOf) {
  const unit = d.price_man / (d.land_m2 / COEFFS.TSUBO_M2);
  const time = growthFactorHouse(d.quarter, asOf);
  const walkComp = COEFFS.WALK_ADJ_PER_MIN * (d.walk_min - COEFFS.WALK_BASE_MIN);
  const denom = clamp(1 + walkComp, RETAIL.WALK_DENOM_CLAMP[0], RETAIL.WALK_DENOM_CLAMP[1]);
  return unit * time / denom;
}

// 物件住所(例: 北区赤羽西4)→ 地区名(赤羽西)
export function districtOf(address) {
  const m = String(address ?? "").match(/北区([^0-9０-９]+)/);
  return m ? m[1] : null;
}

// 地区別の戸建成約水準指数(標準条件・基準日正規化後の中央値)。地域要因の補正に使う
export function buildDistrictIndex(deals, asOf) {
  const byDist = {};
  for (const d of deals) (byDist[d.district] ??= []).push(normalizeUnit(d, asOf));
  const index = {};
  for (const [dist, units] of Object.entries(byDist)) {
    if (units.length >= RETAIL.DISTRICT_MIN_N) index[dist] = median(units);
  }
  return index;
}

// s: appraise正規化済み入力。property側の減価・加点(shape/dir/roadq/corner/extra/lc)を伝搬する
// 戻り値: {n, comps, unitMid, lo, mid, hi, districtAdjusted, subjectFactor} または null(事例不足)
export function retailEstimate(s, asOf, deals, { subjectDistrict = null } = {}) {
  const landM2 = s.land;
  const isUsed = s.age >= RETAIL.SUBJECT_USED_AGE;
  const comps = deals.filter((d) =>
    Math.abs(d.age_y - s.age) <= RETAIL.AGE_BAND_Y &&
    (!isUsed || d.age_y >= RETAIL.NEWBUILD_AGE) &&   // 中古の査定に新築建売(売主利益込み)を混ぜない
    d.walk_min <= RETAIL.WALK_MAX &&
    d.land_m2 >= landM2 * RETAIL.LAND_RATIO[0] && d.land_m2 <= landM2 * RETAIL.LAND_RATIO[1] &&
    d.floor_m2 >= s.floor * RETAIL.FLOOR_RATIO[0] && d.floor_m2 <= s.floor * RETAIL.FLOOR_RATIO[1]
  );
  if (comps.length < RETAIL.MIN_COMPS) return null;

  // 地区水準指数(地域要因)。対象地区の指数が得られない場合は未補正(districtAdjusted=false)
  const index = buildDistrictIndex(deals, asOf);
  const subjIdx = subjectDistrict ? index[subjectDistrict] : null;
  const districtAdjusted = subjIdx != null;

  const effTsubo = Math.max(0, s.land - s.setback) / COEFFS.TSUBO_M2;
  // 対象物件の個別要因(原価法と同じ係数体系)。複数駅補正は事例側の駅属性が不明なため適用しない
  const walkProp = COEFFS.WALK_ADJ_PER_MIN * (s.walk - COEFFS.WALK_BASE_MIN);
  const cornerAdj = s.corner ? COEFFS.CORNER_ADJ : 0;
  const subjectFactor = (1 + walkProp + s.shape + s.dir + s.roadq + cornerAdj + s.extra / 100) * (1 + s.lc);

  const adjusted = comps.map((d) => {
    const unitStd = normalizeUnit(d, asOf);                       // 標準条件・基準日時点
    const distFactor = districtAdjusted && index[d.district] ? subjIdx / index[d.district] : 1;
    const ageGap = d.age_y - s.age;                               // 事例が古いほど+補正
    const unitAdj = unitStd * distFactor * subjectFactor * (1 + RETAIL.AGE_SLOPE * ageGap);
    return { ...d, unitStd, distFactor, unitAdj };
  });
  const units = adjusted.map((d) => d.unitAdj);
  const unitMid = median(units);
  return {
    n: comps.length,
    comps: adjusted,
    unitMid,
    subjectFactor,
    districtAdjusted,
    subjectDistrict,
    lo: quantile(units, 0.25) * effTsubo,
    mid: unitMid * effTsubo,
    hi: quantile(units, 0.75) * effTsubo,
  };
}
