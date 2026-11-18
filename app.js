import { firebaseConfig } from "./config.js";

const FB = "https://www.gstatic.com/firebasejs/10.12.2/";

const USER_DOMAIN = "@utenti.suk-bingo.app"; // account con solo nome utente

const LINES = [];
for (let r = 0; r < 5; r++) LINES.push({ k: "r" + r, cells: [0,1,2,3,4].map(c => r * 5 + c), label: "riga " + (r + 1) });
for (let c = 0; c < 5; c++) LINES.push({ k: "c" + c, cells: [0,1,2,3,4].map(r => r * 5 + c), label: "colonna " + "BINGO"[c] });
LINES.push({ k: "d0", cells: [0,6,12,18,24], label: "diagonale" });
LINES.push({ k: "d1", cells: [4,8,12,16,20], label: "diagonale" });
const BALL_COLORS = ["#e2483d", "#f2a823", "#1fb978", "#2f7de1", "#8a4be0"];
const PLAYER_COLORS = ["#d4553f", "#2f7de1", "#8a4be0", "#1a9e6a", "#d98a12", "#c2407f", "#2b9bb0", "#6b5bd6", "#8c6a3f", "#4f7a28"];

let F = {};          // firebase functions
let auth, fdb;       // firebase instances
const S = {
  ready: false, configured: true, authReady: false, user: null, me: null,
  boards: [], boardsLoaded: false, boardsUnsub: null,
  route: { name: "home" },
  board: null, boardLoaded: false, players: {}, playersLoaded: false,
  unsubs: [], prevLines: {}, primed: false, winCells: new Set(),
  myMarks: null, myNick: "", writing: false, dirty: false,
  popCell: -1, slow: false, joinedChecked: false, authMode: "login", authErr: "",
};

const $app = document.getElementById("app");
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") el.setAttribute("style", v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
function toast(msg) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const t = h("div", { class: "toast", role: "status" }, msg);
  document.body.append(t); setTimeout(() => t.remove(), 2800);
}
function initials(nick) { const p = (nick || "?").trim(); return p ? [...p][0].toUpperCase() : "?"; }
function sizeClass(t) { const n = (t || "").length; return n <= 12 ? "s-xl" : n <= 24 ? "s-l" : n <= 40 ? "s-m" : "s-s"; }
function newId() { const a = "abcdefghijkmnpqrstuvwxyz23456789"; let s = ""; for (let i = 0; i < 10; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function completed(marks) { const s = new Set(marks || []); return LINES.filter(l => l.cells.every(c => s.has(c))); }
function colorOf(uid) { let x = 0; for (const ch of uid || "") x = (x * 31 + ch.charCodeAt(0)) >>> 0; return PLAYER_COLORS[x % PLAYER_COLORS.length]; }
function fmtTime(ts) { if (!ts) return ""; return new Date(ts).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }); }
function authErrMsg(e) {
  const c = (e && e.code) || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "Nome utente (o email) o password non corretti.";
  if (c.includes("email-already-in-use")) return "Questo nome utente o email è già usato. Prova ad accedere o scegline un altro.";
  if (c.includes("weak-password")) return "La password deve avere almeno 6 caratteri.";
  if (c.includes("invalid-email")) return "L'indirizzo email non è valido.";
  if (c.includes("popup-closed") || c.includes("cancelled-popup")) return "";
  if (c.includes("unauthorized-domain")) return "Questo sito non è ancora autorizzato in Firebase (Authentication → Impostazioni → Domini autorizzati).";
  if (c.includes("operation-not-allowed")) return "Questo metodo di accesso non è attivo nel progetto Firebase.";
  if (c.includes("network")) return "Connessione assente. Riprova.";
  if (c.includes("too-many-requests")) return "Troppi tentativi. Aspetta qualche minuto.";
  return "Accesso non riuscito. Riprova.";
}

/* ---------- Routing ---------- */
function parseHash() {
  const m = /^#b-([a-z0-9]{4,20})$/.exec(location.hash || "");
  if (m) return { name: "board", id: m[1] };
  const e = /^#edit-([a-z0-9]{4,20})$/.exec(location.hash || "");
  if (e) return { name: "edit", id: e[1] };
  if (location.hash === "#new") return { name: "edit", id: null };
  const dm = /^#d-([a-z0-9]{4,20})$/.exec(location.hash || "");
  if (dm) return { name: "draft", id: dm[1] };
  if (location.hash === "#newd") return { name: "newdraft", id: null };
  return { name: "home" };
}
function go(hash) { if (location.hash === hash || (!location.hash && hash === "#")) onRoute(); else location.hash = hash; }
function boardLink(id) { return location.origin + location.pathname + "#b-" + id; }
function stopSubs() { S.unsubs.forEach(u => { try { u(); } catch {} }); S.unsubs = []; }

function onRoute() {
  const r = parseHash();
  const kind = x => x.name === "draft" ? "d" : "b";
  const sameBoard = S.route.id && r.id === S.route.id && kind(r) === kind(S.route);
  S.route = r;
  if (!sameBoard) {
    stopSubs(); stopDraftSubs();
    S.board = null; S.boardLoaded = false; S.players = {}; S.playersLoaded = false;
    S.prevLines = {}; S.primed = false; S.myMarks = null; S.winCells = new Set(); S.joinedChecked = false;
    if (r.id && S.me) (r.name === "draft" ? subscribeDraft : subscribeBoard)(r.id);
  }
  closeParty(); closeSheet();
  window.scrollTo(0, 0);
  render();
}
window.addEventListener("hashchange", onRoute);

/* ---------- Data ---------- */
function subscribeBoards() {
  if (S.boardsUnsub) S.boardsUnsub();
  S.boardsLoaded = false;
  const q = F.query(F.collection(fdb, "boards"), F.where("members", "array-contains", S.me));
  S.boardsUnsub = F.onSnapshot(q, snap => {
    S.boards = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    S.boardsLoaded = true;
    if (S.route.name === "home") render();
  }, err => { console.error(err); S.boardsLoaded = true; S.boards = []; render(); });
}

function subscribeBoard(id) {
  const t = setTimeout(() => { S.slow = true; render(); }, 10000);
  const u1 = F.onSnapshot(F.doc(fdb, "boards", id), d => {
    clearTimeout(t); S.slow = false;
    S.board = d.exists() ? { id, ...d.data() } : null;
    S.boardLoaded = true;
    if (S.board && !d.metadata.fromCache && !S.joinedChecked) {
      S.joinedChecked = true;
      if (!(S.board.members || []).includes(S.me)) {
        F.updateDoc(F.doc(fdb, "boards", id), { members: F.arrayUnion(S.me) }).catch(e => console.warn("join", e));
      }
    }
    render();
  }, err => { console.error(err); clearTimeout(t); S.boardLoaded = true; S.board = null; render(); });
  const u2 = F.onSnapshot(F.collection(fdb, "boards", id, "players"), snap => {
    const players = {};
    snap.docs.forEach(d => { players[d.id] = d.data(); });
    S.players = players;
    S.playersLoaded = true;
    if (players[S.me] && S.myMarks === null) S.myMarks = new Set(players[S.me].marks || []);
    if (players[S.me] && players[S.me].nick) S.myNick = players[S.me].nick;
    detectBingos(snap.metadata.fromCache);
    render();
  }, err => { console.error(err); S.playersLoaded = true; render(); });
  S.unsubs.push(u1, u2);
}

function detectBingos(fromCache) {
  const firstTime = !S.primed;
  for (const [uid, p] of Object.entries(S.players)) {
    const now = completed(p.marks);
    const prev = S.prevLines[uid] || new Set();
    const fresh = now.filter(l => !prev.has(l.k));
    S.prevLines[uid] = new Set(now.map(l => l.k));
    if (!firstTime && fresh.length) celebrate(uid, p.nick, fresh[0]);
  }
  if (!fromCache) S.primed = true;
}

