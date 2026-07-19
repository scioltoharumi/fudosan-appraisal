// site/build.js — 全物件YAMLを査定し、静的サイトを site/dist/ に生成する
// 使い方: node site/build.js
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate } from "../engine/appraise.js";
import { ROOT, loadAreaConfig, loadProperty, listPropertyIds } from "../engine/io.js";
import { renderIndex } from "./templates/index.js";
import { renderProperty } from "./templates/property.js";

const DIST = join(ROOT, "site", "dist");
mkdirSync(join(DIST, "property"), { recursive: true });

const areaConfig = loadAreaConfig();
const ids = listPropertyIds();
if (ids.length === 0) {
  console.error("properties/ に物件YAMLがありません");
  process.exit(1);
}

const results = [];
for (const id of ids) {
  const property = loadProperty(id);
  if (property.id !== id) {
    throw new Error(`ファイル名とid不一致: ${id}.yaml の id は ${property.id}`);
  }
  const r = evaluate(property, areaConfig);
  results.push({ r, property });
  writeFileSync(join(DIST, "property", `${id}.html`), renderProperty(r, property), "utf8");
  console.log(`✓ property/${id}.html 【${r.verdict.mark}】 売出${Math.round(r.state.ask)}万 / 適正中央値${Math.round(r.mid.fair)}万`);
}

const asOf = results[0].r.asOf;
writeFileSync(join(DIST, "index.html"), renderIndex(results, { asOf }), "utf8");
console.log(`✓ index.html(${results.length}件・基準日 ${asOf})`);
console.log(`出力先: ${DIST}`);
