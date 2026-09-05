#!/usr/bin/env node
/**
 * scripts/judge.js — Smart予想ツールの判定を CLI から呼ぶ（構成案 §2.1）
 *
 * index.html を jsdom で読み込み、そこに定義された判定関数
 *   scoreHorse / calcArereScore / judgeConfidence / judgeKachiba / judgeQuadrant / buildBets / calcG_PiReference
 * を「そのまま」呼ぶ。判定ロジックの複製・再実装はしない（CLAUDE.md 禁止事項の担保）。
 * ブラウザでツールに同じJSONを貼ったときと同一の結果になることを scripts/test-judge.js で固定する。
 *
 * 使い方:
 *   node scripts/judge.js <input.json> [--md] [--ledger data/ledger.json] [--date YYYY-MM-DD] [--out result.json]
 *     input.json : ツールの取込JSONと同じ { race:{...}, horses:[...] }（既存16キー＋任意 odds_fuku）
 *     --md       : 週次メモ用 Markdown を標準出力に出す（既定は JSON）
 *     --ledger   : 収支台帳。指定時は月内消化額から予算ガードを計算して同梱
 *     --date     : 対象日（既定: 今日 JST）。台帳の月・週の判定に使う
 *     --out      : JSON を指定ファイルにも書く
 *
 * 出力 decision の規則（運用フロー定義書 §2 ステップ5）:
 *   総合判定に 🛑 / 🚫 / ⚠️ を含む → "見送り"（買い目は参考として残すが purchase_allowed=false）
 *   それ以外 → "購入可"。ただし予算ガード NG のときは "予算超過のため見送り"
 */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const inputPath = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--ledger" && args[args.indexOf(a) - 1] !== "--date" && args[args.indexOf(a) - 1] !== "--out");
if (!inputPath) {
  console.error("usage: node scripts/judge.js <input.json> [--md] [--ledger data/ledger.json] [--date YYYY-MM-DD] [--out result.json]");
  process.exit(2);
}
const wantMd = args.includes("--md");
const ledgerPath = opt("--ledger");
const outPath = opt("--out");
const dateStr = opt("--date") || new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

// ---------------------------------------------------------------
// 入力の正規化（index.html の importData と同じ既定値。判定ロジックではなく入力整形）
// ---------------------------------------------------------------
function normalizeInput(p) {
  if (!p || !p.race || !Array.isArray(p.horses)) throw new Error("形式が正しくありません（race / horses が必要）");
  const race = {
    name: p.race.name || "",
    course: p.race.course || "",
    distance: p.race.distance || "",
    track: p.race.track || "芝",
    babaCondition: p.race.babaCondition || "良",
    isAreru: !!p.race.isAreru,
    bias: p.race.bias || "",
    isHandicap: !!p.race.isHandicap,
    raceClass: p.race.raceClass || "OP",
    courseType: p.race.courseType || "big_turf",
  };
  const horses = p.horses.map((h) => ({
    uno: String(h.uno || ""),
    name: h.name || "",
    est_pop: String(h.est_pop || ""),
    rank: h.rank || "C",
    odds: String(h.odds || ""),
    pop_tan: String(h.pop_tan || ""),
    rider_change: !!h.rider_change,
    cond_change: !!h.cond_change,
    bonpaso: h.bonpaso || "",
    odds_fuku: h.odds_fuku === undefined || h.odds_fuku === null ? "" : String(h.odds_fuku),
    chichi_kei: h.chichi_kei || "未入力",
    chichi_mei: h.chichi_mei || "",
    haha_chichi_kei: h.haha_chichi_kei || "未入力",
    hahahaa_kei: h.hahahaa_kei || "未入力",
    kishu_mei: h.kishu_mei || "",
    haha_seiseki: h.haha_seiseki || "不明",
    sanka_sedai: h.sanka_sedai || "不明",
  }));
  return { race, horses };
}

// ---------------------------------------------------------------
// index.html の関数を jsdom 上で取得
// ---------------------------------------------------------------
function loadTool() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => errors.push(String(e && e.message || e)));
  const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc, url: "https://iamshojikenchiku-rgb.github.io/smart-yosou/" });
  dom.window.alert = () => {};
  dom.window.confirm = () => true;
  const names = ["scoreHorse", "calcArereScore", "judgeConfidence", "judgeKachiba", "judgeQuadrant", "buildBets", "calcG_PiReference", "ARERU_RACES"];
  const fn = {};
  for (const n of names) {
    try {
      fn[n] = dom.window.eval(n);
    } catch (e) {
      throw new Error(`index.html に ${n} が見つかりません（名称不一致）: ${e.message}`);
    }
  }
  return { fn, dom, errors };
}

