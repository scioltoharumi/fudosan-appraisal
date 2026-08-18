// engine/rent.js — 戸建賃貸の評価エンジン(Node ESM・依存なし)
//
// 購入台帳との関係: 購入は「いくらで買うのが妥当か」を原価法+事例比較で出したが、
// 賃貸に同じ問いは立たない。借主が実際に払うのは表示賃料ではなく、
//   ① 一時金(礼金・仲介手数料・保証料・火災保険・鍵交換)を居住期間で割った分
//   ② 更新料
//   ③ 毎月の賃料+管理費+月額保証料
//   ④ 退去時の原状回復
// の合計であり、**居住年数で順位が入れ替わる**。よってこのエンジンの主役は
//   (A) 実質月額(居住年数の関数)  … effectiveMonthly()
//   (B) 募集賃料プールに対する水準  … fitRentModel() / benchmarkRent()
// の2つで、v3.0.0の思想どおり**判定(買う/借りる/見送り)は出さない**。
//
// (B)の重大な限界: 母集団は**成約ではなく募集賃料**である。賃貸の成約賃料は公開されていない。
// 「この賃料で決まった」ことを意味しないため、水準は「売り手の希望の分布の中での位置」でしかない。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./io.js";

// ---- CSV(引用符対応。walk_lines等に区切り文字が混じっても壊れないように自前で読む) ----
export function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (ch !== "\r") cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  const header = rows.shift();
  return rows.filter((r) => r.some((c) => c !== "")).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const num = (v) => (v === "" || v === undefined || v === null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function loadRentPool(path = join(ROOT, "market", "rent-listings.csv")) {
  return parseCsv(readFileSync(path, "utf8")).map((r) => ({
    captured_at: r.captured_at,
    source_id: r.source_id,
    district: r.district || null,
    chome: r.chome || null,
    rent_man: num(r.rent_man),
    kanri_man: num(r.kanri_man) ?? 0,
    total_man: num(r.total_man),
    area_m2: num(r.area_m2),
    layout: r.layout || null,
    rooms: num(r.rooms),
    has_ldk: r.has_ldk === "1",
    built_year: num(r.built_year),
    age_y: num(r.age_y),
    seismic: r.seismic || null,
    walk_min: num(r.walk_min),
    structure: r.structure || null,
    contract_type: r.contract_type || null,
    contract_years: num(r.contract_years),
    shiki_months: num(r.shiki_months),
    rei_months: num(r.rei_months),
    parking: r.parking || null,
    // 空欄は「トイレが1つ」ではなく「掲載に記載が無い」。false ではなく null で持つ
    toilet2: r.toilet2 === "1" ? true : null,
    source_url: r.source_url || null,
  })).filter((d) =>
    d.total_man > 0 && d.area_m2 > 0 &&
    Number.isFinite(d.age_y) && d.age_y >= 0 && d.age_y <= 100 &&
    Number.isFinite(d.walk_min) && d.walk_min >= 0 && d.walk_min <= 30);
}

// ---- 賃料モデル ----
// log(賃料+管理費) = a + b·log(専有面積) + c·築年 + d·徒歩分
// 面積は対数で入れる。実測(北区66件)の弾力性は約0.56で、**面積に比例しない**
// (2倍の家は2倍の賃料にならない)。線形で当てると大きい家を過大評価する。
export const RENT_MODEL_SEED = 20260818;
export const RENT_BOOT_N = 4000;

function ols(X, y) {
  const p = X[0].length;
  const A = Array.from({ length: p }, () => Array(p + 1).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) A[i][j] = X.reduce((s, r) => s + r[i] * r[j], 0);
    A[i][p] = X.reduce((s, r, k) => s + r[i] * y[k], 0);
  }
  for (let i = 0; i < p; i++) {
    let m = i;
    for (let k = i + 1; k < p; k++) if (Math.abs(A[k][i]) > Math.abs(A[m][i])) m = k;
    [A[i], A[m]] = [A[m], A[i]];
    if (Math.abs(A[i][i]) < 1e-12) return null;      // 特異行列(標本が足りない)
    for (let k = 0; k < p; k++) {
      if (k === i) continue;
      const f = A[k][i] / A[i][i];
      for (let j = i; j <= p; j++) A[k][j] -= f * A[i][j];
    }
  }
  return A.map((r, i) => r[p] / A[i][i]);
}

