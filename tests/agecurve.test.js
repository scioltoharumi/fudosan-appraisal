// tests/agecurve.test.js — 築年カーブ実測(formula補論)の回帰値と不変条件
// 2026-08-11 検証会話の定式化: 「新築プレミアムの山は無く、唯一の段差は築31年以降」
// を回帰値としてロックする。house-deals.csv追加時に比率が動いたら、崖の位置と
// フラット圏の幅が保たれているかを確認した上で回帰値を更新すること。
//
// 2026-08-13 更新: 探索エリア拡張で6地区286件を追加(479→765件)したため回帰値を引き直した。
// 引き直しの前に確認したこと ── ①崖は残る(差0.364→0.341・95%区間0.269〜0.377で0を跨がない。
// 標本増で区間はむしろ狭まった) ②新築の山は無いまま(築0〜3年 0.950→0.917・上限0.941<1.00)。
// **変わった点**: 築3〜7年帯の95%区間が1.00を含まなくなった(0.812〜0.950)。ただしこれは
// 6地区を足した同じタイミングで起きており、新地区(滝野川・西ケ原・上中里など)は近隣商業・準工業の
// 混入が既存12地区より多い。市場の事実か母集団の構成変化かは切り分けできていないので、
// 「判別不能でなくなった」以上のことは主張しない(下の test も帯を名指しで固定する形に変えた)。
// なお築年カーブの基準単価は地区ごとの築11〜26年成約から立てており(ageRatioBuckets)、
// area-config.yaml の坪単価には依存しない。新エリアの坪単価が未較正であることは影響しない。
import { test } from "node:test";
import assert from "node:assert/strict";
import { ageCurveStats, ageCurveCI } from "../site/templates/formula.js";
import { loadHouseDeals } from "../engine/retail.js";

const ac = ageCurveStats(loadHouseDeals());
const byLo = new Map(ac.buckets.map((b) => [b.lo, b]));

test("築年カーブ: 回帰値(成約/モデル比の築年帯別中央値・2026-08-13時点の台帳)", () => {
  // [帯の下端, 期待比率, 期待件数]。線形減価モデル(95万/坪・30年・修繕30万/年)基準
  // 2026-08-13(2): 徒歩補正を線形(-1.2%/分)から帯別テーブルへ置換したため、比較対象の
  // 「ものさし価格」が変わり比率が動いた(件数は不変=標本は同じ)。結論は変わっていない ──
  // 崖の位置(築31年)も、新築に山が無いことも、築7〜30年が判別不能なことも保たれている
  const expected = [
    [0, 0.916, 249], [3, 0.878, 28], [7, 0.988, 32], [11, 1.000, 37],
    [16, 1.000, 36], [21, 1.000, 23], [26, 1.059, 12], [31, 0.739, 40], [41, 0.566, 94],
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

// ブートストラップ信頼区間(formula補論の「どこまで信じてよいか」表)。
// 主張は2点のみ ── ①崖は有意 ②新築プレミアムの山は無い。それ以外の帯は1.00を含む(=判別不能)。
// 乱数は固定シードのため、同じ台帳なら何度計算しても同じ値が出る(ページの再現性を担保)。
test("築年カーブCI: 崖は有意(差の95%区間が0を跨がない)・新築に上乗せの山は無い", () => {
  const ci = ageCurveCI(loadHouseDeals());
  assert.equal(ci.total, 551, `有効標本数: ${ci.total}`);
  assert.ok(ci.cliffLo > 0, `崖の差の下限が0超: ${ci.cliffLo.toFixed(3)}`);
  // 2026-08-13(2): 徒歩補正の帯別化で 0.341→0.323。**崖の主張は無傷**(区間0.272〜0.381で0を跨がず、
  // 幅も0.108とむしろ狭い)。徒歩の効き方を変えると崖の大きさも動く、という感応性そのものは記録に値する
  assert.ok(Math.abs(ci.cliffDiff - 0.323) < 0.01, `崖の差: ${ci.cliffDiff.toFixed(3)}`);
  // 標本が320→551に増えて区間は狭まった(0.258〜0.426 → 0.272〜0.381)。崖の主張は強くなっている
  assert.ok(ci.cliffHi - ci.cliffLo < 0.17, `崖の差の区間幅: ${(ci.cliffHi - ci.cliffLo).toFixed(3)}`);
  const newB = ci.rows.find((b) => b.lo === 0);
  assert.ok(newB.hi95 < 1, `築0〜3年の上限は1.00未満(=プレミアムの山なし): ${newB.hi95.toFixed(3)}`);
});

// 2026-08-13: 「築3〜30年はどの帯も1.00を含む」は築3〜7年帯だけ成り立たなくなった(0.812〜0.950)。
// 主張を弱めるのではなく、**どの帯が判別可能でどの帯が判別不能か**を名指しで固定する形に変える。
// これなら次にデータが増えたとき、どこが動いたのかがテストの差分で分かる。
test("築年カーブCI: 築7〜30年は依然どの帯も1.00を含む(細かい起伏は判別できない)", () => {
  const ci = ageCurveCI(loadHouseDeals());
  for (const b of ci.rows.filter((x) => x.lo >= 7 && x.lo < 31)) {
    assert.ok(b.lo95 <= 1 && b.hi95 >= 1,
      `${b.label}の95%区間が1.00を含む: ${b.lo95.toFixed(3)}〜${b.hi95.toFixed(3)}`);
  }
  // 築26〜31年は件数が増えても(6→12件)区間が広すぎて実質情報がない、という状態は変わっていない
  const thin = ci.rows.find((x) => x.lo === 26);
  assert.ok(thin.hi95 - thin.lo95 > 0.4, `築26〜31年は依然として区間が広い: ${thin.lo95.toFixed(3)}〜${thin.hi95.toFixed(3)}`);
});

test("築年カーブCI: 築3〜7年は1.00を下回るが、母集団の構成変化と切り分けられていない", () => {
  const ci = ageCurveCI(loadHouseDeals());
  const b = ci.rows.find((x) => x.lo === 3);
  assert.ok(b.hi95 < 1, `築3〜7年の上限が1.00未満: ${b.lo95.toFixed(3)}〜${b.hi95.toFixed(3)}`);
  // n=28。この帯だけで市場の事実を主張できる厚みではない(サイトの補論でもそう書く)
  assert.ok(b.n < 40, `築3〜7年は依然として薄い標本: n=${b.n}`);
});

test("築年カーブCI: 決定論 ── 同じ入力なら同じ区間が出る", () => {
  const deals = loadHouseDeals();
  const a = ageCurveCI(deals), b = ageCurveCI(deals);
  assert.deepEqual(a.rows.map((x) => [x.lo95, x.hi95]), b.rows.map((x) => [x.lo95, x.hi95]));
  assert.equal(a.cliffLo, b.cliffLo);
});