async function saveMine() {
  if (!S.me || !S.route.id) return;
  if (S.writing) { S.dirty = true; return; }
  S.writing = true;
  const boardId = S.route.id;
  try {
    do {
      S.dirty = false;
      const prev = S.players[S.me] || {};
      const marks = [...S.myMarks].sort((a, b) => a - b);
      const markedAt = Object.assign({}, prev.markedAt || {});
      for (const k of Object.keys(markedAt)) if (!S.myMarks.has(+k)) delete markedAt[k];
      for (const m of marks) if (!markedAt[m]) markedAt[m] = Date.now();
      await F.setDoc(F.doc(fdb, "boards", boardId, "players", S.me), {
        nick: S.myNick, marks, markedAt, joinedAt: prev.joinedAt || Date.now(), updatedAt: Date.now(),
      });
    } while (S.dirty);
  } catch (e) {
    console.error(e);
    toast("Salvataggio non riuscito. Controlla la connessione.");
    S.myMarks = new Set((S.players[S.me] || {}).marks || []);
    render();
  } finally { S.writing = false; }
}

function toggleCell(i) {
  if (!S.me) return;
  if (!S.myNick) { openJoin(() => toggleCell(i)); return; }
  if (S.myMarks === null) S.myMarks = new Set((S.players[S.me] || {}).marks || []);
  const had = S.myMarks.has(i);
  if (had) S.myMarks.delete(i); else S.myMarks.add(i);
  const p = Object.assign({ nick: S.myNick, markedAt: {} }, S.players[S.me] || {});
  p.marks = [...S.myMarks];
  p.markedAt = Object.assign({}, p.markedAt); if (!had) p.markedAt[i] = Date.now();
  S.players = Object.assign({}, S.players, { [S.me]: p });
  S.popCell = had ? -1 : i;
  if (!had && navigator.vibrate) { try { navigator.vibrate(12); } catch {} }
  detectBingos(false);
  render();
  saveMine();
}
function canEditBoard(b) { return !!(b && S.me && b.createdBy === S.me); }

/* ---------- Views ---------- */
function render() {
  $app.replaceChildren();
  if (!S.configured) { $app.append(viewNotConfigured()); return; }
  if (!S.authReady) { $app.append(h("div", { class: "spinner" }, "Caricamento…")); return; }
  if (!S.me) { $app.append(...viewAuth()); return; }
  const r = S.route;
  if (r.name === "home") $app.append(...viewHome());
  else if (r.name === "edit") $app.append(...viewEdit());
  else if (r.name === "draft") $app.append(...viewDraft());
  else if (r.name === "newdraft") $app.append(...viewNewDraft());
  else $app.append(...viewBoard());
}

function topbar(right) {
  return h("div", { class: "topbar" },
    h("button", { class: "brand", onclick: () => go("#"), "aria-label": "Tutti i tabelloni" }, "SUK BINGO"),
    h("div", { class: "row" }, right || [],
      h("button", { class: "avatar-btn", style: "background:" + colorOf(S.me), onclick: openAccount, "aria-label": "Account" }, initials(S.myNick || (S.user && S.user.displayName) || (S.user && S.user.email)))));
}

function viewNotConfigured() {
  return h("div", { class: "hero" }, h("h1", null, "SUK BINGO"),
    h("p", null, "L'app non è ancora collegata a Firebase. Inserisci la configurazione del progetto nel file config.js (vedi ISTRUZIONI.md)."));
}

function googleIcon() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", "0 0 48 48"); svg.setAttribute("class", "gmark"); svg.setAttribute("aria-hidden", "true");
  [["#FFC107","M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"],
   ["#FF3D00","M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"],
   ["#4CAF50","M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"],
   ["#1976D2","M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"]].forEach(([c, d]) => {
    const p = document.createElementNS(ns, "path"); p.setAttribute("fill", c); p.setAttribute("d", d); svg.append(p);
  });
  return svg;
}

function viewAuth() {
  const invited = S.route.name === "board";
  const isReg = S.authMode === "register";
  const err = h("div", { class: "err", role: "alert" }, S.authErr || "");
  const name = h("input", { class: "input", id: "au-name", autocomplete: "nickname", placeholder: "Nome che vedono gli altri (facoltativo)", maxlength: "24" });
  const email = h("input", { class: "input", id: "au-email", type: "text", autocapitalize: "none", autocorrect: "off", spellcheck: "false", autocomplete: "username", placeholder: "Nome utente o email" });
  const pass = h("input", { class: "input", id: "au-pass", type: "password", autocomplete: isReg ? "new-password" : "current-password", placeholder: "Password (minimo 6 caratteri)" });
  const busy = on => $app.querySelectorAll("button").forEach(b => b.disabled = on);

  async function google() {
    S.authErr = ""; err.textContent = ""; busy(true);
    const provider = new F.GoogleAuthProvider();
    try { await F.signInWithPopup(auth, provider); }
    catch (e) {
      if ((e.code || "").includes("popup-blocked")) { try { await F.signInWithRedirect(auth, provider); return; } catch (e2) { e = e2; } }
      err.textContent = authErrMsg(e); busy(false);
    }
  }
  async function submit(ev) {
    ev.preventDefault(); err.textContent = "";
    const id = email.value.trim(), pw = pass.value;
    if (!id || !pw) { err.textContent = "Inserisci nome utente (o email) e password."; return; }
    const isUser = !id.includes("@");
    const uname = id.toLowerCase();
    if (isUser && !/^[a-z0-9._-]{3,20}$/.test(uname)) { err.textContent = "Il nome utente deve avere da 3 a 20 caratteri: lettere, numeri, punto, trattino o trattino basso, senza spazi."; email.focus(); return; }
    const em = isUser ? uname + USER_DOMAIN : id;
    if (isReg && !isUser && !name.value.trim()) { err.textContent = "Scrivi il nome che vedranno gli altri."; name.focus(); return; }
    busy(true);
    try {
      if (isReg) {
        const cred = await F.createUserWithEmailAndPassword(auth, em, pw);
        const nick = name.value.trim() || id;
        await F.updateProfile(cred.user, { displayName: nick });
        S.myNick = nick; lsSet("sukbingo.nick", nick); render();
      } else {
        await F.signInWithEmailAndPassword(auth, em, pw);
      }
    } catch (e) { err.textContent = authErrMsg(e); busy(false); }
  }
  async function reset() {
    const em = email.value.trim();
    if (!em) { err.textContent = "Scrivi la tua email qui sopra, poi tocca di nuovo “Password dimenticata”."; email.focus(); return; }
    if (!em.includes("@")) { err.textContent = "Per gli account con solo nome utente non si può recuperare la password: creane uno nuovo oppure chiedi al creatore del gioco."; return; }
    try { await F.sendPasswordResetEmail(auth, em); toast("Ti ho mandato un'email per reimpostare la password."); }
    catch (e) { err.textContent = authErrMsg(e); }
  }

  return [
    h("div", { class: "masthead", "aria-hidden": "true" }, [..."BINGO"].map(c => h("span", null, c))),
    h("div", { class: "auth" },
      h("p", { class: "hint", style: "font-size:15px;color:var(--ink)" }, invited ? "Sei stato invitato a una partita. Accedi per entrare nel tabellone." : "Accedi per creare un tabellone e giocare con gli amici."),
      h("div", { class: "card" },
        h("button", { class: "btn wide", onclick: google }, googleIcon(), "Continua con Google"),
        h("div", { class: "or" }, "oppure con nome utente o email"),
        h("form", { onsubmit: submit, style: "display:flex;flex-direction:column;gap:10px", novalidate: true },
          email, pass, isReg ? name : null,
          isReg ? h("div", { class: "hint", style: "text-align:left" }, "Con un nome utente non serve nessuna email. Ricordati la password: non si può recuperare.") : null,
          h("button", { class: "btn primary wide", type: "submit" }, isReg ? "Crea account" : "Accedi")),
        err,
        h("div", { class: "row", style: "justify-content:space-between" },
          h("button", { class: "linkbtn", onclick: () => { S.authMode = isReg ? "login" : "register"; S.authErr = ""; render(); } }, isReg ? "Ho già un account" : "Crea un account"),
          !isReg ? h("button", { class: "linkbtn", onclick: reset }, "Password dimenticata") : null)))
  ];
}

