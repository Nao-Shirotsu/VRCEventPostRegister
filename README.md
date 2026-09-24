# VRCEventPostRegister

イベント告知を3か所の送信先へ POST する静的サイト。GitHub Pages などにそのまま置ける。

```
index.html / style.css
assets/config.js       送信先の設定（POST先・掲載確認ページ）。手で編集する
assets/passphrases.js  合言葉のハッシュ（tools/passphrase.mjs が生成）
assets/app.js          画面の動作（ゲート・確認ダイアログ・送信・結果表示）
tools/passphrase.mjs   合言葉の発行
```

## 合言葉

- `assets/passphrases.js` には合言葉の **PBKDF2 ハッシュ（ソルト付き・25万回）だけ** を置く。合言葉そのものはソースに残らない。
- 入力された合言葉をブラウザで同じ手順でハッシュし、一致したときだけフォームと送信ボタンを使えるようにする。
- ハッシュごとに有効日（JST）を付けられる。日替わり合言葉を1か月分まとめて発行しておけば、月1回の更新で毎日変わる合言葉を運用できる。

```sh
node tools/passphrase.mjs --daily 30 --start 2026-10-01          # 日替わり30日分
node tools/passphrase.mjs --pass "管理者用の合言葉" --daily 30     # 固定 + 日替わり
```

発行した合言葉は標準出力にだけ表示されるので控えておく。実行するたびにそれまでの合言葉は無効になる。
生成された `assets/passphrases.js` をコミットする。

> 静的サイトなので、これは画面上の制限にとどまる。POST 先に直接送ることまでは防げない。

## 送信結果の表示

| 表示 | 条件 |
| --- | --- |
| 送信成功 | CORS 対応の送信先が 2xx を返した |
| 送信失敗 | 通信エラー・2xx 以外・JSON で `{ "ok": false, "error": "..." }` が返った |
| 送信済み・結果不明 | `mode: "no-cors"` の送信先（Google フォームなど）。届いたかは掲載ページで確認する |

どの結果でも、`checkUrl` に設定した掲載ページへのリンクを出す。

## 送信先の設定（assets/config.js）

- `url` が `mock:ok` / `mock:fail` / `mock:opaque` の場合は通信せずに、それぞれ成功・失敗・結果不明を模擬する。
- 詳細は `assets/config.js` 冒頭のコメントを参照。
