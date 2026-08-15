// site/build.js — 全物件YAMLを査定し、静的サイトを site/dist/ に生成する
// 使い方: node site/build.js
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate, defaultAsOf } from "../engine/appraise.js";
import { ROOT, loadAreaConfig, loadProperty, listPropertyIds } from "../engine/io.js";
import { renderIndex } from "./templates/index.js";
import { renderProperty } from "./templates/property.js";
import { renderGuide } from "./templates/guide.js";
import { calibrate } from "../engine/calibrate.js";
import { loadHouseDeals } from "../engine/retail.js";
import { renderMarketBasis } from "./templates/market-basis.js";
import { renderDataExplorer } from "./templates/data-explorer.js";
import { renderFormula } from "./templates/formula.js";
import { renderCliff } from "./templates/cliff.js";
import { renderTradeoff } from "./templates/tradeoff.js";
import { renderHazardMap } from "./templates/map.js";
import { loadVerification } from "../engine/retail.js";
import { loadDeals } from "../engine/calibrate.js";

// 前提知識ガイドの題材物件(存在しなければ先頭の物件にフォールバック)
const GUIDE_EXAMPLE_ID = "jujonakahara3-adcast";

const DIST = join(ROOT, "site", "dist");
mkdirSync(join(DIST, "property"), { recursive: true });

const areaConfig = loadAreaConfig();
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
console.log(`出力先: ${DIST}`);
