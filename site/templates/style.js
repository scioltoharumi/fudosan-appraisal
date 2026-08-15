// site/templates/style.js — 共通CSS(simulator v1.2のデザイントークンを移植)
export const CSS = `
:root{
  --ink:#16232E; --ink-soft:#43566B; --paper:#EFF2F5; --panel:#FFFFFF;
  --grid:#DCE3EA; --stamp:#C93A2B; --band:#2E6E8E; --band-soft:#BFD7E4;
  --income:#6B4E9B; --ok:#2C6E49; --warn:#B07C10;
  --mono:"SF Mono","Consolas","Menlo",monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:"Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo",sans-serif;
  background:var(--paper);
  background-image:linear-gradient(var(--grid) 1px, transparent 1px),linear-gradient(90deg, var(--grid) 1px, transparent 1px);
  background-size:28px 28px;
  color:var(--ink); line-height:1.7; padding:24px 16px 64px;
}
.sheet{max-width:1140px;margin:0 auto}
a{color:var(--band)}
header.site{
  border-top:3px solid var(--ink); border-bottom:1px solid var(--ink);
  padding:18px 4px 14px; margin-bottom:24px; background:rgba(255,255,255,.6);
  display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:8px;
}
h1{font-family:"Hiragino Mincho ProN","Yu Mincho",serif;font-size:1.35rem;letter-spacing:.1em;font-weight:600}
.doc-no{font-family:var(--mono);font-size:.72rem;color:var(--ink-soft);text-align:right;line-height:1.5}
.panel{background:var(--panel);border:1px solid var(--ink);box-shadow:4px 4px 0 rgba(22,35,46,.12);padding:20px;margin-bottom:20px}
.panel h2{
  font-family:"Hiragino Mincho ProN","Yu Mincho",serif;font-size:1rem;letter-spacing:.2em;
  border-bottom:1px solid var(--ink);padding-bottom:8px;margin-bottom:16px;font-weight:600;
}
.panel h2.sub{font-size:.85rem;letter-spacing:.1em}
section+section{margin-top:20px}

/* 一覧テーブル */
table.list{width:100%;border-collapse:collapse;font-size:.85rem}
table.list th{border-bottom:1px solid var(--ink);padding:8px 6px;text-align:left;font-size:.75rem;letter-spacing:.08em;color:var(--ink-soft);white-space:nowrap}
table.list td{border-bottom:1px dashed var(--grid);padding:9px 6px;vertical-align:middle}
table.list td.num{font-family:var(--mono);text-align:right;white-space:nowrap}
/* 数値セルの注記まで nowrap にすると「2026-08-10時点・改定1回/初値…▼400万円」が1行に固定され、
   売出価格の列だけで194pxを占めて右端のメモ欄が見切れる(2026-08-15計測)。注記は折り返す */
table.list td.num .note{white-space:normal}
/* 長い見出しは2行に折り返してよい(nowrapのままだと見出しが列幅の下限になる) */
table.list th.wrapth{white-space:normal;line-height:1.35}
.status{font-size:.72rem;border:1px solid var(--ink-soft);padding:1px 7px;color:var(--ink-soft);white-space:nowrap}
.status.viewed{background:#2E6E8E;border-color:#2E6E8E;color:#fff;font-weight:700}

/* 一覧: 人が設定するステータスとメモ(この端末のブラウザに保存) */
.stsel{font-family:inherit;font-size:.75rem;padding:3px 6px;border:1px solid var(--ink-soft);background:#FDFDFC;color:var(--ink);cursor:pointer}
.stsel:focus{outline:2px solid var(--band);outline-offset:1px}
/* 内見(事実)は検討状況(判断)と別列。段階が進むほど濃くして一目で分かるようにする */
.vwsel{font-family:inherit;font-size:.75rem;padding:3px 6px;border:1px solid var(--ink-soft);background:#FDFDFC;color:var(--ink);cursor:pointer}
.vwsel:focus{outline:2px solid var(--band);outline-offset:1px}
tr.prow[data-viewing="内見希望"] .vwsel{border-color:#2E6E8E;color:#2E6E8E;font-weight:700}
tr.prow[data-viewing="内見済"] .vwsel{background:#2E6E8E;border-color:#2E6E8E;color:#fff;font-weight:700}
/* メモは開閉せず常に右端の列に出す(2026-08-15)。行の高さを揃えるため小さめの固定高 */
th.memocol{min-width:190px}
td.memocell{vertical-align:top}
.memota{width:100%;box-sizing:border-box;min-width:170px;height:56px;font-family:inherit;font-size:.72rem;line-height:1.45;
  padding:4px 6px;border:1px solid var(--ink-soft);background:#FDFDFC;color:var(--ink);resize:vertical}
.memota:focus{outline:2px solid var(--band);outline-offset:1px}
/* 狭い画面ではメモ列を詰める。横スクロールに逃がすとメモが見切れて用をなさない */
@media (max-width:1100px){
  th.memocol{min-width:150px}
  .memota{min-width:140px}
}
tr.prow[data-status="見送り"]{opacity:.5}
tr.prow[data-status="見送り"]:hover{opacity:1}
tr.prow[data-status="新規"] .stsel{border-color:var(--band);color:var(--band);font-weight:700}
.unsync{display:none;margin-left:5px;font-size:.65rem;color:var(--stamp);border:1px solid var(--stamp);padding:0 4px;white-space:nowrap}
tr.prow.dirty .unsync{display:inline}
.syncbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 8px}
.syncbtn{font-family:inherit;font-size:.72rem;padding:3px 10px;border:1px solid var(--ink-soft);background:#FDFDFC;color:var(--ink-soft);cursor:pointer;text-decoration:none}
.syncbtn:hover{border-color:var(--ink);color:var(--ink)}
.syncpanel{border:1px solid var(--band);background:#F4F8FA;padding:9px 11px;margin:0 0 10px;font-size:.75rem}
.syncpanel textarea{width:100%;box-sizing:border-box;min-height:90px;font-family:var(--mono);font-size:.7rem;margin-top:6px}
.unit-tag{display:inline-block;margin-left:6px;font-size:.68rem;padding:1px 6px;border:1px solid var(--band);color:var(--band);background:#F4F8FA;white-space:nowrap;vertical-align:middle}
table.list th.sortable{cursor:pointer;user-select:none}
table.list th.sortable:hover{color:var(--ink)}
table.list th.sortable .arw{opacity:.45;font-size:.65rem}
.filterbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 10px}
.filterbar .flabel{font-size:.7rem;color:var(--ink-soft);letter-spacing:.06em;margin-right:2px}
.chip{font-size:.72rem;padding:2px 10px;border:1px solid var(--ink-soft);background:#FDFDFC;color:var(--ink-soft);cursor:pointer;border-radius:12px;font-family:inherit}
.chip.on{background:var(--ink);border-color:var(--ink);color:#fff;font-weight:700}
.cond-banner{border:1px solid var(--band);background:#F4F8FA;padding:8px 12px;font-size:.76rem;margin:0 0 10px;line-height:1.7}
.cond-banner b{color:#2E6E8E}
.src-link{display:inline-block;margin-top:10px;padding:5px 12px;border:1px solid var(--band);color:var(--band);font-size:.78rem;text-decoration:none;font-weight:700;background:#FDFDFC}
.src-link:hover{background:var(--band);color:#fff}
.note{font-size:.7rem;color:var(--ink-soft);margin-top:6px}

/* 詳細: 価格の位置(2026-08-13に判定スタンプを廃止。ラベルを出さず事実のみ並べる) */
.position-wrap{border-left:3px solid var(--band);padding:10px 0 10px 14px;margin-bottom:20px}
.position-head{font-weight:700;font-size:1.02rem;margin-bottom:5px;font-family:var(--mono)}
.position-body{font-size:.82rem;color:var(--ink-soft);line-height:1.9}

/* スケール・明細 */
.scale-wrap{margin:8px 0 4px}
.scale-svg,.hist-svg{width:100%;height:auto;display:block}
.kv{width:100%;border-collapse:collapse;font-size:.83rem;margin-top:14px}
.kv td{padding:7px 4px;border-bottom:1px dashed var(--grid)}
.kv td:last-child{text-align:right;font-family:var(--mono);font-weight:600}
.kv tr.em td{font-weight:700;border-bottom:1px solid var(--ink)}
.kv tr.loss td{color:var(--stamp)}
.pct-line{font-size:.82rem;margin-top:8px}
.pct-line b{font-family:var(--mono)}
.caveat{font-size:.7rem;color:var(--warn);margin-top:4px}

/* トルネード */
.tornado .bar-row{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:.75rem}
.tornado .bar-label{width:130px;color:var(--ink-soft);text-align:right;flex-shrink:0}
.tornado .bar-area{flex:1;height:16px;position:relative;background:#F4F6F8;border:1px solid var(--grid)}
.tornado .bar-fill{position:absolute;top:0;bottom:0;background:var(--band-soft)}
.tornado .bar-mid{position:absolute;top:-2px;bottom:-2px;width:1px;background:var(--ink)}
.tornado .bar-val{width:120px;font-family:var(--mono);font-size:.7rem;flex-shrink:0}

/* 予算 */
.budget{margin-top:14px;padding:12px;border:1px solid var(--ink)}
.budget-bar{height:20px;background:#F4F6F8;border:1px solid var(--grid);position:relative;margin:8px 0 4px}
.budget-fill{position:absolute;top:0;bottom:0;left:0;background:var(--band-soft)}
.budget-fill.over{background:#EFC7C0}
.budget-cap{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--stamp)}
.budget-line{display:flex;justify-content:space-between;font-size:.72rem;color:var(--ink-soft)}

/* チェックリスト・根拠 */
.human-check{margin-top:14px;padding:12px;border:1px dashed var(--ink-soft);font-size:.75rem;color:var(--ink-soft)}
.human-check b{color:var(--ink)}
.human-check .done{color:var(--ok);font-weight:700}
.logic-body{font-size:.8rem}
.logic-step{border-left:3px solid var(--band);padding:8px 12px;margin-bottom:12px;background:#F8FAFB}
.logic-step .t{font-weight:700;margin-bottom:2px}
.logic-step .t .no{font-family:var(--mono);font-size:.7rem;color:#fff;background:var(--band);padding:1px 6px;margin-right:6px}
.logic-step .formula{font-family:var(--mono);font-size:.74rem;background:#fff;border:1px solid var(--grid);padding:4px 8px;margin:6px 0;overflow-x:auto;white-space:nowrap}
.logic-step .why{color:var(--ink-soft);font-size:.75rem}
.logic-step b{font-family:var(--mono)}

/* 仮定・出典 */
.assumptions{font-size:.78rem}
.assumptions li{margin-left:1.2em;margin-bottom:3px}
.assumptions .why{color:var(--ink-soft)}
.provenance{font-size:.72rem;color:var(--ink-soft);border-top:1px dashed var(--grid);margin-top:10px;padding-top:8px}

.disclaimer{font-size:.68rem;color:var(--ink-soft);margin-top:20px;border-top:1px solid var(--grid);padding-top:10px}
.meta-line{font-family:var(--mono);font-size:.68rem;color:var(--ink-soft);margin-top:10px}
`;
