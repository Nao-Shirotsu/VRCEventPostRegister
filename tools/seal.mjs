#!/usr/bin/env node
/*
 * 送信先設定を合言葉で暗号化して assets/vault.js を生成する。
 *
 *   # 固定の合言葉（期限なし / --until で期限つき）
 *   node tools/seal.mjs --config tools/destinations.json --pass "好きな合言葉" [--until 2026-12-31]
 *
 *   # 日替わり合言葉を30日分まとめて発行（開始日省略時は今日・JST）
 *   node tools/seal.mjs --config tools/destinations.json --daily 30 [--start 2026-10-01]
 *
 * --pass と --daily は併用できる（管理者用の固定合言葉 + 配布用の日替わり合言葉など）。
 * 発行した合言葉は標準出力にだけ表示される。ファイルには残らないので控えておくこと。
 */
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const ITERATIONS = 250_000;
const WORDS = [
  "sora", "kumo", "hoshi", "tsuki", "umi", "yama", "kaze", "hana",
  "mori", "kawa", "yuki", "ame", "niji", "hikari", "kage", "oto",
  "neko", "inu", "tori", "kitsune", "usagi", "kuma", "shika", "sakana",
  "mado", "tobira", "kagi", "hon", "kami", "pen", "isu", "tsukue",
  "ringo", "momo", "mikan", "ichigo", "budou", "kuri", "mame", "kome",
  "aka", "ao", "midori", "kiiro", "shiro", "kuro", "gin", "kin",
  "haru", "natsu", "aki", "fuyu", "asa", "hiru", "yoru", "yume",
  "fune", "densha", "hashi", "michi", "machi", "mura", "shima", "oka",
];

const { values: args } = parseArgs({
  options: {
    config: { type: "string", default: "tools/destinations.json" },
    out: { type: "string", default: "assets/vault.js" },
    pass: { type: "string" },
    until: { type: "string" },
    daily: { type: "string" },
    start: { type: "string" },
  },
});

if (!args.pass && !args.daily) {
  console.error("--pass か --daily のどちらかを指定してください。");
  process.exit(1);
}

const normalizePass = (s) => s.normalize("NFKC").trim().toLowerCase(); // app.js と同じ規則
const b64 = (buf) => Buffer.from(buf).toString("base64");
const todayJST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());

function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function randomPass() {
  const r = crypto.getRandomValues(new Uint32Array(4));
  const words = [0, 1, 2].map((i) => WORDS[r[i] % WORDS.length]);
  return `${words.join("-")}-${String(r[3] % 1000).padStart(3, "0")}`;
}

async function seal(plaintext, pass, from, until) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(normalizePass(pass)), "PBKDF2", false, ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt"],
  );
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { from: from ?? null, until: until ?? null, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

const payload = JSON.parse(await readFile(args.config, "utf8"));
const plaintext = new TextEncoder().encode(JSON.stringify(payload));
const slots = [];
const issued = [];

if (args.pass) {
  slots.push(await seal(plaintext, args.pass, null, args.until));
  issued.push(["固定", args.until ? `〜${args.until}` : "期限なし", args.pass]);
}
if (args.daily) {
  const start = args.start ?? todayJST();
  for (let i = 0; i < Number(args.daily); i++) {
    const day = addDays(start, i);
    const pass = randomPass();
    slots.push(await seal(plaintext, pass, day, day));
    issued.push(["日替わり", day, pass]);
  }
}

const vault = { v: 1, iterations: ITERATIONS, slots };
await writeFile(
  args.out,
  `// tools/seal.mjs で生成。手で編集しないこと。\nwindow.VAULT = ${JSON.stringify(vault, null, 2)};\n`,
);

console.log(`${args.out} に ${slots.length} 件の合言葉スロットを書き出しました。\n`);
for (const [kind, when, pass] of issued) console.log(`${kind}\t${when}\t${pass}`);
