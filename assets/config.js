// 送信先の設定。手で編集する。
//
//   name      画面に出す送信先名
//   url       POST 先。"mock:" で始まる場合は通信せずに結果を模擬する（開発用）
//               mock:ok      成功（HTTP 200）
//               mock:fail    失敗（HTTP 500）
//               mock:opaque  送信はしたが結果が分からない（no-cors の再現）
//   mode      "cors"（既定）: 送信結果を確認できる。受け側が CORS に対応している必要がある
//             "no-cors"      : Google フォームなど CORS 非対応の送信先用。結果は確認できない
//   checkUrl  送信後に掲載を確認するページ
window.APP_CONFIG = {
  destinations: {
    a: {
      name: "送信先 A",
      url: "mock:ok",
      checkUrl: "https://example.com/mock-a/events",
    },
    b: {
      name: "送信先 B",
      url: "mock:ok",
      checkUrl: "https://example.com/mock-b/calendar",
    },
    c: {
      name: "送信先 C",
      url: "mock:opaque",
      mode: "no-cors",
      checkUrl: "https://example.com/mock-c/list",
    },
  },
};
