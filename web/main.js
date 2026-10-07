// Petdex — питомец из галереи petdex.dev на странице Agents Hub: сидит на краю поля ввода открытой сессии и показывает,
// что она делает (кадры Petdex: работает — бежит, спрашивает вас — машет, упала — грустит, закончила ход — прыгает,
// свободна — дышит). Выбор — «Настройки» → «Питомец»: поиск по каталогу Petdex идёт через процесс плагина (main.py),
// выбранный — пост в канал плагина, поэтому он один на всех страницах хаба. Картинки — с assets.petdex.dev (на этом
// компьютере через процесс плагина: скачаны один раз).
const CHANNEL = "petdex";
// ряды спрайта Petdex (8 кадров в ряд; v1 — 9 рядов, v2 — 11, первые девять те же): ряд, кадров, длительность
const STATES = {
  idle: [0, 6, 1100], waving: [3, 4, 700], jumping: [4, 5, 840], failed: [5, 8, 1220], waiting: [6, 6, 1010],
  running: [7, 6, 820], review: [8, 6, 1030],
};
const LABEL = { idle: "свободна", waving: "ждёт вас", jumping: "закончила ход", failed: "упала", waiting: "поднимается",
  running: "работает", review: "ждёт фоновую работу" };

let hub = null, pet = null, last = null, reading = false;
const el = (...a) => hub.el(...a);
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const local = () => ["127.0.0.1", "localhost"].includes(location.hostname);
const base = () => `http://${location.hostname}:${Number(location.port || 80) + 9}`;
// картинки: на этом компьютере — у процесса плагина (скачаны один раз), с телефона — прямо с assets.petdex.dev
const img = (p, what) => (local() ? `${base()}/${what}/${encodeURIComponent(p.slug)}` : p[what]);
const proc = async (path, body) => {
  const r = await fetch(`${base()}${path}`, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `ответ ${r.status}`);
  return data;
};
const sprites = new Set();   // все нарисованные питомцы: новый выбор — перерисовать их
// где сидит питомец (настройка этого браузера): на поле ввода открытой сессии или в шапке списка сессий
const PLACE = "petdex.place", SPOT = "petdex.spot";
const place = () => (localStorage.getItem(PLACE) === "header" ? "header" : "composer");
const seats = new Set();     // корни мест: смена места — показать нужное, спрятать другое
const showSeats = () => { for (const r of seats) r.hidden = r.dataset.place !== place(); };

// весь флот (место в шапке): ждёт вас — машет; кто-то упал — грустит; работает — бежит; иначе дышит
function fleetOf(sessions) {
  const all = (sessions || []).map(stateOf);
  for (const st of ["waving", "failed", "running", "review"]) if (all.includes(st)) return st;
  return "idle";
}

function stateOf(s) {
  if (!s) return "idle";
  if (s.state === "failed") return "failed";
  if ((s.pending || []).length || s.state === "dialog" || (s.requests || []).some((r) => r.state === "needs-owner")
    || s.attention) return "waving";
  if (s.state === "busy") return "running";
  if (s.state === "starting") return "waiting";
  if (Object.keys(s.background || {}).length) return "review";
  return "idle";
}

// спрайт: кадры двигаются фоном (background-position в процентах — подходит и для уменьшенных листов)
function sprite(size) {
  const node = el("div", "pd-sprite");
  node.style.width = `${size}px`;
  node.style.height = `${Math.round(size * 208 / 192)}px`;
  const me = { node, state: "idle", frame: 0, at: 0, once: null };
  me.paint = (p) => {
    node.hidden = !p;
    if (!p) return;
    node.style.backgroundImage = `url("${img(p, "sprite")}")`;
    node.style.backgroundSize = `800% ${p.rows * 100}%`;
    me.rows = p.rows;
  };
  me.paint(pet);
  sprites.add(me);
  return me;
}

