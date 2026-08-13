// site/templates/map.js — ハザードマップ対照ページ。
//
// 目的(2026-08-13ユーザー要望): 台帳の各地区がハザードマップ上のどこに立っているかを1枚で見せ、
// 「あれ、志茂って大丈夫?」と人が自分で気づけるようにする。数字の表だけでは、荒川低地と武蔵野台地の
// 境目に台帳が跨っていることに気づけなかった(志茂1・志茂3が浸水想定3〜5m/5〜10mのまま台帳に残った)。
//
// 描画元は market/hazard-grid.json(crawler/hazard-grid.mjs が国土地理院タイルから焼いた25mラスタ)。
// ビルド時にネットワークへ出ない設計。地区の代表点も同JSONの geocode 辞書から引く。

import { esc, layout } from "./layout.js";

const M_PER_DEG_LAT = 111132;

// ---- 共通: グリッド→SVG矩形(横方向の同値ランをまとめて要素数を落とす) ----
function rasterRects(ny, nx, classOf, fillOf, px) {
  const out = [];
  for (let j = 0; j < ny; j++) {
    let i = 0;
    while (i < nx) {
      const c = classOf(j, i);
      if (c == null) { i++; continue; }
      let k = i + 1;
      while (k < nx && classOf(j, k) === c) k++;
      out.push(`<rect x="${(i * px).toFixed(1)}" y="${(j * px).toFixed(1)}" width="${((k - i) * px).toFixed(1)}" height="${px.toFixed(1)}" fill="${fillOf(c)}"/>`);
      i = k;
    }
  }
  return out.join("");
}

// ---- 地区マーカー(代表点+引き出し線+ラベル) ----
// ラベルは地図の東半分なら左側、西半分なら右側へ出す。はみ出しは端でクランプする
function markers(points, g, px, W, H) {
  const el = [];
  for (const p of points) {
    const x = ((p.lon - g.bbox.lon0) / (g.bbox.lon1 - g.bbox.lon0)) * g.nx * px;
    const y = ((g.bbox.lat1 - p.lat) / (g.bbox.lat1 - g.bbox.lat0)) * g.ny * px;
    if (x < 0 || x > W || y < 0 || y > H) continue;
    const right = x < W * 0.55;
    const lx = right ? x + 13 : x - 13;
    const anchor = right ? "start" : "end";
    const color = p.dropped ? "#C93A2B" : "#16232E";
    if (p.dropped) {
      el.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="#FFFFFF" stroke="${color}" stroke-width="2.2"/>`);
      el.push(`<path d="M ${(x - 3.2).toFixed(1)} ${(y - 3.2).toFixed(1)} L ${(x + 3.2).toFixed(1)} ${(y + 3.2).toFixed(1)} M ${(x + 3.2).toFixed(1)} ${(y - 3.2).toFixed(1)} L ${(x - 3.2).toFixed(1)} ${(y + 3.2).toFixed(1)}" stroke="${color}" stroke-width="1.8"/>`);
    } else {
      el.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" fill="#FFFFFF" stroke="${color}" stroke-width="2.2"/>`);
      el.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" fill="${color}"/>`);
    }
    el.push(`<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(right ? x + 10 : x - 10).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${color}" stroke-width="1"/>`);
    // 白フチ付きの文字にして、着色セルの上でも読めるようにする
    for (const pass of ["stroke", "fill"]) {
      const deco = pass === "stroke" ? ` stroke="#FFFFFF" stroke-width="3.4" stroke-linejoin="round"` : "";
      el.push(`<text x="${lx.toFixed(1)}" y="${(y - 1).toFixed(1)}" font-size="10.5" font-weight="700" text-anchor="${anchor}" fill="${color}"${deco}>${esc(p.label)}</text>`);
      el.push(`<text x="${lx.toFixed(1)}" y="${(y + 10).toFixed(1)}" font-size="8.8" text-anchor="${anchor}" fill="${p.dropped ? color : "#43566B"}"${deco}>${esc(p.sub)}</text>`);
    }
  }
  return el.join("");
}

