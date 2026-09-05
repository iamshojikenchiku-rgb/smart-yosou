#!/usr/bin/env node
/**
 * scripts/ledger.js — 収支台帳（data/ledger.json）の追記と集計
 *
 *   node scripts/ledger.js summary [--month YYYY-MM]
 *   node scripts/ledger.js add --date YYYY-MM-DD --race "レース名" --purchased 500 [--returned 0] [--decision "📊 通常運用"] [--bets "..."] [--memo "..."]
 *
 * 台帳の予算値（monthly / weekly / weekly_kachiba）は運用フロー定義書 §2 ステップ5 と一致させる。
 */
const fs = require("fs");
const path = require("path");

const FILE = path.resolve(__dirname, "..", "data", "ledger.json");
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (n, d = null) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const L = JSON.parse(fs.readFileSync(FILE, "utf8"));
L.entries = L.entries || [];

if (cmd === "add") {
  const date = opt("--date");
  const race = opt("--race");
  const purchased = parseInt(opt("--purchased"), 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !race || isNaN(purchased)) {
    console.error("usage: ledger.js add --date YYYY-MM-DD --race NAME --purchased N [--returned N] [--decision S] [--bets S] [--memo S]");
    process.exit(2);
  }
  const dup = L.entries.find((e) => e.date === date && e.race === race);
  if (dup) {
    console.error(`既に同じ日付・レースの記録があります（${date} ${race}）。編集は data/ledger.json を直接直してください。`);
    process.exit(3);
  }
  L.entries.push({
    date,
    race,
    decision: opt("--decision", ""),
    bets: opt("--bets", ""),
    purchased,
    returned: parseInt(opt("--returned", "0"), 10) || 0,
    memo: opt("--memo", ""),
    source: opt("--source", "ledger.js"),
  });
  L.entries.sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(FILE, JSON.stringify(L, null, 2) + "\n");
  console.log(`追記: ${date} ${race} 購入 ${purchased} 円 / 払戻 ${opt("--returned", "0")} 円`);
  process.exit(0);
}

// summary
const month = opt("--month") || new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7);
const all = L.entries;
const inMonth = all.filter((e) => e.date.startsWith(month));
const sum = (xs, k) => xs.reduce((s, e) => s + (e[k] || 0), 0);
const fmt = (xs) => `購入 ${sum(xs, "purchased")} 円 / 払戻 ${sum(xs, "returned")} 円 / 収支 ${sum(xs, "returned") - sum(xs, "purchased")} 円 / 回収率 ${sum(xs, "purchased") ? ((sum(xs, "returned") / sum(xs, "purchased")) * 100).toFixed(1) : "—"}% / 的中 ${xs.filter((e) => e.returned > 0).length}/${xs.length}`;
console.log(`=== 収支台帳 (${path.relative(process.cwd(), FILE)}) ===`);
console.log(`予算: 月 ${L.budget.monthly} 円 / 週 ${L.budget.weekly} 円（勝負所 ${L.budget.weekly_kachiba} 円）`);
console.log(`${month}: ${fmt(inMonth)} / 残 ${L.budget.monthly - sum(inMonth, "purchased")} 円`);
console.log(`累計  : ${fmt(all)}`);
const byMonth = {};
for (const e of all) (byMonth[e.date.slice(0, 7)] = byMonth[e.date.slice(0, 7)] || []).push(e);
for (const m of Object.keys(byMonth).sort()) console.log(`  ${m}: ${fmt(byMonth[m])}`);
