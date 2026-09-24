"use strict";

/*
 * 合言葉ゲート
 * -----------
 * assets/vault.js には送信先の設定（URL・トークン）が合言葉で暗号化された状態で入っている。
 * 合言葉から PBKDF2 で鍵を作り AES-GCM で復号できたときだけ解錠する。
 * 復号に成功しない限りページ側は送信先 URL を知らないので、ソースを読まれても送信先は漏れない。
 * vault.js は tools/seal.mjs で生成する。
 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

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

/** @type {null | { destinations: Record<string, {name?: string, url: string, mode?: string, token?: string}> }} */
let config = null;

/* ---------- crypto ---------- */

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// 全角・大文字の揺れを吸収する。seal.mjs と同じ規則にすること。
const normalizePass = (s) => s.normalize("NFKC").trim().toLowerCase();

function todayJST() {
  // en-CA は YYYY-MM-DD 形式になる
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}

function activeSlots(vault, today) {
  return vault.slots.filter((s) => (!s.from || s.from <= today) && (!s.until || today <= s.until));
}

async function openVault(pass) {
  const vault = window.VAULT;
  if (!vault) throw new Error("assets/vault.js が読み込めていません。");
  if (!crypto.subtle) throw new Error("このブラウザでは暗号機能が使えません（https で開いてください）。");

  const base = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(normalizePass(pass)), "PBKDF2", false, ["deriveKey"],
  );
  for (const slot of activeSlots(vault, todayJST())) {
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: b64(slot.salt), iterations: vault.iterations },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
    );
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(slot.iv) }, key, b64(slot.ct));
      return { payload: JSON.parse(new TextDecoder().decode(plain)), slot };
    } catch {
      // 別のスロットの合言葉かもしれないので次へ
    }
  }
  return null;
}

/* ---------- lock state ---------- */

function setLocked(locked) {
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
    const id = card.dataset.dest;
    const dest = config?.destinations[id];
    const hostEl = $("[data-host]", card);
    if (!dest) {
      hostEl.textContent = "▒▒▒▒▒▒▒▒▒▒▒▒";
      $(".dest__name", card).textContent = `送信先 ${id.toUpperCase()}`;
      return;
    }
    if (dest.name) $(".dest__name", card).textContent = dest.name;
    hostEl.textContent = displayUrl(dest.url);
    hostEl.title = dest.url;
  });
}

function displayUrl(url) {
  if (url.startsWith("mock:")) return `${url}（テスト用・実際には送信しません）`;
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
    const result = await openVault(input.value);
    if (!result) {
      setGateStatus("合言葉が違うか、有効期限が切れています。今日の合言葉を確認してください。", "err");
      input.select();
      return;
    }
    config = result.payload;
    input.value = "";
    renderDestinations();
    setLocked(false);
    const until = result.slot.until ? `${result.slot.until} まで有効` : "期限なし";
    setGateStatus(`解錠しました — この合言葉は ${until}`, "ok");
    $(".dest input")?.focus();
  } catch (err) {
    setGateStatus(err.message, "err");
  } finally {
    btn.disabled = false;
  }
}

function onLock() {
  config = null;
  renderDestinations();
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
  const dest = config.destinations[card.dataset.dest];
  const chip = $("[data-chip]", card);
  return el("div", { className: "confirm__dest" },
    el("p", { className: "confirm__dest-name" },
      $(".dest__name", card).textContent,
      el("span", { className: "mono", textContent: displayUrl(dest.url) }),
    ),
    fieldList($("form", card), keys),
    chip.dataset.state === "ok"
      ? el("p", { className: "confirm__warn", textContent: "この送信先には送信済みです。もう一度送信されます。" })
      : null,
  );
}

/* ---------- sending ---------- */

function setChip(card, state, text) {
  const chip = $("[data-chip]", card);
  chip.dataset.state = state;
  chip.textContent = text;
}

function validate(card) {
  const form = $("form", card);
  form.classList.add("was-checked");
  return form.checkValidity();
}

async function post(dest, form) {
  const data = new FormData(form);
  if (dest.token) data.append("token", dest.token);

  if (dest.url.startsWith("mock:")) {
    // モック送信先: 通信せずに成功扱いにする
    await new Promise((r) => setTimeout(r, 600 + Math.random() * 600));
    console.info("[mock POST]", dest.url, Object.fromEntries(data));
    return;
  }
  // mode: "no-cors" は Google フォームなど CORS 非対応の送信先用。結果は確認できない。
  const res = await fetch(dest.url, { method: "POST", body: data, mode: dest.mode ?? "cors" });
  if (res.type !== "opaque" && !res.ok) throw new Error(`HTTP ${res.status}`);
}

async function sendCard(card) {
  const dest = config.destinations[card.dataset.dest];
  const btn = $(".dest__actions .btn", card);
  btn.disabled = true;
  setChip(card, "busy", "送信中…");
  try {
    await post(dest, $("form", card));
    const t = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    setChip(card, "ok", `送信済み ${t}`);
    return true;
  } catch (err) {
    setChip(card, "err", "送信失敗");
    $("[data-chip]", card).title = err.message;
    return false;
  } finally {
    btn.disabled = false;
  }
}

async function onCardSubmit(ev) {
  ev.preventDefault();
  if (!config) return;
  const card = ev.target.closest(".dest");
  if (!validate(card)) return $("form", card).reportValidity();

  const name = $(".dest__name", card).textContent;
  const ok = await confirmDialog({
    title: `${name} に送信しますか？`,
    body: destBlock(card),
    okLabel: "送信する",
  });
  if (ok) await sendCard(card);
}

async function onBulkSend() {
  if (!config) return;
  const cards = $$(".dest");
  const invalid = cards.find((card) => !validate(card));
  if (invalid) {
    invalid.scrollIntoView({ behavior: "smooth", block: "start" });
    $("form", invalid).reportValidity();
    return;
  }

  const body = el("div", {}, ...cards.map((card) => destBlock(card, SUMMARY_FIELDS)));
  const ok = await confirmDialog({
    title: `${cards.length}か所に一括送信しますか？`,
    body,
    okLabel: `${cards.length}か所に送信する`,
  });
  if (!ok) return;

  const bulk = $("#bulk-send");
  bulk.disabled = true;
  // 送信先ごとの失敗が他に影響しないよう順番に送る
  const results = [];
  for (const card of cards) results.push(await sendCard(card));
  bulk.disabled = false;

  const failed = results.filter((r) => !r).length;
  const status = $("#bulk-status");
  status.dataset.tone = failed ? "err" : "ok";
  status.textContent = failed
    ? `${failed}か所で送信に失敗しました。「送信失敗」の送信先を個別に送信し直してください。`
    : `${cards.length}か所すべてに送信しました。`;
}

/* ---------- init ---------- */

setLocked(true);
$("#gate-form").addEventListener("submit", onUnlock);
$("#gate-lock").addEventListener("click", onLock);
$$(".dest form").forEach((f) => f.addEventListener("submit", onCardSubmit));
$("#bulk-send").addEventListener("click", onBulkSend);
