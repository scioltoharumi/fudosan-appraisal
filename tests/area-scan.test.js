// tests/area-scan.test.js — 探索エリア候補のスクリーニング(crawler/area-scan.mjs)の純関数部分。
// ネットワークは叩かない(実測値をフィクスチャとして固定する)。
// 目的: 「どこまで探索範囲を広げるか」の判定が、後から静かに緩まないようにする。
// とくに exclude(荒川低地)と partial(丁目内に台地と低地が混在)の境目は、
// 2026-08-13の志茂1・志茂3の登録ミス(掲載欄だけを見て台地側だと思い込んだ)の再発点にあたる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { walkMin, inTriangle, distM, classify, candidates, STATIONS, TRIANGLE } from "../crawler/area-scan.mjs";

const AKABANE = STATIONS.find((s) => s.name === "赤羽");
const OJI = STATIONS.find((s) => s.name === "王子");

test("徒歩分: 公正競争規約どおり道路80m/分の切り上げ。台帳の掲載分数を±2分で再現する", () => {
  // 1分=道路80m(端数切上げ)。迂回率1.25なので直線64mごとに1分
  const near = { lat: AKABANE.lat + 0.0002, lon: AKABANE.lon };
  assert.equal(walkMin(near, AKABANE), 1);
  assert.ok(walkMin({ lat: AKABANE.lat, lon: AKABANE.lon }, AKABANE) <= 1);
  // 単調性: 遠いほど分数は増える(減ることはない)
  let prev = 0;
  for (let d = 0; d <= 20; d++) {
    const p = { lat: AKABANE.lat + d * 0.0009, lon: AKABANE.lon };
    const m = walkMin(p, AKABANE);
    assert.ok(m >= prev, `距離が伸びて分数が減った (${d})`);
    prev = m;
  }
  // 実測との照合: 赤羽台3丁目の代表点 → 赤羽駅。台帳の掲載は徒歩11分(akabanedai3-20268457)。
  // 代表点は丁目の中心で物件そのものではないので、±2分に収まればモデルとして使える
  const akabanedai3 = { lat: 35.78173, lon: 139.71425 };
  assert.ok(Math.abs(walkMin(akabanedai3, AKABANE) - 11) <= 2, `赤羽台3→赤羽駅 ${walkMin(akabanedai3, AKABANE)}分`);
  // 距離そのもの: 赤羽台3代表点から赤羽駅は700m前後
  assert.ok(distM(akabanedai3, AKABANE) > 600 && distM(akabanedai3, AKABANE) < 800);
});

test("三角形(赤羽・王子・板橋)の内外判定: 頂点は内、荒川低地の志茂は外", () => {
  for (const v of TRIANGLE) assert.ok(inTriangle(v), `${v.name}が外になった`);
  // 重心は内側
  const g = {
    lat: TRIANGLE.reduce((a, v) => a + v.lat, 0) / 3,
    lon: TRIANGLE.reduce((a, v) => a + v.lon, 0) / 3,
  };
  assert.ok(inTriangle(g));
  // 王子本町1丁目(実測代表点)は内、志茂1丁目・赤羽台3丁目は外
  assert.ok(inTriangle({ lat: 35.75376, lon: 139.73386 }) || inTriangle({ lat: 35.7537, lon: 139.7338 }));
  assert.ok(!inTriangle({ lat: 35.78, lon: 139.7420 }), "志茂1が内になった");
  assert.ok(!inTriangle({ lat: 35.78173, lon: 139.71425 }), "赤羽台3(赤羽駅より北)が内になった");
});

