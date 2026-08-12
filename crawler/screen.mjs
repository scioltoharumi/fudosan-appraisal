// crawler/screen.mjs — 新着のノックアウト(KO)スクリーニング。純関数のみ(ネットワーク・I/Oなし)。
// 目的: 「登録してはいけない物件」を人手の前に機械で落とし、残ったものは詳細ページの実値を
// 添えて渡す。2026-08-13の事故(除外済みレッドゾーン現場の別業者掲載を新着として扱い、
// YAML作成・査定まで進めてから撤回)を構造的に防ぐ。
// KO基準の正本: docs/requirements-daily-crawl.md §2.2
//   KO1 再建築不可 / KO2 所有権以外 / KO3 告知事項 / KO4 重大ハザード / KO5 必須項目不確定

// 全角英数字→半角(athomeは「５８.５３」等の全角表記がある)
export const zen = (s) => String(s ?? "").replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
const strip = (s) => String(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= tol;

// ---- 除外台帳(market/crawl/excluded.json)の索引化 ----
// ハザードは「掲載」ではなく「現場」の属性なので、媒体番号ではなく諸元(丁目・土地・建物)で
// 突き合わせる。同一現場は業者を替えて別番号で何度でも現れる(2026-08-13の実例)。
export function buildExcludedIndex(excluded) {
  const ids = new Set(), sites = [];
  for (const [key, v] of Object.entries(excluded ?? {})) {
    if (key.startsWith("_")) continue;             // _readme
    ids.add(key);
    const addr = zen(v.address ?? "");
    // 面積は明示フィールド優先、無ければ unit 文字列「2号棟(土地58.53/建物93.55)」から復元
    const u = String(v.unit ?? "").match(/土地\s*([\d.]+)\s*\/\s*建物\s*([\d.]+)/);
    sites.push({
      key,
      district: (addr.match(/東京都北区([^\d\s]+)/) ?? [])[1] ?? null,
      chome: (addr.match(/東京都北区\D+(\d+)/) ?? [])[1] ?? null,
      land_m2: v.land_m2 ?? (u ? Number(u[1]) : null),
      floor_m2: v.floor_m2 ?? (u ? Number(u[2]) : null),
      price_man: v.price_man ?? null,
      hazard: /土砂災害|がけ条例|宅地造成|浸水|警戒区域|ハザード/.test(String(v.reason ?? "")),
      reason: String(v.reason ?? "").slice(0, 160),
      unit: v.unit ?? null,
    });
  }
  return { ids, sites };
}

// 新着が除外済み現場に当たるか。exact=同一戸と確定(諸元一致) / near=同一現場の疑い(要人判断)
export function matchExcludedSite(unit, index) {
  if (!index) return null;
  if (unit.nc && index.ids.has(unit.nc)) {
    const s = index.sites.find((x) => x.key === unit.nc);
    return { level: "exact", by: "id", ref: unit.nc, hazard: s?.hazard ?? false, reason: s?.reason ?? "", unit: s?.unit ?? null };
  }
  for (const s of index.sites) {
    if (!s.district || s.district !== unit.district) continue;
    if (s.chome !== unit.chome) continue;
    if (s.land_m2 != null && s.floor_m2 != null) {
      // 諸元完全一致 = 同一戸の別業者掲載(価格は媒体・時点で動くので一致条件に入れない)
      if (near(s.land_m2, unit.land_m2, 0.02) && near(s.floor_m2, unit.floor_m2, 0.02)) {
        return { level: "exact", by: "specs", ref: s.key, hazard: s.hazard, reason: s.reason, unit: s.unit };
      }
      // 同一開発の別戸は区画がわずかに違う。1.5m²圏は同一現場を第一に疑う(取りこぼし防止の緩衝)
      if (near(s.land_m2, unit.land_m2, 1.5) || near(s.floor_m2, unit.floor_m2, 1.5)) {
        return { level: "near", by: "specs", ref: s.key, hazard: s.hazard, reason: s.reason, unit: s.unit };
      }
    } else if (s.price_man != null && s.price_man === unit.price_man) {
      // 面積が記録されていない除外物件(赤羽西3等)は丁目+価格一致のみ弱一致として拾う
      return { level: "near", by: "price", ref: s.key, hazard: s.hazard, reason: s.reason, unit: s.unit };
    }
  }
  return null;
}

// ---- 詳細ページのKO信号スキャン ----
// 誤検出に注意: athomeの詳細ページは値が空(「－」)でもラベルだけは常に存在する
// (「借地期間・地代」「告知事項」等)。ラベル語だけで旗を立てない。
const HAZARD_RE = /土砂災害特別警戒区域|土砂災害警戒区域|急傾斜地崩壊|がけ条例|建築安全条例第[6六]条|宅地造成(?:及び特定盛土等)?規制|宅地造成工事規制区域|浸水想定|洪水浸水/;
const NO_REBUILD_RE = /再建築不可|再建築[はが]不可|接道義務を?満た(?:さ|しま?せ)ない|建築不可/;
const LEASEHOLD_RE = /定期借地|旧法借地|普通借地|借地権付|地上権/;
const DISCLOSURE_RE = /告知事項\s*(?:あり|有)|心理的瑕疵|事故物件/;

// 詳細ページから査定入力に使う実値を取る。一覧の値は当てにしない
// (2026-08-13: athome一覧の徒歩4分に対し詳細は最短16分。一覧カードの切り出しが
//  隣接カード・広告枠を巻き込むため)
// 媒体ごとのラベル差。SUUMOは「ラベル ヒント 値」(ヒントはツールチップ語)、athomeは「ラベル 値」。
// 値はラベル直後にアンカーして取る。これで広告文(「※本物件の間取りは2LDK+2Sです」)を拾わない
const FIELD_LABELS = {
  suumo: { land: ["土地面積"], floor: ["建物面積"], layout: ["間取り"], ownership: ["土地の権利形態", "権利形態"],
    zoning: ["用途地域"], road: ["私道負担・道路"], bcrfar: ["建ぺい率・容積率"] },
  athome: { land: ["土地面積"], floor: ["建物面積"], layout: ["間取り"], ownership: ["土地権利"],
    zoning: ["用途地域"], road: ["接道状況"], private_road: ["私道負担面積", "私道負担"], bcr: ["建ぺい率"], far: ["容積率"] },
};
// 「なし」は無効値ではない(私道負担なし・セットバックなしは意味のある事実)。
// 逆に、短いラベルで拾ってしまう長いラベルの残骸(私道負担+「面積」等)は値として弾く
const NON_VALUES = new Set(["-", "－", "ー", "ヒント", "", "面積", "率", "番号", "日"]);

export function parseDetailAttrs(html, media) {
  const t = zen(strip(html));
  const labels = FIELD_LABELS[media] ?? FIELD_LABELS.suumo;
  // ラベル直後(SUUMOは「ヒント」を挟む)に valueRe が続く場合だけ採用する
  const field = (key, valueSrc) => {
    for (const label of labels[key] ?? []) {
      const m = t.match(new RegExp(label + "\\s*(?:ヒント\\s*)?" + valueSrc));
      if (m && !NON_VALUES.has(m[1])) return m;
    }
    return null;
  };
  const fieldStr = (key, valueSrc) => (field(key, valueSrc) ?? [])[1] ?? null;
  const fieldNum = (key, valueSrc) => { const v = fieldStr(key, valueSrc); return v == null ? null : Number(v); };
  const pick = (re) => (t.match(re) ?? [])[1] ?? null;
  // 建ぺい率・容積率はSUUMOが「60％・150％」と1欄にまとめる
  const bf = field("bcrfar", "([0-9]+)\\s*[%％]\\s*・\\s*([0-9]+)\\s*[%％]");
  const builtM = t.match(/(?:完成時期\s*[（(]築年月[)）]|築年月)\s*(?:ヒント\s*)?([0-9]{4})年\s*([0-9]{1,2})月/);
  // 徒歩分の誤抽出対策(2026-08-13: 一覧が4分・実際は16分)。ページ全体の最小値も、
  // 単純な「おすすめ枠の切り落とし」も効かない(おすすめの語はヘッダのナビにも出るため
  // 対象物件より前で切れてしまう)。「交通」ラベルの窓のうち、
  // 『路線名 / 駅名 徒歩N分』の形が取れた最初の窓だけを採用する
  // SUUMOは「ＪＲ京浜東北線「赤羽」歩13分」と“徒”を落とす表記があるため (?:徒)?歩 で受ける
  let walks = [];
  for (const m of t.matchAll(/交通/g)) {
    const win = t.slice(m.index, m.index + 400);
    const w = [...win.matchAll(/線[^線]{0,40}?(?:徒)?歩\s?([0-9]+)分/g)].map((x) => Number(x[1]));
    if (w.length) { walks = w; break; }
  }
  return {
    land_m2: fieldNum("land", "([0-9.]+)\\s*m"),
    floor_m2: fieldNum("floor", "([0-9.]+)\\s*m"),
    layout: fieldStr("layout", "([0-9]{1,2}[SLDKR+]{1,10})"),
    built: builtM ? `${builtM[1]}-${String(builtM[2]).padStart(2, "0")}` : null,
    walk_min: walks.length ? Math.min(...walks) : null,
    ownership: fieldStr("ownership", "(所有権|借地権|定期借地権?|地上権)"),
    // 接道は「南 4.2m 公道」のように空白で区切られるため、方位+幅員+種別まで1値として拾い、
    // 次の欄のラベルを巻き込んだぶんを落とす
    road: (() => {
      const v = (fieldStr("road", "([^\\s]{1,12}(?:\\s*[0-9.]+\\s*m[^\\s]*)?(?:\\s+[^\\s]{1,6})?)") ?? "")
        .replace(/\s*(完成時期|建ぺい率|容積率|諸費用|間取り|土地面積|建物面積|引渡可能時期|地目|用途地域).*$/, "").trim();
      // ラベル剥がし後に空値になるもの(「接道状況 －」)は null。YAMLに「－」を書かせない
      return NON_VALUES.has(v) ? null : (v || null);
    })(),
    zoning: fieldStr("zoning", "([^\\s]{2,12})"),
    bcr: bf ? Number(bf[1]) : fieldNum("bcr", "([0-9]+)\\s*[%％]"),
    far: bf ? Number(bf[2]) : fieldNum("far", "([0-9]+)\\s*[%％]"),
    private_road: fieldStr("private_road", "([^\\s]{1,12})"),
    info_date: (() => { const m = t.match(/(?:情報提供日|情報公開日)\s*([0-9]{4})年([0-9]{1,2})月([0-9]{1,2})日/); return m ? `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}` : null; })(),
  };
}

// 対象物件の記述だけを切り出す。ページ全体を舐めてはいけない
// (2026-08-13検証: athome詳細ページの埋め込みJSONには**他物件**の広告文が入っており、
//  「■志村三丁目駅徒歩14分■再建築不可」を拾ってKO1が誤爆した。全物件が毎日ブロックされる型の事故)。
// 対象の記述が入る欄だけを列挙し、その窓の中だけを見る。
// 限界: ここに列挙していない欄にハザードが書かれていると素通りする。これは
// ①除外済み現場との諸元照合(段階1) ②登録時の両媒体確認ルール で補う
// 権利欄のラベルは媒体で違う(SUUMO=土地の権利形態 / athome=土地権利)が、媒体側の表記揺れで
// 取りこぼすと借地物件を登録してしまうため、両方の語をどちらの媒体でも見る
const COMMON_FIELDS = ["その他制限事項", "法令等制限", "法令等の制限", "法令上の制限", "制限事項",
  "告知事項", "土地権利", "土地の権利形態", "権利形態", "現況", "接道状況"];
const SUBJECT_FIELDS = {
  athome: COMMON_FIELDS,                 // 対象の備考は athomeBiko から別途取る
  suumo: [...COMMON_FIELDS, "備考"],
};
export function subjectText(html, media) {
  const raw = String(html);
  const parts = [];
  // athomeの対象物件の備考は埋め込みJSONの athomeBiko(法令等制限もここに入る実例あり)。
  // 同じJSONの他キーには**他物件**のおすすめ枠が入るので、この配列だけを名指しで取る
  const biko = raw.match(/\\?"athomeBiko\\?"\s*:\s*\[([\s\S]{0,4000}?)\]/);
  if (biko) parts.push(biko[1]);
  // 欄の窓を取るテキストからは script/style を除去する。除去しないと欄の直後に
  // 埋め込みJSON(=他物件の広告文)が続き、窓がそこへ食い込んで誤検出する
  const t = zen(strip(raw.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")));
  for (const label of SUBJECT_FIELDS[media] ?? SUBJECT_FIELDS.suumo) {
    const i = t.indexOf(label);
    if (i >= 0) parts.push(t.slice(i, i + 100));   // 欄の値ぶんだけ(隣の欄まで少し含む程度)
  }
  return zen(parts.join(" \n "));
}

// KO信号の抽出。evidence は該当箇所の前後を切り出して報告に載せる(人が裏取りできるように)
export function scanKO(html, media) {
  const t = subjectText(html, media);
  const flags = [];
  const eviOf = (re) => { const m = t.match(re); if (!m) return null; const i = t.indexOf(m[0]); return t.slice(Math.max(0, i - 40), i + 60).trim(); };
  if (HAZARD_RE.test(t)) flags.push({ code: "KO4_hazard", label: "重大ハザードの明記", evidence: eviOf(HAZARD_RE) });
  if (NO_REBUILD_RE.test(t)) flags.push({ code: "KO1_no_rebuild", label: "再建築不可・接道義務不適合", evidence: eviOf(NO_REBUILD_RE) });
  if (DISCLOSURE_RE.test(t)) flags.push({ code: "KO3_disclosure", label: "告知事項", evidence: eviOf(DISCLOSURE_RE) });
  const attrs = parseDetailAttrs(html, media);
  // 権利は媒体でラベルが違う(SUUMO=土地の権利形態 / athome=土地権利)。取りこぼすと
  // 借地物件を登録してしまうため、ここは媒体を問わず両方のラベルで見る
  const own = (t.match(/(?:土地の権利形態|土地権利|権利形態)\s*(?:ヒント\s*)?(所有権|借地権|定期借地権?|地上権)/) ?? [])[1]
    ?? attrs.ownership;
  if ((own && own !== "所有権") || LEASEHOLD_RE.test(t)) {
    flags.push({ code: "KO2_ownership", label: "所有権以外(借地権等)", evidence: own ?? eviOf(LEASEHOLD_RE) });
  }
  return { flags, attrs, hazard_media: media };
}

// ---- 総合判定 ----
// block = 登録しない / suspect = 登録せず人の判断を仰ぐ / pass = 自動登録してよい
export function koScreen({ unit, siteHit, scan }) {
  const codes = [], reasons = [];
  if (siteHit?.level === "exact") {
    codes.push(siteHit.hazard ? "KO4_hazard" : "KO_excluded");
    reasons.push(`除外済み現場と諸元一致(${siteHit.ref}${siteHit.unit ? " " + siteHit.unit : ""}・照合=${siteHit.by})。${siteHit.reason}`);
    return { verdict: "block", codes, reasons, site_match: siteHit, attrs: scan?.attrs ?? null };
  }
  for (const f of scan?.flags ?? []) { codes.push(f.code); reasons.push(`${f.label}: ${f.evidence ?? "掲載に明記"}`); }
  // 必須項目(価格・所在地・土地/建物面積)が詳細で確定できないものは誤登録防止で止める
  const a = scan?.attrs ?? {};
  if (scan && (a.land_m2 == null || a.floor_m2 == null || unit.price_man == null)) {
    codes.push("KO5_incomplete");
    reasons.push(`詳細ページから必須項目を確定できず(土地${a.land_m2 ?? "?"}/建物${a.floor_m2 ?? "?"}/価格${unit.price_man ?? "?"})`);
  }
  if (codes.length) return { verdict: "block", codes, reasons, site_match: siteHit ?? null, attrs: scan?.attrs ?? null };
  if (siteHit?.level === "near") {
    return { verdict: "suspect", codes: ["SITE_NEAR"], site_match: siteHit, attrs: scan?.attrs ?? null,
      reasons: [`除外済み現場と同一丁目・近接諸元(${siteHit.ref}${siteHit.unit ? " " + siteHit.unit : ""}・照合=${siteHit.by})。同一現場の別戸なら同じ制限がかかるため、掲載元と公式マップで確認するまで登録しない。${siteHit.reason}`] };
  }
  if (!scan) return { verdict: "unknown", codes: ["NO_DETAIL"], reasons: ["詳細ページ未取得(取得予算切れ等)のためKO判定不能"], site_match: null, attrs: null };
  // SUUMO単独の「記載なし」はハザード無しの証明にならない(2026-08-12の実例)。判定は通すが限界を明示する
  const caveat = scan.hazard_media === "suumo"
    ? "SUUMO単独確認。その他制限事項は該当物件でも空欄のことがあるため、登録時にathome掲載も確認すること"
    : null;
  return { verdict: "pass", codes: [], reasons: [], site_match: null, attrs: scan.attrs, caveat };
}