const design = (d) => [1, Math.log(d.area_m2), d.age_y, d.walk_min];

// 係数の95%信頼区間を固定シードのブートストラップで出す。
// **「判別可能か」を返すのが目的**で、点推定を飾るためではない(購入台帳の ageCurveCI と同じ思想)。
export function fitRentModel(pool, { bootN = RENT_BOOT_N, seed = RENT_MODEL_SEED } = {}) {
  const d = pool.filter((x) => x.total_man > 0 && x.area_m2 > 0);
  if (d.length < 12) return { ok: false, n: d.length, reason: `標本${d.length}件では係数を推定できない(最低12件)` };
  const y = d.map((x) => Math.log(x.total_man));
  const X = d.map(design);
  const coef = ols(X, y);
  if (!coef) return { ok: false, n: d.length, reason: "設計行列が特異(説明変数に十分な散らばりがない)" };

  const pred = X.map((r) => r.reduce((s, v, i) => s + v * coef[i], 0));
  const resid = y.map((v, i) => v - pred[i]);
  const ybar = y.reduce((a, c) => a + c, 0) / y.length;
  const ssr = resid.reduce((s, v) => s + v * v, 0);
  const sst = y.reduce((s, v) => s + (v - ybar) ** 2, 0);
  const sd = Math.sqrt(ssr / Math.max(1, y.length - X[0].length));

  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const draws = [[], [], [], []];
  for (let b = 0; b < bootN; b++) {
    const bx = [], by = [];
    for (let i = 0; i < d.length; i++) { const k = Math.floor(rnd() * d.length); bx.push(X[k]); by.push(y[k]); }
    const c = ols(bx, by);
    if (c) c.forEach((v, i) => draws[i].push(v));
  }
  const ci = draws.map((arr) => {
    const a = arr.sort((p, q) => p - q);
    return a.length ? { lo: a[Math.floor(0.025 * (a.length - 1))], hi: a[Math.floor(0.975 * (a.length - 1))] } : null;
  });
  // 「1.00倍(=効果なし)を区間が含むか」で判別可能性を言う。倍率へ直して読みやすくする
  const pct = (v) => (Math.exp(v) - 1) * 100;
  const terms = [
    { key: "intercept", label: "切片", est: coef[0], ci: ci[0], unit: "log", decisive: null },
    { key: "area", label: "面積の弾力性(log面積)", est: coef[1], ci: ci[1], unit: "elasticity",
      decisive: ci[1] ? ci[1].lo > 0 && ci[1].hi < 1 : null },
    { key: "age", label: "築年", est: coef[2], ci: ci[2], unit: "pct_per_year",
      est_pct: pct(coef[2]), ci_pct: ci[2] ? { lo: pct(ci[2].lo), hi: pct(ci[2].hi) } : null,
      decisive: ci[2] ? ci[2].hi < 0 || ci[2].lo > 0 : null },
    { key: "walk", label: "徒歩分", est: coef[3], ci: ci[3], unit: "pct_per_min",
      est_pct: pct(coef[3]), ci_pct: ci[3] ? { lo: pct(ci[3].lo), hi: pct(ci[3].hi) } : null,
      decisive: ci[3] ? ci[3].hi < 0 || ci[3].lo > 0 : null },
  ];
  return {
    ok: true, n: d.length, coef, terms, r2: 1 - ssr / sst, residSd: sd, bootN, seed,
    // 残差の帯(対数SD)を倍率に直したもの。「同じ条件でもこれくらいは散る」
    spreadPct: (Math.exp(sd) - 1) * 100,
    captured_at: d[0]?.captured_at ?? null,
  };
}

// ものさし賃料(賃料+管理費)。lo/hi は残差1SDの帯で、係数の不確実性ではなく
// 「同じ条件の物件でも現に散っている幅」を表す
export function benchmarkRent(model, { area_m2, age_y, walk_min }) {
  if (!model?.ok || !(area_m2 > 0)) return null;
  const x = [1, Math.log(area_m2), age_y ?? 0, walk_min ?? 0];
  const lg = x.reduce((s, v, i) => s + v * model.coef[i], 0);
  return { mid: Math.exp(lg), lo: Math.exp(lg - model.residSd), hi: Math.exp(lg + model.residSd) };
}

