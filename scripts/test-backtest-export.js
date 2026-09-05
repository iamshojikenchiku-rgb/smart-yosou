#!/usr/bin/env node
/**
 * scripts/test-backtest-export.js — モジュール3（結果入力・エクスポート）の jsdom テスト
 *
 *  T1: 保存 → 結果入力（1〜3着・開催日・確定馬場）→ 「JSONをコピー」でエクスポートJSONが得られる
 *  T2: エクスポートの各レコードが §3.1 の必須キーを持ち、in3 が result と一致し、blood_total が数値
 *  T3: 結果未入力のレースはエクスポート対象外（alert）
 *  T4: 既存の結果入力（購入額・払戻）フローが壊れていない（date/final_baba 無しの旧 result も開ける）
 *  T5: scripts/backtest.js がエクスポートを読んで走る（子プロセス）
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
let failed = false;
const ok = (m) => console.log("  ✔ " + m);
const ng = (m) => { failed = true; console.log("  ✖ " + m); };
const assert = (c, m) => (c ? ok(m) : ng(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function boot(seedLocalStorage) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => errors.push(String(e && e.message || e)));
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc, url: "https://iamshojikenchiku-rgb.github.io/smart-yosou/",
    beforeParse: (w) => { if (seedLocalStorage) for (const [k, v] of Object.entries(seedLocalStorage)) w.localStorage.setItem(k, v); },
  });
  const alerts = [];
  dom.window.confirm = () => true;
  dom.window.alert = (m) => alerts.push(String(m));
  // clipboard を失敗させてテキストエリアへのフォールバックを使う
  Object.defineProperty(dom.window.navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("no clipboard")) } });
  return { dom, errors, alerts };
}
function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new el.ownerDocument.defaultView.Event("input", { bubbles: true }));
}
function setSelect(el, value) {
  const proto = Object.getPrototypeOf(el);
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new el.ownerDocument.defaultView.Event("change", { bubbles: true }));
}
function btn(doc, text) {
  const b = [...doc.querySelectorAll("button")].find((x) => x.textContent.includes(text) || x.getAttribute("title") === text);
  if (!b) throw new Error("button not found: " + text);
  return b;
}
const horse = (uno, est, pop, odds, extra = {}) => ({
  uno, name: "馬" + uno, est_pop: est, rank: "C", odds, pop_tan: pop, rider_change: false, cond_change: false, bonpaso: "",
  chichi_kei: "未入力", haha_chichi_kei: "未入力", hahahaa_kei: "未入力", kishu_mei: "", haha_seiseki: "不明", sanka_sedai: "不明", ...extra,
});
const race = { name: "テスト記念", course: "阪神", distance: "1600", track: "芝", babaCondition: "良", isAreru: false, bias: "", isHandicap: false, raceClass: "G3", courseType: "big_turf" };
const horses = [
  horse(1, 1, 1, 2.5, { chichi_kei: "ディープ系", odds_fuku: 1.3 }),
  horse(2, 2, 3, 6.0, { chichi_kei: "ロベルト系", odds_fuku: 3.5 }),
  horse(3, 5, 2, 4.0, { chichi_kei: "キングマンボ系", odds_fuku: 2.0 }),
  horse(4, 8, 8, 30, { odds_fuku: 8.0 }),
  horse(5, 4, 5, 9.0, { chichi_kei: "ミスプロ系" }),
];

async function importAndSave(dom) {
  const doc = dom.window.document;
  btn(doc, "取込").click();
  await sleep(50);
  setNativeValue(doc.querySelector("textarea"), JSON.stringify({ race, horses }));
  await sleep(50);
  btn(doc, "読み込む").click();
  await sleep(200);
  // 結果画面の「保存」ボタン（テキスト）でレース保存
  [...doc.querySelectorAll("button")].find((x) => x.textContent.trim() === "保存").click();
  await sleep(100);
}

(async () => {
  let exported = null;
  console.log("[T1] 保存 → 結果入力 → エクスポート");
  {
    const { dom, errors, alerts } = boot();
    await sleep(200);
    const doc = dom.window.document;
    await importAndSave(dom);
    assert(alerts.includes("保存しました"), "レース保存");
    btn(doc, "保存").click(); // title="保存" の一覧ボタン
    await sleep(100);
    btn(doc, "結果").click();
    await sleep(100);
    const inputs = [...doc.querySelectorAll("input[type=number]")];
    const [r1, r2, r3] = inputs.slice(0, 3);
    setNativeValue(r1, "2"); await sleep(20);
    setNativeValue(r2, "5"); await sleep(20);
    setNativeValue(r3, "1"); await sleep(20);
    const dateEl = doc.querySelector("input[type=date]");
    assert(!!dateEl, "開催日入力欄が存在する");
    setNativeValue(dateEl, "2026-09-06"); await sleep(20);
    const sel = [...doc.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "未確定"));
    assert(!!sel, "確定馬場の選択欄（未確定/良/稍重/重/不良）が存在する");
    setSelect(sel, "稍重"); await sleep(20);
    btn(doc, "記録する").click();
    await sleep(100);
    assert(alerts.includes("結果を記録しました"), "結果を記録");
    btn(doc, "JSONをコピー").click();
    await sleep(150);
    const ta = [...doc.querySelectorAll("textarea")].find((t) => t.readOnly);
    assert(!!ta && ta.value.startsWith("["), "クリップボード不可時にテキストエリアへ JSON がフォールバック表示される");
    assert(errors.length === 0, "実行時エラーなし" + (errors[0] ? ": " + errors[0] : ""));
    try { exported = JSON.parse(ta.value); ok("エクスポートは有効な JSON 配列（" + exported.length + " レース）"); } catch (e) { ng("JSON parse: " + e.message); }
    dom.window.close();
  }

  console.log("[T2] レコード内容（§3.1）");
  if (exported && exported[0]) {
    const r = exported[0];
    for (const k of ["race", "date", "courseType", "baba", "result", "horses", "judgement"]) assert(k in r, `キー ${k}`);
    assert(r.race === "テスト記念" && r.date === "2026-09-06" && r.baba === "稍重", "レース名・開催日・確定馬場が反映");
    assert(JSON.stringify(r.result) === "[2,5,1]", "result = [2,5,1]");
    assert(r.horses.length === 5, "5頭分");
    const h2 = r.horses.find((h) => h.uno === 2);
    for (const k of ["score_total", "blood_total", "score_layers", "odds", "odds_fuku", "est_pop", "pi_p", "pi_fair", "pi_judge", "in3"]) assert(k in h2, `馬レコードのキー ${k}`);
    assert(typeof h2.blood_total === "number" && ["A", "B", "C", "D", "E", "F"].every((k) => k in h2.score_layers), "blood_total 数値・score_layers に A〜F");
    assert(r.horses.every((h) => h.in3 === [2, 5, 1].includes(h.uno)), "in3 が result と一致");
    assert(r.horses.find((h) => h.uno === 5).odds_fuku === null && h2.odds_fuku === 3.5, "odds_fuku 未入力は null、入力済みは数値");
    assert(typeof r.judgement.arereScore === "number" && typeof r.judgement.quadrant === "string", "judgement に荒れスコア・総合判定");
    const sumP = r.horses.reduce((a, h) => a + h.pi_p, 0);
    assert(sumP <= 3.001 && r.horses.every((h) => h.pi_p > 0 && h.pi_p <= 0.95), `Σ pi_p = ${sumP.toFixed(3)} ≤ 3（0.95 上限あり）・各 p ∈ (0, 0.95]`);
  }

  console.log("[T3] 結果未入力のレースは対象外");
  {
    const { dom, alerts } = boot();
    await sleep(200);
    const doc = dom.window.document;
    await importAndSave(dom);
    btn(doc, "保存").click(); // title="保存" の一覧ボタン
    await sleep(100);
    btn(doc, "JSONをコピー").click();
    await sleep(100);
    assert(alerts.some((a) => a.includes("入力済みのレースがありません")), "alert で案内");
    dom.window.close();
  }

  console.log("[T4] 旧形式の result（date/final_baba なし）でも結果入力が開ける");
  {
    const { dom, errors } = boot({
      "smartrc:race:1": JSON.stringify({ race, horses, savedAt: 1, arereScore: 50, result: { rank1: "1", rank2: "2", rank3: "3", payout_tan: "", payout_san3: "", purchased: "500", returned: "0", memo: "" } }),
    });
    await sleep(300);
    const doc = dom.window.document;
    btn(doc, "保存").click(); // title="保存" の一覧ボタン
    await sleep(100);
    btn(doc, "結果").click();
    await sleep(100);
    assert(doc.body.textContent.includes("レース結果入力"), "結果入力モーダルが開く");
    assert(doc.querySelector("input[type=date]").value === "", "開催日は空で初期化");
    assert(errors.length === 0, "実行時エラーなし" + (errors[0] ? ": " + errors[0] : ""));
    // 旧形式でも 1〜3着が入っていればエクスポート可能
    btn(doc, "JSONをコピー").click();
    await sleep(150);
    const ta = [...doc.querySelectorAll("textarea")].find((t) => t.readOnly);
    const rec = JSON.parse(ta.value)[0];
    assert(rec.date === "1970-01-01" && rec.baba === "", "date は savedAt から補完、baba は空");
    dom.window.close();
  }

  console.log("[T5] scripts/backtest.js がエクスポートを読んで走る");
  {
    const tmp = path.join(require("os").tmpdir(), "smart-yosou-export-test.json");
    fs.writeFileSync(tmp, JSON.stringify(exported));
    const outText = execFileSync("node", [path.join(__dirname, "backtest.js"), tmp, "--json"], { encoding: "utf8" });
    const o = JSON.parse(outText);
    assert(o.races_scorable === 1, "集計可能 1 レース");
    assert(o.k_best && typeof o.k_best.k === "number", "k 走査結果あり");
    assert(/結論を出さない/.test(o.verdict), "10レース未満 → 結論を出さない");
    fs.unlinkSync(tmp);
  }

  console.log(failed ? "\nNG: バックテスト基盤テスト失敗" : "\nOK: バックテスト基盤テスト合格");
  process.exit(failed ? 1 : 0);
})();
