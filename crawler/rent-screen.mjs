// crawler/rent-screen.mjs — 戸建賃貸のノックアウト(KO)スクリーニングと詳細抽出。
// 純関数のみ(ネットワーク・I/Oなし)。購入版 crawler/screen.mjs と同じ設計思想:
//   ①「登録してはいけない物件」を人手の前に機械で落とす
//   ② 落とした件数と理由を必ず開示する(黙って減らさない)
//   ③ 読み取れない項目は null を返し、**判定しない**(誤って落とさない)
//
// 賃貸のKO基準(2026-08-18ユーザー決定):
//   RKO1 定期借家 — ただし**契約期間がちょうど3年のものだけは可**(2026-08-18ユーザー指示)。
//        理由は子供の小学校入学前に区切りをつけたいという生活側の事情で、
//        「短いからKO」ではなく「3年という長さが要件に合う」という指定。したがって
//        2年(短すぎる)も4年以上(入学後に退去期限が来る)も等しくKOになる。
//        北区の戸建賃貸66件の実測では定期借家23件のうち3年は5件
//   RKO2 告知事項あり(心理的瑕疵・事故物件)
//   RKO3 建物種別が一戸建てでない(テラス・タウンハウス=連棟は対象外)
// 掲載条件(KOではなく「圏外」。条件を変えれば戻せるものはこちら):
//   賃料+管理費のレンジ / 徒歩分 / 居室数 / 旧耐震
//
// **トイレ2個はKOにも圏外にもしない**。SUUMOの設備タグは任意記載で、
// 記載が無いことは「無い」ことを意味しない(実測66件中10件しか記載がなく、条件に加えると
// 候補が1件まで落ちる)。事実として3値(あり/記載なし/不明)で持ち、人が現地で確認する。

export const zen = (s) => String(s ?? "").replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

// SUUMO賃貸の詳細ページをパイプ区切りのテキストへ正規化する。
// タグ境界を `|` にすることで「ラベル|値」の隣接関係が保たれ、ラベル直後にアンカーして値を取れる。
// (購入版 screen.mjs と同じ考え方。空白だけで潰すと広告文と本文が地続きになる)
export function flattenDetail(html) {
  let t = String(html ?? "").replace(/<[^>]+>/g, "|");
  t = t.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
       .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  t = t.replace(/ /g, " ").replace(/\s+/g, " ");
  return t.replace(/(\s*\|\s*)+/g, "|");
}

// 「25万円」「10000円」→ 万円(数値)。読めなければ null
export function manOf(s) {
  if (s == null) return null;
  const t = zen(String(s));
  const m1 = t.match(/([\d.]+)\s*万円/);
  if (m1) return Number(m1[1]);
  const m2 = t.match(/([\d,]+)\s*円/);
  if (m2) return Number(m2[1].replace(/,/g, "")) / 10000;
  return null;
}

// 「敷金: 25万円」「1ヶ月」→ 賃料何ヶ月分か。金額表記は rent で割って月数に直す。
// 「-」「無」「なし」は 0(事実として「無い」)。読めない表記は null(判定しない)
export function monthsOf(s, rentMan) {
  if (s == null) return null;
  const t = zen(String(s)).trim();
  if (/^(-|－|ー|無し?|なし|不要)$/.test(t)) return 0;
  const mm = t.match(/([\d.]+)\s*[ヶケ箇]?月/);
  if (mm) return Number(mm[1]);
  const pc = t.match(/([\d.]+)\s*[%％]/);
  if (pc) return Number(pc[1]) / 100;
  const man = manOf(t);
  if (man != null && rentMan) return man / rentMan;
  return null;
}

const LINE_WALK_RE = /\|([^|/]{2,20}?線)\/(\S{1,20}?駅)\s*歩(\d+)分/g;