// ---------------------------------------------------------------
// 判定（App 内のパイプラインと同じ順序・同じ引数）
// ---------------------------------------------------------------
function judge(input, fn) {
  const { race, horses } = input;
  const validHorses = horses.filter((h) => h.uno && h.est_pop && h.pop_tan);
  const scored = validHorses.map((h) => ({ ...h, ...fn.scoreHorse(h, race.isAreru, race) })).sort((a, b) => b.score - a.score);
  const arere = fn.calcArereScore(race, scored);
  const confidence = fn.judgeConfidence(scored);
  const kachibaInfo = fn.judgeKachiba(scored, arere.score, scored);
  const quadrant = fn.judgeQuadrant(arere.score, confidence.level, kachibaInfo);
  const bets = fn.buildBets(scored, confidence, arere.score, kachibaInfo);
  const piRef = fn.calcG_PiReference(scored);
  const overhyped = scored.filter((h) => parseInt(h.pop_tan) <= 3 && parseInt(h.est_pop) >= 7);
  const skip = /🛑|🚫|⚠️/.test(quadrant.label);
  const total = bets.reduce((s, b) => s + (b.amount || 0), 0);
  const areruMatch = fn.ARERU_RACES.filter((r) => r.name && race.name && (race.name.includes(r.name) || r.name.includes(race.name)));
  return {
    version: "judge-v0.1",
    generated_at: new Date().toISOString(),
    date: dateStr,
    race: { ...race, horses_input: horses.length, horses_valid: validHorses.length },
    areru_races_hint: areruMatch.map((r) => ({ month: r.month, name: r.name, note: r.note || "", caution: !!r.caution })),
    decision: skip ? "見送り" : "購入可",
    purchase_allowed: !skip,
    judgement: {
      arereScore: arere.score,
      arereFactors: arere.factors,
      confidence: { level: confidence.level, label: confidence.label },
      kachiba: { isKachiba: !!(kachibaInfo && kachibaInfo.isKachiba), conditions: kachibaInfo ? kachibaInfo.conditions : null, details: kachibaInfo ? kachibaInfo.details : [] },
      quadrant: { label: quadrant.label, color: quadrant.color, advice: quadrant.advice },
    },
    overhyped: overhyped.map((h) => ({ uno: h.uno, name: h.name, est_pop: h.est_pop, pop_tan: h.pop_tan })),
    bets: bets.map((b) => ({ label: b.label, formula: b.formula, points: b.points, amount: b.amount || 0, perPoint: b.perPoint, kind: b.kind, note: b.note })),
    total_amount: total,
    ranking: scored.map((h, i) => ({
      rank_pos: i + 1,
      uno: h.uno,
      name: h.name,
      score: h.score,
      rank: h.rank,
      est_pop: h.est_pop,
      pop_tan: h.pop_tan,
      odds: h.odds,
      odds_fuku: h.odds_fuku || "",
      chichi_kei: h.chichi_kei,
      chichi_mei: h.chichi_mei,
      blood_total: h.blood ? h.blood.total : 0,
      blood_hint: h.blood ? h.blood.hint : "",
      reasons: h.reasons,
    })),
    pi_reference: {
      note: "G層π参考値（暫定・較正前・表示のみ）。買い目には反映しない。",
      k: null,
      rows: scored.map((h) => {
        const g = piRef[h.uno];
        return g ? { uno: h.uno, name: h.name, p: +g.p.toFixed(4), fair: +g.fair.toFixed(2), fuku: g.fuku, judge: g.judge } : null;
      }).filter(Boolean),
    },
  };
}

// ---------------------------------------------------------------
// 予算ガード（data/ledger.json）
// ---------------------------------------------------------------
function budgetGuard(result, ledgerFile) {
  const L = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
  const monthly = L.budget?.monthly ?? 10000;
  const weekly = L.budget?.weekly ?? 2500;
  const weeklyKachiba = L.budget?.weekly_kachiba ?? 3000;
  const month = dateStr.slice(0, 7);
  const d = new Date(dateStr + "T00:00:00+09:00");
  // 週＝月曜始まり
  const dow = (d.getUTCDay() + 6) % 7;
  const weekStart = new Date(d.getTime() - dow * 86400000).toISOString().slice(0, 10);
  const weekEnd = new Date(d.getTime() + (6 - dow) * 86400000).toISOString().slice(0, 10);
  const entries = (L.entries || []).filter((e) => e.date);
  const spentMonth = entries.filter((e) => e.date.slice(0, 7) === month).reduce((s, e) => s + (e.purchased || 0), 0);
  const spentWeek = entries.filter((e) => e.date >= weekStart && e.date <= weekEnd).reduce((s, e) => s + (e.purchased || 0), 0);
  const cap = result.judgement.kachiba.isKachiba ? weeklyKachiba : weekly;
  const planned = result.total_amount;
  const okMonth = spentMonth + planned <= monthly;
  const okWeek = spentWeek + planned <= cap;
  return {
    ledger: path.relative(ROOT, ledgerFile),
    month,
    week: `${weekStart}〜${weekEnd}`,
    monthly_budget: monthly,
    spent_month: spentMonth,
    remaining_month: monthly - spentMonth,
    weekly_cap: cap,
    spent_week: spentWeek,
    planned,
    ok: okMonth && okWeek,
    reason: okMonth && okWeek ? "" : !okMonth ? `月予算超過（消化 ${spentMonth} + 予定 ${planned} > ${monthly}）` : `週上限超過（消化 ${spentWeek} + 予定 ${planned} > ${cap}）`,
  };
}

