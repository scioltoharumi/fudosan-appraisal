// tests/rent-crawl.test.js — 賃貸クローラの純関数の契約テスト(ネットワークには出ない)。
// 2026-08-19の監査で「賃貸クローラの純関数はテストがゼロ」「rent-pool.mjs は import しただけで
// 実クロールが走りCSVを上書きしうる」と指摘されたのを受けて新設した。
import test from "node:test";
import assert from "node:assert/strict";
import { statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../engine/io.js";
import { POOL_COLUMNS, poolRow, toCsv, detailUrlsFrom, dedupeRows, propertyKey } from "../crawler/rent-pool.mjs";
import { RENT_DELISTED_RE, detailIdsFrom, detectGone, contractConflict } from "../crawler/rent-daily.mjs";
import { parseCsv, loadRentPool } from "../engine/rent.js";
import { parseRentDetail, contractTypeOf } from "../crawler/rent-screen.mjs";

const CSV = join(ROOT, "market", "rent-listings.csv");

test("rent-pool を import してもクロールが走らずCSVを上書きしない", () => {
  // このファイルの先頭で crawler/rent-pool.mjs を import 済み。
  // main() が走っていたら数分かかり CSV の mtime が変わる
  const before = statSync(CSV).mtimeMs;
  assert.ok(Number.isFinite(before));
  assert.equal(typeof poolRow, "function", "import 自体は成功している");
  assert.equal(statSync(CSV).mtimeMs, before, "import で market/rent-listings.csv が書き換わってはいけない");
});

test("POOL_COLUMNS → CSV → loadRentPool の往復で値が保たれる(列名の契約)", () => {
  const detail = {
    rent_man: 21, kanri_man: 0.5, total_man: 21.5, area_m2: 74.26, layout: "3LDK", rooms: 3, has_ldk: true,
    built_year: 2011, built_month: 8, walk_min: 5, walks: [{ line: "ＪＲ京浜東北線", station: "赤羽駅", walk_min: 13 }],
    structure: "木造", contract: { type: "futsu", years: 2 }, shiki_months: 1, rei_months: 1,
    shikibiki_raw: "10万円", madori_detail: "洋6.2 洋6 洋5 LDK14.0", district: "赤羽", chome: "3",
    parking: "付無料", toilet2: true, building_type: "一戸建て",
  };
  const row = poolRow(detail, "jnc_TEST", "2026-08-19");
  for (const c of POOL_COLUMNS) assert.ok(c in row, `poolRow に列 ${c} が無い`);
  const parsed = parseCsv(toCsv([row]));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].total_man, "21.5");
  assert.equal(parsed[0].area_m2, "74.26");
  assert.equal(parsed[0].toilet2, "1");
  assert.equal(parsed[0].shikibiki_raw, "10万円");
  assert.equal(parsed[0].media, "suumo");
  assert.equal(parsed[0].listing_count, "1");
});

test("実CSVの列が POOL_COLUMNS と一致している(列名を変えたら落ちる)", () => {
  const header = readFileSync(CSV, "utf8").split("\n")[0].replace(/^\ufeff/, "").split(",");
  assert.deepEqual(header, POOL_COLUMNS,
    "market/rent-listings.csv のヘッダが crawler/rent-pool.mjs の POOL_COLUMNS と違う。" +
    "片方だけ変えると loadRentPool が黙って値を落とす(最悪プールが空になりモデルが立たなくなる)");
});

test("名寄せ: 同一諸元の掲載は1物件に畳まれ、掲載数と徒歩の最小値が残る", () => {
  const mk = (id, walk) => ({ source_id: id, media: "suumo", district: "赤羽", chome: "3", area_m2: 74.26,
    total_man: 21, built_year: 2011, layout: "3LDK", walk_min: walk, building_type: "一戸建て", listing_count: 1 });
  const { rows, conflicts } = dedupeRows([mk("a", 6), mk("b", 5), mk("c", 5)]);
  assert.equal(rows.length, 1, "同一物件は1行になる");
  assert.equal(rows[0].listing_count, 3, "元の掲載数を残す");
  assert.equal(rows[0].walk_min, 5, "徒歩は最小値");
  assert.ok(conflicts.some((c) => c.field === "walk_min"), "徒歩が割れたことを開示する");
});

test("名寄せ: 諸元が違えば別物件のまま残る(同一カセットの別ユニットを消さない)", () => {
  const base = { media: "suumo", district: "浮間", chome: "3", total_man: 25.5, built_year: 2023,
    layout: "3LDK", walk_min: 9, building_type: "一戸建て", listing_count: 1 };
  const { rows } = dedupeRows([
    { ...base, source_id: "a", area_m2: 72.33 },
    { ...base, source_id: "b", area_m2: 83.21 },
  ]);
  assert.equal(rows.length, 2, "面積が違うユニットを同一物件と誤認してはいけない");
});

test("名寄せ: 建物種別が割れたら「混在」として人の判断へ回す", () => {
  const base = { media: "suumo", district: "王子", chome: "6", area_m2: 69.16, total_man: 24,
    built_year: 2021, layout: "3DK", walk_min: 10, listing_count: 1 };
  const { rows, conflicts } = dedupeRows([
    { ...base, source_id: "a", building_type: "一戸建て" },
    { ...base, source_id: "b", building_type: "テラスハウス" },
  ]);
  assert.equal(rows[0].building_type, "混在");
  assert.ok(conflicts.some((c) => c.field === "building_type"));
});

