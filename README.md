# VRCEventPostRegister

イベント告知を3か所の送信先へ POST する静的サイト。GitHub Pages などにそのまま置ける。

```
index.html / style.css
assets/app.js       画面の動作（ゲート・確認ダイアログ・送信）
assets/vault.js     暗号化済みの送信先設定（tools/seal.mjs が生成）
tools/seal.mjs      合言葉の発行と vault.js の生成
tools/destinations.example.json   送信先設定の雛形
```

## 合言葉の仕組み

- 送信先の URL・トークンを **合言葉から作った鍵で暗号化** して `assets/vault.js` に置く（PBKDF2-SHA256 25万回 + AES-GCM）。
- 正しい合言葉で復号できたときだけ解錠する。サーバーも外部サービスも不要で、公開リポジトリに置いても送信先は読めない。
- 1つの vault に複数の「スロット」を持てる。各スロットに有効日（JST）を付けられるので、**日替わり合言葉を1か月分まとめて発行** しておけば、月1回の更新だけで毎日変わる合言葉を運用できる。

### 発行手順

```sh
cp tools/destinations.example.json tools/destinations.json   # 実際のURLを書く（.gitignore 済み）
node tools/seal.mjs --daily 30 --start 2026-10-01             # 日替わり30日分
node tools/seal.mjs --pass "管理者用の合言葉" --daily 30        # 固定 + 日替わり
```

表示された合言葉の一覧を控え、毎日配布する。生成された `assets/vault.js` をコミットする。

### 限界

合言葉ゲートは「送信先を知らない人に使わせない」ための仕組みで、ブラウザ側の対策にとどまる。
送信先 URL を一度知った人は、合言葉なしで直接 POST できる。本当に止めたい場合は、
受け側（GAS など）で `destinations.json` の `token` を照合する（app.js が `token` を POST に付けて送る）。

## 送信先の設定

```json
{ "destinations": {
  "a": { "name": "表示名", "url": "https://...", "mode": "cors", "token": "任意" }
} }
```

- `url` が `mock:` で始まる場合は通信せずに成功扱いにする（開発用）。
- Google フォームなど CORS 非対応の送信先は `"mode": "no-cors"`（送信結果は確認できない）。
