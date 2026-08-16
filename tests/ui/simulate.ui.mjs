// tests/ui/simulate.ui.mjs — simulate.html の操作検査。npm test には含めない(ブラウザが要るため)。
//   準備: npm i --no-save playwright-core   (ブラウザ本体は環境に同梱: /opt/pw-browsers)
//   実行: node site/build.js && node tests/ui/simulate.ui.mjs   → 問題ゼロで exit 0
// 検査内容: チェック切替・全選択/全解除・スライダー・控除編集でJSエラーが出ないこと、
// 表示件数・CI帯の出し分け(4件以下のみ表示)・順位行・内訳表の列数が仕様どおり変わること。
// SVGの text 見切れ・重なりは別途 `node tests/ui/cliff.svg.mjs site/dist/simulate.html` で検査する
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import { existsSync, readdirSync } from "node:fs";

const url = pathToFileURL("site/dist/simulate.html").href;
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
await page.goto(url);

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

// 初期状態: 全選択・帯なし(4件超)・線は物件数ぶん
const n = await page.locator('#proplist input[type=checkbox]').count();
ok(n >= 10, `チェックボックスが全物件ぶんある(実際 ${n})`);
ok((await page.locator('#vSel').textContent()) === `${n}/${n}件`, "選択数表示が全選択");
const strokes0 = await page.locator('#simchart path[stroke-width="2"]').count();
ok(strokes0 === n, `実線が全物件ぶん描かれる(${strokes0}/${n})`);
ok((await page.locator('#simchart path[opacity=".12"]').count()) === 0, "全選択時はCI帯を描かない");
ok((await page.locator('#lgNote').textContent()).includes("絞ると表示"), "帯の省略を凡例に明示");
// 内訳表: ヘッダ列 = 物件数+1
ok((await page.locator('#simtable tr').first().locator('th').count()) === n + 1, "内訳表の列が全物件ぶん");
// 順位行に ≈ の説明がある
ok((await page.locator('#simcross').textContent()).includes("安い順"), "順位行が出る");

// 2件へ絞る → 帯が2つ出る
const boxes = page.locator('#proplist input[type=checkbox]');
for (let i = 2; i < n; i++) await boxes.nth(i).uncheck();
ok((await page.locator('#simchart path[opacity=".12"]').count()) === 2, "2件選択でCI帯が2つ");
ok((await page.locator('#vSel').textContent()) === `2/${n}件`, "選択数表示が2件");
ok((await page.locator('#simtable tr').first().locator('th').count()) === 3, "内訳表が2列+見出し");

// 全解除 → 空表示の案内、全選択 → 復帰
await page.click('#btnNone');
ok((await page.locator('#simcross').textContent()).includes("選ばれていません"), "全解除の案内");
await page.click('#btnAll');
ok((await page.locator('#simchart path[stroke-width="2"]').count()) === n, "全選択で復帰");

// スライダー類を一通り動かす
for (const [id, val] of [["#inG", "2"], ["#inRent", "25"], ["#inAnn", "40"], ["#inCyc", "12"], ["#inPer", "250"], ["#inRate", "1.5"], ["#inT", "20"]]) {
  await page.fill(id, val);
  await page.dispatchEvent(id, "input");
}
ok((await page.locator('#vT').textContent()) === "20年", "保有年数スライダー反映");
ok((await page.locator('#simcross').textContent()).includes("保有20年"), "順位行が選択年に追従");

// ローントグルと控除編集
await page.click('#ckLoan');
await page.click('#ckLoan');
await page.click('.simside details.dnote summary');
const capInput = page.locator('[data-ded-cap]').first();
await capInput.fill("4500");
await capInput.dispatchEvent("input");
ok((await page.locator('#simtable').textContent()).includes("4500万"), "控除上限の上書きが内訳表に反映");

// 4件選択で崖ラベル(築31年)が出る物件があるか(築1〜30年に崖到達年がある物件を選ぶ)
await page.click('#btnNone');
for (let i = 0; i < 4; i++) await boxes.nth(i).check();
ok((await page.locator('#simchart path[opacity=".12"]').count()) === 4, "4件選択でCI帯4つ(上限ちょうど)");

if (errors.length || fails.length) {
  console.error("JSエラー:", errors);
  console.error("検査不合格:", fails);
  process.exit(1);
}
console.log(`✓ 操作検査 合格(JSエラー0・検査項目すべて成立・物件${n}件)`);
await b.close();