test("propertyKey は媒体・店舗が違っても同じ物件で一致する", () => {
  const a = { media: "suumo", source_id: "x", district: "赤羽", chome: "3", area_m2: 74.26, total_man: 21, built_year: 2011, layout: "3LDK" };
  const b = { ...a, media: "athome", source_id: "y" };
  assert.equal(propertyKey(a), propertyKey(b));
});

test("一覧HTMLから掲載IDを抽出できる(2実装が同じ集合を返す)", () => {
  const html = '<a href="/chintai/jnc_000108003951/?bc=1">x</a><a href="/chintai/jnc_000107754605/">y</a>';
  assert.deepEqual(detailIdsFrom(html).sort(), ["jnc_000107754605", "jnc_000108003951"]);
  assert.deepEqual(detailUrlsFrom(html).map((u) => u.match(/jnc_\d+/)[0]).sort(),
    ["jnc_000107754605", "jnc_000108003951"]);
});

// ---- ここが本丸: 掲載終了の判定 ----
test("掲載終了の正規表現は生きている掲載のフッタに誤爆しない", () => {
  // SUUMOの全ページ共通フッタ。「成約済」の語を正規表現に入れると生きている掲載66/66に誤爆した
  const footer = "掲載情報に「事実と異なる点や誤解を招く表現がある」「成約済にもかかわらず掲載されている」場合はご連絡ください";
  assert.equal(RENT_DELISTED_RE.test(footer), false,
    "生きている掲載のフッタで掲載終了と判定してはいけない(「成約済」を語彙に戻すと落ちる)");
});

test("掲載終了の正規表現は実際の掲載終了ページに一致する", () => {
  for (const s of ["※このページは過去の掲載情報を元に作成しています。",
    "この物件は掲載を終了しました", "現在掲載されておりません"]) {
    assert.ok(RENT_DELISTED_RE.test(s), `掲載終了と判定できていない: ${s}`);
  }
});

// ---- 一覧から消えた掲載の検出 ----
test("消えた掲載: 台帳へ登録済みの物件を「消えた」と誤報しない", () => {
  // 誤報の原因は判定母集合の取り違え。listedToday には台帳・除外で絞る**前**の生IDを渡す
  const seen = { jnc_A: { last_seen: "2026-08-18", rent_man: 21, address: "北区赤羽3" } };
  const listedToday = new Set(["jnc_A"]);          // 一覧には今日も載っている
  assert.deepEqual(detectGone(seen, listedToday, "2026-08-19"), []);
});

test("消えた掲載: 本当に一覧から消えたものは報告する", () => {
  const seen = { jnc_A: { last_seen: "2026-08-18", rent_man: 21, address: "北区赤羽3" } };
  const out = detectGone(seen, new Set([]), "2026-08-19");
  assert.equal(out.length, 1);
  assert.equal(out[0].event, "gone_from_list");
  assert.equal(seen.jnc_A.gone_since, "2026-08-19", "再報告しないよう印を残す");
});

test("消えた掲載: 一覧を最後まで走査できなかった回は判定しない", () => {
  const seen = { jnc_A: { last_seen: "2026-08-18" }, jnc_B: { last_seen: "2026-08-18" } };
  assert.deepEqual(detectGone(seen, new Set([]), "2026-08-19", { listComplete: false }), [],
    "部分集合で判定すると未走査ページの掲載が全部『消えた』になり、印は解除されないので偽陽性が焼き付く");
  assert.equal(seen.jnc_A.gone_since, undefined);
});

// ---- 台帳と掲載の食い違い ----
test("契約の食い違い: 種別だけでなく年数の変化も検出する", () => {
  const teiki3 = { contract_type: "teiki", contract_years: 3 };
  assert.equal(contractConflict(teiki3, contractTypeOf("定期借家 3年")), null);
  assert.match(contractConflict(teiki3, contractTypeOf("定期借家 2年")), /契約年数/);
  assert.match(contractConflict(teiki3, contractTypeOf("普通借家 2年")), /契約種別/);
  // 期日表記に変わって年数が読めなくなった場合も知らせる(KOの根拠が動く)
  assert.match(contractConflict(teiki3, contractTypeOf("定期借家 西暦2030年3月まで")), /読めなくなった/);
});

// ---- 詳細ページかどうかの判定 ----
test("詳細ページでないHTMLは is_detail=false になり、圏外判定に使わせない", () => {
  const notDetail = "<div>賃貸の検索結果</div><div>駅徒歩</div><div>ＪＲ京浜東北線/赤羽駅 歩20分</div>";
  const d = parseRentDetail(notDetail);
  assert.equal(d.is_detail, false,
    "掲載終了の転送先から徒歩分を拾って『徒歩20分で圏外』と恒久除外した事故がある");
});

test("実CSVが名寄せ済みである(同一諸元の行が2つ以上あってはいけない)", () => {
  const pool = loadRentPool();
  const seen = new Map();
  for (const d of pool) {
    const k = [d.district, d.chome, d.area_m2, d.total_man, d.built_year, d.layout].join("|");
    assert.ok(!seen.has(k), `同一諸元の行が重複している: ${k} (${seen.get(k)} と ${d.source_id})`);
    seen.set(k, d.source_id);
  }
  assert.ok(pool.some((d) => (d.listing_count ?? 1) > 1),
    "listing_count が全部1。名寄せが効いていないか、列が失われている");
});
