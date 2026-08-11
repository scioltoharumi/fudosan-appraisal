// site/templates/index.js — 物件一覧ダッシュボード(F3-1: 乖離額ソート)
import { fmtMan, pct } from "../../engine/appraise.js";
import { layout, esc, STATUS_LABEL, fmtDate, safeUrl } from "./layout.js";

// ---- 成約実勢との突き合わせ(較正状態)パネル ----
// 「公示ベース査定は市場と無関係」批判への回答: エリアごとに採用単価と成約実勢を並べ、乖離を開示する
function calibrationPanel(results, cal) {
  if (!cal) return "";
  // 台帳で実際に使われている(エリア, 採用単価)の組を集める
  const usedByArea = new Map();
  for (const { rRef, property } of results) {
    const area = property.location?.area;
    if (!usedByArea.has(area)) usedByArea.set(area, new Set());
    usedByArea.get(area).add(Math.round(rRef.state.ppt));
  }
  const rows = [];
  for (const [area, ppts] of usedByArea) {
    const a = cal.byArea[area];
    for (const used of [...ppts].sort((x, y) => x - y)) {
      if (!a?.chosen) {
        rows.push(`<tr><td>${esc(area)}</td><td class="num">${used}万/坪</td><td>データ不足</td><td class="num">—</td><td>成約データ未整備</td></tr>`);
        continue;
      }
      const gap = a.chosen.ppt / used - 1;
      const adopted = a.chosen.level !== "reference";
      const view = adopted
        ? "較正値を本査定の土地単価として採用済み(2026-08第2次監査で本体接続)"
        : "信頼度不足(極小標本)のため未採用。従来値で査定し、較正値は参考表示";
      rows.push(`<tr>
        <td>${esc(area)}</td>
        <td class="num">${used}万/坪</td>
        <td>${a.chosen.ppt}万/坪<div class="note" style="margin-top:0">${esc(a.chosen.basis)} / 信頼度:${esc(a.chosen.confidence)}</div></td>
        <td class="num"${gap < -0.08 ? ' style="color:var(--stamp)"' : ""}>${pct(gap)}</td>
        <td style="font-size:.75rem">${view}</td>
      </tr>`);
    }
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

export function renderIndex(results, { asOf, cal = null }) {
  // 乖離額の昇順 = 割安順(マイナスほど売出が査定より安い)
  const sorted = [...results].sort((a, b) => a.r.premium - b.r.premium);
  const rows = sorted.map(({ r, property, hasMarketPage }) => {
    const v = r.verdict;
    const status = STATUS_LABEL[property.status] || property.status;
    const ph = property.price_history || [];
    const priceDate = ph.length ? fmtDate(ph[ph.length - 1].date) : "—";
    return `<tr>
      <td><span class="badge ${v.cls}">${v.mark}</span></td>
      <td><a href="property/${esc(r.id)}.html">${esc(property.location?.address ?? r.id)}</a><div class="note" style="margin-top:0">${esc(r.id)} / ${esc(property.layout ?? "—")} / 築${r.state.age.toFixed(1)}年 / 徒歩${esc(property.station?.walk_min)}分 / 取得 ${esc(fmtDate(property.captured_at))}${safeUrl(property.source_url) ? ` / <a href="${esc(property.source_url)}" target="_blank" rel="noopener noreferrer">掲載元↗</a>` : ""}</div></td>
      <td><span class="status">${esc(status)}</span></td>
      <td class="num">${fmtMan(r.state.ask)}<div class="note" style="margin-top:0">${esc(priceDate)}時点${ph.length > 1 ? ` / 改定${ph.length - 1}回` : ""}</div></td>
      <td class="num">${fmtMan(r.fairFinal.mid)}</td>
      <td class="num">${r.retail && hasMarketPage ? `<a href="property/${esc(r.id)}-market.html">${fmtMan(r.retail.mid)}</a>` : r.retail ? fmtMan(r.retail.mid) : "—"}</td>
      <td class="num"${r.premium > 0 ? ' style="color:var(--stamp)"' : ""}>${r.premium >= 0 ? "+" : ""}${fmtMan(r.premium)}</td>
      <td class="num">${Math.round(r.state.ask / r.mid.tsubo).toLocaleString("en-US")}万/坪</td>
      <td class="num">${r.assumptions.length}件</td>
    </tr>`;
  }).join("");

  const body = `
  <div class="panel">
    <h2>物件一覧(乖離額の小さい順 = 割安順)</h2>
    <div class="note" style="margin:0 0 10px">はじめての方へ: 「総額 = 土地単価×坪数 + 建物残価 + 売主の期待」という値段の構造は <a href="formula.html">値段の解剖 ── 算出ロジック図解</a> が1ページで図解しています。査定値の出所(公示地価・坪単価・建物残価・リテール比較法・判定スタンプの意味)は <a href="guide.html">査定の読み方 ── 前提知識ガイド</a>、成約データ全件は <a href="data.html">成約データ台帳(検証と探索)</a> で出所リンク・二重照合結果つきで確認できます。</div>
    <div style="overflow-x:auto">
    <table class="list">
      <tr><th>判定</th><th>物件</th><th>状態</th><th>売出価格</th><th>適正中央値</th><th>リテール比較中央値</th><th>乖離</th><th>実質坪単価</th><th>仮定</th></tr>
      ${rows}
    </table>
    </div>
    <div class="note">乖離 = 売出価格 − 適正中央値(原価法とリテール比較法の重み付き調整・土地値下限)。リテール比較中央値 = 周辺の戸建成約(国交省データ)から時点・徒歩・築年差を補正した実需市場の水準(クリックで根拠ページへ)。判定の根拠は各物件の詳細ページ「算出根拠の全文開示」を参照。<br>
    売出価格の下の日付は媒体で当該価格を確認した時点(情報提供日)、「取得」は台帳への登録日。査定値は全物件とも査定基準日 ${asOf} 時点で再計算している。</div>
    <div class="meta-line">査定基準日 ${asOf} / 掲載 ${results.length}件 / 本サイトは個人の検討用簡易査定であり、不動産鑑定評価・投資助言ではありません。</div>
  </div>
  ${calibrationPanel(results, cal)}`;

  return layout({
    title: "中古戸建 査定台帳",
    subtitle: "赤羽エリア ── 売出価格を土地値・解体費・建物残価・繰延修繕に分解し、資産毀損リスクを可視化する",
    docNo: `候補物件の比較検討台帳<br>査定基準日 ${asOf}`,
    body,
  });
}