// ---- 実質月額 ----
// 掲載から読めない項目は既定値を使い、必ず assumed に印を残す(購入台帳の rent_assumed と同じ規律)。
// 出所: 都内実需帯の一般的な水準。**実額は申込時の見積りで置き換えること**
export const RENT_ASSUMPTIONS = {
  brokerage_months: 1.1,      // 仲介手数料(賃料の1.1ヶ月=消費税込みの上限)
  guarantee_initial_months: 0.5,  // 保証会社の初回保証委託料
  guarantee_monthly_pct: 1.0,     // 同 月額(賃料の%)
  insurance_man: 2.0,         // 火災保険(2年ごと)
  insurance_cycle_y: 2,
  key_exchange_man: 2.2,      // 鍵交換
  renewal_months: 1.0,        // 更新料(賃料の何ヶ月)
  renewal_cycle_y: 2,         // 更新周期
  restoration_months: 1.0,    // 退去時の原状回復見込(敷金から充当されるが借主の負担であることに変わりはない)
};

// 掲載の「備考」に埋まっている付帯費用を拾うための欄(2026-08-18に実測で必要性が判明)。
// 西ケ原4は消火剤7.095万+消毒3.685万+入居者サポート2.2万=**初期13万円**が備考にしか書かれておらず、
// 敷礼の欄だけを見ると実質月額を1万円/月(2年居住)過小に見積もる。
// 志茂4は退去時クリーニングが「1,540円×平米」の定額で、原状回復の想定より高い。
// これらは掲載の自由文にしか出ないため**人がYAMLへ書き写す**(機械抽出はしない=誤読の害が大きい)。

// 居住 years 年での実質月額。返り値は内訳つき(どこが効いているか見えないと意味がない)
export function effectiveMonthly(p, years, a = RENT_ASSUMPTIONS) {
  const rent = p.rent_man ?? 0;
  const kanri = p.kanri_man ?? 0;
  const months = Math.max(1, Math.round(years * 12));
  const rei = (p.rei_months ?? 0) * rent;
  const brokerage = (p.brokerage_months ?? a.brokerage_months) * rent;
  const guaranteeInit = (p.guarantee_initial_months ?? a.guarantee_initial_months) * rent;
  const keyExchange = p.key_exchange_man ?? a.key_exchange_man;
  // 保険の更新周期は物件ごとに違う(2年契約が多いが1年のものもある)。既定に丸めない
  const insCycleY = p.insurance_cycle_y ?? a.insurance_cycle_y;
  const insCycles = Math.max(1, Math.ceil(years / insCycleY));
  const insurance = (p.insurance_man ?? a.insurance_man) * insCycles;
  const renewCycle = p.renewal_cycle_y ?? a.renewal_cycle_y;
  // 2年契約で2年ちょうど住むなら更新は起きない。3年目に入る時点で1回
  const renewals = Math.max(0, Math.ceil(years / renewCycle) - 1);
  const renewal = renewals * (p.renewal_months ?? a.renewal_months) * rent;
  const guaranteeMonthly = rent * ((p.guarantee_monthly_pct ?? a.guarantee_monthly_pct) / 100)
    + (p.guarantee_monthly_man ?? 0);
  const miscMonthly = p.misc_monthly_man ?? 0;      // 24時間サポート等の月額付帯
  const monthly = (rent + kanri + guaranteeMonthly + miscMonthly) * months;
  const miscInitial = p.misc_initial_man ?? 0;      // 消火剤・消毒・入居者サポート等の初期付帯
  // 退去時費用は「定額クリーニング」が書いてあればそれを優先する(原状回復の想定より確度が高い)
  const restoration = p.cleaning_man != null ? p.cleaning_man : (p.restoration_months ?? a.restoration_months) * rent;

  const oneTime = rei + brokerage + guaranteeInit + keyExchange + insurance + miscInitial;
  const total = oneTime + renewal + monthly + restoration;
  return {
    years, months, renewals,
    // 入居時に用意する現金(敷金を含む。敷金は原則返るので下の total には入れない)
    cashAtStart: (p.shiki_months ?? 0) * rent + rei + brokerage + guaranteeInit + keyExchange
      + (p.insurance_man ?? a.insurance_man) + miscInitial + rent + kanri,
    breakdown: {
      rentAndKanri: (rent + kanri) * months,
      guaranteeMonthly: guaranteeMonthly * months,
      miscMonthly: miscMonthly * months,
      reikin: rei, brokerage, guaranteeInit, keyExchange, insurance, miscInitial, renewal, restoration,
    },
    total,
    monthlyEq: total / months,
    // 表示賃料との差。「21万の物件が実は何万か」がこの台帳の主目的
    premiumOverListed: total / months - (rent + kanri),
  };
}