function viewHome() {
  const out = [topbar(h("button", { class: "btn primary", onclick: openNewChoice }, "+ Nuovo"))];
  out.push(h("div", { class: "hero" },
    h("h1", null, "Bingo", h("br"), "degli eventi"),
    h("p", null, "Crea un tabellone 5×5 con gli eventi che volete, manda il link agli amici e segnate le caselle mentre succedono. Cinquina in riga, colonna o diagonale fa BINGO.")));
  if ((S.drafts || []).length) {
    out.push(h("h3", { class: "section-h" }, "In preparazione"));
    out.push(h("div", { class: "blist" }, S.drafts.map(d => h("button", { class: "bitem", onclick: () => go("#d-" + d.id) },
      h("span", { class: "dbadge", "aria-hidden": "true" }, "✎"),
      h("div", { class: "meta" }, h("b", null, d.title || "Bingo"),
        h("span", null, Date.now() >= d.deadline ? "Scaduta: il tabellone sta per arrivare" : "Proposte e voti ancora per " + shortLeft(d.deadline))),
      h("span", { "aria-hidden": "true", style: "color:var(--muted);font-size:20px" }, "›")))));
  }
  out.push(h("h3", { class: "section-h" }, "I tuoi tabelloni"));
  if (!S.boardsLoaded) out.push(h("div", { class: "spinner" }, "Caricamento tabelloni…"));
  else if (!S.boards.length) {
    out.push(h("div", { class: "empty" },
      h("div", null, "Qui compaiono i tabelloni che crei e quelli a cui ti invitano. Crea il primo e manda il link agli amici."),
      h("div", { class: "row", style: "justify-content:center" },
        h("button", { class: "btn primary", onclick: openNewChoice }, "Crea tabellone"))));
  } else {
    out.push(h("div", { class: "blist" }, S.boards.map(b => {
      const mini = h("div", { class: "mini", "aria-hidden": "true" }, Array.from({ length: 25 }, (_, i) => h("i", { class: i === 12 ? "c" : "" })));
      const n = (b.members || []).length;
      return h("button", { class: "bitem", onclick: () => go("#b-" + b.id) }, mini,
        h("div", { class: "meta" }, h("b", null, b.title || "Senza titolo"),
          h("span", null, (b.createdBy === S.me ? "Creato da te" : "Invitato") + " · " + n + (n === 1 ? " giocatore" : " giocatori"))),
        h("span", { "aria-hidden": "true", style: "color:var(--muted);font-size:20px" }, "›"));
    })));
  }
  return out;
}

function viewEdit() {
  const editing = S.route.id;
  if (editing && !S.boardLoaded) return [topbar(), h("div", { class: "spinner" }, "Caricamento…")];
  if (editing && !canEditBoard(S.board)) return [topbar(), h("div", { class: "empty" }, "Solo chi ha creato il tabellone può modificarlo.")];
  let title = "", cells = Array(25).fill("");
  if (editing && S.board) { title = S.board.title || ""; cells = (S.board.cells || []).slice(0, 25); while (cells.length < 25) cells.push(""); }

  const titleIn = h("input", { class: "input", id: "ed-title", maxlength: "60", placeholder: "Es. Torneo di sabato", value: title });
  const areas = cells.map((c, i) => { const ta = h("textarea", { id: "ed-c" + i, class: i === 12 ? "center" : "", maxlength: "70", "aria-label": "Casella " + (i + 1), placeholder: i === 12 ? "centro" : "" }); ta.value = c; return ta; });
  const bulk = h("textarea", { class: "input", id: "ed-bulk", placeholder: "Un evento per riga (fino a 25)" });
  const status = h("div", { class: "hint", role: "status" });

  async function save(ev) {
    const btn = ev.currentTarget;
    const filled = areas.map(a => a.value.trim());
    const t = titleIn.value.trim() || "Bingo";
    const empties = filled.filter(s => !s).length;
    if (empties) { status.textContent = "Mancano " + empties + " caselle da riempire."; areas[filled.findIndex(s => !s)].focus(); return; }
    const id = editing || newId();
    status.textContent = "Salvataggio…"; btn.disabled = true;
    try {
      if (editing) await F.updateDoc(F.doc(fdb, "boards", id), { title: t, cells: filled, updatedAt: Date.now() });
      else await F.setDoc(F.doc(fdb, "boards", id), { title: t, cells: filled, createdBy: S.me, createdAt: Date.now(), members: [S.me] });
      go("#b-" + id);
      if (!editing) setTimeout(() => toast("Tabellone creato. Tocca “Invita” per mandare il link."), 300);
    } catch (e) { console.error(e); status.textContent = "Salvataggio non riuscito. Riprova."; btn.disabled = false; }
  }

  return [
    topbar(h("button", { class: "btn ghost", onclick: () => go(editing ? "#b-" + editing : "#") }, "Annulla")),
    h("div", { class: "hero" }, h("h1", { style: "font-size:clamp(28px,8vw,40px)" }, editing ? "Modifica tabellone" : "Nuovo tabellone"),
      h("p", null, "Scrivi 25 eventi. La casella centrale è quella speciale, evidenziata.")),
    h("div", { class: "field" }, h("label", { for: "ed-title" }, "Nome"), titleIn),
    h("div", { class: "field" }, h("label", null, "Caselle"), h("div", { class: "egrid" }, areas)),
    h("div", { class: "row" },
      h("button", { class: "btn", onclick: () => { const v = areas.map(a => a.value); const center = v[12]; const o = shuffle(v.filter((_, i) => i !== 12)); o.splice(12, 0, center); o.forEach((x, i) => areas[i].value = x); } }, "Mescola")),
    h("details", { class: "bulk" }, h("summary", null, "Incolla una lista di eventi"), bulk,
      h("button", { class: "btn", onclick: () => {
        const lines = bulk.value.split(/\n/).map(s => s.replace(/^[-*•\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 25);
        lines.forEach((v, i) => areas[i].value = v); status.textContent = lines.length + " eventi inseriti.";
      } }, "Riempi le caselle")),
    h("div", { class: "row", style: "justify-content:flex-end" }, h("button", { class: "btn primary", onclick: save }, editing ? "Salva modifiche" : "Crea e apri")),
    status,
  ];
}

function viewBoard() {
  const b = S.board;
  if (!S.boardLoaded) return [topbar(), h("div", { class: "spinner" }, S.slow ? "Il tabellone non risponde. Controlla la connessione." : "Caricamento tabellone…")];
  if (!b) return [topbar(), h("div", { class: "empty" }, "Questo tabellone non esiste più, oppure il link è sbagliato.", h("button", { class: "btn", onclick: () => go("#") }, "I tuoi tabelloni"))];

  const byCell = Array.from({ length: 25 }, () => []);
  for (const [uid, p] of Object.entries(S.players)) for (const m of p.marks || []) if (byCell[m]) byCell[m].push(uid);
  const mine = S.myMarks || new Set((S.players[S.me] || {}).marks || []);

  const right = [
    h("button", { class: "btn", onclick: () => share(b) }, "Invita"),
    canEditBoard(b) ? h("button", { class: "btn ghost", onclick: () => go("#edit-" + b.id) }, "Modifica") : null,
  ];
  const grid = h("div", { class: "grid", role: "grid", "aria-label": "Tabellone" }, (b.cells || []).slice(0, 25).map((txt, i) => {
    const others = byCell[i].filter(u => u !== S.me);
    const isMine = mine.has(i);
    const cls = ["cell", sizeClass(txt), i === 12 ? "center" : "", isMine ? "mine" : "", S.popCell === i ? "pop" : "", S.winCells.has(i) ? "win" : ""].join(" ");
    const chips = h("div", { class: "chips", "aria-hidden": "true" },
      others.slice(0, 3).map(u => h("span", { class: "chip", style: "background:" + colorOf(u) }, initials((S.players[u] || {}).nick))),
      others.length > 3 ? h("span", { class: "chip more" }, "+" + (others.length - 3)) : null);
    const label = txt + (isMine ? ", segnata da te" : "") + (others.length ? ", segnata da " + others.length + " altri" : "");
    const cell = h("button", { class: cls, "aria-label": label, "aria-pressed": isMine ? "true" : "false" },
      h("span", { class: "txt" }, txt), isMine ? checkSvg() : null, chips);
    attachPress(cell, () => toggleCell(i), () => openCell(i));
    return cell;
  }));
  S.popCell = -1;

  const ids = Object.keys(S.players).sort((a, c) => (S.players[a].joinedAt || 0) - (S.players[c].joinedAt || 0));
  const plist = h("div", { class: "plist" }, ids.length ? ids.map(uid => {
    const p = S.players[uid]; const lines = completed(p.marks).length;
    return h("span", { class: "pchip" },
      h("span", { class: "chip", style: "background:" + colorOf(uid) }, initials(p.nick)),
      (p.nick || "Giocatore") + (uid === S.me ? " (tu)" : ""),
      h("span", { class: "n" }, (p.marks || []).length + "/25"),
      lines ? h("span", { class: "b" }, lines > 1 ? "BINGO ×" + lines : "BINGO") : null);
  }) : h("span", { class: "hint" }, "Nessuno ha ancora segnato una casella."));

  const out = [topbar(right), h("div", { class: "masthead", "aria-hidden": "true" }, [..."BINGO"].map(c => h("span", null, c))), h("h2", { class: "title" }, b.title || "Bingo")];
  out.push(grid,
    h("div", { class: "hint" }, "Tocca una casella quando ti capita l'evento. Tieni premuto per vedere chi l'ha presa."),
    h("div", { class: "players" }, h("h3", null, "Giocatori"), plist));
  if (canEditBoard(b)) out.push(h("div", { class: "row", style: "justify-content:center" }, deleteControl(b)));
  return out;
}

function checkSvg() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("class", "check"); svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(ns, "path"); p.setAttribute("d", "M12 46 C 22 58, 30 74, 36 92 C 50 56, 70 26, 94 8");
  svg.append(p); return svg;
}

function deleteControl(b) {
  const wrap = h("div", { class: "row" });
  wrap.append(h("button", { class: "btn ghost danger", onclick: () => {
    wrap.replaceChildren(h("span", { class: "hint" }, "Eliminare per tutti?"),
      h("button", { class: "btn danger", onclick: async () => {
        try { await F.deleteDoc(F.doc(fdb, "boards", b.id)); toast("Tabellone eliminato"); go("#"); } catch { toast("Non sono riuscito a eliminarlo."); }
      } }, "Sì, elimina"),
      h("button", { class: "btn ghost", onclick: () => render() }, "Annulla"));
  } }, "Elimina tabellone"));
  return wrap;
}

function attachPress(el, onTap, onLong) {
  let timer = null, sx = 0, sy = 0, longFired = false;
  const clear = () => { clearTimeout(timer); timer = null; };
  el.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    longFired = false; sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => { longFired = true; timer = null; if (navigator.vibrate) { try { navigator.vibrate(20); } catch {} } onLong(); }, 450);
  });
  el.addEventListener("pointermove", e => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) clear(); });
  ["pointerup", "pointercancel", "pointerleave"].forEach(ev => el.addEventListener(ev, clear));
  el.addEventListener("contextmenu", e => e.preventDefault());
  el.addEventListener("click", e => { if (longFired) { longFired = false; e.preventDefault(); return; } onTap(); });
  el.addEventListener("keydown", e => { if (e.key === "i" || (e.key === "Enter" && e.shiftKey)) { e.preventDefault(); onLong(); } });
}

