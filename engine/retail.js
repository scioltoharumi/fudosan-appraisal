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
  SHAPE_POOL_MIN: 8,     // 整形地限定プールを採用する最低件数。これを割ると混合プール+半減へ退避する
  BREADTH_KO_M: 1.8,     // 前面道路の幅員がこれ未満の事例はプールから外す(下記 BREADTH_KNOTS のコメント参照)
};

// ---- 前面道路の幅員(2026-08-29新設) ----
// 経緯: 上十条3(築42年)の事例プール5件が 52〜223万/坪 と4.3倍に割れ、中央値が1,564万まで落ちた。
// 出所を国交省APIの生データまで遡ると、5件はすべて実在するが幅員が 1.2m / 1.7m / 記載なし×2 / 2.5m で、
// **最も安い2件は接道義務(建築基準法42条)を満たさない**=再建築不可相当だった。
// 台帳はこれをKO1(再建築不可)で候補から落とすのに、**ものさしの側には入れていた**という非対称。
//
// 当初は「土地値の50%未満の事例を外す」案を検討したが、これは答え(土地値)を先に決めて
// それに逆らうデータを捨てる循環論法で、崖の検証で自ら戒めた形(基準に結論を焼き込む)そのもの。
// 価格ではなく**物理的属性である幅員**で切る。幅員は house-deals.csv に既に 660/765件ある。
//
// 実測(765件・エンジンの正規化後・地区×2年帯を統制・基準=幅員4.0-6.0m):
//   〜2.0m    n= 21  −40.4%  CI −61.2〜−19.1%  ★判別可能
//   2.0-2.7m  n= 48  −17.7%  CI −29.9〜 −9.7%  ★判別可能
//   2.7-4.0m  n=165   −6.3%  CI −10.9〜 −1.1%  ★判別可能
//   4.0-6.0m  n=281  (基準)
//   6.0m超    n=122  +14.5%  CI  +8.6〜+25.4%  ★判別可能
// **全帯が判別可能**で符号も単調。2026-08-13に対象側で測った値(4m未満 −11.0% / 6m超 +21.4%)とも整合し、
// 事例側だけが素通しだった。採用値は既存の慣行どおり**各層のCIの0に近い側**を採る保守設定で、
// 結果として対象側の既存係数(4m未満 −5% / 6m超 +10%)と同じ目盛りに乗る。
// 帯の階段にすると境界で不連続に跳ぶため、徒歩補正(WALK_KNOTS)と同じ折れ線で補間する。
export const BREADTH_KNOTS = [[2.0, -0.20], [2.7, -0.10], [4.0, -0.05], [5.0, 0], [6.0, 0], [7.0, 0.10]];

// 幅員 → 標準条件(4〜6m)に対する補正。記載なし(null/NaN)は**判定しない**=0(数えられない表記は
// 判定しないという台帳全体の規律。記載なし事例の件数は shapeBasis と同様に開示する)
export function breadthAdjOf(breadthM) {
  // 記載なしを先に弾く。Number(null)===0 / Number("")===0 はいずれも Number.isFinite が true になるため、
  // 生値を見ずに coerce すると「幅員0m」として最大減点が当たる(2026-08-29に実装直後のテストが検出)
  if (breadthM === null || breadthM === undefined || breadthM === "") return 0;
  const b = Number(breadthM);
  if (!Number.isFinite(b) || b <= 0) return 0;
  if (b <= BREADTH_KNOTS[0][0]) return BREADTH_KNOTS[0][1];
  const last = BREADTH_KNOTS[BREADTH_KNOTS.length - 1];
  if (b >= last[0]) return last[1];
  for (let i = 1; i < BREADTH_KNOTS.length; i++) {
    const [x0, y0] = BREADTH_KNOTS[i - 1], [x1, y1] = BREADTH_KNOTS[i];
    if (b <= x1) return y0 + ((y1 - y0) * (b - x0)) / (x1 - x0);
  }
  return last[1];
}

// 出典の土地形状表記のうち「整形地」とみなすもの(calibrate.SHAPE_NORM_ADJ の 0% 群と同じ語彙)。
// 空欄(出典に記載なし)は整形と断定できないため**含めない**。
export const REGULAR_SHAPES = new Set(["長方形", "ほぼ長方形", "正方形", "ほぼ正方形", "台形", "ほぼ台形", "ほぼ整形"]);

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
      shape: row.shape || null,          // 出典の「土地形状」。空欄=出典に記載なし(推測で埋めない)
      road_type: row.road_type || null,  // private=私道 / public=公道系(国交省API由来)
      breadth_m: row.breadth_m ? Number(row.breadth_m) : null,   // 前面道路の幅員(m・同上)
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

