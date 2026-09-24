// 送信先の設定。手で編集する。
//
//   name      画面に出す送信先名
//   url       POST 先
//   mode      "cors"（既定）: 送信結果を確認できる。受け側が CORS に対応している必要がある
//             "no-cors"      : Google フォームなど CORS 非対応の送信先用。結果は確認できない
//   github    url の代わりに GitHub Actions のワークフローを起動する（X への予約投稿用）
//               repo / workflow / ref。解錠時のトークン確認にもこの repo / workflow を使う
//   mock      通信せずに結果を模擬する（開発用）。本番では行ごと消す
//               "ok"      成功
//               "fail"    失敗
//               "opaque"  送信はしたが結果が分からない（no-cors の再現）
//   verb      確認ダイアログの動詞（既定: "送信"）。例: "予約投稿を登録" →「X に予約投稿を登録しますか？」
//   checkUrl  送信後に掲載を確認するページ
window.APP_CONFIG = {
  destinations: {
    // GitHub Actions（.github/workflows/buffer-post.yml）経由で Buffer に X の予約投稿を登録する
    x: {
      name: "X",
      github: {
        repo: "Nao-Shirotsu/VRCEventPostRegister",
        workflow: "buffer-post.yml",
        ref: "main",
      },
      verb: "予約投稿を登録",
      checkUrl: "https://publish.buffer.com/",
    },
    b: {
      name: "送信先 B",
      url: "https://example.com/mock-b/api",
      mock: "ok",
      checkUrl: "https://example.com/mock-b/calendar",
    },
    c: {
      name: "送信先 C",
      url: "https://example.com/mock-c/form",
      mode: "no-cors",
      mock: "opaque",
      checkUrl: "https://example.com/mock-c/list",
    },
  },
};