function scaleBar(x, y, px, cellM) {
  const w = (500 / cellM) * px;   // 500m
  return `<g><line x1="${x}" y1="${y}" x2="${x + w}" y2="${y}" stroke="#16232E" stroke-width="2"/>` +
    `<line x1="${x}" y1="${y - 4}" x2="${x}" y2="${y + 4}" stroke="#16232E" stroke-width="2"/>` +
    `<line x1="${x + w}" y1="${y - 4}" x2="${x + w}" y2="${y + 4}" stroke="#16232E" stroke-width="2"/>` +
    `<text x="${x + w / 2}" y="${y - 7}" font-size="9" text-anchor="middle" fill="#16232E" font-family="monospace">500m</text></g>`;
}

// ---- 図1: 洪水浸水想定(想定最大規模)+ 土砂災害警戒区域 ----
function floodMap(g, points) {
  const px = 5, W = g.nx * px, H = g.ny * px;
  const PAD = 8, LEG = 74;
  const colors = g.depth_legend.map((e) => `rgb(${e.rgb.join(",")})`);
  const cells = rasterRects(g.ny, g.nx, (j, i) => {
    const c = g.flood[j][i];
    return c === "." ? null : Number(c);
  }, (c) => colors[c] ?? "#DDD", px);
  const dosha = rasterRects(g.ny, g.nx, (j, i) => {
    const c = g.dosha[j][i];
    return c === "." ? null : c;
  }, () => "url(#hatch)", px);
  const doshaR = rasterRects(g.ny, g.nx, (j, i) => (g.dosha[j][i] === "r" ? "r" : null), () => "rgba(201,58,43,.55)", px);
  const legend = g.depth_legend.map((e, i) =>
    `<rect x="${PAD + i * 96}" y="${H + PAD + 16}" width="13" height="11" fill="${colors[i]}" stroke="#8A97A5" stroke-width=".6"/>` +
    `<text x="${PAD + i * 96 + 17}" y="${H + PAD + 25}" font-size="9" fill="#43566B">${esc(e.label)}</text>`).join("");
  return `<svg viewBox="0 0 ${W + PAD * 2} ${H + PAD + LEG}" role="img" aria-label="台帳エリアの洪水浸水想定区域と各地区の位置" style="width:100%;min-width:660px;height:auto;background:#FFFFFF">
  <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="6" height="6" fill="rgba(232,163,61,.30)"/><line x1="0" y1="0" x2="0" y2="6" stroke="#B07C10" stroke-width="2"/></pattern></defs>
  <g transform="translate(${PAD},${PAD})">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#F6F8F9"/>
    ${cells}${dosha}${doshaR}
    <rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#16232E" stroke-width="1"/>
    ${markers(points, g, px, W, H)}
    ${scaleBar(14, H - 16, px, g.cell_m)}
    <text x="${W - 10}" y="18" font-size="10" text-anchor="end" fill="#43566B">北 ↑</text>
  </g>
  <text x="${PAD}" y="${H + PAD + 12}" font-size="9.5" font-weight="700" fill="#16232E">浸水深(想定最大規模):</text>
  ${legend}
  <rect x="${PAD}" y="${H + PAD + 34}" width="13" height="11" fill="url(#hatch)" stroke="#8A97A5" stroke-width=".6"/>
  <text x="${PAD + 17}" y="${H + PAD + 43}" font-size="9" fill="#43566B">土砂災害警戒区域(イエロー)</text>
  <rect x="${PAD + 190}" y="${H + PAD + 34}" width="13" height="11" fill="rgba(201,58,43,.55)" stroke="#8A97A5" stroke-width=".6"/>
  <text x="${PAD + 207}" y="${H + PAD + 43}" font-size="9" fill="#43566B">土砂災害特別警戒区域(レッド)</text>
  <text x="${PAD}" y="${H + PAD + 60}" font-size="9" fill="#43566B">● 台帳に載っている地区 ／ ✕ ハザード該当で台帳から外した地区 ／ 25mメッシュ(1マス=実際の25m四方)</text>
</svg>`;
}

