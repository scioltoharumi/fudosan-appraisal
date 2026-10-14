// site/templates/plan3d.js — 間取りシミュレーター(3D)。神谷2-24 A区画の参考プラン図(2026-10-08付・1/100)を
// 寸法どおりに再構成し、設備(トイレ・洗面台・洗濯機・UB等)を置き換え・移動して検討できるページを生成する。
// 2026-10-14ユーザー要望「シミュレーション出来るよう3Dモデル化して。どこにトイレつけようか、洗面所狭くないか、色々検討したい」。
//
// 設計:
//   - **数値は全て図面の寸法(芯々・mm)から**。壁の位置は寸法線の値、設備の寸法はメーカー標準値の仮置き(ITEM_CATALOG)。
//     図面に無いもの(階高・壁厚・階段の段割り・敷地内の建物位置)は ASSUMPTIONS に明記し、ページにも開示する
//   - データ(PLAN)はこのモジュールが正本。ブラウザ側の編集・描画コードは site/client/plan3d.js(ビルド時にそのまま埋め込む)。
//     three.js は site/vendor/ に同梱(ビルドはネットワークに出ない方針。importmap で "three" を vendor へ解決)
//   - 座標系: x=東(西側の壁芯を0・m)、y=南(北側の壁芯を0・m)。3Dでは X=x, Z=y, Y=高さ
//   - 判定はしない。寸法・面積・隙間(クリアランス)・頭上高さを測って見せるだけ(v3.0.0の思想)
import { layout, esc, escRich } from "./layout.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- 図面から読み取った定数(mm→m) -------------------------------------------------------
const W = 3.375;          // 建物幅(芯々)
const L = 9.1;            // 建物奥行(芯々)
export const GRID = 0.455; // 半間(455mm)モジュール。図面は 910/1,365/1,820/2,275/2,465/3,445/4,095 の組合せ
const C = { // 柱芯・壁芯の位置(図面の寸法線の累計)
  xW: 1.555,   // 西列(洗面・UB・3Fトイレ・CL)の東壁芯 = 1,555
  xH: 2.465,   // 東列(トイレ・階段・CL・カウンター)の西壁芯 = 1,555+910
  xG: 2.225,   // 1F 車庫/ポーチ境の芯 = 3,375−1,150
  y1: 1.82,    // 1F 玄関ドアの壁 = 600+1,220
  y2: 2.73,    // 1F 玄関/ホール(上がり框)= 1.82+0.91
  y3: 3.185,   // 1F 車庫の南壁 = 3,185
  y4: 4.095,   // 階段上端・1Fトイレ北壁・2F/3Fの柱芯 = 4,095
  y5: 5.005,   // 1F 洗面/UB境 = 3.185+1.82 / 3F トイレ南壁 = 4.095+0.91
  y6: 5.46,    // 1F トイレ/階段境 = 4.095+1.365
  y7: 5.655,   // 3F 南CL南壁 = 5.005+0.65
  y8: 5.915,   // 3F 階段南端 = 4.095+1.82 / ロフト南端 = 3.445+2.47
  y9: 6.825,   // 1F 納戸北壁・2F 階段南端 = 4.095+2.73
  y10: 7.475,  // 1F CL南端 = 6.825+0.65
  y11: 3.445,  // 3F 北洋室南壁・吹抜南端 = 3,445
};

// 階高(図面の断面スケッチ・2026-10-14に読み取り)。1F床=GL+0.461(図面の「461」=ユーザー提供値と一致・YAML flood_fermi.floor_height_m)。
// 縦寸法: 461 / 1F天井2,250 / 床厚400 / 2F天井2,400 / 床厚420 / 3F天井2,250 / ロフト床厚300 / ロフト床→棟下端1,245 / ロフト端の頭上≒850。
// 棟下端 GL+9.73。屋根厚は図面に無い(ROOF.thickness は仮定)
export const LEVELS = {
  "1F": { z: 0, ceil: 2.25, story: 2.65 },
  "2F": { z: 2.65, ceil: 2.40, story: 2.82 },
  "3F": { z: 5.47, ceil: 2.25, story: 2.55 },     // ロフト下の天井。吹抜部(北洋室)は屋根まで
  "LOFT": { z: 8.02, ceil: 1.245, story: 1.245 },  // ceil は棟直下の最大値(軒側は ≒0.85→0 へ下がる)
};
// 屋根(断面スケッチ): 長手方向(南北)の切妻。棟は東西方向・建物中央(y=L/2・スケッチの棟位置は中央から±0.2m以内)。
// 軒はロフト床レベルで北面・南面の壁芯に下り、立ち上がりは 1,245 → 勾配 1,245/4,550=0.274(約2.7寸)。
// ロフト(y 3.445〜5.915)の頭上: 北端 0.94・南端 0.87(スケッチの≒850と整合)・棟直下 1.245。屋根厚0.2・軒の出0.25は仮定
export const ROOF = { ridgeY: L / 2, rise: 1.245, thickness: 0.2, overhang: 0.25 };
export const roofHeightAt = (y) => Math.max(0, ROOF.rise * (1 - Math.abs(y - ROOF.ridgeY) / (L / 2)));   // ロフト床からの屋根下端の高さ(内法)
export const WALL_T = { ext: 0.15, int: 0.09 };  // 壁厚(仮定。内法 = 芯々 − 半厚の和)

// 階段(図面: 1F→2F/2F→3F とも東列 x 2.465〜3.375・下端 y 6.825・上端 y 4.095。下端の 910 角に回り段3段+直階段11段と読む。
// 2Fの階段表記は両端に扇形、3Fの開口が 1.82(=直階段部のみ)で、カウンターが下3段の上に乗る形と整合する)
export const STAIR = { x0: C.xH, x1: W, yTop: C.y4, yTurn: C.y8, yBottom: C.y9, winders: 3, straight: 11, thickness: 0.25 };

// 敷地(区割図): 北辺4.392(道路側)・南辺4.323・東辺10.938・西辺10.872(B区画と共有)。建物の北面は道路境界から1.15(1F平面図の寸法)。
// 東西の空きは北辺の余り(4.392−3.375=1.017)を等分=0.51(**仮定**。区割図に建物の位置は無い)
const NS = 1.15, GAPW = 0.5085;
export const LOT = {
  polygon: [[-GAPW, -NS], [4.392 - GAPW, -NS], [4.392 - GAPW - 0.0345, -NS + 10.938], [-GAPW + 0.0345, -NS + 10.872]],
  area_m2: 47.52, frontage_m: 4.392, road_width_m: 6.0,
  // B区画(北辺4.192・西辺10.115・東辺は本区画の西辺)。建物未定なので輪郭のみ
  b: [[-GAPW - 4.192, -NS], [-GAPW, -NS], [-GAPW + 0.0345, -NS + 10.872], [-GAPW - 4.192, -NS + 10.115]],
};

// ---- 壁(芯線) ----------------------------------------------------------------------------
const seg = (x1, y1, x2, y2, kind = "int") => ({ x1, y1, x2, y2, kind });
const extRect = (openNorth = false) => [
  ...(openNorth ? [] : [seg(0, 0, W, 0, "ext")]),
  seg(W, 0, W, L, "ext"), seg(W, L, 0, L, "ext"), seg(0, L, 0, 0, "ext"),
];

// ---- 間取り(部屋は面積・ラベル用。壁とは独立に持つ) ------------------------------------------
const room = (name, x0, y0, x1, y1, extra = {}) => ({ name, x0, y0, x1, y1, ...extra });