function openSheet(build) {
  closeSheet();
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true" }, h("div", { class: "grab" }));
  const scrim = h("div", { class: "scrim", id: "scrim", onclick: e => { if (e.target === scrim) closeSheet(); } }, sheet);
  build(sheet);
  document.body.append(scrim);
  const f = sheet.querySelector("input, button.primary, button"); f && f.focus();
}
function closeSheet() { const s = document.getElementById("scrim"); if (s) s.remove(); }
document.addEventListener("keydown", e => { if (e.key === "Escape") { closeSheet(); closeParty(); } });

function openCell(i) {
  const b = S.board; if (!b) return;
  const who = Object.entries(S.players).filter(([, p]) => (p.marks || []).includes(i))
    .map(([uid, p]) => ({ uid, nick: p.nick, at: (p.markedAt || {})[i] || 0 })).sort((a, c) => a.at - c.at);
  const mineHas = (S.myMarks || new Set((S.players[S.me] || {}).marks || [])).has(i);
  openSheet(sheet => {
    sheet.append(
      h("div", { class: "section-h" }, "Casella " + "BINGO"[i % 5] + (Math.floor(i / 5) + 1)),
      h("h2", null, b.cells[i]),
      who.length ? h("ul", { class: "who" }, who.map(w => h("li", null,
        h("span", { class: "chip", style: "background:" + colorOf(w.uid) }, initials(w.nick)),
        (w.nick || "Giocatore") + (w.uid === S.me ? " (tu)" : ""),
        h("span", { class: "t" }, w.at ? "alle " + fmtTime(w.at) : ""))))
        : h("p", { class: "hint", style: "text-align:left;margin:0" }, "Nessuno ha ancora preso questa casella."),
      h("div", { class: "row", style: "justify-content:flex-end" },
        h("button", { class: "btn ghost", onclick: closeSheet }, "Chiudi"),
        h("button", { class: "btn primary", onclick: () => { closeSheet(); toggleCell(i); } }, mineHas ? "Togli il mio segno" : "Mi è capitato!")));
  });
}

function openJoin(after) {
  openSheet(sheet => {
    const input = h("input", { class: "input", id: "nick", maxlength: "24", placeholder: "Il tuo nome", value: S.myNick || "" });
    const ok = async () => {
      const v = input.value.trim(); if (!v) { input.focus(); return; }
      S.myNick = v; lsSet("sukbingo.nick", v);
      try { if (S.user && S.user.displayName !== v) await F.updateProfile(S.user, { displayName: v }); } catch {}
      closeSheet();
      if (after) after();
      else { render(); if (S.route.id && S.players[S.me]) { if (S.myMarks === null) S.myMarks = new Set(S.players[S.me].marks || []); saveMine(); } }
    };
    input.addEventListener("keydown", e => { if (e.key === "Enter") ok(); });
    sheet.append(h("h2", null, "Come ti chiami?"),
      h("p", { class: "hint", style: "text-align:left;margin:0" }, "Gli altri vedranno l'iniziale sulle caselle che segni."),
      input,
      h("div", { class: "row", style: "justify-content:flex-end" }, h("button", { class: "btn ghost", onclick: closeSheet }, "Annulla"), h("button", { class: "btn primary", onclick: ok }, "Salva")));
  });
}

function openAccount() {
  openSheet(sheet => {
    sheet.append(h("h2", null, S.myNick || "Il tuo account"),
      h("p", { class: "hint", style: "text-align:left;margin:0" }, (S.user && S.user.email && S.user.email.endsWith(USER_DOMAIN)) ? "Nome utente: " + S.user.email.slice(0, -USER_DOMAIN.length) : ((S.user && S.user.email) || "")),
      h("div", { class: "row", style: "justify-content:flex-end" },
        h("button", { class: "btn", onclick: () => openJoin() }, "Cambia nome"),
        h("button", { class: "btn danger", onclick: async () => { closeSheet(); await F.signOut(auth); } }, "Esci")));
  });
}