// ---- 図2: 標高 ── 台地と低地の境目(崖線)がどこを走っているか ----
const ELEV_BANDS = [
  { lo: -99, hi: 2.5, c: "#2E6E8E", label: "〜2.5m" },
  { lo: 2.5, hi: 5, c: "#5E96AC", label: "2.5〜5m" },
  { lo: 5, hi: 7.5, c: "#8FB8C9", label: "5〜7.5m" },
  { lo: 7.5, hi: 10, c: "#BDD5DF", label: "7.5〜10m" },
  { lo: 10, hi: 13, c: "#E4E7DC", label: "10〜13m" },
  { lo: 13, hi: 16, c: "#F2E4C4", label: "13〜16m" },
  { lo: 16, hi: 19, c: "#E3C98D", label: "16〜19m" },
  { lo: 19, hi: 22, c: "#CFAA5C", label: "19〜22m" },
  { lo: 22, hi: 999, c: "#B07C10", label: "22m〜" },
];
function elevMap(g, points) {
  const px = 5, W = g.nx * px, H = g.ny * px;
  const PAD = 8, LEG = 50;
  const bandOf = (e) => (e === -999 ? null : ELEV_BANDS.findIndex((b) => e >= b.lo && e < b.hi));
  const cells = rasterRects(g.ny, g.nx, (j, i) => bandOf(g.elev[j][i]), (c) => ELEV_BANDS[c].c, px);
  const legend = ELEV_BANDS.map((b, i) =>
    `<rect x="${PAD + i * 72}" y="${H + PAD + 16}" width="13" height="11" fill="${b.c}" stroke="#8A97A5" stroke-width=".6"/>` +
    `<text x="${PAD + i * 72 + 17}" y="${H + PAD + 25}" font-size="8.6" fill="#43566B">${esc(b.label)}</text>`).join("");
  return `<svg viewBox="0 0 ${W + PAD * 2} ${H + PAD + LEG}" role="img" aria-label="台帳エリアの標高と各地区の位置" style="width:100%;min-width:660px;height:auto;background:#FFFFFF">
  <g transform="translate(${PAD},${PAD})">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#F6F8F9"/>
    ${cells}
    <rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#16232E" stroke-width="1"/>
    ${markers(points, g, px, W, H)}
    ${scaleBar(14, H - 16, px, g.cell_m)}
    <text x="${W - 10}" y="18" font-size="10" text-anchor="end" fill="#43566B">北 ↑</text>
  </g>
  <text x="${PAD}" y="${H + PAD + 12}" font-size="9.5" font-weight="700" fill="#16232E">標高:</text>
  ${legend}
  <text x="${PAD}" y="${H + PAD + 42}" font-size="9" fill="#43566B">青=荒川低地(標高0〜5m) / 金=武蔵野台地(標高19m〜)。その境の急な色変わりが崖線で、台帳の掲載条件「台地側」はこの線の西側を指す</text>
</svg>`;
}