export const FLOORS = {
  "1F": {
    label: "1F",
    walls: [
      ...extRect(true),                       // 北面は車庫・ポーチとも開口(壁は玄関ドア位置 y=1.82 に立つ)
      seg(C.xG, C.y1, W, C.y1),               // 玄関ドアの壁
      seg(C.xG, C.y1, C.xG, C.y3),            // 車庫/玄関・ホール
      seg(0, C.y3, C.xG, C.y3),               // 車庫の南壁(洗面の北壁)
      seg(C.xW, C.y3, C.xW, C.y9),            // 西列(洗面・UB)の東壁
      seg(0, C.y5, C.xW, C.y5),               // 洗面/UB
      seg(0, C.y9, W, C.y9),                  // 納戸の北壁・階段の南壁
      seg(C.xH, C.y4, C.xH, C.y10),           // トイレ・階段・CLの西壁
      seg(C.xH, C.y4, W, C.y4),               // トイレの北壁
      seg(C.xH, C.y6, W, C.y6),               // トイレ/階段
    ],
    rooms: [
      room("車庫", 0, 0, C.xG, C.y3, { kind: "garage", note: "図面 8.13m²(コンパクトカーサイズ)" }),
      room("ポーチ", C.xG, 0, W, C.y1, { kind: "outside", note: "図面 2.63m²・屋根下" }),
      room("玄関", C.xG, C.y1, W, C.y2),
      room("ホール", C.xW, C.y3, W, C.y4, { note: "廊下は 1,555〜2,465 の幅910" }),
      room("洗面脱衣室", 0, C.y3, C.xW, C.y5, { note: "1,555×1,820(芯々)" }),
      room("UB1316", 0, C.y5, C.xW, C.y9, { kind: "bath" }),
      room("トイレ", C.xH, C.y4, W, C.y6, { note: "階段下(910×1,365)" }),
      room("階段", C.xH, C.y6, W, C.y9, { kind: "stair" }),
      room("CL", C.xH, C.y9, W, C.y10, { kind: "closet" }),
      room("洋室(納戸)4.3帖", 0, C.y9, W, L, { note: "2,275×3,375・内法 4.3帖" }),
    ],
    openings: [
      { type: "door", x: 2.80, y: C.y1, w: 0.85, dir: "N", hinge: "E", label: "玄関ドア" },
      { type: "door", x: C.xW, y: 3.65, w: 0.70, dir: "E", hinge: "S", label: "洗面" },
      { type: "door", x: C.xW, y: 5.66, w: 0.65, dir: "E", hinge: "N", label: "UB(折戸)", fold: true },
      { type: "door", x: C.xH, y: 4.55, w: 0.65, dir: "W", hinge: "N", label: "トイレ" },
      { type: "door", x: 1.95, y: C.y9, w: 0.73, dir: "S", hinge: "W", label: "納戸" },
      { type: "door", x: 2.92, y: C.y10, w: 0.80, dir: "S", hinge: "E", label: "CL(折戸)", fold: true },
      { type: "window", x: W, y: 4.65, w: 0.6, dir: "E" },
      { type: "window", x: 0, y: 4.1, w: 0.6, dir: "W" },
      { type: "window", x: 0.78, y: L, w: 1.4, dir: "S" },
      { type: "window", x: W, y: 8.1, w: 0.8, dir: "E" },
    ],
    items: [
      { type: "car_compact", x: 1.11, y: 1.12, rot: 0 },
      { type: "washstand750", x: 0.355, y: 3.65, rot: 90 },
      { type: "washer", x: 0.40, y: 4.57, rot: 0 },
      { type: "ub1316", x: 0.78, y: 5.93, rot: 0 },
      { type: "toilet", x: 2.92, y: 5.00, rot: 0 },
      { type: "bed_s", x: 0.63, y: 7.95, rot: 0 },
      { type: "desk", x: 2.75, y: 8.65, rot: 0 },
      { type: "chair", x: 2.75, y: 8.15, rot: 180 },
      { type: "person", x: 0.95, y: 4.10, rot: 0, label: "人(洗面)" },
    ],
  },
  "2F": {
    label: "2F",
    walls: [
      ...extRect(),
      seg(C.xH, C.y4, C.xH, C.y9),            // 階段の西壁
      seg(C.xH, C.y4, W, C.y4),               // 階段の北壁
      seg(C.xH, C.y9, W, C.y9),               // 階段の南壁(キッチン側)
      seg(0, C.y4, 0.65, C.y4),               // 西壁の壁柱(図面の L/DK 境の袖壁)
    ],
    rooms: [
      room("バルコニー", 0, -0.91, W, 0, { kind: "outside", note: "3.07m²" }),
      room("LDK 17.4帖", 0, 0, W, L, { note: "階段(910×2,730)を除く" }),
      room("階段", C.xH, C.y4, W, C.y9, { kind: "stair" }),
    ],
    openings: [
      { type: "window", x: 1.69, y: 0, w: 1.7, dir: "N", label: "バルコニー掃出し" },
      { type: "window", x: 0, y: 5.40, w: 1.0, dir: "W" },
      { type: "window", x: W, y: 2.25, w: 1.5, dir: "E" },
      { type: "window", x: W, y: 7.8, w: 0.6, dir: "E" },
      { type: "window", x: 1.69, y: L, w: 1.6, dir: "S" },
    ],
    items: [
      { type: "kitchen2400", x: 2.11, y: 7.18, rot: 0 },
      { type: "fridge", x: 0.42, y: 8.70, rot: 0 },
      { type: "cupboard", x: 2.15, y: 8.85, rot: 0 },
      { type: "dining", x: 0.95, y: 5.75, rot: 90 },
      { type: "chair", x: 0.95, y: 4.95, rot: 0 }, { type: "chair", x: 0.95, y: 6.55, rot: 180 },
      { type: "chair", x: 0.35, y: 5.75, rot: 90 }, { type: "chair", x: 1.55, y: 5.75, rot: 270 },
      { type: "sofa3", x: 0.60, y: 2.25, rot: 90 },
      { type: "table_low", x: 1.70, y: 2.35, rot: 90 },
      { type: "tvboard", x: 3.0, y: 2.3, rot: 90 },
    ],
  },
  "3F": {
    label: "3F",
    walls: [
      ...extRect(),
      seg(0, C.y11, C.xH, C.y11),             // 北洋室の南壁(西〜ホール)
      seg(C.xH, C.y11, C.xH, C.y4),           // 北洋室の東アルコーブの西壁(ドア吊元)
      seg(C.xH, C.y4, W, C.y4),               // 階段の北壁
      seg(C.xH, C.y5, C.xH, C.y8),            // 階段の西壁(上部は降り口で開放)
      seg(C.xH, C.y8, W, C.y8),               // 階段の南壁(カウンター北)
      seg(C.xW, C.y11, C.xW, C.y7),           // 西列(CL・トイレ・CL)の東壁
      seg(0, C.y4, C.xW, C.y4),               // トイレ北壁
      seg(0, C.y5, C.xW, C.y5),               // トイレ南壁
      seg(0, C.y7, C.xH, C.y7),               // 南洋室の北壁
      seg(C.xH, C.y7, C.xH, C.y8),            // ホール/カウンター
    ],
    rooms: [
      room("バルコニー", 0, -0.91, W, 0, { kind: "outside", note: "3.07m²" }),
      room("洋室 7.9帖(上部吹抜)", 0, 0, W, C.y11, { note: "東側は 4,095 まで(アルコーブ)" }),
      room("CL", 0, C.y11, C.xW, C.y4, { kind: "closet" }),
      room("トイレ", 0, C.y4, C.xW, C.y5, { note: "910×1,555" }),
      room("CL", 0, C.y5, C.xW, C.y7, { kind: "closet" }),
      room("ホール", C.xW, C.y11, C.xH, C.y7),
      room("階段", C.xH, C.y4, W, C.y8, { kind: "stair" }),
      room("カウンター", C.xH, C.y8, W, C.y9, { note: "階段の下3段の上" }),
      room("洋室 7.3帖", 0, C.y7, W, L),
    ],
    openings: [
      { type: "window", x: 1.69, y: 0, w: 1.7, dir: "N", label: "バルコニー掃出し" },
      { type: "door", x: 2.0, y: C.y11, w: 0.73, dir: "S", hinge: "E", label: "北洋室" },
      { type: "door", x: C.xW, y: 4.55, w: 0.65, dir: "E", hinge: "N", label: "トイレ" },
      { type: "door", x: 2.0, y: C.y7, w: 0.73, dir: "S", hinge: "W", label: "南洋室" },
      { type: "door", x: 0.78, y: C.y11, w: 1.3, dir: "N", hinge: "W", label: "CL(折戸)", fold: true },
      { type: "door", x: 0.78, y: C.y7, w: 1.3, dir: "S", hinge: "W", label: "CL(折戸)", fold: true },
      { type: "window", x: W, y: 2.3, w: 1.5, dir: "E" },
      { type: "window", x: W, y: 7.6, w: 1.5, dir: "E" },
      { type: "window", x: 1.69, y: L, w: 1.6, dir: "S" },
      { type: "window", x: 0, y: 4.55, w: 0.5, dir: "W" },
    ],
    items: [
      { type: "bed_d", x: 2.55, y: 2.1, rot: 0 },
      { type: "desk", x: 2.9, y: 3.75, rot: 90 },
      { type: "toilet", x: 0.55, y: 4.55, rot: 90 },
      { type: "bed_s", x: 1.6, y: 7.65, rot: 90 },
      { type: "counter_desk", x: 2.92, y: 6.37, rot: 0 },
      { type: "desk", x: 0.45, y: 8.3, rot: 90 },
      { type: "chair", x: 0.95, y: 8.3, rot: 270 },
      { type: "ladder", x: 0.45, y: 3.25, rot: 180, h: 2.55 },   // ロフトへのはしご(3Fの北洋室側から吹抜の縁へ掛ける想定・図面に無い)
    ],
  },
  "LOFT": {
    label: "ロフト",
    walls: [seg(0, C.y11, W, C.y11, "void"), seg(W, C.y11, W, C.y8, "ext"), seg(W, C.y8, 0, C.y8, "ext"), seg(0, C.y8, 0, C.y11, "ext")],
    rooms: [
      room("吹抜(北洋室の上)", 0, 0, W, C.y11, { kind: "void", note: "11.62m²" }),
      room("ロフト 5.1帖", 0, C.y11, W, C.y8, { note: "2,470×3,375・頭上は棟直下1.245〜端≒0.85(屋根勾配)・オプション" }),
    ],
    openings: [],
    items: [{ type: "futon", x: 1.9, y: 4.7, rot: 90 }],
    floorRect: { x0: 0, y0: C.y11, x1: W, y1: C.y8 },
  },
};