// 居住年数1〜10年の実質月額カーブ
export function effectiveMonthlyCurve(p, a = RENT_ASSUMPTIONS, maxY = 10) {
  return Array.from({ length: maxY }, (_, i) => effectiveMonthly(p, i + 1, a));
}

// ---- 物件の評価 ----
// asOf は呼び出し元によって Date(engine/appraise.js の defaultAsOf)か文字列で来る。
// Date を String() すると "Mon Aug 18 2026 ..." になり年の切り出しが壊れるので必ず正規化する
export function asOfString(asOf) {
  if (asOf instanceof Date) return asOf.toISOString().slice(0, 10);
  return String(asOf ?? "").slice(0, 10);
}

export function evaluateRent(property, { pool, model, asOf, assumptions = RENT_ASSUMPTIONS } = {}) {
  const asOfStr = asOfString(asOf);
  const t = property.terms ?? {};
  const b = property.building ?? {};
  const st = property.station ?? {};
  const rent = t.rent_man ?? null;
  const kanri = t.kanri_man ?? 0;
  const total = rent != null ? rent + kanri : null;
  const age = b.built_year ? Math.max(0, Number(asOfStr.slice(0, 4)) - b.built_year) : null;

  const inputs = {
    rent_man: rent, kanri_man: kanri,
    shiki_months: t.shiki_months ?? null, rei_months: t.rei_months ?? null,
    brokerage_months: t.brokerage_months ?? null,
    guarantee_initial_months: t.guarantee_initial_months ?? null,
    guarantee_monthly_pct: t.guarantee_monthly_pct ?? null,
    guarantee_monthly_man: t.guarantee_monthly_man ?? null,
    insurance_man: t.insurance_man ?? null, insurance_cycle_y: t.insurance_cycle_y ?? null,
    renewal_months: t.renewal_months ?? null, renewal_cycle_y: t.renewal_cycle_y ?? null,
    key_exchange_man: t.key_exchange_man ?? null, restoration_months: t.restoration_months ?? null,
    misc_initial_man: t.misc_initial_man ?? null, misc_monthly_man: t.misc_monthly_man ?? null,
    cleaning_man: t.cleaning_man ?? null,
  };
  const curve = effectiveMonthlyCurve(inputs, assumptions);
  const bench = model && b.floor_m2 ? benchmarkRent(model, { area_m2: b.floor_m2, age_y: age, walk_min: st.walk_min }) : null;

  // 仮定を使った項目を名指しで開示する(掲載に無かったもの)
  const assumed = [];
  if (inputs.brokerage_months == null) assumed.push(`仲介手数料 ${assumptions.brokerage_months}ヶ月`);
  if (inputs.guarantee_initial_months == null) assumed.push(`保証料(初回) ${assumptions.guarantee_initial_months}ヶ月`);
  if (inputs.guarantee_monthly_pct == null) assumed.push(`保証料(月額) 賃料の${assumptions.guarantee_monthly_pct}%`);
  if (inputs.insurance_man == null) assumed.push(`火災保険 ${assumptions.insurance_man}万円/${assumptions.insurance_cycle_y}年`);
  if (inputs.key_exchange_man == null) assumed.push(`鍵交換 ${assumptions.key_exchange_man}万円`);
  if (inputs.renewal_months == null) assumed.push(`更新料 ${assumptions.renewal_months}ヶ月/${assumptions.renewal_cycle_y}年`);
  if (inputs.restoration_months == null) assumed.push(`退去時の原状回復 ${assumptions.restoration_months}ヶ月`);

  return {
    id: property.id, asOf: asOfStr,
    listed: { rent_man: rent, kanri_man: kanri, total_man: total },
    age_y: age,
    curve,
    at2y: effectiveMonthly(inputs, 2, assumptions),
    at4y: effectiveMonthly(inputs, 4, assumptions),
    benchmark: bench,
    // 実測/ものさし。1.00 = 募集賃料の分布のまん中と同じ水準
    ratio: bench && total ? total / bench.mid : null,
    assumed,
    // 事実の提示。ラベル(割安/割高)は付けない — 判定は人がする(v3.0.0)
    position: positionOf({ total, bench, curve }),
  };
}

