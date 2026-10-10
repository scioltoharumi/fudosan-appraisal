// site/build.js — 全物件YAMLを査定し、静的サイトを site/dist/ に生成する
// 使い方: node site/build.js
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate, defaultAsOf } from "../engine/appraise.js";
import { ROOT, loadAreaConfig, loadProperty, listPropertyIds, loadRental, listRentalIds } from "../engine/io.js";
import { readRentPoolCsv, fitRentModel, evaluateRent, rentFunnel } from "../engine/rent.js";
import { renderRentIndex } from "./templates/rent-index.js";
import { renderRentProperty } from "./templates/rent-property.js";
import { renderRentBasis } from "./templates/rent-basis.js";
import { renderIndex } from "./templates/index.js";
import { renderProperty } from "./templates/property.js";
import { crawlLinksOf } from "./templates/layout.js";
import { renderGuide } from "./templates/guide.js";
import { calibrate } from "../engine/calibrate.js";
import { loadHouseDeals } from "../engine/retail.js";
import { renderMarketBasis } from "./templates/market-basis.js";
import { renderDataExplorer } from "./templates/data-explorer.js";
import { renderFormula, ageCurveCI } from "./templates/formula.js";
import { renderCliff } from "./templates/cliff.js";
import { renderSimulate } from "./templates/simulate.js";
import { renderTradeoff } from "./templates/tradeoff.js";
import { renderEffort } from "./templates/effort.js";
import { renderDecision } from "./templates/decision.js";
import { renderHazardMap } from "./templates/map.js";
import { loadVerification } from "../engine/retail.js";
import { loadDeals } from "../engine/calibrate.js";

// 前提知識ガイドの題材物件(存在しなければ先頭の物件にフォールバック)
const GUIDE_EXAMPLE_ID = "jujonakahara3-adcast";

const DIST = join(ROOT, "site", "dist");
mkdirSync(join(DIST, "property"), { recursive: true });

const areaConfig = loadAreaConfig();
// crawl_ids → 参照リンクの復元に使う(source_url を空にしている物件でも掲載元へ辿れるようにする)
let seenCrawl = {};
try { seenCrawl = JSON.parse(readFileSync(join(ROOT, "market", "crawl", "seen.json"), "utf8")); } catch { seenCrawl = {}; }
const ids = listPropertyIds();
if (ids.length === 0) {
  console.error("properties/ に物件YAMLがありません");
  process.exit(1);
}

// 成約較正(market/deals.csv + benchmarks.yaml から決定的に算出)
const cal = calibrate();
const asOfBuild = defaultAsOf();   // UTC日跨ぎで物件間の基準日が混在しないよう1回だけ確定
// 戸建成約(リテール比較法の事例プール)
const houseDeals = loadHouseDeals();

const results = [];
for (const id of ids) {
  const property = loadProperty(id);
  property.crawl_links = crawlLinksOf(property, seenCrawl);
  if (property.id !== id) {
    throw new Error(`ファイル名とid不一致: ${id}.yaml の id は ${property.id}`);
  }
  // 本査定(成約較正+リテール比較を含む)。rRefは較正を外した公示ベースの参考値
  const r = evaluate(property, areaConfig, { houseDeals, cal, asOf: asOfBuild });
  const rRef = evaluate(property, areaConfig, { houseDeals, asOf: asOfBuild });
  const chosen = cal.byArea[property.location?.area]?.chosen ?? null;
  const marketCal = { chosen, rRef, dealsN: cal.byArea[property.location?.area]?.deals.n ?? 0 };
  if (chosen || r.retail) {
    writeFileSync(join(DIST, "property", `${id}-market.html`),
      renderMarketBasis(r, property, marketCal, cal.byArea[property.location?.area] ?? null), "utf8");
  }
  results.push({ r, rRef, property, hasMarketPage: !!(chosen || r.retail) });
  writeFileSync(join(DIST, "property", `${id}.html`), renderProperty(r, property, marketCal, houseDeals), "utf8");
  console.log(`✓ property/${id}.html 売出${Math.round(r.state.ask)}万 / 市場実勢${r.retail ? Math.round(r.retail.mid) + "万" : "—"} / 適正中央値${Math.round(r.fairFinal.mid)}万(${r.fairFinal.route})${r.retail ? ` / リテール${r.retail.n}件` : ""}`);
}

