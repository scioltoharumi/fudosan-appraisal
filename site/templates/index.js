// site/templates/index.js — 物件一覧ダッシュボード(F3-1: 乖離額ソート)
import { fmtMan, pct } from "../../engine/appraise.js";
import { layout, esc, STATUS_LABEL, STATUS_CHOICES, fmtDate, safeUrl } from "./layout.js";

// ---- 成約実勢との突き合わせ(較正状態)パネル ----
// 「公示ベース査定は市場と無関係」批判への回答: エリアごとに採用単価と成約実勢を並べ、乖離を開示する
function calibrationPanel(results, cal) {
  if (!cal) return "";
  // 台帳で実際に使われている(エリア, 採用単価)の組を集める。同一エリアでも用途地域が違えば
  // 採用単価が分かれるため(例: 十条仲原=近隣商業300 / 1種中高230)、単価ごとに行を分ける。
  // ただしエリア名・較正値・所見は全行で同じなのでrowspanで束ね、重複表示に見えないようにする
  const usedByArea = new Map();
  for (const { rRef, property } of results) {
    const area = property.location?.area;
    if (!usedByArea.has(area)) usedByArea.set(area, new Map());
    const byPpt = usedByArea.get(area);
    const ppt = Math.round(rRef.state.ppt);
    if (!byPpt.has(ppt)) byPpt.set(ppt, []);
    byPpt.get(ppt).push({ addr: property.location?.address ?? rRef.id, zoning: property.land?.legal?.zoning });
  }
  const rows = [];
  for (const [area, byPpt] of usedByArea) {
    const a = cal.byArea[area];
    const ppts = [...byPpt.keys()].sort((x, y) => x - y);
    const span = ppts.length;
    ppts.forEach((used, i) => {
      const users = byPpt.get(used);
      // 同一エリア内で単価が分かれる場合のみ、どの物件がその単価を使っているかを添える
      const who = span > 1
        ? `<div class="note" style="margin-top:0">${users.map((u) => esc(u.addr) + (u.zoning ? `(${esc(u.zoning)})` : "")).join(" / ")}</div>`
        : "";
      const areaCell = i === 0
        ? `<td rowspan="${span}" style="vertical-align:top">${esc(area)}${span > 1 ? `<div class="note" style="margin-top:0">用途地域差で採用単価が${span}通り</div>` : ""}</td>`
        : "";
      if (!a?.chosen) {
        rows.push(`<tr>${areaCell}<td class="num">${used}万/坪${who}</td>` +
          (i === 0 ? `<td rowspan="${span}" style="vertical-align:top">データ不足</td>` : "") +
          `<td class="num">—</td>` +
          (i === 0 ? `<td rowspan="${span}" style="vertical-align:top">成約データ未整備</td>` : "") + `</tr>`);
        return;
      }
      const gap = a.chosen.ppt / used - 1;
      const adopted = a.chosen.level !== "reference";
      const view = adopted
        ? "較正値を本査定の土地単価として採用済み(2026-08第2次監査で本体接続)"
        : "信頼度不足(極小標本)のため未採用。従来値で査定し、較正値は参考表示";
      rows.push(`<tr>
        ${areaCell}
        <td class="num">${used}万/坪${who}</td>
        ${i === 0 ? `<td rowspan="${span}" style="vertical-align:top">${a.chosen.ppt}万/坪<div class="note" style="margin-top:0">${esc(a.chosen.basis)} / 信頼度:${esc(a.chosen.confidence)}</div></td>` : ""}
        <td class="num"${gap < -0.08 ? ' style="color:var(--stamp)"' : ""}>${pct(gap)}</td>
        ${i === 0 ? `<td rowspan="${span}" style="vertical-align:top;font-size:.75rem">${view}</td>` : ""}
      </tr>`);
    });
  }
  const dealRows = Object.values(cal.byArea).flatMap((a) => a.deals.rows).sort((x, y) => String(y.date).localeCompare(String(x.date)));
  const dealTable = dealRows.map((d) =>
    `<tr><td>${esc(String(d.date).slice(0, 7))}</td><td>${esc(d.district)}</td><td class="num">${fmtMan(d.price_man)}</td><td class="num">${d.land_tsubo}坪</td><td class="num">${d.ppt_man}万/坪</td><td>徒歩${d.walk_min}分・${esc(d.shape)}・${esc(d.zoning)}</td><td class="num">${Math.round(d.ppt_norm)}万/坪</td></tr>`).join("");
  return `
  <div class="panel">
    <h2>成約実勢との突き合わせ ── この査定は市場価格とズレていないか</h2>
    <div class="logic-body">
      <p class="why">実際の売買は成約事例ベースで値付けされるため、「公示地価から積み上げた本査定は市場と無関係に安く出るのでは」という批判が成り立ちうる。その検証として、国交省 不動産取引価格情報(再掲)の実成約を<b>標準地条件・2025年1月基準に正規化</b>し、本査定の採用単価と突き合わせた結果が下表。乖離が大きいエリアは採用単価の見直し候補になる。</p>
      <div style="overflow-x:auto">
      <table class="list">
        <tr><th>エリア</th><th>従来単価(公示×実勢係数)</th><th>成約較正値</th><th>乖離</th><th>採用状況</th></tr>
        ${rows.join("")}
      </table>
      </div>
      <div class="note" style="margin-top:10px"><b>監査の反映状況</b>: 第1次監査で「土地仕入れ値モデルは実需市場を捕捉できない」欠陥が、第2次監査(鑑定士視点)で「max採用の上振れ・地域要因未補正・較正未接続」が指摘された。現在は①土地単価に成約較正値を採用(下表)、②戸建成約のリテール比較を地区水準補正つきで併算、③両者を事例数に応じた重み付きで調整、という構成。振り子を両側から較正した結果であり、それでも残る不確実性はレンジと信頼度ラベルで開示する。</div>
      <details style="margin-top:12px;font-size:.8rem">
        <summary>個別成約の一覧(${dealRows.length}件・2022年以降)と正規化方法</summary>
        <div style="overflow-x:auto;margin-top:8px">
        <table class="list">
          <tr><th>時期</th><th>地区</th><th>総額</th><th>面積</th><th>成約坪単価</th><th>属性</th><th>正規化後</th></tr>
          ${dealTable}
        </table>
        </div>
        <div class="note">正規化 = 成約坪単価 ÷ (1+徒歩補正+形状補正) ÷ 時点係数(年次別の地価上昇率・2025年1月基準)。方位・接道の質は成約データに属性がないため未補正。出典: 国交省 不動産取引価格情報の再掲(utinokati.com、取得2026-08-09)。地区平均ベンチマークは旗竿地・古家付き・業者仕入れも含む混合平均のため標準整形地より10〜20%低めに出る傾向があり、採用時は+10%の混合平均補正を掛けている(2026-08監査)。</div>
      </details>
    </div>
  </div>`;
}

