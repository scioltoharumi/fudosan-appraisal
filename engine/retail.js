// engine/retail.js — リテール比較法(中古戸建の成約事例比較・配分法ベース)
// 経緯: 第1次監査で「土地仕入れ値モデルは実需市場を捕捉できない」→事例比較を新設。
// 第2次監査で「総額÷土地面積」方式の欠陥が指摘された:
//   - 地区水準指数が築年構成・新築比率・建物含有量に汚染され、地価序列と逆転する
//   - 面積バンド内の建物含有差(延床/土地比)が無調整
// 対応として配分法に変更: 事例価格から建物価値(再調達×経年逓減)を控除した「土地残差単価」で
// 比較・指数化する。実需プレミアムは土地残差側に残るため、リテール市場の捕捉力は維持される。
// その他の第2次監査対応: 新築対称化(対象が新築なら事例も新築限定)、徒歩の域検査・分母クランプ、
// 対象個別要因(形状・方位・接道・角地・法的制約・個別補正)の伝搬。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COEFFS, walkAdjOf } from "./appraise.js";
import { ROOT } from "./io.js";
import { growthFactor } from "./timeadjust.js";

export const RETAIL = {
  MIN_COMPS: 5,          // これ未満なら リテール査定を出さない
  AGE_BAND_Y: 6,         // 築年差の許容(±年)
  LAND_RATIO: [0.6, 1.6],   // 土地面積比の許容
  FLOOR_RATIO: [0.7, 1.4],  // 延床面積比の許容
  WALK_MAX: 25,          // 徒歩がこれを超える事例は別市場(バス便等)として除外
  WALK_DENOM_CLAMP: [0.75, 1.15],  // 徒歩正規化の分母クランプ(発散防止)
  NEWBUILD_AGE: 1,       // 築1年未満=新築建売とみなす閾値
  SUBJECT_USED_AGE: 2,   // 対象が築2年以上(=中古)なら新築事例を除外。対象が新築なら新築事例に限定(対称化)
  NEWSUBJ_COMP_MAX_AGE: 2,  // 新築対象の事例プール上限築年
  LAND_RESID_MIN_RATIO: 0.3, // 土地残差の下限(総額の30%。建物控除のしすぎ防止)
  REPAIR_PER_YEAR: 30,   // 繰延修繕の築年比例上限(万円/年)。築浅事例に一律800万を仮定する過大控除の防止
};

// 近接地区マップ(R3監査対応): 地区水準指数によるスケーリングは築年構成・標本ノイズで
// 地価序列と逆転するため廃止し、対象と同一・近接地区の事例に限定する方式に変更。
// 近接関係は北区の地理(台地/低地・鉄道)に基づく。意図的に非対称(小地区は隣の大地区から事例を
// 借りるが、大地区は小地区の少数事例に引っ張られない)。
export const ADJACENT_DISTRICTS = {
  "赤羽西": ["赤羽西", "西が丘", "赤羽台", "赤羽"],
  "西が丘": ["西が丘", "赤羽西", "赤羽台", "中十条", "十条仲原"],
  "赤羽台": ["赤羽台", "赤羽西", "西が丘", "赤羽"],
  "赤羽":   ["赤羽", "赤羽西", "赤羽台", "赤羽南", "志茂"],
  "赤羽南": ["赤羽南", "赤羽", "志茂"],
  "赤羽北": ["赤羽北", "赤羽", "赤羽台"],
  "志茂":   ["志茂", "岩淵町", "赤羽", "神谷"],
  "岩淵町": ["岩淵町", "志茂", "赤羽"],
  "神谷":   ["神谷", "志茂", "中十条"],
  "十条仲原": ["十条仲原", "中十条", "上十条", "西が丘"],
  "中十条": ["中十条", "十条仲原", "上十条", "西が丘"],
  "上十条": ["上十条", "中十条", "十条仲原"],
  // 2026-08-13 追加: 王子・上中里方面への探索エリア拡張(docs/area-expansion-2026-08.md)。
  // **既存地区のエントリは変更していない**(変えると既存物件の事例プールが動き査定値が変わるため)。
  // 追加分は新地区を対象とする場合の許容プールのみ。隣接は台地側の連続性で決めた
  // (崖線の東=低地の地区は掲載条件外なので、隣り合っていても含めない)
  "王子本町": ["王子本町", "岸町", "滝野川", "中十条"],
  "岸町":   ["岸町", "王子本町", "中十条", "上十条"],
  "滝野川": ["滝野川", "王子本町", "西ケ原", "岸町"],
  "西ケ原": ["西ケ原", "滝野川", "中里", "上中里"],
  "中里":   ["中里", "西ケ原", "上中里"],
  "上中里": ["上中里", "西ケ原", "中里"],
};

