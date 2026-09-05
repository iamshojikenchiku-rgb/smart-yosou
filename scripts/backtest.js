#!/usr/bin/env node
/**
 * scripts/backtest.js — G層π参考値のバックテスト集計（Node.js 単体・依存なし）
 * 設計アドendum G層π参考値 v0.1 §3.2 / §3.3
 *
 * 入力: ツールの「バックテスト用エクスポート」で得た JSON（1レース1オブジェクト、または その配列）。
 *       ファイル／ディレクトリを引数に指定。省略時は data/samples/ 以下の *.json を全て読む。
 * 出力:
 *   1. π条件（A∧B）該当馬の 複勝回収率・的中率・該当件数
 *   2. 条件Aのみ／条件Bのみ の同指標（分解確認）
 *   3. k を 0.2〜1.0 で走査し、対数損失が最小となる k（較正値）
 *   4. スコア帯別（10点刻み）の実3着内率（較正カーブ）
 *   + 採用基準（§3.3）の判定
 *
 * オプション:
 *   --include-synthetic   synthetic:true（パイプライン検証用の架空データ）も集計に含める
 *   --json                結果を JSON で標準出力に出す（人間向け表示は抑止）
 *   --k=0.5               指標1・2で用いる k（既定 0.5 = ツールの PI_LAYER_K と同じ）
 *
 * 注意:
 *   - 複勝回収率は「複勝オッズ下限（odds_fuku）× 100円」で計算する保守的な値。実払戻より低めに出る。
 *   - 判定ロジック（荒れスコア等）には一切関与しない。ここでの数値は G層の較正・検証専用。
 */
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const kArg = args.find((a) => a.startsWith("--k="));
const K_DEFAULT = kArg ? parseFloat(kArg.slice(4)) : 0.5;
const INCLUDE_SYNTHETIC = flags.has("--include-synthetic");
const JSON_OUT = flags.has("--json");
const inputs = args.filter((a) => !a.startsWith("--"));
const ROOT = path.resolve(__dirname, "..");

const PI_RATE_TH = 1 / Math.PI;
const PI_ODDS_TH = Math.PI;
const MIN_RACES = 10; // §3.3 10レース未満は結論を出さない
const ADOPT_ROI = 100; // §3.3 複勝回収率 100% 超
const ADOPT_N = 15; // §3.3 該当件数 ≥ 15

// ---------------------------------------------------------------
// 読み込み
// ---------------------------------------------------------------
function listJsonFiles(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    return fs
      .readdirSync(p)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => path.join(p, f));
  }
  return [p];
}
const files = (inputs.length ? inputs : [path.join(ROOT, "data", "samples")]).flatMap((p) => {
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) {
    console.error("not found: " + p);
    process.exit(2);
  }
  return listJsonFiles(abs);
});

const races = [];
const skipped = [];
for (const f of files) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(f, "utf8"));
  } catch (e) {
    skipped.push({ file: f, reason: "JSON parse error: " + e.message });
    continue;
  }
  const arr = Array.isArray(data) ? data : [data];
  arr.forEach((r, i) => {
    const tag = path.basename(f) + (arr.length > 1 ? `[${i}]` : "");
    if (!r || !Array.isArray(r.horses)) return skipped.push({ file: tag, reason: "horses 配列がない" });
    if (!Array.isArray(r.result) || r.result.length < 3) return skipped.push({ file: tag, reason: "result（1〜3着）が揃っていない" });
    if (r.synthetic && !INCLUDE_SYNTHETIC) return skipped.push({ file: tag, reason: "synthetic:true（--include-synthetic で含める）" });
    races.push({ ...r, _file: tag });
  });
}