async function share(b) {
  const link = boardLink(b.id);
  const text = "Giochiamo a " + (b.title || "Bingo") + "! Entra qui: " + link;
  const input = h("input", { class: "input", id: "share-link", readonly: true, value: link });
  openSheet(sheet => {
    sheet.append(h("h2", null, "Invita gli amici"),
      h("p", { class: "hint", style: "text-align:left;margin:0" }, "Chi apre il link accede con Google o con la sua email ed entra direttamente in questo tabellone."),
      input,
      h("div", { class: "row", style: "justify-content:flex-end" },
        h("button", { class: "btn ghost", onclick: closeSheet }, "Chiudi"),
        navigator.share ? h("button", { class: "btn", onclick: async () => { try { await navigator.share({ title: b.title, text, url: link }); closeSheet(); } catch {} } }, "Condividi…") : null,
        h("a", { class: "btn", href: "https://wa.me/?text=" + encodeURIComponent(text), target: "_blank", rel: "noopener" }, "WhatsApp"),
        h("button", { class: "btn primary", onclick: async () => {
          try { await navigator.clipboard.writeText(link); toast("Link copiato"); closeSheet(); }
          catch { input.select(); toast("Seleziona e copia il link"); }
        } }, "Copia link")));
  });
}

let partyTimer = null, partyRaf = 0;
function closeParty() { const p = document.getElementById("party"); if (p) p.remove(); clearTimeout(partyTimer); cancelAnimationFrame(partyRaf); }
function celebrate(uid, nick, line) {
  closeParty(); closeSheet();
  S.winCells = new Set(line.cells);
  setTimeout(() => { S.winCells = new Set(); render(); }, 4200);
  const canvas = h("canvas");
  const party = h("div", { class: "party", id: "party", role: "alert", onclick: closeParty }, canvas,
    h("div", { class: "inner" },
      h("div", { class: "letters" }, [..."BINGO"].map((c, i) => h("span", { style: "--i:" + i + ";--c:" + BALL_COLORS[i] }, c))),
      h("div", { class: "who" }, uid === S.me ? "Hai fatto BINGO!" : (nick || "Qualcuno") + " ha fatto BINGO!"),
      h("div", { class: "line" }, "Cinquina in " + line.label + " · tocca per chiudere")));
  document.body.append(party);
  if (navigator.vibrate) { try { navigator.vibrate([60, 40, 60, 40, 160]); } catch {} }
  if (!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) confetti(canvas);
  partyTimer = setTimeout(closeParty, 6000);
}
function confetti(canvas) {
  const ctx = canvas.getContext("2d"); const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.width = innerWidth * dpr, H = canvas.height = innerHeight * dpr;
  const parts = Array.from({ length: 160 }, () => ({
    x: W / 2 + (Math.random() - .5) * W * .3, y: H * .45, vx: (Math.random() - .5) * 22 * dpr, vy: (-Math.random() * 20 - 6) * dpr,
    s: (5 + Math.random() * 7) * dpr, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: BALL_COLORS[Math.floor(Math.random() * 5)], round: Math.random() < .3,
  }));
  const t0 = performance.now();
  const step = t => {
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += .55 * dpr; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.s / 2, 0, 7); ctx.fill(); } else ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    if (t - t0 < 5000 && document.getElementById("party")) partyRaf = requestAnimationFrame(step);
  };
  partyRaf = requestAnimationFrame(step);
}

/* ---------- Creazione condivisa (proposte + voti) ---------- */
const D = { draft: null, loaded: false, entries: [], people: {}, finalizing: false, tick: null, unsubs: [] };

function stopDraftSubs() { D.unsubs.forEach(u => { try { u(); } catch {} }); D.unsubs = []; clearInterval(D.tick); D.tick = null; }
function draftLink(id) { return location.origin + location.pathname + "#d-" + id; }

function subscribeDrafts() {
  if (S.draftsUnsub) S.draftsUnsub();
  const q = F.query(F.collection(fdb, "drafts"), F.where("members", "array-contains", S.me));
  S.draftsUnsub = F.onSnapshot(q, snap => {
    S.drafts = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.status === "open").sort((a, b) => (a.deadline || 0) - (b.deadline || 0));
    // Chi apre l'app dopo la scadenza chiude le creazioni scadute.
    S.drafts.filter(d => Date.now() >= d.deadline).forEach(d => finalizeDraft(d.id));
    if (S.route.name === "home") render();
  }, err => { console.error(err); S.drafts = []; });
}

function subscribeDraft(id) {
  D.draft = null; D.loaded = false; D.entries = []; D.people = {}; D.joined = false; D.tab = "chat";
  const t = setTimeout(() => { S.slow = true; render(); }, 10000);
  const ref = F.doc(fdb, "drafts", id);
  D.unsubs.push(F.onSnapshot(ref, d => {
    clearTimeout(t); S.slow = false;
    D.draft = d.exists() ? { id, ...d.data() } : null;
    D.loaded = true;
    const dr = D.draft;
    if (dr && dr.status === "closed" && dr.boardId) { go("#b-" + dr.boardId); return; }
    if (dr && !d.metadata.fromCache && !D.joined) {
      D.joined = true;
      if (!(dr.members || []).includes(S.me)) F.updateDoc(ref, { members: F.arrayUnion(S.me) }).catch(e => console.warn("join", e));
      if (!D.people[S.me] && S.myNick) savePerson(id, null);
    }
    renderDraftKeepFocus();
  }, err => { console.error(err); clearTimeout(t); D.loaded = true; D.draft = null; render(); }));
  D.unsubs.push(F.onSnapshot(F.collection(fdb, "drafts", id, "entries"), snap => {
    D.entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderDraftKeepFocus();
  }, err => console.error(err)));
  D.unsubs.push(F.onSnapshot(F.collection(fdb, "drafts", id, "people"), snap => {
    const p = {}; snap.docs.forEach(d => { p[d.id] = d.data(); }); D.people = p;
    renderDraftKeepFocus();
  }, err => console.error(err)));
  D.tick = setInterval(() => {
    const el = document.getElementById("countdown");
    if (!D.draft || !el) return;
    el.textContent = countdownText(D.draft.deadline);
    if (Date.now() >= D.draft.deadline && D.draft.status === "open" && !D.finalizing) finalizeDraft(D.draft.id);
  }, 1000);
}

// Animazione FLIP: ogni proposta scivola dalla vecchia alla nuova posizione; le nuove entrano con un pop.
function flip(before, hadAny) {
  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.querySelectorAll("[data-eid]").forEach(el => {
    const old = before[el.dataset.eid];
    const now = el.getBoundingClientRect().top;
    if (old == null) {
      if (hadAny && !el.dataset.eid.startsWith("sep")) { el.classList.add("enter"); el.addEventListener("animationend", () => el.classList.remove("enter"), { once: true }); }
      return;
    }
    const dy = old - now;
    if (Math.abs(dy) < 1) return;
    el.style.transition = "none";
    el.style.transform = "translateY(" + dy + "px)";
    el.getBoundingClientRect();
    el.style.transition = "transform .45s cubic-bezier(.2,.8,.2,1)";
    el.style.transform = "";
    if (Math.abs(dy) > 40) el.classList.add("moving");
    el.addEventListener("transitionend", () => { el.style.transition = ""; el.classList.remove("moving"); }, { once: true });
  });
}

// Ridisegna senza perdere quello che si sta scrivendo nel campo proposta.
function renderDraftKeepFocus() {
  if (S.route.name !== "draft") return;
  const inp = document.getElementById("entry-in");
  const val = inp ? inp.value : "", focused = inp && document.activeElement === inp;
  const y = window.scrollY;
  const before = {};
  document.querySelectorAll("[data-eid]").forEach(el => { before[el.dataset.eid] = el.getBoundingClientRect().top; });
  const hadAny = Object.keys(before).length > 0;
  render();
  const n = document.getElementById("entry-in");
  if (n) { n.value = val; if (focused) n.focus({ preventScroll: true }); }
  window.scrollTo(0, y);
  flip(before, hadAny);
  D.justVoted = null;
}

