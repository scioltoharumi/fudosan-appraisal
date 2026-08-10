// engine/appraise.js — 査定コア(akabane_simulator.html v1.2 ロジックの完全移植)
// pure function・依存ゼロ。係数はすべて本ファイル冒頭の定数ブロックに集約する(マジックナンバー散在禁止)。
// 回帰照合: 2026-07-19基準日・本物件(赤羽台3)で 判定「保留」/ 適正中央値5,952万 / 楽観上限6,562万。
//
// 移植時の設計変更(steering decisions.md D3):
//   - 評価基準日(asOf)と乱数seedを引数注入可能にした。既定は実行日のUTC0時＝同日内は再現可能。
//   - それ以外の数式・係数・文言分岐は v1.2 と同一。

import { retailEstimate } from "./retail.js";

export const ENGINE_VERSION = "2.0.0 (2026-08監査反映: bm適用範囲修正・建物モデル更新・リテール比較法追加)";

// ---- 係数ブロック(根拠コメント付き) ----
export const COEFFS = {
  TSUBO_M2: 3.30578,                    // 1坪 = 3.30578m2
  KOJI_BASE_UTC: Date.UTC(2025, 0, 1),  // 公示地価2025の基準日。時点修正の起点
  YEAR_MS: 31557600000,                 // 365.25日(ミリ秒)。経過年の分母
  DEFAULT_RISE: 0.10,                   // 年率地価上昇率。赤羽の直近実勢+10〜14%の保守側
  WALK_ADJ_PER_MIN: -0.012,             // 徒歩は10分基準で1分あたり±1.2%
  WALK_BASE_MIN: 10,
  CORNER_ADJ: 0.03,                     // 角地+3%。両路とも建築基準法上の道路の場合のみ
  MULTI_STATION_ADJ: 0.02,              // 複数駅・複数路線は再販時の訴求力で+2%
  SIZE_SMALL_TSUBO: 13,                 // 13坪未満: 狭小地。1坪不足あたり-0.5%(最大-5%)
                                        // (2026-08監査: 13〜20坪は23区実勢で需要が厚く単価は落ちないためペナルティ撤廃)
  SIZE_SMALL_RATE: 0.005,
  SIZE_SMALL_CAP: 0.05,
  SIZE_LARGE_TSUBO: 45,                 // 45坪超: 総額が張り需要層が薄い。1坪超過あたり-0.2%(最大-8%)
  SIZE_LARGE_RATE: 0.002,
  SIZE_LARGE_CAP: 0.08,
  BUILDING_LIFE_Y: 30,                  // 木造建物の市場評価の逓減年数。維持管理された建物の実勢(2026-08監査で22→30)。
                                        // 維持不明の物件は繰延修繕控除(DEFAULT_REPAIR_MAN)が「維持されていた前提」との差分を埋める
  NO_REBUILD_ADJ: -0.30,                // 再建築不可等の重大制約(ローン不可・買い手が現金投資家に限定)
  PPT_UNCERTAINTY: 0.10,                // 基準坪単価の±10%でlo/hiレンジを構成
  DEFAULT_REBUILD_PPT: 95,              // 再調達単価(万円/坪)。2026年の木造実勢建築費90〜110万の保守側(監査で70→95)
  DEFAULT_DEMOLITION_MAN: 150,          // 解体費既定(万円)。木造2階4〜5万/延床坪、3階・準防火・道路狭小5〜8万
  DEFAULT_REPAIR_MAN: 800,              // 大規模修繕「未実施の可能性大」の想定(万円)
  DEFAULT_FEE_RATE: 0.05,               // 諸費用率
  DEFAULT_EXPENSE_RATE: 0.15,           // 戸建賃貸の経費率(固都税・修繕・空室で15〜20%)
  DEFAULT_CAP_RATE: 0.045,              // 還元利回り
  MC_TRIALS: 5000,                      // モンテカルロ試行数(F2-5)
  MC_SEED: 20260719,                    // 乱数seed既定値(再現性確保)
  MC_BINS: 48,                          // ヒストグラムのビン数
  BUDGET_CAP_MAN: 10000,                // 心理的上限1億円
};

// ---- 選択式補正の対応表(物件YAMLの列挙値 → 補正率) ----
export const ROAD_QUALITY = {
  good_4m: 0,          // 幅員4m以上・良好
  setback_2ko: -0.05,  // 4m未満(42条2項道路)
  road_doubt: -0.10,   // 接道に疑義(通路等・要調査)
};
export const DIRECTION = {
  S: 0.05,                          // 南
  E: 0.02, SE: 0.02, SW: 0.02,      // 東・南東・南西
  W: 0,                             // 西
  N: -0.03, NE: -0.03, NW: -0.03,   // 北系
};
export const SHAPE = {
  regular: 0,
  slightly_irregular: -0.05,
  flagpole: -0.25,     // 旗竿地
};
export const BUILDING_TYPE = {
  wood_std: 0,          // 木造2階建等の標準
  wood_3f_narrow: -0.05 // 木造3階建・狭小(建物残価が残る場合のみ適用)
};

