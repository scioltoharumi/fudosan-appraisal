// tests/ui/cliff.svg.mjs — cliff.html 内の全SVGについて text 要素の見切れ・重なりを機械検査する
// (運用ルール5「SVGを含むページ変更時は、text要素の見切れ・重なりを機械検査してから反映」)。
// npm test には含めない(ブラウザが要るため)。
//   準備: npm i --no-save playwright-core   (ブラウザ本体は環境に同梱: /opt/pw-browsers)
//   実行: node site/build.js && node tests/ui/cliff.svg.mjs [検査対象.html]   → 問題ゼロで exit 0
// 検査内容:
//   1) はみ出し: 各<text>の getBBox が SVG の viewBox に収まる(許容1px)
//   2) 重なり: 同一SVG内の<text>同士の bbox が交差しない(許容: 交差面積が小さい方の8%まで。
//      枠線的な接触・アンチエイリアス誤差を偽陽性にしないため)
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import { existsSync, readdirSync } from "node:fs";

const target = process.argv[2] ?? "site/dist/cliff.html";
const url = pathToFileURL(target).href;
let exe = process.env.CHROMIUM_PATH;
if (!exe) {
  const roots = readdirSync("/opt/pw-browsers").filter((d) => d.startsWith("chromium-"));
  exe = roots.map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find((p) => existsSync(p));
}
const b = await chromium.launch({ executablePath: exe });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await p.goto(url);

const problems = await p.evaluate(() => {
  const out = [];
  const svgs = [...document.querySelectorAll("svg")];
  svgs.forEach((svg, si) => {
    const vb = svg.viewBox.baseVal;
    const label = svg.getAttribute("aria-label") ?? `svg#${si}`;
    const texts = [...svg.querySelectorAll("text")].map((t) => {
      const bb = t.getBBox();
      return { s: (t.textContent ?? "").slice(0, 26), x: bb.x, y: bb.y, w: bb.width, h: bb.height };
    });
    const TOL = 1;
    for (const t of texts) {
      if (t.x < vb.x - TOL || t.y < vb.y - TOL || t.x + t.w > vb.x + vb.width + TOL || t.y + t.h > vb.y + vb.height + TOL) {
        out.push(`[はみ出し] ${label} / "${t.s}" bbox(${t.x.toFixed(0)},${t.y.toFixed(0)},${t.w.toFixed(0)}×${t.h.toFixed(0)}) viewBox ${vb.width}×${vb.height}`);
      }
    }
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i], c = texts[j];
        const ox = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x);
        const oy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
        if (ox > 0 && oy > 0) {
          const inter = ox * oy, minA = Math.min(a.w * a.h, c.w * c.h);
          if (inter > 0.08 * minA) {
            out.push(`[重なり] ${label} / "${a.s}" × "${c.s}" 交差${ox.toFixed(0)}×${oy.toFixed(0)}px`);
          }
        }
      }
    }
  });
  return { n: svgs.length, out };
});

await b.close();
console.log(`検査対象: ${target} / SVG ${problems.n}枚`);
if (problems.out.length) {
  for (const line of problems.out) console.error("✗ " + line);
  process.exit(1);
}
console.log("✓ 全SVGで text の見切れ・重なりなし");
