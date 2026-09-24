"use strict";

/*
 * 合言葉ゲート
 * -----------
 * assets/passphrases.js には合言葉の PBKDF2 ハッシュだけが入っている（合言葉そのものは置かない）。
 * 入力された合言葉を同じ手順でハッシュし、今日（JST）有効なスロットと一致したら解錠する。
 * passphrases.js は tools/passphrase.mjs で生成する。
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
};
const SUMMARY_FIELDS = ["title", "date", "start"];

let unlocked = false;

/* ---------- passphrase ---------- */

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// 全角・大文字の揺れを吸収する。passphrase.mjs と同じ規則にすること。
const normalizePass = (s) => s.normalize("NFKC").trim().toLowerCase();

function todayJST() {
  // en-CA は YYYY-MM-DD 形式になる
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}

async function checkPassphrase(pass) {
  const store = window.PASSPHRASES;
  if (!store) throw new Error("assets/passphrases.js が読み込めていません。");
  if (!crypto.subtle) throw new Error("このブラウザでは暗号機能が使えません（https で開いてください）。");

  const today = todayJST();
  const slots = store.slots.filter((s) => (!s.from || s.from <= today) && (!s.until || today <= s.until));
  const base = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(normalizePass(pass)), "PBKDF2", false, ["deriveBits"],
  );
  for (const slot of slots) {
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: b64(slot.salt), iterations: store.iterations }, base, 256,
    );
    const hash = btoa(String.fromCharCode(...new Uint8Array(bits)));
    if (hash === slot.hash) return slot;
  }
  return null;
}

/* ---------- lock state ---------- */

function setLocked(locked) {
  unlocked = !locked;
  document.body.dataset.locked = String(locked);
  $$(".dest").forEach((card) => {
    card.inert = locked;
    $("fieldset", card).disabled = locked;
  });
  $("#bulk-send").disabled = locked;
  $("#gate-lock").hidden = locked;
  $("#gate-submit").hidden = !locked;
  $("#passphrase").disabled = !locked;
}

function renderDestinations() {
  $$(".dest").forEach((card) => {
    const dest = DESTINATIONS[card.dataset.dest];
    $(".dest__name", card).textContent = dest.name;
    const host = $("[data-host]", card);
    host.textContent = displayUrl(dest.url);
    host.title = dest.url;
    const check = $("[data-check]", card);
    if (dest.checkUrl) check.href = dest.checkUrl; else check.hidden = true;
  });
}

function displayUrl(url) {
  if (url.startsWith("mock:")) return `${url}（テスト用・通信しません）`;
  try {
    const u = new URL(url);
    return u.host + u.pathname;
  } catch {
    return url;
  }
}

function setGateStatus(text, tone) {
  const el = $("#gate-status");
  el.textContent = text;
  if (tone) el.dataset.tone = tone; else delete el.dataset.tone;
}

async function onUnlock(ev) {
  ev.preventDefault();
  const input = $("#passphrase");
  if (!input.value.trim()) return input.focus();

  const btn = $("#gate-submit");
  btn.disabled = true;
  setGateStatus("確認しています…");
  try {
    const slot = await checkPassphrase(input.value);
    if (!slot) {
      setGateStatus("合言葉が違うか、有効期限が切れています。今日の合言葉を確認してください。", "err");
      input.select();
      return;
    }
    input.value = "";
    setLocked(false);
    setGateStatus(`解錠しました — この合言葉は ${slot.until ? `${slot.until} まで有効` : "期限なし"}`, "ok");
    $(".dest input")?.focus();
  } catch (err) {
    setGateStatus(err.message, "err");
  } finally {
    btn.disabled = false;
  }
}

function onLock() {
  setLocked(true);
  setGateStatus("ロックしました。入力内容は残っています。");
  $("#passphrase").focus();
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
  for (const key of keys ?? data.keys()) {
    const value = String(data.get(key) ?? "").trim();
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
      el("span", { className: "mono", textContent: displayUrl(dest.url) }),
    ),
    fieldList($("form", card), keys),
    state === "ok" || state === "unknown"
      ? el("p", { className: "confirm__warn", textContent: "この送信先には送信済みです。もう一度送信されます。" })
      : null,
  );
}

