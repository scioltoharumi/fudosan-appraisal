// tests/screen.test.js — 新着のKOスクリーニング(登録してはいけない物件を人手の前に落とす)
// 2026-08-13: 除外済みレッドゾーン現場の別業者掲載を新着として扱い、YAML作成・査定まで
// 進めてから撤回した事故を受けて追加。事故の型: ハザードは「掲載」ではなく「現場」の属性なので、
// 業者を替えた別番号で再出現し、しかもその掲載には制限事項が書かれていなかった。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../engine/io.js";
import { buildExcludedIndex, matchExcludedSite, scanKO, koScreen, parseDetailAttrs } from "../crawler/screen.mjs";

const EXCLUDED = JSON.parse(readFileSync(join(ROOT, "market", "crawl", "excluded.json"), "utf8"));
const index = buildExcludedIndex(EXCLUDED);
// 事故当日の新着(センチュリー21掲載)。諸元は除外済みの at_1164758926(モリモト2号棟)と同一
const ACCIDENT = { nc: "at_9999999999", district: "西が丘", chome: "2", price_man: 5980, land_m2: 58.53, floor_m2: 93.55 };

test("除外索引: reasonからハザード現場を識別し、unit文字列から面積を復元する", () => {
  const site = index.sites.find((s) => s.key === "at_1164758926");
  assert.ok(site, "除外エントリが索引化されること");
  assert.equal(site.hazard, true, "土砂災害の記述をハザード現場として識別");
  assert.equal(site.land_m2, 58.53, "unit「2号棟(土地58.53/建物93.55)」から土地面積を復元");
  assert.equal(site.floor_m2, 93.55);
  assert.equal(site.chome, "2");
});

test("事故の再現: 別業者・別番号でも諸元一致なら取得ゼロでKO4ブロックされる", () => {
  const hit = matchExcludedSite(ACCIDENT, index);
  assert.equal(hit?.level, "exact", "諸元一致は同一戸として確定すること");
  assert.equal(hit.by, "specs", "媒体番号ではなく諸元で照合したこと");
  // scan=null(詳細ページを取りに行っていない)状態で判定が確定することが本質
  const ko = koScreen({ unit: ACCIDENT, siteHit: hit, scan: null });
  assert.equal(ko.verdict, "block");
  assert.ok(ko.codes.includes("KO4_hazard"), "ハザード現場としてKO4が立つこと");
  assert.match(ko.reasons[0], /除外済み現場と諸元一致/);
});

test("価格が動いても現場の同一性判定は変わらない(値下げ後の再掲を拾えること)", () => {
  const hit = matchExcludedSite({ ...ACCIDENT, price_man: 5480 }, index);
  assert.equal(hit?.level, "exact", "価格は同一戸の判定条件に入れない");
});

test("同一開発の別戸(近接諸元)はブロックせず『要判断』に留める", () => {
  // 土地が1m²違う=同じ現場の別区画の可能性。自動登録はしないが、除外と断定もしない
  const hit = matchExcludedSite({ ...ACCIDENT, land_m2: 59.5, floor_m2: 97.0 }, index);
  assert.equal(hit?.level, "near");
  const ko = koScreen({ unit: ACCIDENT, siteHit: hit, scan: { flags: [], attrs: { land_m2: 59.5, floor_m2: 97.0 }, hazard_media: "athome" } });
  assert.equal(ko.verdict, "suspect", "近接は人の確認待ちにする(自動登録も自動除外もしない)");
  assert.match(ko.reasons[0], /同一現場の別戸/);
});

test("別丁目・別地区の同面積物件を巻き込まない", () => {
  assert.equal(matchExcludedSite({ ...ACCIDENT, chome: "3" }, index), null, "丁目が違えば別現場");
  assert.equal(matchExcludedSite({ ...ACCIDENT, district: "志茂" }, index), null, "地区が違えば別現場");
});

test("KOスキャン: 掲載に明記された重大ハザード・借地権・再建築不可・告知事項を検出する", () => {
  const hz = scanKO("<div>その他制限事項: 準防火地域、第二種高度地区、土砂災害特別警戒区域内</div>", "suumo");
  assert.ok(hz.flags.some((f) => f.code === "KO4_hazard"));
  const lh = scanKO("<dt>土地権利</dt><dd>借地権</dd>", "suumo");
  assert.ok(lh.flags.some((f) => f.code === "KO2_ownership"));
  const nr = scanKO("<div>備考: 再建築不可</div>", "suumo");
  assert.ok(nr.flags.some((f) => f.code === "KO1_no_rebuild"));
  const dc = scanKO("<div>告知事項あり</div>", "suumo");
  assert.ok(dc.flags.some((f) => f.code === "KO3_disclosure"));
});

