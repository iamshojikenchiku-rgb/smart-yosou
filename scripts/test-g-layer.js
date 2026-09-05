#!/usr/bin/env node
/**
 * scripts/test-g-layer.js — モジュール2（G層π参考値・表示のみ）の jsdom テスト
 *
 *  T1: odds_fuku なし・chichi_mei なし・chichi_kei 未入力 の16キー以下JSON → 既存表示が崩れず、G層行が「複勝:—」で出る
 *  T2: odds_fuku あり → 公平複勝と π判定（π候補 / 率のみ）が出る
 *  T3: 🛑（荒れ高×軸信頼度低）になる入力 → π列がグレーアウト（line-through）される
 *  T4: calcG_PiReference の数式検証（Σp = 3、sd=0 なら全頭同率、上限 0.95）
 *  T5: 既存判定関数の入出力が G層追加前後で同一（scoreHorse / calcArereScore / judgeQuadrant は odds_fuku を参照しない）
 */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
let failed = false;
const ok = (m) => console.log("  ✔ " + m);
const ng = (m) => { failed = true; console.log("  ✖ " + m); };
const assert = (c, m) => (c ? ok(m) : ng(m));

function boot() {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => errors.push(String(e && e.message || e)));
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    url: "https://iamshojikenchiku-rgb.github.io/smart-yosou/",
  });
  dom.window.confirm = () => true;
  dom.window.alert = () => {};
  return { dom, errors };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// React の制御コンポーネントに値を流し込む
function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new el.ownerDocument.defaultView.Event("input", { bubbles: true }));
}
function clickByText(doc, text) {
  const btn = [...doc.querySelectorAll("button")].find((b) => b.textContent.includes(text));
  if (!btn) throw new Error("button not found: " + text);
  btn.click();
}
async function importJson(dom, obj) {
  const doc = dom.window.document;
  clickByText(doc, "取込");
  await sleep(50);
  const ta = doc.querySelector("textarea");
  setNativeValue(ta, JSON.stringify(obj));
  await sleep(50);
  clickByText(doc, "読み込む");
  await sleep(200);
  return doc.getElementById("root");
}

const horse = (uno, est, pop, odds, extra = {}) => ({
  uno, name: "馬" + uno, est_pop: est, rank: "C", odds, pop_tan: pop,
  rider_change: false, cond_change: false, bonpaso: "",
  chichi_kei: "未入力", haha_chichi_kei: "未入力", hahahaa_kei: "未入力",
  kishu_mei: "", haha_seiseki: "不明", sanka_sedai: "不明", ...extra,
});
const baseRace = { name: "テストS", course: "東京", distance: "1600", track: "芝", babaCondition: "良", isAreru: false, bias: "", isHandicap: false, raceClass: "OP", courseType: "big_turf" };

