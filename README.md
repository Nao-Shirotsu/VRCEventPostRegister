# VRCEventPostRegister

イベント告知を3か所の送信先へ登録する静的サイト。GitHub Pages にそのまま置ける。サーバーは使わない。

```
index.html / style.css
assets/config.js                    送信先の設定。手で編集する
assets/app.js                       画面の動作（ゲート・確認ダイアログ・送信・結果表示）
tools/buffer-post.mjs               Buffer に X の予約投稿を登録する（Actions から実行）
.github/workflows/buffer-post.yml   サイトから起動されるワークフロー（X / Buffer）
tools/vrc-login.mjs                 VRChat にログインして Cookie を表示する（手元で実行）
tools/vrchat.mjs                    VRChat グループにイベント・投稿を登録する（Actions から実行）
.github/workflows/vrchat.yml        サイトから起動されるワークフロー（VRChat）
```

## GitHub トークンでの解錠

- 画面上部に GitHub トークンを入力し、このリポジトリのワークフローを扱えることを GitHub に確認できたら解錠する。
- トークンはサイトのファイルには置かない。「この端末に記憶する」を選んだときだけブラウザ（localStorage）に保存する。
- 「ロック」を押すと、記憶したトークンも消える。

## X への予約投稿（GitHub Actions → Buffer）

Buffer API は buffer.com 以外のサイトからブラウザで直接呼べない（CORS）。
GitHub API はブラウザから呼べるので、サイトからワークフローを起動し、Actions 上で Buffer に登録する。

```
ブラウザ ──▶ GitHub API（ワークフロー起動）──▶ GitHub Actions ──▶ Buffer API ──▶ X
```

- Buffer の API キーはリポジトリのシークレットにだけ置く。サイトからは見えない。
- 投稿文と日時はログに出さない（公開リポジトリのログは誰でも見られるため）。
- サイトは実行の完了を待って（数十秒）、成功・失敗を表示する。失敗時は Buffer が返した理由と実行ログへのリンクを出す。

### 初期設定

1. **Buffer の API キーを登録**
   リポジトリの Settings → Secrets and variables → Actions → Secrets に `BUFFER_API_KEY` を追加する。
   Buffer に X のチャンネルが複数あるときは、Variables に投稿先の `BUFFER_CHANNEL_ID` を追加する（必須）。
   ID は `node tools/tweet.mjs` を BUFFER_CHANNEL なしで実行すると一覧で表示される。

2. **GitHub トークンを作成**
   Settings（個人）→ Developer settings → Fine-grained personal access tokens → Generate new token
   - Repository access: **Only select repositories** → このリポジトリだけ
   - Permissions: **Actions: Read and write** だけ（Metadata: Read は自動で付く）
   - 有効期限が切れたら作り直して、サイトに入力し直す

3. **サイトで解錠**
   公開したサイトを開き、画面上部にトークンを入力する。

## VRChat グループイベント・グループ投稿（GitHub Actions → VRChat API）

VRChat API もブラウザから直接呼べないため、X と同じく Actions 経由で作成する。

- ログインは手元で1回だけ行い、発行された Cookie をシークレット `VRC_COOKIE` に登録する。パスワードはどこにも保存しない。
  VRChat は ID・パスワードでのログインごとにセッションを消費し、その数に上限があるため、毎回ログインはしない。
- Cookie が切れると、サイトに「VRChat のログインが切れています」と表示される。そのときだけ再ログインする。
- グループのカレンダー管理権限だけを持つサブアカウントを使う。

### 初期設定

1. 対象グループは `assets/config.js` の `VRC_GROUP_ID` で指定する
2. 手元でログインして Cookie を取得する

   ```sh
   node tools/vrc-login.mjs
   ```

3. 表示された1行を Repository secrets の `VRC_COOKIE` に登録する

## 送信結果の表示

| 表示 | 条件 |
| --- | --- |
| 送信成功 | 送信先が 2xx を返した / ワークフローが成功した |
| 送信失敗 | 通信エラー・2xx 以外・JSON で `{ "ok": false, "error": "..." }` が返った / ワークフローが失敗した |
| 送信済み・結果不明 | `mode: "no-cors"` の送信先（Google フォームなど）/ ワークフローが3分以内に終わらなかった |

どの結果でも、`checkUrl` に設定した掲載ページへのリンクを出す。

## 送信先の設定（assets/config.js）

- `mock: "ok"` / `"fail"` / `"opaque"` を付けた送信先は通信せずに、それぞれ成功・失敗・結果不明を模擬する。
- 詳細は `assets/config.js` 冒頭のコメントを参照。