// 検証結果(market/verification.json)を読み、conflict行のキー集合を返す。ファイル不在なら空
export function loadVerification() {
  try {
    return JSON.parse(readFileSync(join(ROOT, "market", "verification.json"), "utf8"));
  } catch { return null; }
}

export function loadHouseDeals() {
  const verification = loadVerification();
  const conflictKeys = new Set((verification?.rows ?? []).filter((r) => r.status === "conflict").map((r) => r.key));
  const statusByKey = new Map((verification?.rows ?? []).map((r) => [r.key, r.status]));
  const keyOf = (d) => [d.quarter, d.district, d.price_man, d.land_m2, d.floor_m2, d.age_y, d.walk_min].join("|");
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
    // データ検収: 徒歩0〜30分の範囲外(例: 徒歩90分の1件)・築年-2未満は誤記/別市場として除外
    Number.isFinite(d.walk_min) && d.walk_min >= 0 && d.walk_min <= 30 &&
    Number.isFinite(d.age_y) && d.age_y >= -2 &&
    Number.isFinite(d.price_man) && d.price_man > 0 &&
    Number.isFinite(d.land_m2) && d.land_m2 > 0 && Number.isFinite(d.floor_m2) && d.floor_m2 > 0 &&
    /^\d{4}Q[1-4]$/.test(d.quarter) &&
    // 二重照合で矛盾が検出された行は原典裁定まで査定から除外(engine/verify-data.mjs)
    !conflictKeys.has(keyOf(d))
  ).map((d) => ({ ...d, verification: statusByKey.get(keyOf(d)) ?? "unchecked" }));
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

// 建物価値(再調達×経年逓減・維持管理前提)。事例・対象の双方に同じモデルを使う(配分法の対称性)
function buildingValue(floorM2, ageY) {
  const rate = Math.max(0, 1 - Math.max(0, ageY) / COEFFS.BUILDING_LIFE_Y);
  return COEFFS.DEFAULT_REBUILD_PPT * (floorM2 / COEFFS.TSUBO_M2) * rate;
}

const CONSTR_INFL = 0.04;  // 建築費インフレ(年率)。取引時点の建物価値への換算に使用

// 事例1件 → 「標準条件(徒歩10分)・査定基準日時点」の土地残差坪単価。
// 建物控除は (a)取引時点の建築費水準に割引き (b)修繕履歴不明の典型的な繰延修繕(既定800万)を
// 差し引いた「現況ベース」で行う ── 対象側の建物加算(維持前提−繰延修繕)と対称にするため。
// 実需プレミアム・分譲利益は土地残差側に残る(=リテール市場の水準を保持)
function quarterMid(q) {
  const m = String(q).match(/^(\d{4})Q([1-4])$/);
  return new Date(Date.UTC(+m[1], (+m[2] - 1) * 3 + 1, 15));  // growthFactorと同じ四半期中間月
}

function normalizeLandUnit(d, asOf) {
  const yearsAgo = Math.max(0, (asOf.getTime() - quarterMid(d.quarter).getTime()) / 31557600000);
  const bldgAtDeal = buildingValue(d.floor_m2, d.age_y) / Math.pow(1 + CONSTR_INFL, yearsAgo);
  // 修繕上限も取引時点の価格水準へ割引き(建物控除と時点基準を揃える・R4監査)
  const repairComp = Math.min(COEFFS.DEFAULT_REPAIR_MAN, RETAIL.REPAIR_PER_YEAR * Math.max(0, d.age_y)) / Math.pow(1 + CONSTR_INFL, yearsAgo);
  const bldgNet = Math.max(0, bldgAtDeal - repairComp);
  const landResid = Math.max(d.price_man - bldgNet, d.price_man * RETAIL.LAND_RESID_MIN_RATIO);
  const unit = landResid / (d.land_m2 / COEFFS.TSUBO_M2);
  const time = growthFactor(d.quarter, asOf);  // 土地残差なので土地の年次別レートで時点修正
  const walkComp = walkAdjOf(d.walk_min);
  const denom = clamp(1 + walkComp, RETAIL.WALK_DENOM_CLAMP[0], RETAIL.WALK_DENOM_CLAMP[1]);
  return unit * time / denom;
}

// 物件住所(例: 北区赤羽西4)→ 地区名(赤羽西)
export function districtOf(address) {
  const m = String(address ?? "").match(/^北区([^0-9０-９]+)/);   // 先頭アンカー(住所文中の「北区」誤マッチ防止)
  return m ? m[1] : null;
}

