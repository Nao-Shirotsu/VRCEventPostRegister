"use strict";

/*
 * トークンゲート
 * -------------
 * 入力された GitHub トークンでワークフローを参照できたら解錠する。
 * トークンはサイトのファイルには置かない。「この端末に記憶する」を選んだときだけ localStorage に保存する。
 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const DESTINATIONS = window.APP_CONFIG.destinations;

const FIELD_LABELS = {
  title: "イベント名",
  date: "開催日",
  start: "開始",
  end: "終了",
  organizer: "主催者",
  genre: "ジャンル",
  access: "参加方法",
  description: "説明",
  text: "投稿文",
  dueAt: "投稿日時",
};
// 一括送信の確認ダイアログに出す項目（フォームにあるものだけ表示する）
const SUMMARY_FIELDS = ["title", "date", "start", "text", "dueAt"];

// 解錠中だけメモリに持つ GitHub トークン。ロックすると消す
let token = null;

const TOKEN_KEY = "github-token";
const GH = Object.values(DESTINATIONS).find((d) => d.github)?.github;

/** トークンがこのリポジトリのワークフローを扱えるか確認する。問題があれば理由を返す */
async function checkToken(candidate) {
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${GH.repo}/actions/workflows/${encodeURIComponent(GH.workflow)}`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${candidate}` },
    });
  } catch {
    return "GitHub に接続できませんでした。通信状況を確認してください。";
  }
  if (res.ok) return null;
  if (res.status === 401) return "トークンが無効か、期限切れです。";
  return `このトークンでは ${GH.repo} のワークフローを扱えません（HTTP ${res.status}）。権限を確認してください。`;
}

function storage(action, value) {
  // localStorage が使えない環境（プライベートブラウズ等）では記憶しないだけにする
  try {
    if (action === "get") return localStorage.getItem(TOKEN_KEY);
    if (action === "set") localStorage.setItem(TOKEN_KEY, value);
    if (action === "remove") localStorage.removeItem(TOKEN_KEY);
  } catch {}
  return null;
}

/* ---------- lock state ---------- */

function setLocked(locked) {
  if (locked) token = null;
  document.body.dataset.locked = String(locked);
  $$(".dest").forEach((card) => {
    card.inert = locked;
    $("fieldset", card).disabled = locked;
  });
  $("#bulk-send").disabled = locked;
  $("#gate-lock").hidden = locked;
  $("#gate-submit").hidden = !locked;
  $("#token").disabled = !locked;
  $("#remember").disabled = !locked;
}

function renderDestinations() {
  $$(".dest").forEach((card) => {
    const dest = DESTINATIONS[card.dataset.dest];
    $(".dest__name", card).textContent = dest.name;
    $("[data-host]", card).textContent = destLabel(dest);
    const check = $("[data-check]", card);
    if (dest.checkUrl) check.href = dest.checkUrl; else check.hidden = true;
  });
}

function destLabel(dest) {
  let label;
  if (dest.subtitle) {
    label = dest.subtitle;
  } else if (dest.github) {
    label = `GitHub Actions → ${dest.github.workflow}`;
  } else {
    try {
      const u = new URL(dest.url);
      label = u.host + u.pathname;
    } catch {
      label = dest.url;
    }
  }
  return dest.mock ? `${label}（テスト用・通信しません）` : label;
}

function setGateStatus(text, tone) {
  const el = $("#gate-status");
  el.textContent = text;
  if (tone) el.dataset.tone = tone; else delete el.dataset.tone;
}

async function unlock(candidate) {
  const btn = $("#gate-submit");
  btn.disabled = true;
  setGateStatus("確認しています…");
  try {
    const problem = await checkToken(candidate);
    if (problem) {
      setGateStatus(problem, "err");
      return false;
    }
    token = candidate;
    setLocked(false);
    setGateStatus("解錠しました。", "ok");
    return true;
  } finally {
    btn.disabled = false;
  }
}

async function onUnlock(ev) {
  ev.preventDefault();
  const input = $("#token");
  const candidate = input.value.trim();
  if (!candidate) return input.focus();
  if (!(await unlock(candidate))) return input.select();
  if ($("#remember").checked) storage("set", candidate);
  input.value = "";
  $(".dest input, .dest textarea")?.focus();
}

function onLock() {
  storage("remove");
  setLocked(true);
  setGateStatus("ロックしました。記憶していたトークンも消去しました。入力内容は残っています。");
  $("#token").focus();
}

/* ---------- confirm dialog ---------- */