const asOf = results[0].r.asOf;
const guideTarget = results.find(({ r }) => r.id === GUIDE_EXAMPLE_ID) ?? results[0];
if (guideTarget.r.id !== GUIDE_EXAMPLE_ID) console.warn(`⚠ ガイド題材 ${GUIDE_EXAMPLE_ID} が見つからずフォールバック(本文の固有記述に不一致の可能性)`);
writeFileSync(join(DIST, "guide.html"), renderGuide(guideTarget.r, guideTarget.property, cal.byArea[guideTarget.property.location?.area] ?? null), "utf8");
console.log(`✓ guide.html(題材: ${guideTarget.r.id})`);
// 値段の解剖(算出ロジック図解)。リテール比較が成立する物件を題材にする(既定: 赤羽西4)
const FORMULA_EXAMPLE_ID = "akabanenishi4-21036139";
const formulaTarget = results.find(({ r }) => r.id === FORMULA_EXAMPLE_ID && r.retail) ?? results.find(({ r }) => r.retail) ?? null;
if (formulaTarget) {
  writeFileSync(join(DIST, "formula.html"),
    renderFormula(formulaTarget, cal.byArea[formulaTarget.property.location?.area] ?? null, houseDeals), "utf8");
  console.log(`✓ formula.html(題材: ${formulaTarget.r.id})`);
} else {
  console.warn("⚠ formula.html スキップ(リテール比較が成立する物件なし)");
}
// 30年の崖の検証(築年カーブの根拠を一から図解。2026-08-15ユーザー要望)。
// ハザード地区の分類は area-scan.json(丁目単位の機械判定の正本)から導出する
const areaScan = JSON.parse(readFileSync(join(ROOT, "market", "area-scan.json"), "utf8"));
writeFileSync(join(DIST, "cliff.html"), renderCliff({ houseDeals, areaScan, asOf }), "utf8");
console.log("✓ cliff.html(30年の崖の検証)");
// 妥協の値段(A/B/C分類とB群工事費早見表): 静的リファレンス
writeFileSync(join(DIST, "tradeoff.html"), renderTradeoff({ asOf }), "utf8");
console.log("✓ tradeoff.html");
// 手間の解剖(お金では見えない持ち家の運用。2026-08-17ユーザー要望): 静的リファレンス
writeFileSync(join(DIST, "effort.html"), renderEffort({ asOf }), "utf8");
console.log("✓ effort.html(手間の解剖)");
// 意思決定の地図(検討の一周を1枚で振り返る。2026-08-29ユーザー要望): 静的リファレンス
writeFileSync(join(DIST, "decision.html"), renderDecision({ asOf }), "utf8");
console.log("✓ decision.html(意思決定の地図)");
// 保有年数シミュレーター(2026-08-16ユーザー要望): 任意の2物件の「取得+保有−出口」を年数で比較。
// 出口の実測カーブは cliff.html と同じ ageCurveCI(帯別中央値と95%CI)を注入する
const simCurve = ageCurveCI(houseDeals);
writeFileSync(join(DIST, "simulate.html"), renderSimulate(results, simCurve, { asOf }), "utf8");
console.log(`✓ simulate.html(保有年数シミュレーター・出口実測${simCurve.total}件${simCurve.districts}地区)`);
// 本命比較(2026-08-29ユーザー要望「この2つの物件とESPACERのC号棟と賃貸で専用に比較するサイトを」):
// simulate と同一テンプレートの絞り込み(コピーではない)。物件の入れ替えは FOCUS_IDS を書き換えるだけ
// 2026-09-13: 岸町2 新築(アドキャスト図面・kishimachi2-adcast)は他の買主に売れた(ユーザー報告)ため台帳から外し、本命は2物件+賃貸になった
const FOCUS_IDS = ["kamiya2-adcast-a"];
// 2026-10-10: 岸町2(雰囲気)・ESPACER(赤羽駅から遠い)をユーザー判断で見送り、本命は神谷2-24 A区画(内見済み・一押し)の1物件+賃貸になった
const focusPreface = `
  <section class="panel">
    <h2>本命の前提(グラフを読む前に)</h2>
    <div class="logic-body">
      <p class="note" style="margin-top:0">2026-10-10の現地確認で<b>神谷2-24 A区画が本命</b>になった(町の雰囲気・前面6m公道で車が出しやすい・車庫あり)。
      それまでの本命だった<b>岸町2-4-9(MIRASUMO)は雰囲気が合わず、ESPACER C号棟は赤羽駅から遠すぎて見送り</b>。以下は本命1物件+賃貸の比較。</p>
      <div style="overflow-x:auto"><table class="kv" style="min-width:520px;font-size:.78rem">
        <tr><th></th><th>神谷2-24 建築条件付売地 A区画(未公開図面)</th></tr>
        <tr><td>総額</td><td>6,580万(土地4,090+建物2,490・税込)。<b>設備負担金60万と地盤改良費は別途</b>(実質6,700〜6,900万)</td></tr>
        <tr><td>広さ</td><td>有効宅地47.52m²・延床93.86m²(<b>車庫ポーチ含む</b>。居住部分は80〜85m²程度の公算)</td></tr>
        <tr><td>最寄り</td><td>東十条 歩11分 / 赤羽 歩14分 / 王子神谷 歩15分</td></tr>
        <tr><td>標高・浸水想定</td><td><b>2.5m・荒川の想定最大規模で3.0〜5.0m(浸水継続時間の区域)</b>。計画規模(1/200)では区域外。家屋倒壊等氾濫想定は非該当。
          <b>2026-10-10ユーザー判断で許容</b>(浸水5m未満)</td></tr>
        <tr><td>道路</td><td>北側 約6.0m 公道(42条1項1号)</td></tr>
        <tr><td>入居できる時期</td><td>引渡し 2027年3月下旬予定(古家解体→建築。建築条件付・100日以内の請負契約が停止条件)</td></tr>
        <tr><td>内見</td><td><b>済み</b>(2026-10-10)</td></tr>
      </table></div>
      <p class="note" style="margin-top:8px"><b>このグラフに入っていないもの:</b>
      ①設備負担金60万・地盤改良費・ロフト等オプション ②土地決済〜引渡しの約5ヶ月のつなぎ融資金利と二重家賃
      ③浸水想定区域であることの影響(水災保険料・出口の買い手層)。出口の実測カーブは北区全域の成約で、低地と台地を区別していない。
      ④賃貸の線は家賃のみ(戸建賃貸の実質月額は表示賃料+2〜4万。<a href="rent.html">戸建賃貸台帳</a>)。
      詳細は<a href="property/kamiya2-adcast-a.html">物件ページ</a>の caveat を参照。</p>
    </div>
  </section>`;
