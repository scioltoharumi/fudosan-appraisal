// tests/ui/index.ui.mjs — 一覧ページの対話UI(ステータス/メモ/フィルタ/ソート/同期)の機械検証。
// npm test には含めない(この検証だけブラウザが要るため。エンジン側の依存ゼロ方針は維持)。
//   準備: npm i --no-save playwright-core   (ブラウザ本体は環境に同梱: /opt/pw-browsers)
//   実行: node site/build.js && node tests/ui/index.ui.mjs   → 全項目OKで exit 0
// 2026-08-13の変更(機械判定の廃止 + ステータス/メモ欄の追加)を、実ブラウザで往復確認する。
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
const url = pathToFileURL("/home/user/fudosan-appraisal/site/dist/index.html").href;
const exe = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const b = await chromium.launch({ executablePath: exe });
const ctx = await b.newContext();
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
await p.goto(url);

const ok = [];
const fail = [];
const T = async (name, fn) => { try { const r = await fn(); (r ? ok : fail).push(name + (r ? "" : " → 失敗")); } catch (e) { fail.push(name + " → 例外 " + e.message); } };

// 1. 判定列が消えている / 内見と検討状況が別列になっている(2026-08-15)
await T("判定列・スタンプが無く、内見と検討状況が別列になっている", async () => {
  const h = await p.textContent("#ptable tr:first-child");
  return !/判定/.test(h) && (await p.locator(".badge").count()) === 0 &&
    h.includes("内見") && h.includes("検討状況");
});
// 2. 内見(事実)の初期値がYAML由来。検討状況の選択肢に「内見済」は無い
await T("内見は3値・検討状況は保留を含み、両者の語彙が混ざっていない", async () => {
  const done = await p.locator('tr.prow[data-viewing="内見済"]').count();
  const st = [...new Set(await p.locator("tr.prow .stsel option").allTextContents())];
  const vw = [...new Set(await p.locator("tr.prow .vwsel option").allTextContents())];
  return done > 0 &&
    !st.includes("内見済") && st.includes("検討中") && st.includes("保留(値下げ待ち)") && st.includes("見送り") &&
    vw.length === 3 && vw.includes("未") && vw.includes("内見希望") && vw.includes("内見済");
});
// 2b. 内見と検討状況が同時に成り立つ(1つのプルダウンに同居させていた頃はできなかった)
await T("内見済のまま検討中を保てる(事実と判断が独立)", async () => {
  const rid = await p.locator('tr.prow[data-viewing="内見済"]').first().getAttribute("data-id");
  const r = p.locator(`tr.prow[data-id="${rid}"]`);
  await r.locator(".stsel").selectOption("保留(値下げ待ち)");
  await p.waitForTimeout(120);
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem("fudosan-ledger-v1")));
  return (await r.getAttribute("data-viewing")) === "内見済" &&
    (await r.locator(".stsel").inputValue()) === "保留(値下げ待ち)" && st.items[rid].status === "保留(値下げ待ち)";
});
// 2c. 内見チェックの往復(保存・復元・未同期印)
await T("内見希望が保存され未同期になる(未→内見希望→未)", async () => {
  // data-viewing は選択で書き換わるため、属性セレクタのまま保持すると別の行を指してしまう。
  // 先にIDを取り、以後はIDで固定する
  const rid = await p.locator('tr.prow[data-viewing="未"]').first().getAttribute("data-id");
  const r = p.locator(`tr.prow[data-id="${rid}"]`);
  await r.locator(".vwsel").selectOption("内見希望");
  await p.waitForTimeout(120);
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem("fudosan-ledger-v1")));
  const dirty = await r.evaluate((el) => el.classList.contains("dirty"));
  const okNow = st.items[rid].viewing === "内見希望" && dirty && (await r.getAttribute("data-viewing")) === "内見希望";
  await r.locator(".vwsel").selectOption("未");          // 後続テストに影響させない
  await p.waitForTimeout(120);
  return okNow;
});
// 2d. 旧スキーマ(status:"内見済")の記録を読み替える
await T("旧データの内見済は viewed+検討中 に移行される", async () => {
  const rid = await p.locator("tr.prow").first().getAttribute("data-id");
  await p.evaluate((x) => localStorage.setItem("fudosan-ledger-v1",
    JSON.stringify({ v: 1, items: { [x]: { status: "内見済" } } })), rid);
  await p.reload();
  const r = p.locator(`tr.prow[data-id="${rid}"]`);
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem("fudosan-ledger-v1")));
  return (await r.getAttribute("data-viewing")) === "内見済" &&
    (await r.locator(".stsel").inputValue()) === "検討中" && st.items[rid].status === "検討中";
});
// 2d-2. v2(viewed の真偽値)も3値へ移行する
await T("旧データの viewed:true は内見済へ移行される", async () => {
  const rid = await p.locator("tr.prow").first().getAttribute("data-id");
  await p.evaluate((x) => localStorage.setItem("fudosan-ledger-v1",
    JSON.stringify({ v: 2, items: { [x]: { viewed: true } } })), rid);
  await p.reload();
  const r = p.locator(`tr.prow[data-id="${rid}"]`);
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem("fudosan-ledger-v1")));
  return (await r.getAttribute("data-viewing")) === "内見済" &&
    st.items[rid].viewing === "内見済" && st.items[rid].viewed === undefined;
});
// 2e. 内見フィルタ
await T("内見チップ(未/内見希望/内見済)で絞り込める", async () => {
  await p.locator("#freset").click();
  await p.locator('.chip[data-f="viewing"][data-val="内見済"]').click();
  await p.waitForTimeout(80);
  const vis = await p.locator("tr.prow:visible").count();
  const total = await p.locator("tr.prow").count();
  const okNow = vis > 0 && vis < total;
  await p.locator("#freset").click();
  return okNow;
});
// 3. ステータス変更 → dirty + localStorage
const row = p.locator("tr.prow").first();
const id = await row.getAttribute("data-id");
await T("ステータス変更が保存され未同期になる", async () => {
  await row.locator(".stsel").selectOption("見送り");
  await p.waitForTimeout(120);
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem("fudosan-ledger-v1")));
  const dirty = await row.evaluate((el) => el.classList.contains("dirty"));
  const ds = await row.getAttribute("data-status");
  return st.items[id].status === "見送り" && dirty && ds === "見送り";
});
// 4. メモ入力 → 保存 + ボタン表示変化
await T("メモが常時表示の欄で保存される", async () => {
  await row.locator(".memota").fill("擁壁の確認待ち");
  await p.waitForTimeout(600);
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem("fudosan-ledger-v1")));
  // 開閉ボタンを廃したので「常に見えていること」自体が要件
  const vis = await row.locator(".memota").isVisible();
  return st.items[id].memo === "擁壁の確認待ち" && vis;
});
// 5. リロードで復元
await T("リロード後も復元される", async () => {
  await p.reload();
  const r = p.locator(`tr.prow[data-id="${id}"]`);
  const v = await r.locator(".stsel").inputValue();
  const memo = await r.locator(".memota").inputValue();
  return v === "見送り" && memo === "擁壁の確認待ち";
});
// 6. フィルタ(ステータス)
await T("ステータスチップで絞り込める", async () => {
  await p.locator("#freset").click();
  await p.locator('.chip[data-f="status"][data-val="見送り"]').click();
  await p.waitForTimeout(80);
  const vis = await p.locator("tr.prow:visible").count();
  const total = await p.locator("tr.prow").count();
  // 台帳側の見送り件数は増減するため件数を決め打ちしない。「見送りだけが残る」ことを見る
  const sts = await p.locator("tr.prow:visible").evaluateAll((es) => es.map((e) => e.dataset.status));
  return vis > 0 && vis < total && sts.every((x) => x === "見送り");
});
// 7. メモありフィルタ
await T("メモありチップで絞り込める", async () => {
  await p.locator("#freset").click();
  await p.locator('.chip[data-f="memo"]').click();
  await p.waitForTimeout(80);
  return (await p.locator("tr.prow:visible").count()) === 1;
});
// 8. 仮定列を撤去し、メモは全行で常に見えている(2026-08-15)
await T("仮定列が無く、メモ欄が全行で常時表示されている", async () => {
  await p.locator("#freset").click();
  const head = await p.textContent("#ptable tr:first-child");
  const rows = await p.locator("tr.prow").count();
  const shown = await p.locator("tr.prow .memota:visible").count();
  return !/仮定/.test(head) && (await p.locator("tr.mrow").count()) === 0 && shown === rows;
});
// 9. 書き出しJSONの形
await T("書き出しJSONが読み込みで往復する", async () => {
  const dump = await p.evaluate(() => localStorage.getItem("fudosan-ledger-v1"));
  await p.evaluate(() => localStorage.removeItem("fudosan-ledger-v1"));
  await p.reload();
  await p.locator("#impbtn").click();
  await p.locator("#impta").fill(dump);
  await p.locator("#impapply").click();
  await p.waitForTimeout(150);
  const r = p.locator(`tr.prow[data-id="${id}"]`);
  return (await r.locator(".stsel").inputValue()) === "見送り";
});
// 10. 記録の消去
await T("この端末の記録を消せる", async () => {
  p.once("dialog", (d) => d.accept());
  await p.locator("#clrbtn").click();
  await p.waitForTimeout(120);
  const r = p.locator(`tr.prow[data-id="${id}"]`);
  const seed = await r.getAttribute("data-seed");
  return (await r.locator(".stsel").inputValue()) === seed && !(await r.evaluate((e) => e.classList.contains("dirty")));
});
// 11〜16. 並び替え(2026-08-13追加: 登録名の昇順降順 + 築年数/延床/土地/徒歩分)
const vals = async (key) => p.$$eval("tr.prow", (rs, k) => rs.map((r) => r.dataset[k]), key);
const isAsc = (a) => a.every((v, i) => i === 0 || a[i - 1] <= v);
const numsOf = (a) => a.filter((v) => v !== "" && v != null).map(Number);

