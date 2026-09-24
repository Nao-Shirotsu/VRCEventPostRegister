// 送信先の設定。手で編集する。
//
//   name      画面に出す送信先名
//   subtitle  送信先名の下に出す説明（省略時は送信先の URL などを出す）
//   url       POST 先
//   mode      "cors"（既定）: 送信結果を確認できる。受け側が CORS に対応している必要がある
//             "no-cors"      : Google フォームなど CORS 非対応の送信先用。結果は確認できない
//   googleForm url の代わりに Google フォームへ回答を送る（id / entries）。結果は確認できない
//   github    url の代わりに GitHub Actions のワークフローを起動する
//               repo / workflow / ref。解錠時のトークン確認には最初の送信先の repo / workflow を使う
//               inputs(data)      フォームの内容 → ワークフローの入力
//               runningLabel      実行中に小さく出す文言
//               doneMessage(data) 成功時の文言
//   mock      通信せずに結果を模擬する（開発用）。本番では行ごと消す
//               "ok"      成功
//               "fail"    失敗
//               "opaque"  送信はしたが結果が分からない（no-cors の再現）
//   verb      確認ダイアログの動詞（既定: "送信"）。例: "予約投稿を登録" →「X に予約投稿を登録しますか？」
//   checkUrl  送信後に掲載を確認するページ
//   checkLabel checkUrl へのリンクの文言（既定: "掲載を確認"）
//   busyLabel 送信中に大きく出す文言（既定: "送信中…"）
//   doneLabel 成功時に大きく出す文言（省略時は出さない）
const VRC_GROUP_ID = "grp_2e72b9b6-f353-47a5-beb9-ba474c6ff1fd";

const jst = (iso) => new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" });

window.APP_CONFIG = {
  destinations: {
    // GitHub Actions（.github/workflows/buffer-post.yml）経由で Buffer に X の予約投稿を登録する
    x: {
      name: "X",
      subtitle: "3DCG作業会ベリープア 公式アカウント",
      github: {
        repo: "Nao-Shirotsu/VRCEventPostRegister",
        workflow: "buffer-post.yml",
        ref: "main",
        inputs: (d) => ({ text: d.get("text"), due_at: d.get("dueAt") }),
        runningLabel: "Buffer に送信中…",
        doneMessage: (d) => `${jst(d.get("dueAt"))} の予約投稿として Buffer に登録しました。`,
      },
      verb: "予約投稿を登録",
      busyLabel: "登録中…",
      doneLabel: "登録完了！！",
      checkUrl: "https://publish.buffer.com/channels/6ab4cbd9ea19ca0bded233c0/schedule",
      checkLabel: "Bufferで予約ポスト一覧を見る",
    },
    // GitHub Actions（.github/workflows/vrchat.yml）経由で VRChat グループのカレンダーにイベントを作る
    vrc: {
      name: "VRChat グループイベント",
      subtitle: "グループカレンダーにイベントを作成",
      github: {
        repo: "Nao-Shirotsu/VRCEventPostRegister",
        workflow: "vrchat.yml",
        ref: "main",
        inputs: (d) => ({
          payload: JSON.stringify({
            kind: "event",
            groupId: VRC_GROUP_ID,
            title: d.get("title"),
            description: d.get("description"),
            startsAt: d.get("startsAt"),
            endsAt: d.get("endsAt"),
            category: d.get("category"),
            accessType: d.get("accessType"),
            notify: d.has("notify"),
          }),
        }),
        runningLabel: "VRChat に送信中…",
        doneMessage: (d) => `${jst(d.get("startsAt"))} 開始のイベントを作成しました。`,
      },
      verb: "イベントを作成",
      busyLabel: "作成中…",
      doneLabel: "作成完了！！",
      checkUrl: `https://vrchat.com/home/group/${VRC_GROUP_ID}`,
      checkLabel: "VRChat でグループを見る",
    },
    // 同じワークフローで VRChat グループに投稿（アナウンス）する
    vrcPost: {
      name: "VRChat グループ投稿",
      subtitle: "グループのお知らせに投稿",
      github: {
        repo: "Nao-Shirotsu/VRCEventPostRegister",
        workflow: "vrchat.yml",
        ref: "main",
        inputs: (d) => ({
          payload: JSON.stringify({
            kind: "post",
            groupId: VRC_GROUP_ID,
            title: d.get("title"),
            text: d.get("text"),
            visibility: d.get("visibility"),
            notify: d.has("notify"),
          }),
        }),
        runningLabel: "VRChat に送信中…",
        doneMessage: () => "グループに投稿しました。",
      },
      verb: "投稿",
      busyLabel: "投稿中…",
      doneLabel: "投稿完了！！",
      checkUrl: `https://vrchat.com/home/group/${VRC_GROUP_ID}`,
      checkLabel: "VRChat でグループを見る",
    },
    // Google フォームに回答として送る。entries はフォームの項目名 → 質問の ID
    // （ID はフォームの公開ページの FB_PUBLIC_LOAD_DATA_ から取れる）
    // フォームのページを分けたら googleForm に pages: ページ数 を足す
    calendar: {
      name: "ワールド内イベントカレンダー",
      subtitle: "Google フォーム「ベリープアイベント登録フォーム」",
      googleForm: {
        id: "1FAIpQLSe290BzyPyNZVixWnaYGFg7YpvvcWRod8VGtXNE6Y9DgrFoBA",
        entries: { title: "183755029", description: "414836401", date: "2030900613", start: "2100967487" },
      },
      verb: "登録",
      checkUrl: "https://docs.google.com/forms/d/e/1FAIpQLSe290BzyPyNZVixWnaYGFg7YpvvcWRod8VGtXNE6Y9DgrFoBA/viewform",
      checkLabel: "フォームを開く",
    },
  },
};
