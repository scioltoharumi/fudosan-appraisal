// site/templates/compare.js — 本命の立ち位置(神谷2-24を「条件が似た物件」と「同じ価格帯の物件」の2軸で比べる)
// 2026-10-10ユーザー要望「東十条6など条件が似ているもので並べて比べるのと、価格帯で比べるという2つの軸で分析したい」
// →「この結果をグラフィカルに分かりやすく説明するページを作って」。
//
// 設計方針:
//   - 数値の正本は market/compare-snapshot-2026-10-10.json(スナップショット)。台帳外の低地の掲載は
//     一時入力で同じエンジンに通した参考値なので、ビルドのたびに再計算せず日付つきで固定する(黙って動かさない)。
//   - 判定はしない(v3.0.0)。条件表の色は「神谷2-24を基準にした相対」で、良し悪しの判定ではない旨を明記する。
//   - 図1(散布図)が主役: 価格×延床の平面に、価格帯の帯と延床90m²の線を引き、神谷が「帯の中で上にいる唯一の新しい点」で
//     あることを目で見せる。浸水の深さは単色の濃淡(順序のある量)、新しさは塗り/白抜き(色だけに頼らない)。
//   - SVGの縦軸ラベルに rotate(-90) は使わない(運用ルール5)。軸名はグラフ上部に水平に置く。
import { layout, esc } from "./layout.js";

const C = {
  ink: "#16232E", soft: "#43566B", muted: "#7A8794", grid: "#E3E8EC", band: "#F3EBDD",
  upland: "#A9C7DA", shallow: "#4F8DB8", deep: "#1F4E79", unknown: "#9AA3AB",
  focus: "#C93A2B", below: "#2E6E8E", above: "#C9733B",
};
const FLOOD = {
  upland: { label: "台地(浸水なし〜0.5m未満)", color: C.upland },
  shallow: { label: "低地・浸水0.5〜3m", color: C.shallow },
  deep: { label: "低地・浸水3〜5m", color: C.deep },
  unknown: { label: "位置が未確定", color: C.unknown },
};
const KAMIYA = "kamiya2-adcast-a";
const man = (n) => Number(n).toLocaleString("ja-JP");
const nameOf = (r) => `${r.label}(${r.built.slice(0, 4)}${/新築/.test(r.label) ? "" : r.built.slice(0, 4) >= "2026" ? "新築" : "築"})`;

// ---- 図1: 価格 × 延床 の散布図 ----
// 番号つきで示す主要点(軸1=条件が似ている物件+価格帯の代表)
export const KEY_IDS = [KAMIYA, "東十条6-21711925", "akabanenishi4-21890445", "岩淵町-78266571", "上中里3-21644109",
  "神谷3新築-20184908", "東十条5-20352901"];

