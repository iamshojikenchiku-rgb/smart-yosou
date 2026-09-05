#!/usr/bin/env node
/**
 * scripts/test-judge.js — judge.js の出力が「ブラウザでツールに同じJSONを貼った画面」と一致することを固定する
 *
 *  複数の入力（購入可 / 🛑見送り / 4頭未満 / odds_fuku無し）について、
 *  jsdom で index.html の取込フローを実走した画面テキストと、judge.js の JSON 出力を突合する。
 *  突合項目: 荒れスコア・軸信頼度ラベル・総合判定ラベル・買い目の式と金額・合計・過剰人気・π行。
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
let failed = false;
const ok = (m) => console.log("  ✔ " + m);
const ng = (m) => { failed = true; console.log("  ✖ " + m); };
const assert = (c, m) => (c ? ok(m) : ng(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setNativeValue(el, value) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, value);
  el.dispatchEvent(new el.ownerDocument.defaultView.Event("input", { bubbles: true }));
}
async function renderInBrowser(obj) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => errors.push(String(e && e.message || e)));
  const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc, url: "https://iamshojikenchiku-rgb.github.io/smart-yosou/" });
  dom.window.alert = () => {};
  dom.window.confirm = () => true;
  await sleep(150);
  const doc = dom.window.document;
  [...doc.querySelectorAll("button")].find((b) => b.textContent.includes("取込")).click();
  await sleep(50);
  setNativeValue(doc.querySelector("textarea"), JSON.stringify(obj));
  await sleep(50);
  [...doc.querySelectorAll("button")].find((b) => b.textContent.includes("読み込む")).click();
  await sleep(200);
  const text = doc.getElementById("root").textContent;
  dom.window.close();
  return { text, errors };
}
function runJudge(obj, extra = []) {
  const tmp = path.join(os.tmpdir(), `judge-test-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmp, JSON.stringify(obj));
  try {
    return JSON.parse(execFileSync("node", [path.join(__dirname, "judge.js"), tmp, ...extra], { encoding: "utf8" }));
  } finally {
    fs.unlinkSync(tmp);
  }
}
const horse = (uno, est, pop, odds, extra = {}) => ({
  uno, name: "馬" + uno, est_pop: est, rank: "C", odds, pop_tan: pop, rider_change: false, cond_change: false, bonpaso: "",
  chichi_kei: "未入力", haha_chichi_kei: "未入力", hahahaa_kei: "未入力", kishu_mei: "", haha_seiseki: "不明", sanka_sedai: "不明", ...extra,
});
const base = { name: "一致テスト", course: "東京", distance: "1600", track: "芝", babaCondition: "良", isAreru: false, bias: "", isHandicap: false, raceClass: "OP", courseType: "big_turf" };

const cases = [
  { label: "例入力（data/inputs/_example_input.json）", obj: JSON.parse(fs.readFileSync(path.join(ROOT, "data/inputs/_example_input.json"), "utf8")) },
  {
    label: "🛑/⚠️ 系（16頭・D評価・荒れON・ハンデ・重）",
    obj: { race: { ...base, isAreru: true, isHandicap: true, babaCondition: "重", course: "福島", courseType: "small_turf" }, horses: [...Array(16).keys()].map((i) => horse(i + 1, i + 1, ((i * 7) % 16) + 1, 10 + i * 3, { rank: "D" })) },
  },
  { label: "堅め（A評価1番人気・少頭数）", obj: { race: base, horses: [horse(1, 1, 1, 1.8, { rank: "A", chichi_kei: "ディープ系" }), horse(2, 2, 2, 5, { rank: "B" }), horse(3, 3, 3, 8), horse(4, 4, 4, 12), horse(5, 5, 5, 20)] } },
  { label: "3頭（買い目なし）", obj: { race: base, horses: [horse(1, 1, 1, 2), horse(2, 2, 2, 4), horse(3, 3, 3, 9)] } },
];

(async () => {
  for (const c of cases) {
    console.log(`[${c.label}]`);
    const { text, errors } = await renderInBrowser(c.obj);
    const j = runJudge(c.obj);
    assert(errors.length === 0, "ブラウザ描画エラーなし");
    assert(text.includes(String(j.judgement.arereScore) + "/100"), `荒れスコア ${j.judgement.arereScore} が画面と一致`);
    assert(text.includes(j.judgement.quadrant.label), `総合判定「${j.judgement.quadrant.label}」が画面と一致`);
    assert(text.includes(j.judgement.confidence.label), `軸信頼度「${j.judgement.confidence.label}」が画面と一致`);
    for (const b of j.bets) assert(text.includes(b.formula) && text.includes(`${b.amount}円`), `買い目「${b.label}」の式と金額が画面と一致`);
    if (j.bets.length) assert(text.includes(`合計投資額${j.total_amount}円`), `合計 ${j.total_amount} 円が画面と一致`);
    else assert(!text.includes("合計投資額"), "買い目なし → 画面にも合計なし");
    for (const h of j.overhyped) assert(text.includes(`${h.uno}${h.name}(推${h.est_pop}vs人${h.pop_tan})`), `過剰人気 ${h.uno} が画面と一致`);
    for (const g of j.pi_reference.rows.slice(0, 3)) assert(text.includes(`π 3着内:${(g.p * 100).toFixed(1)}%`), `π行 ${g.uno}（${(g.p * 100).toFixed(1)}%）が画面と一致`);
    const skip = /🛑|🚫|⚠️/.test(j.judgement.quadrant.label);
    assert(j.purchase_allowed === !skip && j.decision === (skip ? "見送り" : "購入可"), `decision=${j.decision}（絵文字規則と整合）`);
  }

  console.log("[予算ガード]");
  {
    const tmpLedger = path.join(os.tmpdir(), `ledger-test-${process.pid}.json`);
    fs.writeFileSync(tmpLedger, JSON.stringify({ budget: { monthly: 10000, weekly: 2500, weekly_kachiba: 3000 }, entries: [{ date: "2026-09-05", race: "既購入", purchased: 2000, returned: 0 }] }));
    const j = runJudge(cases[0].obj, ["--ledger", tmpLedger, "--date", "2026-09-06"]);
    assert(j.budget && j.budget.spent_week === 2000 && j.budget.planned === 1500, `週消化 ${j.budget.spent_week} + 予定 ${j.budget.planned}`);
    assert(j.budget.ok === false && j.decision === "予算超過のため見送り" && j.purchase_allowed === false, "週上限超過 → 予算超過のため見送り");
    const j2 = runJudge(cases[0].obj, ["--ledger", tmpLedger, "--date", "2026-09-13"]);
    assert(j2.budget.ok === true && j2.decision === "購入可", "翌週は週消化0 → 購入可");
    fs.unlinkSync(tmpLedger);
  }
  console.log("[Markdown]");
  {
    const tmp = path.join(os.tmpdir(), `judge-md-${process.pid}.json`);
    fs.writeFileSync(tmp, JSON.stringify(cases[0].obj));
    const md = execFileSync("node", [path.join(__dirname, "judge.js"), tmp, "--md"], { encoding: "utf8" });
    fs.unlinkSync(tmp);
    assert(md.startsWith("# ") && md.includes("## 買い目") && md.includes("参考（買い目非反映）: G層π参考値"), "Markdown に判定・買い目・π参考欄");
  }
  console.log(failed ? "\nNG: judge 一致テスト失敗" : "\nOK: judge 一致テスト合格");
  process.exit(failed ? 1 : 0);
})();
