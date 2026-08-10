// tests/retail.test.js — リテール比較法(戸建成約比較)の不変条件と回帰値
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../engine/appraise.js";
import { loadHouseDeals, RETAIL } from "../engine/retail.js";
import { growthFactor } from "../engine/timeadjust.js";
import { loadAreaConfig, loadProperty } from "../engine/io.js";

const AS_OF = new Date(Date.UTC(2026, 7, 10));  // 2026-08-10 固定

test("house-deals.csv: 全行が数値として妥当", () => {
  const deals = loadHouseDeals();
  assert.ok(deals.length >= 400, `件数: ${deals.length}`);
  for (const d of deals) {
    assert.ok(d.price_man > 100 && d.price_man < 100000, `${d.quarter} ${d.district}: price ${d.price_man}`);
    assert.ok(d.land_m2 > 10 && d.land_m2 < 1000, `land ${d.land_m2}`);
    assert.ok(d.floor_m2 > 10 && d.floor_m2 < 1000, `floor ${d.floor_m2}`);
    assert.ok(Number.isFinite(d.age_y) && Number.isFinite(d.walk_min));
    assert.ok(d.quarter >= "2022Q1");
  }
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
  assert.ok(r.fairFinal.mid >= r.mid.fair, "統合適正は原価法以上");
  assert.ok(r.mid.floorVal <= r.fairFinal.mid + 1e-9, "floor<=fair不変条件");
  assert.ok(r.retail.lo <= r.retail.mid && r.retail.mid <= r.retail.hi, "四分位の順序");
});

test("不変条件: 全登録物件で floor<=fairFinal / lo<=mid<=hi", () => {
  const cfg = loadAreaConfig();
  const deals = loadHouseDeals();
  for (const id of ["akabanedai3-20268457", "shimo1-21186616", "jujonakahara3-adcast", "nishigaoka2-adcast-a"]) {
    const r = evaluate(loadProperty(id), cfg, { asOf: AS_OF, houseDeals: deals });
    assert.ok(r.mid.floorVal <= r.fairFinal.mid + 1e-9, `${id}: floor>fair`);
    assert.ok(r.fairFinal.lo <= r.fairFinal.mid + 1e-9 && r.fairFinal.mid <= r.fairFinal.hi + 1e-9, `${id}: レンジ順序`);
    assert.ok(Number.isFinite(r.premium) && Number.isFinite(r.instLoss));
  }
});