writeFileSync(join(DIST, "focus.html"), renderSimulate(results, simCurve, { asOf, focus: {
  ids: FOCUS_IDS,
  slug: "focus",
  title: "本命比較 ── 神谷2-24 × 賃貸",
  subtitle: "本命の1物件+賃貸だけを並べる専用ページ(判定はしない・仮定は全部動かせる)",
  rentDefault: 25,
  preface: focusPreface,
} }), "utf8");
console.log("✓ focus.html(本命比較: " + FOCUS_IDS.join(" / ") + ")");
// データ探索ページ: 各行に検証状態と出所リンクを付与
const verification = loadVerification();
const vByKey = new Map((verification?.rows ?? []).map((v) => [v.key, v]));
const houseRows = houseDeals.map((d) => {
  const key = [d.quarter, d.district, d.price_man, d.land_m2, d.floor_m2, d.age_y, d.walk_min].join("|");
  const v = vByKey.get(key);
  return { quarter: d.quarter, district: d.district, price_man: d.price_man, land_m2: d.land_m2,
    floor_m2: d.floor_m2, age_y: d.age_y, walk_min: d.walk_min, verification: d.verification,
    vnote: v?.note ?? "", mlit_ref: v?.mlit_ref ?? null,
    source_primary: v?.source_primary ?? d.source_url, source_secondary: v?.source_secondary ?? "" };
});
writeFileSync(join(DIST, "data.html"), renderDataExplorer({ houseRows, landRows: loadDeals(), verification, asOf }), "utf8");
console.log(`✓ data.html(戸建${houseRows.length}件・土地${loadDeals().length}件・検証 ${verification?.generated_at ?? "未実施"})`);
// ハザードマップ対照ページ。ラスタは crawler/hazard-grid.mjs が事前に焼いたJSONを読むだけ
// (ビルドはネットワークに出ない。再生成は手動: node crawler/hazard-grid.mjs)
const hazardGrid = JSON.parse(readFileSync(join(ROOT, "market", "hazard-grid.json"), "utf8"));
const excludedLedger = JSON.parse(readFileSync(join(ROOT, "market", "crawl", "excluded.json"), "utf8"));
writeFileSync(join(DIST, "map.html"),
  renderHazardMap({ grid: hazardGrid, ledger: results, excluded: excludedLedger, asOf }), "utf8");