function confirmDialog({ title, body, okLabel }) {
  const dlg = $("#confirm");
  $("#confirm-title").textContent = title;
  $("#confirm-body").replaceChildren(body);
  $("#confirm-ok").textContent = okLabel;
  dlg.returnValue = "";
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true });
  });
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null));
  return node;
}

function fieldList(form, keys) {
  const data = new FormData(form);
  const dl = el("dl");
  for (const key of keys?.filter((k) => data.has(k)) ?? data.keys()) {
    let value = String(data.get(key) ?? "").trim();
    if (key === "dueAt" && value) value = value.replace("T", " ");
    dl.append(el("dt", { textContent: FIELD_LABELS[key] ?? key }), el("dd", { textContent: value || "—" }));
  }
  return dl;
}

function destBlock(card, keys) {
  const dest = DESTINATIONS[card.dataset.dest];
  const state = $("[data-chip]", card).dataset.state;
  return el("div", { className: "confirm__dest" },
    el("p", { className: "confirm__dest-name" },
      dest.name,
      el("span", { className: "mono", textContent: destLabel(dest) }),
    ),
    fieldList($("form", card), keys),
    state === "ok" || state === "unknown"
      ? el("p", { className: "confirm__warn", textContent: "この送信先には送信済みです。もう一度送信されます。" })
      : null,
  );
}

/* ---------- sending ---------- */

/** 失敗理由を画面に出すためのエラー。link があれば詳細へのリンクも出す */
class SendError extends Error {
  constructor(message, link) {
    super(message);
    this.link = link;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const formatJST = (date) =>
  new Date(date).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" });

/**
 * 送信して結果を返す。失敗時は SendError を投げる。
 * @param {(text: string, link?: { href: string, text: string }) => void} progress 送信中の表示を更新する
 * @returns {Promise<{ state: "ok" | "unknown", detail: string, link?: { href: string, text: string } }>}
 */
async function post(dest, form, progress) {
  const data = new FormData(form);
  if (form.elements.dueAt) {
    // datetime-local は日本時間として扱い、UTC の ISO 8601 に直して送る
    data.set("dueAt", new Date(`${data.get("dueAt")}:00+09:00`).toISOString());
  }

  if (dest.mock) return mockPost(dest, data);
  if (dest.github) return dispatchWorkflow(dest.github, data, progress);

  let res;
  try {
    res = await fetch(dest.url, { method: "POST", body: data, mode: dest.mode ?? "cors" });
  } catch {
    // CORS で弾かれた場合も含むため、実際には届いていることがある
    throw new SendError("通信エラー — 届いていない可能性があります。掲載ページを確認してから再送してください。");
  }
  if (res.type === "opaque") return { state: "unknown", detail: "送信しましたが、この送信先は結果を返しません。" };

  // 受け側が JSON で { ok: false, error: "..." } を返した場合は、その理由を表示する
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.ok === false) {
    throw new SendError(`HTTP ${res.status} — ${body?.error ?? body?.message ?? "送信先がエラーを返しました。"}`);
  }
  return { state: "ok", detail: `HTTP ${res.status} — 受け付けられました。` };
}

async function mockPost(dest, data) {
  await sleep(600 + Math.random() * 600);
  console.info("[mock]", dest.name, Object.fromEntries(data));
  if (dest.mock === "fail") throw new SendError("HTTP 500 — 送信先がエラーを返しました。");
  if (dest.mock === "opaque") return { state: "unknown", detail: "送信しましたが、この送信先は結果を返しません。" };
  if (data.has("dueAt")) return { state: "ok", detail: `${formatJST(data.get("dueAt"))} の予約投稿として登録しました。` };
  return { state: "ok", detail: "HTTP 200 — 受け付けられました。" };
}

/* ---------- GitHub Actions ---------- */

const GITHUB_API = "https://api.github.com";
const RUN_TIMEOUT_MS = 3 * 60 * 1000;

async function github(path, init = {}) {
  if (!token) throw new SendError("ロックされています。GitHub トークンを入力してください。");
  let res;
  try {
    res = await fetch(`${GITHUB_API}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...init.headers,
      },
    });
  } catch {
    throw new SendError("GitHub に接続できませんでした。通信状況を確認してください。");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const hint = res.status === 401 ? "（トークンの期限切れかもしれません）"
      : res.status === 403 ? "（トークンの Actions 権限が Read and write になっているか確認してください）"
      : "";
    throw new SendError(`GitHub API ${res.status}: ${body?.message ?? "エラー"}${hint}`);
  }
  return res.status === 204 ? null : res.json();
}

/**
 * ワークフローを起動し、終わるまで待って結果を返す。
 * dispatch API は実行 ID を返さないため、run-name に埋めた request_id で自分の実行を探す。
 */
async function dispatchWorkflow({ repo, workflow, ref }, data, progress) {
  const requestId = crypto.randomUUID();
  const since = new Date(Date.now() - 60_000).toISOString();
  const base = `/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}`;

  progress("Actions 発行中…");
  await github(`${base}/dispatches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ref,
      inputs: { text: data.get("text"), due_at: data.get("dueAt"), request_id: requestId },
    }),
  });
  // 起動できた時点から、Actions の画面で進行状況を見られるようにする
  const actions = { href: `https://github.com/${repo}/actions`, text: "Actions で進行状況を見る ↗" };
  progress("Actions 実行待ち…", actions);

  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let run = null;
  while (Date.now() < deadline) {
    await sleep(run ? 4000 : 3000);
    if (!run) {
      const { workflow_runs: runs } = await github(`${base}/runs?event=workflow_dispatch&created=${encodeURIComponent(`>=${since}`)}&per_page=30`);
      run = runs.find((r) => r.display_title?.includes(requestId)) ?? null;
      if (!run) continue;
    } else {
      run = await github(`/repos/${repo}/actions/runs/${run.id}`);
    }
    progress(run.status === "in_progress" ? "Buffer に送信中…" : "Actions 実行待ち…", actions);
    if (run.status !== "completed") continue;

    const log = { href: run.html_url, text: "GitHub Actionsログ ↗" };
    if (run.conclusion === "success") {
      return { state: "ok", detail: `${formatJST(data.get("dueAt"))} の予約投稿として Buffer に登録しました。`, link: log };
    }
    throw new SendError(await failureReason(repo, run), log);
  }
  if (run) {
    return { state: "unknown", detail: "時間内に完了しませんでした。GitHub Actionsログで結果を確認してください。", link: { href: run.html_url, text: "GitHub Actionsログ ↗" } };
  }
  return { state: "unknown", detail: "起動は受け付けられましたが、実行が見つかりませんでした。Actions の画面で確認してください。",
    link: { href: `https://github.com/${repo}/actions/workflows/${workflow}`, text: "Actions ↗" } };
}

