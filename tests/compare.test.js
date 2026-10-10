// tests/compare.test.js — 本命の立ち位置(compare.html)の回帰ガード(2026-10-10新設)
// スナップショットの完全性・判定しない旨と参考値の開示・SVGの体裁を固定する
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderCompare, KEY_IDS, bandRows } from "../site/templates/compare.js";

const snapshot = JSON.parse(readFileSync(new URL("../market/compare-snapshot-2026-10-10.json", import.meta.url), "utf8"));
const html = renderCompare({ snapshot });

test("compare: スナップショットに本命と主要点が揃い、各行が必須項目を持つ", () => {
  for (const id of KEY_IDS) assert.ok(snapshot.rows.find((r) => r.id === id), `${id} がある`);
  for (const r of snapshot.rows) {
    for (const k of ["price", "built", "floor", "land", "walk", "flood", "fair", "gap"]) assert.ok(r[k] !== undefined && r[k] !== null, `${r.id}.${k}`);
    assert.ok(["upland", "shallow", "deep", "unknown"].includes(r.flood), `${r.id} の浸水区分`);
    assert.ok(["ledger", "listing"].includes(r.src));
  }
  assert.throws(() => renderCompare({ snapshot: { ...snapshot, rows: snapshot.rows.filter((r) => r.id !== "kamiya2-adcast-a") } }), /本命/);
});

test("compare: 時点・台帳外の参考値・代表点・判定ではない旨を1行で開示している", () => {
  // 2026-10-10ユーザー指示「注釈は全部取って、書くなら※10/10時点とか。極限まで文字削って」で開示は脚注1行に集約した
  assert.ok(html.includes("※10/10時点"));
  assert.ok(html.includes("台帳外(参考値)"));
  assert.ok(html.includes("丁目の代表点"));
  assert.ok(html.includes("判定ではない"));
});

test("compare: 神谷2-24の確認事項(風呂1616・ロフト・別途費用)と、延床が居住部分である旨を出す", () => {
  // 2026-10-10 参考プラン図で延床を住宅部分83.10に置き換えた。他物件は掲載の延床のままなので、その非対称を脚注と表に出す
  const k = snapshot.rows.find((r) => r.id === "kamiya2-adcast-a");
  assert.equal(k.floor, 83.1);
  assert.equal(k.layout, "2LDK+S");
  assert.ok(html.includes("決める前に"));
  assert.ok(html.includes("1316→1616"));
  assert.ok(html.includes("ロフト5.1帖"));
  assert.ok(html.includes("約91m²相当"));
  assert.ok(html.includes("7.9帖の2室化"));
  assert.ok(html.includes('href="property/kamiya2-adcast-a.html"'));   // 聞くこと15項目の全文への導線   // ロフトを収納に使ったときの体感(延床には入れない)
  assert.ok(html.includes("居住部分"));
  assert.ok(html.includes("<th>間取り</th>"));
});

test("compare: 同じ価格帯の一覧は本命を先頭に帯内の全物件を条件表と同じ列で並べる", () => {
  const rs = bandRows(snapshot.rows);
  assert.equal(rs[0].id, "kamiya2-adcast-a");
  const inBand = snapshot.rows.filter((r) => r.price >= 5900 && r.price <= 7100);
  assert.equal(rs.length, inBand.length);
  for (let i = 2; i < rs.length; i++) assert.ok(rs[i - 1].gap <= rs[i].gap, "査定との差の小さい順");
  assert.ok(html.includes("同じ価格帯の一覧"));
  // 結論⑤の根拠: 帯内の新築(2025年以降)は本命を除き全て80.1m²未満で、本命より広いのは2016年以前の築だけ
  const k = rs[0];
  for (const r of rs.slice(1)) {
    if (r.newish) assert.ok(r.floor < k.floor, `${r.label}: 帯内の新築が本命より広い`);
    if (r.floor > k.floor) assert.ok(Number(r.built.slice(0, 4)) <= 2016, `${r.label}: 本命より広いのに築10年以内`);
  }
  assert.ok(html.includes("他の8件は全て70〜80m²"));
  assert.equal(rs.slice(1).filter((r) => r.newish).length, 8);
  assert.equal((html.match(/<th>査定との差<\/th>/g) ?? []).length, 2, "条件表と価格帯の表の2つ");
});

test("compare: SVGは2枚で role/aria-label を持ち、rotate(-90) を使わない", () => {
  const svgs = html.match(/<svg [^>]*>/g) ?? [];
  assert.equal(svgs.length, 2);
  for (const s of svgs) { assert.ok(s.includes('role="img"')); assert.ok(s.includes("aria-label")); }
  assert.ok(!html.includes("rotate(-90"));
});