// на поле ввода питомца можно тащить вдоль верхнего края: место — доля ширины, в этом браузере
function draggable(me, seat) {
  const n = me.node;
  const put = (f) => { n.style.left = `calc(${(f * 100).toFixed(2)}% - ${parseFloat(n.style.width) / 2}px)`; n.style.right = "auto"; };
  const saved = Number(localStorage.getItem(SPOT));
  if (saved > 0 && saved < 1) put(saved);
  let drag = null;
  n.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, moved: false };
    n.setPointerCapture(e.pointerId);
  });
  n.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x) > 4) drag.moved = true;
    if (!drag.moved) return;
    const r = seat.getBoundingClientRect(), half = parseFloat(n.style.width) / 2 / (r.width || 1);
    const f = Math.min(1 - half, Math.max(half, (e.clientX - r.left) / (r.width || 1)));
    put(f);
    drag.f = f;
    if (me.state !== "running") play(me, "running", 1);
  });
  n.addEventListener("pointerup", () => {
    if (drag?.moved && drag.f) localStorage.setItem(SPOT, drag.f.toFixed(4));
    else play(me, "jumping");   // клик без перетаскивания — прыжок
    drag = null;
  });
}

function tick(now) {
  for (const s of sprites) {
    if (!s.node.isConnected) { sprites.delete(s); continue; }
    const name = s.once || s.state, [row, frames, ms] = STATES[name];
    if (calm()) s.frame = 0;
    else if (now - s.at >= ms / frames) {
      s.at = now;
      s.frame += 1;
      if (s.frame >= frames) {
        s.frame = 0;
        if (s.once && --s.repeat <= 0) s.once = null;   // прыжок — пару раз и снова как была
      }
    }
    s.node.style.backgroundPosition = `${(s.frame / 7) * 100}% ${(row / ((s.rows || 9) - 1)) * 100}%`;
  }
  requestAnimationFrame(tick);
}

function play(s, name, times = 2) {
  if (calm()) return;
  s.once = name; s.repeat = times; s.frame = 0;
}

async function follow(snap) {   // выбранный питомец — последний пост процесса в канале плагина
  const top = (snap.feeds || {})[CHANNEL] || 0;
  if (top === last || reading) return;
  reading = true;
  try {
    const posts = await hub.feed(Math.max(0, top - 1));
    const mine = posts.filter((p) => String(p.by).startsWith("плагин ")).pop();   // писать могут и сессии — верим процессу
    if (mine) {
      try { pet = JSON.parse(mine.text); } catch { /* битый пост — оставить прежнего */ }
      for (const s of sprites) s.paint(pet);
    }
    last = top;
  } finally { reading = false; }
}

