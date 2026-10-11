// 外水氾濫の深さ別確率(フェルミ推定)の不変条件。2026-10-11 神谷2-24-11 のために新設。
// 入力の正本は market/flood-fermi-kamiya2-2026-10-11.json(浸水ナビの破堤点別到達深)。
// 「深さが増えるほど確率は単調に下がる」「5mは公式シミュレーションの全件で0」「幅(低〜高)が中を挟む」を固定し、
// 結論に書いた数値(1m以上 30年2.8% / 3m以上 0.9%)はこの数値を変えたらYAMLの結論文とCLAUDE.mdも直す、という回帰値として持つ。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../engine/io.js";
import { exceedance, groupStats, reachFraction, oneInN, DEFAULT_BANDS, THRESHOLDS_M } from "../engine/flood.js";
import { summarize } from "../crawler/suibou-nav.mjs";

const snap = JSON.parse(readFileSync(join(ROOT, "market", "flood-fermi-kamiya2-2026-10-11.json"), "utf8"));

test("flood: スナップショットの破堤点統計(神谷2-24-11)。L1でも3m超が届き、5mは全件で出ない", () => {
  const l1 = groupStats(snap.suibou_nav.groups.l1), l2 = groupStats(snap.suibou_nav.groups.l2);
  assert.equal(l1.total, 182); assert.equal(l1.reaching, 51); assert.equal(l1.max, 3.56); assert.equal(l1.ge[3], 9);
  assert.equal(l2.total, 211); assert.equal(l2.reaching, 63); assert.equal(l2.max, 4.4); assert.equal(l2.ge[4], 10);
  assert.equal(l1.ge[5] + l2.ge[5], 0, "5m以上の破堤点は公式シミュレーションに無い");
  assert.equal(snap.suibou_nav.depth_max_m, 4.4);
  // 届く割合は分母に「届かない破堤点」を含む(包絡と確率の違いの核心)
  assert.ok(Math.abs(reachFraction(snap.suibou_nav.groups.l2, 3) - 49 / 211) < 1e-12);
  assert.equal(reachFraction(snap.suibou_nav.groups.l1, 1, 0.5), 38 / 182, "depthScale は深さに掛けてから閾値と比べる");
});

test("flood: 深さ別の年超過確率は単調減少・幅は中を挟む・5mは0・結論の回帰値", () => {
  const rows = exceedance(snap);
  assert.deepEqual(rows.map((r) => r.depth_m), THRESHOLDS_M);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].annual.mid <= rows[i - 1].annual.mid, `深さ${rows[i].depth_m}mで確率が増えている`);
  }
  for (const r of rows) {
    assert.ok(r.annual.low <= r.annual.mid && r.annual.mid <= r.annual.high, `幅が中を挟んでいない: ${r.depth_m}m`);
    assert.ok(r.climateCum.mid >= r.cum.mid, "気候変動×2で累積が下がることはない");
  }
  const at = (d) => rows.find((r) => r.depth_m === d);
  assert.equal(at(5).annual.high, 0, "5mは全帯で0");
  // 回帰値(2026-10-11・既定の帯と破堤確率)。変えるなら YAML の conclusion と CLAUDE.md の結果行も同時に直す
  assert.equal(Math.round(at(1).cum.mid * 1000) / 10, 2.8);
  assert.equal(Math.round(at(3).cum.mid * 1000) / 10, 0.9);
  assert.equal(Math.round(at(4).cum.mid * 1000) / 10, 0.1);
  assert.equal(Math.round(at(1).climateCum.mid * 1000) / 10, 5.4);
  assert.equal(oneInN(at(3).annual.mid), 3500);
  assert.equal(oneInN(0), null);
  // 帯の既定値の形(年確率・破堤確率は[低,中,高]で単調)
  for (const b of DEFAULT_BANDS) {
    assert.ok(b.annual[0] <= b.annual[1] && b.annual[1] <= b.annual[2]);
    assert.ok(b.breach[0] <= b.breach[1] && b.breach[1] <= b.breach[2]);
    assert.ok(snap.suibou_nav.groups[b.depthFrom], `帯 ${b.key} の depthFrom がスナップショットに無い`);
  }
});

test("suibou-nav.summarize: 地点の深さと破堤点一覧を突き合わせ、届かない破堤点も分母に数える", () => {
  const depthList = [{ BreakPointID: "a", Depth: 3.2 }, { BreakPointID: "c", Depth: 0.4 }, { BreakPointID: "zz", Depth: 1 }];
  const lists = { l2: { name: "荒川・想定最大", bp: [{ BPList: [
    { ID: "a", BPLocation: " 荒川右岸 21.00k", BPLat: 35.78, BPLon: 139.74 },
    { ID: "b", BPLocation: "荒川左岸 1.0k", BPLat: 35.66, BPLon: 139.85 },
    { ID: "c", BPLocation: "荒川右岸 13.0k", BPLat: 35.72, BPLon: 139.80 } ] }] } };
  const s = summarize(depthList, lists, { lat: 35.771, lon: 139.728 });
  assert.equal(s.groups.l2.breakpoints_total, 3);
  assert.equal(s.groups.l2.reaching_site, 2);
  assert.deepEqual(s.groups.l2.rows.map((r) => r.id), ["a", "c"], "深い順");
  assert.equal(s.groups.l2.rows[0].location, "荒川右岸 21.00k");
  assert.equal(s.unclassified, 1, "一覧に無いIDは未分類として数を残す");
  assert.equal(s.depth_max_m, 3.2);
});