export function normalizeLandUnit(d, asOf) {
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
  // 幅員も標準条件(4〜6m)へ戻す(2026-08-29)。徒歩と同じ扱いで、事例側の条件差を先に消してから比較する。
  // 記載なしの事例は breadthAdjOf が0を返すので、この行は素通し=従来と同じ挙動になる
  const bDenom = clamp(1 + breadthAdjOf(d.breadth_m), RETAIL.WALK_DENOM_CLAMP[0], RETAIL.WALK_DENOM_CLAMP[1]);
  return unit * time / denom / bDenom;
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
// 戻り値: {n, comps, unitMid, landPart, bldgSubj, lo, mid, hi, districtScoped, subjectFactor,
//          shapeControlled, shapeBasis} または null
export function retailEstimate(s, asOf, deals, { subjectDistrict = null } = {}) {
  const landM2 = s.land;
  const isUsed = s.age >= RETAIL.SUBJECT_USED_AGE;
  const koBreadth = [];   // 接道義務を満たさず外した事例(開示用。黙って減らさない)
  const comps = deals.filter((d) =>
    Math.abs(d.age_y - s.age) <= RETAIL.AGE_BAND_Y &&
    // 対称化: 中古の査定に新築建売を混ぜない / 新築の査定は新築成約に限定(分譲利益込みの市場)
    (isUsed ? d.age_y >= RETAIL.NEWBUILD_AGE : d.age_y < RETAIL.NEWSUBJ_COMP_MAX_AGE) &&
    d.walk_min <= RETAIL.WALK_MAX &&
    d.land_m2 >= landM2 * RETAIL.LAND_RATIO[0] && d.land_m2 <= landM2 * RETAIL.LAND_RATIO[1] &&
    d.floor_m2 >= s.floor * RETAIL.FLOOR_RATIO[0] && d.floor_m2 <= s.floor * RETAIL.FLOOR_RATIO[1] &&
    // 接道義務(建築基準法42条)を満たさない事例を外す(2026-08-29)。台帳はKO1(再建築不可)で
    // 候補から落とすのだから、ものさしの側にも入れない。**記載なしは落とさない**(判定しない規律)
    (Number.isFinite(d.breadth_m) && d.breadth_m < RETAIL.BREADTH_KO_M
      ? (koBreadth.push(d), false)
      : true)
  );
  if (comps.length < RETAIL.MIN_COMPS) return null;

  // 地域要因: 対象と同一・近接地区の事例に限定(R3監査で地区指数方式を廃止)。
  // 近接限定で事例不足になる場合のみ全地区に拡大し、その旨をフラグで開示する
  const allowed = subjectDistrict ? ADJACENT_DISTRICTS[subjectDistrict] : null;
  const scoped = allowed ? comps.filter((d) => allowed.includes(d.district)) : [];
  const districtScoped = scoped.length >= RETAIL.MIN_COMPS;
  const mixedPool = districtScoped ? scoped : comps;

  // ---- 形状: 整形地限定プール(2026-08-13。R4監査の二重減価をデータで解いたもの) ----
  // 従来は house-deals.csv に形状列が無く、事例プールに旗竿・不整形が混入していた。
  // 対象側に満額の-25%を掛けると混入分と二重減価になるため、対象の形状補正を**半減**で当てていた。
  // 出典(utinokati listings)に「土地形状」列があると分かったので転記し、
  // **プールを整形地に限定できるなら対象の形状補正を満額適用する**方式へ切り替える。
  // 整形地だけでは事例が足りない場合のみ従来の混合プール+半減へ退避し、その旨を開示する。
  const regularPool = mixedPool.filter((d) => d.shape && REGULAR_SHAPES.has(d.shape));
  const shapeControlled = regularPool.length >= RETAIL.SHAPE_POOL_MIN;
  const usable = shapeControlled ? regularPool : mixedPool;
  const shapeWeight = shapeControlled ? 1 : 0.5;
  const shapeBasis = shapeControlled
    ? `整形地限定プール${regularPool.length}件(形状補正を満額適用)`
    : `混合プール${mixedPool.length}件(整形地${regularPool.length}件では不足のため形状補正は半減。形状不明${mixedPool.filter((d) => !d.shape).length}件を含む)`;

  // ---- 幅員の開示(2026-08-29)。除外した件数と、幅員が記載されていない件数を必ず出す ----
  const noBreadth = usable.filter((d) => !Number.isFinite(d.breadth_m)).length;
  const breadthBasis = [
    koBreadth.length
      ? `接道義務未充足(幅員${RETAIL.BREADTH_KO_M}m未満)の${koBreadth.length}件をプールから除外(${koBreadth.map((d) => `${d.district}${d.price_man}万/幅員${d.breadth_m}m`).join("・")})`
      : null,
    `幅員は標準条件4〜6mへ正規化済み${noBreadth ? `(うち幅員の記載がない${noBreadth}件は補正なし=判定しない)` : ""}`,
  ].filter(Boolean).join("。");

  const effTsubo = Math.max(0, s.land - s.setback) / COEFFS.TSUBO_M2;
  // 対象物件の個別要因(原価法と同じ係数体系)。複数駅補正は事例側の駅属性が不明なため適用しない
  const walkProp = walkAdjOf(s.walk);
  const cornerAdj = s.corner ? COEFFS.CORNER_ADJ : 0;
  // 形状補正の強さはプールの統制状況で決まる(上記 shapeWeight)。
  // 整形地限定プールなら満額(二重減価が起きない)、混合プールなら半減(従来の保守側ヒューリスティック)
  const subjectFactor = Math.max(0.1,
    (1 + walkProp + s.shape * shapeWeight + s.dir + s.roadq + cornerAdj + s.extra / 100)) * (1 + s.lc);

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
    shapeControlled,      // true=整形地限定プール(形状補正は満額) / false=混合プール(半減)
    shapeBasis,
    breadthBasis,         // 幅員の除外・正規化の開示文(黙って減らさない)
    koBreadth,            // 接道義務未充足で外した事例(件数と内訳)
    subjectDistrict,
    repairSubj,
    lo: quantile(units, 0.25) * effTsubo + bldgSubj,
    mid: landPart + bldgSubj,
    hi: quantile(units, 0.75) * effTsubo + bldgSubj,
  };
}