test("KOスキャン: 空欄ラベルだけで誤検出しない(athomeは値が「－」でもラベルが常にある)", () => {
  // 実際のathome詳細ページに常設されるラベル群。これで旗が立つと毎日全件が誤ブロックされる
  const html = `<dt>借地期間・地代</dt><dd>（月額）－</dd><dt>告知事項</dt><dd>－</dd>
    <dt>土地権利</dt><dd>所有権</dd><dt>用途地域</dt><dd>１種中高</dd><dt>セットバック</dt><dd>－</dd>`;
  const s = scanKO(html, "athome");
  assert.equal(s.flags.length, 0, `ラベルのみで旗を立てないこと(検出: ${JSON.stringify(s.flags)})`);
  assert.equal(s.attrs.ownership, "所有権");
});

test("詳細ページの徒歩分は交通欄から取る(ページ下部のおすすめ枠を拾わない)", () => {
  const html = `<div>交通 ＪＲ京浜東北線 / 東十条駅 徒歩17分 都営三田線 / 板橋本町駅 徒歩16分
    ＪＲ埼京線 / 十条駅 徒歩18分</div>
    <section>この物件を見た人はこちらも見ています 「上中里」駅 徒歩3分 / 9,800万円</section>`;
  assert.equal(parseDetailAttrs(html, "athome").walk_min, 16, "交通欄の最短(16分)を採ること");
});

test("事故当日の実ページで諸元を復元できる(一覧の徒歩4分に対し詳細は16分)", () => {
  // 2026-08-13 at_1106854114 の実HTMLから抜いた最小再現。一覧値を信じると徒歩フィルタが機能しない
  const html = `<div>所在地 東京都北区西が丘２丁目</div>
    <div>交通 ＪＲ京浜東北線 / 東十条駅 徒歩17分 都営三田線 / 板橋本町駅 徒歩16分 ＪＲ埼京線 / 十条駅 徒歩18分</div>
    <dt>間取り</dt><dd>３ＳＬＤＫ</dd><dt>建物面積</dt><dd>93.55m²</dd>
    <dt>土地面積</dt><dd>58.53m²（公簿）</dd><dt>私道負担面積</dt><dd>なし</dd>
    <dt>築年月</dt><dd>2026年4月</dd><dt>土地権利</dt><dd>所有権</dd>
    <dt>用途地域</dt><dd>１種中高</dd><dt>接道状況</dt><dd>南 4.2m 公道</dd>
    <dt>建ぺい率</dt><dd>60%</dd><dt>容積率</dt><dd>150%</dd><dt>情報公開日</dt><dd>2026年7月30日</dd>`;
  const a = parseDetailAttrs(html, "athome");
  assert.equal(a.walk_min, 16, "一覧の4分ではなく詳細の最短16分");
  assert.equal(a.land_m2, 58.53);
  assert.equal(a.floor_m2, 93.55);
  assert.equal(a.layout, "3SLDK", "全角間取りを半角化して取ること");
  assert.equal(a.built, "2026-04");
  assert.equal(a.ownership, "所有権");
  assert.equal(a.bcr, 60);
  assert.equal(a.far, 150);
  assert.equal(a.info_date, "2026-07-30", "price_historyのdateに使う情報提供日");
  // この掲載には土砂災害の記載が一切ない=掲載スキャンだけでは落とせない。現場照合が要る
  assert.equal(scanKO(html, "athome").flags.length, 0);
  assert.equal(matchExcludedSite({ district: "西が丘", chome: "2", land_m2: a.land_m2, floor_m2: a.floor_m2 }, index)?.level,
    "exact", "掲載が黙っていても除外済み現場との諸元照合で捕まること");
});

