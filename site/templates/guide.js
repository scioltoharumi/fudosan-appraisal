// site/templates/guide.js — 査定の前提知識ガイド(実在物件を題材に係数と数式を一つずつ解説する教育ページ)
// 題材物件の evaluate() 結果から実数値を流し込むため、再ビルドしても本文と査定値がズレない。
import { fmtMan, pct, COEFFS } from "../../engine/appraise.js";
import { layout, esc, fmtDate } from "./layout.js";

const man = (n) => fmtMan(n);
const f1 = (n) => n.toFixed(1);
const f2 = (n) => n.toFixed(2);

export function renderGuide(r, property) {
  const s = r.state;
  const m = r.mid;
  const addr = property.location?.address ?? r.id;
  const tsuboLand = m.tsubo;                       // 実効宅地(坪)
  const tsuboFloor = s.floor / COEFFS.TSUBO_M2;    // 延床(坪)
  const residRate = Math.max(0, 1 - s.age / COEFFS.BUILDING_LIFE_Y);
  const pptNow = m.pptAdj;                         // 時点修正後の基準坪単価
  const pptFinal = pptNow * (1 + m.adj);           // 個別補正後の坪単価
  const agePct = Math.min(100, (s.age / COEFFS.BUILDING_LIFE_Y) * 100);

  // 個別補正の内訳行(この物件で効いているものを実値で)
  const adjRows = [
    ["駅からの徒歩", `${s.walk}分`, pct(m.walkAdj), `10分を基準に1分あたり±1.2%。${s.walk}分なので ${COEFFS.WALK_ADJ_PER_MIN * 100}% × (${s.walk} − 10) = ${pct(m.walkAdj)}`],
    ["接道の方位", "北", pct(s.dir), "南向き接道は日当たりが良く+5%。東・南東・南西+2%、西±0、北系は−3%"],
    ["接道の質", "約5.4m公道", pct(s.roadq), "幅4m以上の公道に接していれば減点なし。4m未満は−5%(セットバック義務)、接道に疑義があれば−10%"],
    ["土地の形", "旗竿地", pct(s.shape), "整形地±0、やや不整形−5%、旗竿地は−25%(下の解説参照)"],
    ["複数駅・複数路線", "利用可", pct(COEFFS.MULTI_STATION_ADJ), "東十条・十条・赤羽の3駅が使え、再販時の訴求力が高いので+2%"],
    ["土地の広さ補正", `${f2(tsuboLand)}坪`, pct(m.sizeAdj), "20坪未満は狭小(1坪不足ごとに−0.5%)、45坪超は総額が張って買い手が減る(−0.2%/坪)。この物件は範囲内なので補正なし"],
  ];

  const body = `
  <div class="panel">
    <h2>このページについて</h2>
    <div class="logic-body">
      <p>査定サイトの数字が「なぜその値になるのか」を、実在の検討物件 <a href="property/${esc(r.id)}.html">${esc(addr)}(売出 ${man(s.ask)})</a> を題材に、前提知識ゼロから一つずつ解説します。数値はすべて実際の査定エンジンの出力(基準日 ${r.asOf})です。</p>
      <p style="margin-top:8px">結論を先に言うと、この査定は次の一行に集約されます。</p>
      <div class="formula" style="white-space:normal">中古戸建の適正価格 = 「<b>土地として売った時の値段</b>」と「<b>家として売った時の値段</b>」の高い方</div>
      <p class="why">築年数が経った木造戸建は建物の市場価値がほぼゼロになるため、実態は「土地を買う」行為に近くなります。だからこの査定は土地値の積み上げから始まります。</p>
    </div>
  </div>

  <div class="panel">
    <h2>STEP 1 ── 単位の基礎: m²(平米)と坪</h2>
    <div class="logic-body">
      <div class="logic-step">
        <div class="t"><span class="no">1-1</span>1坪 = 3.30578m² = 畳およそ2枚分</div>
        <p class="why">不動産の土地単価は慣習的に「坪」で語られます。チラシのm²表記は 3.30578 で割ると坪になります。</p>
        <div class="formula">この物件の土地 ${s.land}m² ÷ 3.30578 = ${f2(tsuboLand)}坪</div>
      </div>
      <div class="logic-step">
        <div class="t"><span class="no">1-2</span>「登記面積」と「実効宅地」</div>
        <p class="why">登記簿上の面積のうち、セットバック(道路提供)部分など家を建てられない部分を除いたものが実際に使える宅地です。この物件はセットバックなしなので ${s.land}m² がそのまま実効宅地です。ただし次のSTEPの「旗竿地」という大きな論点があります。</p>
      </div>
    </div>
  </div>

  <div class="panel">
    <h2>STEP 2 ── 旗竿地(はたざおち)とは何か、なぜ−25%か</h2>
    <div class="logic-body">
      <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:center">
        <svg viewBox="0 0 240 200" style="width:220px;flex-shrink:0" role="img" aria-label="旗竿地の模式図">
          <rect x="0" y="0" width="240" height="26" fill="#DCE3EA"/>
          <text x="8" y="18" font-size="11" fill="#43566B">道路(北側・約5.4m公道)</text>
          <rect x="150" y="26" width="34" height="70" fill="#BFD7E4" stroke="#2E6E8E"/>
          <text x="190" y="66" font-size="10" fill="#43566B">路地状部分</text>
          <text x="190" y="79" font-size="10" fill="#43566B">(約21.83m²)</text>
          <rect x="52" y="96" width="132" height="86" fill="#EFF2F5" stroke="#2E6E8E" stroke-width="1.5"/>
          <text x="70" y="134" font-size="11" fill="#16232E">建物の建つ宅地</text>
          <text x="70" y="150" font-size="10" fill="#43566B">(有効宅地 約48.23m²)</text>
        </svg>
        <div style="flex:1;min-width:240px">
          <p>旗竿地とは、細長い通路(竿)の先に宅地(旗)が広がる形の土地です。この物件は登記 ${s.land}m² のうち<b>約21.83m²が通路部分</b>で、奥の宅地は約48.23m²です。</p>
          <p class="why" style="margin-top:6px">安くなる理由: ①間口が狭く車の出し入れや建築工事がしにくい ②奥まっていて日当たり・眺望が劣りやすい ③再販時に敬遠する買い手が多く需要が薄い ④通路部分は面積の割に価値を生まない。市場では整形地よりおおむね2〜3割安で取引されるため、このエンジンは<b>登記面積全体に−25%</b>を適用します。</p>
        </div>
      </div>
    </div>
  </div>

  <div class="panel">
    <h2>STEP 3 ── 土地の「基準坪単価」はどこから来るか</h2>
    <div class="logic-body">
      <div class="logic-step">
        <div class="t"><span class="no">3-1</span>公示地価: 国が毎年発表する土地の値段</div>
        <p class="why">国土交通省が毎年1月1日時点で全国の標準地の1m²単価を鑑定・公表するものです(3月発表)。誰でも無料で見られる、土地値のもっとも客観的な出発点です。</p>
      </div>
      <div class="logic-step">
        <div class="t"><span class="no">3-2</span>実勢係数: 公示地価と実際の取引価格のズレ</div>
        <p class="why">都心近郊の住宅地は、実際の取引が公示地価より高めに決まる傾向があります。本サイトでは赤羽周辺の観察から公示×1.15を初期値にしています(成約事例が貯まったら実測に置き換える前提の仮の係数です)。</p>
        <div class="formula">この物件: 十条仲原の住宅地水準 約60万円/m² × 3.30578 × 1.15 ≈ ${s.ppt}万円/坪</div>
        <p class="why">※十条仲原の公示平均85万/m²は駅前商業地に引っ張られた数字なので、住宅地(第1種中高層住居専用地域)のこの物件には住宅地点の水準(51.9万〜)と隣接・中十条平均56.4万/m²を踏まえた60万/m²を保守側で採用しています。</p>
      </div>
      <div class="logic-step">
        <div class="t"><span class="no">3-3</span>時点修正: 公示は1月1日時点、今日は${r.asOf}</div>
        <p class="why">赤羽周辺の地価は直近年率10%超のペースで上がっています。公示の基準日(2025年1月)から基準日までの経過 ${f2(r.elapsed)}年 ぶん、保守側の年率+10%で割り増します。</p>
        <div class="formula">${s.ppt}万/坪 × 1.10^${f2(r.elapsed)} = ${Math.round(pptNow)}万円/坪(時点修正後)</div>
      </div>
    </div>
  </div>

  <div class="panel">
    <h2>STEP 4 ── 個別補正: 同じ町でも土地ごとに値段が違う理由</h2>
    <div class="logic-body">
      <p>基準坪単価は「その町の標準的な土地」の値段です。個別の土地は駅距離・向き・道路・形で上下するため、次の補正を掛け合わせます。</p>
      <table class="kv">
        <tr><td style="width:140px"><b>補正項目</b></td><td><b>この物件</b></td><td style="width:70px"><b>補正</b></td></tr>
        ${adjRows.map(([k, v, p, why]) => `<tr><td>${esc(k)}<div class="note" style="margin-top:2px">${esc(why)}</div></td><td>${esc(v)}</td><td>${esc(p)}</td></tr>`).join("")}
        <tr class="em"><td>合計</td><td></td><td>${pct(m.adj)}</td></tr>
      </table>
      <div class="formula" style="margin-top:10px">${Math.round(pptNow)}万/坪 × (1 ${m.adj >= 0 ? "+" : "−"} ${Math.abs(m.adj * 100).toFixed(1)}%) = <b>${Math.round(pptFinal)}万円/坪</b>(この土地の坪単価)</div>
      <div class="formula">${Math.round(pptFinal)}万/坪 × ${f2(tsuboLand)}坪 = <b>土地値 ${man(m.land2)}</b></div>
      <p class="why">旗竿地の−25%が最大の下押し要因です。徒歩・方位・複数路線の補正は数%単位なのに対し、土地の形は一撃で2割以上効きます。</p>
    </div>
  </div>

  <div class="panel">
    <h2>STEP 5 ── 建物の値段: 「木造22年でゼロ」ルール</h2>
    <div class="logic-body">
      <div class="logic-step">
        <div class="t"><span class="no">5-1</span>なぜ22年か</div>
        <p class="why">税法上の木造住宅の耐用年数が22年で、金融機関の担保評価や中古市場の値付け慣行もこれに引きずられています。実際に住めるかどうかとは別の「市場がいくら払うか」の話です。築22年を超えた木造戸建は、建物にほぼ値段が付きません。</p>
      </div>
      <div class="logic-step">
        <div class="t"><span class="no">5-2</span>この物件の建物残価</div>
        <p class="why">築年月 ${fmtDate(property.building?.built)} → 築${f1(s.age)}年。残存率は 1 − ${f1(s.age)}/22 = ${(residRate * 100).toFixed(0)}%。新築時の建築費相当(再調達単価)を70万円/坪と置き、延床${f2(tsuboFloor)}坪に掛けます。</p>
        <div class="formula">残価 = ${(residRate * 100).toFixed(0)}% × 70万/坪 × ${f2(tsuboFloor)}坪 = <b>${man(m.resid)}</b></div>
        <div style="margin-top:10px;max-width:520px">
          <div style="display:flex;justify-content:space-between;font-size:.7rem;color:var(--ink-soft)"><span>新築(価値100%)</span><span>築22年(価値0%)</span></div>
          <div style="height:18px;border:1px solid var(--grid);background:#F4F6F8;position:relative">
            <div style="position:absolute;top:0;bottom:0;left:0;width:${agePct.toFixed(0)}%;background:var(--band-soft)"></div>
            <div style="position:absolute;top:-4px;bottom:-4px;left:${agePct.toFixed(0)}%;width:2px;background:var(--stamp)"></div>
          </div>
          <div class="note">赤線 = この物件の現在地(築${f1(s.age)}年)。売出${man(s.ask)}のうち建物に払ってよいのは${man(m.resid)}だけ、という見方をします。</div>
        </div>
      </div>
    </div>
  </div>

  <div class="panel">
    <h2>STEP 6 ── 差し引くコスト: 解体費と繰延修繕</h2>
    <div class="logic-body">
      <div class="logic-step">
        <div class="t"><span class="no">6-1</span>解体費 ${man(s.demo)}(なぜ引くのか)</div>
        <p class="why">「土地として売る」場合、古家は撤去して渡すのが通例なので、土地値から解体費を引いた額が手取りです。木造3階建で延床${f2(tsuboFloor)}坪、旗竿地は重機が入りにくく割高になるため坪約7万円で見積もっています(実見積なしの想定値)。</p>
      </div>
      <div class="logic-step">
        <div class="t"><span class="no">6-2</span>繰延修繕 ${man(s.repair)}(なぜ引くのか)</div>
        <p class="why">「繰延修繕」とは、本来やっておくべきなのに先送りされている修繕のことです。築${f1(s.age)}年の木造戸建は外壁・屋根の塗替えや防水・給湯器などで数百万円規模の費用が溜まっているのが普通です。この物件は修繕履歴の記載がなく「未実施の可能性大」として保守的に800万円を見込みます。内見や建物状況調査で実態が分かれば置き換えます。</p>
      </div>
    </div>
  </div>

  <div class="panel">
    <h2>STEP 7 ── 2つの売却ルートを比べて高い方が「適正価格」</h2>
    <div class="logic-body">
      <table class="kv">
        <tr><td><b>ルートA: 土地として売る</b><div class="note" style="margin-top:2px">土地値 − 解体費</div></td>
            <td>${man(m.land2)} − ${man(s.demo)} =</td><td><b>${man(m.asLand)}</b></td></tr>
        <tr><td><b>ルートB: 家として売る</b><div class="note" style="margin-top:2px">(土地値 + 建物残価) × 建物市場性補正(木造3階狭小 −5%) − 繰延修繕</div></td>
            <td>(${man(m.land2)} + ${man(m.resid)}) × 0.95 − ${man(s.repair)} =</td><td><b>${man(m.asHome)}</b></td></tr>
        <tr class="em"><td>適正価格(高い方)${m.route === "land" ? " = ルートA" : " = ルートB"}</td><td></td><td>${man(m.fair)}</td></tr>
      </table>
      <p class="why" style="margin-top:8px">この物件は${m.route === "land" ? "ルートA(土地)が上回りました。つまり市場価値の実態は「古家付き土地」です。" : "ルートB(家)が上回りました。建物にまだ market value が残っています。"}また、ルートAの値は<b>下値フロア</b>(最悪でも土地としてこの値では売れるという下限)としても使います: <b>${man(m.floorVal)}</b>。</p>
    </div>
  </div>

  <div class="panel">
    <h2>STEP 8 ── レンジとモンテカルロ: 「一点の正解」ではなく幅で見る</h2>
    <div class="logic-body">
      <div class="logic-step">
        <div class="t"><span class="no">8-1</span>±10%の3点レンジ</div>
        <p class="why">基準坪単価そのものに±10%の不確かさがあると見て、悲観(−10%)・中央・楽観(+10%)の3通りで計算し直します。</p>
        <div class="formula">適正レンジ: ${man(r.lo.fair)}(悲観) 〜 ${man(m.fair)}(中央) 〜 ${man(r.hi.fair)}(楽観)</div>
      </div>
      <div class="logic-step">
        <div class="t"><span class="no">8-2</span>モンテカルロ・シミュレーションとは</div>
        <p class="why">坪単価・地価上昇率・解体費・修繕費などを「ありそうな範囲でランダムに振って」査定を${COEFFS.MC_TRIALS.toLocaleString("en-US")}回繰り返す手法です。結果の分布から、P10(悲観側10%点)${man(r.mc.p10)} / P50(中央)${man(r.mc.p50)} / P90(楽観側)${man(r.mc.p90)} が得られます。売出${man(s.ask)}は${r.mc.askPercentile.toFixed(0)}パーセンタイル──つまり${r.mc.askPercentile >= 99 ? "5,000回のシミュレーションでほぼ一度も届かない水準の値付け" : "シミュレーション結果の" + r.mc.askPercentile.toFixed(0) + "%より高い値付け"}です。</p>
      </div>
    </div>
  </div>

  <div class="panel">
    <h2>STEP 9 ── 判定スタンプの意味</h2>
    <div class="logic-body">
      <table class="kv">
        <tr><td><span class="badge ok" style="width:36px;height:36px;font-size:.8rem">買</span></td><td>売出価格 ≦ 下値フロア(土地値−解体費)。最悪土地で売っても損しにくい構造</td></tr>
        <tr><td><span class="badge warn" style="width:36px;height:36px;font-size:.8rem">保留</span></td><td>売出価格が適正レンジ内(楽観上限まで)。交渉・指値次第</td></tr>
        <tr><td><span class="badge" style="width:36px;height:36px;font-size:.8rem">見送</span></td><td>売出価格が楽観上限すら超過。説明のつかない上乗せに払うことになる</td></tr>
      </table>
      <div class="formula" style="margin-top:10px">この物件: 売出 ${man(s.ask)} > 楽観上限 ${man(r.hi.fair)} → 判定【${r.verdict.mark}】(乖離 ${r.premium >= 0 ? "+" : ""}${man(r.premium)})</div>
      <p class="why">なお売出価格と査定が乖離していること自体は珍しくありません。売主の希望価格・住宅ローン前提の実需価格・リフォーム済プレミアムなどが上乗せされるためです。この査定は「資産防衛の観点でいくらまでなら払えるか」の物差しです。</p>
    </div>
  </div>

  <div class="panel">
    <h2>この査定の限界(正直な注意書き)</h2>
    <div class="logic-body">
      <ul class="assumptions">
        <li>基準坪単価は公示地価×仮の実勢係数です。<b>成約事例による較正はまだ行っていません</b>。</li>
        <li>修繕・解体・賃料などは<span class="why">「仮定」欄に明示した保守的な置き値</span>で、内見・見積で置き換える前提です。</li>
        <li>接道の42条区分・ハザード・耐震などの役所調査はチェックリスト方式で別管理です(未検証項目は各物件ページ参照)。</li>
        <li>本サイトは個人の検討用簡易査定であり、不動産鑑定評価・投資助言ではありません。</li>
      </ul>
      <div class="provenance">題材: ${esc(addr)}(${esc(r.id)}) / 査定基準日 ${r.asOf} / engine ${esc(r.engineVersion)} / 数値は再ビルドのたびに最新の査定結果へ自動更新されます。</div>
    </div>
  </div>

  <div class="panel">
    <h2>ミニ用語集</h2>
    <div class="logic-body">
      <table class="kv">
        <tr><td style="width:160px"><b>公示地価</b></td><td>国交省が毎年1月1日時点で公表する標準地の1m²単価。土地値の公的な物差し</td></tr>
        <tr><td><b>坪</b></td><td>約3.31m²。畳2枚分。土地単価の慣習単位</td></tr>
        <tr><td><b>旗竿地</b></td><td>通路の先に宅地がある形の土地。整形地より2〜3割安</td></tr>
        <tr><td><b>セットバック</b></td><td>前面道路が4m未満の場合、再建築時に道路中心から2mまで敷地を後退させる義務。後退部分は実質使えない</td></tr>
        <tr><td><b>42条2項道路</b></td><td>建築基準法上の「みなし道路」。幅4m未満でも接道と認められるがセットバックが要る</td></tr>
        <tr><td><b>再調達単価</b></td><td>同じ建物を今新築したらかかる坪単価(本エンジンは70万/坪)</td></tr>
        <tr><td><b>繰延修繕</b></td><td>先送りされている修繕。買った直後に払うことになる隠れコスト</td></tr>
        <tr><td><b>下値フロア</b></td><td>土地値−解体費。最悪シナリオでの換金価値の目安</td></tr>
        <tr><td><b>パーセンタイル</b></td><td>分布の中での位置。P90=シミュレーション結果の90%より高い値</td></tr>
        <tr><td><b>媒介(仲介)</b></td><td>不動産会社が売主・買主の間を取り持つ取引形態。仲介手数料(約3%+6万+税)がかかる。本査定の諸費用率5%はこれを含む概算</td></tr>
      </table>
    </div>
  </div>

  <div style="margin-bottom:20px"><a class="src-link" href="index.html">← 査定台帳一覧へ戻る</a> <a class="src-link" href="property/${esc(r.id)}.html">題材物件の査定ページを見る →</a></div>`;

  return layout({
    title: "査定の読み方 ── 前提知識ガイド",
    subtitle: `題材: ${esc(addr)} ── 公示地価から判定スタンプまで、数字の出所を一つずつ`,
    docNo: `前提知識ガイド<br>査定基準日 ${r.asOf}`,
    body,
  });
}