console.log(`✓ map.html(ハザード対照・${hazardGrid.nx}×${hazardGrid.ny}メッシュ)`);

writeFileSync(join(DIST, "index.html"), renderIndex(results, { asOf, cal }), "utf8");
console.log(`✓ index.html(${results.length}件・基準日 ${asOf})`);

// ---- 戸建賃貸台帳(2026-08-18新設) ----
// 購入台帳とはデータもエンジンも別系統(rentals/ + engine/rent.js + market/rent-listings.csv)。
// 賃貸台帳が空でもビルドは通す(listRentalIds は rentals/ が無ければ空配列を返す)
const rentalIds = listRentalIds();
if (rentalIds.length === 0) {
  console.log("· 賃貸台帳なし(rentals/ が空のためスキップ)");
} else {
  mkdirSync(join(DIST, "rent"), { recursive: true });
  const { pool: rentPool, dropped: rentDropped, csvRows: rentCsvRows } = readRentPoolCsv();
  if (rentDropped.length) console.warn(`⚠ 募集賃料プールで読み取り不能により除外: ${rentDropped.length}件 ${rentDropped.map((d) => `${d.source_id}(${d.reason})`).join(" ")}`);
  const rentModel = fitRentModel(rentPool);
  if (!rentModel.ok) console.warn(`⚠ 募集賃料モデルを推定できず: ${rentModel.reason}`);
  const rentFun = rentFunnel(rentPool, undefined, { dropped: rentDropped, csvRows: rentCsvRows });
  const rentResults = [];
  for (const id of rentalIds) {
    const rental = loadRental(id);
    if (rental.id !== id) throw new Error(`ファイル名とid不一致: rentals/${id}.yaml の id は ${rental.id}`);
    const res = evaluateRent(rental, { pool: rentPool, model: rentModel.ok ? rentModel : null, asOf: asOfBuild });
    writeFileSync(join(DIST, "rent", `${id}.html`),
      renderRentProperty(res, rental, { asOf, model: rentModel.ok ? rentModel : null }), "utf8");
    rentResults.push({ res, rental });
    console.log(`✓ rent/${id}.html 表示${res.listed.total_man}万 / 実質(2年)${res.at2y.monthlyEq.toFixed(2)}万 / ものさし比${res.ratio ? Math.round(res.ratio * 100) + "%" : "—"}`);
  }
  writeFileSync(join(DIST, "rent.html"),
    renderRentIndex(rentResults, { asOf, funnel: rentFun, model: rentModel.ok ? rentModel : null,
      poolCapturedAt: rentPool[0]?.captured_at ?? null, hasBasisPage: rentModel.ok }), "utf8");
  console.log(`✓ rent.html(賃貸台帳 ${rentResults.length}件・母集団 ${rentPool.length}件)`);
  if (rentModel.ok) {
    // ページ本文の実数はここで注入する(テンプレートに手書きしない)
    const rentRatios = rentResults.map((r) => r.res.ratio).filter(Number.isFinite);
    const sample = rentResults.find((r) => Number.isFinite(r.res.at2y?.monthlyEq));
    writeFileSync(join(DIST, "rent-basis.html"),
      renderRentBasis({ pool: rentPool, model: rentModel, funnel: rentFun, asOf,
        houseDealsTotal: simCurve.total, houseDealsDistricts: simCurve.districts,
        ratioLo: rentRatios.length ? Math.round(Math.min(...rentRatios) * 100) : null,
        ratioHi: rentRatios.length ? Math.round(Math.max(...rentRatios) * 100) : null,
        sampleEffective: sample ? { listed: sample.res.listed.total_man, eff: sample.res.at2y.monthlyEq.toFixed(1) } : null,
      }), "utf8");
    console.log(`✓ rent-basis.html(募集賃料モデル n=${rentModel.n} R²=${rentModel.r2.toFixed(3)})`);
  }
}

console.log(`出力先: ${DIST}`);
