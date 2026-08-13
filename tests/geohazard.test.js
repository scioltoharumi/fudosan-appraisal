// tests/geohazard.test.js — 公式ハザードマップ照合(crawler/geohazard.mjs)の純関数部分。
// ネットワークは叩かない(タイル取得はfetch注入で差し替え可能な設計にしてある)。
// 2026-08-13の発見: 掲載の法令等制限欄には洪水浸水想定が載らないため、志茂1・志茂3が
// 「suumo: none / athome: none」のまま台帳に残っていた。その再発防止のスクリーニングを固定する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tileXY, depthLabel, screenOfficial, DEPTH_LEGEND } from "../crawler/geohazard.mjs";
import { loadProperty, listPropertyIds } from "../engine/io.js";

test("タイル座標: 既知の緯度経度がズームレベル17の正しいタイル/ピクセルに落ちる", () => {
  // 志茂3丁目の代表点(35.77824, 139.73520)。Webメルカトルの定義どおりであることの確認
  const t = tileXY(35.77824, 139.73520, 17);
  assert.equal(t.x, Math.floor(((139.73520 + 180) / 360) * 2 ** 17));
  assert.ok(t.px >= 0 && t.px < 256 && t.py >= 0 && t.py < 256);
  // 経度が増えればタイルXは単調増加、緯度が増えれば(北へ行けば)タイルYは単調減少
  assert.ok(tileXY(35.778, 139.74, 17).x >= t.x);
  assert.ok(tileXY(35.79, 139.73520, 17).y <= t.y);
});

test("浸水深の凡例: 標準色を正しい区分に、未知色は丸めずRGBを残す", () => {
  for (const e of DEPTH_LEGEND) {
    assert.equal(depthLabel([...e.rgb, 255]).label, e.label);
  }
  // 透明 = 区域外
  assert.equal(depthLabel([255, 183, 183, 0]), null);
  assert.equal(depthLabel(null), null);
  // 凡例から遠い色は「不明」として生値を開示する(勝手に最寄り区分へ丸めない)
  const unknown = depthLabel([12, 200, 40, 255]);
  assert.ok(unknown.label.startsWith("不明(RGB"), unknown.label);
  // わずかな圧縮ノイズ程度なら最寄り区分に寄せる
  assert.equal(depthLabel([253, 181, 185, 255]).label, "3.0〜5.0m");
});

test("スクリーニング: 荒川低地(志茂の実測値)はblock、台地上の浅い着色はblockにしない", () => {
  // 実測: 志茂3丁目 標高1.8m・浸水深5〜10m・周辺25点すべて該当
  const shimo = screenOfficial({ elevation_m: 1.8, floodCoverage: 1, sampled: 25,
    layers: { flood_l2: "5.0〜10.0m", flood_keizoku: "該当", hightide: "0.5〜3.0m" } });
  assert.equal(shimo.verdict, "block");
  assert.ok(shimo.codes.includes("KO4_FLOOD_DEEP"));
  // 実測: 赤羽西4 標高21.3m・0.5m未満。台地上の局所的な着色までKOにすると台帳が壊れる
  const daichi = screenOfficial({ elevation_m: 21.3, floodCoverage: 4 / 25, sampled: 25,
    layers: { flood_l2: "0.5m未満" } });
  assert.equal(daichi.verdict, "caution");
  // 低地(標高5m未満)なら浅い着色でも掲載条件「台地側」から外れる
  const lowland = screenOfficial({ elevation_m: 3.0, floodCoverage: 1, sampled: 25,
    layers: { flood_l2: "0.5〜3.0m" } });
  assert.equal(lowland.verdict, "block");
  assert.ok(lowland.codes.includes("KO4_LOWLAND"));
});

test("スクリーニング: レッドゾーンはblock、イエローはcaution、該当なしはpass", () => {
  assert.equal(screenOfficial({ elevation_m: 20, layers: { kyukeisha_red: "該当" } }).verdict, "block");
  assert.equal(screenOfficial({ elevation_m: 20, layers: { kyukeisha: "該当" } }).verdict, "caution");
  assert.equal(screenOfficial({ elevation_m: 20, layers: {} }).verdict, "pass");
  assert.equal(screenOfficial({ error: "住所検索でヒットなし" }).verdict, "unknown");
});

test("台帳: 全物件に公式マップ照合の記録があり、blockが残っていない場合はそれを検知できる", () => {
  const blocked = [];
  for (const id of listPropertyIds()) {
    const o = loadProperty(id).hazard_check?.official;
    assert.ok(o, id + ": hazard_check.official が無い(公式マップ照合の未実施)");
    assert.ok(["block", "caution", "pass", "unknown"].includes(o.verdict), id + ": verdict=" + o.verdict);
    assert.ok(typeof o.elevation_m === "number", id + ": 標高が記録されていない");
    if (o.verdict === "block") blocked.push(`${id}(${o.reason})`);
  }
  // 掲載条件「台地側(荒川低地の浸水想定域外)」に反する物件が台帳に残っていないこと。
  // 志茂1・志茂3は2026-08-13に除外済み(market/crawl/excluded.json)。許容リストは空のまま維持し、
  // blockの物件が台帳へ入った瞬間にこのテストが落ちるようにしておく
  assert.deepEqual(blocked, [], "公式マップで掲載条件外(block)の物件が台帳に入っている: " + blocked.join(" / "));
});