// ---------------------------------------------------------------
// 変換式（index.html の calcG_PiReference と同一。ここは k を可変にする）
// ---------------------------------------------------------------
function piProbs(S, k) {
  const n = S.length;
  const mean = S.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(S.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const w = S.map((v) => Math.exp(k * (sd > 0 ? (v - mean) / sd : 0)));
  const ws = w.reduce((a, b) => a + b, 0);
  return w.map((x) => Math.min((3 * x) / ws, 0.95));
}

// 各レースを「集計可能な馬」の配列に正規化
function normalize(r) {
  const res = r.result.map(Number);
  const hs = r.horses
    .map((h) => {
      const S = typeof h.blood_total === "number" ? h.blood_total : null;
      const fuku = typeof h.odds_fuku === "number" && h.odds_fuku > 0 ? h.odds_fuku : null;
      const in3 = res.includes(Number(h.uno));
      return { uno: Number(h.uno), name: h.name || "", S, score_total: typeof h.score_total === "number" ? h.score_total : null, fuku, in3, pi_p: typeof h.pi_p === "number" ? h.pi_p : null };
    })
    .filter((h) => !isNaN(h.uno));
  const scorable = hs.every((h) => h.S !== null) && hs.length >= 2;
  return { race: r.race || r._file, date: r.date || "", file: r._file, partial: !!r.partial, synthetic: !!r.synthetic, horses: hs, scorable };
}
const R = races.map(normalize);
const scorableRaces = R.filter((x) => x.scorable);

// ---------------------------------------------------------------
// 指標1・2: π条件別の複勝回収率
// ---------------------------------------------------------------
function metric(rows) {
  const n = rows.length;
  const hits = rows.filter((h) => h.in3).length;
  const bet = n * 100;
  const ret = rows.reduce((a, h) => a + (h.in3 && h.fuku ? h.fuku * 100 : 0), 0);
  return { n, hits, hitRate: n ? hits / n : null, roi: n ? ret / bet : null, bet, ret };
}
const rowsAll = [];
for (const r of scorableRaces) {
  const p = piProbs(r.horses.map((h) => h.S), K_DEFAULT);
  r.horses.forEach((h, i) => {
    const condA = p[i] >= PI_RATE_TH;
    const condB = h.fuku !== null ? h.fuku >= PI_ODDS_TH : null;
    rowsAll.push({ ...h, race: r.race, p: p[i], condA, condB });
  });
}
const withFuku = rowsAll.filter((h) => h.fuku !== null);
const mAB = metric(withFuku.filter((h) => h.condA && h.condB));
const mA = metric(withFuku.filter((h) => h.condA)); // 条件A（複勝オッズあり・回収率算出可能なもの）
const mAonly = metric(withFuku.filter((h) => h.condA && !h.condB));
const mB = metric(withFuku.filter((h) => h.condB));
const mBonly = metric(withFuku.filter((h) => h.condB && !h.condA));
const mAll = metric(withFuku);

// ---------------------------------------------------------------
// 指標3: k 走査（対数損失）
// ---------------------------------------------------------------
function logLoss(k) {
  let ll = 0;
  let n = 0;
  for (const r of scorableRaces) {
    const p = piProbs(r.horses.map((h) => h.S), k);
    r.horses.forEach((h, i) => {
      const q = Math.min(Math.max(p[i], 1e-6), 1 - 1e-6);
      ll += h.in3 ? -Math.log(q) : -Math.log(1 - q);
      n++;
    });
  }
  return n ? ll / n : null;
}
const kGrid = [];
for (let k = 0.2; k <= 1.0 + 1e-9; k += 0.05) kGrid.push(+k.toFixed(2));
const kScan = kGrid.map((k) => ({ k, logloss: logLoss(k) }));
const kBest = kScan.reduce((b, x) => (x.logloss !== null && (b === null || x.logloss < b.logloss) ? x : b), null);
const llBaseline = logLoss(0); // k=0 → 全頭 3/n（血統情報を使わない基準線）

// ---------------------------------------------------------------
// 指標4: スコア帯別 実3着内率
// ---------------------------------------------------------------
function bands(rows, key) {
  const m = new Map();
  for (const h of rows) {
    const v = h[key];
    if (typeof v !== "number") continue;
    const lo = Math.floor(v / 10) * 10;
    const b = m.get(lo) || { band: `${lo}〜${lo + 9}`, lo, n: 0, hits: 0 };
    b.n++;
    if (h.in3) b.hits++;
    m.set(lo, b);
  }
  return [...m.values()].sort((a, b) => a.lo - b.lo).map((b) => ({ ...b, rate: b.hits / b.n }));
}
const allHorses = scorableRaces.flatMap((r) => r.horses);
const bandsBlood = bands(allHorses, "S");
const bandsTotal = bands(allHorses, "score_total");

// ---------------------------------------------------------------
// 採用基準（§3.3）
// ---------------------------------------------------------------
const nRaces = scorableRaces.length;
let verdict;
if (nRaces < MIN_RACES) verdict = `結論を出さない（集計可能レース ${nRaces} < ${MIN_RACES}）。表示のまま蓄積を続ける。`;
else if (mAB.roi !== null && mAB.roi * 100 > ADOPT_ROI && mAB.n >= ADOPT_N)
  verdict = `基準達成（π候補 複勝回収率 ${(mAB.roi * 100).toFixed(1)}% > ${ADOPT_ROI}%、該当 ${mAB.n} ≥ ${ADOPT_N}）。「買い目候補に含めるか」は別アドendumで検討。`;
else verdict = `基準未達（π候補 複勝回収率 ${mAB.roi === null ? "—" : (mAB.roi * 100).toFixed(1) + "%"}、該当 ${mAB.n}）。G層は表示のまま維持し蓄積を続ける。`;

const out = {
  files: files.map((f) => path.relative(ROOT, f)),
  races_loaded: races.length,
  races_scorable: nRaces,
  races_not_scorable: R.filter((x) => !x.scorable).map((x) => ({ race: x.race, file: x.file, partial: x.partial })),
  skipped,
  k_used: K_DEFAULT,
  metrics: { pi_candidate_A_and_B: mAB, A_all: mA, A_only: mAonly, B_all: mB, B_only: mBonly, all_with_fuku: mAll, horses_without_fuku: rowsAll.length - withFuku.length },
  k_scan: kScan,
  k_best: kBest,
  logloss_baseline_k0: llBaseline,
  bands_blood_total: bandsBlood,
  bands_score_total: bandsTotal,
  verdict,
};

if (JSON_OUT) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

// ---------------------------------------------------------------
// 表示
// ---------------------------------------------------------------
const pct = (v) => (v === null || v === undefined ? "  —  " : (v * 100).toFixed(1).padStart(5) + "%");
const line = (label, m) => `  ${label.padEnd(22, "　")} 件数 ${String(m.n).padStart(3)} / 的中 ${String(m.hits).padStart(3)} / 的中率 ${pct(m.hitRate)} / 複勝回収率 ${pct(m.roi)}`;

console.log("=== G層π参考値 バックテスト（設計アドendum v0.1 §3） ===");
console.log(`入力: ${files.length} ファイル / 読込 ${races.length} レース / 集計可能 ${nRaces} レース`);
for (const s of skipped) console.log(`  - スキップ: ${s.file} — ${s.reason}`);
for (const x of out.races_not_scorable) console.log(`  - 集計対象外（各層スコア未取得${x.partial ? "・partial" : ""}）: ${x.race} (${x.file})`);
if (nRaces === 0) {
  console.log("\n集計可能なレースがありません。ツールの「保存済みレース → 結果 → JSONをコピー」で出力した JSON を data/samples/ に置いてください。");
  console.log("\n[採用基準] " + verdict);
  process.exit(0);
}
console.log(`\n[1][2] π条件別の複勝成績（k=${K_DEFAULT}、複勝オッズ下限ベース・保守値）  ※odds_fuku なし ${out.metrics.horses_without_fuku} 頭は除外`);
console.log(line("π候補（A∧B）", mAB));
console.log(line("条件A 全体（p≥1/π）", mA));
console.log(line("条件A のみ（B不成立）", mAonly));
console.log(line("条件B 全体（複勝≥π）", mB));
console.log(line("条件B のみ（A不成立）", mBonly));
console.log(line("全頭（参考）", mAll));

console.log(`\n[3] k 走査（対数損失・小さいほど良い）  基準線 k=0（血統不使用）: ${llBaseline === null ? "—" : llBaseline.toFixed(4)}`);
console.log("  " + kScan.map((x) => `k=${x.k.toFixed(2)}:${x.logloss.toFixed(4)}`).join("  "));
if (kBest) console.log(`  → 最小: k=${kBest.k.toFixed(2)}（対数損失 ${kBest.logloss.toFixed(4)}）${kBest.logloss >= llBaseline ? "  ※基準線を下回らず。血統スコアの序列が3着内率を説明できていない" : ""}`);

console.log("\n[4] スコア帯別 実3着内率（較正カーブ）");
console.log("  血統スコア合計（A〜F層＝S_i）:");
for (const b of bandsBlood) console.log(`    ${b.band.padStart(9)}  n=${String(b.n).padStart(3)}  3着内 ${String(b.hits).padStart(3)}  率 ${pct(b.rate)}`);
if (bandsTotal.length) {
  console.log("  総合スコア（score_total）:");
  for (const b of bandsTotal) console.log(`    ${b.band.padStart(9)}  n=${String(b.n).padStart(3)}  3着内 ${String(b.hits).padStart(3)}  率 ${pct(b.rate)}`);
}
console.log("\n[採用基準 §3.3] " + verdict);