function figScatter(rows) {
  const W = 760, H = 470, L = 64, R = 24, T = 54, B = 64;
  const x0 = 5800, x1 = 9200, y0 = 65, y1 = 140;
  const sx = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
  const sy = (v) => T + (1 - (Math.min(v, y1) - y0) / (y1 - y0)) * (H - T - B);
  const el = [];
  // 価格帯の帯(6,000〜7,100万)と延床90m²の線
  el.push(`<rect x="${sx(6000)}" y="${T}" width="${sx(7100) - sx(6000)}" height="${H - T - B}" fill="${C.band}"/>`);
  el.push(`<text x="${(sx(6000) + sx(7100)) / 2}" y="${T + 14}" font-size="10" fill="${C.soft}" text-anchor="middle" font-weight="700">同じ価格帯(6,000〜7,100万)</text>`);
  // グリッド・目盛り
  for (let v = 6000; v <= 9000; v += 500) {
    el.push(`<line x1="${sx(v)}" y1="${T}" x2="${sx(v)}" y2="${H - B}" stroke="${C.grid}"/>`);
    el.push(`<text x="${sx(v)}" y="${H - B + 16}" font-size="10" fill="${C.muted}" text-anchor="middle">${man(v)}</text>`);
  }
  for (let v = 70; v <= 140; v += 10) {
    el.push(`<line x1="${L}" y1="${sy(v)}" x2="${W - R}" y2="${sy(v)}" stroke="${C.grid}"/>`);
    el.push(`<text x="${L - 8}" y="${sy(v) + 3.5}" font-size="10" fill="${C.muted}" text-anchor="end">${v}</text>`);
  }
  el.push(`<line x1="${L}" y1="${sy(90)}" x2="${W - R}" y2="${sy(90)}" stroke="${C.soft}" stroke-width="1.2" stroke-dasharray="5 4"/>`);
  el.push(`<text x="${W - R - 4}" y="${sy(90) - 5}" font-size="10" fill="${C.soft}" text-anchor="end">延床90m²(これより上が広い)</text>`);
  el.push(`<text x="${L}" y="${T - 12}" font-size="10.5" fill="${C.soft}">延床(m²)</text>`);
  el.push(`<text x="${(L + W - R) / 2}" y="${H - 18}" font-size="10.5" fill="${C.soft}" text-anchor="middle">売出価格(万円)</text>`);
  // 点(本命は最後に描いて最前面へ)
  const sorted = [...rows].sort((a, b) => (a.id === KAMIYA) - (b.id === KAMIYA));
  for (const r of sorted) {
    const cx = sx(r.price), cy = sy(r.floor), col = FLOOD[r.flood].color;
    const isK = r.id === KAMIYA;
    const tip = `${nameOf(r)} ${man(r.price)}万・延床${r.floor}m²・土地${r.land}m²・徒歩${r.walk}分・${FLOOD[r.flood].label}・査定の中央値との差 ${r.gap >= 0 ? "+" : ""}${man(r.gap)}万${r.floor > y1 ? "(延床が図の上限を超えるため上端に表示)" : ""}`;
    if (isK) el.push(`<circle cx="${cx}" cy="${cy}" r="11" fill="none" stroke="${C.focus}" stroke-width="2.2"/>`);
    el.push(`<circle cx="${cx}" cy="${cy}" r="5.5" fill="${r.newish ? col : "#fff"}" stroke="${r.newish ? "#fff" : col}" stroke-width="${r.newish ? 2 : 2.2}"><title>${esc(tip)}</title></circle>`);
    const k = KEY_IDS.indexOf(r.id);
    if (k > 0) el.push(`<text x="${cx + 8}" y="${cy - 7}" font-size="10" font-weight="700" fill="${C.ink}">${k}</text>`);
  }
  const k = rows.find((r) => r.id === KAMIYA);
  el.push(`<text x="${sx(k.price) - 14}" y="${sy(k.floor) - 15}" font-size="11.5" font-weight="700" fill="${C.focus}" text-anchor="end">神谷2-24(本命)</text>`);
  // 凡例(上部・水平)
  let lx = L + 120;
  for (const key of ["upland", "shallow", "deep", "unknown"]) {
    el.push(`<circle cx="${lx}" cy="${T - 32}" r="5" fill="${FLOOD[key].color}"/>`);
    el.push(`<text x="${lx + 9}" y="${T - 28.5}" font-size="9.5" fill="${C.soft}">${FLOOD[key].label}</text>`);
    lx += key === "upland" ? 150 : 118;
  }
  el.push(`<circle cx="${L + 120}" cy="${T - 14}" r="5" fill="${C.shallow}" stroke="#fff" stroke-width="2"/>`);
  el.push(`<text x="${L + 129}" y="${T - 10.5}" font-size="9.5" fill="${C.soft}">塗り = 2021年以降の築(新築含む)</text>`);
  el.push(`<circle cx="${L + 300}" cy="${T - 14}" r="5" fill="#fff" stroke="${C.shallow}" stroke-width="2.2"/>`);
  el.push(`<text x="${L + 309}" y="${T - 10.5}" font-size="9.5" fill="${C.soft}">白抜き = 2020年以前の築</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="売出価格と延床面積の散布図。同じ価格帯で延床90m²超かつ新しい点は神谷2-24だけ" style="max-width:${W}px;font-family:inherit">${el.join("")}</svg>`;
}

// ---- 図3: 同じ価格帯の「査定の中央値との差」(発散棒) ----
function figGapBars(rows) {
  const band = rows.filter((r) => r.price >= 5900 && r.price <= 7100).sort((a, b) => a.gap - b.gap);
  const W = 760, L = 250, R = 70, T = 34, RH = 26, H = T + band.length * RH + 30;
  const max = Math.max(...band.map((r) => Math.abs(r.gap)), 500);
  const x0 = L + (W - L - R) * (500 / (max + 500));          // 0の位置(マイナス側に少し余白)
  const sc = (v) => ((W - L - R) * Math.abs(v)) / (max + 500);
  const el = [];
  el.push(`<text x="${L}" y="${T - 16}" font-size="10.5" fill="${C.soft}">査定の中央値との差(万円)── 左(青)= 査定より安い / 右(橙)= 査定より高い</text>`);
  el.push(`<line x1="${x0}" y1="${T - 6}" x2="${x0}" y2="${T + band.length * RH}" stroke="${C.soft}" stroke-width="1.2"/>`);
  band.forEach((r, i) => {
    const y = T + i * RH, isK = r.id === KAMIYA;
    if (isK) el.push(`<rect x="4" y="${y}" width="${W - 8}" height="${RH - 2}" fill="#FDF0EE"/>`);
    const w = Math.max(sc(r.gap), 2), x = r.gap < 0 ? x0 - w : x0;
    const nm = `${nameOf(r)}・延床${Math.round(r.floor)}m²${r.src === "listing" ? "*" : ""}`;
    el.push(`<text x="${L - 10}" y="${y + 16}" font-size="10.5" fill="${isK ? C.focus : C.ink}" text-anchor="end"${isK ? ' font-weight="700"' : ""}>${esc(nm)}</text>`);
    el.push(`<rect x="${x}" y="${y + 5}" width="${w}" height="14" rx="3" fill="${r.gap < 0 ? C.below : C.above}"><title>${esc(`${nameOf(r)} 売出${man(r.price)}万 / 査定の中央値${man(r.fair)}万`)}</title></rect>`);
    if (isK && r.extra) {   // 別途費用を足した実質の幅(ひげ)
      const a = x0 + (r.gap + r.extra.min < 0 ? -sc(r.gap + r.extra.min) : sc(r.gap + r.extra.min));
      const b = x0 + sc(r.gap + r.extra.max);
      el.push(`<line x1="${a}" y1="${y + 12}" x2="${b}" y2="${y + 12}" stroke="${C.focus}" stroke-width="2"/>`);
      el.push(`<line x1="${b}" y1="${y + 6}" x2="${b}" y2="${y + 18}" stroke="${C.focus}" stroke-width="2"/>`);
    }
    const lab = `${r.gap >= 0 ? "+" : ""}${man(r.gap)}`;
    const tx = isK && r.extra ? x0 + sc(r.gap + r.extra.max) + 6 : r.gap < 0 ? x - 6 : x + w + 6;
    el.push(`<text x="${tx}" y="${y + 16}" font-size="10" fill="${C.soft}" text-anchor="${r.gap < 0 && !(isK && r.extra) ? "end" : "start"}">${lab}</text>`);
  });
  return { svg: `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="同じ価格帯の物件の、査定の中央値との差の棒グラフ" style="max-width:${W}px;font-family:inherit">${el.join("")}</svg>`, n: band.length };
}

// ---- 図2: 条件が似ている物件の比較表(神谷を基準にした相対の色) ----
function condTable(rows) {
  const ids = KEY_IDS.slice(0, 6);
  const rs = ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
  const k = rs[0];
  const tone = (d) => (d > 0 ? "background:#E6F0F5" : d < 0 ? "background:#FBEBDD" : "");
  const floodRank = { upland: 3, shallow: 2, deep: 1, unknown: 0 };
  const cells = (r) => {
    const isK = r === k;
    const t = (d) => (isK ? "" : tone(d));
    return `
      <td style="${t(k.price - r.price)}"><b>${man(r.price)}万</b>${r.id === KAMIYA ? "<br><span class='note'>+別途60〜260</span>" : ""}</td>
      <td style="${t(Number(r.built.slice(0, 4)) - Number(k.built.slice(0, 4)) >= 0 ? 0 : -1)}">${r.built.slice(0, 4)}年</td>
      <td style="${t(Math.sign(Math.round(r.floor - k.floor) / 5 | 0))}">${r.floor}m²${/車庫/.test(r.note) || r.id === KAMIYA ? "<span class='note'>(車庫込)</span>" : ""}</td>
      <td style="${t(Math.sign(r.land - k.land))}">${r.land}m²</td>
      <td style="${t(k.walk - r.walk)}">徒歩${r.walk}分</td>
      <td style="${t(Math.sign((/接道幅3m/.test(r.note) ? 3 : (r.road ?? 4)) - k.road))}">${r.road ?? "-"}m${r.id === "東十条6-21711925" ? "<span class='note'>(接道3m)</span>" : ""}</td>
      <td style="${t(floodRank[r.flood] - floodRank[k.flood])}">${FLOOD[r.flood].label.replace(/(低地・|台地)/, "")}</td>
      <td style="${t(k.gap - r.gap)}">${r.gap >= 0 ? "+" : ""}${man(r.gap)}万</td>`;
  };
  return `<div style="overflow-x:auto"><table class="kv" style="min-width:720px;font-size:.78rem">
    <tr><th></th><th>価格</th><th>築年</th><th>延床</th><th>土地</th><th>JR徒歩</th><th>前面道路</th><th>浸水</th><th>査定の中央値との差</th></tr>
    ${rs.map((r, i) => `<tr${r === k ? ' style="font-weight:700"' : ""}><td>${i === 0 ? "" : `<b>${i}</b> `}${r.url ? `<a href="${esc(r.url)}">${esc(nameOf(r))}</a>` : esc(nameOf(r))}${r.src === "listing" ? "*" : ""}</td>${cells(r)}</tr>`).join("")}
  </table></div>`;
}

export function renderCompare({ snapshot }) {
  const rows = snapshot.rows;
  const k = rows.find((r) => r.id === KAMIYA);
  if (!k) throw new Error("compare: スナップショットに本命(kamiya2-adcast-a)が無い");
  for (const id of KEY_IDS) if (!rows.find((r) => r.id === id)) throw new Error(`compare: 主要点 ${id} がスナップショットに無い`);
  const bars = figGapBars(rows);
  const keyList = KEY_IDS.slice(1).map((id, i) => {
    const r = rows.find((x) => x.id === id);
    return `<b>${i + 1}</b> ${esc(nameOf(r))} ${man(r.price)}万`;
  }).join(" / ");
  const body = `
  <section class="panel">
    <h2>結論(3行)</h2>
    <div class="logic-body" style="font-size:.88rem;line-height:1.9">
      <div>① <b>同じ価格帯(6,000〜7,100万)で「新しい × 延床90m²超 × JR徒歩圏」がそろうのは神谷2-24だけ</b>(図1の帯の中、点線より上の塗りの点)。</div>
      <div>② <b>条件が似た物件は、いずれも神谷より1,000〜1,200万高い</b>(東十条6・赤羽西4新築・岩淵町)。</div>
      <div>③ 神谷の弱点は<b>浸水想定の深さ(3〜5m)</b>。そこを浅くする(東十条6=0.5〜3m)なら、約1,000万の上乗せと路地状敷地の可能性を受け入れることになる。</div>
      <p class="note" style="margin-top:8px">このページは判定をしません——並べ方と色は<b>神谷2-24を基準にした相対比較</b>で、エンジンの判定ではない。
      数値は ${esc(snapshot.as_of)} 時点のスナップショット。</p>
    </div>
  </section>

  <section class="panel">
    <h2>図1 ── 全体の地図: 価格 × 広さ(点の色=浸水、塗り=新しさ)</h2>
    <div class="scale-wrap">${figScatter(rows)}</div>
    <div class="note">${rows.length}物件(台帳の戸建・建物プラン付き土地+低地の掲載のうち価格5,900〜9,100万)。点にカーソルを合わせると詳細。
    番号: ${keyList}。延床が140m²を超える2件は上端に描いた。<br>
    <b>読み方</b>: 帯(同じ価格帯)の中で点線(延床90m²)より上にいる塗りの点は神谷だけ。帯の中の他の点は「点線より下(狭い)」か「白抜き(築15〜20年)」に分かれる。
    点線より上の塗りの点(条件が並ぶもの)はすべて帯の右=1,000万以上高い。</div>
  </section>

  <section class="panel">
    <h2>図2 ── 軸1: 条件が似ている物件と並べる</h2>
    ${condTable(rows)}
    <div class="note">色は神谷2-24(太字の行)を基準にした相対: <span style="background:#E6F0F5;padding:0 4px">青 = 神谷より有利</span>
    <span style="background:#FBEBDD;padding:0 4px">橙 = 神谷より不利</span> / 無色 = ほぼ同じ。判定ではない。
    <b>延床の「車庫込」に注意</b>(神谷の93.86m²も車庫ポーチ込みで、居住部分は80〜85m²程度の公算)。
    東十条6(2021築)は接道幅3m=路地状敷地の公算があり、その前提で査定し直した値(6,943〜7,457万に対し+223〜+737万)を載せた。
    赤羽西4新築の−1,368万は延床に備蓄倉庫が入り、位置(台地か崖下か)も未確定なので割り引いて読む。</div>
  </section>

  <section class="panel">
    <h2>図3 ── 軸2: 同じ価格帯の中で、査定に対してどこにいるか</h2>
    <div class="scale-wrap">${bars.svg}</div>
    <div class="note">価格5,900〜7,100万の${bars.n}物件。<b>査定の中央値より安いのは神谷2-24だけ</b>で、他は400〜2,500万高い売出。
    神谷の赤いひげは設備負担金60万+地盤改良費(想定100〜200万)を足した実質の幅(−51〜+149万)=<b>ほぼ査定どおり</b>。
    名前の後ろの * は台帳外の掲載(参考値・下の注意を参照)。</div>
  </section>

  <section class="panel">
    <h2>この比較で分からないこと(注意)</h2>
    <div class="logic-body" style="font-size:.82rem;line-height:1.8">
      <div>・<b>台帳外(*印)の数値は参考値</b>。${esc(snapshot.note)}。</div>
      <div>・<b>浸水は丁目の代表点の値</b>(神谷2-24だけは住居表示の点で照合)。同じ丁目でも区画で変わる。候補にするなら区画の位置で照合し直す。</div>
      <div>・町の雰囲気・前面道路の実際の使いやすさ・日当たりは数字に出ない(神谷2-24はユーザーの現地確認で「一押し」)。</div>
      <div>・保有年数ごとの総コストは<a href="focus.html">本命比較</a>と<a href="simulate.html">シミュレーター</a>で見られる(台帳物件のみ)。</div>
    </div>
  </section>
  <div class="disclaimer">本ページは判定・推奨ではない(スナップショット ${esc(snapshot.as_of)})。正本は market/compare-snapshot-${esc(snapshot.as_of)}.json と各物件ページ。</div>
  <p style="margin-top:14px"><a class="src-link" href="index.html">← 物件一覧へ戻る</a></p>`;
  return layout({ title: "本命の立ち位置 ── 神谷2-24を2つの軸で比べる", subtitle: "条件が似た物件と並べる / 同じ価格帯で並べる(判定はしない)", docNo: "COMPARE", body });
}