// ---- 改案B(2026-10-14ユーザー要望「バルコニー無しにして部屋を増やす / 3階を三部屋に割る / 2階に風呂と脱衣所を移す」) ----
// 前提: 構造(柱位置・階段位置・外壁の芯)はA案のまま。バルコニー(片持ち910)を撤去し、代わりに2F・3Fの北面を 455mm 北へ張り出す
// (建ぺい率70%の残り2.55m²に収まる最大のモジュール。片持ち910のバルコニーが片持ち455の床に変わる)。
// 3Fは 洋室N(北・吹抜つき)/洋室M(西列の細長い部屋・採光は天窓)/洋室S(南)の三部屋+廊下。3Fトイレは廃止し2Fの脱衣所の隣へ。
// 2Fは LDK の南西に UB1316+脱衣所、中列にトイレ。1FはA案の洗面脱衣・UBの位置が 収納(手洗い)+WIC になる。
// 法規の机上計算は CHECK_B(ページの「改案B」節に表で出す)。確認申請の設計者の検証が要る。
export const EXT_N = 0.455;                 // 2F・3Fの北への張り出し(m)
const yN = -EXT_N;
const extRectB = () => [seg(0, yN, W, yN, "ext"), seg(W, yN, W, L, "ext"), seg(W, L, 0, L, "ext"), seg(0, L, 0, yN, "ext")];
const yT1 = 5.005, yT2 = 6.37;              // 2F トイレ(中列 910×1,365)
const yBath = 7.28;                          // 2F 脱衣所/UB境(UB 1,555×1,820 = A案1FのUBと同じモジュール)
const yM = 2.73;                             // 3F 洋室N/廊下・洋室M 境
export const FLOORS_B = {
  "1F": {
    label: "1F",
    walls: FLOORS["1F"].walls,              // 壁はA案と同じ(水回りを抜いただけ)
    rooms: [
      room("車庫", 0, 0, C.xG, C.y3, { kind: "garage", note: "A案と同じ 8.13m²" }),
      room("ポーチ", C.xG, 0, W, C.y1, { kind: "outside", note: "A案と同じ" }),
      room("玄関", C.xG, C.y1, W, C.y2),
      room("ホール", C.xW, C.y3, W, C.y4),
      room("収納(手洗い)", 0, C.y3, C.xW, C.y5, { kind: "closet", note: "A案の洗面脱衣室の位置。玄関脇の収納+手洗い器。2F浴室の給排水(PS)をこの角に通す" }),
      room("WIC", 0, C.y5, C.xW, C.y9, { kind: "closet", note: "A案のUBの位置。洋室から出入り(1,555×1,820)" }),
      room("トイレ", C.xH, C.y4, W, C.y6, { note: "階段下(A案と同じ)" }),
      room("階段", C.xH, C.y6, W, C.y9, { kind: "stair" }),
      room("CL", C.xH, C.y9, W, C.y10, { kind: "closet" }),
      room("洋室(納戸)4.3帖+WIC", 0, C.y9, W, L, { note: "A案と同じ。採光の計算上は居室にならない(納戸扱い)のもA案と同じ" }),
    ],
    openings: [
      { type: "door", x: 2.80, y: C.y1, w: 0.85, dir: "N", hinge: "E", label: "玄関ドア" },
      { type: "door", x: C.xW, y: 3.65, w: 0.70, dir: "E", hinge: "S", label: "収納" },
      { type: "door", x: 0.78, y: C.y9, w: 0.73, dir: "N", hinge: "W", label: "WIC" },
      { type: "door", x: C.xH, y: 4.55, w: 0.65, dir: "W", hinge: "N", label: "トイレ" },
      { type: "door", x: 1.95, y: C.y9, w: 0.73, dir: "S", hinge: "W", label: "洋室" },
      { type: "door", x: 2.92, y: C.y10, w: 0.80, dir: "S", hinge: "E", label: "CL(折戸)", fold: true },
      { type: "window", x: W, y: 4.65, w: 0.6, dir: "E" },
      { type: "window", x: 0, y: 4.1, w: 0.6, dir: "W" },
      { type: "window", x: 0.78, y: L, w: 1.4, dir: "S" },
      { type: "window", x: W, y: 8.1, w: 0.8, dir: "E" },
    ],
    items: [
      { type: "car_compact", x: 1.11, y: 1.12, rot: 0 },
      { type: "handwash", x: 0.22, y: 3.55, rot: 90 },
      { type: "wardrobe", x: 0.78, y: 5.28, rot: 0 },
      { type: "toilet", x: 2.92, y: 5.00, rot: 0 },
      { type: "bed_s", x: 0.63, y: 7.95, rot: 0 },
      { type: "desk", x: 2.75, y: 8.65, rot: 0 },
      { type: "chair", x: 2.75, y: 8.15, rot: 180 },
    ],
  },
  "2F": {
    label: "2F",
    walls: [
      ...extRectB(),
      seg(C.xH, C.y4, C.xH, C.y9),            // 階段の西壁
      seg(C.xH, C.y4, W, C.y4),               // 階段の北壁
      seg(C.xH, C.y9, W, C.y9),               // 階段の南壁(キッチン側)
      seg(C.xW, yT1, C.xW, L),                // 西列(脱衣所・UB)+トイレの西壁
      seg(0, C.y6, C.xW, C.y6),               // 脱衣所の北壁
      seg(0, yBath, C.xW, yBath),             // 脱衣所/UB
      seg(C.xW, yT1, C.xH, yT1),              // トイレの北壁
      seg(C.xW, yT2, C.xH, yT2),              // トイレの南壁
    ],
    rooms: [
      room("LDK 約13帖", 0, yN, W, L, { note: "A案17.4帖から、浴室・脱衣所・トイレ(計6.9m²)を2Fに置いたぶん減る。北へ455張り出し(+1.54m²)" }),
      room("トイレ", C.xW, yT1, C.xH, yT2, { note: "910×1,365。1Fトイレの対角(PSは階段西の廊下角)" }),
      room("脱衣所(洗面)", 0, C.y6, C.xW, yBath, { note: "1,555×1,820(A案1Fの洗面脱衣室と同じ)。洗濯機はここ" }),
      room("UB1316", 0, yBath, C.xW, L, { kind: "bath", note: "1,555×1,820。2F設置のユニットバス(木造2Fの標準的な納まり)" }),
      room("階段", C.xH, C.y4, W, C.y9, { kind: "stair" }),
    ],
    openings: [
      { type: "window", x: 1.69, y: yN, w: 1.7, dir: "N", label: "腰窓(バルコニー無し)" },
      { type: "window", x: W, y: 2.25, w: 1.5, dir: "E" },
      { type: "window", x: 0, y: 4.3, w: 1.0, dir: "W" },
      { type: "window", x: 0, y: 6.4, w: 0.5, dir: "W", sill: 1.3, h: 0.5 },
      { type: "window", x: 0, y: 8.2, w: 0.6, dir: "W", sill: 1.2, h: 0.5 },
      { type: "window", x: W, y: 7.9, w: 0.6, dir: "E", sill: 1.2, h: 0.5 },
      { type: "window", x: 2.4, y: L, w: 0.6, dir: "S", sill: 1.5, h: 0.5 },
      { type: "door", x: 2.0, y: yT1, w: 0.65, dir: "N", hinge: "E", label: "トイレ" },
      { type: "door", x: C.xW, y: 6.85, w: 0.70, dir: "E", hinge: "S", label: "脱衣所" },
      { type: "door", x: 0.78, y: yBath, w: 0.65, dir: "N", hinge: "W", label: "UB(折戸)", fold: true },
    ],
    items: [
      { type: "kitchen2400", x: 2.975, y: 7.97, rot: 90, w: 2.10 },   // I型2100 を東壁沿いに(2,275 の壁内に 2,100)
      { type: "fridge", x: 1.95, y: 8.67, rot: 0 },
      { type: "dining", x: 1.0, y: 4.3, rot: 90 },
      { type: "chair", x: 1.0, y: 3.5, rot: 0 }, { type: "chair", x: 1.0, y: 5.1, rot: 180 },
      { type: "chair", x: 0.4, y: 4.3, rot: 90 }, { type: "chair", x: 1.6, y: 4.3, rot: 270 },
      { type: "sofa3", x: 0.60, y: 1.45, rot: 90 },
      { type: "table_low", x: 1.70, y: 1.55, rot: 90 },
      { type: "tvboard", x: 3.0, y: 1.5, rot: 90 },
      { type: "washstand750", x: 0.355, y: 5.95, rot: 90 },
      { type: "washer", x: 0.40, y: 6.85, rot: 0 },
      { type: "ub1316", x: 0.78, y: 8.19, rot: 0 },
      { type: "toilet", x: 2.0, y: 5.95, rot: 0 },
    ],
  },
  "3F": {
    label: "3F",
    walls: [
      ...extRectB(),
      seg(0, yM, C.xH, yM),                   // 洋室Nの南壁(西〜廊下の北端)
      seg(C.xH, yM, C.xH, C.y4),              // 洋室Nのアルコーブの西壁
      seg(C.xH, C.y4, W, C.y4),               // 階段の北壁
      seg(C.xH, C.y5, C.xH, C.y8),            // 階段の西壁(上部は降り口で開放)
      seg(C.xH, C.y8, W, C.y8),               // 階段の南壁(カウンター北)
      seg(C.xH, C.y8, C.xH, C.y9),            // 廊下/カウンター
      seg(C.xW, yM, C.xW, C.y9),              // 洋室Mの東壁(廊下との境)
      seg(0, C.y9, C.xH, C.y9),               // 洋室Sの北壁
    ],
    rooms: [
      room("洋室N 6.7帖(上部吹抜)", 0, yN, W, yM, { note: "北の腰窓が採光と非常用進入口の代替開口(道路面)。東にアルコーブ" }),
      room("洋室N アルコーブ", C.xH, yM, W, C.y4, { note: "洋室Nの一部(階段上端の北)" }),
      room("洋室M 3.5帖", 0, yM, C.xW, C.y9, { note: "幅1,555(内法≈1,435)×4,095。西の窓は採光に数えられないので天窓(屋根南面・ロフト外の y5,915〜6,825)で採光を取る前提" }),
      room("廊下", C.xW, yM, C.xH, C.y9, { note: "910幅。階段を西へ降りて三室へ" }),
      room("階段", C.xH, C.y4, W, C.y8, { kind: "stair" }),
      room("洋室S カウンター", C.xH, C.y8, W, C.y9, { note: "階段の下3段の上(A案のカウンター)。洋室Sの一部" }),
      room("洋室S 4.3帖", 0, C.y9, W, L, { note: "南の窓 1,800×1,300 で採光。カウンター部を含めて約4.7帖" }),
    ],
    openings: [
      { type: "window", x: 1.69, y: yN, w: 1.7, dir: "N", label: "腰窓(非常用進入口の代替開口)" },
      { type: "door", x: 2.0, y: yM, w: 0.73, dir: "N", hinge: "E", label: "洋室N" },
      { type: "door", x: C.xW, y: 3.3, w: 0.70, dir: "W", hinge: "N", label: "洋室M" },
      { type: "door", x: 2.0, y: C.y9, w: 0.73, dir: "S", hinge: "W", label: "洋室S" },
      { type: "window", x: W, y: 1.3, w: 1.5, dir: "E" },
      { type: "window", x: 0, y: 1.3, w: 0.8, dir: "W" },
      { type: "window", x: 0, y: 4.9, w: 0.6, dir: "W" },
      { type: "window", x: W, y: 6.4, w: 0.6, dir: "E" },
      { type: "window", x: 1.69, y: L, w: 1.8, dir: "S", h: 1.3 },
      { type: "window", x: W, y: 8.0, w: 1.0, dir: "E" },
    ],
    items: [
      { type: "bed_d", x: 2.5, y: 1.0, rot: 0 },
      { type: "desk", x: 0.4, y: 1.9, rot: 90 },
      { type: "ladder", x: 0.95, y: 2.55, rot: 180, h: 2.55 },
      { type: "bed_s", x: 0.65, y: 3.8, rot: 0 },
      { type: "desk", x: 0.65, y: 5.4, rot: 0 },
      { type: "chair", x: 0.65, y: 6.0, rot: 0 },
      { type: "bed_s", x: 0.65, y: 7.95, rot: 0 },
      { type: "counter_desk", x: 2.92, y: 6.37, rot: 0 },
      { type: "desk", x: 2.6, y: 8.6, rot: 0 },
      { type: "chair", x: 2.6, y: 7.95, rot: 180 },
    ],
  },
  "LOFT": {
    label: "ロフト",
    walls: [seg(0, yM, W, yM, "void"), seg(W, yM, W, C.y8, "ext"), seg(W, C.y8, 0, C.y8, "ext"), seg(0, C.y8, 0, yM, "ext")],
    rooms: [
      room("吹抜(洋室Nの上)", 0, yN, W, yM, { kind: "void" }),
      room("ロフト 6.6帖", 0, yM, W, C.y8, { note: "3,185×3,375・頭上 北端≒0.75〜棟1.245〜南端0.87(屋根勾配)・オプション" }),
    ],
    openings: [],
    items: [{ type: "futon", x: 1.9, y: 4.6, rot: 90 }],
    floorRect: { x0: 0, y0: yM, x1: W, y1: C.y8 },
  },
};
for (const fid of ["2F", "3F"]) FLOORS_B[fid].floorRect = { x0: 0, y0: yN, x1: W, y1: L };