await T("並び替えバーが7項目ある(登録日・築年数・延床・土地・徒歩分・売出価格・乖離)", async () => {
  const labels = await p.$$eval("#sortbar .chip", (cs) => cs.map((c) => c.dataset.s));
  return ["captured", "age", "floor", "land", "walk", "price", "div"].every((k) => labels.includes(k));
});

await T("登録日: 1回目のクリックで古い順、2回目で新しい順になる", async () => {
  await p.click('#sortbar .chip[data-s="captured"]');
  const asc = numsOf(await vals("captured"));
  const okAsc = asc.every((v, i) => i === 0 || asc[i - 1] <= v);
  await p.click('#sortbar .chip[data-s="captured"]');
  const desc = numsOf(await vals("captured"));
  const okDesc = desc.every((v, i) => i === 0 || desc[i - 1] >= v);
  // 日付が実データとして複数種あること(全部同じだと並び替えを検証できない)
  return okAsc && okDesc && new Set(asc).size > 1 && asc[0] === desc[desc.length - 1];
});

await T("登録日は行にも表示される(並べ替えた結果を目で確認できる)", async () =>
  (await p.locator("tr.prow", { hasText: "台帳登録" }).count()) === (await p.locator("tr.prow").count()));

await T("物件名の並び替えは表の見出しに残っている", async () => {
  await p.click('th.sortable[data-key="name"]');
  const asc = await vals("name");
  const okAsc = asc.every((v, i) => i === 0 || asc[i - 1].localeCompare(v, "ja") <= 0);
  await p.click('th.sortable[data-key="name"]');
  const desc = await vals("name");
  return okAsc && desc.every((v, i) => i === 0 || desc[i - 1].localeCompare(v, "ja") >= 0);
});

