// tests/rent-screen.test.js — 賃貸スクリーニングの回帰ガード。
// 守りたいこと:
//   ① 定期借家のKO(2026-08-18ユーザー決定)が外れたら落ちる
//   ② **トイレ2個がKO/圏外条件に昇格したら落ちる**(記載なし=無い、と読み替える事故の防止)
//   ③ 掲載の自由文表記の揺れで契約種別を取りこぼさない
//   ④ ページ下部の推薦枠の賃料を掴まない(物件ヘッダ限定の抽出)
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRentDetail, roomsOfRent, contractTypeOf, seismicOf,
  rentKoScreen, rentScopeCheck, monthsOf, manOf, RENT_SCOPE,
} from "../crawler/rent-screen.mjs";

// SUUMO賃貸詳細ページの骨格を最小再現する。実ページの構造(2026-08-18時点)に合わせてある:
//   ヘッダ「賃料|管理費・共益費:|敷金:|礼金:|保証金:|敷引・償却:」→ 所在地 → 駅徒歩 → 間取り
//   → 専有面積 → 建物種別 → 物件概要表(構造・築年月・契約期間 等)
function page({ rent = "21万円", kanri = "-", shiki = "21万円", rei = "21万円",
  addr = "東京都北区赤羽３", walks = ["ＪＲ京浜東北線/赤羽駅 歩13分", "東京メトロ南北線/赤羽岩淵駅 歩5分"],
  layout = "3LDK", area = "74.26", btype = "一戸建て", built = "2011年8月",
  contract = "普通借家 2年", setsubi = "バストイレ別、温水洗浄便座", extra = "", recommend = true } = {}) {
  return [
    `<div>${rent}</div><div>管理費・共益費: ${kanri}</div><div>敷金: ${shiki}</div>`,
    `<div>礼金: ${rei}</div><div>保証金: -</div><div>敷引・償却: -</div>`,
    `<div>所在地</div><div>${addr}</div>`,
    `<div>駅徒歩</div>` + walks.map((w) => `<div>${w}</div>`).join(""),
    `<div>間取り</div><div>${layout}</div><div>専有面積</div><div>${area}m<sup>2</sup></div>`,
    `<div>建物種別</div><div>${btype}</div>`,
    `<div>部屋の特徴・設備</div><div>${setsubi}</div>`,
    `<div>構造</div><div>木造</div><div>築年月</div><div>${built}</div>`,
    contract ? `<div>契約期間</div><div>${contract}</div>` : "",
    extra,
    // ページ下部の「この物件を見た人はこんな物件も見ています」。**別物件の賃料**
    recommend ? `<div>賃料(管理費)</div><div>99万円</div><div>(-)</div>` : "",
  ].join("");
}

test("賃料はページ下部の推薦枠ではなく物件ヘッダから取る", () => {
  const d = parseRentDetail(page());
  assert.equal(d.rent_man, 21, "推薦枠の99万円を掴んではいけない");
  assert.equal(d.kanri_man, 0, "管理費「-」は0(記載なしではなく無料)");
  assert.equal(d.total_man, 21);
});

test("徒歩分は物件自身の駅徒歩ブロックから取り、最小値を採る", () => {
  const d = parseRentDetail(page());
  assert.equal(d.walk_min, 5);
  assert.equal(d.walks.length, 2);
  assert.deepEqual(d.walks.map((w) => w.walk_min), [13, 5]);
});

test("定期借家はKO(RKO1)。この判定が消えたら落ちる", () => {
  for (const raw of ["定期借家 2年", "定期借家 3年", "定期借家 西暦2030年3月まで"]) {
    const ko = rentKoScreen(parseRentDetail(page({ contract: raw })));
    assert.equal(ko.verdict, "block", `${raw} はKOでなければならない`);
    assert.ok(ko.codes.includes("RKO1"));
  }
});

test("普通借家はKOにならない", () => {
  const ko = rentKoScreen(parseRentDetail(page({ contract: "普通借家 2年" })));
  assert.equal(ko.verdict, "pass");
  assert.deepEqual(ko.codes, []);
});

test("契約期間の記載が無い掲載はblockでもpassでもなくsuspect(人の判断へ回す)", () => {
  const d = parseRentDetail(page({ contract: "" }));
  assert.equal(d.contract.type, null);
  const ko = rentKoScreen(d);
  assert.equal(ko.verdict, "suspect", "判別できないものを勝手に落とさない/通さない");
});

test("契約期間の表記ゆれ: 年数と期日をどちらも読む", () => {
  assert.deepEqual(contractTypeOf("普通借家 2年").type, "futsu");
  assert.equal(contractTypeOf("定期借家 4年").years, 4);
  assert.equal(contractTypeOf("定期借家 西暦2030年3月まで").until, "2030-03");
  assert.equal(contractTypeOf("定期借家 西暦2030年3月まで").years, null, "期日表記を年数と誤読しない");
  assert.equal(contractTypeOf(null).type, null);
});

