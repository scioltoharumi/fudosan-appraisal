// site/templates/index.js — 物件一覧ダッシュボード(F3-1: 乖離額ソート)
import { fmtMan } from "../../engine/appraise.js";
import { layout, esc, STATUS_LABEL, fmtDate, safeUrl } from "./layout.js";

export function renderIndex(results, { asOf }) {
  // 乖離額の昇順 = 割安順(マイナスほど売出が査定より安い)
  const sorted = [...results].sort((a, b) => a.r.premium - b.r.premium);
  const rows = sorted.map(({ r, property }) => {
    const v = r.verdict;
    const status = STATUS_LABEL[property.status] || property.status;
    const ph = property.price_history || [];
    const priceDate = ph.length ? fmtDate(ph[ph.length - 1].date) : "—";
    return `<tr>
      <td><span class="badge ${v.cls}">${v.mark}</span></td>
      <td><a href="property/${esc(r.id)}.html">${esc(property.location?.address ?? r.id)}</a><div class="note" style="margin-top:0">${esc(r.id)} / 徒歩${esc(property.station?.walk_min)}分 / 取得 ${esc(fmtDate(property.captured_at))}${safeUrl(property.source_url) ? ` / <a href="${esc(property.source_url)}" target="_blank" rel="noopener noreferrer">掲載元↗</a>` : ""}</div></td>
      <td><span class="status">${esc(status)}</span></td>
      <td class="num">${fmtMan(r.state.ask)}<div class="note" style="margin-top:0">${esc(priceDate)}時点${ph.length > 1 ? ` / 改定${ph.length - 1}回` : ""}</div></td>
      <td class="num">${fmtMan(r.mid.fair)}</td>
      <td class="num"${r.premium > 0 ? ' style="color:var(--stamp)"' : ""}>${r.premium >= 0 ? "+" : ""}${fmtMan(r.premium)}</td>
      <td class="num">${Math.round(r.state.ask / r.mid.tsubo).toLocaleString("en-US")}万/坪</td>
      <td class="num">${r.assumptions.length}件</td>
    </tr>`;
  }).join("");

  const body = `
  <div class="panel">
    <h2>物件一覧(乖離額の小さい順 = 割安順)</h2>
    <div class="note" style="margin:0 0 10px">はじめての方へ: 査定値の出所(公示地価・坪単価・建物22年ルール・判定スタンプの意味)は <a href="guide.html">査定の読み方 ── 前提知識ガイド</a> で実物件を題材に解説しています。</div>
    <div style="overflow-x:auto">
    <table class="list">
      <tr><th>判定</th><th>物件</th><th>状態</th><th>売出価格</th><th>適正中央値</th><th>乖離</th><th>実質坪単価</th><th>仮定</th></tr>
      ${rows}
    </table>
    </div>
    <div class="note">乖離 = 売出価格 − 査定中央値。判定の根拠は各物件の詳細ページ「算出根拠の全文開示」を参照。<br>
    売出価格の下の日付は媒体で当該価格を確認した時点(情報提供日)、「取得」は台帳への登録日。査定値は全物件とも査定基準日 ${asOf} 時点で再計算している。</div>
    <div class="meta-line">査定基準日 ${asOf} / 掲載 ${results.length}件 / 本サイトは個人の検討用簡易査定であり、不動産鑑定評価・投資助言ではありません。</div>
  </div>`;

  return layout({
    title: "中古戸建 査定台帳",
    subtitle: "赤羽エリア ── 売出価格を土地値・解体費・建物残価・繰延修繕に分解し、資産毀損リスクを可視化する",
    docNo: `候補物件の比較検討台帳<br>査定基準日 ${asOf}`,
    body,
  });
}