// ---- 設備カタログ(幅w=x方向・奥行d=y方向・高さh。rot=0のとき) --------------------------------
// 推奨スペース(space)は便器まわり等の目安(メーカーの標準寸法・住宅設計の一般的な数値)。判定ではなく参照値
export const ITEM_CATALOG = {
  toilet: { name: "便器(タンク式)", w: 0.40, d: 0.74, h: 0.80, cat: "水回り", color: "#4A8FB8", space: { w: 0.78, d: 1.20, note: "内法 幅780×奥行1,200 が最小級の目安。前方(便器先端〜壁)400mm以上、ゆとりは500mm" } },
  toilet_tankless: { name: "便器(タンクレス)", w: 0.38, d: 0.66, h: 0.50, cat: "水回り", color: "#4A8FB8", space: { w: 0.78, d: 1.20, note: "手洗い器を別に置く必要がある" } },
  handwash: { name: "手洗い器", w: 0.30, d: 0.20, h: 0.85, cat: "水回り", color: "#7FB3CF" },
  washstand750: { name: "洗面台 W750", w: 0.75, d: 0.55, h: 1.9, cat: "水回り", color: "#5B9BD5", space: { w: 0.75, d: 0.6, note: "前に立つ余地 600mm以上" } },
  washstand900: { name: "洗面台 W900", w: 0.90, d: 0.55, h: 1.9, cat: "水回り", color: "#5B9BD5", space: { w: 0.9, d: 0.6, note: "前に立つ余地 600mm以上" } },
  washstand600: { name: "洗面台 W600", w: 0.60, d: 0.50, h: 1.9, cat: "水回り", color: "#5B9BD5" },
  washer: { name: "洗濯機(ドラム)+パン640", w: 0.64, d: 0.72, h: 1.05, cat: "水回り", color: "#9DB7CC", space: { w: 0.64, d: 0.72, note: "扉の開きで前方に 600〜900mm" } },
  washer_pan900: { name: "洗濯機パン W900", w: 0.90, d: 0.64, h: 0.06, cat: "水回り", color: "#C5D5E0" },
  ub1316: { name: "UB 1316(0.75坪)", w: 1.38, d: 1.68, h: 2.1, cat: "水回り", color: "#6FB1C9", note: "内寸1,300×1,600" },
  ub1616: { name: "UB 1616(1坪)", w: 1.68, d: 1.68, h: 2.1, cat: "水回り", color: "#6FB1C9", note: "内寸1,600×1,600。1316からの変更検討用" },
  ub1216: { name: "UB 1216", w: 1.28, d: 1.68, h: 2.1, cat: "水回り", color: "#6FB1C9" },
  kitchen2400: { name: "I型キッチン 2400", w: 2.40, d: 0.65, h: 0.85, cat: "キッチン", color: "#C9A35B", space: { w: 2.4, d: 0.9, note: "通路 900mm(1人)・1,000〜1,200(2人)" } },
  kitchen2550: { name: "I型キッチン 2550", w: 2.55, d: 0.65, h: 0.85, cat: "キッチン", color: "#C9A35B" },
  fridge: { name: "冷蔵庫 500L級", w: 0.69, d: 0.70, h: 1.83, cat: "キッチン", color: "#B8B8B8", space: { w: 0.69, d: 0.9, note: "放熱に左右各 5〜10mm、扉の開きに前方 900mm" } },
  cupboard: { name: "食器棚/カップボード 1800", w: 1.80, d: 0.45, h: 2.0, cat: "キッチン", color: "#B59A6A" },
  cupboard1200: { name: "食器棚 1200", w: 1.20, d: 0.45, h: 2.0, cat: "キッチン", color: "#B59A6A" },
  dining: { name: "ダイニングテーブル 4人", w: 1.35, d: 0.80, h: 0.72, cat: "家具", color: "#D9B98C" },
  chair: { name: "椅子", w: 0.45, d: 0.50, h: 0.80, cat: "家具", color: "#E0CBA5" },
  sofa3: { name: "ソファ 3人掛", w: 1.90, d: 0.85, h: 0.80, cat: "家具", color: "#C7B7A6" },
  sofa2: { name: "ソファ 2人掛", w: 1.50, d: 0.85, h: 0.80, cat: "家具", color: "#C7B7A6" },
  table_low: { name: "ローテーブル", w: 0.90, d: 0.50, h: 0.40, cat: "家具", color: "#D9B98C" },
  tvboard: { name: "TVボード", w: 1.80, d: 0.40, h: 0.45, cat: "家具", color: "#8A7A6A" },
  bed_s: { name: "シングルベッド", w: 0.97, d: 1.95, h: 0.50, cat: "家具", color: "#D8C8E8" },
  bed_sd: { name: "セミダブルベッド", w: 1.20, d: 1.95, h: 0.50, cat: "家具", color: "#D8C8E8" },
  bed_d: { name: "ダブルベッド", w: 1.40, d: 1.95, h: 0.50, cat: "家具", color: "#D8C8E8" },
  bed_q: { name: "クイーンベッド", w: 1.60, d: 1.95, h: 0.50, cat: "家具", color: "#D8C8E8" },
  bed_k: { name: "キングベッド", w: 1.80, d: 1.95, h: 0.50, cat: "家具", color: "#D8C8E8" },
  bed_bunk: { name: "2段ベッド", w: 1.05, d: 2.05, h: 1.60, cat: "家具", color: "#C8B8E0" },
  futon: { name: "布団(シングル)", w: 1.00, d: 2.00, h: 0.10, cat: "家具", color: "#E6DCF0" },
  desk: { name: "机 1000×600", w: 1.00, d: 0.60, h: 0.72, cat: "家具", color: "#D9B98C" },
  desk1200: { name: "机 1200×600", w: 1.20, d: 0.60, h: 0.72, cat: "家具", color: "#D9B98C" },
  counter_desk: { name: "カウンター(造付)", w: 0.80, d: 0.50, h: 0.72, cat: "家具", color: "#D9B98C" },
  wardrobe: { name: "衣装ケース/棚 900", w: 0.90, d: 0.45, h: 1.8, cat: "家具", color: "#B59A6A" },
  car_compact: { name: "車 コンパクト(ヤリス級 3,995×1,695)", w: 1.695, d: 3.995, h: 1.50, cat: "車・外", color: "#7A8A99", space: { w: 1.695 + 1.2, d: 3.995, note: "ドアを開けて乗り降りする余地: 片側 600mm以上" } },
  car_kei: { name: "軽自動車(3,395×1,475)", w: 1.475, d: 3.395, h: 1.65, cat: "車・外", color: "#7A8A99" },
  car_wagon: { name: "車 ステーションワゴン(4,700×1,800)", w: 1.80, d: 4.70, h: 1.50, cat: "車・外", color: "#7A8A99", note: "車庫3,185+前面空き1,150=4,335 に収まらない=道路側へはみ出す" },
  car_minivan: { name: "ミニバン(4,700×1,700×1,850)", w: 1.70, d: 4.70, h: 1.85, cat: "車・外", color: "#7A8A99" },
  bicycle: { name: "自転車", w: 0.60, d: 1.80, h: 1.0, cat: "車・外", color: "#99A5B0" },
  stroller: { name: "ベビーカー", w: 0.55, d: 0.90, h: 1.0, cat: "車・外", color: "#99A5B0" },
  person: { name: "人(立位の占有 600×400)", w: 0.60, d: 0.40, h: 1.70, cat: "人", color: "#E8A070" },
  person_wheel: { name: "車椅子(回転 1,500φ)", w: 1.50, d: 1.50, h: 1.2, cat: "人", color: "#E8A070" },
  ladder: { name: "ロフトはしご", w: 0.45, d: 0.30, h: 2.3, cat: "家具", color: "#B59A6A" },
  box: { name: "任意の箱(寸法を入力)", w: 0.6, d: 0.6, h: 0.6, cat: "その他", color: "#A0A0A0" },
};

