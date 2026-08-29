// tests/decision.test.js — 意思決定の地図(decision.html)の回帰ガード
// このページは検討経緯の「記録」なので、検査するのは
// 「判定を出さないこと」「一周の構成要素が欠けないこと」「◯△✕が記録である旨の開示」の3点。
import test from "node:test";
import assert from "node:assert/strict";
import { renderDecision } from "../site/templates/decision.js";

const html = renderDecision({ asOf: "2026-08-29" });

test("decision: 判定を出さず、◯△✕が本人の記録である旨を開示している", () => {
  assert.ok(html.includes("このページは判定をしません"), "判定しない宣言がある");
  assert.ok(!/class="stamp"/.test(html), "判定スタンプのUI部品を持たない");
  // 表の◯△✕がエンジンの判定と誤読されないための開示(消えたら評価が事実のふりをする)
  assert.ok(html.includes("本人が置いた評価の記録"), "評価の性質(本人の記録)の開示がある");
  assert.ok(html.includes("エンジンの判定ではない"), "エンジン判定でない旨の開示がある");
});

test("decision: 一周の構成(4駅+土台+学び)が欠けていない", () => {
  // 図1: ループの4駅と「今ここ」
  for (const station of ["中古戸建からスタート", "新築もありでは?", "いっそ賃貸では?", "新築(二周目)", "今ここ"]) {
    assert.ok(html.includes(station), `ループに「${station}」がある`);
  }
  // 土台: 譲れない条件(マンション除外)と戸建て確定
  assert.ok(html.includes("マンション ✕(譲れない)"), "マンション除外の分岐がある");
  assert.ok(html.includes("戸建て一択(確定)"), "戸建て確定の分岐がある");
  // 図2: 一周の最大の学び(これが消えると循環の説明がつかない)
  assert.ok(html.includes("資産性はある程度捨てる"), "学びの結論がある");
  assert.ok(html.includes("売りにくい(資産性 ✕)"), "駅近の枝(1億前後→買い手僅少)がある");
  assert.ok(html.includes("上がらない(資産性 ✕)"), "駅遠の枝(土地割引)がある");
});

test("decision: SVGの体裁(role/aria-label・rotate不使用)と関連ページへの導線", () => {
  const svgs = html.match(/<svg [^>]*>/g) ?? [];
  assert.equal(svgs.length, 2, "SVGが2枚(一周ループ・資産性の2分岐)");
  for (const s of svgs) {
    assert.ok(s.includes('role="img"'), `role=img がある: ${s.slice(0, 60)}`);
    assert.ok(s.includes("aria-label"), `aria-label がある: ${s.slice(0, 60)}`);
  }
  // 運用ルール5: 縦軸ラベルの rotate(-90) は検査に落ちるため使わない
  assert.ok(!html.includes("rotate(-90"), "rotate(-90) を使っていない");
  for (const link of ["focus.html", "simulate.html", "effort.html", "rent.html", "cliff.html", "index.html"]) {
    assert.ok(html.includes(`href="${link}"`), `${link} への導線がある`);
  }
});
