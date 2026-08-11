// site/templates/data-explorer.js — 成約データ探索ページ(data.html)
// 目的: 査定の土台になっている成約データを、人間が自分の目で検証・探索できるようにする。
// - 全レコードに出所(一次/第二ソースURL・国交省原典の参照ID)と二重照合の検証状態を明示
// - フィルタ(地区・築年・土地面積・時期・検証状態)、ソート、散布図・時系列をクライアント側で描画
// - 依存ゼロ(vanilla JS・インラインSVG)。データはビルド時にJSONで埋め込む
import { layout, esc } from "./layout.js";

export function renderDataExplorer({ houseRows, landRows, verification, asOf }) {
  const payload = JSON.stringify({ houseRows, landRows }).replace(/</g, "\\u003c");
  const vs = verification?.summary ?? {};
  const body = `
  <div class="panel">
    <h2>成約データ台帳 ── 査定の土台を自分の目で検証する</h2>
    <div class="logic-body">
      <p class="why">本サイトの査定(リテール比較法・土地較正)が使っている成約データの全件。出典は国交省「不動産取引価格情報」の再掲2サイトで、各行に出所リンクを付してある。<b>二重照合</b>(一次ソースのライブ再取得+独立の第二ソースとの突き合わせ)の結果も行ごとに表示する。</p>
      <table class="kv" style="max-width:640px">
        <tr><td>検証実施日</td><td>${esc(verification?.generated_at ?? "—")}</td></tr>
        <tr><td>二重照合一致(verified2)</td><td>${vs.verified2 ?? 0}件 ── 価格・面積・時期が両ソースで一致し、築年も整合</td></tr>
        <tr><td>一次ソースのみ確認(verified1)</td><td>${vs.verified1 ?? 0}件 ── 第二ソースに未収載(ページネーション範囲外等)</td></tr>
        <tr class="loss"><td>矛盾(conflict)→査定から除外</td><td>${vs.conflict ?? 0}件 ── ソース間で築年等が矛盾。原典での裁定待ち</td></tr>
        <tr><td>要再確認(unverified)</td><td>${vs.unverified ?? 0}件</td></tr>
      </table>
      <div class="note" style="margin-top:8px">原典: <a href="https://www.reinfolib.mlit.go.jp/realEstatePrices/" target="_blank" rel="noopener noreferrer">国交省 不動産情報ライブラリ↗</a>(四半期ごとの取引価格アンケート。価格100万円・面積5m²単位に丸め・匿名化)。再検証は <code>node engine/verify-data.mjs</code> で随時実行できる。</div>
    </div>
  </div>

  <div class="panel">
    <h2>戸建成約(リテール比較法の事例プール)</h2>
    <div class="logic-body">
      <div id="controls" style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;font-size:.78rem">
        <div><div class="note">地区
          <button type="button" id="distAll" style="font-size:.68rem;padding:1px 7px;margin-left:6px;cursor:pointer">全て選択</button>
          <button type="button" id="distNone" style="font-size:.68rem;padding:1px 7px;cursor:pointer">全て解除</button>
        </div><div id="distChips" style="max-width:430px"></div></div>
        <div><div class="note">築年(年)</div><input id="ageMin" type="number" value="-2" style="width:56px"> 〜 <input id="ageMax" type="number" value="70" style="width:56px"></div>
        <div><div class="note">土地(m²)</div><input id="landMin" type="number" value="0" style="width:60px"> 〜 <input id="landMax" type="number" value="400" style="width:60px"></div>
        <div><div class="note">時期(以降)</div><select id="qFrom"></select></div>
        <div><div class="note">検証状態</div><select id="vFilter"><option value="">すべて</option><option value="verified2">二重照合一致のみ</option><option value="verified1">一次確認のみ</option><option value="unverified">要再確認</option></select></div>
        <div id="stats" style="font-family:var(--mono);font-size:.75rem"></div>
      </div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:14px">
        <div style="flex:1;min-width:320px"><div class="note">価格 × 土地面積(色=築年帯)</div><div id="scatter"></div></div>
        <div style="flex:1;min-width:320px"><div class="note">四半期ごとの成約価格(点)と中央値(線)</div><div id="timeseries"></div></div>
      </div>
      <div style="overflow-x:auto;margin-top:14px;max-height:520px;overflow-y:auto">
        <table class="list" id="dealTable">
          <thead><tr>
            <th data-k="quarter">時期▲▼</th><th data-k="district">地区▲▼</th><th data-k="price_man">総額▲▼</th>
            <th data-k="land_m2">土地m²▲▼</th><th data-k="floor_m2">延床m²▲▼</th><th data-k="age_y">築年▲▼</th>
            <th data-k="walk_min">駅分▲▼</th><th data-k="unit">土地単価▲▼</th><th>検証</th><th>出所(ファクトチェック)</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="note">土地単価 = 総額÷土地坪(補正前の生値・<b>建物込みの見かけ単価</b>。査定に使う建物控除後の残余単価とは別物)。検証バッジ: ✓✓=二重照合一致 / ✓=一次ソース確認 / ?=要再確認。</div>
      <div class="note" style="margin-top:8px;border:1px dashed var(--grid);padding:10px 12px"><b>目視でファクトチェックする手順</b>: 一次↗(utinokati)は開いた直後に見えるのが「相場○○万円/坪」等の集計値で、<b>個別成約はページ下部の取引事例一覧(スクリプト描画・ページ送りあり)まで降りる必要がある</b>。目当ての行が見つからない場合はページ送りを繰り返すか、静的な一覧表で照合しやすい<b>第二↗(baikyaku-agent)</b>を使うのが早い(価格・面積・建築年・時期が1表に並ぶ)。なお一次ページ上部の「相場」は<b>直近暦年のみ・総額÷土地面積の単純平均</b>で、標本が数件しかない年は外れ値1件で数十%動く参考値──本サイトが集計値でなく個別レコードだけを収載しているのはこのため。機械照合は <code>node engine/verify-data.mjs</code>(一次のライブ再取得+第二ソース突合)で全行を再実行できる。原典IDは一次ソースが参照する国交省CSV内のレコードID。</div>
    </div>
  </div>

  <div class="panel">
    <h2>土地成約(較正用・${landRows.length}件)</h2>
    <div class="logic-body">
      <div style="overflow-x:auto">
      <table class="list">
        <tr><th>時期</th><th>地区</th><th>総額</th><th>面積</th><th>坪単価</th><th>属性</th><th>出所</th></tr>
        ${landRows.map((d) => `<tr>
          <td>${esc(String(d.date).slice(0, 7))}</td><td>${esc(d.district)}</td>
          <td class="num">${d.price_man.toLocaleString("en-US")}万</td><td class="num">${d.land_tsubo}坪</td>
          <td class="num">${d.ppt_man}万/坪</td><td style="font-size:.72rem">徒歩${d.walk_min}分・${esc(d.shape)}・${esc(d.zoning)}</td>
          <td><a href="${esc(d.source_url)}" target="_blank" rel="noopener noreferrer">一次↗</a></td>
        </tr>`).join("")}
      </table>
      </div>
      <div class="note">全12件はライブページとの照合済み(2026-08-09〜10)。1件(赤羽台2025Q1)は地区帰属が出典と不一致のため収載から除外済み。</div>
    </div>
  </div>

  <div style="margin-bottom:20px"><a class="src-link" href="index.html">← 査定台帳一覧へ戻る</a></div>

  <script>
  const DATA = ${payload};
  const rows = DATA.houseRows;
  const districts = [...new Set(rows.map(r => r.district))].sort();
  const quarters = [...new Set(rows.map(r => r.quarter))].sort();
  const S = { dists: new Set(districts), sortK: "quarter", sortDir: -1 };
  const $ = (id) => document.getElementById(id);
  const VB = { verified2: "✓✓", verified1: "✓", unverified: "?", unchecked: "-" };
  const AGE_COLORS = [["新築(<2年)", "#2E6E8E", a => a < 2], ["築浅(2-10)", "#2C6E49", a => a < 10], ["中古(10-25)", "#B07C10", a => a < 25], ["築古(25+)", "#C93A2B", () => true]];
  const ageColor = a => AGE_COLORS.find(c => c[2](a))[1];

  // 地区チップ
  $("distChips").innerHTML = districts.map(d => '<label style="display:inline-block;margin:1px 4px 1px 0"><input type="checkbox" checked data-d="' + d + '">' + d + '</label>').join("");
  document.querySelectorAll("#distChips input").forEach(el => el.addEventListener("change", () => { el.checked ? S.dists.add(el.dataset.d) : S.dists.delete(el.dataset.d); render(); }));
  const setAllDists = (on) => { document.querySelectorAll("#distChips input").forEach(el => { el.checked = on; }); S.dists = new Set(on ? districts : []); render(); };
  $("distAll").addEventListener("click", () => setAllDists(true));
  $("distNone").addEventListener("click", () => setAllDists(false));
  $("qFrom").innerHTML = quarters.map(q => '<option' + (q === "2022Q1" ? " selected" : "") + '>' + q + '</option>').join("");
  ["ageMin","ageMax","landMin","landMax","qFrom","vFilter"].forEach(id => $(id).addEventListener("input", render));
  document.querySelectorAll("#dealTable th[data-k]").forEach(th => th.addEventListener("click", () => {
    const k = th.dataset.k; S.sortDir = S.sortK === k ? -S.sortDir : 1; S.sortK = k; render();
  }));

  const tsubo = 3.30578;
  const unitOf = r => r.price_man / (r.land_m2 / tsubo);
  const med = xs => { const a = [...xs].sort((x,y)=>x-y); return a.length ? (a.length % 2 ? a[(a.length-1)/2] : (a[a.length/2-1]+a[a.length/2])/2) : null; };

  function filtered() {
    return rows.filter(r => S.dists.has(r.district) &&
      r.age_y >= +$("ageMin").value && r.age_y <= +$("ageMax").value &&
      r.land_m2 >= +$("landMin").value && r.land_m2 <= +$("landMax").value &&
      r.quarter >= $("qFrom").value &&
      (!$("vFilter").value || r.verification === $("vFilter").value));
  }

  function svgOpen(w, h) { return '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:auto;background:#FDFDFC;border:1px solid var(--grid)">'; }

  function drawScatter(fr) {
    const W = 460, H = 300, P = 42;
    if (!fr.length) { $("scatter").innerHTML = svgOpen(W,H) + '</svg>'; return; }
    const xs = fr.map(r => r.land_m2), ys = fr.map(r => r.price_man);
    const xMax = Math.max(...xs) * 1.05, yMax = Math.max(...ys) * 1.05;
    const X = v => P + (v / xMax) * (W - P - 10), Y = v => H - 30 - (v / yMax) * (H - 45);
    let el = "";
    for (let i = 1; i <= 4; i++) { const yv = yMax * i / 4, xv = xMax * i / 4;
      el += '<line x1="' + P + '" y1="' + Y(yv) + '" x2="' + (W-10) + '" y2="' + Y(yv) + '" stroke="#EEE"/>' +
            '<text x="4" y="' + (Y(yv)+3) + '" font-size="8" fill="#888">' + Math.round(yv) + '万</text>' +
            '<text x="' + X(xv) + '" y="' + (H-16) + '" font-size="8" fill="#888" text-anchor="middle">' + Math.round(xv) + 'm²</text>'; }
    fr.forEach(r => { el += '<circle cx="' + X(r.land_m2) + '" cy="' + Y(r.price_man) + '" r="3" fill="' + ageColor(r.age_y) + '" fill-opacity="0.55"><title>' + r.quarter + ' ' + r.district + ' ' + r.price_man + '万 土地' + r.land_m2 + '/延床' + r.floor_m2 + '/築' + r.age_y + '年</title></circle>'; });
    el += AGE_COLORS.map((c,i) => '<circle cx="' + (P+8+i*98) + '" cy="10" r="4" fill="' + c[1] + '"/><text x="' + (P+16+i*98) + '" y="13" font-size="8.5" fill="#444">' + c[0] + '</text>').join("");
    $("scatter").innerHTML = svgOpen(W,H) + el + '</svg>';
  }

  function drawTimeseries(fr) {
    const W = 460, H = 300, P = 46;
    const qs = [...new Set(fr.map(r => r.quarter))].sort();
    if (!qs.length) { $("timeseries").innerHTML = svgOpen(W,H) + '</svg>'; return; }
    const yMax = Math.max(...fr.map(r => r.price_man)) * 1.05;
    const X = q => P + qs.indexOf(q) / Math.max(1, qs.length - 1) * (W - P - 14);
    const Y = v => H - 30 - (v / yMax) * (H - 45);
    let el = "";
    for (let i = 1; i <= 4; i++) { const yv = yMax*i/4; el += '<line x1="' + P + '" y1="' + Y(yv) + '" x2="' + (W-14) + '" y2="' + Y(yv) + '" stroke="#EEE"/><text x="4" y="' + (Y(yv)+3) + '" font-size="8" fill="#888">' + Math.round(yv) + '万</text>'; }
    qs.forEach((q,i) => { if (i % 2 === 0) el += '<text x="' + X(q) + '" y="' + (H-16) + '" font-size="7.5" fill="#888" text-anchor="middle">' + q + '</text>'; });
    fr.forEach(r => { el += '<circle cx="' + (X(r.quarter) + (Math.random()*0-0)) + '" cy="' + Y(r.price_man) + '" r="2.5" fill="#2E6E8E" fill-opacity="0.35"><title>' + r.quarter + ' ' + r.district + ' ' + r.price_man + '万</title></circle>'; });
    const pts = qs.map(q => X(q) + ',' + Y(med(fr.filter(r => r.quarter === q).map(r => r.price_man))));
    el += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="#C93A2B" stroke-width="2"/>';
    $("timeseries").innerHTML = svgOpen(W,H) + el + '</svg>';
  }

  function render() {
    const fr = filtered().sort((a,b) => {
      const k = S.sortK, va = k === "unit" ? unitOf(a) : a[k], vb = k === "unit" ? unitOf(b) : b[k];
      return (va < vb ? -1 : va > vb ? 1 : 0) * S.sortDir;
    });
    $("stats").textContent = fr.length + "件 / 総額中央値 " + (med(fr.map(r=>r.price_man)) ?? "—") + "万 / 土地単価中央値 " + (fr.length ? Math.round(med(fr.map(unitOf))) : "—") + "万/坪";
    $("dealTable").querySelector("tbody").innerHTML = fr.map(r =>
      '<tr><td>' + r.quarter + '</td><td>' + r.district + '</td><td class="num">' + r.price_man.toLocaleString() + '万</td>' +
      '<td class="num">' + r.land_m2 + '</td><td class="num">' + r.floor_m2 + '</td><td class="num">' + r.age_y + '</td>' +
      '<td class="num">' + r.walk_min + '</td><td class="num">' + Math.round(unitOf(r)) + '万/坪</td>' +
      '<td title="' + (r.vnote || "") + '">' + (VB[r.verification] || "-") + '</td>' +
      '<td style="font-size:.7rem;white-space:nowrap"><a href="' + r.source_primary + '" target="_blank" rel="noopener noreferrer">一次↗</a> <a href="' + r.source_secondary + '" target="_blank" rel="noopener noreferrer">第二↗</a>' + (r.mlit_ref ? '<div class="note" style="margin-top:0">原典ID:' + r.mlit_ref.split("@")[0] + '</div>' : '') + '</td></tr>').join("");
    drawScatter(fr); drawTimeseries(fr);
  }
  render();
  </script>`;

  return layout({
    title: "成約データ台帳 ── 検証と探索",
    subtitle: "査定が立脚する全成約レコードの出所・二重照合結果・分布を開示する",
    docNo: `成約データ台帳<br>検証日 ${esc(verification?.generated_at ?? "—")} / 査定基準日 ${asOf}`,
    body,
  });
}
