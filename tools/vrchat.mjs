// VRChat グループにイベントまたは投稿を登録する（.github/workflows/vrchat.yml から実行される）
//
// 入力は workflow_dispatch の payload（JSON 文字列）をイベントファイルから直接読む（ログに出さないため）。
//   kind: "event"  グループのカレンダーにイベントを作る
//   kind: "post"   グループに投稿（アナウンス）する
//
// VRChat のログイン Cookie は発行元の IP に結びつき、実行ごとに IP が変わる Actions では使い回せない。
// そのため毎回ログインし、終わったらログアウトしてセッションを残さない。
//
// 環境変数（リポジトリのシークレット）
//   VRC_USERNAME     サブアカウントのユーザー名
//   VRC_PASSWORD     サブアカウントのパスワード
//   VRC_TOTP_SECRET  2段階認証（認証アプリ）の秘密鍵。セットアップ時の「キーを手入力」の文字列
//   GITHUB_EVENT_PATH  Actions が自動で設定する

import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

const API = "https://api.vrchat.cloud/api/1";
const USER_AGENT = "VRCEventPostRegister/1.0 (https://github.com/Nao-Shirotsu/VRCEventPostRegister)";

// ::error:: で出したメッセージは、サイト側で失敗理由として表示される
function fail(message) {
  console.log(`::error::${message}`);
  process.exit(1);
}

/* ---------- 入力の確認（ログイン前に済ませる） ---------- */

const { VRC_USERNAME: username, VRC_PASSWORD: password, VRC_TOTP_SECRET: totpSecret } = process.env;
for (const [name, value] of Object.entries({ VRC_USERNAME: username, VRC_PASSWORD: password, VRC_TOTP_SECRET: totpSecret })) {
  if (!value?.trim()) fail(`シークレット ${name} が設定されていません。`);
}

const { inputs } = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
let p;
try {
  p = JSON.parse(inputs?.payload ?? "");
} catch {
  fail("送信内容を読み取れませんでした。");
}
if (!/^grp_[0-9a-f-]{36}$/.test(p.groupId ?? "")) fail("グループ ID が正しくありません（assets/config.js を確認）。");
if (!p.title) fail("タイトルが空です。");

let path, body;
if (p.kind === "event") {
  const startsAt = new Date(p.startsAt);
  const endsAt = new Date(p.endsAt);
  if (p.title.length > 64) fail("タイトルは64文字以内にしてください。");
  if (!p.description) fail("説明が空です。");
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) fail("開始・終了日時が正しくありません。");
  if (startsAt <= new Date()) fail("開始日時が過去になっています。");
  if (endsAt <= startsAt) fail("終了日時は開始日時より後にしてください。");
  path = `/calendar/${p.groupId}/event`;
  body = {
    title: p.title,
    description: p.description,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    category: p.category,
    accessType: p.accessType,
    sendCreationNotification: Boolean(p.notify),
  };
} else if (p.kind === "post") {
  if (!p.text) fail("本文が空です。");
  path = `/groups/${p.groupId}/posts`;
  body = {
    title: p.title,
    text: p.text,
    visibility: p.visibility,
    sendNotification: Boolean(p.notify),
  };
} else {
  fail(`不明な種類です: ${p.kind}`);
}

/* ---------- VRChat API ---------- */

const cookies = new Map();

async function call(apiPath, init = {}) {
  const res = await fetch(`${API}${apiPath}`, {
    ...init,
    headers: {
      "User-Agent": USER_AGENT,
      Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  for (const c of res.headers.getSetCookie()) {
    const [name, value] = c.split(";")[0].split("=");
    cookies.set(name.trim(), value);
  }
  const json = await res.json().catch(() => null);
  return { res, json, message: json?.error?.message ?? `HTTP ${res.status}` };
}

// 認証アプリと同じ6桁のコードを秘密鍵から作る（RFC 6238, SHA-1, 30秒）
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replace(/[\s=-]/g, "").toUpperCase()]
    .map((c) => {
      const i = alphabet.indexOf(c);
      if (i < 0) fail("VRC_TOTP_SECRET の形式が正しくありません（英大文字と2〜7の数字だけのはず）。");
      return i.toString(2).padStart(5, "0");
    })
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const offset = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function login() {
  const basic = Buffer.from(`${encodeURIComponent(username.trim())}:${encodeURIComponent(password)}`).toString("base64");
  const first = await call("/auth/user", { headers: { Authorization: `Basic ${basic}` } });
  if (first.res.status === 401) fail(`VRChat にログインできませんでした: ${first.message}（ユーザー名・パスワードを確認してください）`);
  if (first.res.status === 429) fail("VRChat のログイン回数制限にかかりました。しばらく待ってから再度送信してください。");
  if (!first.res.ok) fail(`VRChat にログインできませんでした: ${first.message}`);

  const methods = first.json?.requiresTwoFactorAuth ?? [];
  if (!methods.length) return;
  if (!methods.includes("totp")) {
    fail("サブアカウントの2段階認証が認証アプリ方式になっていません（メール認証では自動ログインできません）。");
  }
  const verify = await call("/auth/twofactorauth/totp/verify", { method: "POST", body: JSON.stringify({ code: totp(totpSecret) }) });
  if (!verify.res.ok || !verify.json?.verified) {
    fail(`2段階認証に失敗しました: ${verify.message}（VRC_TOTP_SECRET を確認してください）`);
  }
}

async function logout() {
  await call("/logout", { method: "PUT" }).catch(() => {});
}

/* ---------- 実行 ---------- */

await login();
const created = await call(path, { method: "POST", body: JSON.stringify(body) });
await logout();

if (created.res.status === 403) {
  fail(`VRChat API 403: ${created.message}（サブアカウントのグループ内の権限を確認してください）`);
}
if (!created.res.ok) fail(`VRChat API ${created.res.status}: ${created.message}`);

console.log(`${p.kind === "event" ? "イベント" : "投稿"}を作成しました: id=${created.json.id}`);
