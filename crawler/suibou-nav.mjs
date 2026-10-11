// crawler/suibou-nav.mjs — 国交省「浸水ナビ」(地点別浸水シミュレーション検索システム)から、
// 指定地点に水が届く破堤点ごとの最大浸水深を取り、河川・規模(計画規模/想定最大規模)別に集計したスナップショットを書く。
//
// 2026-10-11 新設(神谷2-24-11 の外水氾濫のフェルミ推定のため)。ハザードマップの「3.0〜5.0m」は全破堤点の最大包絡で、
// 「どの破堤点ならこの地点が何mか」は浸水ナビにしか無い。engine/flood.js がこの出力を入力にする。
//
// 使い方: node crawler/suibou-nav.mjs <lat> <lon> [出力JSON] [--rivers=荒川,新河岸川]
//   例:   node crawler/suibou-nav.mjs 35.77103 139.72794 market/flood-fermi-kamiya2-2026-10-11.json
// API(サイトのJSが呼んでいるもの。公式に文書化されたAPIではないので、形が変わったら落ちる):
//   api/search/SearchBreakPointByPosition?lat&lon&isDepthMax&isArrive&isContinue → 地点に届く破堤点IDと深さ
//   api/manage/GetRiverSelectMenu → 河川×規模の一覧(csvid)
//   api/search/SearchBreakPointByCsv?csvid → その河川×規模の破堤点一覧(位置・名称)
// 相手サイトへの礼儀: 取得は河川×規模ごとに1回、間隔は http.mjs の 2.2秒。都の浸水予想区域図(内水)は別ソース(東京都オープンデータ CSV)。

import { writeFileSync } from "node:fs";
import { UA, SLEEP_MS, sleep } from "./http.mjs";

const BASE = "https://suiboumap.gsi.go.jp/ShinsuiMap/";

// curl(http.mjs)はこのサイトのTLS(レガシー再ネゴシエーション)で落ちるため Node の fetch を使う。間隔は http.mjs と同じ
let lastAt = 0;
async function getJson(path) {
  const wait = lastAt + SLEEP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastAt = Date.now();
  const r = await fetch(BASE + path, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}`);
  return r.json();
}

// 純関数: 地点の破堤点別深さ(depthList)と、河川×規模ごとの破堤点一覧(lists: {key:{name, bp:[...]}})を突き合わせる
export function summarize(depthList, lists, site) {
  const dep = new Map(depthList.map((x) => [x.BreakPointID, Number(x.Depth)]));
  const groups = {};
  const seen = new Set();
  for (const [key, L] of Object.entries(lists)) {
    const rows = [];
    let total = 0;
    for (const ws of L.bp ?? []) {
      for (const b of ws.BPList ?? []) {
        total++;
        if (!dep.has(b.ID)) continue;
        seen.add(b.ID);
        const dist = Math.hypot((b.BPLat - site.lat) * 111.0, (b.BPLon - site.lon) * 90.5);
        rows.push({ id: b.ID, location: String(b.BPLocation ?? "").trim(), lat: b.BPLat, lon: b.BPLon, dist_km: Math.round(dist * 10) / 10, depth_m: dep.get(b.ID) });
      }
    }
    rows.sort((a, b) => b.depth_m - a.depth_m);
    groups[key] = { name: L.name, breakpoints_total: total, reaching_site: rows.length, rows };
  }
  const unclassified = [...dep.keys()].filter((id) => !seen.has(id));
  return { groups, unclassified: unclassified.length, depth_max_m: Math.max(0, ...dep.values()) };
}

function groupKey(r) {
  const scale = r.scode === "1" ? "l1" : "l2";
  return `${r.oname}|${r.rname}|${scale}`;
}

export async function fetchSnapshot(lat, lon, { rivers = ["荒川", "新河岸川", "新河岸川放水路", "隅田川"] } = {}) {
  const pos = await getJson(`api/search/SearchBreakPointByPosition?lat=${lat}&lon=${lon}&isDepthMax=true&isArrive=true&isContinue=true`);
  const depthList = pos?.bpInfoList?.DepthList ?? [];
  const menu = await getJson("api/manage/GetRiverSelectMenu");
  const targets = menu.filter((r) => rivers.includes(r.rname) && /関東|埼玉県|東京都/.test(r.pname + r.oname));
  const lists = {};
  for (const r of targets) {
    const key = groupKey(r);
    const d = await getJson(`api/search/SearchBreakPointByCsv?csvid=${r.csvid}`);
    lists[key] = { name: `${r.oname}・${r.rname}・${r.sname}`, bp: d.bp ?? [] };
  }
  const s = summarize(depthList, lists, { lat, lon });
  return {
    created: new Date().toISOString().slice(0, 10),
    point: { lat, lon },
    suibou_nav: { source: "国交省 浸水ナビ(地点別浸水シミュレーション検索システム) api/search/SearchBreakPointByPosition + SearchBreakPointByCsv", fetched: new Date().toISOString().slice(0, 10), depth_max_m: s.depth_max_m, unclassified: s.unclassified, groups: s.groups },
  };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ""));
if (isMain) {
  const [lat, lon, out] = process.argv.slice(2);
  if (!lat || !lon) { console.error("usage: node crawler/suibou-nav.mjs <lat> <lon> [out.json]"); process.exit(1); }
  const snap = await fetchSnapshot(Number(lat), Number(lon));
  for (const [k, g] of Object.entries(snap.suibou_nav.groups)) {
    const ds = g.rows.map((r) => r.depth_m);
    console.log(`${g.name}: 破堤点${g.breakpoints_total}件 / 地点に届く${g.reaching_site}件 / 最大${ds.length ? Math.max(...ds) : "-"}m`);
  }
  if (out) { writeFileSync(out, JSON.stringify(snap, null, 1), "utf8"); console.log("wrote", out); }
}