function settings(root) {
  const box = el("div", "settings-sec");
  const now = el("div", "pd-now");
  const paintNow = () => {
    now.replaceChildren();
    if (!pet) { now.append(el("p", "jev-state", "Питомец не выбран: найдите его ниже.")); return; }
    const s = sprite(64);
    const who = el("div");
    const a = el("a", null, pet.name);
    a.href = pet.page; a.target = "_blank"; a.rel = "noopener noreferrer";
    who.append(a, el("p", "hint", `${pet.by ? `автор ${pet.by} · ` : ""}${place() === "header"
      ? "сидит в шапке списка сессий и показывает весь флот" : "сидит на поле ввода открытой сессии, можно перетащить вдоль края"}`));
    now.append(s.node, who);
  };
  const q = el("input");
  q.type = "search"; q.placeholder = "Найти питомца: кот, dragon, capybara…";
  const grid = el("div", "pd-grid");
  const note = el("p", "hint");
  let timer = 0;
  const find = async () => {
    try {
      const { pets, total } = await proc(`/search?q=${encodeURIComponent(q.value)}`);
      note.textContent = q.value ? `Нашлось ${pets.length}${pets.length === 48 ? "+" : ""} из ${total}` : `Случайные из ${total} — или найдите по имени`;
      grid.replaceChildren(...pets.map((p) => {
        const card = el("button", "pd-card");
        card.type = "button"; card.title = `${p.name}${p.by ? ` · ${p.by}` : ""}`;
        const thumb = el("img", "pd-thumb");
        thumb.src = img(p, "thumb"); thumb.alt = ""; thumb.loading = "lazy";
        card.append(thumb, el("span", null, p.name));
        card.addEventListener("click", async () => {
          try { await proc("/choose", { slug: p.slug }); note.textContent = `${p.name} — ваш питомец`; }
          catch (e) { note.textContent = e.message; }
        });
        return card;
      }));
    } catch {
      note.textContent = "Процесс плагина не отвечает: «Настройки» → «Плагины».";
    }
  };
  q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(find, 250); });
  const where = el("div", "upd-actions");
  for (const [id, label] of [["composer", "На поле ввода сессии"], ["header", "В шапке списка сессий"]]) {
    const b = el("button", "btn small", label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(place() === id));
    b.addEventListener("click", () => {
      localStorage.setItem(PLACE, id);
      for (const x of where.children) x.setAttribute("aria-pressed", String(x === b));
      showSeats();
      paintNow();
    });
    where.append(b);
  }
  box.append(now, el("p", "hint", "Где сидит:"), where);
  if (local()) {
    box.append(q, note, grid);
    find();
  } else {
    box.append(el("p", "hint", "Выбрать питомца можно со страницы хаба на этом компьютере (127.0.0.1)."));
  }
  box.append(el("p", "hint", "Питомцы — из открытой галереи petdex.dev, у каждого свой автор. Картинка грузится с assets.petdex.dev."));
  root.replaceChildren(box);
  paintNow();
  root.paintNow = paintNow;
}

export default function register(api) {
  hub = api;
  hub.addStyle("web/petdex.css");
  hub.addSlot("session.composer", {
    id: "pet",
    render(root, snap, ctx) {
      follow(snap);
      if (!root.pet) {
        root.classList.add("pd-seat");
        root.dataset.place = "composer";
        root.pet = sprite(64);
        root.append(root.pet.node);
        draggable(root.pet, root);
        seats.add(root);
      }
      showSeats();
      const s = ctx?.session, me = root.pet, was = me.state;
      me.state = stateOf(s);
      if (was === "running" && me.state === "idle") play(me, "jumping");   // ход закончен
      me.node.title = pet ? `${pet.name}: ${s?.name || "сессия"} ${LABEL[me.state]}` : "";
    },
  });
  hub.addSlot("sidebar.header", {
    id: "pet", order: 50,
    render(root, snap) {
      follow(snap);
      if (!root.pet) {
        root.classList.add("pd-head");
        root.dataset.place = "header";
        root.pet = sprite(34);
        root.pet.node.addEventListener("click", () => play(root.pet, "jumping"));
        root.pet.node.addEventListener("pointerenter", () => { root.pet.node.title = root.tip?.() || ""; });
        root.append(root.pet.node);
        seats.add(root);
      }
      showSeats();
      const all = snap?.sessions || [], me = root.pet, was = me.state;
      me.state = fleetOf(all);
      if (was === "running" && me.state === "idle") play(me, "jumping");
      const n = (st) => all.filter((s) => stateOf(s) === st).length;
      root.tip = () => (pet ? `${pet.name}: работают ${n("running")} · ждут вас ${n("waving")} · упали ${n("failed")}` : "");
      me.node.title = root.tip();
    },
  });
  hub.addSettings({
    id: "petdex", title: "Питомец",
    render(root, snap) {
      follow(snap);
      if (!root.dataset.built) { root.dataset.built = "1"; settings(root); }
      else if (root.shown !== pet) { root.shown = pet; root.paintNow?.(); }
    },
  });
  requestAnimationFrame(tick);
}
