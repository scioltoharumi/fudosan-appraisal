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
  // 2026-08-13: 探索エリア拡張で6地区の土地成約(住宅地・2022+)109件を追加し12→121件
  assert.equal(cal.dealCount, 121);
  const c = (a) => cal.byArea[a].chosen;
  assert.equal(c("shimo").ppt, 204);            // 個別3件の正規化中央値(年次別時点修正)
  assert.equal(c("akabanedai").ppt, 196);       // 個別4件の正規化中央値
  assert.equal(c("akabanedai").confidence, "低");
  assert.equal(c("akabane-nishi").ppt, 205);    // 個別2件のみ→地区ベンチマーク(31件)×混合平均補正+10%
  assert.match(c("akabane-nishi").basis, /ベンチマーク.*混合平均補正/);
  assert.equal(c("nakajujo").ppt, 220);         // 個別1件のみ→地区ベンチマーク(27件)×補正
  assert.match(c("jujo-nakahara").confidence, /極小標本/);  // 個別2件・直近ベンチマークなし

  // 2026-08-13 追加の6エリア。**既存5エリアの値が動いていないこと**が拡張の前提条件
  // (上の shimo/akabanedai/akabane-nishi/nakajujo/jujo-nakahara はすべて拡張前と同値)
  assert.equal(c("takinogawa").ppt, 210);       // 個別42件 → level mid
  assert.equal(c("takinogawa").level, "mid");
  assert.equal(c("nishigahara").ppt, 249);      // 個別30件
  assert.equal(c("kaminakazato").ppt, 207);     // 個別22件。台地の1丁目と低地の2/3丁目が混ざった値
  assert.equal(c("nakazato").ppt, 344);         // 個別9件。駒込駅至近が押し上げている可能性
  assert.equal(c("kishimachi").ppt, 179);       // 個別4件 → level low
  // 王子本町は個別2件・ベンチマークもn=2でrecent:false。**査定に採用させない**のが要点。
  // ここが level:"reference" でなくなると、2件の偶然が坪単価を動かしてしまう(appraise.js:309)
  assert.equal(c("oji-honcho").level, "reference");
  assert.match(c("oji-honcho").confidence, /極小標本/);
  // 全エリアの成約ベース単価は現実的なレンジ内
  for (const [area, a] of Object.entries(cal.byArea)) {
    if (a.chosen) assert.ok(a.chosen.ppt >= 100 && a.chosen.ppt <= 400, `${area}: ${a.chosen.ppt}`);
  }
});
