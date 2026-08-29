// tests/site-markup.test.js — 生成HTMLに Markdown の記法が生のまま漏れていないかを検査する
// 経緯(2026-08-29): 物件YAMLの自由文(caveats / source / hazard_check.note / 較正の根拠文)は
// Markdown風の **強調** で書かれてきたが、描画側は esc() だけを通していたため、
// **230箇所が生の ** として全物件ページに表示されていた**。layout.js の escRich() で解消した。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { escRich, esc } from "../site/templates/layout.js";

const DIST = new URL("../site/dist", import.meta.url).pathname;

function htmlFiles(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) htmlFiles(p, out);
    else if (e.endsWith(".html")) out.push(p);
  }
  return out;
}
// <style> と <script> の中は利用者に見えないので除外する(CSSコメントに ** を使っている箇所がある)
const visibleText = (s) =>
  s.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<script>[\s\S]*?<\/script>/g, "");

test("escRich: エスケープを先に通してからマーカーを変換する(HTML注入されない)", () => {
  assert.equal(escRich("**強調**"), "<b>強調</b>");
  assert.equal(escRich("前**中**後"), "前<b>中</b>後");
  assert.equal(escRich("**A**と**B**"), "<b>A</b>と<b>B</b>");
  // 変換より先にエスケープされること。ここが逆だと任意のHTMLを流し込める
  assert.equal(escRich("**<script>x</script>**"), "<b>&lt;script&gt;x&lt;/script&gt;</b>");
  assert.equal(escRich("<b>生タグ</b>"), "&lt;b&gt;生タグ&lt;/b&gt;");
  assert.equal(escRich("**<img src=x onerror=alert(1)>**"),
    "<b>&lt;img src=x onerror=alert(1)&gt;</b>");
  // 対応しないもの: 空・改行跨ぎ・片側だけ
  assert.equal(escRich("****"), "****");
  assert.equal(escRich("**未閉じ"), "**未閉じ");
  assert.equal(escRich("**改行を\n跨ぐ**"), "**改行を\n跨ぐ**");
  // マーカーが無ければ esc() と完全に同じ
  for (const s of ["ふつうの文", "a<b>&\"'", "", null, undefined]) {
    assert.equal(escRich(s), esc(s), `マーカー無しで esc() と差が出た: ${JSON.stringify(s)}`);
  }
});

test("生成HTMLの本文に Markdown の ** が生のまま残っていない", () => {
  const files = htmlFiles(DIST);
  assert.ok(files.length >= 20, `dist/ が生成されている前提(node site/build.js): ${files.length}件`);
  const leaks = [];
  for (const f of files) {
    const body = visibleText(readFileSync(f, "utf8"));
    if (body.includes("**")) {
      const at = body.indexOf("**");
      leaks.push(`${f.replace(DIST, "")}: …${body.slice(Math.max(0, at - 40), at + 40).replace(/\s+/g, " ")}…`);
    }
  }
  assert.equal(leaks.length, 0, `Markdownの ** が本文に漏れている:\n  ${leaks.join("\n  ")}`);
});