// 図面にあるが寸法が無い・図面に無いものの前提
// 規定サイズ(角のハンドルで大きさを変えるときに吸着する寸法。2026-10-14ユーザー要望「大きさをシングル・ダブルとか規定の大きさに角をいじると変更できるように」)。
// type があればその種類へ切り替える(名前も変わる)。無いものは寸法だけ変え sizeName に規定名を持つ。メーカー標準値の目安
export const SIZE_PRESETS = {
  bed: [{ name: "シングル", w: 0.97, d: 1.95, type: "bed_s" }, { name: "セミダブル", w: 1.20, d: 1.95, type: "bed_sd" }, { name: "ダブル", w: 1.40, d: 1.95, type: "bed_d" }, { name: "クイーン", w: 1.60, d: 1.95, type: "bed_q" }, { name: "キング", w: 1.80, d: 1.95, type: "bed_k" }, { name: "ロング(S)", w: 0.97, d: 2.05 }],
  sofa: [{ name: "1人掛", w: 0.90, d: 0.85 }, { name: "2人掛", w: 1.50, d: 0.85, type: "sofa2" }, { name: "2.5人掛", w: 1.70, d: 0.85 }, { name: "3人掛", w: 1.90, d: 0.85, type: "sofa3" }],
  kitchen: [{ name: "I型1800", w: 1.80, d: 0.65 }, { name: "I型2100", w: 2.10, d: 0.65 }, { name: "I型2400", w: 2.40, d: 0.65, type: "kitchen2400" }, { name: "I型2550", w: 2.55, d: 0.65, type: "kitchen2550" }, { name: "I型2700", w: 2.70, d: 0.65 }],
  washstand: [{ name: "W600", w: 0.60, d: 0.50, type: "washstand600" }, { name: "W750", w: 0.75, d: 0.55, type: "washstand750" }, { name: "W900", w: 0.90, d: 0.55, type: "washstand900" }, { name: "W1200", w: 1.20, d: 0.55 }],
  ub: [{ name: "1216", w: 1.28, d: 1.68, type: "ub1216" }, { name: "1316", w: 1.38, d: 1.68, type: "ub1316" }, { name: "1317", w: 1.38, d: 1.78 }, { name: "1616", w: 1.68, d: 1.68, type: "ub1616" }, { name: "1620", w: 1.68, d: 2.08 }, { name: "1818", w: 1.88, d: 1.88 }],
  dining: [{ name: "2人用", w: 0.80, d: 0.80 }, { name: "4人用", w: 1.35, d: 0.80, type: "dining" }, { name: "4人用(大)", w: 1.50, d: 0.85 }, { name: "6人用", w: 1.80, d: 0.90 }],
  desk: [{ name: "1000", w: 1.00, d: 0.60, type: "desk" }, { name: "1200", w: 1.20, d: 0.60, type: "desk1200" }, { name: "1400", w: 1.40, d: 0.70 }, { name: "学習机", w: 1.00, d: 0.70 }],
  fridge: [{ name: "300L級", w: 0.55, d: 0.65 }, { name: "400L級", w: 0.60, d: 0.70 }, { name: "500L級", w: 0.69, d: 0.70, type: "fridge" }, { name: "600L級", w: 0.75, d: 0.75 }],
  cupboard: [{ name: "900", w: 0.90, d: 0.45 }, { name: "1200", w: 1.20, d: 0.45, type: "cupboard1200" }, { name: "1600", w: 1.60, d: 0.45 }, { name: "1800", w: 1.80, d: 0.45, type: "cupboard" }],
  washer: [{ name: "縦型", w: 0.60, d: 0.62 }, { name: "ドラム", w: 0.64, d: 0.72, type: "washer" }, { name: "ドラム(大)", w: 0.70, d: 0.75 }],
  car: [{ name: "軽", w: 1.475, d: 3.395, type: "car_kei" }, { name: "コンパクト", w: 1.695, d: 3.995, type: "car_compact" }, { name: "ワゴン", w: 1.80, d: 4.70, type: "car_wagon" }, { name: "ミニバン", w: 1.70, d: 4.70, type: "car_minivan" }],
  toilet: [{ name: "タンク式", w: 0.40, d: 0.74, type: "toilet" }, { name: "タンクレス", w: 0.38, d: 0.66, type: "toilet_tankless" }],
};
export const presetGroupOf = (type) => /^bed_(?!bunk)/.test(type) ? "bed" : /^sofa/.test(type) ? "sofa" : /^kitchen/.test(type) ? "kitchen" : /^washstand/.test(type) ? "washstand" : /^ub/.test(type) ? "ub" : type === "dining" ? "dining" : /^desk/.test(type) ? "desk" : type === "fridge" ? "fridge" : /^cupboard/.test(type) ? "cupboard" : type === "washer" ? "washer" : /^car_/.test(type) ? "car" : /^toilet/.test(type) ? "toilet" : null;

export const ASSUMPTIONS = [
  "壁の位置は図面の寸法線(芯々)。壁厚は外壁150・内壁90mm と置いた(図面に無い)。内法=芯々から半厚を引いた値",
  "階高は図面の断面スケッチの値(1F天井2,250・2F 2,400・3F 2,250・床厚400/420/300・ロフト床→棟1,245)。棟の位置は建物中央と読んだ(スケッチの実測で中央から±0.2m以内)。屋根厚0.2m・軒の出0.25m・軒がロフト床レベルで壁芯に下りる形は仮定",
  "階段は下端の910角に回り段3段+直階段11段(2Fの両端の扇形、3Fの開口1,820、カウンターが下3段の上にある形から)。段割りが違えば階段下トイレの頭上高さは変わる",
  "設備・家具の寸法はメーカー標準値の仮置き(カタログの値)。図面に描かれた位置へ置いたが、図面は家具配置例で確定ではない",
  "敷地内の建物位置: 北面は道路境界から1,150(1F平面図)、東西の空きは北辺の余り1,017を等分(区割図に建物の位置は無い)",
  "ロフトの頭上高さは屋根勾配から計算(棟直下1.245→端で≒0.85〜0.94)。採光・換気・ロフトの固定階段/はしごは図面に無い",
  "図面の注記どおり『行政・検査機関との協議、天空率・構造計算、真北調査で計画が変わる可能性がある』。ここは検討用の模型であり確定図ではない",
];


// ---- 改案Bの法規・建築の机上計算(2026-10-14) ----------------------------------------------
// すべて図面の寸法と公的な計算式から出した「机上の値」。確認申請の設計者(建築士)の検証が要る。判定はしない=数値と余裕を並べるだけ
const FLOOR_GL = 0.461;
const hRaw = (y) => ROOF.rise * (1 - Math.abs(y - ROOF.ridgeY) / (L / 2));   // ロフト床からの屋根下端(軒先側は負=床より下)
const roofTopGL = (y) => FLOOR_GL + LEVELS.LOFT.z + hRaw(y) + ROOF.thickness;  // 屋根上端のGL高さ
const daylight = (d, h) => Math.min(3, Math.max(0, (d / h) * 6 - 1.4));        // 採光補正係数(住居系: d/h×6−1.4・上限3)
const SOUTH_GAP = Math.min(10.872, 10.938) - NS - (L + WALL_T.ext / 2);       // 南面の壁面から南側隣地境界まで(西端 0.547)
const KERABA = 0.15;                                                          // 妻側(東西)の屋根の出(仮定)
function checkOf(ext, floors) {
  const bArea = W * (L + ext);                                                // 建築面積(2F・3Fの外形。1Fの車庫は2Fの下)
  const f23 = W * (L + ext);
  const volume = 21.68 + 2.63 + f23 * 2;                                      // 容積対象(1F住宅+ポーチ+2F+3F。車庫8.13は1/5以内で不算入)
  const setback = NS - ext;                                                   // 道路境界からの後退距離
  const nFaceTop = roofTopGL(-ext), nEaveTop = roofTopGL(-ext - ROOF.overhang);
  const net = (fid, name) => { const r = floors[fid].rooms.find((q) => q.name.startsWith(name)); return r ? netArea(r, fid, -ext) : 0; };
  const win = (fid, pred) => floors[fid].openings.find((o) => o.type === "window" && pred(o));
  const wc3 = FLOOR_GL + LEVELS["3F"].z + 1.5;                                 // 3F 窓の中心(床+1.5m)
  const wc2 = FLOOR_GL + LEVELS["2F"].z + 1.5;
  // 採光: 北=道路(反対側境界までの d=後退距離+道路幅)、南=隣地(d=隣地境界までの距離−軒の出)、西=隣地(d=空き−けらば)
  const dN = setback + LOT.road_width_m, hN3 = (FLOOR_GL + LEVELS.LOFT.z + hRaw(-ext - ROOF.overhang)) - wc3, hN2 = (FLOOR_GL + LEVELS.LOFT.z + hRaw(-ext - ROOF.overhang)) - wc2;
  const dS = SOUTH_GAP - ROOF.overhang, hS3 = (FLOOR_GL + LEVELS.LOFT.z + hRaw(L + ROOF.overhang)) - wc3;
  const dW = GAPW - WALL_T.ext / 2 - KERABA, hW3 = roofTopGL(4.9) - wc3;
  const kN3 = daylight(dN, hN3), kS3 = daylight(dS, hS3), kW3 = daylight(dW, hW3), kN2 = daylight(dN, hN2);
  const wN3 = win("3F", (o) => o.dir === "N"), wS3 = win("3F", (o) => o.dir === "S"), wN2 = win("2F", (o) => o.dir === "N");
  const area = (o) => o.w * (o.h ?? 1.1);
  return {
    ext, building_area: bArea, coverage: bArea / LOT.area_m2, coverage_cap_m2: LOT.area_m2 * 0.7,
    volume, far: volume / LOT.area_m2, far_cap_m2: LOT.area_m2 * 2.0,
    setback, road_slope_allowed: 1.25 * (LOT.road_width_m + 2 * setback), north_face_top: nFaceTop, north_eave_top: nEaveTop,
    kodo2_allowed: 5 + 0.6 * (LOT.road_width_m + setback), ridge_top: roofTopGL(ROOF.ridgeY),
    daylight: {
      N3: { d: dN, h: hN3, k: kN3, win: area(wN3), eff: area(wN3) * kN3, floor: net("3F", "洋室N 6") + net("3F", "洋室N ア") },
      S3: { d: dS, h: hS3, k: kS3, win: area(wS3), eff: area(wS3) * kS3, floor: net("3F", "洋室S 4") + net("3F", "洋室S カ") },
      M3: { d: dW, h: hW3, k: kW3, skylight: 0.36, eff: 0.36 * 3, floor: net("3F", "洋室M") },
      N2: { d: dN, h: hN2, k: kN2, win: area(wN2), eff: area(wN2) * kN2, floor: net("2F", "LDK") },
    },
  };
}
export const CHECK_A = checkOf(0, FLOORS);
export const CHECK_B = checkOf(EXT_N, FLOORS_B);
export const VARIANTS = {
  A: { id: "A", label: "参考プラン A", floors: FLOORS, north_ext: 0 },
  B: { id: "B", label: "改案 B(バルコニー無し・3F三部屋・風呂2F)", floors: FLOORS_B, north_ext: EXT_N },
};
export const B_CHANGES = [
  "バルコニー(片持ち910)を撤去し、2F・3Fの北面を455北へ張り出す(建ぺい率70%の残り2.55m²に収まる最大のモジュール。+1.54m²/階)。構造は片持ち910のバルコニーが片持ち455の床に変わるだけ",
  "3Fを三部屋に: 洋室N(北・吹抜つき・東にアルコーブ)/洋室M(西列 幅1,555×4,095)/洋室S(南・カウンター部つき)+幅910の廊下。3Fのトイレ・CL2つは廃止",
  "2Fの南西に UB1316+脱衣所(各1,555×1,820=A案1Fの水回りと同じモジュール)、中列にトイレ(910×1,365)。キッチンは東壁沿いの I型2,100、LDKは約13帖(A案17.4帖)",
  "1F: A案の洗面脱衣室の位置が収納(手洗い器)、UBの位置がWIC(洋室から出入り)。2F浴室の給排水は収納の角のPSで1Fへ落とす",
  "屋根・階高・階段・柱位置はA案のまま。ロフトは洋室Nの南壁(y2,730)から階段の南端(5,915)までの 3,185×3,375(頭上0.75〜1.245)",
];
export const B_CAVEATS = [
  "**採光**: 隣地側(東西・南)の窓は空きが0.5m台なので採光補正係数がほぼ0〜0.4にしかならず、北(道路)の窓だけが満額(係数3.0)。洋室Mは西の窓では居室にならないため**天窓(0.6×0.6程度・3倍換算)**が前提。洋室Sは南窓1,800×1,300で 1/7 に届かず、**照明設備つきの1/10(令和5年改正)**か幅2,000超の窓が要る",
  "**1Fの洋室は納戸のまま**(A案と同じ)。1Fは南の空き0.55m・軒までの高さ約6.7mで採光補正係数が負になり、どの窓でも居室にならない",
  "**2F浴室**: 木造2FのUBは標準的な納まりだが、床梁の設計・防水・PS(給排水の縦管)・給湯器の置き場(東西の空き0.5m)を設計者が決める。満水時の荷重は構造計算に入れる",
  "**北への張り出し455**: 道路斜線(1.25勾配・後退距離0.695)と第2種高度地区の机上計算は北面で各0.6m・0.5m程度の余裕。軒の出0.25を含めると道路境界まで0.445mで、**天空率や後退距離の扱いは設計者の確認が要る**。張り出しをやめれば余裕はA案と同じに戻る(3F洋室Nが6.1帖に)",
  "**失うもの**: バルコニー(洗濯物の外干し・エアコン室外機の置き場・2方向避難の補助)/3Fのトイレ(トイレは1F・2Fの2か所)/LDKの広さ(17.4→約13帖)/3Fの収納(CL2つ)。洋室Mは内法幅1.4mでシングルベッド+机の細長い部屋",
  "**費用**: 天窓・2F浴室の防水と配管・張り出しの構造で建物価格2,490万(税込)は上がる方向。金額は建築会社の見積りでしか決まらない",
];