// tools/buffer-post.mjs が ::error:: で出したメッセージを、ジョブの注釈から取り出す
async function failureReason(repo, run) {
  try {
    const { jobs } = await github(`/repos/${repo}/actions/runs/${run.id}/jobs`);
    for (const job of jobs) {
      const notes = await github(new URL(`${job.check_run_url}/annotations`).pathname);
      const note = notes.find((a) => a.annotation_level === "failure" && !a.message.startsWith("Process completed"));
      if (note) return note.message;
    }
  } catch {
    // 理由が取れなくても失敗であることは表示する
  }
  return run.conclusion === "cancelled" ? "実行がキャンセルされました。" : "登録に失敗しました。";
}

/* ---------- result display ---------- */

const CHIP_TEXT = { ok: "送信成功", unknown: "送信済み・結果不明", err: "送信失敗" };

/**
 * 結果欄を更新する。
 * 送信中は見出し（busyLabel）を大きく、進み具合（detail）をその下に小さく出す。
 * 成功時に doneLabel があれば、それを大きく出してから詳細を添える。
 */
function showResult(card, state, detail, link) {
  const dest = DESTINATIONS[card.dataset.dest];
  const busyLabel = dest.busyLabel ?? "送信中…";
  const chip = $("[data-chip]", card);
  const time = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  chip.dataset.state = state;
  chip.textContent = state === "busy" ? busyLabel : `${CHIP_TEXT[state]} ${time}`;

  const result = $("[data-result]", card);
  result.dataset.state = state;
  result.replaceChildren();
  const anchor = (l) => el("a", { href: l.href, target: "_blank", rel: "noopener", textContent: l.text });

  if (state === "busy") {
    result.append(el("span", { className: "dest__headline", textContent: busyLabel }));
    if (detail || link) result.append(el("span", { className: "dest__step" }, detail ?? "", link ? " " : null, link ? anchor(link) : null));
    return;
  }
  if (state === "ok" && dest.doneLabel) result.append(el("span", { className: "dest__headline", textContent: dest.doneLabel }));
  const checkText = dest.checkLabel ?? (state === "ok" ? "掲載を確認" : "掲載ページで確認");
  const links = [link, dest.checkUrl && { href: dest.checkUrl, text: `${checkText} ↗` }].filter(Boolean);
  const line = el("span", { className: "dest__step" }, detail);
  for (const l of links) line.append(" ", anchor(l));
  result.append(line);
}

/* ---------- X の投稿文 ---------- */

const TWEET_LIMIT = 280;
const MIN_LEAD_MS = 5 * 60 * 1000;

