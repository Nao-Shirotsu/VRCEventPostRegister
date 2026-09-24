/**
 * 画像アップロード受付（Google Apps Script のウェブアプリ）
 *
 * サイトから届いた画像を Google ドライブのフォルダーに保存し、「リンクを知っている全員が閲覧可」にして、
 * Buffer が投稿時刻に取りに行ける画像の URL を返す。
 *
 * 受け付けるのは、サイトの解錠に使う GitHub トークンでこのリポジトリに書き込み権限があると確認できたときだけ。
 *
 * 設定: FOLDER_ID を保存先フォルダーの ID（フォルダーの URL の /folders/ の後ろ）に書き換える。
 * デプロイ: 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」、
 *           実行ユーザー「自分」、アクセスできるユーザー「全員」。
 */

const FOLDER_ID = "ここに保存先フォルダーの ID";
const REPO = "Nao-Shirotsu/VRCEventPostRegister";
const MAX_IMAGES = 4;
const MAX_BYTES = 5 * 1024 * 1024; // X の画像の上限
const TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (!hasRepoAccess(req.token)) return reply({ ok: false, error: "GitHub トークンを確認できませんでした。" });

    const images = req.images || [];
    if (!images.length || images.length > MAX_IMAGES) return reply({ ok: false, error: `画像は1〜${MAX_IMAGES}枚にしてください。` });

    const folder = DriveApp.getFolderById(FOLDER_ID);
    const stamp = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyyMMdd-HHmmss");
    const urls = images.map((img, i) => {
      if (TYPES.indexOf(img.mimeType) < 0) throw new Error(`対応していない形式です: ${img.name}`);
      const bytes = Utilities.base64Decode(img.data);
      if (bytes.length > MAX_BYTES) throw new Error(`5MB を超えています: ${img.name}`);
      const file = folder.createFile(Utilities.newBlob(bytes, img.mimeType, `${stamp}-${i + 1}-${img.name}`));
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      return `https://drive.usercontent.google.com/download?id=${file.getId()}&export=view`;
    });
    return reply({ ok: true, urls });
  } catch (err) {
    return reply({ ok: false, error: String(err.message || err) });
  }
}

// トークンの持ち主がこのリポジトリに書き込めるか（＝サイトを使ってよい人か）を GitHub に確認する
function hasRepoAccess(token) {
  if (!token) return false;
  const res = UrlFetchApp.fetch(`https://api.github.com/repos/${REPO}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) return false;
  const perms = JSON.parse(res.getContentText()).permissions || {};
  return Boolean(perms.push || perms.admin);
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
