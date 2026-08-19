// tests/rent-screen.test.js — 賃貸スクリーニングの回帰ガード。
// 守りたいこと:
//   ① 定期借家のKO(2026-08-18ユーザー決定)が外れたら落ちる。
//      **許容は「3年ちょうど」だけ**で、2年も4年以上も落ちること(長さの要件であって短さの問題ではない)
//   ② **トイレ2個がKO/圏外条件に昇格したら落ちる**(記載なし=無い、と読み替える事故の防止)
//   ③ 掲載の自由文表記の揺れで契約種別を取りこぼさない
//   ④ ページ下部の推薦枠の賃料を掴まない(物件ヘッダ限定の抽出)
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRentDetail, roomsOfRent, contractTypeOf, seismicOf,
  rentKoScreen, rentScopeCheck, isRentOnlyScope, monthsOf, manOf, RENT_SCOPE, TEIKI_OK_YEARS,
} from "../crawler/rent-screen.mjs";

// SUUMO賃貸詳細ページの骨格を最小再現する。実ページの構造(2026-08-18時点)に合わせてある:
//   ヘッダ「賃料|管理費・共益費:|敷金:|礼金:|保証金:|敷引・償却:」→ 所在地 → 駅徒歩 → 間取り
//   → 専有面積 → 建物種別 → 物件概要表(構造・築年月・契約期間 等)
function page({ rent = "21万円", kanri = "-", shiki = "21万円", rei = "21万円",
  addr = "東京都北区赤羽３", walks = ["ＪＲ京浜東北線/赤羽駅 歩13分", "東京メトロ南北線/赤羽岩淵駅 歩5分"],
  layout = "3LDK", area = "74.26", btype = "一戸建て", built = "2011年8月",
  contract = "普通借家 2年", setsubi = "バストイレ別、温水洗浄便座", extra = "", recommend = true,
  moveIn = "&#039;26年9月下旬", footer = true } = {}) {
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
    `<div>入居</div><div>${moveIn}</div>`,
    extra,
    // SUUMOの全ページ共通フッタ。掲載終了の判定語をここから拾ってはいけない
    footer ? `<div>掲載情報に「事実と異なる点や誤解を招く表現がある」「成約済にもかかわらず掲載されている」場合はご連絡ください</div>` : "",
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

test("路線名が「線」で終わらなくても最寄り駅を落とさない(埼玉高速鉄道)", () => {
  // 赤羽岩淵は南北線と埼玉高速鉄道の境界駅で、SUUMOは掲載ごとに事業者名を書き分ける。
  // 「線」で終わる表記だけを拾っていたため、同じ駅の同じ徒歩分が書き方の運次第で失われ、
  // 「最寄り徒歩13分」という**もっともらしい誤った値**で圏外化されていた(2026-08-19の監査指摘)
  const walks = ["ＪＲ京浜東北線/赤羽駅 歩13分", "埼玉高速鉄道/赤羽岩淵駅 歩5分", "ＪＲ埼京線/北赤羽駅 歩15分"];
  const d = parseRentDetail(page({ walks }));
  assert.equal(d.walk_min, 5, "埼玉高速鉄道の行が落ちている");
  assert.equal(d.walks.length, 3);
  // 表記が「東京メトロ南北線」でも同じ結果になること(同一駅の表記ゆれ)
  const d2 = parseRentDetail(page({ walks: walks.map((w) => w.replace("埼玉高速鉄道", "東京メトロ南北線")) }));
  assert.equal(d2.walk_min, 5);
  assert.equal(d2.walks.length, 3);
});

test("全角の物件ヘッダでも賃料・間取り・面積・徒歩が読める", () => {
  const d = parseRentDetail(page({ layout: "３ＬＤＫ", area: "７４.２６",
    walks: ["ＪＲ京浜東北線/赤羽駅 歩１３分"] }));
  assert.equal(d.layout, "3LDK");
  assert.equal(d.area_m2, 74.26);
  assert.equal(d.walk_min, 13);
});

test("数値実体参照をデコードする(SUUMOはゼロ埋めの &#039; を出す)", () => {
  const d = parseRentDetail(page());
  assert.equal(d.move_in, "'26年9月下旬", "&#039; が生のまま残っている");
});

test("定期借家は3年ちょうどのみ可。2年・4年以上はKO(RKO1)", () => {
  // 2026-08-18ユーザー指示「三年のみOK(子供の小学校入学前タイミング)」。
  // **短いからKOではなく長さの要件**なので、上下どちらに外れても落ちる
  for (const raw of ["定期借家 1年", "定期借家 2年", "定期借家 4年", "定期借家 5年", "定期借家 6年"]) {
    const ko = rentKoScreen(parseRentDetail(page({ contract: raw })));
    assert.equal(ko.verdict, "block", `${raw} はKOでなければならない`);
    assert.ok(ko.codes.includes("RKO1"));
  }
  const ok = rentKoScreen(parseRentDetail(page({ contract: "定期借家 3年" })));
  assert.equal(ok.verdict, "pass", "3年ちょうどは通す");
  assert.deepEqual(ok.codes, []);
  // 通すが普通借家と同じ扱いにはしない。満了で終わる契約であることを注記に残す
  assert.ok(ok.notes.some((n) => /満了/.test(n)), "定期借家である旨の注記が残る");
  assert.ok(ok.notes.some((n) => /3年/.test(n)), "許容年数が注記に出る");
});

test("許容する定期借家の年数は3年のみ(方針の記録)", () => {
  assert.deepEqual([...TEIKI_OK_YEARS], [3],
    "変更するときは CLAUDE.md の方針記述と rent-basis/rent-index の開示文も同時に直すこと");
});

test("定期借家の期日表記でも、同じ掲載の告知事項・連棟は評価される(早期returnしない)", () => {
  // 以前は期日表記で関数を抜けており、確定KOであるはずの RKO2/RKO3 が評価されず
  // suspect として報告されていた(2026-08-19の監査指摘)
  const ko = rentKoScreen(parseRentDetail(page({
    contract: "定期借家 西暦2030年3月まで", btype: "テラスハウス",
    extra: "<div>備考</div><div>告知事項あり</div>" })));
  assert.equal(ko.verdict, "block", "確定KOがあるなら block");
  assert.ok(ko.codes.includes("RKO2"));
  assert.ok(ko.codes.includes("RKO3"));
});

test("契約期間は月数で持つ(「3年6ヶ月」を3年として通さない)", () => {
  const half = rentKoScreen(parseRentDetail(page({ contract: "定期借家 3年6ヶ月" })));
  assert.notEqual(half.verdict, "pass", "端数のある期間を3年ちょうどとして通してはいけない");
  assert.equal(half.verdict, "suspect", "表記ゆれの可能性もあるので block ではなく人の判断へ");
  // 「36ヶ月」は3年ちょうどなので通す
  assert.equal(rentKoScreen(parseRentDetail(page({ contract: "定期借家 36ヶ月" }))).verdict, "pass");
  assert.equal(contractTypeOf("定期借家 3年6ヶ月").months, 42);
  assert.equal(contractTypeOf("定期借家 3年6ヶ月").years, null, "端数があるなら年数は出さない");
  assert.equal(contractTypeOf("定期借家 36ヶ月").years, 3);
});

test("定期借家で期間が期日表記のものは落とさず人へ回す", () => {
  // 「西暦2030年3月まで」は入居日が決まらないと長さが判らない。3年ちょうどか判定できないので suspect
  const ko = rentKoScreen(parseRentDetail(page({ contract: "定期借家 西暦2030年3月まで" })));
  assert.equal(ko.verdict, "suspect");
  assert.ok(ko.codes.includes("RKO1?"));
  assert.ok(ko.notes.some((n) => /実期間を確認/.test(n)));
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

test("告知事項ありはKO(RKO2)。区切り文字の表記ゆれも拾う", () => {
  for (const t of ["告知事項あり", "告知事項：有", "告知事項 : 有", "心理的瑕疵あり"]) {
    const ko = rentKoScreen(parseRentDetail(page({ extra: `<div>備考</div><div>${t}</div>` })));
    assert.equal(ko.verdict, "block", `KOになっていない: ${t}`);
    assert.ok(ko.codes.includes("RKO2"));
  }
  // プライバシーポリシーの定型文で誤検出しない(「広告・宣伝・告知」は告知事項ではない)
  const ok = parseRentDetail(page({ extra: "<div>個人情報は広告・宣伝・告知のために利用します</div>" }));
  assert.equal(ok.notice, null);
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

test("圏外の判定順は恒久条件が先・賃料が最後", () => {
  // 賃料を先に判定していた頃は、徒歩でも落ちる掲載まで「賃料レンジ外」と報告されていた。
  // 値下げで戻りうるものだけを再判定対象にするため、理由の順序に意味を持たせている
  const d = parseRentDetail(page({ rent: "30万円", walks: ["ＪＲ京浜東北線/赤羽駅 歩14分"] }));
  assert.match(rentScopeCheck(d), /徒歩14分/, "恒久条件(徒歩)が先に返るべき");
  const rentOnly = parseRentDetail(page({ rent: "30万円" }));
  assert.ok(isRentOnlyScope(rentScopeCheck(rentOnly)), "上限超えは値下げで戻りうる");
  const under = parseRentDetail(page({ rent: "12万円" }));
  assert.equal(isRentOnlyScope(rentScopeCheck(under)), false, "下限割れは値上げが要るので恒久側");
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
  // 後置の納戸。対応前は「3LDK+S」を3室と読み、実4室の物件を**誤って圏外に落とす**向きに壊れていた
  assert.equal(roomsOfRent("3LDK+S"), 4);
  assert.equal(roomsOfRent("4LDK+2S"), 6);
  assert.equal(roomsOfRent("2LDK＋S"), 3, "全角の＋も数える");
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
