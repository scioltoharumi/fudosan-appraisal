// tests/ui/focus.ui.mjs — focus.html(本命比較)の操作検査。npm test には含めない(ブラウザが要るため)。
//   準備: npm i --no-save playwright-core   実行: node site/build.js && node tests/ui/focus.ui.mjs
// focus は simulate と同一テンプレートの絞り込みなので、モデルの検査は simulate.ui.mjs に任せ、
// ここでは「絞り込みが仕様どおりか」(3物件・CI帯が既定で出る・家賃既定25)だけを見る
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import { existsSync, readdirSync } from "node:fs";
let exe = process.env.CHROMIUM_PATH;
if (!exe) {
  const roots = readdirSync("/opt/pw-browsers").filter((d) => d.startsWith("chromium-"));
  exe = roots.map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find((p) => existsSync(p));
}
const b = await chromium.launch({ executablePath: exe });
const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
await page.goto(pathToFileURL("site/dist/focus.html").href);
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
ok((await page.locator('#proplist input[type=checkbox]').count()) === 3, "チェックボックスが3つ");
ok((await page.locator('#simchart path[stroke-width="2"]').count()) === 3, "実線が3本");
ok((await page.locator('#simchart path[opacity=".12"]').count()) === 3, "95%CIの帯が既定で3つ描かれる(3≤4)");
ok((await page.locator('#vRent').textContent()) === "25万/月", "家賃既定25万/月");
ok((await page.locator('#simcross').textContent()).includes("安い順"), "順位行が出る");
await page.locator('#inT').fill("30"); await page.locator('#inG').fill("2");
await page.locator('#proplist input[type=checkbox]').first().uncheck();
ok((await page.locator('#simchart path[stroke-width="2"]').count()) === 2, "1件外すと実線2本");
ok(errors.length === 0, "JSエラーなし: " + errors.join(" / "));
await b.close();
if (fails.length) { console.error("NG:\n  " + fails.join("\n  ")); process.exit(1); }
console.log("✓ focus.ui 7項目OK(3物件・CI帯既定表示・家賃25・操作でJSエラーなし)");
