// tests/ui/plan3d.ui.mjs — 間取りシミュレーター(plan3d.html)の操作検査(実ブラウザ)。npm test には含めない。
//   準備: npm i --no-save playwright-core   実行: node site/build.js && node tests/ui/plan3d.ui.mjs [screenshot-dir]
// ES module + importmap は file:// で動かないため、dist を一時HTTPサーバで配信して検査する。
// 検査: JSエラーなし / 3D(WebGL)が初期化される / 階タブ・ツール・追加・回転・削除・元に戻す・書き出しJSONの形 / localStorage保存
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = "site/dist";
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css" };
const srv = createServer((req, res) => {
  const p = join(DIST, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html");
  if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" }); res.end(readFileSync(p));
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${srv.address().port}/plan3d.html`;
const shotDir = process.argv[2]; if (shotDir) mkdirSync(shotDir, { recursive: true });

let exe = process.env.CHROMIUM_PATH;
if (!exe) { const roots = readdirSync("/opt/pw-browsers").filter((d) => d.startsWith("chromium-")); exe = roots.map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find((p) => existsSync(p)); }
const b = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
const checks = [];
const ok = (name, cond, extra = "") => { checks.push([name, !!cond, extra]); if (!cond) console.error("✗", name, extra); else console.log("✓", name); };
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errors.push("console: " + m.text()); });
page.on("requestfailed", (r) => errors.push("requestfailed: " + r.url()));
page.on("response", (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`http ${r.status()}: ${r.url()}`); });
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(1500);
ok("既定の案は採用案D(localStorage無し)", await page.evaluate(() => document.querySelector('[data-variant="D"]').classList.contains("on") && window.plan3dState().floors["2F"].items.some((i) => i.type === "bed_s")));
await page.click('[data-variant="A"]'); await page.waitForLoadState("load"); await page.waitForTimeout(1200);   // 以降の検査は参考プランAで行う
ok("既定が 3D・全階・30cm", await page.evaluate(() => document.getElementById("planApp").dataset.mode === "3d" && document.querySelector('[data-view="all"]').classList.contains("on") && document.querySelector('[data-wallh="0.3"]').classList.contains("on")));
await page.click('[data-mode="both"]'); await page.click('[data-view="floor"]'); await page.waitForTimeout(400);


ok("JSエラーなし", errors.length === 0, errors.join(" | "));
ok("3Dキャンバスに WebGL コンテキスト", await page.evaluate(() => { const c = document.getElementById("view3d"); return !!(c.getContext("webgl2") || c.getContext("webgl")); }));
ok("2Dキャンバスが描画されている", await page.evaluate(() => { const c = document.getElementById("plan2d"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] < 60 && d[i + 1] < 60) n++; return n > 20; }));
ok("PLAN が注入され階が4つ", await page.evaluate(() => Object.keys(window.PLAN.FLOORS).length === 4));
if (shotDir) await page.screenshot({ path: join(shotDir, "plan3d-1F.png"), fullPage: false });

// 階タブ
for (const fid of ["2F", "3F", "LOFT"]) { await page.click(`[data-floor="${fid}"]`); await page.waitForTimeout(300); if (shotDir) await page.screenshot({ path: join(shotDir, `plan3d-${fid}.png`) }); }
ok("階タブ切替で on が移る", await page.evaluate(() => document.querySelector('[data-floor="LOFT"]').classList.contains("on")));
await page.click('[data-view="explode"]'); await page.waitForTimeout(400); if (shotDir) await page.screenshot({ path: join(shotDir, "plan3d-explode.png") });
await page.click('[data-floor="1F"]'); await page.click('[data-view="floor"]'); await page.waitForTimeout(300);

// 1Fのトイレをクリック→プロパティに隙間と階段下の頭上高さ
const toiletPx = await page.evaluate(() => { const c = document.getElementById("plan2d"); const r = c.getBoundingClientRect(); const P = window.PLAN; const V = { x0: -1.3, y0: -1.9, x1: 4.7 }; const s = r.width / (V.x1 - V.x0); const it = { x: 2.92, y: 5.0 }; return { x: r.left + (it.x - V.x0) * s, y: r.top + (it.y - V.y0) * s }; });
await page.mouse.click(toiletPx.x, toiletPx.y); await page.waitForTimeout(200);
const propsText = await page.textContent("#props");
ok("トイレ選択でクリアランスが出る", /前\(N\)|前\(S\)|前\(E\)|前\(W\)/.test(propsText) && propsText.includes("便器"), propsText.slice(0, 120));
ok("階段下の頭上高さが出る", propsText.includes("階段の下"), propsText.slice(-160));
if (shotDir) await page.screenshot({ path: join(shotDir, "plan3d-toilet.png") });

// 回転・矢印移動・削除・元に戻す
const before = await page.evaluate(() => window.plan3dState().floors["1F"].items.find((i) => i.type === "toilet"));
await page.keyboard.press("r"); await page.keyboard.press("ArrowRight"); await page.waitForTimeout(100);
const after = await page.evaluate(() => window.plan3dState().floors["1F"].items.find((i) => i.type === "toilet"));
ok("R で回転・矢印で1cm移動して localStorage に保存", after.rot === (before.rot + 90) % 360 && Math.abs(after.x - before.x - 0.01) < 1e-6, JSON.stringify({ before, after }));
await page.keyboard.press("Delete"); await page.waitForTimeout(100);
ok("Delete で消える", await page.evaluate(() => !window.plan3dState().floors["1F"].items.some((i) => i.type === "toilet")));
await page.click("#btnUndo"); await page.waitForTimeout(100);
ok("元に戻すで復活", await page.evaluate(() => window.plan3dState().floors["1F"].items.some((i) => i.type === "toilet")));

// 追加(UB1616)→種類の選択肢が全カタログ
await page.selectOption("#addSel", "ub1616"); await page.click("#btnAdd"); await page.waitForTimeout(100);
ok("追加した設備が選択状態でプロパティに出る", (await page.textContent("#props")).includes("1616"));
// 部屋の広さツール: 洗面脱衣室の中をクリック
await page.click('[data-tool="area"]');
const washPx = await page.evaluate(() => { const c = document.getElementById("plan2d"); const r = c.getBoundingClientRect(); const V = { x0: -1.3, y0: -1.9, x1: 4.7 }; const s = r.width / (V.x1 - V.x0); return { x: r.left + (1.2 - V.x0) * s, y: r.top + (4.3 - V.y0) * s }; });
await page.mouse.click(washPx.x, washPx.y); await page.waitForTimeout(200);
const areaText = await page.textContent("#props");
const m = areaText.match(/([\d.]+) m² ≈ ([\d.]+) 帖/);
ok("部屋の広さ(洗面脱衣室)が 2.2〜2.6m² で出る", m && Number(m[1]) > 2.2 && Number(m[1]) < 2.6, areaText.slice(0, 100));
if (shotDir) await page.screenshot({ path: join(shotDir, "plan3d-area.png") });
// 寸法ツール
await page.click('[data-tool="measure"]'); await page.mouse.click(washPx.x, washPx.y); await page.mouse.click(washPx.x + 60, washPx.y); await page.waitForTimeout(100);
ok("寸法ツールでJSエラーなし", errors.length === 0, errors.join(" | "));
// 壁ドラッグ: 洗面/UB の壁(y=5.005)を南へ
await page.click('[data-tool="select"]');
const wallPx = await page.evaluate(() => { const c = document.getElementById("plan2d"); const r = c.getBoundingClientRect(); const V = { x0: -1.3, y0: -1.9, x1: 4.7 }; const s = r.width / (V.x1 - V.x0); return { x: r.left + (0.8 - V.x0) * s, y: r.top + (5.005 - V.y0) * s, s }; });
await page.mouse.move(wallPx.x, wallPx.y); await page.mouse.down(); await page.mouse.move(wallPx.x, wallPx.y + wallPx.s * 0.455, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(150);
const wallY = await page.evaluate(() => { const st = window.plan3dState(); const w = st.floors["1F"].walls.find((w) => Math.abs(w.y1 - w.y2) < 1e-6 && w.x1 === 0 && Math.abs(w.y1 - 5.46) < 0.02); return w?.y1; });
ok("壁をドラッグすると45.5mm刻みで動く(5,005→5,460)", wallY != null && Math.abs(wallY - 5.46) < 0.02, String(wallY));
// 視点ボタン・壁高さ・書き出し
for (const cam of ["top", "north", "eye", "bird"]) await page.click(`[data-cam="${cam}"]`);
await page.click('[data-wallh="full"]'); await page.waitForTimeout(300); if (shotDir) await page.screenshot({ path: join(shotDir, "plan3d-fullwall.png") });
ok("視点・壁高さ切替でJSエラーなし", errors.length === 0, errors.join(" | "));
// リセット(confirm を受ける)
page.once("dialog", (d) => d.accept());
await page.click("#btnReset"); await page.waitForTimeout(200);
ok("リセットで初期配置に戻る(1Fの壁が10本)", await page.evaluate(() => window.plan3dState().floors["1F"].walls.length === 12));
// 再読込で復元
await page.reload({ waitUntil: "load" }); await page.waitForTimeout(800);
ok("再読込後もJSエラーなし・保存状態の表示", errors.length === 0 && (await page.textContent("#saveState")).includes("復元"), errors.join(" | "));

// --- 画面切替(平面図/3D/並べる)・3Dでのクリック選択・3Dの寸法線・引っ張り計測・ピンチ拡大(2026-10-14追加) ---
await page.click('[data-mode="3d"]'); await page.waitForTimeout(300);
ok("画面=3D で平面図が隠れ3Dが残る", await page.evaluate(() => document.getElementById("plan2d").clientWidth === 0 && document.getElementById("view3d").clientWidth > 600 && localStorage.getItem("fudosan-plan3d-kamiya2-v1:mode2") === "3d"));
ok("3Dだけの画面でもツールとプロパティ欄が見える", await page.evaluate(() => document.getElementById("props").clientHeight > 0 && document.querySelector('[data-tool="select"]').clientHeight > 0));
await page.click('[data-cam="top"]'); await page.waitForTimeout(500);
const tp = await page.evaluate(() => window.plan3dProject(2.92, 5.0, "1F", 0.4));
await page.mouse.click(tp[0], tp[1]); await page.waitForTimeout(300);
ok("3D上のクリックで便器が選択される", (await page.textContent("#props")).includes("便器"), (await page.textContent("#props")).slice(0, 80));
if (shotDir) await page.screenshot({ path: join(shotDir, "plan3d-3donly-dims.png") });
await page.click('[data-cam="bird"]'); await page.waitForTimeout(500); if (shotDir) await page.locator("#view3d").screenshot({ path: join(shotDir, "plan3d-3d-bird.png") });
await page.click('[data-mode="2d"]'); await page.waitForTimeout(300);
ok("画面=平面図 で3Dが隠れる", await page.evaluate(() => document.getElementById("view3d").clientWidth === 0 && document.getElementById("plan2d").clientWidth > 300));
await page.click('[data-mode="both"]'); await page.waitForTimeout(300);
ok("画面=並べる で両方", await page.evaluate(() => document.getElementById("view3d").clientWidth > 0 && document.getElementById("plan2d").clientWidth > 0));
// 引っ張り計測: 洗面脱衣室の西壁面から東壁面へ
await page.click('[data-tool="measure"]');
const m0 = await page.evaluate(() => { const c = document.getElementById("plan2d"); const r = c.getBoundingClientRect(); const V = { x0: -1.3, y0: -1.9, x1: 4.7 }; const s = r.width / (V.x1 - V.x0); return { x1: r.left + (0.08 - V.x0) * s, x2: r.left + (1.5 - V.x0) * s, y: r.top + (4.5 - V.y0) * s }; });
await page.mouse.move(m0.x1, m0.y); await page.mouse.down(); await page.mouse.move(m0.x2, m0.y, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(150);
const meas = await page.evaluate(() => { const c = document.getElementById("plan2d"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let red = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] < 90 && d[i + 2] < 90) red++; return red; });
ok("押して引っ張ると寸法線(赤)が描かれる", meas > 200, String(meas));
// ホイール/ボタンで拡大縮小・全体
await page.click('[data-tool="select"]');
await page.click("#btnZoomIn"); await page.click("#btnZoomIn"); await page.waitForTimeout(100);
const zoomed = await page.evaluate(() => { const c = document.getElementById("plan2d"); const r = c.getBoundingClientRect(); return r; });
// ピンチ: 2本のポインタを合成して配信
await page.evaluate(() => {
  const c = document.getElementById("plan2d"); const r = c.getBoundingClientRect();
  const ev = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: id === 1, clientX: r.left + x, clientY: r.top + y, bubbles: true, button: 0, buttons: 1 }));
  ev("pointerdown", 1, 200, 400); ev("pointerdown", 2, 240, 400); ev("pointermove", 1, 150, 400); ev("pointermove", 2, 290, 400); ev("pointerup", 1, 150, 400); ev("pointerup", 2, 290, 400);
});
await page.waitForTimeout(100);
await page.click("#btnZoomFit"); await page.waitForTimeout(100);
ok("拡大・ピンチ・全体の操作でJSエラーなし", errors.length === 0, errors.join(" | "));
void zoomed;

// --- 規定サイズ・角ハンドル・長押し移動(2026-10-14追加) ---
await page.click('[data-mode="both"]'); await page.click('[data-floor="1F"]'); await page.click('[data-view="floor"]'); await page.click('[data-tool="select"]'); await page.waitForTimeout(300);
const bedPx = await page.evaluate(() => { const c = document.getElementById("plan2d"); const r = c.getBoundingClientRect(); const V = { x0: -1.3, y0: -1.9, x1: 4.7 }; const s = r.width / (V.x1 - V.x0); const it = window.plan3dState().floors["1F"].items.find((i) => i.type === "bed_s"); return { x: r.left + (it.x - V.x0) * s, y: r.top + (it.y - V.y0) * s, se: { x: r.left + (it.x + 0.485 - V.x0) * s, y: r.top + (it.y + 0.975 - V.y0) * s }, s }; });
await page.mouse.click(bedPx.x, bedPx.y); await page.waitForTimeout(200);
ok("ベッド選択で規定サイズのボタン(シングル〜キング)が出る", (await page.textContent("#props")).includes("セミダブル") && (await page.textContent("#props")).includes("キング"));
// 2D: 南東の角を +23cm 東へ引っ張る → セミダブル(1,200)に吸着
await page.mouse.move(bedPx.se.x, bedPx.se.y); await page.mouse.down(); await page.mouse.move(bedPx.se.x + 0.23 * bedPx.s, bedPx.se.y, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
const bed = await page.evaluate(() => window.plan3dState().floors["1F"].items.find((i) => /^bed_/.test(i.type)));
ok("角のハンドルを引っ張るとセミダブル(bed_sd)に吸着する", bed?.type === "bed_sd", JSON.stringify(bed));
// さらに +5cm(規定の中間・1,250)引っ張っても自由寸法にならず規定(セミダブル 1,200)のまま(2026-10-14「規定サイズに吸着するように」)
await page.mouse.move(bedPx.se.x + 0.23 * bedPx.s, bedPx.se.y); await page.mouse.down(); await page.mouse.move(bedPx.se.x + 0.28 * bedPx.s, bedPx.se.y, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(200);
const bed2 = await page.evaluate(() => window.plan3dState().floors["1F"].items.find((i) => /^bed_/.test(i.type)));
ok("中間まで引っ張っても規定サイズ(bed_sd・w未設定か1.20)のまま=自由寸法にならない", bed2?.type === "bed_sd" && (bed2.w == null || Math.abs(bed2.w - 1.2) < 1e-9), JSON.stringify(bed2));
await page.click('[data-preset="2"]'); await page.waitForTimeout(150);
ok("規定サイズボタンでダブルに切り替わる", await page.evaluate(() => window.plan3dState().floors["1F"].items.some((i) => i.type === "bed_d")));
// 3D: 便器を長押し→引っ張って移動
await page.click('[data-cam="top"]'); await page.locator("#view3d").scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
const t0 = await page.evaluate(() => { const it = window.plan3dState().floors["1F"].items.find((i) => i.type === "toilet"); return [it.x, it.y, ...window.plan3dProject(it.x, it.y, "1F", 0.4)]; });
await page.mouse.move(t0[2], t0[3]); await page.mouse.down(); await page.waitForTimeout(600); await page.mouse.move(t0[2] - 40, t0[3], { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300);
const t1 = await page.evaluate(() => { const it = window.plan3dState().floors["1F"].items.find((i) => i.type === "toilet"); return [it.x, it.y]; });
ok("3Dで長押し→引っ張ると便器が動く", Math.abs(t1[0] - t0[0]) > 0.1 || Math.abs(t1[1] - t0[1]) > 0.1, JSON.stringify({ t0: t0.slice(0, 2), t1 }));
ok("長押し移動後にカメラ操作が戻る・JSエラーなし", errors.length === 0, errors.join(" | "));

// 外観(壁を天井まで・全階)と内観(2F LDK・目線)のスクリーンショット(目視確認用。検査は JS エラーのみ)
await page.click('[data-mode="3d"]'); await page.click('[data-wallh="full"]'); await page.click('[data-view="all"]'); await page.click('[data-cam="bird"]'); await page.waitForTimeout(600);
if (shotDir) await page.locator("#view3d").screenshot({ path: join(shotDir, "plan3d-full-bird.png") });
await page.click('[data-floor="2F"]'); await page.click('[data-view="floor"]'); await page.click('[data-cam="eye"]'); await page.waitForTimeout(600);
if (shotDir) await page.locator("#view3d").screenshot({ path: join(shotDir, "plan3d-eye-ldk.png") });
ok("外観・内観の描画でJSエラーなし", errors.length === 0, errors.join(" | "));
// --- 屋根とロフトの頭上高さ(2026-10-14「屋根のイメージも欲しい。どれくらいロフトの高さになるのか」) ---
await page.click('[data-floor="LOFT"]'); await page.click('[data-mode="both"]'); await page.click('[data-view="floor"]'); await page.click('[data-cam="bird"]'); await page.waitForTimeout(500);
const loftPx = await page.evaluate(() => { const c = document.getElementById("plan2d"); const r = c.getBoundingClientRect(); const V = { x0: -1.3, y0: -1.9, x1: 4.7 }; const s = r.width / (V.x1 - V.x0); const it = window.plan3dState().floors["LOFT"].items[0]; return { x: r.left + (it.x - V.x0) * s, y: r.top + (it.y - V.y0) * s }; });
await page.mouse.click(loftPx.x, loftPx.y); await page.waitForTimeout(200);
const loftProps = await page.textContent("#props");
ok("ロフトの布団を選ぶと屋根下の頭上高さ(北端/南端)が出る", /屋根の下: 頭上の高さ 北端 \d\.\d\dm \/ 南端 \d\.\d\dm/.test(loftProps), loftProps.slice(0, 200));
ok("ロフトの頭上高さが 0.85〜1.245 の範囲", (() => { const m = loftProps.match(/北端 (\d\.\d\d)m \/ 南端 (\d\.\d\d)m/); return m && [m[1], m[2]].every((v) => Number(v) >= 0.85 && Number(v) <= 1.245); })());
if (shotDir) await page.locator("#view3d").screenshot({ path: join(shotDir, "plan3d-loft-roof.png") });
await page.click('[data-view="all"]'); await page.click('[data-cam="bird"]'); await page.click('[data-wallh="full"]'); await page.waitForTimeout(500);
if (shotDir) await page.locator("#view3d").screenshot({ path: join(shotDir, "plan3d-full-roof.png") });
await page.click("#chkRoof"); await page.waitForTimeout(300); await page.click("#chkRoof"); await page.waitForTimeout(300);
ok("屋根の表示切替・妻壁の塗り(天井まで)でJSエラーなし", errors.length === 0, errors.join(" | "));
const info3d = await page.textContent("#info3d");
ok("3Dの説明にロフトの頭上(棟直下1.245)が出る", info3d.includes("棟直下1.245"), info3d.slice(0, 120));
if (shotDir) { await page.click('[data-mode="2d"]'); await page.waitForTimeout(200); await page.locator("#plan2d").screenshot({ path: join(shotDir, "plan3d-loft-2d.png") }); }
// --- 改案B(2026-10-14「バルコニー無し・3階三部屋・風呂2階」) ---
await page.click('[data-variant="B"]'); await page.waitForLoadState("load"); await page.waitForTimeout(1500);
ok("案Bに切り替わり再読込後もJSエラーなし", errors.length === 0 && await page.evaluate(() => document.querySelector('[data-variant="B"]').classList.contains("on") && localStorage.getItem("fudosan-plan3d-kamiya2-v1:variant") === "B"), errors.join(" | "));
const bState = await page.evaluate(() => window.plan3dState());
ok("案Bの2Fに UB と洗濯機・3Fにベッド3台(三部屋)", bState.floors["2F"].items.some((i) => i.type === "ub1316") && bState.floors["2F"].items.some((i) => i.type === "washer") && bState.floors["3F"].items.filter((i) => /^bed_/.test(i.type)).length === 3);
ok("案Bの2F北外壁が y=-0.455(張り出し)", bState.floors["2F"].walls.some((w) => w.kind === "ext" && Math.abs(w.y1 + 0.455) < 1e-9 && Math.abs(w.y2 + 0.455) < 1e-9));
await page.click('[data-mode="both"]'); await page.click('[data-floor="3F"]'); await page.click('[data-view="floor"]'); await page.click('[data-cam="top"]'); await page.waitForTimeout(500);
if (shotDir) { await page.locator("#plan2d").screenshot({ path: join(shotDir, "plan3d-B-3F-2d.png") }); await page.locator("#view3d").screenshot({ path: join(shotDir, "plan3d-B-3F-3d.png") }); }
await page.click('[data-floor="2F"]'); await page.waitForTimeout(400);
if (shotDir) { await page.locator("#plan2d").screenshot({ path: join(shotDir, "plan3d-B-2F-2d.png") }); }
await page.click('[data-floor="1F"]'); await page.waitForTimeout(400);
if (shotDir) { await page.locator("#plan2d").screenshot({ path: join(shotDir, "plan3d-B-1F-2d.png") }); }
await page.click('[data-view="all"]'); await page.click('[data-cam="bird"]'); await page.click('[data-wallh="full"]'); await page.waitForTimeout(600);
if (shotDir) await page.locator("#view3d").screenshot({ path: join(shotDir, "plan3d-B-full.png") });
// 案Bの部屋の広さ(3F 洋室M)が 5〜6.5m²
await page.click('[data-floor="3F"]'); await page.click('[data-view="floor"]'); await page.click('[data-tool="area"]'); await page.waitForTimeout(200);
const mPx = await page.evaluate(() => { const c = document.getElementById("plan2d"); const r = c.getBoundingClientRect(); const V = { x0: -1.3, y0: -1.9, x1: 4.7 }; const s = r.width / (V.x1 - V.x0); return { x: r.left + (0.7 - V.x0) * s, y: r.top + (4.6 - V.y0) * s }; });
await page.mouse.click(mPx.x, mPx.y); await page.waitForTimeout(300);
const mArea = await page.textContent("#props");
ok("案B 3F洋室Mの広さが 5〜6.5m²(内法≈5.7)", /([\d.]+) ?m²/.test(mArea) && (() => { const v = Number(mArea.match(/([\d.]+) ?m²/)[1]); return v >= 5.0 && v <= 6.5; })(), mArea.slice(0, 120));
ok("案Bの操作でJSエラーなし", errors.length === 0, errors.join(" | "));
// --- 改案C(2026-10-17「車庫は一時停止・1Fも張り出し・風呂1F」) ---
await page.click('[data-variant="C"]'); await page.waitForLoadState("load"); await page.waitForTimeout(1500);
const cState = await page.evaluate(() => window.plan3dState());
ok("案Cに切り替わりJSエラーなし・1FにUBと洗濯機・2Fに便器(風呂無し)", errors.length === 0 && cState.floors["1F"].items.some((i) => i.type === "ub1316") && cState.floors["1F"].items.some((i) => i.type === "washer") && cState.floors["2F"].items.some((i) => i.type === "toilet") && !cState.floors["2F"].items.some((i) => i.type === "ub1316"), errors.join(" | "));
ok("案Cの1F東外壁が y=-0.455 から(3層同じ外形)", cState.floors["1F"].walls.some((w) => w.kind === "ext" && Math.abs(w.x1 - 3.375) < 1e-9 && Math.abs(w.y1 + 0.455) < 1e-9));
await page.click('[data-mode="both"]'); await page.click('[data-floor="1F"]'); await page.click('[data-view="floor"]'); await page.click('[data-cam="top"]'); await page.waitForTimeout(500);
if (shotDir) { await page.locator("#plan2d").screenshot({ path: join(shotDir, "plan3d-C-1F-2d.png") }); }
await page.click('[data-floor="2F"]'); await page.waitForTimeout(400);
if (shotDir) { await page.locator("#plan2d").screenshot({ path: join(shotDir, "plan3d-C-2F-2d.png") }); }
await page.click('[data-view="all"]'); await page.click('[data-cam="bird"]'); await page.click('[data-wallh="full"]'); await page.waitForTimeout(600);
if (shotDir) await page.locator("#view3d").screenshot({ path: join(shotDir, "plan3d-C-full.png") });
ok("案Cの操作でJSエラーなし", errors.length === 0, errors.join(" | "));
// --- 改案D(2026-10-17「駐車場は削らず、1階の部屋を無くして2階のリビング南側に」) ---
await page.click('[data-variant="D"]'); await page.waitForLoadState("load"); await page.waitForTimeout(1500);
const dState = await page.evaluate(() => window.plan3dState());
ok("案Dに切り替わりJSエラーなし・1Fに車とUB・2Fにベッド(続き間)と縦向きキッチン", errors.length === 0 && dState.floors["1F"].items.some((i) => i.type === "car_compact") && dState.floors["1F"].items.some((i) => i.type === "ub1316") && dState.floors["2F"].items.some((i) => i.type === "bed_s") && dState.floors["2F"].items.some((i) => i.type === "kitchen2400" && i.rot === 90), errors.join(" | "));
await page.click('[data-mode="both"]'); await page.click('[data-floor="2F"]'); await page.click('[data-view="floor"]'); await page.click('[data-cam="top"]'); await page.waitForTimeout(500);
if (shotDir) { await page.locator("#plan2d").screenshot({ path: join(shotDir, "plan3d-D-2F-2d.png") }); }
await page.click('[data-floor="1F"]'); await page.waitForTimeout(400);
if (shotDir) { await page.locator("#plan2d").screenshot({ path: join(shotDir, "plan3d-D-1F-2d.png") }); }
ok("案Dの操作でJSエラーなし", errors.length === 0, errors.join(" | "));
// 案Aへ戻す(以後の検査・既定に影響しない)
await page.click('[data-variant="A"]'); await page.waitForLoadState("load"); await page.waitForTimeout(800);
ok("案Aへ戻る(1Fに洗面台)", await page.evaluate(() => window.plan3dState().floors["1F"].items.some((i) => i.type === "washstand750")));

await b.close(); srv.close();
const fails = checks.filter((c) => !c[1]);
console.log(`\n${checks.length - fails.length}/${checks.length} 項目 OK`);
process.exit(fails.length ? 1 : 0);