// ---- ハザードの見出しタグ ----
// 公式マップ(国土地理院タイル)で掲載条件を外れたものを最優先で出す。次に掲載欄の未検証。
// 2026-08-13: 掲載の法令等制限欄には洪水浸水想定が載らないため、志茂1・志茂3が
// 「suumo: none / athome: none」のまま台帳に残っていた(実測3〜5m / 5〜10m)。同じ穴を再発させない
function hazardTag(property) {
  const h = property.hazard_check;
  if (!h) return "";
  const o = h.official ?? null;
  if (o?.verdict === "block") {
    return `<span class="unit-tag" style="border-color:var(--stamp);color:#fff;background:var(--stamp);font-weight:700">ハザード該当(掲載条件外)</span>`;
  }
  const tags = [];
  if (o?.verdict === "caution") tags.push(`<span class="unit-tag" style="border-color:#B07C10;color:#B07C10;background:#FDFAF2">公式マップ要確認</span>`);
  if (h.athome === "unchecked" || h.suumo === "unchecked") tags.push(`<span class="unit-tag" style="border-color:var(--stamp);color:var(--stamp);background:#FDF4F3">掲載欄ハザード未検証</span>`);
  return tags.join("");
}

export function renderIndex(results, { asOf, cal = null }) {
  // 乖離額の昇順 = 割安順。リテール成立物件は対市場実勢(売主の期待)、
  // 不成立物件は対適正中央値で並べる
  const divergence = (r) => r.premiumMarket ?? r.premium;
  const sorted = [...results].sort((a, b) => divergence(a.r) - divergence(b.r));
  const SORDER = Object.fromEntries(STATUS_CHOICES.map((v, i) => [v, i]));
  const rows = sorted.map(({ r, property, hasMarketPage }) => {
    // YAMLの status がサイト初期値。一覧上で人が変えた値はブラウザに保存され、これを上書きする
    const seed = STATUS_LABEL[property.status] || STATUS_CHOICES[0];
    const ph = [...(property.price_history || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
    const priceDate = ph.length ? fmtDate(ph[ph.length - 1].date) : "—";
    // 値下げ(値上げ)の明記: 初値→現在価格の累計差と率を2行目に表示。▼=値下げ(買い手に有利)/▲=値上げ
    let reviseNote = "";
    if (ph.length > 1) {
      const first = ph[0].price_man, last = ph[ph.length - 1].price_man, diff = last - first;
      reviseNote = diff === 0 ? `・改定${ph.length - 1}回(同値)` :
        `・改定${ph.length - 1}回<br>初値${fmtMan(first)} <span style="color:${diff < 0 ? "#2E6E8E" : "var(--stamp)"};font-weight:700">${diff < 0 ? "▼" : "▲"}${fmtMan(Math.abs(diff))}(${diff < 0 ? "" : "+"}${(100 * diff / first).toFixed(1)}%)</span>`;
    }
    const opts = STATUS_CHOICES.map((v) => `<option value="${esc(v)}"${v === seed ? " selected" : ""}>${esc(v)}</option>`).join("");
    return `<tr class="prow" data-id="${esc(r.id)}" data-seed="${esc(seed)}" data-status="${esc(seed)}" data-sord="${SORDER[seed] ?? 9}"
      data-price="${Math.round(r.state.ask)}" data-market="${r.retail ? Math.round(r.retail.mid) : -1}"
      data-div="${Math.round(divergence(r))}" data-assump="${r.assumptions.length}" data-fair="${Math.round(r.fairFinal.mid)}"
      data-name="${esc(property.location?.address ?? r.id)}">
      <td><a href="property/${esc(r.id)}.html">${esc(property.location?.address ?? r.id)}</a>${property.unit_label ? `<span class="unit-tag">${esc(property.unit_label)}</span>` : ""}${hazardTag(property)}<div class="note" style="margin-top:0">${esc(property.layout ?? "—")} / 土地${esc(property.land?.registered_m2)}m²・延床${esc(property.building?.floor_m2)}m² / ${r.isNewBuild ? `完成${esc(fmtDate(property.building?.built)).slice(0, 7)}` : `築${r.state.age.toFixed(1)}年`} / 徒歩${esc(property.station?.walk_min)}分${safeUrl(property.source_url) ? ` / <a href="${esc(property.source_url)}" target="_blank" rel="noopener noreferrer">掲載元↗</a>` : ""}</div></td>
      <td><select class="stsel" aria-label="${esc(property.location?.address ?? r.id)}のステータス">${opts}</select><span class="unsync" title="台帳(リポジトリ)の値と違います。書き出して反映してください">未同期</span></td>
      <td class="num">${fmtMan(r.state.ask)}<div class="note" style="margin-top:0">${esc(priceDate)}時点${reviseNote}</div></td>
      <td class="num">${r.retail && hasMarketPage ? `<a href="property/${esc(r.id)}-market.html">${fmtMan(r.retail.mid)}</a>` : r.retail ? fmtMan(r.retail.mid) : "—"}</td>
      <td class="num"${divergence(r) > 0 ? ' style="color:var(--stamp)"' : ""}>${divergence(r) >= 0 ? "+" : ""}${fmtMan(divergence(r))}</td>
      <td class="num">${r.assumptions.length}件</td>
      <td class="num">${fmtMan(r.fairFinal.mid)}</td>
      <td><button class="memobtn" type="button">メモ</button></td>
    </tr>
    <tr class="mrow" data-id="${esc(r.id)}" hidden><td colspan="8"><textarea class="memota" placeholder="この物件のメモ(内見の所感・確認事項・交渉の材料など)。この端末のブラウザにのみ保存され、公開リポジトリには入りません"></textarea></td></tr>`;
  }).join("");

  const body = `
  <div class="panel">
    <h2>物件一覧(乖離額の小さい順 = 割安順)</h2>
    <div class="cond-banner"><b>台帳掲載の条件</b>: 価格 5,000〜9,000万円 / 台地側(荒川低地の浸水想定域外)/ 所有権(借地権は除外)/ 延床70m²超 / 3室以上(納戸・サービスルーム可)/ 新耐震基準 / 再建築可 ── 赤羽駅西側・十条エリアの中古/新築戸建をSUUMO日次クロール+チラシで収集(ハザードの個別確認は検討段階で実施)</div>
    <div class="cond-banner" style="border-color:var(--ink-soft);background:#FBFAF8"><b>この台帳は「買い/見送り」の判定を出しません</b>: 同じ数字でも通勤・家族構成・ローン余力・時間軸で結論は変わるため、判断は人が行います。エンジンが出すのは売出価格が各参照水準(市場実勢中央値・上位四分位・適正レンジ・土地換算値)のどこに立っているかという事実までです。検討状況は下表の<b>ステータス</b>で自分で設定してください(<a href="guide.html">参照水準の読み方</a>)。</div>
    <div class="note" style="margin:0 0 10px">はじめての方へ: 「総額 = 土地単価×坪数 + 建物残価 + 売主の期待」という値段の構造は <a href="formula.html">値段の解剖 ── 算出ロジック図解</a> が1ページで図解しています。査定値の出所(公示地価・坪単価・建物残価・リテール比較法・参照水準の意味)は <a href="guide.html">査定の読み方 ── 前提知識ガイド</a>、成約データ全件は <a href="data.html">成約データ台帳(検証と探索)</a> で出所リンク・二重照合結果つきで確認できます。希望条件(間取り・設備等)を金額換算して妥協判断する方法は <a href="tradeoff.html">妥協の値段 ── A/B/C分類と工事費早見表</a> にまとめています。</div>
    <div class="filterbar">
      <span class="flabel">ステータス</span>${STATUS_CHOICES.map((v) => `<button class="chip" data-f="status" data-val="${esc(v)}">${esc(v)}</button>`).join("")}
      <button class="chip" data-f="memo" data-val="1" style="margin-left:10px">メモあり</button>
      <button class="chip" id="freset" style="margin-left:10px">リセット</button>
      <span class="note" id="fcount" style="margin:0 0 0 6px"></span>
    </div>
    <div class="syncbar">
      <span class="flabel">記録の同期</span>
      <button class="syncbtn" type="button" id="expbtn">書き出し(コピー)</button>
      <a class="syncbtn" id="dlbtn" download="fudosan-ledger.json" href="#">ファイルに保存</a>
      <button class="syncbtn" type="button" id="impbtn">読み込み</button>
      <button class="syncbtn" type="button" id="clrbtn">この端末の記録を消す</button>
      <span class="note" id="syncinfo" style="margin:0 0 0 6px"></span>
    </div>
    <div class="syncpanel" id="imppanel" hidden>
      別の端末で「書き出し」したJSONを貼り付けて<b>読み込む</b>と、ステータスとメモがこの端末に入ります(同じIDは貼り付けた側で上書き)。
      <textarea id="impta" placeholder='{"v":1,"items":{...}}'></textarea>
      <div style="margin-top:6px"><button class="syncbtn" type="button" id="impapply">この内容を取り込む</button>
      <span class="note" id="impmsg" style="margin-left:8px"></span></div>
    </div>
    <div style="overflow-x:auto">
    <table class="list" id="ptable">
      <tr>
        <th class="sortable" data-key="name">物件 <span class="arw">↕</span></th>
        <th class="sortable" data-key="sord" data-num="1">ステータス <span class="arw">↕</span></th>
        <th class="sortable" data-key="price" data-num="1">売出価格 <span class="arw">↕</span></th>
        <th class="sortable" data-key="market" data-num="1">市場実勢中央値 <span class="arw">↕</span></th>
        <th class="sortable" data-key="div" data-num="1">乖離(対市場) <span class="arw">↕</span></th>
        <th class="sortable" data-key="assump" data-num="1">仮定 <span class="arw">↕</span></th>
        <th class="sortable" data-key="fair" data-num="1">適正中央値(参考) <span class="arw">↕</span></th>
        <th>メモ</th>
      </tr>
      ${rows}
    </table>
    </div>
    <script>
    (function(){
      var KEY = "fudosan-ledger-v1";
      var ORDER = ${JSON.stringify(Object.fromEntries(STATUS_CHOICES.map((v, i) => [v, i])))};
      var table = document.getElementById("ptable");
      var tbody = table.tBodies[0] || table;   // ソートで行を並べ替える先(ブラウザが自動生成するtbody)
      var prows = Array.prototype.slice.call(table.querySelectorAll("tr.prow"));
      var mrowOf = {};
      Array.prototype.forEach.call(table.querySelectorAll("tr.mrow"), function(tr){ mrowOf[tr.dataset.id] = tr; });

      // ---- 保存(この端末のブラウザのみ。公開リポジトリには入らない) ----
      function load(){
        try { var o = JSON.parse(localStorage.getItem(KEY)); if (o && o.items) return o; } catch(e){}
        return { v:1, items:{} };
      }
      function save(st){
        st.v = 1; st.updated = new Date().toISOString();
        try { localStorage.setItem(KEY, JSON.stringify(st)); } catch(e){ info("保存できません(ブラウザの設定で localStorage が無効です)"); }
        render();
      }
      var state = load();
      function entry(id){ return state.items[id] || (state.items[id] = {}); }

      function info(msg){
        var n = 0;
        prows.forEach(function(tr){ if (tr.classList.contains("dirty")) n++; });
        document.getElementById("syncinfo").textContent =
          msg || ((state.updated ? "最終更新 " + state.updated.slice(0,16).replace("T"," ") + " / " : "") +
                  (n ? "台帳と違うステータス " + n + "件(書き出して反映)" : "台帳と一致"));
      }

      // ---- 画面へ反映 ----
      function render(){
        prows.forEach(function(tr){
          var id = tr.dataset.id, e = state.items[id] || {};
          var st = e.status || tr.dataset.seed;
          var sel = tr.querySelector(".stsel");
          if (sel.value !== st) sel.value = st;
          tr.dataset.status = st;
          tr.dataset.sord = (ORDER[st] === undefined ? 9 : ORDER[st]);
          tr.classList.toggle("dirty", st !== tr.dataset.seed);
          var memo = e.memo || "";
          var ta = mrowOf[id].querySelector(".memota");
          if (ta.value !== memo) ta.value = memo;
          var btn = tr.querySelector(".memobtn");
          btn.classList.toggle("has", !!memo.trim());
          btn.textContent = memo.trim() ? "メモ✓" : "メモ";
          tr.dataset.memo = memo.trim() ? "1" : "0";
        });
        info();
        apply();
      }

      // ---- 入力 ----
      prows.forEach(function(tr){
        var id = tr.dataset.id;
        tr.querySelector(".stsel").addEventListener("change", function(ev){
          entry(id).status = ev.target.value; entry(id).at = new Date().toISOString(); save(state);
        });
        tr.querySelector(".memobtn").addEventListener("click", function(){
          var m = mrowOf[id];
          m.hidden = !m.hidden;
          if (!m.hidden) m.querySelector(".memota").focus();
        });
        var ta = mrowOf[id].querySelector(".memota");
        var t = null;
        ta.addEventListener("input", function(){
          clearTimeout(t);
          t = setTimeout(function(){
            var v = ta.value;
            if (v.trim()) { entry(id).memo = v; entry(id).at = new Date().toISOString(); }
            else if (state.items[id]) delete state.items[id].memo;
            save(state);
          }, 400);
        });
      });

      // ---- フィルタ(ステータス/メモ有無) ----
      var active = { status: new Set(), memo: new Set() };
      function apply(){
        var shown = 0;
        prows.forEach(function(tr){
          var ok = (!active.status.size || active.status.has(tr.dataset.status)) &&
                   (!active.memo.size || tr.dataset.memo === "1");
          tr.style.display = ok ? "" : "none";
          var m = mrowOf[tr.dataset.id];
          if (!ok) { m.style.display = "none"; } else { m.style.display = ""; }
          if (ok) shown++;
        });
        document.getElementById("fcount").textContent = shown === prows.length ? "" : shown + "/" + prows.length + "件を表示中";
      }
      document.querySelectorAll(".chip[data-f]").forEach(function(ch){
        ch.addEventListener("click", function(){
          var set = active[ch.dataset.f];
          if (set.has(ch.dataset.val)) { set.delete(ch.dataset.val); ch.classList.remove("on"); }
          else { set.add(ch.dataset.val); ch.classList.add("on"); }
          apply();
        });
      });
      document.getElementById("freset").addEventListener("click", function(){
        active.status.clear(); active.memo.clear();
        document.querySelectorAll(".chip.on").forEach(function(c){ c.classList.remove("on"); });
        apply();
      });

      // ---- ソート(メモ行は必ず対応する物件行の直後へ動かす) ----
      var dir = {};
      document.querySelectorAll("th.sortable").forEach(function(th){
        th.addEventListener("click", function(){
          var k = th.dataset.key, num = !!th.dataset.num;
          dir[k] = -(dir[k] || -1);   // 初回クリックは昇順
          prows.sort(function(a, b){
            var av = a.dataset[k], bv = b.dataset[k];
            var c = num ? (Number(av) - Number(bv)) : String(av).localeCompare(String(bv), "ja");
            return c * dir[k];
          });
          prows.forEach(function(tr){ tbody.appendChild(tr); tbody.appendChild(mrowOf[tr.dataset.id]); });
          document.querySelectorAll("th.sortable .arw").forEach(function(s){ s.textContent = "↕"; });
          th.querySelector(".arw").textContent = dir[k] > 0 ? "↑" : "↓";
        });
      });

      // ---- 書き出し / 読み込み ----
      function json(){ return JSON.stringify(state, null, 2); }
      document.getElementById("expbtn").addEventListener("click", function(){
        var t = json();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(t).then(function(){ info("クリップボードにコピーしました"); setTimeout(info, 2500); },
            function(){ showPanel(t); });
        } else { showPanel(t); }
      });
      function showPanel(t){
        var p = document.getElementById("imppanel");
        p.hidden = false;
        var ta = document.getElementById("impta");
        ta.value = t; ta.focus(); ta.select();
        info("コピーできない環境のため、上の欄の内容を手動でコピーしてください");
      }
      document.getElementById("dlbtn").addEventListener("click", function(ev){
        ev.currentTarget.href = "data:application/json;charset=utf-8," + encodeURIComponent(json());
      });
      document.getElementById("impbtn").addEventListener("click", function(){
        var p = document.getElementById("imppanel"); p.hidden = !p.hidden;
      });
      document.getElementById("impapply").addEventListener("click", function(){
        var msg = document.getElementById("impmsg");
        try {
          var o = JSON.parse(document.getElementById("impta").value);
          if (!o || typeof o.items !== "object" || !o.items) throw new Error("items がありません");
          var n = 0;
          Object.keys(o.items).forEach(function(id){
            var e = o.items[id];
            if (!e || typeof e !== "object") return;
            var cur = entry(id);
            if (typeof e.status === "string" && ORDER[e.status] !== undefined) { cur.status = e.status; n++; }
            if (typeof e.memo === "string") { cur.memo = e.memo; n++; }
            if (typeof e.at === "string") cur.at = e.at;
          });
          save(state);
          msg.textContent = n + "項目を取り込みました";
        } catch(err) { msg.textContent = "読み込めません: " + err.message; }
      });
      document.getElementById("clrbtn").addEventListener("click", function(){
        if (!confirm("この端末に保存したステータスとメモを全部消します。書き出していない内容は戻せません。よろしいですか?")) return;
        try { localStorage.removeItem(KEY); } catch(e){}
        state = { v:1, items:{} };
        render();
      });

      render();
    })();
    </script>
    <div class="note"><b>ステータスとメモの保存先</b>: この端末のブラウザ(localStorage)にのみ保存されます。<b>公開リポジトリには書き込まれません</b>(メモは個人的な所感・交渉の材料を含みうるため、公開サイトの運用ルールで意図的にこうしています)。別の端末へ移すとき・ブラウザのデータを消す前は「書き出し」でJSONを保存してください。ステータスだけは台帳(YAML)へ反映でき、反映済みの端末では「未同期」の印が消えます。</div>
    <div class="note">乖離(対市場) = 売出価格 − 市場実勢中央値(=売主の期待。リテール比較不成立の物件のみ適正中央値との差)。市場実勢中央値 = 周辺の戸建成約(国交省データ)から時点・徒歩・築年差を補正した実需市場の水準(クリックで根拠ページへ)。適正中央値 = 原価法との重み付き調整で、市場実勢との差は「過熱感=相場調整時の下落余地」を測る参考。各水準の意味と数字の出所は各物件の詳細ページ「算出根拠の全文開示」を参照。<br>
    売出価格の下の日付は媒体で当該価格を確認した時点(情報提供日)、「取得」は台帳への登録日。査定値は全物件とも査定基準日 ${asOf} 時点で再計算している。</div>
    <div class="meta-line">査定基準日 ${asOf} / 掲載 ${results.length}件 / 本サイトは個人の検討用簡易査定であり、不動産鑑定評価・投資助言ではありません。買う/見送るの判定は行いません。</div>
  </div>
  ${calibrationPanel(results, cal)}`;

  return layout({
    title: "中古戸建 査定台帳",
    subtitle: "赤羽エリア ── 売出価格を土地値・解体費・建物残価・繰延修繕に分解し、資産毀損リスクを可視化する",
    docNo: `候補物件の比較検討台帳<br>査定基準日 ${asOf}`,
    body,
  });
}
