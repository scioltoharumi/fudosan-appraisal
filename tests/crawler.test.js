// tests/crawler.test.js — クロールの名寄せ規則(別戸の取りこぼし防止)
// 2026-08-12: 西が丘2で「同一開発の別戸」を重複と誤断して2号棟を取りこぼした事故を受けて追加。
// 事故の型: 新築の複数戸掲載は一覧が開発の代表価格(下限値)を出すため、価格が一致しても別戸でありうる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprint, siblingHint, DISTRICTS, roomsOf, districtOfAddress, needsRescreen, salesUnitsOf } from "../crawler/daily.mjs";

const districtOf = (addr) => districtOfAddress(addr);
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

test("地区名は長い方を優先して照合する(赤羽北を赤羽と読まない)", () => {
  // 2026-08-28の実害: DISTRICTS は "赤羽" が "赤羽北"/"赤羽西" より前にあるため、素朴な find だと
  // 「赤羽北2」が "赤羽" に当たり、丁目ハザードを別の丁目(赤羽2)として引いていた。
  // より重いのは 赤羽西1〜3 が 赤羽1〜3 として**誤ってブロック**され候補を取りこぼすこと
  assert.equal(districtOfAddress("東京都北区赤羽北2"), "赤羽北");
  assert.equal(districtOfAddress("東京都北区赤羽西4"), "赤羽西");
  assert.equal(districtOfAddress("東京都北区赤羽台3"), "赤羽台");
  assert.equal(districtOfAddress("東京都北区赤羽南1"), "赤羽南");
  assert.equal(districtOfAddress("東京都北区赤羽2"), "赤羽", "赤羽そのものは従来どおり");
  assert.equal(districtOfAddress("北区赤羽西4", "北区"), "赤羽西", "台帳YAMLの「北区」表記でも同じ");
  assert.equal(districtOfAddress("東京都北区未知町1"), null, "対象外の地区はnull");
});

// 2026-08-29: 既見の掲載を「価格が動いたときだけ」再審査していたため、初見時に詳細取得の予算
// (KO_DETAIL_MAX=8)が尽きて未審査のまま残った掲載が永久に埋もれていた。
// 実害: 岸町2 nc_21485594(7,180万・新築・掲載条件を満たす)が2026-08-13の初見から16日間、
// 一度も報告されなかった。seen.json 113件中82件が同じ状態だった。
// このテストは「印が1つも無い既見は価格が同じでも再審査に上がる」ことを固定する。
test("再審査: 未審査の既見掲載は価格が動かなくても拾う(予算切れの取りこぼしを埋もれさせない)", () => {
  const kishimachi = { first_seen: "2026-08-13", price_man: 7180, address: "東京都北区岸町２", floor_m2: null };
  assert.equal(needsRescreen(kishimachi, 7180), true, "未審査(印なし)は価格据え置きでも再審査する");

  // 判定済みのものは価格が動いたときだけでよい(現場属性は価格で覆らない)
  assert.equal(needsRescreen({ ko_screened: true, price_man: 7180 }, 7180), false, "審査済み・価格据え置きは取りに行かない");
  assert.equal(needsRescreen({ ko_screened: true, price_man: 7180 }, 6980), true, "審査済みでも値下げしたら再判定する");

  // KO・圏外は価格が動いても再提案しない(既存の規律を壊さない)
  assert.equal(needsRescreen({ ko_blocked: true, price_man: 7180 }, 6980), false, "KO済みは値下げしても戻さない");
  assert.equal(needsRescreen({ out_of_scope: { floor_m2: 65 }, price_man: 7180 }, 6980), false, "圏外は値下げしても戻さない");

  // suspect も詳細まで取ったうえでの判定なので、印が付いていれば取りに行かない
  // (印を付け忘れると毎回全件の詳細を取りに行き、相手サイトへの負荷と予算浪費になる)
  assert.equal(needsRescreen({ ko_screened: true, ko_suspect: ["ROAD_NO_SHARE"], price_man: 7180 }, 7180), false,
    "suspectは審査済みとして扱う(毎回再取得しない)");

  assert.equal(needsRescreen(null, 7180), false, "新着は別経路");
});

