// tests/retail.test.js — リテール比較法(戸建成約比較)の不変条件と回帰値
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../engine/appraise.js";
import { loadHouseDeals, loadVerification, retailEstimate, RETAIL } from "../engine/retail.js";
import { growthFactor } from "../engine/timeadjust.js";
import { calibrate } from "../engine/calibrate.js";
import { loadAreaConfig, loadProperty, listPropertyIds } from "../engine/io.js";

const AS_OF = new Date(Date.UTC(2026, 7, 10));  // 2026-08-10 固定

test("検証パイプライン: conflict行は査定から除外され、検証状態が全行に付与される", () => {
  const v = loadVerification();
  assert.ok(v && v.rows.length >= 400, "verification.jsonが存在する");
  const conflicts = v.rows.filter((r) => r.status === "conflict");
  const deals = loadHouseDeals();
  const keys = new Set(deals.map((d) => [d.quarter, d.district, d.price_man, d.land_m2, d.floor_m2, d.age_y, d.walk_min].join("|")));
  for (const c of conflicts) assert.ok(!keys.has(c.key), `conflict行が査定に混入: ${c.key}`);
  for (const d of deals) assert.ok(["verified2", "verified1", "unverified", "unchecked"].includes(d.verification));
  // 全行に人間がファクトチェックできる出所が記録されている
  for (const r of v.rows) assert.ok(r.source_primary && r.source_secondary && r.source_origin, `出所欠落: ${r.key}`);
});

test("house-deals.csv: 全行が数値として妥当・外れ値がロード時に除外される", () => {
  const deals = loadHouseDeals();
  assert.ok(deals.length >= 400, `件数: ${deals.length}`);
  for (const d of deals) {
    assert.ok(d.price_man > 100 && d.price_man < 100000, `${d.quarter} ${d.district}: price ${d.price_man}`);
    assert.ok(d.land_m2 > 10 && d.land_m2 < 1000, `land ${d.land_m2}`);
    assert.ok(d.floor_m2 > 10 && d.floor_m2 < 1000, `floor ${d.floor_m2}`);
    assert.ok(Number.isFinite(d.age_y) && Number.isFinite(d.walk_min));
    assert.ok(d.walk_min >= 0 && d.walk_min <= 30, `徒歩域外がロードされた: ${d.walk_min}分`);
    assert.match(d.quarter, /^\d{4}Q[1-4]$/, `四半期書式: ${d.quarter}`);
    assert.ok(d.quarter.slice(0, 4) >= "2022");
  }
});

test("敵対的: 徒歩外れ値・新築混入・負の単価が事例比較を汚染しない", () => {
  const asOf = AS_OF;
  const base = { land: 66, setback: 0, floor: 88, walk: 13, age: 16,
    shape: 0, dir: 0.02, roadq: 0, corner: false, extra: 0, lc: 0, repair: 800, bm: -0.05 };
  // 徒歩90分の事例を故意に混入しても、フィルタで除外されるか単価が発散しない
  const poisoned = [
    ...loadHouseDeals(),
    { quarter: "2023Q2", district: "神谷", price_man: 4700, land_m2: 66, floor_m2: 88, age_y: 16, walk_min: 90, source_url: "" },
  ];
  const r = retailEstimate(base, asOf, poisoned, { subjectDistrict: "赤羽西" });
  assert.ok(r, "比較成立");
  for (const c of r.comps) {
    assert.ok(c.unitAdj > 0, `負の単価: ${JSON.stringify(c)}`);
    assert.ok(c.unitAdj < 2000, `発散した単価: ${Math.round(c.unitAdj)}万/坪 (${c.quarter} ${c.district} 徒歩${c.walk_min}分)`);
    assert.ok(c.walk_min <= RETAIL.WALK_MAX, "徒歩上限超の事例が混入");
  }
  // 中古(築16年)の査定に新築建売(築1年未満)が混ざらない
  for (const c of r.comps) assert.ok(c.age_y >= RETAIL.NEWBUILD_AGE, `新築混入: 築${c.age_y}年`);
});