// ---- 図3: 想定浸水深と家の高さ ── 「3〜5m」が何を意味するか ----
function depthVsHouse(groups) {
  // 2026-08-13: エリア拡張で1グループに積むラベルが増え(区域外の地区が6件に)、
  // 固定高さ250だと5件目以降が viewBox の外に出て見切れた。ラベル行数で高さを伸ばす
  const labelRows = Math.max(1, ...groups.map((g) => g.labels.length));
  const W = 640, base = 200, H = Math.max(250, base + 20 + labelRows * 11 + 18), mPerPx = 11.5 / 165;   // 0〜11.5mを165pxに
  const yOf = (m) => base - m / mPerPx;
  const el = [];
  el.push(`<line x1="30" y1="${base}" x2="${W - 12}" y2="${base}" stroke="#16232E" stroke-width="1.5"/>`);
  for (const m of [0, 3, 6, 9]) {
    el.push(`<line x1="30" y1="${yOf(m).toFixed(1)}" x2="${W - 12}" y2="${yOf(m).toFixed(1)}" stroke="#DCE3EA" stroke-width="1"/>`);
    el.push(`<text x="26" y="${(yOf(m) + 3).toFixed(1)}" font-size="9" text-anchor="end" fill="#43566B" font-family="monospace">${m}m</text>`);
  }
  // 木造3階建の断面(1階0〜3m・2階3〜6m・3階6〜9m・屋根9〜10.5m)
  const hx = 42, hw = 74;
  el.push(`<rect x="${hx}" y="${yOf(9).toFixed(1)}" width="${hw}" height="${(base - yOf(9)).toFixed(1)}" fill="#FFFFFF" stroke="#16232E" stroke-width="1.4"/>`);
  for (const m of [3, 6]) el.push(`<line x1="${hx}" y1="${yOf(m).toFixed(1)}" x2="${hx + hw}" y2="${yOf(m).toFixed(1)}" stroke="#16232E" stroke-width="1"/>`);
  el.push(`<path d="M ${hx - 6} ${yOf(9).toFixed(1)} L ${hx + hw / 2} ${yOf(10.6).toFixed(1)} L ${hx + hw + 6} ${yOf(9).toFixed(1)} Z" fill="#FFFFFF" stroke="#16232E" stroke-width="1.4"/>`);
  for (const [m, t] of [[1.5, "1階"], [4.5, "2階"], [7.5, "3階"]]) {
    el.push(`<text x="${hx + hw / 2}" y="${(yOf(m) + 3).toFixed(1)}" font-size="9.5" text-anchor="middle" fill="#43566B">${t}</text>`);
  }
  el.push(`<text x="${hx + hw / 2}" y="${base + 14}" font-size="9" text-anchor="middle" fill="#43566B">木造3階建</text>`);
  // 各グループの浸水帯
  const x0 = hx + hw + 26, colW = (W - 16 - x0) / Math.max(1, groups.length);
  groups.forEach((gp, i) => {
    const x = x0 + i * colW + 4, w = colW - 8;
    if (gp.hi > 0) {
      el.push(`<rect x="${x.toFixed(1)}" y="${yOf(gp.hi).toFixed(1)}" width="${w.toFixed(1)}" height="${(base - yOf(gp.hi)).toFixed(1)}" fill="rgba(46,110,142,.30)"/>`);
      el.push(`<line x1="${x.toFixed(1)}" y1="${yOf(gp.hi).toFixed(1)}" x2="${(x + w).toFixed(1)}" y2="${yOf(gp.hi).toFixed(1)}" stroke="#2E6E8E" stroke-width="2"/>`);
      if (gp.lo > 0) el.push(`<line x1="${x.toFixed(1)}" y1="${yOf(gp.lo).toFixed(1)}" x2="${(x + w).toFixed(1)}" y2="${yOf(gp.lo).toFixed(1)}" stroke="#2E6E8E" stroke-width="1" stroke-dasharray="4,3"/>`);
      el.push(`<text x="${(x + w / 2).toFixed(1)}" y="${(yOf(gp.hi) - 6).toFixed(1)}" font-size="9.5" font-weight="700" text-anchor="middle" fill="#2E6E8E" font-family="monospace">${esc(gp.range)}</text>`);
    } else {
      el.push(`<text x="${(x + w / 2).toFixed(1)}" y="${(base - 8).toFixed(1)}" font-size="9.5" font-weight="700" text-anchor="middle" fill="#2C6E49">区域外</text>`);
    }
    gp.labels.forEach((t, k) => {
      el.push(`<text x="${(x + w / 2).toFixed(1)}" y="${base + 14 + k * 11}" font-size="8.6" text-anchor="middle" fill="${gp.dropped ? "#C93A2B" : "#43566B"}"${gp.dropped ? ' font-weight="700"' : ""}>${esc(t)}</text>`);
    });
  });
  el.push(`<text x="30" y="${H - 6}" font-size="9" fill="#43566B">想定最大規模の浸水深を、木造3階建(軒高約9m)と並べたもの。1階の天井が約3m、2階の天井が約6m</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="地区別の想定浸水深と木造3階建の高さの比較" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- ページ ----
export function renderHazardMap({ grid, ledger, excluded, asOf }) {
  const g = grid;
  // 地区ごとに台帳の件数と除外の件数を集計する
  const byDistrict = new Map();
  const touch = (addr) => {
    if (!byDistrict.has(addr)) byDistrict.set(addr, { addr, ledger: [], excluded: [] });
    return byDistrict.get(addr);
  };
  for (const { r, property } of ledger) {
    const a = property.location?.address;
    if (a) touch(a).ledger.push({ id: r.id, addr: a, official: property.hazard_check?.official ?? null });
  }
  for (const [k, v] of Object.entries(excluded)) {
    if (k.startsWith("_") || !v.address) continue;
    touch(v.address.replace(/^東京都/, "")).excluded.push({ key: k, reason: v.reason ?? "", price: v.price_man ?? null, official: v.official_check ?? null });
  }
  // YAMLの `flood_l2: none` は文字列 "none" として読める。値なしへ正規化しておく
  const val = (x) => (x == null || x === "none" || x === "unchecked" ? null : x);
  const rows = [...byDistrict.values()].map((d) => {
    const geo = g.geocode[d.addr] ?? null;
    const raw = d.ledger.find((x) => x.official)?.official ?? null;
    const off = raw ? { ...raw, flood_l2: val(raw.flood_l2) } : null;
    // 除外済みの地区は excluded.json に残した照合結果から拾う
    const exOff = d.excluded.map((e) => e.official).find(Boolean) ?? null;
    const depth = off?.flood_l2 ?? (exOff ? val(exOff.flood_l2) : null);
    // 標高は代表点1点の実測値(物件ページ・除外記録と同じ値)を優先し、無ければ25mメッシュから
    const elev = off?.elevation_m ?? exOff?.elevation_m ?? geo?.elev_m ?? null;
    return { ...d, geo, off, depth, elev };
  }).sort((a, b) => (a.elev ?? 99) - (b.elev ?? 99));

  const missing = rows.filter((r) => !r.geo).map((r) => r.addr);
  const points = rows.filter((r) => r.geo).map((r) => ({
    lat: r.geo.lat, lon: r.geo.lon,
    label: r.addr.replace(/^北区/, ""),
    sub: r.ledger.length ? `台帳${r.ledger.length}件・${r.elev}m` : `除外${r.excluded.length}件・${r.elev}m`,
    dropped: r.ledger.length === 0,
  }));

  // 浸水深グループ(図3用)。深い順に並べ、区域外はまとめて右端へ
  const RANGE = { "0.5m未満": [0, 0.5], "0.5〜3.0m": [0.5, 3], "3.0〜5.0m": [3, 5], "5.0〜10.0m": [5, 10], "10.0〜20.0m": [10, 20] };
  const gmap = new Map();
  for (const r of rows) {
    const key = r.depth ?? "区域外";
    if (!gmap.has(key)) gmap.set(key, []);
    gmap.get(key).push({ label: r.addr.replace(/^北区/, ""), dropped: r.ledger.length === 0 });
  }
  const groups = [...gmap.entries()].map(([range, labels]) => {
    const rr = RANGE[range] ?? [0, 0];
    return { range: range === "区域外" ? "" : range, lo: rr[0], hi: rr[1], labels: labels.map((l) => l.label),
      dropped: labels.every((l) => l.dropped) };
  }).sort((a, b) => b.hi - a.hi);

  const tableRows = rows.map((r) => {
    const off = r.off;
    const drop = r.ledger.length === 0;
    const doshaHit = off?.hits?.filter((h) => /土砂/.test(h)).join(" / ") || null;
    const doshaEx = r.excluded.some((e) => /土砂/.test(e.reason));
    const dosha = doshaHit ?? (doshaEx ? "除外物件で該当あり(代表点では出ない)" : "—");
    const status = drop ? "<b>掲載条件外として台帳から除外</b>"
      : off?.verdict === "caution" ? "丁目内に該当あり。個別区画は番地で要確認"
      : r.excluded.length ? "代表点では該当なし。ただし丁目内に該当物件があり除外済み(帯状の区域は代表点で拾えない)"
      : "代表点では該当なし";
    return `<tr${drop ? ' style="color:var(--stamp)"' : ""}>
      <td><b>${esc(r.addr)}</b></td>
      <td class="num">${r.elev != null ? r.elev + "m" : "—"}</td>
      <td class="num">${r.depth ? `<b>${esc(r.depth)}</b>` : "区域外"}</td>
      <td style="white-space:normal">${esc(dosha)}</td>
      <td class="num">${r.ledger.length}件</td>
      <td class="num">${r.excluded.length ? `<b>${r.excluded.length}件</b>` : "—"}</td>
      <td style="white-space:normal;font-size:.72rem">${status}</td>
    </tr>`;
  }).join("");

  const body = `
  <div style="margin-bottom:12px;font-size:.8rem"><a href="index.html">← 物件一覧へ</a></div>
  <div class="panel">
    <h2>ハザードマップ対照 ── 台帳の地区はどこに立っているか</h2>
    <div class="logic-body">
      <p class="why">台帳の掲載条件のひとつは<b>「台地側(荒川低地の浸水想定域外)」</b>。ところが物件掲載の法令等制限欄には<b>洪水浸水想定が原則載らない</b>(重要事項説明の義務項目であって広告欄の項目ではない)ため、掲載元を読むだけでは低地の物件を見分けられない。実際2026-08-13まで、標高2.5mの志茂1(浸水想定3〜5m)と標高1.8mの志茂3(同5〜10m)が台帳に残っていた。<b>数字の表では気づけなかったので、地図に置いて目で見て分かるようにしたのがこのページ</b>。</p>
      ${missing.length ? `<div class="note" style="color:var(--stamp)">代表点が未取得の地区: ${esc(missing.join(" / "))} ── <code>node crawler/hazard-grid.mjs</code> で再生成すること</div>` : ""}
    </div>
  </div>

  <div class="panel">
    <h2>図1: 洪水浸水想定区域(想定最大規模)</h2>
    <div class="logic-body">
      <div style="overflow-x:auto">${floodMap(g, points)}</div>
      <div class="note"><b>読み方</b>: 濃いピンクほど深い。東へ行くほど荒川に近づき深くなる。<span style="color:var(--stamp);font-weight:700">✕印</span>はハザード該当で台帳から外した地区で、いずれも色の濃い側に立っている。<b>候補地区がこの色の上に乗っていたら、掲載元に記載が無くても浸水想定域内</b>だと考えること。斜線は土砂災害警戒区域(イエロー)、<b style="color:var(--stamp)">赤ベタは特別警戒区域(レッドゾーン)</b>で、どちらも崖線に沿って帯状に走る。レッドは建築物の構造規制・移転勧告の対象で、住宅ローンと再販性に直接効く。</div>
    </div>
  </div>

  <div class="panel">
    <h2>図2: 標高 ── 崖線がどこを走っているか</h2>
    <div class="logic-body">
      <div style="overflow-x:auto">${elevMap(g, points)}</div>
      <div class="note"><b>読み方</b>: 図1の浸水域と、この図の青い低地はほぼ重なる。つまり<b>「浸水するかどうか」は地形でほぼ決まっており、個別の物件の善し悪しではない</b>。金色(標高19m〜)が武蔵野台地、青(0〜5m)が荒川低地で、その間の急な色変わりが崖線。台帳の掲載条件「台地側」はこの線の西側を指す。赤羽台3・中十条4・赤羽西3のように<b>崖線の上に乗っている丁目は、同じ丁目でも番地によって台地上と崖下に分かれる</b>ため、丁目単位では判断できない。</div>
    </div>
  </div>

  <div class="panel">
    <h2>図3: 「浸水想定3〜5m」が何を意味するか</h2>
    <div class="logic-body">
      ${depthVsHouse(groups)}
      <div class="note">浸水深は数字だと実感が湧きにくいので、木造3階建と並べたもの。<b>3〜5mは2階の床上、5〜10mは3階まで到達しうる水準</b>で、垂直避難(上階へ逃げる)が成立するかどうかの境目にあたる。加えて志茂は<b>浸水継続時間</b>の指定域でもあり、水が引くまで日単位でかかる想定。</div>
    </div>
  </div>

  <div class="panel">
    <h2>地区別の対照表</h2>
    <div class="logic-body">
      <div style="overflow-x:auto"><table class="list">
        <tr><th>地区</th><th>標高</th><th>洪水浸水想定<br>(想定最大規模)</th><th>土砂災害</th><th>台帳</th><th>除外</th><th>状況</th></tr>
        ${tableRows}
      </table></div>
      <div class="note">標高の低い順。浸水想定・土砂災害の欄は各物件YAMLの <code>hazard_check.official</code>(国土地理院タイルとの機械照合)に記録した値。照合コマンドは <code>node crawler/geohazard.mjs "東京都北区&lt;地区&gt;&lt;丁目&gt;丁目"</code>。標高と浸水深は<b>丁目代表点1点の実測値</b>で、上の地図は25mメッシュのラスタ。境界付近では両者の見え方が違うことがある。</div>
    </div>
  </div>

  <div class="panel">
    <h2>この地図で分かること・分からないこと</h2>
    <div class="logic-body">
      <table class="kv">
        <tr><td><b>分かる</b></td><td>面的なハザード(荒川の氾濫)。丁目全域が水没する想定なので、代表点でも25mメッシュでも結論は変わらない。志茂は周辺25点すべてが浸水想定域だった</td></tr>
        <tr><td><b>分からない①</b></td><td><b>帯状のハザード</b>。崖線沿いの土砂災害警戒区域は幅が数十mしかなく、丁目の代表点では簡単に取りこぼす。西が丘2のレッドゾーン現場をathomeの備考欄だけが捕まえたのがその例。<b>掲載元の法令等制限欄の確認は今も必須</b>。なお2026-08-13まで、この図はレッドを別レイヤから読もうとして<b>全件をイエローとして描いていた</b>(その別レイヤは実在せず常に404だった)。現在は同一レイヤの色で判別している</td></tr>
        <tr><td><b>分からない②</b></td><td><b>個別の区画</b>。掲載は丁目までしか住所を出さないため、崖線に跨る丁目(赤羽台3・中十条4・赤羽西3)では番地で結果が変わる。最終確認は現地・役所・重要事項説明で</td></tr>
        <tr><td><b>分からない③</b></td><td>内水氾濫(下水処理能力を超える都市型浸水)・液状化・盛土造成地。これらは別の図面で、本ページには載せていない</td></tr>
      </table>
      <div class="note" style="margin-top:10px">確認の3経路: ①SUUMOの「その他制限事項」 ②athome掲載の備考(法令等制限) ③公式マップの機械照合。①②は帯状ハザードに強く浸水に弱い、③はその逆。<b>互いの穴を埋める関係なので、どれも省略しない</b>。</div>
      <div class="meta-line">出典: ${esc(g.source)} ／ ラスタ生成 ${esc(g.generated_at)}(${g.nx}×${g.ny}・${g.cell_m}mメッシュ)／ 再生成 <code>node crawler/hazard-grid.mjs</code> ／ 査定基準日 ${esc(asOf)}<br>
      浸水想定区域・土砂災害警戒区域の指定主体は国および東京都。本ページは指定図面を機械的に読み取って可視化したものであり、公式の証明ではありません。契約判断は必ず重要事項説明と原典で確認してください。</div>
    </div>
  </div>`;

  return layout({
    title: "ハザードマップ対照",
    subtitle: "台帳の各地区が浸水想定・土砂災害警戒区域・標高のどこに立っているか",
    docNo: `ハザード対照図<br>ラスタ ${esc(g.generated_at)}`,
    body,
  });
}