// ---------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------
function toMarkdown(r) {
  const j = r.judgement;
  const L = [];
  L.push(`# ${r.race.name || "(無題)"} — 判定・買い目（${r.date}）`);
  L.push("");
  L.push(`**判定: ${r.decision}**${r.budget && !r.budget.ok ? "（" + r.budget.reason + "）" : ""}`);
  L.push("");
  L.push(`- コース: ${r.race.course} ${r.race.track}${r.race.distance}m / 馬場(予想): ${r.race.babaCondition} / ${r.race.raceClass}${r.race.isHandicap ? " ハンデ" : ""}${r.race.isAreru ? " / 荒れ判定ON" : ""} / 入力 ${r.race.horses_valid}/${r.race.horses_input} 頭`);
  L.push(`- 荒れスコア: **${j.arereScore}**/100 ／ 軸信頼度: **${j.confidence.label}** ／ 総合判定: **${j.quadrant.label}**`);
  L.push(`- 助言: ${j.quadrant.advice}`);
  if (j.kachiba.isKachiba) L.push("- ⚡ 勝負所（3条件達成）");
  else if (j.kachiba.conditions != null) L.push(`- 勝負所条件: ${j.kachiba.conditions}/3`);
  if (r.areru_races_hint.length) L.push(`- 参考: 荒れやすいレース一覧に該当（${r.areru_races_hint.map((a) => a.name + (a.note ? "：" + a.note : "")).join(" / ")}）`);
  if (r.budget) L.push(`- 予算: 今月 ${r.budget.spent_month}/${r.budget.monthly_budget} 円消化（残 ${r.budget.remaining_month}）／ 今週 ${r.budget.spent_week}/${r.budget.weekly_cap} 円 ／ 今回予定 ${r.budget.planned} 円 → ${r.budget.ok ? "OK" : "NG"}`);
  L.push("");
  if (r.overhyped.length) {
    L.push(`## ⚠ 過剰人気の警告`);
    L.push(r.overhyped.map((h) => `${h.uno}${h.name}（推${h.est_pop} vs 人${h.pop_tan}）`).join(" / "));
    L.push("");
  }
  L.push(`## 買い目${r.purchase_allowed ? "" : "（見送り判定のため購入しない・参考表示）"}`);
  if (r.bets.length === 0) L.push("（出走馬入力が4頭未満のため買い目なし）");
  for (const b of r.bets) L.push(`- ${b.label}: ${b.formula} — ${b.points}点 ${b.amount}円${b.note ? "（" + b.note + "）" : ""}`);
  L.push(`- 合計: ${r.total_amount} 円`);
  L.push("");
  L.push("## スコアランキング");
  L.push("| # | 馬番 | 馬名 | スコア | 評価 | 推定 | 人気 | 単勝 | 血統 | 主な根拠 |");
  L.push("|:--|:--|:--|--:|:--|--:|--:|--:|--:|:--|");
  for (const h of r.ranking) L.push(`| ${h.rank_pos} | ${h.uno} | ${h.name} | ${h.score > 0 ? "+" : ""}${h.score} | ${h.rank} | ${h.est_pop} | ${h.pop_tan} | ${h.odds} | ${h.blood_total > 0 ? "+" : ""}${h.blood_total} | ${h.reasons.slice(0, 2).join("・")} |`);
  L.push("");
  L.push("## 参考（買い目非反映）: G層π参考値 — 暫定・較正前");
  L.push("| 馬番 | 推定3着内率 | 公平複勝 | 複勝下限 | π判定 |");
  L.push("|:--|--:|--:|--:|:--|");
  for (const g of r.pi_reference.rows) L.push(`| ${g.uno} | ${(g.p * 100).toFixed(1)}% | ${g.fair.toFixed(2)} | ${g.fuku ?? "—"} | ${g.judge || ""} |`);
  L.push("");
  L.push("## 荒れスコア内訳");
  for (const f of j.arereFactors) L.push(`- ${f.label}: ${f.v > 0 ? "+" : ""}${f.v}`);
  L.push("");
  L.push("※ 月予算10,000円・週上限2,500円（勝負所のみ3,000円）。🛑/🚫/⚠️ が出たら理由を問わず見送り。");
  return L.join("\n");
}

// ---------------------------------------------------------------
// main
// ---------------------------------------------------------------
try {
  const raw = JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8"));
  const input = normalizeInput(raw);
  const { fn, dom, errors } = loadTool();
  const result = judge(input, fn);
  dom.window.close();
  if (errors.length) result.tool_errors = errors;
  if (ledgerPath) {
    result.budget = budgetGuard(result, path.resolve(ledgerPath));
    if (result.purchase_allowed && !result.budget.ok) {
      result.decision = "予算超過のため見送り";
      result.purchase_allowed = false;
    }
  }
  if (outPath) fs.writeFileSync(path.resolve(outPath), JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(wantMd ? toMarkdown(result) + "\n" : JSON.stringify(result, null, 2) + "\n");
} catch (e) {
  console.error("judge.js エラー: " + e.message);
  process.exit(1);
}
