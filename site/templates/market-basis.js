// site/templates/market-basis.js — 成約事例ベースの査定根拠ページ(物件別)
// 公示ベースの「算出根拠の全文開示」(物件ページ内)とは別立てで、取引事例比較法の簡易版として
// 事例収集→正規化→代表値→本物件への適用→売出との乖離、を実数値で全文開示する。
import { fmtMan, pct, COEFFS } from "../../engine/appraise.js";
import { layout, esc } from "./layout.js";

const f2 = (n) => n.toFixed(2);

export function renderMarketBasis(r, property, marketCal, areaCal) {
  const { chosen, calR } = marketCal;
  const s = calR.state;                       // 成約ベース再査定の正規化入力(ppt=chosen.ppt)
  const m = calR.mid;
  const addr = property.location?.address ?? r.id;
  const area = property.location?.area;
  const premium = s.ask - calR.fairFinal.mid;
  const premiumRate = s.ask / calR.fairFinal.mid - 1;
  const pptNow = m.pptAdj;
  const barMax = Math.max(s.ask, calR.fairFinal.mid) * 1.05;
  const bar = (v, color) => `<div style="height:22px;background:${color};width:${((v / barMax) * 100).toFixed(1)}%"></div>`;

  // STEP 1-2: 個別成約の正規化テーブル
  const dealRows = (areaCal?.deals.rows ?? []).map((d) => `
    <tr>
      <td>${esc(String(d.date).slice(0, 7))}</td>
      <td>${esc(d.district)}</td>
      <td class="num">${fmtMan(d.price_man)}</td>
      <td class="num">${d.land_tsubo}坪</td>
      <td class="num">${d.ppt_man}万/坪</td>
      <td class="num">${pct(d.walkAdj)}<div class="note" style="margin-top:0">徒歩${d.walk_min}分</div></td>
      <td class="num">${pct(d.shapeAdj)}<div class="note" style="margin-top:0">${esc(d.shape)}</div></td>
      <td class="num">×${d.timeFactor.toFixed(3)}</td>
      <td class="num"><b>${Math.round(d.ppt_norm)}万/坪</b></td>
    </tr>`).join("");

  const benchRows = (areaCal?.benches ?? []).map((b) => `
    <tr>
      <td>${esc(b.district)}<div class="note" style="margin-top:0">${esc(b.period)}${b.caveat ? " ※" + esc(b.caveat) : ""}</div></td>
      <td class="num">${b.n}件</td>
      <td class="num">${b.avg_ppt ?? "—"}万/坪</td>
      <td class="num">${b.median_ppt ?? "—"}万/坪</td>
      <td class="num">${b.avg_base ? Math.round(b.avg_base) + "万/坪" : "補正不能"}</td>
    </tr>`).join("");

  const body = `
  <div style="margin-bottom:12px;font-size:.8rem"><a href="${esc(r.id)}.html">← この物件の査定ページへ</a> / <a href="../index.html">物件一覧へ</a></div>
  <div class="panel">
    <h2>${esc(addr)} ── 成約事例ベースの査定根拠</h2>
    <div class="note">売買の実務は「周辺でいくらで売れたか(成約事例)」を基準に値付けされる。このページはその流儀に合わせ、国交省 不動産取引価格情報(再掲)の実成約から本物件の適正価格を導く過程を全文開示する。公示地価から積み上げる<a href="${esc(r.id)}.html">公示ベースの算出根拠</a>とは独立した、もう1本の物差し。</div>

    <table class="kv" style="margin-top:14px">
      <tr><td>売出価格</td><td>${fmtMan(s.ask)}</td></tr>
      <tr class="em"><td>成約事例ベースの適正中央値(土地較正×リテール比較の統合)</td><td>${fmtMan(calR.fairFinal.mid)}</td></tr>
      <tr class="loss"><td>乖離(売出 − 成約ベース中央値)</td><td>${premium >= 0 ? "+" : ""}${fmtMan(premium)}(${pct(premiumRate)})</td></tr>
    </table>
    <div style="margin-top:10px;max-width:560px">
      <div style="display:flex;align-items:center;gap:8px;font-size:.72rem"><span style="width:110px;text-align:right;color:var(--ink-soft)">売出価格</span><div style="flex:1">${bar(s.ask, "var(--stamp)")}</div><span class="num" style="font-family:var(--mono)">${fmtMan(s.ask)}</span></div>
      <div style="display:flex;align-items:center;gap:8px;font-size:.72rem;margin-top:4px"><span style="width:110px;text-align:right;color:var(--ink-soft)">成約ベース中央値</span><div style="flex:1">${bar(calR.fairFinal.mid, "var(--band)")}</div><span class="num" style="font-family:var(--mono)">${fmtMan(calR.fairFinal.mid)}</span></div>
      <div class="note">赤と青の差 = 周辺の実取引からは説明できない上乗せ幅。</div>
    </div>
  </div>

  <div class="panel">
    <h2>STEP 1 ── 事例の収集: このエリアで実際に成立した取引</h2>
    <div class="logic-body">
      <p class="why">国交省が四半期ごとに公表する実取引(匿名・地区単位)から、このエリアの2022年以降の土地取引を収集。1億の広い土地も3千万の狭い土地も総額のままでは比較できないため、次のSTEPですべて「坪単価」に割ってから条件を揃える。</p>
      ${dealRows ? `
      <div style="overflow-x:auto">
      <table class="list">
        <tr><th>時期</th><th>地区</th><th>総額</th><th>面積</th><th>坪単価</th><th>徒歩補正</th><th>形状補正</th><th>時点係数</th><th>正規化後</th></tr>
        ${dealRows}
      </table>
      </div>` : `<div class="note">このエリアの個別成約は未収載(地区統計のみ)。</div>`}
      <div style="overflow-x:auto;margin-top:12px">
      <table class="list">
        <tr><th>地区統計(参考)</th><th>件数</th><th>平均坪単価</th><th>中央値</th><th>2025-01基準換算</th></tr>
        ${benchRows}
      </table>
      </div>
    </div>
  </div>

  <div class="panel">
    <h2>STEP 2 ── 正規化: 「同じ条件」に引き直してから比べる</h2>
    <div class="logic-body">
      <div class="logic-step">
        <div class="t"><span class="no">2-1</span>総額ではなく坪単価で比べる</div>
        <p class="why">広さの影響を消す。5,200万円・31.8坪(164万/坪)と3,400万円・25.7坪(132万/坪)は、総額では比較不能でも坪単価なら同じ土俵に乗る。</p>
      </div>
      <div class="logic-step">
        <div class="t"><span class="no">2-2</span>時点をそろえる(時点係数)</div>
        <p class="why">2022年の成約は地価が今より安い時代の値段。年次別の地価上昇率(2022年+4%〜2026年+12%、公示・基準地価の実績ベース)で2025年1月基準に引き直す(上の表の「時点係数」で割る)。古い取引ほど大きく上方修正される。</p>
      </div>
      <div class="logic-step">
        <div class="t"><span class="no">2-3</span>土地の条件をそろえる(徒歩・形状補正)</div>
        <p class="why">駅徒歩(±1.2%/分)と土地形状(旗竿−25%等)の影響を取り除き、「徒歩10分・整形地ならいくらだったか」に換算する。査定エンジンの補正と同じ係数を逆向きに適用しているため、2本の物差しの目盛りが揃う。</p>
      </div>
      <div class="caveat">※ 方位・接道幅・角地・再建築可否は成約データに属性が無く補正できない。この残差ノイズがあるため、1件の事例ではなく複数件の中央値を使う。</div>
    </div>
  </div>

  <div class="panel">
    <h2>STEP 3 ── 代表値の決定: このエリアの成約ベース坪単価</h2>
    <div class="logic-body">
      <table class="kv">
        ${areaCal?.deals.n ? `<tr><td>個別成約の正規化中央値(${areaCal.deals.n}件)</td><td>${Math.round(areaCal.deals.median_norm)}万/坪(範囲 ${Math.round(areaCal.deals.min_norm)}〜${Math.round(areaCal.deals.max_norm)})</td></tr>` : ""}
        <tr class="em"><td>採用した成約ベース坪単価<div class="note" style="margin-top:2px">${esc(chosen.basis)} / 信頼度: ${esc(chosen.confidence)}</div></td><td>${chosen.ppt}万円/坪</td></tr>
        <tr><td>(比較)公示ベースの採用単価</td><td>${Math.round(r.state.ppt)}万円/坪(乖離 ${pct(chosen.ppt / r.state.ppt - 1)})</td></tr>
      </table>
      <p class="why" style="margin-top:8px">採用ルール: 個別成約が3件以上あれば正規化中央値(中央値は外れ値1件に引きずられない)。不足する場合は直近窓の地区平均ベンチマークで代用し、その旨と信頼度を明示する。</p>
    </div>
  </div>

  <div class="panel">
    <h2>STEP 4 ── 本物件への適用: 標準地単価をこの土地の条件に戻す</h2>
    <div class="logic-body">
      <div class="logic-step">
        <div class="t"><span class="no">4-1</span>時点修正</div>
        <div class="formula">${chosen.ppt}万/坪 × 1.10^${f2(calR.elapsed)}年 = ${Math.round(pptNow)}万円/坪(査定基準日 ${calR.asOf} 時点)</div>
      </div>
      <div class="logic-step">
        <div class="t"><span class="no">4-2</span>この土地の個別条件を反映(合計 ${pct(m.adj)})</div>
        <p class="why">STEP 2で事例から取り除いたのと同じ係数体系で、今度は本物件の条件(徒歩${s.walk}分・方位・接道・形状・複数路線・広さ)を掛け戻す。</p>
        <div class="formula">${Math.round(pptNow)}万/坪 × (1${m.adj >= 0 ? "+" : "−"}${Math.abs(m.adj * 100).toFixed(1)}%) × 実効${f2(m.tsubo)}坪 = 土地値 ${fmtMan(m.land2)}</div>
      </div>
      <div class="logic-step">
        <div class="t"><span class="no">4-3</span>売却ルートの高い方が適正価格</div>
        <div class="formula">土地として売る: ${fmtMan(m.land2)} − 解体${fmtMan(s.demo)} = ${fmtMan(m.asLand)} / 家として売る: (${fmtMan(m.land2)} + 建物残価${fmtMan(m.resid)}) × 0.95 − 修繕${fmtMan(s.repair)} = ${fmtMan(m.asHome)}</div>
        <div class="formula">成約ベース適正レンジ(坪単価±10%): ${fmtMan(calR.lo.fair)} 〜 <b>${fmtMan(m.fair)}</b> 〜 ${fmtMan(calR.hi.fair)} / 下値フロア ${fmtMan(m.floorVal)}</div>
      </div>
    </div>
  </div>

  <div class="panel">
    <h2>STEP 4.5 ── 戸建成約比較(リテール比較法)の併算</h2>
    <div class="logic-body">
      <p class="why">ここまでは土地の成約から積み上げた値。2026-08監査で「住める家」を買う実需市場はこの積算を上回ることが確認されたため、条件の近い戸建成約から直接比較した値を併算し、高い方を採用する。</p>
      ${calR.retail ? `<div class="formula">リテール比較(類似戸建成約 ${calR.retail.n}件・時点/徒歩/築年差補正済): ${fmtMan(calR.retail.lo)} 〜 <b>${fmtMan(calR.retail.mid)}</b> 〜 ${fmtMan(calR.retail.hi)}</div>
      <p class="why">事例の一覧と選定条件は<a href="${esc(r.id)}.html">物件ページの「戸建成約比較」セクション</a>を参照。</p>` : `<div class="note">類似の戸建成約が不足のため、この物件では土地較正ベースのみ。</div>`}
    </div>
  </div>

  <div class="panel">
    <h2>STEP 5 ── 結論: 売出価格はどこまで事例で説明できるか</h2>
    <div class="logic-body">
      <table class="kv">
        <tr><td>成約事例で説明できる範囲(楽観上限・土地較正×リテールの高い方)</td><td>${fmtMan(calR.fairFinal.hi)}</td></tr>
        <tr class="loss"><td>売出価格のうち事例で説明できない部分</td><td>${s.ask > calR.fairFinal.hi ? "+" + fmtMan(s.ask - calR.fairFinal.hi) : "なし(レンジ内)"}</td></tr>
        <tr><td>成約ベースでの判定</td><td>【${calR.verdict.mark}】${esc(calR.verdict.head)}</td></tr>
      </table>
      <p class="why" style="margin-top:8px">${s.ask > calR.fairFinal.hi
        ? "周辺の実取引を楽観側(坪単価+10%)に振っても売出価格には届かない。差額は「土地の実勢」ではなく、売主の期待・リテール商品としての上乗せ・仲介の値付け戦略のいずれかであり、交渉ではこの内訳の説明を売主側に求めるのが筋になる。"
        : "売出価格は成約事例から説明可能なレンジ内にあり、実勢に沿った値付けと評価できる。"}</p>
      <div class="caveat">※ 限界: ①収載事例は土地(更地・古家付き)取引であり、「住める家」としてのリテール価格はこの上に乗りうる ②売出価格は売主の希望であり成約価格ではない(価格改定履歴で市場の反応を追跡) ③標本が少なく信頼度は${esc(chosen.confidence)} ④方位・接道等は未補正。</div>
    </div>
    <div class="meta-line">出典: 国交省 不動産取引価格情報の再掲(utinokati.com、取得2026-08-09) / 査定基準日 ${calR.asOf} / engine ${esc(calR.engineVersion)}</div>
  </div>

  <div style="margin-bottom:20px"><a class="src-link" href="${esc(r.id)}.html">公示ベースの算出根拠(査定ページ)へ →</a> <a class="src-link" href="../guide.html">前提知識ガイドへ →</a></div>`;

  return layout({
    title: `${addr} ── 成約事例ベースの根拠`,
    subtitle: `エリア: ${esc(area)} ── 実際の取引から適正価格を導き、売出との乖離を仕分ける`,
    docNo: `成約事例ベース査定根拠<br>査定基準日 ${calR.asOf}`,
    body,
  });
}
