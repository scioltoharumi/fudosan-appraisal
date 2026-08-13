// tests/crawler.test.js — クロールの名寄せ規則(別戸の取りこぼし防止)
// 2026-08-12: 西が丘2で「同一開発の別戸」を重複と誤断して2号棟を取りこぼした事故を受けて追加。
// 事故の型: 新築の複数戸掲載は一覧が開発の代表価格(下限値)を出すため、価格が一致しても別戸でありうる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprint, siblingHint, DISTRICTS, roomsOf } from "../crawler/daily.mjs";

const districtOf = (addr) => DISTRICTS.find((d) => String(addr ?? "").startsWith("東京都北区" + d)) ?? null;
// 事故当時の台帳(1号棟のみ登録・価格は誤って5980万だった)
const LEDGER = [{ id: "nishigaoka2-20767290", district: "西が丘", chome: "2", price_man: 5980, land_m2: 57.65, floor_m2: 92.34 }];
const unit = (o) => ({ address: "東京都北区西が丘2", ...o });

test("指紋: 価格と土地面積が同じでも建物面積が違えば別指紋(名寄せで消えない)", () => {
  const a = fingerprint("西が丘", "2", 5980, 57.65, 92.34);
  const b = fingerprint("西が丘", "2", 5980, 57.65, 93.55);
  assert.notEqual(a, b, "建物面積の違いが指紋に反映されること");
  assert.equal(a, fingerprint("西が丘", "2", 5980, 57.65, 92.34), "同一入力は同一指紋");
});

test("事故の再現: 価格一致・土地面積不一致は『別戸の可能性・要判断』として旗が立つ", () => {
  // 実際に取りこぼした2号棟(5980万・土地58.53・建物93.55)
  const hint = siblingHint(unit({ price_man: 5980, land_m2: 58.53, floor_m2: 93.55 }), districtOf, LEDGER);
  assert.ok(hint, "旗が立つこと");
  assert.match(hint, /別戸の可能性・要判断/);
  assert.match(hint, /価格一致は同一戸の根拠にならない/, "誤断の理由を明示すること");
});

test("同一戸の媒体差(価格・土地一致で建物面積のみ差)は別区分で報告する", () => {
  const hint = siblingHint(unit({ price_man: 5980, land_m2: 57.65, floor_m2: 100.37 }), districtOf, LEDGER);
  assert.match(hint, /同一戸の疑い/);
  assert.match(hint, /新規登録は不要な公算/);
});

test("土地面積一致・価格も建物面積も不一致は『別戸または価格改定』として報告する", () => {
  // 西が丘2のC号棟(7680万/60.65/106.93)とD号棟(7980万/60.65/106.26)は土地が同一の別戸という実例
  const hint = siblingHint(unit({ price_man: 7680, land_m2: 57.65, floor_m2: 106.93 }), districtOf, LEDGER);
  assert.match(hint, /別戸または価格改定/);
});

test("土地・建物が一致し価格だけ違うのは同一戸の価格改定なので旗を立てない", () => {
  // これは watch 側で price_changed として扱う領域。discover で別戸扱いすると二重登録になる
  assert.equal(siblingHint(unit({ price_man: 6580, land_m2: 57.65, floor_m2: 92.34 }), districtOf, LEDGER), null);
});

test("完全一致(同一戸)には旗を立てない / 別丁目にも立てない", () => {
  assert.equal(siblingHint(unit({ price_man: 5980, land_m2: 57.65, floor_m2: 92.34 }), districtOf, LEDGER), null,
    "完全一致は同一戸として別経路で除外されるため旗不要");
  assert.equal(siblingHint({ address: "東京都北区志茂3", price_man: 5980, land_m2: 58.53, floor_m2: 93.55 }, districtOf, LEDGER), null,
    "別地区には旗を立てない");
});

// ---- 掲載条件の機械判定(2026-08-13追加) ----
// 事故の型: 滝野川1の2件(延床65.24 / 65.72)が KO非該当のまま「自動登録の候補」として上がり、
// 人が掲載条件(延床70m2超・3室以上)で弾く必要があった。KOではないので block にはできないが、
// 登録できないものを自動登録候補に混ぜてはいけない。out_of_scope で分離する。
test("間取り文字列から居室数を数える(納戸・全角表記・媒体の崩れに耐える)", () => {
  assert.equal(roomsOf("4LDK"), 4);
  assert.equal(roomsOf("2LDK"), 2);
  assert.equal(roomsOf("2LDK+S"), 3);
  assert.equal(roomsOf("2LDK+2S（納戸）"), 4);      // 実データ: 西ケ原4 nc_21230921
  assert.equal(roomsOf("2LDK+S（納戸）"), 3);       // 実データ: 中里3 nc_21439305
  // athomeは全角。＋(U+FF0B)は英数の全角変換の対象外なので個別に潰している
  assert.equal(roomsOf("２ＬＤＫ＋Ｓ"), 3);
  assert.equal(roomsOf("２ＬＤＫ＋２Ｓ"), 4);
  // 数えられない表記は null(=条件判定をしない)。誤って落とすより人に見せる
  assert.equal(roomsOf(null), null);
  assert.equal(roomsOf(""), null);
  assert.equal(roomsOf("メゾネット"), null);
});

test("拡張した探索地区が DISTRICTS に入っており、住所からの地区判定が効く", () => {
  for (const d of ["王子本町", "岸町", "滝野川", "西ケ原", "中里", "上中里"]) {
    assert.ok(DISTRICTS.includes(d), `${d}が探索対象に入っていない`);
    assert.equal(districtOf(`東京都北区${d}３丁目`), d);
  }
  // 拡張前の12地区が落ちていないこと
  for (const d of ["赤羽西", "西が丘", "赤羽台", "中十条", "十条仲原", "上十条", "志茂"]) {
    assert.ok(DISTRICTS.includes(d), `${d}が探索対象から消えた`);
  }
});
