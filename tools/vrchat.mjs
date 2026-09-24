// VRChat グループにイベントまたは投稿を登録する（.github/workflows/vrchat.yml から実行される）
//
// 入力は workflow_dispatch の payload（JSON 文字列）をイベントファイルから直接読む（ログに出さないため）。
//   kind: "event"  グループのカレンダーにイベントを作る
//   kind: "post"   グループに投稿（アナウンス）する
//
// 環境変数
//   VRC_COOKIE         tools/vrc-login.mjs で取得した Cookie（リポジトリのシークレット）
//   GITHUB_EVENT_PATH  Actions が自動で設定する

import { readFile } from "node:fs/promises";

const API = "https://api.vrchat.cloud/api/1";
const USER_AGENT = "VRCEventPostRegister/1.0 (https://github.com/Nao-Shirotsu/VRCEventPostRegister)";

// ::error:: で出したメッセージは、サイト側で失敗理由として表示される
function fail(message) {
  console.log(`::error::${message}`);
  process.exit(1);
}

const cookie = process.env.VRC_COOKIE?.trim();
if (!cookie) fail("シークレット VRC_COOKIE が設定されていません。");

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

const res = await fetch(`${API}${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT, Cookie: cookie },
  body: JSON.stringify(body),
});
const json = await res.json().catch(() => null);

if (res.status === 401) {
  fail("VRChat のログインが切れています。node tools/vrc-login.mjs で再ログインし、シークレット VRC_COOKIE を更新してください。");
}
if (res.status === 403) {
  fail(`VRChat API 403: ${json?.error?.message ?? "権限がありません"}（サブアカウントのグループ内の権限を確認してください）`);
}
if (!res.ok) fail(`VRChat API ${res.status}: ${json?.error?.message ?? "エラー"}`);

console.log(`${p.kind === "event" ? "イベント" : "投稿"}を作成しました: id=${json.id}`);
