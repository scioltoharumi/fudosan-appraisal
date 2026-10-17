// tests/plan3d.test.js — 間取りシミュレーター(plan3d.html)の回帰ガード。
// 2026-10-14ユーザー要望「図面を読み込み、シミュレーション出来るよう3Dモデル化して(トイレの位置・洗面所の広さ等を検討したい)」。
// 検査するのは「寸法データが図面の面積表と整合していること」「前提(図面に無いもの)と判定しないことの開示」「three.js が同梱されページが vendor を参照すること」
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadProperty } from "../engine/io.js";
import { PLAN, FLOORS, FLOORS_B, FLOORS_C, FLOORS_D, VARIANTS, CHOSEN_VARIANT, CHECK_A, CHECK_B, CHECK_C, CHECK_D, GARAGE_C, EXT_N, B_CHANGES, B_CAVEATS, C_CHANGES, C_CAVEATS, D_CHANGES, D_CAVEATS, LOT, ITEM_CATALOG, ASSUMPTIONS, STAIR, ROOF, roofHeightAt, roomArea, polygonArea, netArea, renderPlan3d } from "../site/templates/plan3d.js";

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
  // 断面スケッチの縦寸法: 461 / 2,250 / 400 / 2,400 / 420 / 2,250 / 300 / 1,245(棟下端 GL+9.726)。屋根厚(仮定)を足しても10m制限内
  near(PLAN.LEVELS["2F"].z, 2.25 + 0.40, 1e-9, "2F床 = 1F天井2,250+床厚400");
  near(PLAN.LEVELS["3F"].z, 2.65 + 2.40 + 0.42, 1e-9, "3F床 = +2F天井2,400+床厚420");
  near(PLAN.LEVELS.LOFT.z, 5.47 + 2.25 + 0.30, 1e-9, "ロフト床 = +3F天井2,250+床厚300");
  const top = PLAN.floorHeightGL + PLAN.LEVELS.LOFT.z + PLAN.LEVELS.LOFT.ceil;
  near(top, 9.726, 1e-9, "棟下端 GL+9.726");
  assert.ok(top + ROOF.thickness <= 10.0, `屋根上端 ${(top + ROOF.thickness).toFixed(2)}m ≤ 10m`);
  assert.ok(PLAN.LEVELS.LOFT.ceil <= 1.4, "ロフト天井高(棟直下) ≤ 1.4m");
  // 屋根勾配: 軒(y=0・L)で0・棟で1,245。ロフト両端の頭上はスケッチの「≒850」と整合(0.85〜0.95)
  near(roofHeightAt(0), 0, 1e-9, "北の軒で0"); near(roofHeightAt(PLAN.L), 0, 1e-9, "南の軒で0"); near(roofHeightAt(ROOF.ridgeY), 1.245, 1e-9, "棟で1,245");
  const lr = FLOORS.LOFT.floorRect;
  for (const y of [lr.y0, lr.y1]) { const h = roofHeightAt(y); assert.ok(h >= 0.85 && h <= 0.95, `ロフト端 y${y} の頭上 ${h.toFixed(3)} ≒ 0.85`); }
});