// ---- ユーティリティ ----

// 評価基準日の既定: 実行日のUTC0時(同日内のビルドを再現可能にする)
export function defaultAsOf(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// 公示基準日からの経過年(時点修正の指数)
export function elapsedYears(asOf) {
  return (asOf.getTime() - COEFFS.KOJI_BASE_UTC) / COEFFS.YEAR_MS;
}

// "YYYY-MM" / "YYYY-MM-DD" / Date のいずれからも築年数(年・小数)を出す
export function ageYears(built, asOf) {
  let t;
  if (built instanceof Date) {
    t = built.getTime();
  } else {
    const m = String(built).match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
    if (!m) throw new Error(`building.built を解釈できません: ${built}`);
    t = Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1);
  }
  return Math.max(0, (asOf.getTime() - t) / COEFFS.YEAR_MS);
}

export const fmtMan = (n) => {
  n = Math.round(n);
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 10000) {
    const oku = Math.floor(a / 10000), man = a % 10000;
    return sign + (man === 0 ? oku + "億円" : oku + "億" + man.toLocaleString("en-US") + "万円");
  }
  return sign + a.toLocaleString("en-US") + "万円";
};
export const pct = (x) => (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%";

// ---- 査定コア(v1.2逐語移植。不変条件: floorVal <= fair を全域で保証) ----
// s: 正規化済み入力(toStateの出力)。opts.elapsed: 経過年。opts.pptOverride / opts.noise はレンジ・MC用
export function appraise(s, opts = {}) {
  const noise = opts.noise || {};
  const elapsed = opts.elapsed;
  if (typeof elapsed !== "number") throw new Error("opts.elapsed(経過年)が必要です");
  const basePpt = opts.pptOverride !== undefined ? opts.pptOverride : s.ppt;
  const ppt = basePpt * Math.pow(1 + s.rise, elapsed);            // 時点修正
  const eff = Math.max(0, s.land - s.setback);                    // 実効宅地
  const tsubo = eff / COEFFS.TSUBO_M2;
  const walkAdj = COEFFS.WALK_ADJ_PER_MIN * (s.walk - COEFFS.WALK_BASE_MIN);
  const cornerAdj = s.corner ? COEFFS.CORNER_ADJ : 0;
  const mstAdj = s.mst ? COEFFS.MULTI_STATION_ADJ : 0;
  let sizeAdj = 0;                                                // クリフなしの線形ランプ
  if (tsubo < COEFFS.SIZE_SMALL_TSUBO) {
    sizeAdj = -Math.min(COEFFS.SIZE_SMALL_CAP, COEFFS.SIZE_SMALL_RATE * (COEFFS.SIZE_SMALL_TSUBO - tsubo));
  } else if (tsubo > COEFFS.SIZE_LARGE_TSUBO) {
    sizeAdj = -Math.min(COEFFS.SIZE_LARGE_CAP, COEFFS.SIZE_LARGE_RATE * (tsubo - COEFFS.SIZE_LARGE_TSUBO));
  }
  let adj = walkAdj + s.dir + s.roadq + s.shape + cornerAdj + mstAdj + sizeAdj + s.extra / 100;
  if (noise.adj) adj += noise.adj;
  const landRaw = ppt * (1 + adj) * tsubo;
  const land2 = landRaw * (1 + s.lc);                             // 土地制約は常時適用
  let resid = Math.max(0, 1 - s.age / COEFFS.BUILDING_LIFE_Y) * s.rebuild * (s.floor / COEFFS.TSUBO_M2);
  if (noise.resid) resid = Math.max(0, resid * (1 + noise.resid));
  const alive = resid > 0;
  const demo = Math.max(0, s.demo * (1 + (noise.demo || 0)));
  const rep = Math.max(0, s.repair * (1 + (noise.rep || 0)));
  const asLand = land2 - demo;                                    // 土地として売る価値
  // 建物市場性補正(bm)は建物残価のみに適用(2026-08監査: 土地込みに掛かっていたバグを修正)
  const asHome = land2 + resid * (1 + s.bm) - rep;                // 住まいとして売る価値
  const fair = alive ? Math.max(asHome, asLand) : asLand;         // 高い方の売却ルートが市場価格
  const floorVal = asLand;                                        // フロア=確実な下値(常に土地−解体費)
  const route = (!alive || asLand >= asHome) ? "land" : "home";
  return { landRaw, land2, resid, alive, asLand, asHome, fair, floorVal, route, tsubo, adj, walkAdj, cornerAdj, mstAdj, sizeAdj, pptAdj: ppt };
}

// lo/mid/hi の3点査定(基準坪単価±10%)
export function appraiseRange(s, elapsed) {
  return {
    mid: appraise(s, { elapsed }),
    lo: appraise(s, { elapsed, pptOverride: s.ppt * (1 - COEFFS.PPT_UNCERTAINTY) }),
    hi: appraise(s, { elapsed, pptOverride: s.ppt * (1 + COEFFS.PPT_UNCERTAINTY) }),
  };
}

// ---- 判定(v1.2の文言・閾値を移植) ----
export function verdict(s, mid, lo, hi) {
  const premium = s.ask - mid.fair;
  if (mid.fair < 0) {
    return {
      mark: "不能", cls: "",
      head: "査定不能:解体費が土地価値を上回る(事実上の負動産)",
      body: "入力条件では土地価値より処分コストが大きく、価格が付きません。入力値(面積・解体費・制約)を再確認してください。",
    };
  }
  if (s.ask <= mid.floorVal) {
    return {
      mark: "買", cls: "ok",
      head: "解体費控除後の土地値以下。資産防衛の観点では合格圏",
      body: "土地として売る際の下値フロア中央値(" + fmtMan(mid.floorVal) + ")を売出価格が下回る構造。悲観シナリオ(坪単価−10%)の下値は " + fmtMan(lo.floorVal) + " で、これも意識した指値が理想。" + (mid.alive ? "建物残価はタダで付いてくる。" : "") + "残る論点は接道種別・擁壁・瑕疵の確認のみ。",
    };
  }
  if (s.ask <= hi.fair) {
    return {
      mark: "保留", cls: "warn",
      head: "査定レンジ内。交渉次第",
      body: "下値フロア(中央値 " + fmtMan(mid.floorVal) + "・悲観 " + fmtMan(lo.floorVal) + ")との差 " + fmtMan(s.ask - mid.floorVal) + " を" + (mid.route === "home" ? "建物の残り価値" : mid.route === "retail" ? "周辺の戸建成約水準(リテール市場)" : "土地の上振れ期待") + "に払う構図。査定中央値との乖離は " + (premium >= 0 ? "+" : "") + fmtMan(premium) + "。指値の錨は「査定中央値 " + fmtMan(mid.fair) + "」。",
    };
  }
  return {
    mark: "見送", cls: "",
    head: "査定上限を超過。プレミアムに払っている",
    body: "楽観シナリオ(坪単価+10%)でも " + fmtMan(s.ask - hi.fair) + " の説明不能な上乗せ。売主に価格根拠を説明させるか、査定上限 " + fmtMan(hi.fair) + " 近辺への指値が前提。",
  };
}

// ---- 乱数(seed固定で再現可能: F2-5) ----
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- モンテカルロ(v1.2移植 + seed注入。rise不確実性±2pt・負値クランプ込み) ----
export function monteCarlo(s, elapsed, { seed = COEFFS.MC_SEED, trials = COEFFS.MC_TRIALS, bins = COEFFS.MC_BINS } = {}) {
  const rand = mulberry32(seed);
  const tri = (a, c, b) => {
    const u = rand(), F = (c - a) / (b - a);
    return u < F ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c));
  };
  const gauss = () => {
    let u = 0, v = 0;
    while (!u) u = rand();
    while (!v) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const samples = new Float64Array(trials);
  for (let i = 0; i < trials; i++) {
    const pptFactor = tri(0.88, 1.0, 1.13);
    const riseS = Math.max(0, s.rise + gauss() * 0.02);      // 地価上昇率の不確実性(±2pt)
    const a = appraise({ ...s, rise: riseS }, {
      elapsed,
      pptOverride: s.ppt * pptFactor,
      noise: {
        adj: 0.3 * (pptFactor - 1) + gauss() * 0.015,        // 相場と個別格差の正相関
        resid: gauss() * 0.15,
        demo: gauss() * 0.20,
        rep: gauss() * 0.25,
      },
    });
    const modelErr = 1 + gauss() * 0.05;                     // モデル構造誤差±5%
    samples[i] = a.fair * modelErr;
  }
  samples.sort();
  const p = (q) => samples[Math.floor(q * (trials - 1))];
  let idx = 0;
  while (idx < trials && samples[idx] < s.ask) idx++;
  const askPercentile = (idx / trials) * 100;

  const histLo = p(0.001), histHi = p(0.999);
  const span = Math.max(1, histHi - histLo);
  const counts = new Array(bins).fill(0);
  samples.forEach((v) => {
    let b = Math.floor(((v - histLo) / span) * bins);
    if (b < 0) b = 0;
    if (b >= bins) b = bins - 1;
    counts[b]++;
  });
  return {
    seed, trials,
    p10: p(0.10), p50: p(0.50), p90: p(0.90),
    askPercentile,
    hist: { lo: histLo, hi: histHi, counts },
  };
}