// 詳細ページから台帳に必要な実値を取る。
// **物件ヘッダ(建物種別より前)に限定する欄がある**: 賃料・所在地・駅徒歩・間取り・専有面積。
// ページ下部の「この物件を見た人はこんな物件も見ています」に同じ形の
// 「賃料(管理費)」ブロックがあり、全文検索すると他物件の賃料を掴む(2026-08-18に実測で確認)。
export function parseRentDetail(html) {
  const t = flattenDetail(html);
  const iType = t.indexOf("|建物種別|");
  const head = iType > 0 ? t.slice(0, iType) : t.slice(0, 20000);
  // 物件概要表のラベルは最初の出現が対象物件のもの(推薦枠は概要表を持たない)
  const fld = (label) => {
    const m = t.match(new RegExp("\\|" + label + "\\|([^|]*)"));
    const v = m ? m[1].trim() : null;
    return v === "" || v === "-" || v === "－" || v === "ー" ? null : v;
  };

  const money = head.match(/\|([\d.]+万円)\|管理費・共益費:\s*([^|]*)\|敷金:\s*([^|]*)\|礼金:\s*([^|]*)\|保証金:\s*([^|]*)\|敷引・償却:\s*([^|]*)/);
  const rentMan = money ? manOf(money[1]) : null;

  const addr = (head.match(/\|所在地\|(東京都北区[^|]*)/) ?? [])[1]?.trim() ?? null;
  const walks = [];
  for (const m of head.matchAll(LINE_WALK_RE)) walks.push({ line: m[1], station: m[2], walk_min: Number(m[3]) });

  const layout = (head.match(/\|間取り\|(\d+[SLDKR]{1,4})/) ?? [])[1] ?? null;
  const area = (head.match(/専有面積\|([\d.]+)\s*m/) ?? [])[1] ?? null;
  const builtRaw = fld("築年月");
  const bm = builtRaw ? zen(builtRaw).match(/(\d{4})年(\d{1,2})月/) : null;
  const setsubi = (t.match(/\|部屋の特徴・設備\|([^|]+)/) ?? [])[1] ?? "";
  const btype = fld("建物種別");
  const contractRaw = fld("契約期間");

  return {
    rent_man: rentMan,
    kanri_man: money ? (manOf(money[2]) ?? 0) : null,
    kanri_raw: money ? money[2].trim() : null,
    total_man: rentMan != null && money ? Number((rentMan + (manOf(money[2]) ?? 0)).toFixed(4)) : null,
    shiki_raw: money ? money[3].trim() : null,
    rei_raw: money ? money[4].trim() : null,
    hoshoukin_raw: money ? money[5].trim() : null,
    shikibiki_raw: money ? money[6].trim() : null,
    shiki_months: money ? monthsOf(money[3], rentMan) : null,
    rei_months: money ? monthsOf(money[4], rentMan) : null,
    address: addr,
    district: addr ? (zen(addr).match(/東京都北区([^\d\s]+)/) ?? [])[1] ?? null : null,
    chome: addr ? (zen(addr).match(/東京都北区\D+(\d+)/) ?? [])[1] ?? null : null,
    walks,
    walk_min: walks.length ? Math.min(...walks.map((w) => w.walk_min)) : null,
    layout,
    rooms: roomsOfRent(layout),
    has_ldk: layout ? /LDK/.test(layout) : null,
    area_m2: area ? Number(area) : null,
    built_year: bm ? Number(bm[1]) : null,
    built_month: bm ? Number(bm[2]) : null,
    built_raw: builtRaw,
    building_type: btype,
    structure: fld("構造"),
    madori_detail: fld("間取り詳細"),
    parking: fld("駐車場"),
    insurance_raw: fld("損保"),
    guarantor_raw: fld("保証会社"),
    brokerage_raw: fld("仲介手数料"),
    move_in: fld("入居"),
    contract_raw: contractRaw,
    contract: contractTypeOf(contractRaw),
    setsubi: setsubi ? setsubi.split(/[、,]/).map((x) => x.trim()).filter(Boolean) : [],
    // 記載があれば true、無ければ null(=不明)。false は「無いと確認できた」場合だけに使いたいが
    // 掲載からは確認できないため出さない。**null を false と読み替えないこと**
    toilet2: /トイレ\s*[2２]\s*[ヶケ箇]所/.test(t) ? true : null,
    notice: /告知事項\s*(?:あり|有)|心理的瑕疵|事故物件/.test(t) ? true : null,
    bikou: fld("備考"),
  };
}

// 「4LDK」=4室 / 「2SLDK」=3室(納戸を1室として数える) / 「3DK」=3室だがLDK無し。
// 数えられない表記は null を返し、条件判定を行わない(誤って落とさない)
export function roomsOfRent(layout) {
  if (!layout) return null;
  const t = zen(String(layout));
  const m = t.match(/^(\d{1,2})\s*([SLDKR]{1,4})/);
  if (!m) return null;
  return Number(m[1]) + (m[2].includes("S") ? 1 : 0);
}

// 契約期間欄「普通借家 2年」「定期借家 西暦2030年3月まで」→ {type, years, until}
export function contractTypeOf(raw) {
  if (!raw) return { type: null, years: null, raw: null };
  const t = zen(String(raw));
  const type = /定期借家/.test(t) ? "teiki" : /普通借家/.test(t) ? "futsu" : null;
  const y = t.match(/(\d+(?:\.\d+)?)\s*年/);
  const until = t.match(/西暦(\d{4})年(\d{1,2})月/);
  return { type, years: y && !until ? Number(y[1]) : null, until: until ? `${until[1]}-${String(until[2]).padStart(2, "0")}` : null, raw: t };
}

// 新耐震の判定。基準は「1981年6月1日以降の建築確認」だが、掲載に出るのは**竣工の築年月**だけ。
// 確認から竣工までの工期があるため、竣工1982年1月以降なら新耐震とみなせる。
// 1981年中の竣工は確認が旧基準の可能性があり **判別できない**(border)。断定しない。
export function seismicOf(builtYear, builtMonth) {
  if (!builtYear) return { level: null, label: "築年不明" };
  if (builtYear >= 1982) return { level: "new", label: "新耐震(1982年以降竣工)" };
  if (builtYear === 1981) return { level: "border", label: "1981年竣工=建築確認の時期により判別不能" };
  return { level: "old", label: "旧耐震(1980年以前竣工)" };
}

