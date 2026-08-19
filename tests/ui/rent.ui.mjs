// tests/ui/rent.ui.mjs — 賃貸一覧ページの対話UI(検討状況・内見・メモ・書き出し/読み込み)の機械検証。
// npm test には含めない(ブラウザが要るため。エンジン側の依存ゼロ方針は維持)。
//   準備: npm i --no-save playwright-core   (ブラウザ本体は環境に同梱: /opt/pw-browsers)
//   実行: node site/build.js && node tests/ui/rent.ui.mjs   → 全項目OKで exit 0
//
// 2026-08-19の監査で「賃貸の一覧UIだけ機械検証が無い」と分かったので新設した。
// **最重要の検査は「書き出しJSONにメモが入らないこと」**(運用ルール3。メモが書き出しに混ざると
// ユーザーがそれを会話へ貼り、公開リポジトリへ入る経路ができてしまう)。
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

const root = "/home/user/fudosan-appraisal";
const url = pathToFileURL(`${root}/site/dist/rent.html`).href;
const exe = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const b = await chromium.launch({ executablePath: exe });
const ctx = await b.newContext();
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
p.on("dialog", (d) => d.accept());
await p.goto(url);

const ok = [], fail = [];
const T = async (name, fn) => { try { const r = await fn(); (r ? ok : fail).push(name + (r ? "" : " → 失敗")); } catch (e) { fail.push(name + " → 例外 " + e.message); } };
const KEY = "fudosan-rent-ledger-v1";
const ls = () => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), KEY);

await T("判定スタンプを出さない(v3.0.0の思想は賃貸にも及ぶ)", async () => {
  const t = await p.textContent("body");
  return (await p.locator(".stamp").count()) === 0 && !/判定【/.test(t) &&
    !/借りるべき|見送るべき|買い時/.test(t);
});

await T("検討状況は4値・内見は3値で、語彙が混ざっていない", async () => {
  const st = [...new Set(await p.locator("tr.prow .stsel option").allTextContents())];
  const vw = [...new Set(await p.locator("tr.prow .vwsel option").allTextContents())];
  return st.length === 4 && st.includes("新規") && st.includes("検討中") &&
    st.includes("申込検討") && st.includes("見送り") && !st.includes("内見済") &&
    vw.length === 3 && vw.join("/") === "未/内見希望/内見済";
});

await T("検討状況と内見は独立に保てる(内見済のまま検討中)", async () => {
  const r = p.locator("tr.prow").first();
  const id = await r.getAttribute("data-id");
  await r.locator(".vwsel").selectOption("内見済");
  await r.locator(".stsel").selectOption("検討中");
  await p.waitForTimeout(120);
  const d = await ls();
  return d[id].viewing === "内見済" && d[id].status === "検討中" &&
    (await r.getAttribute("data-viewing")) === "内見済" &&
    (await r.getAttribute("data-status")) === "検討中";
});

await T("台帳YAMLと食い違う行に未同期印が出て、戻すと消える", async () => {
  const r = p.locator("tr.prow").first();
  const dirty = await r.evaluate((el) => el.classList.contains("dirty"));
  const info = await p.textContent("#ls-info");
  await r.locator(".stsel").selectOption(await r.getAttribute("data-yaml-status"));
  await r.locator(".vwsel").selectOption(await r.getAttribute("data-yaml-viewing"));
  await p.waitForTimeout(120);
  const back = await r.evaluate((el) => el.classList.contains("dirty"));
  return dirty && /未同期/.test(info) && !back;
});

await T("メモは端末に保存され、再読込で復元される", async () => {
  const r = p.locator("tr.prow").first();
  const id = await r.getAttribute("data-id");
  await r.locator(".memota").fill("内見メモ: 私道の幅を確認する");
  await p.waitForTimeout(120);
  await p.reload();
  const v = await p.locator(`tr.prow[data-id="${id}"] .memota`).inputValue();
  return v === "内見メモ: 私道の幅を確認する";
});

// ---- ここが本丸(運用ルール3) ----
await T("書き出しJSONにメモが入らない(公開リポジトリへの経路を作らない)", async () => {
  await p.click("#rent-export");
  await p.waitForTimeout(120);
  const json = await p.locator("#rent-json").inputValue();
  const obj = JSON.parse(json);
  const keys = new Set(Object.values(obj).flatMap((v) => Object.keys(v)));
  return !/私道の幅を確認する/.test(json) && !json.includes("memo") &&
    [...keys].sort().join(",") === "status,viewing";
});

await T("書き出し→読み込みの往復で検討状況と内見が戻り、メモは触られない", async () => {
  const r = p.locator("tr.prow").first();
  const id = await r.getAttribute("data-id");
  const json = await p.locator("#rent-json").inputValue();
  const obj = JSON.parse(json);
  obj[id] = { status: "申込検討", viewing: "内見希望" };
  await r.locator(".stsel").selectOption("見送り");
  await p.waitForTimeout(60);
  await p.locator("#rent-json").fill(JSON.stringify(obj));
  await p.click("#rent-import");
  await p.waitForTimeout(150);
  const d = await ls();
  return d[id].status === "申込検討" && d[id].viewing === "内見希望" &&
    d[id].memo === "内見メモ: 私道の幅を確認する" &&
    /読み込みました/.test(await p.textContent("#rent-panel-msg"));
});