(async () => {
  // ---------- T1 ----------
  console.log("[T1] odds_fuku なし・chichi_mei なし");
  {
    const { dom, errors } = boot();
    await sleep(200);
    const root = await importJson(dom, {
      race: baseRace,
      horses: [horse(1, 1, 1, 2.5), horse(2, 2, 3, 6.0), horse(3, 5, 2, 4.0), horse(4, 8, 8, 30)],
    });
    const t = root.textContent;
    assert(errors.length === 0, "実行時エラーなし" + (errors[0] ? ": " + errors[0] : ""));
    assert(t.includes("スコアランキング"), "結果画面（スコアランキング）が描画される");
    assert(t.includes("G層 π参考値（暫定・較正前"), "G層の暫定・較正前ラベルが表示される");
    assert((t.match(/複勝:—/g) || []).length === 4, "odds_fuku 無しの4頭すべてが 複勝:— で判定保留");
    assert(t.includes("π 3着内:"), "推定3着内率が表示される");
    assert(!/NaN|Infinity/.test(t), "NaN / Infinity が表示に混入しない");
    dom.window.close();
  }

  // ---------- T2 ----------
  console.log("[T2] odds_fuku あり（chichi_kei で血統差をつける）");
  {
    const { dom, errors } = boot();
    await sleep(200);
    const root = await importJson(dom, {
      race: baseRace,
      horses: [
        horse(1, 1, 1, 2.5, { chichi_kei: "ディープ系", odds_fuku: 1.3 }),
        horse(2, 2, 3, 6.0, { chichi_kei: "ロベルト系", odds_fuku: 3.5 }),
        horse(3, 5, 2, 4.0, { chichi_kei: "キングマンボ系", odds_fuku: 2.0 }),
        horse(4, 8, 8, 30, { odds_fuku: 8.0 }),
        horse(5, 4, 5, 9.0, { chichi_kei: "ミスプロ系", odds_fuku: "4.1" }),
      ],
    });
    const t = root.textContent;
    assert(errors.length === 0, "実行時エラーなし" + (errors[0] ? ": " + errors[0] : ""));
    assert(t.includes("複勝:3.5倍"), "入力した複勝オッズ 3.5 が表示される");
    assert(t.includes("複勝:4.1倍"), "文字列で渡した複勝オッズ \"4.1\" も数値として表示される");
    assert(!t.includes("複勝:—"), "全頭に odds_fuku があるので判定保留なし");
    assert(/公平複勝:\d+\.\d\d倍/.test(t), "公平複勝オッズが小数2桁で表示される");
    const g = dom.window.eval("calcG_PiReference")(
      [1, 2, 3, 4, 5].map((u, i) => ({ uno: String(u), blood: { total: [10, 0, 5, -5, 0][i] }, odds_fuku: [1.3, 3.5, 2.0, 8.0, "4.1"][i] }))
    );
    const cand = Object.values(g).filter((x) => x.judge === "π候補").length;
    const rateOnly = Object.values(g).filter((x) => x.judge === "率のみ").length;
    ok(`π判定内訳: π候補=${cand} / 率のみ=${rateOnly}`);
    assert(g["1"].judge === "率のみ" && g["1"].condA && g["1"].condB === false, "血統上位×低複勝(1.3) → 率のみ（条件Bを満たさない）");
    dom.window.close();
  }

  // ---------- T3 ----------
  console.log("[T3] 🛑/🚫/⚠️ 判定時のグレーアウト");
  {
    const { dom, errors } = boot();
    await sleep(200);
    // 軸信頼度が下がる入力（上位が D/E 評価・人気薄）＋ 荒れ判定ON・ハンデ・多頭数で荒れスコアを上げる
    const hs = [];
    for (let i = 1; i <= 16; i++) hs.push(horse(i, i, ((i * 7) % 16) + 1, 10 + i * 3, { rank: "D" }));
    const root = await importJson(dom, {
      race: { ...baseRace, isAreru: true, isHandicap: true, babaCondition: "重", course: "福島", courseType: "small_turf" },
      horses: hs,
    });
    const t = root.textContent;
    assert(errors.length === 0, "実行時エラーなし" + (errors[0] ? ": " + errors[0] : ""));
    const stop = /🛑|🚫|⚠️/.test(t);
    assert(stop, "見送り系判定（🛑/🚫/⚠️）が出る入力になっている");
    const grayed = root.querySelectorAll(".line-through").length;
    assert(grayed === 16, `π行が全頭グレーアウト（line-through）される: ${grayed}/16`);
    assert(t.includes("π列は参考外"), "グレーアウトの注記が表示される");
    dom.window.close();
  }

  // ---------- T4 ----------
  console.log("[T4] 変換式の検証");
  {
    const { dom } = boot();
    await sleep(100);
    const f = dom.window.eval("calcG_PiReference");
    const K = dom.window.eval("PI_LAYER_K");
    assert(K === 0.5, "k = 0.5（初期値）");
    const g1 = f([10, 5, 0, -5, 3, 7, 1, 2].map((v, i) => ({ uno: String(i + 1), blood: { total: v } })));
    const sum = Object.values(g1).reduce((a, x) => a + x.p, 0);
    assert(Math.abs(sum - 3) < 1e-9, `Σp = ${sum.toFixed(6)}（= 3）`);
    const g2 = f([0, 0, 0, 0, 0, 0].map((v, i) => ({ uno: String(i + 1), blood: { total: v } })));
    assert(Object.values(g2).every((x) => Math.abs(x.p - 0.5) < 1e-9), "sd = 0 のとき全頭 p = 3/n = 0.5");
    const g3 = f([{ uno: "1", blood: { total: 0 } }, { uno: "2", blood: { total: 0 } }]);
    assert(Object.values(g3).every((x) => x.p === 0.95), "2頭立てなど p > 0.95 は 0.95 で頭打ち");
    assert(f([{ uno: "1" }])["1"].p === 0.95, "blood 未定義（chichi_kei 未入力）でも落ちない");
    assert(Object.keys(f([])).length === 0, "0頭で空オブジェクト");
    dom.window.close();
  }

  // ---------- T5 ----------
  console.log("[T5] 既存判定が odds_fuku の有無で変化しない");
  {
    const { dom } = boot();
    await sleep(100);
    const w = dom.window;
    const scoreHorse = w.eval("scoreHorse");
    const calcArereScore = w.eval("calcArereScore");
    const race = { ...baseRace };
    const a = horse(1, 2, 5, 8.0, { chichi_kei: "ロベルト系" });
    const b = { ...a, odds_fuku: 3.9 };
    const sa = scoreHorse(a, false, race), sb = scoreHorse(b, false, race);
    assert(sa.score === sb.score && JSON.stringify(sa.reasons) === JSON.stringify(sb.reasons), "scoreHorse: odds_fuku を無視する");
    const sc = [a, b].map((h) => ({ ...h, ...scoreHorse(h, false, race) }));
    assert(calcArereScore(race, sc).score === calcArereScore(race, sc.map((h) => ({ ...h, odds_fuku: 9 }))).score, "calcArereScore: odds_fuku を無視する");
    dom.window.close();
  }

  console.log(failed ? "\nNG: G層テスト失敗" : "\nOK: G層テスト合格");
  process.exit(failed ? 1 : 0);
})();
