/**
 * VRChat の「新しい場所からのログイン」自動承認（Google Apps Script のウェブアプリ）
 *
 * Actions は実行ごとに IP が変わるため、VRChat がログインを止めて承認メールを送ってくる。
 * tools/vrchat.mjs から呼ばれたら、それ以降に届いた承認メールを Gmail から探し、メール内のリンクを開いて承認する。
 * 承認するのは「依頼された時刻（since）より後に届いた、未読の」メールだけ。使ったメールは既読にしてラベルを付ける。
 *
 * サブアカウントの VRChat のメールが届く Google アカウントで作ること。画像アップロード（upload.gs）とは別のプロジェクトにする。
 *
 * 設定: 「プロジェクトの設定」→「スクリプト プロパティ」に APPROVE_SECRET（長いランダムな文字列）を追加する。
 *       同じ値をリポジトリのシークレット VRC_APPROVE_SECRET に登録する。
 *       届いたメールに合わせて、必要なら SENDER / LINK_RE を書き換える（testApprove で確認できる）。
 * デプロイ: 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」、
 *           実行ユーザー「自分」、アクセスできるユーザー「全員」。URL をシークレット VRC_APPROVE_URL に登録する。
 */

const SENDER = "vrchat.com"; // Gmail の from: に使う
const LINK_RE = /https:\/\/[^\s"'<>]+/g;
const ALLOWED_HOST = /^https:\/\/([a-z0-9-]+\.)*vrchat\.(com|cloud)\//;
const LABEL = "VRChat 自動承認済み";

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const secret = PropertiesService.getScriptProperties().getProperty("APPROVE_SECRET");
    if (!secret || req.secret !== secret) return reply({ ok: false, error: "APPROVE_SECRET が一致しません。" });
    const since = Number(req.since);
    if (!since) return reply({ ok: false, error: "since がありません。" });
    return reply(approve(since, false));
  } catch (err) {
    return reply({ ok: false, error: String(err.message || err) });
  }
}

/**
 * since（ミリ秒）以降に届いた未読の承認メールを探してリンクを開く。
 * dryRun のときは開かず、見つけたリンクを返すだけにする。
 */
function approve(since, dryRun) {
  const threads = GmailApp.search(`from:${SENDER} after:${Math.floor(since / 1000)}`);
  const messages = threads
    .flatMap((t) => t.getMessages())
    .filter((m) => m.getDate().getTime() >= since && (dryRun || m.isUnread()))
    .sort((a, b) => b.getDate() - a.getDate());

  for (const message of messages) {
    const link = findLink(message.getBody());
    if (!link) continue;
    if (dryRun) return { ok: true, dryRun: true, subject: message.getSubject(), link };

    const res = UrlFetchApp.fetch(link, { followRedirects: false, muteHttpExceptions: true });
    const status = res.getResponseCode();
    message.markRead();
    message.getThread().addLabel(GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL));
    if (status >= 400) return { ok: false, error: `承認リンクが HTTP ${status} を返しました。` };
    return { ok: true, status };
  }
  return { ok: false, pending: true };
}

// メール本文（HTML）から承認リンクを取り出す。verifyLoginPlace を含むものを優先し、なければ token= を含むもの
function findLink(html) {
  const links = (html.match(LINK_RE) || [])
    .map((u) => u.replace(/&amp;/g, "&"))
    .filter((u) => ALLOWED_HOST.test(u));
  return links.find((u) => u.includes("verifyLoginPlace")) || links.find((u) => u.includes("token=")) || null;
}

// エディタから実行して、直近7日の承認メールからリンクを取り出せるか確認する（リンクは開かない）
function testApprove() {
  Logger.log(JSON.stringify(approve(Date.now() - 7 * 24 * 60 * 60 * 1000, true)));
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
