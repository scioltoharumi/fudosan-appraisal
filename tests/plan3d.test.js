// tests/plan3d.test.js — 間取りシミュレーター(plan3d.html)の回帰ガード。
// 2026-10-14ユーザー要望「図面を読み込み、シミュレーション出来るよう3Dモデル化して(トイレの位置・洗面所の広さ等を検討したい)」。
// 検査するのは「寸法データが図面の面積表と整合していること」「前提(図面に無いもの)と判定しないことの開示」「three.js が同梱されページが vendor を参照すること」
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadProperty } from "../engine/io.js";
import { PLAN, FLOORS, LOT, ITEM_CATALOG, ASSUMPTIONS, STAIR, roomArea, polygonArea, renderPlan3d } from "../site/templates/plan3d.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (許容${tol})`);

test("plan3d: 寸法が図面の面積表と整合する(敷地47.52・各階30.71・1F住宅21.68・車庫8.13・ポーチ2.63・ロフト・吹抜)", () => {
  near(polygonArea(LOT.polygon), PLAN.areas.site, 0.05, "敷地(区割図の4辺)");
  near(PLAN.W * PLAN.L, PLAN.areas.f2, 0.01, "建築面積=2F=3F 9,100×3,375");
  const f1 = FLOORS["1F"].rooms;
  const garage = f1.find((r) => r.kind === "garage"), porch = f1.find((r) => r.name === "ポーチ");
  near(roomArea(garage), PLAN.areas.f1_garage, 1.1, "車庫(芯々 2,225×3,185=7.09。図面8.13は面積の取り方の差)");
  near(roomArea(porch), PLAN.areas.f1_porch, 0.6, "ポーチ(1,150×1,820=2.09。図面2.63は庇下を含む)");
  const house = PLAN.W * PLAN.L - roomArea(garage) - roomArea(porch);
  near(house, PLAN.areas.f1_house, 0.3, "1F住宅部分=建築面積−車庫−ポーチ");
  const loft = FLOORS["LOFT"].rooms;
  near(roomArea(loft.find((r) => r.name.startsWith("ロフト"))), PLAN.areas.loft, 0.02, "ロフト 2,470×3,375");
  near(roomArea(loft.find((r) => r.kind === "void")), PLAN.areas.void, 0.02, "吹抜 3,445×3,375");
  // 納戸4.3帖・3F洋室の帖数は内法で(壁厚の仮定込みで ±0.3帖)
  const nando = f1.find((r) => r.name.includes("納戸"));
  near((nando.x1 - nando.x0 - 0.12) * (nando.y1 - nando.y0 - 0.12) / 1.62, 4.3, 0.3, "納戸 4.3帖(内法)");
  for (const fid of Object.keys(FLOORS)) for (const r of FLOORS[fid].rooms) assert.ok(r.x0 >= -1e-9 && r.x1 <= PLAN.W + 1e-9 && r.y1 <= PLAN.L + 1e-9, `${fid} ${r.name} が建物内`);
});