test("敵対的: 減価要因(再建築不可)がリテール経路でも消滅しない", () => {
  const cfg = loadAreaConfig();
  const deals = loadHouseDeals();
  const prop = loadProperty("shimo3-20706806");
  const normal = evaluate(prop, cfg, { asOf: AS_OF, houseDeals: deals });
  const noRebuild = evaluate(
    { ...prop, land: { ...prop.land, legal: { ...prop.land.legal, rebuildable: false } } },
    cfg, { asOf: AS_OF, houseDeals: deals });
  assert.ok(noRebuild.fairFinal.mid < normal.fairFinal.mid * 0.8,
    `再建築不可で2割以上下がるべき: ${Math.round(normal.fairFinal.mid)} → ${Math.round(noRebuild.fairFinal.mid)}`);
});

test("地域要因: 事例は対象の近接地区に限定される(不足時のみ全地区+フラグ)", () => {
  const deals = loadHouseDeals();
  const base = { land: 66, setback: 0, floor: 88, walk: 10, age: 15,
    shape: 0, dir: 0, roadq: 0, corner: false, extra: 0, lc: 0, repair: 800, bm: -0.05 };
  const r = retailEstimate(base, AS_OF, deals, { subjectDistrict: "赤羽西" });
  assert.ok(r && r.districtScoped, "近接地区限定が成立する");
  const allowed = ["赤羽西", "西が丘", "赤羽台", "赤羽"];
  for (const c of r.comps) assert.ok(allowed.includes(c.district), `近接外の事例が混入: ${c.district}`);
  // subjectDistrict不明でも落ちない(全地区・フラグfalse)
  const r2 = retailEstimate(base, AS_OF, deals, { subjectDistrict: null });
  assert.ok(r2 && !r2.districtScoped);
});

test("時点修正(年次別): 過去→現在で1超・逆向きは逆数・恒等", () => {
  assert.ok(growthFactor("2022Q1", "2026-08-10") > 1.2);
  const f = growthFactor("2023Q3", "2025-01-01");
  const g = growthFactor("2025-01-01", "2023Q3");
  assert.ok(Math.abs(f * g - 1) < 1e-9, "逆向きは逆数");
  assert.equal(growthFactor("2024-05-15", "2024-05-15"), 1);
});

test("回帰値: 赤羽西4のリテール比較が実勢レンジ内で、適正価格に採用される", () => {
  const r = evaluate(loadProperty("akabanenishi4-21036139"), loadAreaConfig(),
    { asOf: AS_OF, houseDeals: loadHouseDeals() });
  assert.ok(r.retail, "リテール比較が成立する");
  assert.ok(r.retail.n >= RETAIL.MIN_COMPS, `類似成約 ${r.retail.n}件`);
  // 監査③の実測(同帯の直近成約 5,700〜6,800万・中心6,000〜6,400万)と整合すること
  assert.ok(r.retail.mid > 5500 && r.retail.mid < 7000, `リテール中央値: ${r.retail.mid}`);
  // 重み付き調整(第2次監査)により、統合適正は両手法の間(±フロア下限)に収まる
  const lower = Math.min(r.retail.mid, r.mid.fair) - 1e-9;
  const upper = Math.max(r.retail.mid, r.mid.fair, r.mid.floorVal) + 1e-9;
  assert.ok(r.fairFinal.mid >= lower && r.fairFinal.mid <= upper, `統合適正が両手法の外: ${r.fairFinal.mid}`);
  assert.ok(r.mid.floorVal * r.fairFinal.floorGuard <= r.fairFinal.mid + 1e-9, "floor×guard<=fair不変条件");
  assert.ok(r.retail.lo <= r.retail.mid && r.retail.mid <= r.retail.hi, "四分位の順序");
});