test("建物種別が一戸建てでなければKO(RKO3)。テラス・タウンハウスは対象外", () => {
  const ko = rentKoScreen(parseRentDetail(page({ btype: "テラスハウス" })));
  assert.equal(ko.verdict, "block");
  assert.ok(ko.codes.includes("RKO3"));
});

test("告知事項ありはKO(RKO2)", () => {
  const ko = rentKoScreen(parseRentDetail(page({ extra: "<div>備考</div><div>告知事項あり</div>" })));
  assert.equal(ko.verdict, "block");
  assert.ok(ko.codes.includes("RKO2"));
});

// ---- ここが本丸: トイレ2個を条件に昇格させない ----
test("トイレ2ヶ所の記載が無くてもKOにも圏外にもならない", () => {
  const d = parseRentDetail(page({ setsubi: "バストイレ別、温水洗浄便座" }));
  assert.equal(d.toilet2, null, "記載なしは null(不明)。false と断定してはいけない");
  assert.equal(rentKoScreen(d).verdict, "pass");
  assert.equal(rentScopeCheck(d), null, "トイレ2個を掲載条件にすると候補が壊滅する(実測66件中10件しか記載がない)");
});

test("トイレ2ヶ所の記載があれば true として拾う(表記ゆれ込み)", () => {
  for (const s of ["トイレ2ヶ所", "トイレ2ケ所", "トイレ2箇所", "トイレ２ヶ所"]) {
    assert.equal(parseRentDetail(page({ setsubi: `バストイレ別、${s}、物置` })).toilet2, true, s);
  }
});

// ---- 掲載条件(圏外)判定 ----
test("圏外判定: 賃料レンジ・徒歩・居室数・旧耐震", () => {
  const base = { contract: "普通借家 2年" };
  assert.match(rentScopeCheck(parseRentDetail(page({ ...base, rent: "12万円" }))), /下限/);
  assert.match(rentScopeCheck(parseRentDetail(page({ ...base, rent: "30万円" }))), /上限/);
  assert.match(rentScopeCheck(parseRentDetail(page({ ...base, walks: ["ＪＲ京浜東北線/赤羽駅 歩14分"] }))), /徒歩14分/);
  assert.match(rentScopeCheck(parseRentDetail(page({ ...base, layout: "2LDK" }))), /2室/);
  assert.match(rentScopeCheck(parseRentDetail(page({ ...base, built: "1975年4月" }))), /旧耐震/);
  assert.equal(rentScopeCheck(parseRentDetail(page(base))), null);
});

test("3DK・4Kは圏外(条件はLDKのある3LDK以上)", () => {
  assert.match(rentScopeCheck(parseRentDetail(page({ layout: "3DK" }))), /LDK/);
  assert.equal(rentScopeCheck(parseRentDetail(page({ layout: "4LDK", area: "90" }))), null);
});

test("納戸(S)は1室として数える", () => {
  assert.equal(roomsOfRent("2SLDK"), 3);
  assert.equal(roomsOfRent("4LDK"), 4);
  assert.equal(roomsOfRent("1SLDK"), 2);
  assert.equal(roomsOfRent("２ＬＤＫ"), 2, "全角表記も数える");
  assert.equal(roomsOfRent("ワンルーム"), null, "数えられない表記は null(判定しない)");
});

test("新耐震の判定: 1981年は判別不能として border を返す(旧耐震と断定しない)", () => {
  assert.equal(seismicOf(1982, 1).level, "new");
  assert.equal(seismicOf(1981, 12).level, "border");
  assert.equal(seismicOf(1980, 6).level, "old");
  assert.equal(seismicOf(null).level, null);
  // border は圏外にしない(掲載の築年月だけでは建築確認の時期が分からないため)
  const d = parseRentDetail(page({ built: "1981年10月" }));
  assert.equal(rentScopeCheck(d), null);
});

test("金額・月数のパース", () => {
  assert.equal(manOf("21万円"), 21);
  assert.equal(manOf("10000円"), 1);
  assert.equal(manOf("-"), null);
  assert.equal(monthsOf("21万円", 21), 1);
  assert.equal(monthsOf("1ヶ月", 21), 1);
  assert.equal(monthsOf("50％", 21), 0.5);
  assert.equal(monthsOf("-", 21), 0, "「-」は0(無い)であって不明ではない");
  assert.equal(monthsOf("応相談", 21), null, "読めない表記は null");
});

test("掲載条件の定数が勝手に変わっていないか(方針の記録)", () => {
  assert.deepEqual(RENT_SCOPE, {
    total_min_man: 15, total_max_man: 25, walk_max: 10,
    rooms_min: 3, require_ldk: true, seismic_new_only: true,
  }, "条件を変えるときはCLAUDE.mdの方針も同時に更新すること");
});