// ---- KO判定 ----
// 許容する定期借家の契約年数(2026-08-18ユーザー指示「三年のみOK(子供の小学校入学前タイミング)」)。
// **長さの要件**であって「短いほど悪い」ではないので、2年も4年以上も等しく外れる。
// 変更するときは tests/rent-screen.test.js と CLAUDE.md の方針記述も同時に直すこと
export const TEIKI_OK_YEARS = new Set([3]);

// verdict: block=登録しない / suspect=人の判断へ / pass=候補
export function rentKoScreen(detail) {
  const codes = [], notes = [];
  if (!detail) return { verdict: "suspect", codes: ["RKO0"], notes: ["詳細ページを取得できず判定不能"] };

  if (detail.contract?.type === "teiki") {
    const y = detail.contract.years;
    if (y != null && TEIKI_OK_YEARS.has(y)) {
      // 落とさないが、普通借家と同じものとして扱わない。期間満了で確実に終わる契約であることを残す
      notes.push(`定期借家${y}年。期間満了で契約は終了し再契約は貸主の同意が要るが、` +
        `${[...TEIKI_OK_YEARS].join("・")}年は掲載条件として許容している(2026-08-18ユーザー指示: 子供の小学校入学前の区切り)`);
    } else if (y == null) {
      // 「西暦2030年3月まで」形式。期間の長さが読めないので落とさず人へ回す
      return { verdict: "suspect", codes: ["RKO1?"],
        notes: [`定期借家だが契約期間が期日表記(${detail.contract.until ?? "不明"})で長さを判定できない。` +
          `許容は${[...TEIKI_OK_YEARS].join("・")}年ちょうどなので、入居日と満了日から実期間を確認すること`] };
    } else {
      codes.push("RKO1");
      notes.push(`定期借家${y}年。許容は${[...TEIKI_OK_YEARS].join("・")}年ちょうどのみ` +
        `(2026-08-18ユーザー指示: 子供の小学校入学前の区切り)。${y < 3 ? "短くて区切りに足りない" : "満了が入学後に来る"}ためKO`);
    }
  }
  if (detail.notice === true) {
    codes.push("RKO2");
    notes.push("告知事項あり(心理的瑕疵の表示)");
  }
  if (detail.building_type && !/一戸建/.test(detail.building_type)) {
    codes.push("RKO3");
    notes.push(`建物種別が「${detail.building_type}」(掲載条件は一戸建てのみ。テラス・タウンハウス=連棟は対象外)`);
  }
  // 契約期間が掲載に無い物件は定期借家かどうか分からない。落とさず人へ回す
  if (!codes.length && detail.contract?.type === null) {
    return { verdict: "suspect", codes: ["RKO1?"], notes: ["契約期間の記載が無く、普通借家か定期借家か判別できない。問い合わせで確認が要る"] };
  }
  return { verdict: codes.length ? "block" : "pass", codes, notes };
}

// ---- 掲載条件(圏外)判定 ----
// KOではない。条件を変えれば戻せるものはこちら。判定できない項目は素通しする
export const RENT_SCOPE = {
  total_min_man: 15,     // 賃料+管理費の下限(万円)
  total_max_man: 25,     // 同 上限
  walk_max: 10,          // 最寄り駅からの徒歩(分)。路線は問わない(2026-08-18ユーザー決定)
  rooms_min: 3,          // 居室数。納戸(S)は1室として数える
  require_ldk: true,     // 3DK・4Kは対象外(条件は3LDK)
  seismic_new_only: true,
};

export function rentScopeCheck(detail, cfg = RENT_SCOPE) {
  if (!detail) return null;
  const t = detail.total_man;
  if (t != null && t < cfg.total_min_man) return `賃料+管理費${t}万(下限${cfg.total_min_man}万)`;
  if (t != null && t > cfg.total_max_man) return `賃料+管理費${t}万(上限${cfg.total_max_man}万)`;
  if (detail.walk_min != null && detail.walk_min > cfg.walk_max) return `最寄り徒歩${detail.walk_min}分(上限${cfg.walk_max}分)`;
  if (detail.rooms != null && detail.rooms < cfg.rooms_min) return `${detail.layout}=${detail.rooms}室(条件は${cfg.rooms_min}室以上)`;
  if (cfg.require_ldk && detail.has_ldk === false) return `${detail.layout}(条件はLDKのある3LDK以上)`;
  if (cfg.seismic_new_only) {
    const s = seismicOf(detail.built_year, detail.built_month);
    if (s.level === "old") return `${detail.built_raw}築=${s.label}`;
  }
  return null;
}
