// tests/agecurve.test.js — 築年カーブ実測(formula補論)の回帰値と不変条件
// 2026-08-11 検証会話の定式化: 「新築プレミアムの山は無く、唯一の段差は築31年以降」
// を回帰値としてロックする。house-deals.csv追加時に比率が動いたら、崖の位置と
// フラット圏の幅が保たれているかを確認した上で回帰値を更新すること。
import { test } from "node:test";
import assert from "node:assert/strict";
import { ageCurveStats } from "../site/templates/formula.js";
import { loadHouseDeals } from "../engine/retail.js";

const ac = ageCurveStats(loadHouseDeals());
const byLo = new Map(ac.buckets.map((b) => [b.lo, b]));

test("築年カーブ: 回帰値(成約/モデル比の築年帯別中央値・2026-08-11時点の台帳)", () => {
  // [帯の下端, 期待比率, 期待件数]。線形減価モデル(95万/坪・30年・修繕30万/年)基準
  const expected = [
    [0, 0.950, 163], [3, 0.912, 15], [7, 1.056, 17], [11, 1.000, 21],
    [16, 0.957, 16], [21, 1.000, 13], [26, 0.960, 6], [31, 0.719, 22], [41, 0.545, 47],
  ];
  for (const [lo, ratio, n] of expected) {
    const b = byLo.get(lo);
    assert.ok(b, `帯 築${lo}〜 が存在する`);
    assert.equal(b.n, n, `帯 築${lo}〜 の件数`);
    assert.ok(Math.abs(b.ratio - ratio) < 0.005, `帯 築${lo}〜 の比率: ${b.ratio.toFixed(3)} (期待 ${ratio})`);
  }
});

test("築年カーブ: 不変条件 ── 築31年未満はフラット圏、崖は築31年以降にのみ現れる", () => {
  for (const b of ac.buckets.filter((x) => x.n > 0 && x.lo < 31)) {
    assert.ok(b.ratio >= 0.85 && b.ratio <= 1.10,
      `築${b.lo}〜${b.hi}が新築プレミアム/ディスカウント圏外: ${b.ratio.toFixed(3)}`);
  }
  const cliff = byLo.get(31), old = byLo.get(41);
  assert.ok(cliff.ratio < 0.85, `築31〜41に崖がある: ${cliff.ratio.toFixed(3)}`);
  assert.ok(old.ratio < cliff.ratio, `築41〜は崖のさらに下: ${old.ratio.toFixed(3)}`);
});

test("築年カーブ: 算術的希釈の前提 ── 新築価格の過半は土地", () => {
  assert.ok(ac.nNew >= 100, `新築標本が十分: ${ac.nNew}`);
  assert.ok(ac.landShareNew > 0.5 && ac.landShareNew < 0.85,
    `新築の土地シェア: ${(ac.landShareNew * 100).toFixed(1)}%`);
  assert.ok(ac.newMedPrice > 4000 && ac.newMedPrice < 12000, `新築中央値: ${ac.newMedPrice}万`);
});
