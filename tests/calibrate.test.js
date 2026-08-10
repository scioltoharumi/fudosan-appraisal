// tests/calibrate.test.js — 成約較正の不変条件と回帰値
// 回帰値は market/deals.csv・benchmarks.yaml のデータに対して固定(データ追加時は意図的に更新する)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { calibrate, loadDeals, normalizeDeal, SHAPE_NORM_ADJ } from "../engine/calibrate.js";

test("正規化の不変条件: 正の値・過去の取引は上方修正・悪条件は上方修正", () => {
  for (const d of loadDeals()) {
    const n = normalizeDeal(d);
    assert.ok(n.ppt_norm > 0 && Number.isFinite(n.ppt_norm), `${d.date} ${d.district}: 正規化値が不正`);
    // 2025-01より前の取引は timeFactor < 1 → 正規化で上方修正される
    if (String(d.date) < "2025-01") assert.ok(n.timeFactor < 1, `${d.date}: 過去取引のtimeFactor`);
    // 形状補正は0以下(良条件方向への補正はしない)
    assert.ok((SHAPE_NORM_ADJ[d.shape] ?? 0) <= 0);
  }
});

test("回帰値: エリア別の成約ベース坪単価(現データ固定)", () => {
  const cal = calibrate();
  // 2026-08監査: 地区帰属が出典と不一致だった赤羽台1行を除外し13→12件
  assert.equal(cal.dealCount, 12);
  const c = (a) => cal.byArea[a].chosen;
  assert.equal(c("shimo").ppt, 204);            // 個別3件の正規化中央値(年次別時点修正)
  assert.equal(c("akabanedai").ppt, 196);       // 個別4件の正規化中央値
  assert.equal(c("akabanedai").confidence, "低");
  assert.equal(c("akabane-nishi").ppt, 205);    // 個別2件のみ→地区ベンチマーク(31件)×混合平均補正+10%
  assert.match(c("akabane-nishi").basis, /ベンチマーク.*混合平均補正/);
  assert.equal(c("nakajujo").ppt, 220);         // 個別1件のみ→地区ベンチマーク(27件)×補正
  assert.match(c("jujo-nakahara").confidence, /極小標本/);  // 個別2件・直近ベンチマークなし
  // 全エリアの成約ベース単価は現実的なレンジ内
  for (const [area, a] of Object.entries(cal.byArea)) {
    if (a.chosen) assert.ok(a.chosen.ppt >= 100 && a.chosen.ppt <= 400, `${area}: ${a.chosen.ppt}`);
  }
});