export const PLAN = {
  id: "kamiya2-adcast-a",
  title: "神谷2-24 A区画 参考プラン(2026/10/08・1/100)",
  W, L, GRID, C, LEVELS, ROOF, WALL_T, STAIR, LOT, FLOORS, VARIANTS, ITEM_CATALOG, ASSUMPTIONS, SIZE_PRESETS,
  floorHeightGL: 0.461,
  areas: { site: 47.52, f1_house: 21.68, f1_garage: 8.13, f1_porch: 2.63, f2: 30.71, f3: 30.71, total: 93.86, house_only: 83.10, loft: 8.34, void: 11.62, building_area: 30.71 },
};

// 部屋の芯々面積(m²)。テストが図面の面積表と突き合わせる
export const roomArea = (r) => (r.x1 - r.x0) * (r.y1 - r.y0);
export const polygonArea = (poly) => Math.abs(poly.reduce((s, [x, y], i) => { const [nx, ny] = poly[(i + 1) % poly.length]; return s + x * ny - nx * y; }, 0)) / 2;

const CSS_EXTRA = `
.plan-app{display:grid;grid-template-columns:minmax(300px,440px) 1fr;gap:14px}
@media(max-width:900px){.plan-app{grid-template-columns:1fr}}
.plan-app .col{min-width:0}
/* 画面の切替(2026-10-14ユーザー要望「3Dと平面図を行ったり来たり見るのが面倒。ボタンで切り替えたい」)。
   平面図だけ: 2Dを中央に最大520px / 3Dだけ: 3Dを全幅・背高に。ツールとプロパティ欄は両方の下に置き、どちらの画面でも見える */
.plan-app[data-mode="2d"]{grid-template-columns:minmax(300px,520px);justify-content:center}
.plan-app[data-mode="2d"] .col3d{display:none}
.plan-app[data-mode="3d"]{grid-template-columns:1fr}
.plan-app[data-mode="3d"] .col2d{display:none}
.plan-app[data-mode="3d"] #view3d{height:min(78vh,760px)}
#plan2d{width:100%;background:#FBFBF9;border:1px solid var(--ink);touch-action:none;display:block;cursor:crosshair;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
#view3d{width:100%;height:560px;background:#E9EEF2;border:1px solid var(--ink);display:block;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
@media(max-width:900px){#view3d{height:420px}.plan-app[data-mode="3d"] #view3d{height:min(70vh,600px)}}
.toolbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0}
.toolbar .lbl{font-size:.72rem;color:var(--ink-soft);letter-spacing:.06em}
.btn{font-family:inherit;font-size:.78rem;padding:4px 10px;border:1px solid var(--ink);background:#FDFDFC;color:var(--ink);cursor:pointer}
.btn.on{background:var(--band);border-color:var(--band);color:#fff;font-weight:700}
.btn.warn{border-color:var(--stamp);color:var(--stamp)}
.btn:disabled{opacity:.4;cursor:default}
select.sel,input.inp{font-family:inherit;font-size:.78rem;padding:3px 6px;border:1px solid var(--ink-soft);background:#FDFDFC;color:var(--ink)}
input.inp{width:64px;font-family:var(--mono)}
.props{border:1px solid var(--grid);padding:8px 10px;font-size:.8rem;background:#FDFDFC;margin-top:8px;min-height:88px}
.props .k{color:var(--ink-soft);font-size:.72rem;letter-spacing:.06em}
.props .v{font-family:var(--mono)}
.clear{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:6px;text-align:center}
.clear div{border:1px solid var(--grid);padding:4px 2px;font-size:.72rem}
.clear b{display:block;font-family:var(--mono);font-size:.9rem}
.clear .ng{background:#FBE9E7;border-color:var(--stamp)}
.clear .ok{background:#E8F3EC;border-color:var(--ok)}
.hint{font-size:.72rem;color:var(--ink-soft);margin-top:4px;line-height:1.5}
.legend{font-size:.72rem;color:var(--ink-soft);display:flex;flex-wrap:wrap;gap:10px;margin-top:6px}
.legend i{display:inline-block;width:12px;height:12px;vertical-align:-2px;margin-right:3px;border:1px solid #888}
table.dims{border-collapse:collapse;font-size:.78rem;width:100%}
table.dims th,table.dims td{border-bottom:1px dashed var(--grid);padding:4px 6px;text-align:left;vertical-align:top}
table.dims td.n{font-family:var(--mono);text-align:right;white-space:nowrap}
.note{font-size:.8rem;line-height:1.6;color:var(--ink-soft)}
.note b{color:var(--ink)}
ul.compact{padding-left:1.2em;font-size:.8rem;line-height:1.6}
.rooms-list{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.rooms-list .btn{font-size:.72rem;padding:2px 7px}
kbd{font-family:var(--mono);font-size:.7rem;border:1px solid var(--ink-soft);padding:0 4px;border-radius:3px}
@media(max-width:600px){table.dims td.n{white-space:normal}table.dims{font-size:.72rem}.props .v{word-break:break-all}}
.props .v{overflow-wrap:anywhere}
`;

// 内法面積(芯々から壁厚を引いた概算。外壁に接する辺は 75mm、内壁は 45mm)
export function netArea(r, floor, northLine = 0) {
  const ext = (v, lim) => Math.abs(v - lim) < 1e-6;
  const dx = (ext(r.x0, 0) ? WALL_T.ext / 2 : WALL_T.int / 2) + (ext(r.x1, W) ? WALL_T.ext / 2 : WALL_T.int / 2);
  const dy = (ext(r.y0, northLine) && floor !== "1F" ? WALL_T.ext / 2 : WALL_T.int / 2) + (ext(r.y1, L) ? WALL_T.ext / 2 : WALL_T.int / 2);
  return Math.max(0, (r.x1 - r.x0 - dx) * (r.y1 - r.y0 - dy));
}