test("SUUMO形式(ラベル ヒント 値)を読み、広告文の同名語には反応しない", () => {
  // 実ページ(nc_21036139)の並び。「※本物件の間取りは2LDK+2Sです」は営業コピーで、
  // ラベル直後アンカーでないと間取りをこちらから拾ってしまう
  const html = `<div>※本物件の間取りは2LDK+2Sです ご希望の住まい探しをお手伝いします</div>
    <div>交通 ＪＲ京浜東北線「赤羽」歩13分 ＪＲ埼京線「赤羽」歩13分 都営三田線「本蓮沼」歩15分</div>
    <div>価格 ヒント 6990万円 間取り ヒント 2LDK+S（納戸） 土地面積 ヒント 66.37m 2 建物面積 ヒント 87.98m 2
    私道負担・道路 ヒント 無、南西8ｍ幅（接道幅6.8ｍ） 完成時期（築年月） ヒント 2010年7月
    土地の権利形態 ヒント 所有権 建ぺい率・容積率 ヒント 60％・150％ 用途地域 ヒント １種中高 その他制限事項 -</div>`;
  const a = parseDetailAttrs(html, "suumo");
  assert.equal(a.layout, "2LDK+S", "掲載の間取り欄の値(広告文の2LDK+2Sではない)");
  assert.equal(a.land_m2, 66.37);
  assert.equal(a.floor_m2, 87.98);
  assert.equal(a.built, "2010-07");
  assert.equal(a.walk_min, 13);
  assert.equal(a.ownership, "所有権");
  assert.equal(a.bcr, 60, "「60％・150％」の1欄表記を分解すること");
  assert.equal(a.far, 150);
  assert.equal(a.zoning, "1種中高", "全角「１種中高」を半角化");
  assert.equal(a.road, "無、南西8m幅（接道幅6.8m）", "次の欄のラベルを巻き込まないこと");
  // その他制限事項が「-」の物件。SUUMO単独では無害に見えるという既知の限界そのもの
  assert.equal(scanKO(html, "suumo").flags.length, 0);
});

test("他物件の広告文をKO信号として拾わない(誤爆すると全件が毎日ブロックされる)", () => {
  // athome詳細ページの埋め込みJSONには他物件のおすすめ枠が入る。2026-08-13の実ページで
  // 「■志村三丁目駅徒歩14分■再建築不可」を拾ってKO1が誤爆した回帰
  const html = `<dt>土地権利</dt><dd>所有権</dd><dt>告知事項</dt><dd>－</dd>
    <script>{"athomeBiko":["■東十条駅徒歩17分","■2026年4月新築"],
    "recommend":[{"biko":"■志村三丁目駅徒歩14分■再建築不可■3LDK■空室","price":3150}]}</script>`;
  const s = scanKO(html, "athome");
  assert.equal(s.flags.length, 0, `対象物件の欄だけを見ること(検出: ${JSON.stringify(s.flags.map((f) => f.code))})`);
});

test("空欄(－)はnullで返す(YAMLに媒体の空値表記を書き込ませない)", () => {
  const a = parseDetailAttrs(`<dt>接道状況</dt><dd>－</dd><dt>建ぺい率</dt><dd>60%</dd>`, "athome");
  assert.equal(a.road, null, "ラベル剥がし後に「－」だけ残るものはnull");
  assert.equal(a.bcr, 60);
});

test("必須項目が詳細から確定できない掲載はKO5で止める(誤登録防止)", () => {
  const ko = koScreen({ unit: { price_man: 6000, district: "赤羽西", chome: "4" }, siteHit: null,
    scan: { flags: [], attrs: { land_m2: null, floor_m2: 93.5 }, hazard_media: "suumo" } });
  assert.equal(ko.verdict, "block");
  assert.ok(ko.codes.includes("KO5_incomplete"));
});

test("KO非該当は pass。SUUMO単独確認には限界注記が付く", () => {
  const attrs = { land_m2: 60.0, floor_m2: 95.0, walk_min: 10 };
  const clean = koScreen({ unit: { price_man: 6500, district: "赤羽西", chome: "4" }, siteHit: null,
    scan: { flags: [], attrs, hazard_media: "athome" } });
  assert.equal(clean.verdict, "pass");
  assert.equal(clean.caveat, null, "athome確認済みなら注記なし");
  const suumoOnly = koScreen({ unit: { price_man: 6500, district: "赤羽西", chome: "4" }, siteHit: null,
    scan: { flags: [], attrs, hazard_media: "suumo" } });
  assert.equal(suumoOnly.verdict, "pass");
  assert.match(suumoOnly.caveat, /athome掲載も確認/, "SUUMOの制限事項は空欄でも該当しうる旨を残す");
});

test("詳細未取得(予算切れ)は pass にせず unknown として開示する", () => {
  const ko = koScreen({ unit: { price_man: 6500, district: "赤羽西", chome: "4" }, siteHit: null, scan: null });
  assert.equal(ko.verdict, "unknown");
  assert.ok(ko.codes.includes("NO_DETAIL"));
});
