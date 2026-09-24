// Buffer API で X に予約投稿を1件作る（.github/workflows/buffer-post.yml から実行される）
//
// 投稿文と日時は workflow_dispatch の入力から読む。環境変数で渡すとログに表示されてしまい、
// 公開リポジトリでは告知前の文面が見えてしまうため、イベントのペイロードファイルから直接読む。
// ログにも投稿文は出さない。
//
// 環境変数
//   BUFFER_API_KEY     Buffer の API キー（リポジトリのシークレット）
//   BUFFER_CHANNEL_ID  X チャンネルの ID。X のチャンネルが1つだけなら省略できる（複数あるときは必須）
//   GITHUB_EVENT_PATH  Actions が自動で設定する

import { readFile } from "node:fs/promises";

const API = "https://api.buffer.com";
const KEY = process.env.BUFFER_API_KEY;

// ::error:: で出したメッセージは、サイト側で失敗理由として表示される
function fail(message) {
  console.log(`::error::${message}`);
  process.exit(1);
}

async function gql(query) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({ query }),
  });
  const json = await res.json().catch(() => null);
  if (!json) fail(`Buffer API が HTTP ${res.status} を返しました。`);
  if (json.errors) fail(`Buffer API: ${json.errors.map((e) => e.message).join(" / ")}`);
  return json.data;
}

async function findXChannelId() {
  // シークレット登録時に紛れ込みやすい前後の空白・改行は取り除く
  const configured = process.env.BUFFER_CHANNEL_ID?.trim();
  if (configured) return configured;

  // 1. 組織IDを取得
  const { account } = await gql(`query { account { organizations { id name } } }`);
  const orgId = account.organizations[0]?.id;
  if (!orgId) fail("Buffer の組織が見つかりません。");

  // 2. X（twitter）のチャンネルIDを取得
  const { channels } = await gql(`
    query { channels(input: { organizationId: ${JSON.stringify(orgId)} }) { id name service } }
  `);
  const xs = channels.filter((c) => c.service === "twitter");
  if (xs.length === 0) fail("X のチャンネルが Buffer に接続されていません。");
  // 複数あるときに勝手に選ぶと本番アカウントに投稿しかねないので止める
  if (xs.length > 1) fail(`X のチャンネルが複数あります。変数 BUFFER_CHANNEL_ID で指定してください: ${xs.map((c) => `${c.name}=${c.id}`).join(", ")}`);
  return xs[0].id;
}

if (!KEY) fail("シークレット BUFFER_API_KEY が設定されていません。");

const { inputs } = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
const text = String(inputs?.text ?? "").trim();
const dueAt = new Date(inputs?.due_at);
if (!text) fail("投稿文が空です。");
if (Number.isNaN(dueAt.getTime())) fail("投稿日時が正しくありません。");
if (dueAt <= new Date()) fail("投稿日時が過去になっています。");

const channelId = await findXChannelId();

// 3. 日時指定で予約投稿を作成（文字列は JSON.stringify で GraphQL の文字列リテラルとしてエスケープする）
const { createPost } = await gql(`
  mutation {
    createPost(input: {
      text: ${JSON.stringify(text)},
      channelId: ${JSON.stringify(channelId)},
      schedulingType: automatic,
      mode: customScheduled,
      dueAt: ${JSON.stringify(dueAt.toISOString())}
    }) {
      ... on PostActionSuccess { post { id dueAt } }
      ... on MutationError { message }
    }
  }
`);
if (createPost.message) fail(`Buffer: ${createPost.message}`);

console.log(`予約しました: id=${createPost.post.id} dueAt=${createPost.post.dueAt}`);