export function renderPlan3d({ asOf, property } = {}) {
  const client = readFileSync(join(HERE, "..", "client", "plan3d.js"), "utf8");
  const floorsTableOf = (floors, northLine = 0) => Object.entries(floors).map(([fid, f]) => `
    <tr><th colspan="4" style="padding-top:10px">${esc(f.label)}</th></tr>
    ${f.rooms.filter((r) => r.kind !== "outside" && r.kind !== "void").map((r) => `<tr><td>${esc(r.name)}</td>
      <td class="n">${((r.x1 - r.x0) * 1000).toFixed(0)}×${((r.y1 - r.y0) * 1000).toFixed(0)}</td>
      <td class="n">${roomArea(r).toFixed(2)}m² / 内法≈${netArea(r, fid, fid === "1F" ? 0 : northLine).toFixed(2)}m²(${(netArea(r, fid, fid === "1F" ? 0 : northLine) / 1.62).toFixed(1)}帖)</td>
      <td>${esc(r.note ?? "")}</td></tr>`).join("")}`).join("");
  const floorsTable = floorsTableOf(FLOORS, 0);

  const body = `
<section class="panel">
  <h2>間取りシミュレーター ── ${esc(PLAN.title)}</h2>
  <div class="hint" style="margin-bottom:8px">図面(2026/10/08・1/100)の寸法から再構成。判定はしない。変更はこのブラウザにだけ保存。<a href="#plan3d-help">使い方・前提</a> / <a href="property/${esc(PLAN.id)}.html">物件ページ</a></div>
  <div class="toolbar" id="variantTabs"><span class="lbl">案</span>
    ${Object.values(VARIANTS).map((v, i) => `<button class="btn${i === 0 ? " on" : ""}" data-variant="${v.id}">${esc(v.label)}</button>`).join("")}
    <span class="hint"><a href="#plan3d-b">改案Bの前提と法規の机上計算</a>。案ごとに配置は別々に保存</span>
  </div>
  <div class="toolbar" id="floorTabs"><span class="lbl">階</span>
    ${Object.entries(FLOORS).map(([fid, f], i) => `<button class="btn${i === 0 ? " on" : ""}" data-floor="${fid}">${esc(f.label)}</button>`).join("")}
    <span class="lbl" style="margin-left:10px">画面</span>
    <button class="btn" data-mode="2d">平面図</button><button class="btn on" data-mode="3d">3D</button><button class="btn" data-mode="both">並べる</button>
    <span class="lbl" style="margin-left:10px">3D表示</span>
    <button class="btn" data-view="floor">この階だけ</button><button class="btn on" data-view="all">全階(重ねる)</button><button class="btn" data-view="explode">全階(ばらす)</button>
    <span class="lbl" style="margin-left:10px">壁の高さ</span>
    <button class="btn on" data-wallh="0.3">30cm</button><button class="btn" data-wallh="1.2">1.2m</button><button class="btn" data-wallh="full">天井まで</button>
  </div>
  <div class="plan-app" id="planApp" data-mode="3d">
    <div class="col col2d">
      <canvas id="plan2d" width="440" height="1000" aria-label="平面図(編集可)"></canvas>
      <div class="toolbar"><span class="lbl">平面図の拡大</span><button class="btn" id="btnZoomIn">＋</button><button class="btn" id="btnZoomOut">－</button><button class="btn" id="btnZoomFit">全体</button><span class="hint">2本指でピンチ/移動・ホイールでも拡大</span></div>
    </div>
    <div class="col col3d">
      <canvas id="view3d" aria-label="3D模型"></canvas>
      <div class="toolbar"><span class="lbl">視点</span>
        <button class="btn" data-cam="bird">鳥瞰</button><button class="btn" data-cam="top">真上</button><button class="btn" data-cam="north">道路側から</button><button class="btn" data-cam="eye">選択した部屋の中(目線1.5m)</button>
        <span class="lbl" style="margin-left:10px">表示</span>
        <label class="hint"><input type="checkbox" id="chkDims" checked> 寸法</label>
        <label class="hint"><input type="checkbox" id="chkLot" checked> 敷地・道路・B区画</label>
        <label class="hint"><input type="checkbox" id="chkLabels" checked> 部屋名・内法</label>
        <label class="hint"><input type="checkbox" id="chkSpace" checked> 推奨スペース</label>
        <label class="hint"><input type="checkbox" id="chkRoof" checked> 屋根</label>
      </div>
      <div class="hint" id="info3d"></div>
    </div>
  </div>
  <div class="toolbar"><span class="lbl">ツール</span>
    <button class="btn on" data-tool="select">選択/移動</button>
    <button class="btn" data-tool="measure">寸法を測る</button>
    <button class="btn" data-tool="area">部屋の広さ</button>
    <button class="btn" data-tool="wall">壁を引く</button>
    <button class="btn" id="btnUndo" title="Ctrl+Z">元に戻す</button>
    <span class="lbl" style="margin-left:10px">追加</span>
    <select class="sel" id="addSel">${Object.entries(ITEM_CATALOG).map(([k, v]) => `<option value="${k}">${esc(v.cat)}: ${esc(v.name)}</option>`).join("")}</select>
    <button class="btn" id="btnAdd">この階に置く</button>
    <button class="btn" id="btnDoor">ドア(開き)を置く</button>
  </div>
  <div class="props" id="props"><span class="k">設備をタップすると寸法と隙間が出ます。</span><div class="hint">長押しして引っ張ると移動(3Dでも)。四隅の◯を引っ張ると大きさが規定サイズに吸着。<kbd>R</kbd> 回転 / <kbd>Del</kbd> 削除</div></div>
  <div class="legend">
    <span><i style="background:#4A8FB8"></i>水回り</span><span><i style="background:#C9A35B"></i>キッチン</span><span><i style="background:#D9B98C"></i>家具</span>
    <span><i style="background:#7A8A99"></i>車・外</span><span><i style="background:#E8A070"></i>人</span><span><i style="background:rgba(201,58,43,.18);border-color:#C93A2B"></i>推奨スペース(目安)</span>
  </div>
  <div class="toolbar" style="margin-top:10px"><span class="lbl">保存</span>
    <button class="btn" id="btnExport">書き出し(JSON)</button>
    <label class="btn" style="cursor:pointer">読み込み<input type="file" id="fileImport" accept="application/json" style="display:none"></label>
    <button class="btn warn" id="btnReset">図面の初期配置に戻す</button>
    <span class="hint" id="saveState"></span>
  </div>
</section>

<section class="panel">
  <h2 class="sub">階の高さ(図面の断面スケッチから。屋根厚・軒の出は仮定)</h2>
  <table class="dims"><tr><th>階</th><th>床の高さ(GLから)</th><th>階高(床→上の床)</th><th>天井高</th><th>備考</th></tr>
    ${Object.entries(LEVELS).map(([fid, lv]) => `<tr><td>${esc(FLOORS[fid].label)}</td><td class="n">GL+${(PLAN.floorHeightGL + lv.z).toFixed(2)}m</td><td class="n">${lv.story.toFixed(2)}m</td><td class="n">${fid === "LOFT" ? `${roofHeightAt(C.y11).toFixed(2)}〜${lv.ceil.toFixed(3)}` : lv.ceil.toFixed(2)}m</td>
      <td>${fid === "1F" ? "1F床 GL+461mm はユーザー提供(基礎天端なら床は+10〜15cm上)" : fid === "3F" ? `ロフト下の天井。北洋室は上部吹抜で屋根(勾配天井)まで ${(lv.ceil + 0.3 + roofHeightAt(C.y11 / 2)).toFixed(1)}m前後` : fid === "LOFT" ? `屋根勾配の下(棟直下 ${lv.ceil.toFixed(3)}・ロフト北端 ${roofHeightAt(C.y11).toFixed(2)}・南端 ${roofHeightAt(C.y8).toFixed(2)}m)。棟下端 GL+${(PLAN.floorHeightGL + lv.z + lv.ceil).toFixed(2)}m・屋根上端 GL+${(PLAN.floorHeightGL + lv.z + lv.ceil + ROOF.thickness).toFixed(2)}m(仮定の屋根厚${ROOF.thickness}) ≤ 10m(日影規制の線)` : ""}</td></tr>`).join("")}
  </table>
  <div class="hint" style="margin-bottom:14px">3Dでは「全階(重ねる)」「全階(ばらす)」にすると東側に階ごとの高さの寸法線が出る。屋根(切妻・半透明)は全階表示と3F/ロフトの単階表示に描き、ロフトの北端・棟直下・南端に頭上高さの縦線を出す。平面図のロフトは頭上高さを帯で塗る(赤 1.0m未満 / 黄 1.2m未満 / 緑 1.2m以上)。</div>
  <h2 class="sub">図面の寸法と内法の目安</h2>
  <table class="dims"><tr><th>部屋</th><th>芯々 (mm)</th><th>面積</th><th>備考</th></tr>${floorsTable}</table>
  <div class="note" style="margin-top:8px">面積表(図面): 1F 住宅部分 ${PLAN.areas.f1_house} + 車庫 ${PLAN.areas.f1_garage} + ポーチ ${PLAN.areas.f1_porch} / 2F ${PLAN.areas.f2} / 3F ${PLAN.areas.f3} = 延床 ${PLAN.areas.total}m²(住宅部分 ${PLAN.areas.house_only})。
    吹抜 ${PLAN.areas.void}m²・ロフト 5.1帖(${PLAN.areas.loft}m²・面積外)。建築面積 ${PLAN.areas.building_area}m²(60%→64.64%は緩和の70%内)。
    1帖=1.62m²で換算。内法は壁厚の仮定(外壁150・内壁90)による概算で、仕上げで数cm違う。</div>
</section>


<section class="panel" id="plan3d-b">
  <h2 class="sub">改案B: バルコニー無し・3階三部屋・風呂2階(2026-10-14)</h2>
  <div class="note">A案の構造(柱位置・階段・外壁の芯・屋根・階高)を変えずに、ユーザーの3条件で組み直した案。<b>法律的・建築的に「机上では成り立つ」ことを数値で示すのが目的</b>で、確認申請の設計者(建築士)の検証に代わるものではない。判定はしない。</div>
  <h3 class="sub" style="margin-top:10px">変えたこと</h3>
  <ul class="compact">${B_CHANGES.map((a) => `<li>${escRich(a)}</li>`).join("")}</ul>
  <h3 class="sub">面積と法規の机上計算(A案との対照)</h3>
  <table class="dims">
    <tr><th>項目</th><th>A案(参考プラン)</th><th>改案B</th><th>上限・条件</th><th>読み方</th></tr>
    <tr><td>建築面積</td><td class="n">${CHECK_A.building_area.toFixed(2)}m²(${(CHECK_A.coverage * 100).toFixed(1)}%)</td><td class="n">${CHECK_B.building_area.toFixed(2)}m²(${(CHECK_B.coverage * 100).toFixed(1)}%)</td><td class="n">${CHECK_B.coverage_cap_m2.toFixed(2)}m²(70%)</td><td>建ぺい率60%+準防火地域の準耐火建築物の緩和10%。A案も64.6%でこの緩和を前提にしている。Bの残り ${(CHECK_B.coverage_cap_m2 - CHECK_B.building_area).toFixed(2)}m²</td></tr>
    <tr><td>容積対象床面積</td><td class="n">${CHECK_A.volume.toFixed(2)}m²(${(CHECK_A.far * 100).toFixed(1)}%)</td><td class="n">${CHECK_B.volume.toFixed(2)}m²(${(CHECK_B.far * 100).toFixed(1)}%)</td><td class="n">${CHECK_B.far_cap_m2.toFixed(2)}m²(200%)</td><td>前面6m道路×0.4=240%&gt;200%なので指定200%。車庫8.13m²は延床の1/5以内で不算入</td></tr>
    <tr><td>道路斜線(1.25勾配)</td><td class="n">北面 屋根上端 GL+${CHECK_A.north_face_top.toFixed(2)} / 許容 ${CHECK_A.road_slope_allowed.toFixed(2)}</td><td class="n">GL+${CHECK_B.north_face_top.toFixed(2)} / 許容 ${CHECK_B.road_slope_allowed.toFixed(2)}</td><td class="n">1.25×(6+後退${CHECK_B.setback.toFixed(3)}×2)</td><td>後退距離は壁面で測った値。A案はバルコニー先端(後退0.24)で測ると許容8.1で足りず天空率の前提と読める。Bはバルコニーが無いぶん後退距離の扱いが素直になる。軒先は道路境界まで ${(CHECK_B.setback - ROOF.overhang).toFixed(3)}m</td></tr>
    <tr><td>第2種高度地区(北側)</td><td class="n">GL+${CHECK_A.north_face_top.toFixed(2)} / 許容 ${CHECK_A.kodo2_allowed.toFixed(2)}</td><td class="n">GL+${CHECK_B.north_face_top.toFixed(2)} / 許容 ${CHECK_B.kodo2_allowed.toFixed(2)}</td><td class="n">5m+0.6×(道路6m+後退)</td><td>北が道路なので反対側境界から測る。棟(GL+${CHECK_B.ridge_top.toFixed(2)})は中央にあり余裕が大きい</td></tr>
    <tr><td>絶対高さ・日影</td><td class="n">GL+${CHECK_A.ridge_top.toFixed(2)}</td><td class="n">GL+${CHECK_B.ridge_top.toFixed(2)}</td><td class="n">10m</td><td>棟の高さは変えない。1種住居の日影規制は10m超が対象=対象外のまま</td></tr>
    <tr><td>採光 3F 洋室N</td><td class="n">—</td><td class="n">窓${CHECK_B.daylight.N3.win.toFixed(2)}m²×係数${CHECK_B.daylight.N3.k.toFixed(2)}=${CHECK_B.daylight.N3.eff.toFixed(2)}</td><td class="n">1/7=${(CHECK_B.daylight.N3.floor / 7).toFixed(2)}m²</td><td>北=道路。d=${CHECK_B.daylight.N3.d.toFixed(2)} h=${CHECK_B.daylight.N3.h.toFixed(2)} で係数は上限3.0。非常用進入口の代替開口(幅75×高120以上・道路面)もこの窓</td></tr>
    <tr><td>採光 3F 洋室S</td><td class="n">—</td><td class="n">窓${CHECK_B.daylight.S3.win.toFixed(2)}m²×係数${CHECK_B.daylight.S3.k.toFixed(2)}=${CHECK_B.daylight.S3.eff.toFixed(2)}</td><td class="n">1/7=${(CHECK_B.daylight.S3.floor / 7).toFixed(2)} / 1/10=${(CHECK_B.daylight.S3.floor / 10).toFixed(2)}m²</td><td>南の空き${SOUTH_GAP.toFixed(2)}m−軒0.25 → d=${CHECK_B.daylight.S3.d.toFixed(2)} h=${CHECK_B.daylight.S3.h.toFixed(2)}。<b>1/7には届かず、照明設備つきの1/10(令和5年改正)で可</b>。1/7にするなら幅2,000超の窓</td></tr>
    <tr><td>採光 3F 洋室M</td><td class="n">—</td><td class="n">西窓は係数${CHECK_B.daylight.M3.k.toFixed(2)} → 天窓${CHECK_B.daylight.M3.skylight}m²×3=${CHECK_B.daylight.M3.eff.toFixed(2)}</td><td class="n">1/7=${(CHECK_B.daylight.M3.floor / 7).toFixed(2)}m²</td><td>西の空き0.51m・けらばまで d=${CHECK_B.daylight.M3.d.toFixed(2)} h=${CHECK_B.daylight.M3.h.toFixed(2)} で係数0=西窓は数えられない。<b>天窓(0.6×0.6)が居室の条件</b>。位置はロフトの外(y5,915〜6,825)の屋根南面</td></tr>
    <tr><td>採光 2F LDK</td><td class="n">—</td><td class="n">北窓${CHECK_B.daylight.N2.win.toFixed(2)}m²×3.0=${CHECK_B.daylight.N2.eff.toFixed(2)}</td><td class="n">1/7=${(CHECK_B.daylight.N2.floor / 7).toFixed(2)}m²</td><td>LDKの床は壁芯の全面(水回りを引く前)で保守側</td></tr>
    <tr><td>1F 洋室</td><td class="n">納戸</td><td class="n">納戸</td><td class="n">—</td><td>南の空き${SOUTH_GAP.toFixed(2)}m・軒まで約6.7mで係数が負。A案が「洋室(納戸)」と書くのと同じ理由で居室にならない</td></tr>
    <tr><td>ロフト</td><td class="n">8.34m²・頭上≤1.245</td><td class="n">${(W * (C.y8 - yM)).toFixed(2)}m²・頭上≤1.245</td><td class="n">天井1.4m以下・下階の1/2以下</td><td>小屋裏物置の扱い(階・床面積に入らない)はA案と同じ</td></tr>
    <tr><td>階段・天井高</td><td class="n">蹴上${(LEVELS["1F"].story / 14 * 1000).toFixed(0)}/${(LEVELS["2F"].story / 14 * 1000).toFixed(0)}mm・天井2.25/2.40/2.25</td><td class="n">同じ</td><td class="n">蹴上≤230・踏面≥150・居室2.1m以上</td><td>変えていない</td></tr>
    <tr><td>準防火地域の開口部</td><td class="n">北面は延焼ラインの内</td><td class="n">同じ(北面 道路中心から${(CHECK_B.setback + 3).toFixed(2)}m)</td><td class="n">2F以上は道路中心から5m</td><td>北・東・西・南の窓は防火設備(網入り等)。A案と同じ条件</td></tr>
  </table>
  <div class="note" style="margin-top:6px">採光の計算: 令20条の住居系(d/h×6−1.4、上限3.0。天窓は3倍)。窓の中心は床+1.5m、軒の出0.25・けらば0.15・東西の空き0.51・南の空き${SOUTH_GAP.toFixed(2)}は図面と仮定の値。高度地区は東京都の第2種(5m立上り+0.6勾配)で計算。天空率は使っていない。</div>
  <h3 class="sub">建築的な注意・失うもの</h3>
  <ul class="compact">${B_CAVEATS.map((a) => `<li>${escRich(a)}</li>`).join("")}</ul>
  <h3 class="sub">改案Bの部屋と内法</h3>
  <table class="dims"><tr><th>部屋</th><th>芯々 (mm)</th><th>面積</th><th>備考</th></tr>${floorsTableOf(FLOORS_B, -EXT_N)}</table>
  <div class="note" style="margin-top:8px">改案Bの床面積: 1F 住宅部分 21.68 + 車庫 8.13 + ポーチ 2.63 / 2F ${CHECK_B.building_area.toFixed(2)} / 3F ${CHECK_B.building_area.toFixed(2)} = 延床 ${(21.68 + 8.13 + 2.63 + CHECK_B.building_area * 2).toFixed(2)}m²(住宅部分 ${(21.68 + CHECK_B.building_area * 2).toFixed(2)})。A案 93.86(住宅部分 83.10)から +${(CHECK_B.building_area * 2 - 30.71 * 2).toFixed(2)}m²。</div>
</section>

<section class="panel" id="plan3d-help">
  <h2 class="sub">使い方</h2>
  <div class="note">
    図面3枚(販売図面・区割図・各階平面図)の<b>寸法線の値だけ</b>から再構成した3D模型。平面図で設備・家具を<b>ドラッグ移動・回転・追加・削除</b>し、壁も<b>選んでドラッグ</b>で動かせます(45.5mm刻み)。
    3Dは同じデータをその場で描き直し(マウスで回転・ホイールで拡大)、<b>寸法チェーン・各部屋の内法・選択した設備の隙間</b>を寸法線で描きます。設備は3D上でもクリックで選べます。「画面」ボタンで平面図/3D/並べるを切り替えられます。
    「寸法を測る」は押したまま引っ張って離す(2点タップでも可)。平面図は2本指ピンチ/ホイールで拡大縮小。
    3Dで設備を長押し(0.4秒)すると移動、選択中の設備の四隅の赤い点を引っ張ると大きさが変わる。<b>規定サイズのある設備(ベッド・ソファ・キッチン・ユニットバス等)は常に最寄りの規定サイズ(シングル/セミダブル/ダブル…)に吸着</b>し、規定の無い設備だけ1cm刻みで自由に変わる。
    <b>判定はしません</b>。寸法・内法面積・設備まわりの隙間(クリアランス)・階段下の頭上高さを測って見せるだけです。設備の寸法はメーカー標準値の仮置き(下の前提)。
    変更はこのブラウザにだけ保存されます(公開リポジトリには書きません)。
  </div>
</section>
<section class="panel">
  <h2 class="sub">読み取りの前提(図面に無いもの)</h2>
  <ul class="compact">${ASSUMPTIONS.map((a) => `<li>${escRich(a)}</li>`).join("")}</ul>
  <div class="note" style="margin-top:8px">出典: (株)アドキャスト赤羽支店の販売図面・区割図・参考プラン図(Each floor ground plan A・2026/10/8・1/100)。
    図面の画像そのものと販売会社の連絡先は載せない(運用ルール3)。図面の事実(寸法・面積・間取り)のみ。</div>
</section>
<script>window.PLAN = ${JSON.stringify(PLAN)};</script>
<script type="importmap">{"imports":{"three":"./vendor/three.module.min.js"}}</script>
<script type="module">
${client}
</script>`;

  return layout({
    title: "間取りシミュレーター ── 神谷2-24 A区画(3D)",
    subtitle: "参考プランの寸法から再構成・判定はしない",
    docNo: `PLAN-3D / 図面 2026-10-08 / 基準日 ${esc(asOf ?? "")}<br>${esc(property?.unit_label ?? "")}`,
    body,
  }).replace("</style>", CSS_EXTRA + "</style>");
}
