// tests/compare.test.js — 本命の立ち位置(compare.html)の回帰ガード(2026-10-10新設)
// スナップショットの完全性・判定しない旨と参考値の開示・SVGの体裁を固定する
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderCompare, KEY_IDS } from "../site/templates/compare.js";

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

test("compare: 判定しない旨・相対比較・参考値・時点の開示がある", () => {
  assert.ok(html.includes("このページは判定をしません"));
  assert.ok(html.includes("相対比較"));
  assert.ok(html.includes("台帳外(*印)の数値は参考値"));
  assert.ok(html.includes(snapshot.as_of));
  assert.ok(html.includes("丁目の代表点"), "浸水が代表点の値である限界");
});

test("compare: SVGは2枚で role/aria-label を持ち、rotate(-90) を使わない", () => {
  const svgs = html.match(/<svg [^>]*>/g) ?? [];
  assert.equal(svgs.length, 2);
  for (const s of svgs) { assert.ok(s.includes('role="img"')); assert.ok(s.includes("aria-label")); }
  assert.ok(!html.includes("rotate(-90"));
});