// ---- 感度分析(トルネード: v1.2移植) ----
export function tornado(s, elapsed) {
  const f = (st) => appraise(st, { elapsed }).fair;
  const baseFair = f(s);
  const scenarios = [
    ["坪単価 ±10%", { ...s, ppt: s.ppt * 0.9 }, { ...s, ppt: s.ppt * 1.1 }],
    ["地価上昇率 5⇔15%", { ...s, rise: 0.05 }, { ...s, rise: 0.15 }],
    ["徒歩 ±3分", { ...s, walk: Math.min(20, s.walk + 3) }, { ...s, walk: Math.max(1, s.walk - 3) }],
    ["私道負担ゼロなら", null, { ...s, setback: 0 }],
    ["接道が通路認定なら", { ...s, roadq: -0.10 }, null],
    ["解体費 ±100万", { ...s, demo: s.demo + 100 }, { ...s, demo: Math.max(0, s.demo - 100) }],
    ["築 +5年", { ...s, age: Math.min(45, s.age + 5) }, null],
  ];
  const results = scenarios.map(([label, sLo, sHi]) => ({
    label,
    dLo: sLo ? f(sLo) - baseFair : 0,
    dHi: sHi ? f(sHi) - baseFair : 0,
  }));
  results.sort((a, b) =>
    Math.max(Math.abs(b.dLo), Math.abs(b.dHi)) - Math.max(Math.abs(a.dLo), Math.abs(a.dHi)));
  return results;
}