test("エリア判定: 荒川低地はexclude、縁に掛かる丁目はedge、台地上の0.5m未満はclearのまま", () => {
  // 実測(2026-08-13): 志茂1丁目 標高2.5m・浸水5〜10mが近傍25点すべて
  const shimo1 = classify({
    elev_center_m: 2.5, elev_min_m: 2.1, elev_max_m: 4.1,
    flood_center: "5.0〜10.0m", flood_worst: "5.0〜10.0m", flood_worst_max_m: 10,
    flood_coverage: 1, flood_deep_pts: 25, flood_hist: { "5.0〜10.0m": 25 },
    dosha_center: null, dosha_red_pts: 0, dosha_yellow_pts: 0, sampled: 25,
  });
  assert.equal(shimo1.verdict, "exclude");

  // **これを落としてはいけない**: 台地上でも0.5m未満の着色は普通に出る(赤羽西4=標高21.3mの実測)。
  // ここをハザード扱いにすると台帳の既存物件がまとめて条件外になる
  const akabanenishi4 = classify({
    elev_center_m: 21.3, elev_min_m: 19.5, elev_max_m: 23,
    flood_center: "0.5m未満", flood_worst: "0.5m未満", flood_worst_max_m: 0.5,
    flood_coverage: 6 / 25, flood_deep_pts: 0, flood_hist: { "0.5m未満": 6 },
    dosha_center: null, dosha_red_pts: 0, dosha_yellow_pts: 0, sampled: 25,
  });
  assert.equal(akabanenishi4.verdict, "clear");
  assert.ok(akabanenishi4.notes.some((n) => n.includes("除外理由にしない")));

  // 実測: 王子本町1丁目 標高16.9m(近傍5.1〜24.8m)・0.5〜3.0mが25点中9点・イエロー1点。
  // 石神井川の谷と台地が同じ丁目に同居する = 番地次第。丁目まるごとの合否にしてはいけない
  const ojihoncho1 = classify({
    elev_center_m: 16.9, elev_min_m: 5.1, elev_max_m: 24.8,
    flood_center: null, flood_worst: "0.5〜3.0m", flood_worst_max_m: 3,
    flood_coverage: 9 / 25, flood_deep_pts: 0, flood_hist: { "0.5〜3.0m": 9 },
    dosha_center: null, dosha_red_pts: 0, dosha_yellow_pts: 1, sampled: 25,
  });
  assert.equal(ojihoncho1.verdict, "caution");
  assert.ok(ojihoncho1.notes.some((n) => n.includes("崖線")), "高低差19.7mの崖線注記が出ていない");

  // 代表点は台地上でも、丁目の縁に3m超の浸水想定が食い込んでいれば edge(番地次第)
  const edge = classify({
    elev_center_m: 20, elev_min_m: 4.2, elev_max_m: 23,
    flood_center: null, flood_worst: "3.0〜5.0m", flood_worst_max_m: 5,
    flood_coverage: 5 / 25, flood_deep_pts: 4, flood_hist: { "3.0〜5.0m": 4, "0.5m未満": 1 },
    dosha_center: null, dosha_red_pts: 0, dosha_yellow_pts: 0, sampled: 25,
  });
  assert.equal(edge.verdict, "edge");

  // 完全にハザードなし
  const clear = classify({
    elev_center_m: 21, elev_min_m: 19, elev_max_m: 23,
    flood_center: null, flood_worst: null, flood_worst_max_m: null,
    flood_coverage: 0, flood_deep_pts: 0, flood_hist: {},
    dosha_center: null, dosha_red_pts: 0, dosha_yellow_pts: 0, sampled: 25,
  });
  assert.equal(clear.verdict, "clear");
  assert.equal(clear.notes.length, 0);

  // イエローのみ = caution / レッドが1点でもあれば edge(番地次第で掲載条件外になりうる)
  const base = {
    elev_center_m: 20, elev_min_m: 18, elev_max_m: 22,
    flood_center: null, flood_worst: null, flood_worst_max_m: null,
    flood_coverage: 0, flood_deep_pts: 0, flood_hist: {}, dosha_center: null, sampled: 25,
  };
  assert.equal(classify({ ...base, dosha_red_pts: 0, dosha_yellow_pts: 3 }).verdict, "caution");
  assert.equal(classify({ ...base, dosha_red_pts: 1, dosha_yellow_pts: 3 }).verdict, "edge");
});

test("候補リスト: 北区の全町丁目を漏れなく列挙し、住所文字列が住所検索APIの形になっている", () => {
  const c = candidates();
  const kita = c.filter((x) => x.ward === "北区");
  // 丁目のない町(岩淵町・栄町)は丁目なしの住所になる
  assert.ok(kita.some((x) => x.address === "東京都北区岩淵町" && x.chome === null));
  assert.ok(kita.some((x) => x.address === "東京都北区赤羽西6丁目"));
  // 台帳が既に扱っている地区は必ず候補に含まれる(スキャンの母集団から落ちない)
  for (const d of ["赤羽西", "西が丘", "赤羽台", "中十条", "十条仲原", "上十条", "志茂"]) {
    assert.ok(kita.some((x) => x.town === d), `${d}が候補から漏れている`);
  }
  // 今回広げる先(王子・板橋方面)も母集団に入っている
  for (const d of ["王子本町", "岸町", "十条台", "滝野川", "東十条", "王子", "西ケ原"]) {
    assert.ok(kita.some((x) => x.town === d), `${d}が候補から漏れている`);
  }
  assert.ok(c.every((x) => x.address.startsWith("東京都")));
});