for (const [key, label] of [["age", "築年数"], ["floor", "延床"], ["land", "土地"], ["walk", "徒歩分"]]) {
  await T(`${label}順: 昇順・降順とも数値順に並ぶ`, async () => {
    await p.click(`#sortbar .chip[data-s="${key}"]`);
    const a = numsOf(await vals(key));
    const okA = a.every((v, i) => i === 0 || a[i - 1] <= v);
    await p.click(`#sortbar .chip[data-s="${key}"]`);
    const d = numsOf(await vals(key));
    const okD = d.every((v, i) => i === 0 || d[i - 1] >= v);
    return a.length > 1 && okA && okD;
  });
}

await T("並び替えてもメモの中身が行についてくる(取り違えない)", async () => {
  const before = await p.$$eval("#ptable tr.prow",
    (rs) => rs.map((r) => [r.dataset.id, r.querySelector(".memota").value]));
  await p.click('#sortbar .chip[data-s="walk"]');
  await p.waitForTimeout(80);
  const after = await p.$$eval("#ptable tr.prow",
    (rs) => rs.map((r) => [r.dataset.id, r.querySelector(".memota").value]));
  const bm = new Map(before);
  return after.length === before.length && after.every(([id, v]) => bm.get(id) === v);
});

await T("現在の並び順が表示される(選択中のチップに矢印、ヘッダにも同期)", async () => {
  await p.click('#sortbar .chip[data-s="age"]');
  const chip = await p.textContent('#sortbar .chip[data-s="age"]');
  const on = await p.locator('#sortbar .chip[data-s="age"].on').count();
  // 絞り込みの「リセット」を押しても並び順の表示は消えない(セレクタが .chip[data-f] に限定されている)
  await p.click("#freset");
  const still = await p.locator('#sortbar .chip[data-s="age"].on').count();
  return on === 1 && /[↑↓]/.test(chip) && still === 1;
});

// 17. 物件ページに判定スタンプが無い
await T("物件ページに判定スタンプが無い", async () => {
  await p.goto(pathToFileURL("/home/user/fudosan-appraisal/site/dist/property/" + id + ".html").href);
  const t = await p.textContent("body");
  return (await p.locator(".stamp").count()) === 0 && !/判定【/.test(t) && (await p.locator(".position-wrap").count()) === 1;
});

await b.close();
console.log(ok.map((s) => "  OK  " + s).join("\n"));
if (fail.length) console.log(fail.map((s) => "  NG  " + s).join("\n"));
if (errs.length) console.log("JSエラー:\n" + errs.join("\n"));
console.log(`\n${ok.length}/${ok.length + fail.length} 合格` + (errs.length ? ` / JSエラー${errs.length}件` : " / JSエラーなし"));
process.exit(fail.length || errs.length ? 1 : 0);
