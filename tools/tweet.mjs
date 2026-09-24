// Buffer 経由で X に投稿する最小のコマンド
//
//   BUFFER_API_KEY=xxx node tools/tweet.mjs "投稿文"                      # すぐ投稿
//   BUFFER_API_KEY=xxx node tools/tweet.mjs "投稿文" "2026-10-01 21:00"   # 日本時間で予約
//
// X のチャンネルが複数あるときは BUFFER_CHANNEL にチャンネル名か ID を指定する（未指定なら一覧を出して止まる）

const [text, when] = process.argv.slice(2);
const KEY = process.env.BUFFER_API_KEY;
if (!text || !KEY) {
  console.error('使い方: BUFFER_API_KEY=xxx node tools/tweet.mjs "投稿文" ["2026-10-01 21:00"]');
  process.exit(1);
}

async function gql(query) {
  const res = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((e) => e.message).join(" / "));
  return json.data;
}

const { account } = await gql(`query { account { organizations { id } } }`);
const { channels } = await gql(
  `query { channels(input: { organizationId: ${JSON.stringify(account.organizations[0].id)} }) { id name service } }`,
);
const xs = channels.filter((c) => c.service === "twitter");
const want = process.env.BUFFER_CHANNEL;
const x = want ? xs.find((c) => c.id === want || c.name === want) : xs.length === 1 ? xs[0] : null;
if (!x) {
  console.error(
    xs.length === 0 ? "X のチャンネルが Buffer に接続されていません。"
    : want ? `X チャンネル "${want}" が見つかりません。`
    : "X のチャンネルが複数あるので BUFFER_CHANNEL で指定してください。",
  );
  for (const c of xs) console.error(`  ${c.name}	${c.id}`);
  process.exit(1);
}

const schedule = when
  ? `mode: customScheduled, dueAt: ${JSON.stringify(new Date(`${when.replace(" ", "T")}:00+09:00`).toISOString())}`
  : `mode: shareNow`;

const { createPost } = await gql(`
  mutation {
    createPost(input: { text: ${JSON.stringify(text)}, channelId: ${JSON.stringify(x.id)}, schedulingType: automatic, ${schedule} }) {
      ... on PostActionSuccess { post { id dueAt } }
      ... on MutationError { message }
    }
  }
`);
if (createPost.message) throw new Error(createPost.message);
console.log(when ? "予約しました:" : "投稿しました:", createPost.post);