/* ---------- sending ---------- */

class SendError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 送信して結果を返す。失敗時は SendError を投げる。
 * @returns {Promise<{ state: "ok" | "unknown", detail: string }>}
 */
async function post(dest, form) {
  const data = new FormData(form);

  if (dest.url.startsWith("mock:")) {
    await sleep(600 + Math.random() * 600);
    console.info("[mock POST]", dest.url, Object.fromEntries(data));
    if (dest.url === "mock:fail") throw new SendError("HTTP 500 — 送信先がエラーを返しました。");
    if (dest.url === "mock:opaque") return { state: "unknown", detail: "送信しましたが、この送信先は結果を返しません。" };
    return { state: "ok", detail: "HTTP 200 — 受け付けられました。" };
  }

  let res;
  try {
    res = await fetch(dest.url, { method: "POST", body: data, mode: dest.mode ?? "cors" });
  } catch {
    // CORS で弾かれた場合も含むため、実際には届いていることがある
    throw new SendError("通信エラー — 届いていない可能性があります。掲載ページを確認してから再送してください。");
  }
  if (res.type === "opaque") return { state: "unknown", detail: "送信しましたが、この送信先は結果を返しません。" };
  if (!res.ok) throw new SendError(`HTTP ${res.status} — 送信先がエラーを返しました。`);

  // 受け側が JSON で { ok: false, error: "..." } を返した場合は失敗として扱う
  const body = await res.json().catch(() => null);
  if (body && body.ok === false) throw new SendError(`送信先が拒否しました: ${body.error ?? body.message ?? "理由不明"}`);
  return { state: "ok", detail: `HTTP ${res.status} — 受け付けられました。` };
}

const CHIP_TEXT = { ok: "送信成功", unknown: "送信済み・結果不明", err: "送信失敗" };

function showResult(card, state, detail) {
  const chip = $("[data-chip]", card);
  const time = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  chip.dataset.state = state;
  chip.textContent = state === "busy" ? "送信中…" : `${CHIP_TEXT[state]} ${time}`;

  const result = $("[data-result]", card);
  result.dataset.state = state;
  result.replaceChildren();
  if (state === "busy") return;
  result.append(detail);
  const checkUrl = DESTINATIONS[card.dataset.dest].checkUrl;
  if (checkUrl) {
    result.append(" ", el("a", {
      href: checkUrl, target: "_blank", rel: "noopener",
      textContent: state === "ok" ? "掲載を確認 ↗" : "掲載ページで確認 ↗",
    }));
  }
}

function validate(card) {
  const form = $("form", card);
  form.classList.add("was-checked");
  return form.checkValidity();
}

async function sendCard(card) {
  const btn = $(".dest__actions .btn", card);
  btn.disabled = true;
  showResult(card, "busy");
  try {
    const { state, detail } = await post(DESTINATIONS[card.dataset.dest], $("form", card));
    showResult(card, state, detail);
    return state;
  } catch (err) {
    showResult(card, "err", err instanceof SendError ? err.message : `想定外のエラー: ${err.message}`);
    return "err";
  } finally {
    btn.disabled = false;
  }
}

async function onCardSubmit(ev) {
  ev.preventDefault();
  if (!unlocked) return;
  const card = ev.target.closest(".dest");
  if (!validate(card)) return $("form", card).reportValidity();

  const ok = await confirmDialog({
    title: `${DESTINATIONS[card.dataset.dest].name} に送信しますか？`,
    body: destBlock(card),
    okLabel: "送信する",
  });
  if (ok) await sendCard(card);
}

async function onBulkSend() {
  if (!unlocked) return;
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
$("#gate-form").addEventListener("submit", onUnlock);
$("#gate-lock").addEventListener("click", onLock);
$$(".dest form").forEach((f) => f.addEventListener("submit", onCardSubmit));
$("#bulk-send").addEventListener("click", onBulkSend);