test("plan3d: 壁・設備・階段が建物の範囲に収まり、階段の段割りが階高と整合する", () => {
  for (const [fid, f] of Object.entries(FLOORS)) {
    for (const w of f.walls) for (const v of [w.x1, w.x2]) assert.ok(v >= -1e-9 && v <= PLAN.W + 1e-9, `${fid} 壁x ${v}`);
    for (const w of f.walls) for (const v of [w.y1, w.y2]) assert.ok(v >= -1e-9 && v <= PLAN.L + 1e-9, `${fid} 壁y ${v}`);
    for (const w of f.walls) assert.ok(Math.abs(w.x1 - w.x2) < 1e-9 || Math.abs(w.y1 - w.y2) < 1e-9, `${fid} 壁は直交`);
    for (const it of f.items) { assert.ok(ITEM_CATALOG[it.type], `${fid} ${it.type} はカタログにある`); assert.ok(it.y > -1.2 && it.y < PLAN.L + 0.5 && it.x > -0.5 && it.x < PLAN.W + 0.5, `${fid} ${it.type} の位置`); }
    for (const o of f.openings) assert.ok(["door", "window"].includes(o.type) && o.w > 0.3, `${fid} 開口 ${o.type}`);
  }
  near(STAIR.yBottom - STAIR.yTop, 2.73, 1e-9, "階段 2,730(2F寸法)");
  near(STAIR.yTurn - STAIR.yTop, 1.82, 1e-9, "直階段部 1,820(3Fの開口)");
  const riser = PLAN.LEVELS["1F"].story / (STAIR.winders + STAIR.straight);
  assert.ok(riser > 0.18 && riser < 0.23, `蹴上 ${riser.toFixed(3)}m が住宅の範囲(0.18〜0.23)`);
  // 1Fトイレは階段の下: 便器位置の頭上が 1.2〜2.2m(段割りの仮定で変わる参照値)
  const toilet = FLOORS["1F"].items.find((i) => i.type === "toilet");
  assert.ok(toilet.x > STAIR.x0 && toilet.x < STAIR.x1 && toilet.y > STAIR.yTop && toilet.y < STAIR.yTurn, "1Fトイレが階段下にある");
  // 高さ10m制限
  const top = PLAN.floorHeightGL + PLAN.LEVELS.LOFT.z + PLAN.LEVELS.LOFT.ceil;
  assert.ok(top <= 10.0, `建物高さ ${top.toFixed(2)}m ≤ 10m`);
  assert.ok(PLAN.LEVELS.LOFT.ceil <= 1.4, "ロフト天井高 ≤ 1.4m");
});

test("plan3d: ページの開示(判定しない・前提・出典)と three.js 同梱の参照", () => {
  const property = loadProperty("kamiya2-adcast-a");
  const html = renderPlan3d({ asOf: "2026-10-14", property });
  const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ");
  assert.ok(text.includes("判定はしません"), "判定しない、の開示");
  assert.ok(text.includes("読み取りの前提(図面に無いもの)"), "前提の節");
  assert.ok(text.includes("階の高さ(仮定") && text.includes(`GL+${(PLAN.floorHeightGL + PLAN.LEVELS["2F"].z).toFixed(2)}m`), "階の高さの表(床高はLEVELSから)");
  for (const a of ASSUMPTIONS) assert.ok(text.includes(a.replace(/\*\*/g, "").slice(0, 20)), `前提: ${a.slice(0, 20)}`);
  assert.ok(text.includes("図面の画像そのものと販売会社の連絡先は載せない"), "図面画像・連絡先を載せない開示(運用ルール3)");
  assert.ok(text.includes("このブラウザにだけ保存"), "保存先の開示");
  assert.ok(html.includes('"three":"./vendor/three.module.min.js"'), "importmap が vendor の three を指す");
  assert.ok(html.includes("./vendor/OrbitControls.js"), "OrbitControls も vendor から");
  assert.ok(!/https?:\/\/[^"'\s]*(cdn|unpkg|jsdelivr)/i.test(html), "外部CDNに依存しない");
  assert.ok(html.includes("window.PLAN = {"), "PLAN が注入されている");
  for (const k of ['data-mode="2d"', 'data-mode="3d"', 'data-mode="both"', 'id="chkDims"', 'id="btnZoomFit"']) assert.ok(html.includes(k), `UI部品: ${k}`);
  assert.ok(html.includes("寸法チェーン・各部屋の内法・選択した設備の隙間"), "3Dに寸法を描くことの説明");
  assert.ok(!html.includes("</script>".repeat(2)), "script の閉じが二重でない");
  for (const f of ["three.module.min.js", "OrbitControls.js", "THREE-LICENSE"]) assert.ok(existsSync(join(ROOT, "site", "vendor", f)), `site/vendor/${f} が同梱`);
  assert.ok(readFileSync(join(ROOT, "site", "vendor", "OrbitControls.js"), "utf8").includes("from './three.module.min.js'"), "OrbitControls の import が同梱の three を指す");
  assert.equal(property.plan3d_page, "plan3d.html", "物件YAMLから物件ページへ導線が出る");
  // 床高は YAML(ユーザー提供 0.461)と一致
  assert.equal(PLAN.floorHeightGL, property.hazard_check.flood_fermi.floor_height_m);
});