// ---- 物件YAML(オブジェクト) → 正規化入力state ----
// 抽出できない項目は保守的デフォルトを適用し、assumptions配列に必ず記録する(F1-3)
export function toState(property, areaConfig, asOf) {
  const assumptions = [];
  const note = (field, value, why) => assumptions.push({ field, value, why });

  const areaKey = property.location?.area;
  const area = areaConfig.areas?.[areaKey];
  if (!area && property.ppt_man_override === undefined) {
    throw new Error(`エリア「${areaKey}」がarea-config.yamlに未定義で、ppt_man_overrideもありません`);
  }
  let ppt;
  if (property.ppt_man_override !== undefined) {
    ppt = property.ppt_man_override;
    note("基準坪単価", ppt + "万/坪", "物件YAMLの明示上書き(F2-3)");
  } else {
    ppt = area.ppt_man;
  }

  const ph = property.price_history || [];
  if (ph.length === 0) throw new Error("price_historyが空です");
  const ask = ph[ph.length - 1].price_man;

  const road = property.land?.road || {};
  let roadq = ROAD_QUALITY[road.quality];
  if (roadq === undefined) { roadq = ROAD_QUALITY.setback_2ko; note("接道の質", "4m未満(−5%)", "記載なしのため保守側既定"); }
  let dir = DIRECTION[road.direction];
  if (dir === undefined) { dir = DIRECTION.W; note("接道方位", "西相当(±0%)", "記載なしのため中立既定"); }
  let shape = SHAPE[property.land?.shape];
  if (shape === undefined) { shape = SHAPE.regular; note("土地形状", "整形地(±0%)", "記載なしのため既定"); }

  const rebuildable = property.land?.legal?.rebuildable;
  const lc = rebuildable === false ? COEFFS.NO_REBUILD_ADJ : 0;

  const repair = property.building?.repair || {};
  let repairMan = repair.cost_man;
  if (repairMan === undefined) { repairMan = COEFFS.DEFAULT_REPAIR_MAN; note("繰延修繕", repairMan + "万", "修繕記載なし→未実施の可能性大の保守想定"); }
  else if (repair.assumed) { note("繰延修繕", repairMan + "万", repair.status || "YAMLでassumed指定"); }

  let demoMan = property.costs?.demolition_man;
  if (demoMan === undefined) { demoMan = COEFFS.DEFAULT_DEMOLITION_MAN; note("解体費", demoMan + "万", "実見積なし→既定値"); }
  else if (property.costs?.demolition_assumed) { note("解体費", demoMan + "万", "実見積なしの想定値"); }

  let fee = property.costs?.fee_rate;
  if (fee === undefined) { fee = COEFFS.DEFAULT_FEE_RATE; note("諸費用率", (fee * 100) + "%", "記載なしのため既定"); }

  const income = property.income || {};
  const rent = income.rent_man ?? 0;
  if (income.rent_assumed && rent > 0) note("想定賃料", "月" + rent + "万", "周辺実勢未確認の仮置き");

  let bm = BUILDING_TYPE[property.building?.type];
  if (bm === undefined) { bm = BUILDING_TYPE.wood_std; note("建物市場性", "標準(±0%)", "記載なしのため既定"); }

  const rebuild = property.building?.rebuild_ppt_man ?? COEFFS.DEFAULT_REBUILD_PPT;

  const s = {
    ppt,
    rise: areaConfig.rise_rate ?? COEFFS.DEFAULT_RISE,
    ask,
    land: property.land?.registered_m2,
    setback: property.land?.setback_m2 ?? 0,
    walk: property.station?.walk_min,
    roadq, dir, shape, lc,
    corner: road.corner === true,
    mst: property.station?.multi_station === true,
    extra: property.extra_adj_pct ?? 0,
    age: ageYears(property.building?.built, asOf),
    floor: property.building?.floor_m2,
    bm, rebuild,
    demo: demoMan,
    repair: repairMan,
    fee,
    rent,
    expr: income.expense_rate ?? COEFFS.DEFAULT_EXPENSE_RATE,
    yld: income.cap_rate ?? COEFFS.DEFAULT_CAP_RATE,
  };
  for (const [k, v] of Object.entries({ land: s.land, walk: s.walk, floor: s.floor, ask: s.ask })) {
    if (typeof v !== "number" || Number.isNaN(v)) throw new Error(`必須項目 ${k} が数値ではありません: ${v}`);
  }
  return { state: s, assumptions, area: area ? { key: areaKey, ...area } : { key: areaKey, source: "override" } };
}