// Punteggio = pollici su meno pollici giù.
function tally(peopleList) {
  const up = {}, down = {};
  for (const p of peopleList) {
    for (const e of p.up || []) up[e] = (up[e] || 0) + 1;
    for (const e of p.down || []) down[e] = (down[e] || 0) + 1;
  }
  return { up, down, score: id => (up[id] || 0) - (down[id] || 0) };
}
function countdownText(deadline) {
  let s = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
  if (!s) return "Tempo scaduto";
  const d = Math.floor(s / 86400); s %= 86400;
  const hh = String(Math.floor(s / 3600)).padStart(2, "0"), mm = String(Math.floor(s % 3600 / 60)).padStart(2, "0"), ss = String(s % 60).padStart(2, "0");
  return (d ? d + (d === 1 ? " giorno " : " giorni ") : "") + hh + ":" + mm + ":" + ss;
}
function shortLeft(deadline) {
  const m = Math.max(0, Math.round((deadline - Date.now()) / 60000));
  if (m < 60) return m + " min";
  if (m < 48 * 60) return Math.round(m / 60) + " ore";
  return Math.round(m / 1440) + " giorni";
}
function fmtDeadline(ts) { return new Date(ts).toLocaleString("it-IT", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
function toLocalInput(ts) { const d = new Date(ts); const p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes()); }

async function savePerson(draftId, votes) {
  const prev = D.people[S.me] || {};
  const data = { nick: S.myNick || "Giocatore", up: votes ? votes.up : (prev.up || []), down: votes ? votes.down : (prev.down || []), joinedAt: prev.joinedAt || Date.now() };
  D.people = Object.assign({}, D.people, { [S.me]: data });
  try { await F.setDoc(F.doc(fdb, "drafts", draftId, "people", S.me), data); }
  catch (e) { console.error(e); toast("Non sono riuscito a salvare. Controlla la connessione."); }
}

function toggleVote(entry, dir) {
  if (!S.myNick) { openJoin(() => toggleVote(entry, dir)); return; }
  if (entry.author === S.me) { toast("Non puoi votare le tue proposte."); return; }
  const me = D.people[S.me] || {};
  const up = new Set(me.up || []), down = new Set(me.down || []);
  const mine = dir > 0 ? up : down, other = dir > 0 ? down : up;
  if (mine.has(entry.id)) mine.delete(entry.id); else { mine.add(entry.id); other.delete(entry.id); }
  D.justVoted = entry.id;
  savePerson(D.draft.id, { up: [...up], down: [...down] });
  renderDraftKeepFocus();
}

async function addEntry(text) {
  const t = text.trim().replace(/\s+/g, " ").slice(0, 70);
  if (!t) return false;
  if (!S.myNick) { openJoin(() => addEntry(text)); return false; }
  if (D.entries.some(e => e.text.toLowerCase() === t.toLowerCase())) { toast("Questa proposta c'è già: votala!"); return false; }
  try {
    await F.setDoc(F.doc(fdb, "drafts", D.draft.id, "entries", newId()), { text: t, author: S.me, authorNick: S.myNick, createdAt: Date.now() });
    if (!D.people[S.me]) savePerson(D.draft.id, null);
    return true;
  } catch (e) { console.error(e); toast("Proposta non salvata. La creazione potrebbe essere già chiusa."); return false; }
}

// Ordine di priorità: punteggio positivo (dal più alto), poi a caso quelle a zero o senza voti,
// poi le negative (dalla meno negativa). Se le proposte sono meno di 25, se ne ripetono alcune a caso.
function rankEntries(entries, score) {
  return [
    ...shuffle(entries.filter(e => score(e.id) > 0)).sort((a, b) => score(b.id) - score(a.id)),
    ...shuffle(entries.filter(e => score(e.id) === 0)),
    ...shuffle(entries.filter(e => score(e.id) < 0)).sort((a, b) => score(b.id) - score(a.id)),
  ];
}
function pickCells(entries, score) {
  const chosen = rankEntries(entries, score).slice(0, 25);
  const base = chosen.slice();
  while (chosen.length < 25) chosen.push(base[Math.floor(Math.random() * base.length)]);
  return shuffle(chosen.map(e => e.text));
}

async function finalizeDraft(id) {
  if (D.finalizing) return;
  D.finalizing = true;
  try {
    const ref = F.doc(fdb, "drafts", id);
    const [es, ps] = await Promise.all([F.getDocs(F.collection(fdb, "drafts", id, "entries")), F.getDocs(F.collection(fdb, "drafts", id, "people"))]);
    const entries = es.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!entries.length) return; // niente da mettere nel tabellone: resta aperta
    const cells = pickCells(entries, tally(ps.docs.map(d => d.data())).score);
    await F.runTransaction(fdb, async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const d = snap.data();
      if (d.status !== "open") return;
      if (Date.now() < d.deadline && d.createdBy !== S.me) return;
      tx.set(F.doc(fdb, "boards", id), { title: d.title, cells, createdBy: d.createdBy, createdAt: Date.now(), members: d.members, fromDraft: id });
      tx.update(ref, { status: "closed", boardId: id, closedAt: Date.now() });
    });
  } catch (e) {
    console.warn("finalize", e);
  } finally { D.finalizing = false; }
}

function viewNewDraft() {
  const titleIn = h("input", { class: "input", id: "nd-title", maxlength: "60", placeholder: "Es. Bingo del torneo di sabato" });
  const dl = h("input", { class: "input", id: "nd-deadline", type: "datetime-local", value: toLocalInput(Date.now() + 24 * 3600e3) });
  const status = h("div", { class: "hint", role: "status" });
  const quick = (label, ms) => h("button", { class: "btn", type: "button", onclick: () => { dl.value = toLocalInput(Date.now() + ms); } }, label);
  async function create(ev) {
    const btn = ev.currentTarget;
    const deadline = new Date(dl.value).getTime();
    if (!deadline || deadline < Date.now() + 60e3) { status.textContent = "Scegli una scadenza nel futuro."; dl.focus(); return; }
    const id = newId(); btn.disabled = true; status.textContent = "Creazione…";
    try {
      await F.setDoc(F.doc(fdb, "drafts", id), { title: titleIn.value.trim() || "Bingo", createdBy: S.me, createdAt: Date.now(), deadline, members: [S.me], status: "open" });
      go("#d-" + id);
      setTimeout(() => openShareDraft({ id, title: titleIn.value.trim() || "Bingo" }), 400);
    } catch (e) { console.error(e); status.textContent = "Creazione non riuscita. Riprova."; btn.disabled = false; }
  }
  return [
    topbar(h("button", { class: "btn ghost", onclick: () => go("#") }, "Annulla")),
    h("div", { class: "hero" }, h("h1", { style: "font-size:clamp(28px,8vw,40px)" }, "Creiamolo insieme"),
      h("p", null, "Inviti gli amici, ognuno propone gli eventi che vuole e vota quelli degli altri. Alla scadenza le proposte più votate formano il tabellone, mescolate a caso.")),
    h("div", { class: "field" }, h("label", { for: "nd-title" }, "Nome del tabellone"), titleIn),
    h("div", { class: "field" }, h("label", { for: "nd-deadline" }, "Scadenza per proporre e votare"), dl,
      h("div", { class: "row" }, quick("Tra 1 ora", 3600e3), quick("Tra 1 giorno", 86400e3), quick("Tra 3 giorni", 3 * 86400e3))),
    h("div", { class: "row", style: "justify-content:flex-end" }, h("button", { class: "btn primary", onclick: create }, "Crea e invita")),
    status,
  ];
}

