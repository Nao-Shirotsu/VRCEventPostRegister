# VRCEventPostRegister

イベント告知を3か所の送信先へ登録する静的サイト。GitHub Pages にそのまま置ける。サーバーは使わない。

```
index.html / style.css
assets/config.js                    送信先の設定。手で編集する
assets/app.js                       画面の動作（ゲート・確認ダイアログ・送信・結果表示）
tools/buffer-post.mjs               Buffer に X の予約投稿を登録する（Actions から実行）
.github/workflows/buffer-post.yml   サイトから起動されるワークフロー（X / Buffer）
gas/upload.gs                       画像アップロード受付（Google Apps Script に貼って使う）
gas/approve-login.gs                VRChat の新しい場所からのログインを自動承認する（Google Apps Script に貼って使う）
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

### X の画像添付（GAS → Google ドライブ）

Buffer は画像を「公開 URL」で受け取り、投稿時刻に取りに行く。サイトでドロップされた画像は
Google Apps Script（`gas/upload.gs`）経由で Google ドライブに保存し、その URL を Buffer に渡す。
GAS は GitHub トークンの持ち主がこのリポジトリに書き込めることを確認してから受け付ける。

1. 保存先のフォルダーを Google ドライブに作る
2. https://script.google.com で新しいプロジェクトを作り、`gas/upload.gs` の中身を貼る。`FOLDER_ID` を書き換える
3. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」、実行ユーザー「自分」、アクセスできるユーザー「全員」
4. 表示されたウェブアプリの URL を `assets/config.js` の `imageUploadUrl` に書く

投稿時刻より前に、ドライブの画像を消したり共有を外したりしないこと。

## VRChat グループイベント・グループ投稿（GitHub Actions → VRChat API）

VRChat API もブラウザから直接呼べないため、X と同じく Actions 経由で作成する。

- VRChat のログイン Cookie は発行元の IP に結びつき、実行ごとに IP が変わる Actions では使い回せない。
  そのため実行ごとに「ログイン → 2段階認証 → 作成 → ログアウト」を行う。ログアウトするのでセッションは残らない。
- ログイン情報はシークレットにだけ置く。グループのカレンダー・投稿の権限だけを持つサブアカウントを使う。

### 初期設定

1. サブアカウントの2段階認証を **認証アプリ方式** にする。設定時に「キーを手入力」で表示される秘密鍵を控える
   （メール認証のままだと、Actions からのログインのたびにメールの確認コードを求められて止まる）
2. Repository secrets に次の3つを登録する

   | 名前 | 値 |
   | --- | --- |
   | `VRC_USERNAME` | サブアカウントのユーザー名 |
   | `VRC_PASSWORD` | サブアカウントのパスワード |
   | `VRC_TOTP_SECRET` | 手順1の秘密鍵（空白はあってもよい） |

3. 対象グループは `assets/config.js` の `VRC_GROUP_ID` で指定する

### 新しい場所からのログインの自動承認（GAS → Gmail）

Actions は実行ごとに IP が変わるため、VRChat が「新しい場所からのログイン」としてログインを止め、承認メールを送ってくる。
`tools/vrchat.mjs` はこのとき GAS（`gas/approve-login.gs`）を呼び、GAS が Gmail に届いた承認メールのリンクを開いて承認する。
その後ログインを1回だけやり直す。メールを最長2分待ち、見つからなければ失敗として止まる。

```
Actions ──ログイン──▶ VRChat（401: 新しい場所）──承認メール──▶ Gmail
   │                                                          ▲
   └──▶ GAS（approve-login.gs）── リンクを開く ◀── メールを探す ┘
```

1. サブアカウントの VRChat のメールが届く Google アカウントで、https://script.google.com に新しいプロジェクトを作り、
   `gas/approve-login.gs` の中身を貼る（`upload.gs` とは別のプロジェクトにする）
2. 「プロジェクトの設定」→「スクリプト プロパティ」に `APPROVE_SECRET`（長いランダムな文字列）を追加する
3. エディタで `testApprove` を実行し（初回は Gmail の権限を許可する）、ログに承認メールのリンクが出ることを確認する。
   出ないときはメールの送信元とリンクに合わせて `SENDER` / `LINK_RE` を直す
4. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」、実行ユーザー「自分」、アクセスできるユーザー「全員」
5. Repository secrets に次の2つを登録する

   | 名前 | 値 |
   | --- | --- |
   | `VRC_APPROVE_URL` | 手順4のウェブアプリの URL |
   | `VRC_APPROVE_SECRET` | 手順2の `APPROVE_SECRET` と同じ値 |

シークレットが無ければ自動承認はせず、今までどおりメールのリンクを開くよう表示して止まる。

自動承認にすると、新しい場所からのログインを確認する仕組みは実質働かなくなる。ただしログインには引き続きパスワードと
2段階認証が必要で、GAS が承認するのは Actions が依頼した時刻より後に届いた未読のメールだけ。

## 送信結果の表示

| 表示 | 条件 |
| --- | --- |
| 送信成功 | 送信先が 2xx を返した / ワークフローが成功した |
| 送信失敗 | 通信エラー・2xx 以外・JSON で `{ "ok": false, "error": "..." }` が返った / ワークフローが失敗した |
| 送信済み・結果不明 | `mode: "no-cors"` の送信先（Google フォームなど）/ ワークフローが5分以内に終わらなかった |

どの結果でも、`checkUrl` に設定した掲載ページへのリンクを出す。

## 送信先の設定（assets/config.js）

- `mock: "ok"` / `"fail"` / `"opaque"` を付けた送信先は通信せずに、それぞれ成功・失敗・結果不明を模擬する。
- 詳細は `assets/config.js` 冒頭のコメントを参照。