// 2026-08-29ユーザー決定「土地カテゴリも考慮したい」。岸町2-4-9(建築条件なし土地)が
// 土地カテゴリ非巡回のせいで機械探索に一度も乗らなかったことを受けて追加した。
// 土地の圏外条件(価格2,500〜7,500万・土地45m2以上)と「建物条件を土地に当てない」ことを固定する。
test("土地(tochi): 建物条件は適用せず、土地面積の条件だけで判定する", async () => {
  const { scopeMissOf } = await import("../crawler/daily.mjs");
  // 岸町2-4-9 相当: 土地64.03m2・建物なし → 圏外にならない
  assert.equal(scopeMissOf({ land_m2: 64.03, floor_m2: null, layout: null }, 7, "tochi"), null);
  // 土地45m2未満は圏外
  assert.match(scopeMissOf({ land_m2: 40.39 }, 3, "tochi") ?? "", /土地40\.39m2/);
  // 面積が読めない掲載は判定しない(数えられないものは落とさない規律)
  assert.equal(scopeMissOf({ land_m2: null }, 5, "tochi"), null);
  // 徒歩上限は土地にも効く
  assert.match(scopeMissOf({ land_m2: 64 }, 21, "tochi") ?? "", /徒歩21分/);
  // 戸建の判定は従来どおり(延床70m2以下は圏外のまま)
  assert.match(scopeMissOf({ floor_m2: 65.24 }, 4, "chuko") ?? "", /延床65\.24m2/);
});

test("土地(tochi): KO5の必須項目に建物面積を要求しない(戸建は従来どおり要求する)", async () => {
  const { koScreen } = await import("../crawler/screen.mjs");
  const scan = { flags: [], notes: [], attrs: { land_m2: 64.03, floor_m2: null }, hazard_media: "suumo" };
  const tochi = koScreen({ unit: { kind: "tochi", price_man: 5810, district: "岸町", chome: 2 }, siteHit: null, scan, areaHazard: null });
  assert.equal(tochi.verdict, "pass", "土地は建物面積なしでもKO5にならない: " + JSON.stringify(tochi.codes));
  const kodate = koScreen({ unit: { kind: "chuko", price_man: 5810, district: "岸町", chome: 2 }, siteHit: null, scan, areaHazard: null });
  assert.equal(kodate.verdict, "block", "戸建は建物面積が無ければ従来どおりKO5で止まる");
  assert.ok(kodate.codes.includes("KO5_incomplete"));
});

// 2026-08-29: 土地カテゴリ初回クロールで、詳細未取得(NO_DETAIL=verdict unknown)の新着24件に
// ko_screened が付いてしまった(=needsRescreenが二度と拾わない)。8/13の取りこぼしと同じ穴の再発。
// 「印を立ててよいのは実際に詳細を審査した pass / suspect だけ」を固定する。
test("再審査: unknown(詳細未取得)には審査済みの印を立てない", async () => {
  const { isScreenedVerdict, needsRescreen } = await import("../crawler/daily.mjs");
  assert.equal(isScreenedVerdict("pass"), true);
  assert.equal(isScreenedVerdict("suspect"), true);
  assert.equal(isScreenedVerdict("unknown"), false, "詳細未取得は審査済みではない");
  assert.equal(isScreenedVerdict("block"), false, "blockはko_blockedで記録する(ko_screenedではない)");
  // unknownのまま残った掲載は、価格が動かなくても needsRescreen が拾い続ける
  assert.equal(needsRescreen({ price_man: 4480, kind: "tochi" }, 4480), true);
});

// 複数戸掲載の代表価格を戸の価格として拾わないこと(2026-08-29の誤報を受けた回帰ガード)。
// 滝野川3 nc_21133135 は madoriList が1件ぶんしか無く、号棟別価格は写真キャプションにしかない。
// 構造化データだけを見ていると「単独掲載」と誤認し、ページ代表価格=**最安戸**を拾って
// 台帳のA号棟6,380万に対しB号棟6,180万を「-200万の値下げ」と毎日誤報していた。
test("salesUnitsOf: 掲載の販売戸数で複数戸を検出する(構造化データが壊れていても読める)", () => {
  assert.equal(salesUnitsOf("<div>販売戸数</div><div>2戸</div>"), 2);
  assert.equal(salesUnitsOf("<span>販売戸数</span> <span>4戸</span>"), 4);
  assert.equal(salesUnitsOf("販売戸数 1戸"), 1, "単独掲載は1");
  // 販売戸数が無ければ総戸数へ退避する
  assert.equal(salesUnitsOf("<td>総戸数</td><td>3戸</td>"), 3);
  assert.equal(salesUnitsOf("販売戸数 2戸 総戸数 5戸"), 2, "販売戸数を優先する");
  // **記載なしは判定しない**(0や1で埋めると単独掲載として代表価格を拾ってしまう)
  assert.equal(salesUnitsOf("<div>価格 6180万円</div>"), null);
  assert.equal(salesUnitsOf(""), null);
  // タグを跨いでも読めること(SUUMOはラベルと値が別要素)
  assert.equal(salesUnitsOf('<th class="x">販売戸数</th><td class="y">2</td><td>戸</td>'), 2);
});
