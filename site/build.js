// site/build.js — 全物件YAMLを査定し、静的サイトを site/dist/ に生成する
// 使い方: node site/build.js
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate } from "../engine/appraise.js";
import { ROOT, loadAreaConfig, loadProperty, listPropertyIds } from "../engine/io.js";
import { renderIndex } from "./templates/index.js";
import { renderProperty } from "./templates/property.js";
import { renderGuide } from "./templates/guide.js";
import { calibrate } from "../engine/calibrate.js";

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

const results = [];
for (const id of ids) {
  const property = loadProperty(id);
  if (property.id !== id) {
    throw new Error(`ファイル名とid不一致: ${id}.yaml の id は ${property.id}`);
  }
  const r = evaluate(property, areaConfig);
  // 成約ベース坪単価がある物件は、単価だけ差し替えた再査定(成約ベース参考値)を併算する
  const chosen = cal.byArea[property.location?.area]?.chosen;
  let calR = null, marketCal = null;
  if (chosen) {
    calR = evaluate({ ...property, ppt_man_override: chosen.ppt }, areaConfig);
    marketCal = { chosen, calR, dealsN: cal.byArea[property.location.area].deals.n };
  }
  results.push({ r, property, calR });
  writeFileSync(join(DIST, "property", `${id}.html`), renderProperty(r, property, marketCal), "utf8");
  console.log(`✓ property/${id}.html 【${r.verdict.mark}】 売出${Math.round(r.state.ask)}万 / 適正中央値${Math.round(r.mid.fair)}万${calR ? ` / 成約ベース${Math.round(calR.mid.fair)}万` : ""}`);
}

const asOf = results[0].r.asOf;
const guideTarget = results.find(({ r }) => r.id === GUIDE_EXAMPLE_ID) ?? results[0];
writeFileSync(join(DIST, "guide.html"), renderGuide(guideTarget.r, guideTarget.property, cal.byArea[guideTarget.property.location?.area] ?? null), "utf8");
console.log(`✓ guide.html(題材: ${guideTarget.r.id})`);
writeFileSync(join(DIST, "index.html"), renderIndex(results, { asOf, cal }), "utf8");
console.log(`✓ index.html(${results.length}件・基準日 ${asOf})`);
console.log(`出力先: ${DIST}`);