function viewDraft() {
  const d = D.draft;
  if (!D.loaded) return [topbar(), h("div", { class: "spinner" }, S.slow ? "Non riesco a raggiungere la creazione. Controlla la connessione." : "Caricamento…")];
  if (!d) return [topbar(), h("div", { class: "empty" }, "Questa creazione non esiste più, oppure il link è sbagliato.", h("button", { class: "btn", onclick: () => go("#") }, "I tuoi tabelloni"))];
  const isCreator = d.createdBy === S.me;
  const T = tally(Object.values(D.people));
  const myUp = new Set((D.people[S.me] || {}).up || []), myDown = new Set((D.people[S.me] || {}).down || []);
  // Per la lista: stesso ordine della scelta finale, ma stabile (a parità, la proposta più vecchia prima).
  const band = id => T.score(id) > 0 ? 0 : T.score(id) === 0 ? 1 : 2;
  const sorted = D.entries.slice().sort((a, b) => band(a.id) - band(b.id) || (band(a.id) === 1 ? 0 : T.score(b.id) - T.score(a.id)) || (a.createdAt || 0) - (b.createdAt || 0));
  const expired = Date.now() >= d.deadline;

  const input = h("input", { class: "input", id: "entry-in", maxlength: "70", placeholder: "Proponi un evento…", enterkeyhint: "send", autocomplete: "off" });
  // Svuota subito il campo (la lista si ridisegna mentre salva); se il salvataggio fallisce, rimette il testo.
  const submit = async () => {
    const v = input.value; if (!v.trim()) return;
    const cur = () => document.getElementById("entry-in");
    cur().value = ""; cur().focus();
    if (!(await addEntry(v)) && cur() && !cur().value) cur().value = v;
  };
  input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
  const tab = D.tab || "chat";

  const reactBtns = (e, mine) => {
    const isUp = myUp.has(e.id), isDown = myDown.has(e.id);
    return h("div", { class: "votes" },
      h("button", { class: "vote up" + (isUp ? " on" : "") + (isUp && D.justVoted === e.id ? " pop" : ""), disabled: mine, "aria-pressed": isUp ? "true" : "false", "aria-label": "Pollice su, " + (T.up[e.id] || 0), onclick: ev => { ev.stopPropagation(); toggleVote(e, 1); } },
        h("span", { "aria-hidden": "true" }, "👍"), h("b", null, String(T.up[e.id] || 0))),
      h("button", { class: "vote down" + (isDown ? " on" : "") + (isDown && D.justVoted === e.id ? " pop" : ""), disabled: mine, "aria-pressed": isDown ? "true" : "false", "aria-label": "Pollice giù, " + (T.down[e.id] || 0), onclick: ev => { ev.stopPropagation(); toggleVote(e, -1); } },
        h("span", { "aria-hidden": "true" }, "👎"), h("b", null, String(T.down[e.id] || 0))));
  };
  const delBtn = e => (e.author === S.me || isCreator) ? h("button", { class: "iconbtn", "aria-label": "Elimina proposta", onclick: async ev => {
    ev.stopPropagation();
    try { await F.deleteDoc(F.doc(fdb, "drafts", d.id, "entries", e.id)); } catch { toast("Non sono riuscito a eliminarla."); }
  } }, "×") : null;

  const votedCount = sorted.filter(e => T.score(e.id) > 0).length;
  const rankPos = {}; sorted.forEach((e, i) => { rankPos[e.id] = i; });

  // Vista chat: in alto le proposte che devi ancora votare (le più recenti prima),
  // sotto quelle già votate o tue, più compatte e ordinate per saldo.
  const myVoted = e => e.author === S.me || myUp.has(e.id) || myDown.has(e.id);
  const toVote = D.entries.filter(e => !myVoted(e)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const done = D.entries.filter(myVoted).sort((a, b) => T.score(b.id) - T.score(a.id) || (b.createdAt || 0) - (a.createdAt || 0));
  const bubbleFor = (e, compact) => {
    const mine = e.author === S.me, sc = T.score(e.id);
    const bubble = h("div", { class: "bubble" + (compact ? " compact" : "") + (rankPos[e.id] < 25 && sc > 0 ? " in" : "") + (sc < 0 ? " neg" : "") },
      h("div", { class: "who-n", style: mine ? null : "color:" + colorOf(e.author) }, (mine ? "Tu" : (e.authorNick || "Giocatore")) + (e.createdAt ? " · " + fmtTime(e.createdAt) : "")),
      h("div", { class: "btext" }, e.text),
      h("div", { class: "bmeta" }, reactBtns(e, mine), h("span", { class: "spacer" }), sc !== 0 && compact ? h("span", { class: "score" + (sc > 0 ? " pos" : " neg") }, (sc > 0 ? "+" : "") + sc) : null, delBtn(e)));
    attachPress(bubble, () => {}, () => openVoters(e));
    return h("div", { class: "msg" + (mine ? " me" : ""), "data-eid": e.id },
      !mine ? h("span", { class: "chip", style: "background:" + colorOf(e.author), "aria-hidden": "true" }, initials(e.authorNick)) : null,
      bubble);
  };
  const doneOpen = D.doneOpen !== false;
  const chat = h("div", { class: "chat", id: "chat" },
    D.entries.length ? [
      h("div", { class: "groupsep", "data-eid": "sep-todo" }, toVote.length ? "Da votare · " + toVote.length : "Hai votato tutto 🎉"),
      toVote.map(e => bubbleFor(e, false)),
      done.length ? h("button", { class: "groupsep toggle", "data-eid": "sep-done", "aria-expanded": doneOpen ? "true" : "false", onclick: () => { D.doneOpen = !doneOpen; renderDraftKeepFocus(); } },
        "Già votate o tue · " + done.length, h("span", { class: "chev" + (doneOpen ? " open" : "") }, "›")) : null,
      doneOpen ? done.map(e => bubbleFor(e, true)) : null,
    ] : h("div", { class: "empty" }, "Ancora nessuna proposta. Scrivi la prima qui sopra: gli altri potranno reagire con 👍 o 👎."));

  // Vista classifica: stesso ordine usato alla chiusura.
  const list = h("div", { class: "elist" }, sorted.length ? sorted.map((e, idx) => {
    const sc = T.score(e.id), mine = e.author === S.me;
    const row = h("div", { class: "entry" + (idx < 25 && sc > 0 ? " in" : "") + (sc < 0 ? " neg" : ""), "data-eid": e.id },
      h("span", { class: "rank" }, String(idx + 1)),
      h("div", { class: "etext" }, h("span", null, e.text), h("small", null, (mine ? "tua proposta" : "di " + (e.authorNick || "Giocatore")) + " · saldo " + (sc > 0 ? "+" : "") + sc)),
      reactBtns(e, mine));
    attachPress(row, () => {}, () => openVoters(e));
    const out = [row];
    if (idx === 24 && sorted.length > 25) out.push(h("div", { class: "cut" }, "Fin qui entrano nel tabellone"));
    return out;
  }) : h("div", { class: "empty" }, "Ancora nessuna proposta."));

  const ppl = Object.entries(D.people).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
  let summary;
  if (!sorted.length) summary = "Servono 25 caselle.";
  else if (votedCount >= 25) summary = sorted.length + " proposte: entrano le 25 con il saldo più alto (👍 meno 👎).";
  else if (sorted.length >= 25) summary = sorted.length + " proposte, " + votedCount + " con saldo positivo: le altre caselle verranno scelte a caso tra quelle senza voti, e solo alla fine tra quelle bocciate.";
  else summary = sorted.length + " proposte su 25 caselle: se non ne arrivano altre, alcune verranno ripetute a caso.";

  const out = [
    topbar([h("button", { class: "btn", onclick: () => openShareDraft(d) }, "Invita")]),
    h("div", { class: "hero" },
      h("div", { class: "section-h" }, "Tabellone in preparazione"),
      h("h1", { style: "font-size:clamp(28px,8vw,42px)" }, d.title || "Bingo")),
    h("div", { class: "countbox" },
      h("div", null, h("div", { class: "section-h" }, expired ? "Scadenza passata" : "Si chiude tra"), h("div", { class: "count", id: "countdown" }, countdownText(d.deadline))),
      h("div", { class: "hint", style: "text-align:right" }, fmtDeadline(d.deadline))),
  ];
  if (expired && !sorted.length) out.push(h("div", { class: "banner warn" }, "Tempo scaduto senza proposte. " + (isCreator ? "Allunga la scadenza qui sotto." : "Il creatore può allungare la scadenza.")));
  out.push(
    h("div", { class: "tabs", role: "tablist" },
      h("button", { class: "tab" + (tab === "chat" ? " on" : ""), role: "tab", "aria-selected": tab === "chat" ? "true" : "false", onclick: () => { D.tab = "chat"; render(); } }, "Proposte (" + sorted.length + ")"),
      h("button", { class: "tab" + (tab === "rank" ? " on" : ""), role: "tab", "aria-selected": tab === "rank" ? "true" : "false", onclick: () => { D.tab = "rank"; render(); } }, "Classifica")),
    h("div", { class: "hint", style: "text-align:left" }, summary + " Tieni premuto su una proposta per vedere chi l'ha votata."));
  if (tab === "chat") out.push(h("div", { class: "compose" }, input, h("button", { class: "btn primary", onclick: submit, "aria-label": "Invia proposta" }, "Invia")), chat);
  else out.push(list);
  out.push(
    h("div", { class: "players" }, h("h3", null, "Partecipanti"), h("div", { class: "plist" }, ppl.length ? ppl.map(([uid, p]) =>
      h("span", { class: "pchip" }, h("span", { class: "chip", style: "background:" + colorOf(uid) }, initials(p.nick)), (p.nick || "Giocatore") + (uid === S.me ? " (tu)" : ""),
        h("span", { class: "n" }, D.entries.filter(e => e.author === uid).length + " prop."))) : h("span", { class: "hint" }, "Ancora nessuno."))));
  if (isCreator) out.push(creatorControls(d, sorted.length));
  return out;
}

function openVoters(e) {
  const ups = [], downs = [];
  for (const [uid, p] of Object.entries(D.people)) {
    if ((p.up || []).includes(e.id)) ups.push([uid, p.nick]);
    if ((p.down || []).includes(e.id)) downs.push([uid, p.nick]);
  }
  const li = ([uid, nick]) => h("li", null, h("span", { class: "chip", style: "background:" + colorOf(uid) }, initials(nick)), (nick || "Giocatore") + (uid === S.me ? " (tu)" : ""));
  openSheet(sheet => {
    sheet.append(h("div", { class: "section-h" }, "Proposta di " + (e.author === S.me ? "te" : (e.authorNick || "Giocatore"))), h("h2", null, e.text),
      h("div", { class: "section-h" }, "👍 " + ups.length), ups.length ? h("ul", { class: "who" }, ups.map(li)) : h("p", { class: "hint", style: "text-align:left;margin:0" }, "Nessuno."),
      h("div", { class: "section-h" }, "👎 " + downs.length), downs.length ? h("ul", { class: "who" }, downs.map(li)) : h("p", { class: "hint", style: "text-align:left;margin:0" }, "Nessuno."),
      h("div", { class: "row", style: "justify-content:flex-end" }, h("button", { class: "btn ghost", onclick: closeSheet }, "Chiudi")));
  });
}

function creatorControls(d, nEntries) {
  const dl = h("input", { class: "input", id: "dr-deadline", type: "datetime-local", value: toLocalInput(Math.max(d.deadline, Date.now() + 3600e3)) });
  const wrap = h("div", { class: "card creator" },
    h("h3", { class: "section-h" }, "Solo per te che l'hai creato"),
    h("div", { class: "field" }, h("label", { for: "dr-deadline" }, "Cambia scadenza"),
      h("div", { class: "addrow" }, dl, h("button", { class: "btn", onclick: async () => {
        const t = new Date(dl.value).getTime();
        if (!t || t < Date.now() + 60e3) { toast("Scegli una scadenza nel futuro."); return; }
        try { await F.updateDoc(F.doc(fdb, "drafts", d.id), { deadline: t }); toast("Scadenza aggiornata"); } catch { toast("Non sono riuscito a cambiarla."); }
      } }, "Salva"))),
    h("div", { class: "row" },
      h("button", { class: "btn primary", disabled: !nEntries, onclick: async ev => {
        ev.currentTarget.disabled = true; toast("Creo il tabellone…"); await finalizeDraft(d.id);
      } }, "Chiudi ora e crea il tabellone"),
      deleteDraftControl(d)));
  return wrap;
}
function deleteDraftControl(d) {
  const wrap = h("div", { class: "row" });
  wrap.append(h("button", { class: "btn ghost danger", onclick: () => {
    wrap.replaceChildren(h("span", { class: "hint" }, "Eliminare per tutti?"),
      h("button", { class: "btn danger", onclick: async () => { try { await F.deleteDoc(F.doc(fdb, "drafts", d.id)); go("#"); } catch { toast("Non sono riuscito a eliminarla."); } } }, "Sì, elimina"),
      h("button", { class: "btn ghost", onclick: () => render() }, "Annulla"));
  } }, "Elimina"));
  return wrap;
}

function openShareDraft(d) {
  const link = draftLink(d.id);
  const text = "Creiamo insieme il tabellone di " + (d.title || "Bingo") + "! Proponi e vota gli eventi qui: " + link;
  const input = h("input", { class: "input", id: "share-link", readonly: true, value: link });
  openSheet(sheet => {
    sheet.append(h("h2", null, "Invita a creare il tabellone"),
      h("p", { class: "hint", style: "text-align:left;margin:0" }, "Chi apre il link può proporre eventi e votare fino alla scadenza. Alla fine riceverà in automatico il tabellone."),
      input,
      h("div", { class: "row", style: "justify-content:flex-end" },
        h("button", { class: "btn ghost", onclick: closeSheet }, "Chiudi"),
        navigator.share ? h("button", { class: "btn", onclick: async () => { try { await navigator.share({ title: d.title, text, url: link }); closeSheet(); } catch {} } }, "Condividi…") : null,
        h("a", { class: "btn", href: "https://wa.me/?text=" + encodeURIComponent(text), target: "_blank", rel: "noopener" }, "WhatsApp"),
        h("button", { class: "btn primary", onclick: async () => {
          try { await navigator.clipboard.writeText(link); toast("Link copiato"); closeSheet(); }
          catch { input.select(); toast("Seleziona e copia il link"); }
        } }, "Copia link")));
  });
}

function openNewChoice() {
  openSheet(sheet => {
    sheet.append(h("h2", null, "Nuovo tabellone"),
      h("button", { class: "choice", onclick: () => { closeSheet(); go("#new"); } },
        h("b", null, "Lo scrivo io"), h("span", null, "Scrivi tu i 25 eventi e poi inviti gli amici a giocare.")),
      h("button", { class: "choice", onclick: () => { closeSheet(); go("#newd"); } },
        h("b", null, "Creiamolo insieme"), h("span", null, "Ognuno propone e vota gli eventi fino a una scadenza. Alla fine entrano i più votati.")));
  });
}

/* ---------- Boot ---------- */
(async function boot() {
  S.route = parseHash();
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) { S.configured = false; render(); return; }
  render();
  const [app, a, f] = await Promise.all([import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js")]);
  F = { ...a, ...f };
  const fbApp = app.initializeApp(firebaseConfig);
  auth = a.getAuth(fbApp);
  try { await a.setPersistence(auth, a.browserLocalPersistence); } catch {}
  try { fdb = f.initializeFirestore(fbApp, { localCache: f.persistentLocalCache() }); } catch { fdb = f.getFirestore(fbApp); }
  a.getRedirectResult(auth).catch(e => { S.authErr = authErrMsg(e); render(); });
  a.onAuthStateChanged(auth, u => {
    S.authReady = true;
    const prev = S.me;
    S.user = u; S.me = u ? u.uid : null;
    if (u) S.myNick = u.displayName || lsGet("sukbingo.nick") || S.myNick || "";
    if (S.me !== prev) {
      stopSubs(); stopDraftSubs(); if (S.boardsUnsub) { S.boardsUnsub(); S.boardsUnsub = null; } if (S.draftsUnsub) { S.draftsUnsub(); S.draftsUnsub = null; }
      S.board = null; S.boardLoaded = false; S.players = {}; S.myMarks = null; S.primed = false; S.prevLines = {}; S.joinedChecked = false;
      if (S.me) { subscribeBoards(); subscribeDrafts(); if (S.route.id) (S.route.name === "draft" ? subscribeDraft : subscribeBoard)(S.route.id); }
    }
    render();
  });
})();

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