// 探索の漏斗。母集団から候補まで**各段で何件落ちたか**を返す。
// 数字をページに手書きせず、必ずこの関数の実測を通す(母集団が変われば表示も変わる)。
// 段の順序は「安い条件から順に」ではなく「掲載から確実に読める順に」置いてある
// 許容する定期借家の年数。crawler/rent-screen.mjs の TEIKI_OK_YEARS と同じ値を持つ
// (エンジンはクローラに依存しない方針なので定数を二重に置き、tests/rent-engine.test.js で一致を検査する)
export const TEIKI_OK_YEARS = [3];

export function rentFunnel(pool, cfg = { total_min_man: 15, total_max_man: 25, walk_max: 10, rooms_min: 3, teiki_ok_years: TEIKI_OK_YEARS }) {
  const steps = [];
  let f = pool;
  steps.push({ label: "北区の戸建賃貸(SUUMO・一戸建てのみ)", n: f.length, dropped: 0 });
  const step = (label, pred) => {
    const before = f.length;
    f = f.filter(pred);
    steps.push({ label, n: f.length, dropped: before - f.length });
  };
  step(`賃料+管理費 ${cfg.total_min_man}〜${cfg.total_max_man}万`, (d) => d.total_man >= cfg.total_min_man && d.total_man <= cfg.total_max_man);
  step(`最寄り駅 徒歩${cfg.walk_max}分以内`, (d) => d.walk_min != null && d.walk_min <= cfg.walk_max);
  step(`${cfg.rooms_min}LDK以上(納戸Sは1室として数える)`, (d) => d.rooms >= cfg.rooms_min && d.has_ldk);
  step("新耐震(1982年以降竣工)", (d) => d.seismic === "new");
  // 定期借家は**ちょうど3年だけ許容**する(2026-08-18ユーザー指示: 子供の小学校入学前の区切り)。
  // 短いからKOではなく長さの要件なので、2年も4年以上も落ちる
  const okYears = cfg.teiki_ok_years ?? TEIKI_OK_YEARS;
  step(`定期借家は${okYears.join("・")}年ちょうどのみ可(2026-08-18ユーザー指示)`,
    (d) => d.contract_type !== "teiki" || okYears.includes(d.contract_years));
  const survivors = f;
  // 参考: ここにトイレ2ヶ所の記載を足すと何件になるか。**条件には入れていない**
  const withToilet2 = f.filter((d) => d.toilet2 === true).length;
  // 生存のうち定期借家(許容年数)の掲載数と、仮に定期借家を全部KOにしたら何件減るか。
  // 「3年だけ許容している」という条件の効き具合をページで開示するために返す
  const teikiAllowed = survivors.filter((d) => d.contract_type === "teiki").length;
  return { steps, survivors, withToilet2, teikiAllowed, teikiOkYears: okYears,
    teikiInPool: pool.filter((d) => d.contract_type === "teiki").length,
    toilet2Documented: pool.filter((d) => d.toilet2 === true).length, poolN: pool.length };
}

function positionOf({ total, bench, curve }) {
  const notes = [];
  if (bench && total) {
    const r = total / bench.mid;
    notes.push(`募集賃料モデルのものさし ${bench.mid.toFixed(1)}万(同条件の散らばり ${bench.lo.toFixed(1)}〜${bench.hi.toFixed(1)}万)に対し実測 ${total}万 = ${(r * 100).toFixed(0)}%`);
    if (total >= bench.lo && total <= bench.hi) notes.push("同条件の物件が現に散っている幅の中にあり、この標本では水準の差を言えない");
  }
  const c2 = curve.find((x) => x.years === 2), c4 = curve.find((x) => x.years === 4);
  if (c2 && c4) {
    notes.push(`実質月額は2年住むなら${c2.monthlyEq.toFixed(1)}万・4年なら${c4.monthlyEq.toFixed(1)}万(一時金が年数で薄まる)`);
    notes.push(`表示賃料+管理費に対する上乗せは2年で${c2.premiumOverListed.toFixed(1)}万/月`);
  }
  return { basis: "募集賃料プール(成約ではない)と一時金の月額均し", notes };
}