// X の文字数の数え方（twitter-text v3）の簡易版: URL は23文字、CJK などは2文字として数える
function tweetLength(text) {
  const URL_RE = /https?:\/\/\S+/g;
  const urls = text.match(URL_RE) ?? [];
  let n = urls.length * 23;
  for (const ch of text.replace(URL_RE, "")) {
    const c = ch.codePointAt(0);
    const narrow = c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037);
    n += narrow ? 1 : 2;
  }
  return n;
}

function updateTweetCounter(textarea) {
  const counter = $("[data-counter]", textarea.closest(".field"));
  const n = tweetLength(textarea.value);
  counter.textContent = `${n} / ${TWEET_LIMIT}`;
  counter.toggleAttribute("data-over", n > TWEET_LIMIT);
  textarea.setCustomValidity(n > TWEET_LIMIT ? `X の上限（${TWEET_LIMIT}文字）を超えています。` : "");
}

/* ---------- submit ---------- */

function validate(card) {
  const form = $("form", card);
  const due = form.elements.dueAt;
  if (due) {
    // Actions の起動に1分ほどかかるため、余裕を見て5分後以降に限る
    const tooSoon = due.value && new Date(`${due.value}:00+09:00`) < new Date(Date.now() + MIN_LEAD_MS);
    due.setCustomValidity(tooSoon ? "投稿日時は今から5分後以降にしてください。" : "");
  }
  form.classList.add("was-checked");
  return form.checkValidity();
}

async function sendCard(card) {
  const btn = $(".dest__actions .btn", card);
  btn.disabled = true;
  showResult(card, "busy");
  try {
    const progress = (text, link) => showResult(card, "busy", text, link);
    const { state, detail, link } = await post(DESTINATIONS[card.dataset.dest], $("form", card), progress);
    showResult(card, state, detail, link);
    return state;
  } catch (err) {
    if (err instanceof SendError) showResult(card, "err", err.message, err.link);
    else showResult(card, "err", `想定外のエラー: ${err.message}`);
    return "err";
  } finally {
    btn.disabled = false;
  }
}

async function onCardSubmit(ev) {
  ev.preventDefault();
  if (!token) return;
  const card = ev.target.closest(".dest");
  if (!validate(card)) return $("form", card).reportValidity();

  const dest = DESTINATIONS[card.dataset.dest];
  const verb = dest.verb ?? "送信";
  const ok = await confirmDialog({
    title: `${dest.name} に${verb}しますか？`,
    body: destBlock(card),
    okLabel: `${verb}する`,
  });
  if (ok) await sendCard(card);
}

async function onBulkSend() {
  if (!token) return;
  const cards = $$(".dest");
  const invalid = cards.find((card) => !validate(card));
  if (invalid) {
    invalid.scrollIntoView({ behavior: "smooth", block: "start" });
    $("form", invalid).reportValidity();
    return;
  }

  const ok = await confirmDialog({
    title: `${cards.length}か所に一括送信しますか？`,
    body: el("div", {}, ...cards.map((card) => destBlock(card, SUMMARY_FIELDS))),
    okLabel: `${cards.length}か所に送信する`,
  });
  if (!ok) return;

  const bulk = $("#bulk-send");
  const status = $("#bulk-status");
  bulk.disabled = true;
  status.textContent = "";
  // 送信先ごとの失敗が他に影響しないよう順番に送る
  const states = [];
  for (const card of cards) states.push(await sendCard(card));
  bulk.disabled = false;

  const count = (s) => states.filter((x) => x === s).length;
  const parts = [`成功 ${count("ok")}`, `結果不明 ${count("unknown")}`, `失敗 ${count("err")}`];
  status.dataset.tone = count("err") ? "err" : count("unknown") ? "unknown" : "ok";
  status.textContent = count("err")
    ? `${parts.join(" / ")} — 失敗した送信先を個別に送信し直してください。`
    : count("unknown")
      ? `${parts.join(" / ")} — 結果不明の送信先は掲載ページで確認してください。`
      : `${cards.length}か所すべてに送信しました。`;
}

/* ---------- init ---------- */

renderDestinations();
setLocked(true);
const remembered = storage("get");
if (remembered) {
  $("#remember").checked = true;
  unlock(remembered);
}
$("#gate-form").addEventListener("submit", onUnlock);
$("#gate-lock").addEventListener("click", onLock);
$$(".dest form").forEach((f) => f.addEventListener("submit", onCardSubmit));
$("#bulk-send").addEventListener("click", onBulkSend);
$$("[data-tweet]").forEach((t) => {
  t.addEventListener("input", () => updateTweetCounter(t));
  updateTweetCounter(t);
});