test("不変条件: 全登録物件(較正込み)で floorNet<=floorVal<=fairFinal / lo<=mid<=hi", () => {
  const cfg = loadAreaConfig();
  const deals = loadHouseDeals();
  const cal = calibrate();
  for (const id of listPropertyIds()) {
    const r = evaluate(loadProperty(id), cfg, { asOf: AS_OF, houseDeals: deals, cal });
    assert.ok(r.mid.floorNet <= r.mid.floorVal + 1e-9, `${id}: floorNet>floorVal`);
    assert.ok(r.mid.floorVal * r.fairFinal.floorGuard <= r.fairFinal.mid + 1e-9, `${id}: floor×guard>fair`);
    assert.ok(r.fairFinal.lo <= r.fairFinal.mid + 1e-9 && r.fairFinal.mid <= r.fairFinal.hi + 1e-9, `${id}: レンジ順序`);
    assert.ok(Number.isFinite(r.premium) && Number.isFinite(r.instLoss));
    if (r.retail) {
      assert.ok(r.fairFinal.weights.retail + r.fairFinal.weights.cost === 1, `${id}: 重みが1に正規化されていない`);
      for (const c of r.retail.comps) assert.ok(c.unitAdj > 0 && c.unitAdj < 2000, `${id}: 補正後単価が異常 ${c.unitAdj}`);
    }
  }
});

test("較正接続: 信頼度が十分なエリアは較正値が採用され、参考は従来値を維持", () => {
  const cfg = loadAreaConfig();
  const cal = calibrate();
  // akabane-nishi(較正205・従来245) → level=lowは50:50ブレンド(R3監査: フル置換の崖を解消)
  const r1 = evaluate(loadProperty("akabanenishi4-21036139"), cfg, { asOf: AS_OF, cal });
  assert.equal(Math.round(r1.state.ppt), 225);
  // jujo-nakahara(参考・極小標本) → 物件YAMLの上書きを維持
  const r2 = evaluate(loadProperty("jujonakahara2-21028966"), cfg, { asOf: AS_OF, cal });
  assert.equal(Math.round(r2.state.ppt), 300);
  // cal未指定なら従来どおり
  const r3 = evaluate(loadProperty("akabanenishi4-21036139"), cfg, { asOf: AS_OF });
  assert.equal(Math.round(r3.state.ppt), 245);
});

test("価格の位置(2026-08-13: 機械判定を廃止し事実提示のみ)", () => {
  const cfg = loadAreaConfig();
  const deals = loadHouseDeals();
  const cal = calibrate();
  // jujonakahara3: 売出6,580 vs 市場実勢中央値≈6,279(売主の期待+301)・上位四分位≈6,566。
  // かつては「保留/見送」を成約分布で判定していたが、買うか見送るかは人の判断であるため
  // スタンプを全廃した。エンジンは参照水準(中央値・上位四分位・交渉幅を載せた水準・
  // 土地換算値)と売出の位置関係を数字で返すのみ
  const r = evaluate(loadProperty("jujonakahara3-adcast"), cfg, { asOf: AS_OF, houseDeals: deals, cal });
  assert.equal(r.position.basis, "market");
  assert.ok(!("mark" in r.position), "ラベルを持たない");
  assert.ok(Number.isFinite(r.premiumMarket) && Number.isFinite(r.overheat));
  assert.ok(r.overheat > 0, "市場の上振れ(過熱感)が正のはずの局面");
  assert.ok(r.negoBand > r.retail.hi, "参照水準=上位四分位+交渉幅");
  assert.ok(r.position.body.includes("売主の期待"), "売主の期待を数字で開示する");
  // 市場実勢から大きく外れる物件(売出が上位四分位+38%)でも、返すのは差額の事実だけ
  const r2 = evaluate(loadProperty("nishigaoka1-21215249"), cfg, { asOf: AS_OF, houseDeals: deals, cal });
  assert.equal(r2.position.basis, "market");
  assert.ok(r2.state.ask > r2.negoBand, "この物件は交渉幅を載せた水準を超えている");
  assert.ok(!/見送|保留/.test(r2.position.head + r2.position.body), "判定語を出さない");
  // リテール不成立(商業系×未検証単価)は、旧「調査」降格の中身を注記として残す
  const r3 = evaluate(loadProperty("jujonakahara2-21028966"), cfg, { asOf: AS_OF, houseDeals: deals, cal });
  assert.equal(r3.position.basis, "blend");
  assert.equal(r3.negoBand, null);
  assert.ok(r3.position.notes.some((n) => n.includes("未検証")), "単価未検証の開示が残る");
});