// ---- 総合評価(F2-4: 判定/フロア/適正lo-mid-hi/乖離/含み損/補正内訳/採用した仮定一覧) ----
// houseDeals(retail.jsのloadHouseDeals()の戻り値)を渡すと、原価法(土地+建物)に加えて
// リテール比較法(中古戸建成約の事例比較)を併算し、高い方の売却ルートを適正価格に採用する。
export function evaluate(property, areaConfig, { asOf = defaultAsOf(), seed = COEFFS.MC_SEED, houseDeals = null } = {}) {
  const elapsed = elapsedYears(asOf);
  const { state: s, assumptions, area } = toState(property, areaConfig, asOf);
  const { mid, lo, hi } = appraiseRange(s, elapsed);

  // リテール比較法(2026-08監査対応)。事例不足(MIN_COMPS未満)ならnull
  const retail = houseDeals ? retailEstimate(s, asOf, houseDeals) : null;
  const fairLo = Math.max(lo.fair, retail?.lo ?? -Infinity);
  const fairMid = Math.max(mid.fair, retail?.mid ?? -Infinity);
  const fairHi = Math.max(hi.fair, retail?.hi ?? -Infinity);
  const finalRoute = retail && retail.mid > mid.fair ? "retail" : mid.route;
  const fairFinal = { lo: fairLo, mid: fairMid, hi: fairHi, route: finalRoute, costMid: mid.fair };

  const v = verdict(s,
    { ...mid, fair: fairMid, route: finalRoute },
    { ...lo, fair: fairLo },
    { ...hi, fair: fairHi });
  const premium = s.ask - fairMid;
  // 土地ルートでは建物は解体されるため修繕費は取得コストに含めない(監査: instLossの不整合修正)
  const totalCost = s.ask * (1 + s.fee) + (finalRoute === "land" ? 0 : s.repair);
  const instLoss = totalCost - fairMid;                // 即時含み損
  const incomeVal = s.rent > 0 ? (s.rent * 12 * (1 - s.expr)) / s.yld : null;
  const mc = monteCarlo(s, elapsed, { seed });         // 原価法側のばらつき(リテール比較は含まない)
  const tor = tornado(s, elapsed);
  return {
    id: property.id,
    asOf: asOf.toISOString().slice(0, 10),
    elapsed,
    engineVersion: ENGINE_VERSION,
    state: s,
    area,
    assumptions,
    mid, lo, hi,
    retail, fairFinal,
    verdict: v,
    premium, totalCost, instLoss, incomeVal,
    mc, tornado: tor,
  };
}