test("plan3d: ページの開示(判定しない・前提・出典)と three.js 同梱の参照", () => {
  const property = loadProperty("kamiya2-adcast-a");
  const html = renderPlan3d({ asOf: "2026-10-14", property });
  const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ");
  assert.ok(text.includes("判定はしません"), "判定しない、の開示");
  assert.ok(text.includes("読み取りの前提(図面に無いもの)"), "前提の節");
  assert.ok(text.includes("階の高さ(図面の断面スケッチから") && text.includes(`GL+${(PLAN.floorHeightGL + PLAN.LEVELS["2F"].z).toFixed(2)}m`), "階の高さの表(床高はLEVELSから)");
  assert.ok(text.includes("屋根(切妻・半透明)") && text.includes("頭上高さを帯で塗る") && html.includes('id="chkRoof"'), "屋根とロフト頭上高さの開示・屋根チェックボックス");
  assert.ok(text.includes("常に最寄りの規定サイズ"), "規定サイズ吸着の開示");
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

test("plan3d: 改案B(バルコニー無し・3F三部屋・風呂2F)の整合と法規の机上計算", () => {
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
  assert.equal(VARIANTS.A.floors, FLOORS); assert.equal(VARIANTS.B.floors, FLOORS_B); assert.equal(VARIANTS.B.north_ext, EXT_N);
  // データの形(A案と同じ検査)
  for (const [fid, f] of Object.entries(FLOORS_B)) {
    assert.ok(f.walls.length > 0 && f.rooms.length > 0, `${fid} 壁と部屋`);
    for (const w of f.walls) assert.ok(Math.abs(w.x1 - w.x2) < 1e-9 || Math.abs(w.y1 - w.y2) < 1e-9, `${fid} 壁は水平か垂直`);
    for (const it of f.items) { assert.ok(ITEM_CATALOG[it.type], `${fid} ${it.type} はカタログにある`); assert.ok(it.y > -1.2 && it.y < PLAN.L + 0.5 && it.x > -0.5 && it.x < PLAN.W + 0.5, `${fid} ${it.type} の位置`); }
    for (const o of f.openings) assert.ok(["door", "window"].includes(o.type) && o.w > 0.3, `${fid} 開口 ${o.type}`);
    for (const r of f.rooms) assert.ok(r.x1 > r.x0 && r.y1 > r.y0, `${fid} ${r.name} の矩形`);
  }
  // バルコニー無し・2F/3Fは北へ455
  for (const fid of ["2F", "3F"]) { assert.ok(!FLOORS_B[fid].rooms.some((r) => /バルコニー/.test(r.name)), `${fid} バルコニー無し`); near(FLOORS_B[fid].floorRect.y0, -EXT_N, 1e-9, `${fid} 北の張り出し`); assert.ok(FLOORS_B[fid].walls.some((w) => w.kind === "ext" && Math.abs(w.y1 + EXT_N) < 1e-9 && Math.abs(w.y2 + EXT_N) < 1e-9), `${fid} 北の外壁は y=-${EXT_N}`); }
  // 3Fは洋室が3つ+廊下、トイレ無し
  const r3 = FLOORS_B["3F"].rooms.map((r) => r.name);
  assert.equal(r3.filter((n) => /^洋室[NMS] /.test(n) && !/アルコーブ|カウンター/.test(n)).length, 3, `3Fに洋室3つ: ${r3}`);
  assert.ok(r3.some((n) => n === "廊下") && !r3.some((n) => /トイレ/.test(n)), "3Fは廊下あり・トイレ無し");
  assert.equal(FLOORS_B["3F"].openings.filter((o) => o.type === "door" && /^洋室/.test(o.label)).length, 3, "三室それぞれに廊下からのドア");
  for (const nm of ["洋室N 6", "洋室M 3", "洋室S 4"]) { const r = FLOORS_B["3F"].rooms.find((q) => q.name.startsWith(nm)); assert.ok(netArea(r, "3F", -EXT_N) / 1.62 >= 3.0, `${nm} は内法3帖以上`); }
  // 2Fに UB・脱衣所・トイレ、1Fには無い
  const r2 = FLOORS_B["2F"].rooms.map((r) => r.name), r1 = FLOORS_B["1F"].rooms.map((r) => r.name);
  assert.ok(r2.some((n) => /^UB/.test(n)) && r2.some((n) => /脱衣/.test(n)) && r2.some((n) => /トイレ/.test(n)), `2Fに風呂・脱衣所・トイレ: ${r2}`);
  assert.ok(!r1.some((n) => /^UB|洗面脱衣/.test(n)) && r1.some((n) => /トイレ/.test(n)), `1Fは風呂無し・トイレあり: ${r1}`);
  assert.ok(FLOORS_B["2F"].items.some((i) => i.type === "ub1316") && FLOORS_B["2F"].items.some((i) => i.type === "washer"), "2FにUBと洗濯機");
  // 水回りの位置が壁と整合(UB は 1,555×1,820 モジュール)
  const ub = FLOORS_B["2F"].rooms.find((r) => /^UB/.test(r.name)); near(ub.x1 - ub.x0, 1.555, 1e-9, "UB 幅"); near(ub.y1 - ub.y0, 1.82, 1e-9, "UB 奥行");
  // 法規の机上計算: 建ぺい率70%・容積率200%・道路斜線・高度地区・10m に収まる(A案との対照つき)
  assert.ok(CHECK_B.building_area <= CHECK_B.coverage_cap_m2, `建築面積 ${CHECK_B.building_area} ≤ ${CHECK_B.coverage_cap_m2}`);
  assert.ok(CHECK_B.volume <= CHECK_B.far_cap_m2, `容積 ${CHECK_B.volume} ≤ ${CHECK_B.far_cap_m2}`);
  assert.ok(CHECK_B.north_face_top <= CHECK_B.road_slope_allowed && CHECK_B.north_eave_top <= CHECK_B.road_slope_allowed, "道路斜線(北面)");
  assert.ok(CHECK_B.north_face_top <= CHECK_B.kodo2_allowed, "第2種高度地区(北面)");
  assert.ok(CHECK_B.ridge_top <= 10, "10m以下");
  assert.ok(CHECK_A.coverage > 0.6 && CHECK_A.coverage <= 0.7, "A案も建ぺい率60%超=準耐火の緩和前提(64.6%)");
  near(CHECK_B.building_area - CHECK_A.building_area, PLAN.W * EXT_N, 1e-9, "張り出し分の増加");
  // 採光: N(道路)は満額、S は1/10で可(1/7には届かない=開示どおり)、M は天窓で1/7
  const d = CHECK_B.daylight;
  assert.equal(d.N3.k, 3); assert.ok(d.N3.eff >= d.N3.floor / 7, "洋室N 採光 1/7");
  assert.ok(d.S3.eff >= d.S3.floor / 10 && d.S3.eff < d.S3.floor / 7, `洋室S は1/10で可・1/7未満 (${d.S3.eff.toFixed(2)} / ${(d.S3.floor / 7).toFixed(2)})`);
  assert.equal(d.M3.k, 0); assert.ok(d.M3.eff >= d.M3.floor / 7, "洋室M は天窓で1/7");
  assert.ok(d.N2.eff >= d.N2.floor / 7, "2F LDK 採光");
  // ページの開示
  const html = renderPlan3d({ asOf: "2026-10-14", property: loadProperty("kamiya2-adcast-a") });
  const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ");
  assert.ok(html.includes('data-variant="A"') && html.includes('data-variant="B"'), "案の切替ボタン");
  assert.ok(text.includes("改案B: バルコニー無し・3階三部屋・風呂2階") && text.includes("面積と法規の机上計算"), "改案Bの節と法規表");
  assert.ok(text.includes("確認申請の設計者") && text.includes("判定はしない"), "設計者の検証が要る・判定しない、の開示");
  const flat = text.replace(/\s+/g, "");
  for (const a of [...B_CHANGES, ...B_CAVEATS]) assert.ok(flat.includes(a.replace(/\*\*/g, "").replace(/\s+/g, "").slice(0, 16)), `改案Bの開示: ${a.slice(0, 16)}`);
  assert.ok(text.includes("照明設備つきの1/10") && text.includes("天窓"), "採光の条件(1/10・天窓)の開示");
  assert.ok(html.includes("VARIANTS") && html.includes('"north_ext":' + EXT_N), "VARIANTS がページに注入される");
});

test("plan3d: 改案C(車庫は一時停止・1Fも張り出し・風呂1F・3FはBと同一)の整合と法規の机上計算", () => {
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
  assert.equal(VARIANTS.C.floors, FLOORS_C); assert.equal(VARIANTS.C.north_ext, EXT_N);
  assert.equal(FLOORS_C["3F"], FLOORS_B["3F"]); assert.equal(FLOORS_C.LOFT, FLOORS_B.LOFT);
  for (const [fid, f] of Object.entries(FLOORS_C)) {
    for (const w of f.walls) assert.ok(Math.abs(w.x1 - w.x2) < 1e-9 || Math.abs(w.y1 - w.y2) < 1e-9, `${fid} 壁は水平か垂直`);
    for (const it of f.items) { assert.ok(ITEM_CATALOG[it.type], `${fid} ${it.type} はカタログにある`); assert.ok(it.y > -2.5 && it.y < PLAN.L + 0.5 && it.x > -0.5 && it.x < PLAN.W + 0.5, `${fid} ${it.type} の位置`); }
    for (const o of f.openings) assert.ok(["door", "window"].includes(o.type) && o.w > 0.3, `${fid} 開口 ${o.type}`);
    for (const r of f.rooms) assert.ok(r.x1 > r.x0 && r.y1 > r.y0, `${fid} ${r.name} の矩形`);
  }
  // 3層とも同じ外形(1Fも北へ455)
  for (const fid of ["1F", "2F", "3F"]) near(FLOORS_C[fid].floorRect.y0, -EXT_N, 1e-9, `${fid} 北の張り出し`);
  assert.ok(FLOORS_C["1F"].walls.some((w) => w.kind === "ext" && Math.abs(w.x1 - PLAN.W) < 1e-9 && Math.abs(w.y1 + EXT_N) < 1e-9), "1F 東の外壁は −455 から");
  // 車寄せは 2,225×2,275・道路側へのはみ出し
  near(GARAGE_C.d, 2.275, 1e-9, "車寄せの奥行"); near(GARAGE_C.apron, 1.15 - EXT_N, 1e-9, "道路境界まで");
  assert.ok(CHECK_C.car_overhang_compact > 0.9 && CHECK_C.car_overhang_compact < 1.1, `コンパクトカーのはみ出し ${CHECK_C.car_overhang_compact}`);
  assert.ok(CHECK_C.car_overhang_kei > 0.3 && CHECK_C.car_overhang_kei < 0.5, `軽のはみ出し ${CHECK_C.car_overhang_kei}`);
  // 1Fに洗面脱衣・UB・WIC、2Fにトイレだけ(風呂無し)・LDK一体
  const r1 = FLOORS_C["1F"].rooms.map((r) => r.name), r2 = FLOORS_C["2F"].rooms.map((r) => r.name);
  assert.ok(r1.some((n) => /^UB/.test(n)) && r1.some((n) => /洗面脱衣/.test(n)) && r1.some((n) => n === "WIC") && r1.some((n) => /トイレ/.test(n)), `1F 水回り: ${r1}`);
  assert.ok(!r2.some((n) => /^UB|脱衣/.test(n)) && r2.some((n) => /トイレ/.test(n)) && r2.some((n) => /^LDK/.test(n)), `2F: ${r2}`);
  assert.ok(FLOORS_C["1F"].items.some((i) => i.type === "ub1316") && FLOORS_C["1F"].items.some((i) => i.type === "washer") && !FLOORS_C["2F"].items.some((i) => i.type === "ub1316"), "UB・洗濯機は1F");
  const ub = FLOORS_C["1F"].rooms.find((r) => /^UB/.test(r.name)); near(ub.x1 - ub.x0, 1.555, 1e-9, "UB 幅"); near(ub.y1 - ub.y0, 1.82, 1e-9, "UB 奥行");
  const bath = FLOORS_C["1F"].rooms.find((r) => /洗面脱衣/.test(r.name)); near(bath.y1 - bath.y0, 1.82, 1e-9, "洗面脱衣 1,820");
  // 水回りは車寄せより南(y≥1.82)・車の中心は車寄せの中(はみ出しを描く)
  assert.ok(bath.y0 >= 1.82 - 1e-9, "洗面脱衣は車寄せの南壁から");
  // 法規: 建ぺい率・容積率(1Fの増分込み)・斜線・高度・10m
  assert.ok(CHECK_C.building_area <= CHECK_C.coverage_cap_m2 && CHECK_C.volume <= CHECK_C.far_cap_m2, `建ぺい ${CHECK_C.building_area}/${CHECK_C.coverage_cap_m2}・容積 ${CHECK_C.volume}/${CHECK_C.far_cap_m2}`);
  assert.ok(CHECK_C.volume > CHECK_B.volume, "C は1Fの増分で容積がBより大きい");
  assert.ok(CHECK_C.garage_m2 <= (CHECK_C.volume + CHECK_C.garage_m2) / 5, "車寄せは延床の1/5以内");
  assert.ok(CHECK_C.north_face_top <= CHECK_C.road_slope_allowed && CHECK_C.north_face_top <= CHECK_C.kodo2_allowed && CHECK_C.ridge_top <= 10, "斜線・高度・10m");
  near(CHECK_C.setback, CHECK_B.setback, 1e-9, "後退距離はBと同じ");
  // 採光は3F(B同一)・2F LDK とも1/7
  const d = CHECK_C.daylight;
  assert.ok(d.N3.eff >= d.N3.floor / 7 && d.M3.eff >= d.M3.floor / 7 && d.S3.eff >= d.S3.floor / 10 && d.N2.eff >= d.N2.floor / 7, "採光");
  // ページ
  const html = renderPlan3d({ asOf: "2026-10-17", property: loadProperty("kamiya2-adcast-a") });
  const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " "); const flat = text.replace(/\s+/g, "");
  assert.ok(html.includes('data-variant="C"') && html.includes('id="plan3d-c"'), "案Cの切替と節");
  assert.ok(flat.includes("改案C:Bの3F三部屋+車庫は一時停止") && flat.includes("車寄せ(一時停止)"), "改案Cの節と車寄せの行");
  for (const a of [...C_CHANGES, ...C_CAVEATS]) assert.ok(flat.includes(a.replace(/\*\*/g, "").replace(/\s+/g, "").slice(0, 16)), `改案Cの開示: ${a.slice(0, 16)}`);
  assert.ok(flat.includes("停車のみ") && flat.includes("駐車違反"), "一時停止=停車の範囲、の開示");
});

test("plan3d: 改案D(駐車場は残す・1F洋室→2Fリビング続き・1F南はFCL物干し)の整合と法規の机上計算", () => {
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
  assert.equal(VARIANTS.D.floors, FLOORS_D); assert.equal(FLOORS_D["3F"], FLOORS_B["3F"]); assert.equal(FLOORS_D.LOFT, FLOORS_B.LOFT);
  for (const [fid, f] of Object.entries(FLOORS_D)) {
    for (const w of f.walls) assert.ok(Math.abs(w.x1 - w.x2) < 1e-9 || Math.abs(w.y1 - w.y2) < 1e-9, `${fid} 壁は水平か垂直`);
    for (const it of f.items) { assert.ok(ITEM_CATALOG[it.type], `${fid} ${it.type} はカタログにある`); assert.ok(it.y > -2.5 && it.y < PLAN.L + 0.5 && it.x > -0.5 && it.x < PLAN.W + 0.5, `${fid} ${it.type} の位置`); }
    for (const o of f.openings) assert.ok(["door", "window"].includes(o.type) && o.w > 0.3, `${fid} 開口 ${o.type}`);
    for (const r of f.rooms) assert.ok(r.x1 > r.x0 && r.y1 > r.y0, `${fid} ${r.name} の矩形`);
  }
  // 車庫はA案の奥行+455・車が敷地内に収まる
  const g = FLOORS_D["1F"].rooms.find((r) => r.kind === "garage"); near(g.y1 - g.y0, 3.185 + EXT_N, 1e-9, "車庫の奥行"); near(g.x1 - g.x0, 2.225, 1e-9, "車庫の幅");
  assert.ok(CHECK_D.car_fit_margin > 0.3 && CHECK_D.car_fit_margin < 0.4, `車の余り ${CHECK_D.car_fit_margin}`);
  const car = FLOORS_D["1F"].items.find((i) => i.type === "car_compact"); assert.ok(car.y + 3.995 / 2 <= g.y1 && car.y - 3.995 / 2 >= -EXT_N - 0.7, "車は車庫+前面に収まる");
  // 1F: 水回りはA案のまま・洋室は無い(納戸=FCL)・2F: 洋室S(続き間)+LDK+トイレ
  const r1 = FLOORS_D["1F"].rooms.map((r) => r.name), r2 = FLOORS_D["2F"].rooms.map((r) => r.name);
  assert.ok(r1.some((n) => /^UB/.test(n)) && r1.some((n) => /洗面脱衣/.test(n)) && !r1.some((n) => /^洋室/.test(n)) && r1.some((n) => /ファミリークローゼット/.test(n)), `1F: ${r1}`);
  assert.ok(r2.some((n) => /^洋室S\(リビング続き\)/.test(n)) && r2.some((n) => /^LDK/.test(n)) && r2.some((n) => /トイレ/.test(n)), `2F: ${r2}`);
  const sRoom = FLOORS_D["2F"].rooms.find((r) => /^洋室S/.test(r.name)); near(sRoom.y1 - sRoom.y0, 2.275, 1e-9, "2F洋室Sは1F洋室と同じ2,275"); near(sRoom.x1 - sRoom.x0, PLAN.W, 1e-9, "全幅");
  const slide = FLOORS_D["2F"].openings.find((o) => o.type === "door" && /引戸/.test(o.label)); assert.ok(slide && slide.w >= 2.0 && Math.abs(slide.y - sRoom.y0) < 1e-9, "続き間の3枚引戸(開口2m以上)が洋室Sの北壁にある");
  assert.ok(FLOORS_D["2F"].items.some((i) => i.type === "kitchen2400" && i.rot === 90), "キッチンは階段の西壁沿い(縦向き)");
  // 法規: C案より容積に余裕・他は同じ
  assert.ok(CHECK_D.building_area <= CHECK_D.coverage_cap_m2 && CHECK_D.volume <= CHECK_D.far_cap_m2, "建ぺい・容積");
  assert.ok(CHECK_D.volume < CHECK_C.volume && CHECK_D.volume > CHECK_B.volume, "容積は B < D < C");
  assert.ok(CHECK_D.north_face_top <= CHECK_D.road_slope_allowed && CHECK_D.north_face_top <= CHECK_D.kodo2_allowed && CHECK_D.ridge_top <= 10, "斜線・高度・10m");
  // 採光: 2F は LDK+洋室S を1室とみなして北窓で 1/7
  const d = CHECK_D.daylight;
  assert.ok(d.N2.floor > 25 && d.N2.eff >= d.N2.floor / 7, `2F LDK+続き間 ${d.N2.eff} ≥ ${d.N2.floor / 7}`);
  assert.ok(d.N3.eff >= d.N3.floor / 7 && d.M3.eff >= d.M3.floor / 7 && d.S3.eff >= d.S3.floor / 10, "3Fの採光はB/Cと同じ");
  // ページ
  const html = renderPlan3d({ asOf: "2026-10-17", property: loadProperty("kamiya2-adcast-a") });
  const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " "); const flat = text.replace(/\s+/g, "");
  assert.ok(html.includes('data-variant="D"') && html.includes('id="plan3d-d"'), "案Dの切替と節");
  assert.equal(CHOSEN_VARIANT, "D"); assert.equal(PLAN.CHOSEN_VARIANT, "D");
  assert.ok(html.includes('class="btn on" data-variant="D"') && !html.includes('class="btn on" data-variant="A"'), "既定(採用案)のボタンは D");
  assert.ok(flat.includes("採用案:改案D(2026-10-17本人の選択)"), "採用案の表示");
  const prop = loadProperty("kamiya2-adcast-a"); const su = prop.status_updates.find((u) => new Date(u.date).toISOString().slice(0, 10) === "2026-10-17");
  assert.ok(su && su.facts.some((f) => /改案D/.test(f)) && su.implications.some((f) => /参考プラン.*のまま/.test(f)), "物件YAMLの status_updates に採用案Dの記録(査定は参考プランのまま)");
  assert.ok(flat.includes("1室とみなす") && flat.includes("随時開放できる"), "続き間の採光の扱いの開示");
  for (const a of [...D_CHANGES, ...D_CAVEATS]) assert.ok(flat.includes(a.replace(/\*\*/g, "").replace(/\s+/g, "").slice(0, 16)), `改案Dの開示: ${a.slice(0, 16)}`);
});