await T("保存の消去でlocalStorageが空になり、YAMLの初期値へ戻る", async () => {
  await p.click("#rent-reset");
  await p.waitForTimeout(400);
  const d = await ls();
  const r = p.locator("tr.prow").first();
  return Object.keys(d).length === 0 &&
    (await r.locator(".stsel").inputValue()) === (await r.getAttribute("data-yaml-status")) &&
    (await r.locator(".memota").inputValue()) === "";
});

await T("漏斗の各段が単調非増加で、最終段が台帳の件数と一致する", async () => {
  const ns = (await p.locator("#rentfunnel .fn-n").allTextContents()).map((t) => Number(t.replace(/\D/g, "")));
  const rows = await p.locator("tr.prow").count();
  const mono = ns.every((v, i) => i === 0 || v <= ns[i - 1]);
  // 漏斗が台帳より多い/少ないまま放置されると「黙って減らさない」という約束が破れる
  return ns.length >= 5 && mono && ns[ns.length - 1] === rows && rows > 0;
});

await T("実質月額の鋸歯(更新年に一度上がる)を本文で説明している", async () => {
  const t = await p.textContent("body");
  return /更新料/.test(t) && /(上が|反転|鋸)/.test(t);
});

await T("母集団が成約ではなく募集であることを開示している", async () => {
  const t = await p.textContent("body");
  return /募集/.test(t) && /成約/.test(t);
});

// 画面幅を変えてもメモ欄が枠外へ出ない(購入側で実際に起きた事故の再発防止)
await T("主要画面幅でメモ欄が枠外へ出ない(1440/1280/1024)", async () => {
  const bad = [];
  for (const w of [1440, 1280, 1024]) {
    const pg = await ctx.newPage();
    await pg.setViewportSize({ width: w, height: 900 });
    await pg.goto(url);
    const r = await pg.evaluate(() => {
      const t = document.getElementById("rentlist"), wrap = t.parentElement;
      const memo = t.querySelector("tr.prow .memota");
      if (!memo) return { cut: false, over: 0 };
      const m = memo.getBoundingClientRect(), box = wrap.getBoundingClientRect();
      return { cut: m.right > box.right + 1, over: wrap.scrollWidth - wrap.clientWidth };
    });
    if (r.cut) bad.push(`${w}px で見切れ(はみ出し${r.over}px)`);
    await pg.close();
  }
  if (bad.length) console.log("   " + bad.join(" / "));
  return bad.length === 0;
});

await T("物件ページが存在し、実質月額の内訳と仮定の開示を持つ", async () => {
  const href = await p.locator("tr.prow a[href^='rent/']").first().getAttribute("href");
  const f = `${root}/site/dist/${href}`;
  if (!existsSync(f)) return false;
  await p.goto(pathToFileURL(f).href);
  const t = await p.textContent("body");
  return /実質月額/.test(t) && /(仮定|既定)/.test(t) && (await p.locator(".stamp").count()) === 0;
});

// ---- ペット絞り込み(2026-08-19ユーザー要望「猫を飼っている」) ----
await T("ペットの絞り込みは既定オフで、切り替えると隠した件数を必ず出す", async () => {
  await p.goto(url);
  const all = await p.locator("tr.prow").count();
  const visible = async () => p.locator("tr.prow:visible").count();
  const before = await visible();
  if (before !== all) return false;                       // 既定は全件表示
  await p.click('#petchips .chip[data-pet="ok"]');
  await p.waitForTimeout(120);
  const okN = await visible();
  const info = await p.textContent("#petinfo");
  // 「記載なし=不可」ではないので既定で隠さない。隠したときは理由と件数を出す
  const discloses = /非表示/.test(info) && new RegExp(`${all - okN}件`).test(info);
  await p.click('#petchips .chip[data-pet="okcond"]');
  await p.waitForTimeout(120);
  const okCondN = await visible();
  await p.click('#petchips .chip[data-pet="all"]');
  await p.waitForTimeout(120);
  return okN >= 1 && okN <= all && okCondN >= okN && discloses && (await visible()) === all;
});

await T("ペット列が4値を出し、記載なしの行に要確認が付く", async () => {
  const vals = await p.locator("tr.prow").evaluateAll((rs) => rs.map((r) => r.getAttribute("data-pet")));
  const cells = await p.locator("tr.prow td:nth-child(11)").allTextContents();
  return vals.every((v) => ["ok", "cond", "ng", "none"].includes(v)) &&
    vals.includes("none") && cells.some((c) => /記載なし/.test(c) && /要確認/.test(c));
});

await b.close();
console.log(ok.map((s) => "  OK  " + s).join("\n"));
if (fail.length) console.log(fail.map((s) => "  NG  " + s).join("\n"));
if (errs.length) console.log("JSエラー:\n" + errs.join("\n"));
console.log(`\n${ok.length}/${ok.length + fail.length} 合格` + (errs.length ? ` / JSエラー${errs.length}件` : " / JSエラーなし"));
process.exit(fail.length || errs.length ? 1 : 0);
