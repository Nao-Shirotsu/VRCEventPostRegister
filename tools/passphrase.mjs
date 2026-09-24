#!/usr/bin/env node
/*
 * 合言葉を発行し、そのハッシュだけを assets/passphrases.js に書き出す。
 * 合言葉そのものはファイルに残らず、標準出力に一度だけ表示される。
 *
 *   # 固定の合言葉（期限なし / --until で期限つき）
 *   node tools/passphrase.mjs --pass "好きな合言葉" [--until 2026-12-31]
 *
 *   # 日替わり合言葉を30日分まとめて発行（開始日省略時は今日・JST）
 *   node tools/passphrase.mjs --daily 30 [--start 2026-10-01]
 *
 * --pass と --daily は併用できる。実行するたびに assets/passphrases.js は作り直される
 * （それまでの合言葉はすべて無効になる）。
 */
import { writeFile } from "node:fs/promises";
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
    out: { type: "string", default: "assets/passphrases.js" },
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

async function hashSlot(pass, from, until) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const base = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(normalizePass(pass)), "PBKDF2", false, ["deriveBits"],
  );
  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, base, 256,
  );
  return { from: from ?? null, until: until ?? null, salt: b64(salt), hash: b64(hash) };
}

const slots = [];
const issued = [];

if (args.pass) {
  slots.push(await hashSlot(args.pass, null, args.until));
  issued.push(["固定", args.until ? `〜${args.until}` : "期限なし", args.pass]);
}
if (args.daily) {
  const start = args.start ?? todayJST();
  for (let i = 0; i < Number(args.daily); i++) {
    const day = addDays(start, i);
    const pass = randomPass();
    slots.push(await hashSlot(pass, day, day));
    issued.push(["日替わり", day, pass]);
  }
}

await writeFile(
  args.out,
  `// tools/passphrase.mjs で生成。手で編集しないこと。合言葉のハッシュのみを含む。\n` +
  `window.PASSPHRASES = ${JSON.stringify({ iterations: ITERATIONS, slots }, null, 2)};\n`,
);

console.log(`${args.out} に ${slots.length} 件の合言葉を書き出しました。\n`);
for (const [kind, when, pass] of issued) console.log(`${kind}\t${when}\t${pass}`);
