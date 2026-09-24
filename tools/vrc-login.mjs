// VRChat にログインして、Actions に登録する Cookie を表示する（手元で実行する）
//
//   node tools/vrc-login.mjs
//
// ユーザー名・パスワード・2段階認証コードを対話式で入力する。パスワードは画面に表示されず、どこにも保存しない。
// 表示された Cookie をリポジトリのシークレット VRC_COOKIE に登録する。
// ログインするたびにセッションを消費するので、Cookie が切れたときだけ実行すること。

import { createInterface } from "node:readline";

const API = "https://api.vrchat.cloud/api/1";
const USER_AGENT = "VRCEventPostRegister/1.0 (https://github.com/Nao-Shirotsu/VRCEventPostRegister)";

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // 入力中の文字を表示しない（質問文だけ書き出す）
    if (hidden) rl._writeToOutput = (s) => s.includes(question) && rl.output.write(s);
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

const cookies = new Map();
function keepCookies(res) {
  for (const c of res.headers.getSetCookie()) {
    const [pair, ...attrs] = c.split(";");
    const [name, value] = pair.split("=");
    const maxAge = attrs.find((a) => a.trim().toLowerCase().startsWith("max-age="));
    cookies.set(name.trim(), { value, maxAge: maxAge ? Number(maxAge.split("=")[1]) : null });
  }
}
const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v.value}`).join("; ");

async function call(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "User-Agent": USER_AGENT, Cookie: cookieHeader(), ...init.headers },
  });
  keepCookies(res);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    console.error(`VRChat API ${res.status}: ${json?.error?.message ?? "エラー"}`);
    process.exit(1);
  }
  return json;
}

const username = await ask("VRChat ユーザー名またはメールアドレス: ");
const password = await ask("パスワード（表示されません）: ", { hidden: true });

// 1. ID・パスワードでログイン
const basic = Buffer.from(`${encodeURIComponent(username)}:${encodeURIComponent(password)}`).toString("base64");
let user = await call("/auth/user", { headers: { Authorization: `Basic ${basic}` } });

// 2. 2段階認証
const methods = user.requiresTwoFactorAuth ?? [];
if (methods.length) {
  const kind = methods.includes("totp") ? "totp" : methods.includes("emailOtp") ? "emailotp" : "otp";
  const label = { totp: "認証アプリの6桁コード", emailotp: "メールで届いた6桁コード", otp: "リカバリーコード" }[kind];
  const code = await ask(`${label}: `);
  const result = await call(`/auth/twofactorauth/${kind}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!result.verified) {
    console.error("2段階認証に失敗しました。");
    process.exit(1);
  }
  user = await call("/auth/user");
}

const auth = cookies.get("auth");
if (!auth) {
  console.error("auth Cookie を受け取れませんでした。");
  process.exit(1);
}
console.log(`\n${user.displayName} としてログインしました。`);
if (auth.maxAge) console.log(`Cookie の有効期限: 約${Math.round(auth.maxAge / 86400)}日`);
console.log("\n次の1行を、リポジトリのシークレット VRC_COOKIE に登録してください:\n");
console.log(cookieHeader());