// 地区別の土地残差水準指数。建物価値を控除済みのため、築年構成・新築比率の影響を受けにくい
export function buildDistrictIndex(deals, asOf) {
  const byDist = {};
  for (const d of deals) (byDist[d.district] ??= []).push(normalizeLandUnit(d, asOf));
  const index = {};
  for (const [dist, units] of Object.entries(byDist)) {
    if (units.length >= 8) index[dist] = median(units);  // 診断用(査定には不使用)
  }
  return index;
}

// s: appraise正規化済み入力。property側の減価・加点(shape/dir/roadq/corner/extra/lc)を伝搬する
// 戻り値: {n, comps, unitMid, landPart, bldgSubj, lo, mid, hi, districtScoped, subjectFactor} または null
export function retailEstimate(s, asOf, deals, { subjectDistrict = null } = {}) {
  const landM2 = s.land;
  const isUsed = s.age >= RETAIL.SUBJECT_USED_AGE;
  const comps = deals.filter((d) =>
    Math.abs(d.age_y - s.age) <= RETAIL.AGE_BAND_Y &&
    // 対称化: 中古の査定に新築建売を混ぜない / 新築の査定は新築成約に限定(分譲利益込みの市場)
    (isUsed ? d.age_y >= RETAIL.NEWBUILD_AGE : d.age_y < RETAIL.NEWSUBJ_COMP_MAX_AGE) &&
    d.walk_min <= RETAIL.WALK_MAX &&
    d.land_m2 >= landM2 * RETAIL.LAND_RATIO[0] && d.land_m2 <= landM2 * RETAIL.LAND_RATIO[1] &&
    d.floor_m2 >= s.floor * RETAIL.FLOOR_RATIO[0] && d.floor_m2 <= s.floor * RETAIL.FLOOR_RATIO[1]
  );
  if (comps.length < RETAIL.MIN_COMPS) return null;

  // 地域要因: 対象と同一・近接地区の事例に限定(R3監査で地区指数方式を廃止)。
  // 近接限定で事例不足になる場合のみ全地区に拡大し、その旨をフラグで開示する
  const allowed = subjectDistrict ? ADJACENT_DISTRICTS[subjectDistrict] : null;
  const scoped = allowed ? comps.filter((d) => allowed.includes(d.district)) : [];
  const districtScoped = scoped.length >= RETAIL.MIN_COMPS;
  const usable = districtScoped ? scoped : comps;

  const effTsubo = Math.max(0, s.land - s.setback) / COEFFS.TSUBO_M2;
  // 対象物件の個別要因(原価法と同じ係数体系)。複数駅補正は事例側の駅属性が不明なため適用しない
  const walkProp = walkAdjOf(s.walk);
  const cornerAdj = s.corner ? COEFFS.CORNER_ADJ : 0;
  // 形状補正は半減で適用: 事例プールの成約価格には旗竿地・不整形が既に混入しており(形状列なし)、
  // 対象側に満額の-25%を掛けると混入分と二重減価になるため(R4監査)
  const subjectFactor = Math.max(0.1,
    (1 + walkProp + s.shape * 0.5 + s.dir + s.roadq + cornerAdj + s.extra / 100)) * (1 + s.lc);

  const adjusted = usable.map((d) => {
    const unitStd = normalizeLandUnit(d, asOf);                   // 土地残差・標準条件・基準日時点
    const unitAdj = unitStd * subjectFactor;
    return { ...d, unitStd, unitAdj };
  });
  const units = adjusted.map((d) => d.unitAdj);
  const unitMid = median(units);

  // 対象の建物価値: 事例と同じ配分法モデル(維持前提)から、繰延修繕(築年比例上限・事例側と対称)を控除
  const rebuildPpt = s.rebuild ?? COEFFS.DEFAULT_REBUILD_PPT;
  const resid = rebuildPpt * (s.floor / COEFFS.TSUBO_M2) * Math.max(0, 1 - Math.max(0, s.age) / COEFFS.BUILDING_LIFE_Y);
  const repairSubj = Math.min(s.repair, RETAIL.REPAIR_PER_YEAR * Math.max(0, s.age));
  const bldgSubj = Math.max(0, resid * (1 + s.bm) - repairSubj);
  const landPart = unitMid * effTsubo;
  return {
    n: usable.length,
    comps: adjusted,
    unitMid,
    landPart,
    bldgSubj,
    subjectFactor,
    districtScoped,
    subjectDistrict,
    repairSubj,
    lo: quantile(units, 0.25) * effTsubo + bldgSubj,
    mid: landPart + bldgSubj,
    hi: quantile(units, 0.75) * effTsubo + bldgSubj,
  };
}
