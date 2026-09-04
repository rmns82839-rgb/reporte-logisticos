// ============================================================
// Reporte Logísticos — sin base de datos, todo en memoria/localStorage
// Cada auxiliar (o doctor escrito a mano) guarda su propio set de
// horas, tubos y papelería, aislado del resto.
// ============================================================

const AUXILIARES = [
  "Cristian", "Iván", "Brenda", "Jonathan", "Marlio",
  "Camilo", "Milena", "Luis", "Edison"
];

// Emoji cuadrado por compañía: se usa aparte de los emojis circulares de los
// tubos para que no se confundan visualmente en el texto plano de WhatsApp
// (ej: 🔴 Rojo tubo vs 🟥 VIP compañía).
const COMPANIES = [
  { key: "vip",    label: "VIP",    css: "c-vip",    emoji: "🟥" },
  { key: "fsfb",   label: "FSFB",   css: "c-fsfb",   emoji: "🟦" },
  { key: "poliza", label: "Poliza", css: "c-poliza", emoji: "🟨" },
];

const TUBOS = [
  { key: "Amarillo",                emoji: "🟡", color: "var(--amarillo)",      text: "text-dark" },
  { key: "Lila",                    emoji: "🟣", color: "var(--lila)",          text: "text-dark" },
  { key: "Azul",                    emoji: "🔵", color: "var(--azul)",          text: "text-light" },
  { key: "Orina",                   emoji: "💧", color: "var(--orina)",         text: "text-dark" },
  { key: "Orina 24h",               emoji: "⏳", color: "var(--orina24)",       text: "text-light" },
  { key: "Rojo",                    emoji: "🔴", color: "var(--rojo)",          text: "text-light" },
  { key: "Materia fecal",           emoji: "🟤", color: "var(--materia-fecal)", text: "text-light" },
  { key: "Saliva",                  emoji: "💦", color: "var(--saliva)",        text: "text-light" },
  { key: "Transparente tapa perlada", emoji: "⚪", color: "var(--transparente)", text: "text-dark" },
  { key: "Otros",                   emoji: "📦", color: "var(--otros)",         text: "text-light" },
];

// División para los dos acordeones de tubos
const TUBOS_A = TUBOS.slice(0, 5);
const TUBOS_B = TUBOS.slice(5);

// División de las 13 franjas fijas de horas para los dos acordeones
const HOURS_SPLIT = 7; // 5:00 AM .. 8:00 AM = 7 franjas; el resto va al segundo grupo

const STORAGE_KEY = "reporte_logisticos_state_v5";
const INSTALL_DISMISS_KEY = "reporte_logisticos_install_dismissed_v1";

function buildFixedHours() {
  const list = [];
  let h = 5, m = 0;
  for (let i = 0; i < 13; i++) {
    list.push({ time: formatTime(h, m), selected: false, company: "vip", cancelled: false, pickup: null, cancelReported: false });
    m += 30;
    if (m >= 60) { m = 0; h += 1; }
  }
  return list;
}

function formatTime(h, m) {
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

function emptyTubeState() {
  const t = {};
  TUBOS.forEach(tb => {
    t[tb.key] = { vip: 0, fsfb: 0, poliza: 0 };
  });
  return t;
}

function mergeTubeCounts(a, b) {
  const merged = emptyTubeState();
  TUBOS.forEach(tb => {
    merged[tb.key].vip = (a[tb.key]?.vip || 0) + (b[tb.key]?.vip || 0);
    merged[tb.key].fsfb = (a[tb.key]?.fsfb || 0) + (b[tb.key]?.fsfb || 0);
    merged[tb.key].poliza = (a[tb.key]?.poliza || 0) + (b[tb.key]?.poliza || 0);
  });
  return merged;
}

// ---------------- Estado: uno por auxiliar ----------------
function localDateKey(d) {
  d = d || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

let extraIdCounter = 0;
function nextExtraId() {
  extraIdCounter += 1;
  return "e" + Date.now() + "_" + extraIdCounter;
}

function freshAuxData() {
  return {
    activeDate: localDateKey(),
    hours: buildFixedHours(),
    extras: [],
    tubes: emptyTubeState(),
    tubesReported: emptyTubeState(), // acumulado de recogidas ya enviadas hoy
    otrosDetalle: "",
    papeleria: [],
    pickupsToday: { date: localDateKey(), count: 0 },
    pickupLog: [], // historial de lo enviado, para poder deshacer la última recogida
  };
}

function freshState() {
  return {
    auxIndex: null,   // número (índice en AUXILIARES) | "custom" | null
    customName: "",
    byAux: {},        // clave -> freshAuxData()
  };
}

let state = loadState() || freshState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.byAux || typeof parsed.byAux !== "object") return null;
    if (typeof parsed.customName !== "string") parsed.customName = "";
    if (typeof parsed.auxIndex !== "number" && parsed.auxIndex !== "custom") parsed.auxIndex = null;

    Object.keys(parsed.byAux).forEach(key => {
      const d = parsed.byAux[key];
      if (!d || !d.tubes || !d.hours) { delete parsed.byAux[key]; return; }
      TUBOS.forEach(tb => {
        if (!d.tubes[tb.key]) d.tubes[tb.key] = { vip: 0, fsfb: 0, poliza: 0 };
      });
      if (!d.tubesReported) d.tubesReported = emptyTubeState();
      TUBOS.forEach(tb => {
        if (!d.tubesReported[tb.key]) d.tubesReported[tb.key] = { vip: 0, fsfb: 0, poliza: 0 };
      });
      if (typeof d.otrosDetalle !== "string") d.otrosDetalle = "";
      if (!Array.isArray(d.extras)) d.extras = [];
      if (!Array.isArray(d.papeleria)) d.papeleria = [];
      if (!Array.isArray(d.hours) || d.hours.some(h => typeof h.selected === "undefined")) {
        delete parsed.byAux[key];
        return;
      }
      d.hours.forEach(h => {
        if (typeof h.cancelled !== "boolean") h.cancelled = false;
        if (typeof h.pickup === "undefined") h.pickup = null;
        if (typeof h.cancelReported !== "boolean") h.cancelReported = false;
      });
      d.extras.forEach(e => {
        if (typeof e.pickup === "undefined") e.pickup = null;
        if (!e.id) e.id = nextExtraId();
      });
      if (!d.pickupsToday || typeof d.pickupsToday.count !== "number") {
        d.pickupsToday = { date: localDateKey(), count: 0 };
      }
      if (!Array.isArray(d.pickupLog)) d.pickupLog = [];
      if (typeof d.activeDate !== "string") d.activeDate = localDateKey();
    });
    return parsed;
  } catch (e) {
    return null;
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) { /* almacenamiento no disponible, seguimos sin persistir */ }
}

function currentAuxKey() {
  if (state.auxIndex === "custom") return "custom";
  if (typeof state.auxIndex === "number") return "fixed:" + AUXILIARES[state.auxIndex];
  return null;
}

function currentAuxName() {
  if (state.auxIndex === "custom") return (state.customName || "").trim() || "(sin nombre)";
  if (typeof state.auxIndex === "number") return AUXILIARES[state.auxIndex];
  return "(sin seleccionar)";
}

// Devuelve (y crea si hace falta) los datos del auxiliar activo.
// Si no hay auxiliar seleccionado, entrega un set vacío sin persistirlo.
// Si los datos guardados son de un día anterior, se reinician solos para
// que nunca se mezclen horas/tubos de ayer con los de hoy.
let dayResetHappened = false;
function currentData() {
  const key = currentAuxKey();
  if (!key) return freshAuxData();
  if (!state.byAux[key]) state.byAux[key] = freshAuxData();
  const data = state.byAux[key];
  const today = localDateKey();
  if (data.activeDate !== today) {
    state.byAux[key] = freshAuxData();
    dayResetHappened = true;
    saveState();
    return state.byAux[key];
  }
  return data;
}

function ensurePickupsToday(data) {
  const today = localDateKey();
  if (!data.pickupsToday || data.pickupsToday.date !== today) {
    data.pickupsToday = { date: today, count: 0 };
  }
}

// Se llama al copiar/enviar el reporte: todo lo que esté marcado como
// recibido pero que aún no pertenezca a ninguna recogida pasa a formar
// la siguiente (1ra, 2da, 3ra... del día), y los cancelados pendientes
// quedan marcados como ya informados. Así el próximo reporte que se
// envíe no repite lo que ya se mandó en este. Queda un registro de todo
// lo que cambió para poder deshacerlo con "Deshacer última recogida".
function registerSendBatch(data) {
  ensurePickupsToday(data);

  const hourIndices = [];
  data.hours.forEach((h, i) => { if (h.selected && !h.pickup) hourIndices.push(i); });
  const extraIds = [];
  data.extras.forEach(e => { if (e.company && e.time && !e.pickup) extraIds.push(e.id); });

  let pickupNum = null;
  if (hourIndices.length > 0 || extraIds.length > 0) {
    data.pickupsToday.count += 1;
    pickupNum = data.pickupsToday.count;
    hourIndices.forEach(i => { data.hours[i].pickup = pickupNum; });
    data.extras.forEach(e => { if (extraIds.includes(e.id)) e.pickup = pickupNum; });
  }

  const cancelledHourIndices = [];
  data.hours.forEach((h, i) => {
    if (h.cancelled && !h.cancelReported) {
      h.cancelReported = true;
      cancelledHourIndices.push(i);
    }
  });

  // los tubos de esta recogida pasan al acumulado del día y el contador
  // visible se reinicia en 0 para la siguiente recogida
  const tubeDelta = {};
  let tubesNonZero = false;
  TUBOS.forEach(tb => {
    const c = data.tubes[tb.key];
    tubeDelta[tb.key] = { vip: c.vip, fsfb: c.fsfb, poliza: c.poliza };
    if (c.vip || c.fsfb || c.poliza) tubesNonZero = true;
    const r = data.tubesReported[tb.key];
    r.vip += c.vip;
    r.fsfb += c.fsfb;
    r.poliza += c.poliza;
  });
  data.tubes = emptyTubeState();

  if (hourIndices.length > 0 || extraIds.length > 0 || cancelledHourIndices.length > 0 || tubesNonZero) {
    if (!Array.isArray(data.pickupLog)) data.pickupLog = [];
    data.pickupLog.push({ pickupNum, hourIndices, extraIds, cancelledHourIndices, tubeDelta });
  }
}

// Revierte exactamente lo que registró el último envío/copia: desasigna
// el número de recogida de esas horas, regresa los tubos de esa recogida
// al contador visible (restándolos del acumulado), y desmarca los
// cancelados que se habían dado por informados. Devuelve true si deshizo algo.
function undoLastPickup(data) {
  if (!Array.isArray(data.pickupLog) || data.pickupLog.length === 0) return false;
  const last = data.pickupLog.pop();

  last.hourIndices.forEach(i => {
    if (data.hours[i]) data.hours[i].pickup = null;
  });
  last.extraIds.forEach(id => {
    const e = data.extras.find(x => x.id === id);
    if (e) e.pickup = null;
  });
  last.cancelledHourIndices.forEach(i => {
    if (data.hours[i]) data.hours[i].cancelReported = false;
  });

  TUBOS.forEach(tb => {
    const d = last.tubeDelta[tb.key];
    if (!d) return;
    data.tubesReported[tb.key].vip -= d.vip;
    data.tubesReported[tb.key].fsfb -= d.fsfb;
    data.tubesReported[tb.key].poliza -= d.poliza;
    data.tubes[tb.key].vip += d.vip;
    data.tubes[tb.key].fsfb += d.fsfb;
    data.tubes[tb.key].poliza += d.poliza;
  });

  if (typeof last.pickupNum === "number" && data.pickupsToday.count === last.pickupNum) {
    data.pickupsToday.count -= 1;
  }
  return true;
}

// Antes de copiar/enviar: si hay horas nuevas marcadas como recibidas pero
// no se ha registrado ningún tubo, algo probablemente quedó a medias —
// se bloquea el envío y se pide completar o marcar la hora como cancelada.
function validateBeforeSend(data) {
  const pendingReceived = data.hours.filter(h => h.selected && !h.pickup)
    .concat(data.extras.filter(e => e.company && e.time && !e.pickup));

  if (pendingReceived.length === 0) return null;

  const totalTubes = TUBOS.reduce((sum, tb) => {
    const c = data.tubes[tb.key];
    return sum + c.vip + c.fsfb + c.poliza;
  }, 0);

  if (totalTubes === 0) {
    return "Registra al menos un tubo antes de enviar, o marca esa hora como cancelada (✕).";
  }
  return null;
}

// ---------------- Efecto ripple (delegado, cubre botones creados dinámicamente) ----------------
const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function spawnRipple(el, x, y) {
  if (prefersReducedMotion) return;
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 1.5;
  const ripple = document.createElement("span");
  ripple.className = "ripple";
  ripple.style.width = ripple.style.height = size + "px";
  ripple.style.left = (x - rect.left - size / 2) + "px";
  ripple.style.top = (y - rect.top - size / 2) + "px";
  el.appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove());
  setTimeout(() => ripple.remove(), 700);
}

document.addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".btn, .icon-btn, .aux-chip, .step-btn, .cancel-btn, .ghost-btn, .del-btn, .aux-other-btn, .place-btn, .btn-secondary-sm, .status-btn");
  if (!el || el.disabled) return;
  spawnRipple(el, e.clientX, e.clientY);
});

// Pequeño "kick" de escala para dar feedback físico al marcar/cancelar algo.
// Como cada render reconstruye el DOM desde cero, guardamos cuál fue la
// última hora/tubo tocado y le aplicamos la animación justo en su recreación.
let lastToggledHourIndex = null;
let lastToggledTube = null; // { key, company }

// ---------------- DOM refs ----------------
const auxGrid = document.getElementById("auxGrid");
const auxOtherBtn = document.getElementById("auxOtherBtn");
const auxOtherWrap = document.getElementById("auxOtherWrap");
const auxOtherInput = document.getElementById("auxOtherInput");

const hourGridA = document.getElementById("hourGridA");
const hourGridB = document.getElementById("hourGridB");
const hourBadgeA = document.getElementById("hourBadgeA");
const hourBadgeB = document.getElementById("hourBadgeB");
const pickupInfo = document.getElementById("pickupInfo");
const undoPickupBtn = document.getElementById("undoPickupBtn");
const extraList = document.getElementById("extraList");
const addExtraBtn = document.getElementById("addExtraBtn");

const tubeListA = document.getElementById("tubeListA");
const tubeListB = document.getElementById("tubeListB");
const tubeBadgeA = document.getElementById("tubeBadgeA");
const tubeBadgeB = document.getElementById("tubeBadgeB");
const tubesInfo = document.getElementById("tubesInfo");

const papeleriaList = document.getElementById("papeleriaList");
const addPapeleriaBtn = document.getElementById("addPapeleriaBtn");

const preview = document.getElementById("preview");
const copyBtn = document.getElementById("copyBtn");
const sendBtn = document.getElementById("sendBtn");
const resetBtn = document.getElementById("resetBtn");
const toast = document.getElementById("toast");
const statsStrip = document.getElementById("statsStrip");

const installBtn = document.getElementById("installBtn");
const installModal = document.getElementById("installModal");
const installModalAndroid = document.getElementById("installModalAndroid");
const installModalIOS = document.getElementById("installModalIOS");
const installConfirmBtn = document.getElementById("installConfirmBtn");
const installModalClose = document.getElementById("installModalClose");
const installModalDismiss = document.getElementById("installModalDismiss");

const summaryBtn = document.getElementById("summaryBtn");
const summaryModal = document.getElementById("summaryModal");
const summaryModalClose = document.getElementById("summaryModalClose");
const summaryContent = document.getElementById("summaryContent");

const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");
const importFile = document.getElementById("importFile");

// ---------------- Render: Auxiliares ----------------
const AUX_COLORS = ["#4A8DFB", "#F1453B", "#FFB020", "#1FD290", "#C58CF0", "#3FAFA6", "#F0C33C", "#E29A3E", "#8C9BFF"];
function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AUX_COLORS[Math.abs(hash) % AUX_COLORS.length];
}

function initials(name) {
  return name.slice(0, 2).toUpperCase();
}

let lastSelectedAux = null; // recuerda el chip recién tocado para el efecto "pop"

function selectAux(i) {
  state.auxIndex = i;
  lastSelectedAux = i;
  saveState();
  renderAll();
}

function renderAux() {
  auxGrid.innerHTML = "";
  AUXILIARES.forEach((name, i) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "aux-chip" + (state.auxIndex === i ? " active" : "") + (i === lastSelectedAux ? " pop" : "");
    chip.innerHTML = `<span class="avatar" style="background:${avatarColor(name)}">${initials(name)}</span><span>${name}</span>`;
    chip.addEventListener("click", () => selectAux(i));
    auxGrid.appendChild(chip);
  });

  const otherActive = state.auxIndex === "custom";
  auxOtherBtn.classList.toggle("active", otherActive);
  auxOtherBtn.setAttribute("aria-pressed", String(otherActive));
  auxOtherWrap.hidden = !otherActive;
  if (auxOtherInput.value !== (state.customName || "")) {
    auxOtherInput.value = state.customName || "";
  }
  lastSelectedAux = null;
}

auxOtherBtn.addEventListener("click", () => {
  state.auxIndex = "custom";
  saveState();
  renderAll();
  auxOtherInput.focus();
});

auxOtherInput.addEventListener("input", () => {
  state.customName = auxOtherInput.value;
  saveState();
  renderPreview();
});

// ---------------- Select de compañía (VIP por defecto, sin opción vacía) ----------------
function buildCompanySelect(currentValue, onChange) {
  const select = document.createElement("select");
  select.className = "company-select";

  COMPANIES.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.key;
    opt.textContent = c.label;
    select.appendChild(opt);
  });

  select.value = currentValue || "vip";
  applyCompanyClass(select, select.value);

  select.addEventListener("change", () => {
    applyCompanyClass(select, select.value);
    onChange(select.value);
  });

  return select;
}

function applyCompanyClass(select, value) {
  select.classList.remove("c-vip", "c-fsfb", "c-poliza");
  const found = COMPANIES.find(c => c.key === value);
  if (found) select.classList.add(found.css);
}

// ---------------- Render: Horas fijas (dos acordeones) ----------------
function renderHourGroup(container, data, start, end) {
  container.innerHTML = "";
  for (let i = start; i < end; i++) {
    const slot = data.hours[i];
    const row = document.createElement("div");
    row.className = "hour-row"
      + (slot.selected ? " is-set" : "")
      + (slot.cancelled ? " is-cancelled" : "")
      + (slot.pickup ? " is-reported" : "")
      + (i === lastToggledHourIndex ? " pop" : "");

    const label = document.createElement("span");
    label.className = "hour-time";
    label.textContent = slot.time;

    let cornerTag = null;
    if (slot.pickup) {
      cornerTag = document.createElement("span");
      cornerTag.className = "pickup-tag";
      cornerTag.title = `Ya se envió en la recogida ${slot.pickup}`;
      cornerTag.textContent = `R${slot.pickup}`;
    } else if (slot.cancelled && slot.cancelReported) {
      cornerTag = document.createElement("span");
      cornerTag.className = "pickup-tag pickup-tag-cancel";
      cornerTag.title = "Esta cancelación ya se informó en un reporte anterior";
      cornerTag.textContent = "✔";
    }

    // dos botones separados: ✓ Recibido / ✕ Cancelado (mutuamente excluyentes),
    // con el desplegable de compañía (o la etiqueta de cancelado) entre medio
    const receivedBtn = document.createElement("button");
    receivedBtn.type = "button";
    receivedBtn.className = "status-btn status-received" + (slot.selected ? " active" : "");
    receivedBtn.setAttribute("aria-pressed", String(!!slot.selected));
    receivedBtn.title = slot.selected ? "Recibido — toca para deshacer" : "Marcar como recibido";
    receivedBtn.textContent = "✓";
    receivedBtn.addEventListener("click", () => {
      const nowSelected = !data.hours[i].selected;
      data.hours[i].selected = nowSelected;
      if (nowSelected) data.hours[i].cancelled = false;
      lastToggledHourIndex = i;
      saveState();
      renderHours();
      renderPreview();
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "status-btn status-cancel" + (slot.cancelled ? " active" : "");
    cancelBtn.setAttribute("aria-pressed", String(!!slot.cancelled));
    cancelBtn.title = slot.cancelled ? "Cancelado — toca para deshacer" : "Marcar como cancelado";
    cancelBtn.textContent = "✕";
    cancelBtn.addEventListener("click", () => {
      const nowCancelled = !data.hours[i].cancelled;
      data.hours[i].cancelled = nowCancelled;
      if (nowCancelled) data.hours[i].selected = false;
      lastToggledHourIndex = i;
      saveState();
      renderHours();
      renderPreview();
    });

    // desplegable de compañía: siempre elegible, sin importar si ya está
    // recibida, cancelada, o aún sin tocar — así se puede escoger la
    // compañía antes de confirmar o incluso para una hora cancelada
    const select = buildCompanySelect(slot.company, (val) => {
      data.hours[i].company = val;
      saveState();
      renderPreview();
    });

    row.appendChild(label);
    row.appendChild(receivedBtn);
    row.appendChild(select);
    row.appendChild(cancelBtn);
    if (cornerTag) row.appendChild(cornerTag);
    container.appendChild(row);
  }
}

function renderHours() {
  const data = currentData();
  renderHourGroup(hourGridA, data, 0, HOURS_SPLIT);
  renderHourGroup(hourGridB, data, HOURS_SPLIT, data.hours.length);
  lastToggledHourIndex = null;

  const countA = data.hours.slice(0, HOURS_SPLIT).filter(h => h.selected).length;
  const countB = data.hours.slice(HOURS_SPLIT).filter(h => h.selected).length;
  hourBadgeA.textContent = `${countA}/${HOURS_SPLIT}`;
  hourBadgeB.textContent = `${countB}/${data.hours.length - HOURS_SPLIT}`;

  ensurePickupsToday(data);
  const pendingNew = data.hours.filter(h => h.selected && !h.pickup).length
    + data.extras.filter(e => e.company && e.time && !e.pickup).length;

  if (data.pickupsToday.count > 0) {
    pickupInfo.hidden = false;
    pickupInfo.textContent = pendingNew > 0
      ? `✅ Recogida ${data.pickupsToday.count} ya enviada — lo que marques ahora será la recogida ${data.pickupsToday.count + 1}`
      : `✅ Recogida ${data.pickupsToday.count} ya enviada — al día, nada pendiente por enviar`;
  } else {
    pickupInfo.hidden = true;
  }

  undoPickupBtn.hidden = !(Array.isArray(data.pickupLog) && data.pickupLog.length > 0);
}

// ---------------- Render: Horas extra ----------------
function renderExtras() {
  const data = currentData();
  extraList.innerHTML = "";
  data.extras.forEach((extra, i) => {
    const row = document.createElement("div");
    row.className = "extra-row";

    const timeInput = document.createElement("input");
    timeInput.type = "time";
    timeInput.value = extra.time || "";
    timeInput.addEventListener("change", () => {
      data.extras[i].time = timeInput.value;
      saveState();
      renderPreview();
    });

    const select = buildCompanySelect(extra.company, (val) => {
      data.extras[i].company = val;
      saveState();
      renderPreview();
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "del-btn";
    delBtn.title = "Eliminar";
    delBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 7h12l-1 14H7L6 7zm3-4h6l1 2h4v2H2V5h4l1-2z"/></svg>`;
    delBtn.addEventListener("click", () => {
      data.extras.splice(i, 1);
      saveState(); renderExtras(); renderPreview();
    });

    row.appendChild(timeInput);
    row.appendChild(select);
    row.appendChild(delBtn);
    extraList.appendChild(row);
  });
}

addExtraBtn.addEventListener("click", () => {
  const data = currentData();
  data.extras.push({ time: "", company: "vip", pickup: null, id: nextExtraId() });
  saveState();
  renderExtras();
});

// ---------------- Render: Tubos (dos acordeones) ----------------
// Toque normal = suma/resta de a 1 (preciso). Mantener presionado = repite
// solo, cada vez más rápido, para contar cantidades grandes sin tocar
// muchas veces. Mientras se mantiene presionado se actualiza el número
// directamente en el DOM (sin reconstruir la lista) para no perder el
// botón que se está tocando; el guardado y el re-render completo (con el
// "pop" de feedback) ocurren al soltar.
// Burbuja flotante que muestra el número grande ARRIBA del dedo mientras
// se mantiene presionado, para que el dedo nunca tape el conteo.
let holdBubble = null;

function showHoldBubble(btn, text) {
  if (!holdBubble) {
    holdBubble = document.createElement("div");
    holdBubble.className = "hold-bubble";
    document.body.appendChild(holdBubble);
  }
  const rect = btn.getBoundingClientRect();
  holdBubble.style.left = (rect.left + rect.width / 2) + "px";
  holdBubble.style.top = rect.top + "px";
  holdBubble.textContent = text;
  holdBubble.classList.add("show");
}

function updateHoldBubble(text) {
  if (holdBubble && holdBubble.classList.contains("show")) {
    holdBubble.textContent = text;
  }
}

function hideHoldBubble() {
  if (holdBubble) holdBubble.classList.remove("show");
}

function bindHoldStepper(btn, step, getCount, setCount, valueEl, totalEl, getTotal, onRelease) {
  let holdTimeout = null;
  let holdInterval = null;
  let changed = false;

  function tick() {
    setCount(Math.max(0, getCount() + step));
    valueEl.textContent = getCount();
    if (totalEl) totalEl.textContent = `Total: ${getTotal()}`;
    updateHoldBubble(String(getCount()));
    changed = true;
  }

  function start(e) {
    e.preventDefault();
    tick();
    showHoldBubble(btn, String(getCount()));
    holdTimeout = setTimeout(() => {
      holdInterval = setInterval(tick, 100);
    }, 420);
  }

  function stop() {
    clearTimeout(holdTimeout);
    clearInterval(holdInterval);
    holdTimeout = null;
    holdInterval = null;
    hideHoldBubble();
    if (changed) {
      changed = false;
      onRelease();
    }
  }

  btn.addEventListener("pointerdown", start);
  btn.addEventListener("pointerup", stop);
  btn.addEventListener("pointerleave", stop);
  btn.addEventListener("pointercancel", stop);
}

function renderTubeGroup(container, data, group) {
  container.innerHTML = "";
  group.forEach(tb => {
    const counts = data.tubes[tb.key];
    const total = counts.vip + counts.fsfb + counts.poliza;

    const row = document.createElement("div");
    row.className = `tube-row ${tb.text}`;
    row.style.backgroundColor = tb.color;

    const head = document.createElement("div");
    head.className = "tube-head";
    head.innerHTML = `<span>${tb.emoji} ${tb.key}</span><span class="tube-total">Total: ${total}</span>`;
    const totalEl = head.querySelector(".tube-total");
    row.appendChild(head);

    const trio = document.createElement("div");
    trio.className = "stepper-trio";

    COMPANIES.forEach(c => {
      const box = document.createElement("div");
      box.className = `stepper co-${c.key}` + (lastToggledTube && lastToggledTube.key === tb.key && lastToggledTube.company === c.key ? " pop" : "");
      box.innerHTML = `
        <span class="stepper-label"><i class="co-dot co-dot-${c.key}"></i>${c.label}</span>
        <div class="stepper-controls">
          <button type="button" class="step-btn minus">–</button>
          <span class="step-value">${counts[c.key]}</span>
          <button type="button" class="step-btn plus">+</button>
        </div>`;

      const valueEl = box.querySelector(".step-value");
      const getTotal = () => counts.vip + counts.fsfb + counts.poliza;
      const onRelease = () => {
        lastToggledTube = { key: tb.key, company: c.key };
        saveState();
        renderTubes();
        renderPreview();
      };

      bindHoldStepper(
        box.querySelector(".minus"), -1,
        () => counts[c.key], (v) => { counts[c.key] = v; },
        valueEl, totalEl, getTotal, onRelease
      );
      bindHoldStepper(
        box.querySelector(".plus"), 1,
        () => counts[c.key], (v) => { counts[c.key] = v; },
        valueEl, totalEl, getTotal, onRelease
      );

      trio.appendChild(box);
    });

    row.appendChild(trio);

    if (tb.key === "Otros" && total > 0) {
      const noteWrap = document.createElement("div");
      noteWrap.className = "otros-note";
      const noteInput = document.createElement("input");
      noteInput.type = "text";
      noteInput.placeholder = "¿Qué es? (ej: tubo especial, jeringa...)";
      noteInput.value = data.otrosDetalle || "";
      noteInput.addEventListener("input", () => {
        data.otrosDetalle = noteInput.value;
        saveState();
        renderPreview();
      });
      noteWrap.appendChild(noteInput);
      row.appendChild(noteWrap);
    }

    container.appendChild(row);
  });
}

function sumTubeGroup(data, group) {
  let n = 0;
  group.forEach(tb => {
    const c = data.tubes[tb.key];
    n += c.vip + c.fsfb + c.poliza;
  });
  return n;
}

function renderTubes() {
  const data = currentData();
  renderTubeGroup(tubeListA, data, TUBOS_A);
  renderTubeGroup(tubeListB, data, TUBOS_B);
  lastToggledTube = null;
  tubeBadgeA.textContent = sumTubeGroup(data, TUBOS_A);
  tubeBadgeB.textContent = sumTubeGroup(data, TUBOS_B);

  let reportedTotal = 0;
  TUBOS.forEach(tb => {
    const r = data.tubesReported[tb.key];
    reportedTotal += r.vip + r.fsfb + r.poliza;
  });
  if (reportedTotal > 0) {
    tubesInfo.hidden = false;
    tubesInfo.textContent = `✅ Ya enviaste ${reportedTotal} tubos hoy — el contador de abajo se reinició para la siguiente recogida`;
  } else {
    tubesInfo.hidden = true;
  }
}

// ---------------- Render: Papelería para doctores ----------------
function renderPapeleria() {
  const data = currentData();
  papeleriaList.innerHTML = "";
  data.papeleria.forEach((item, i) => {
    const row = document.createElement("div");
    row.className = "papeleria-row";

    const tipoInput = document.createElement("input");
    tipoInput.type = "text";
    tipoInput.setAttribute("list", "papeleriaSugerencias");
    tipoInput.placeholder = "Tipo de documento (ej: Electrocardiograma)";
    tipoInput.value = item.tipo || "";
    tipoInput.addEventListener("input", () => {
      data.papeleria[i].tipo = tipoInput.value;
      saveState();
      renderPreview();
    });

    const subRow = document.createElement("div");
    subRow.className = "papeleria-sub";

    const doctorInput = document.createElement("input");
    doctorInput.type = "text";
    doctorInput.placeholder = "Doctor(a) que entrega";
    doctorInput.value = item.doctor || "";
    doctorInput.addEventListener("input", () => {
      data.papeleria[i].doctor = doctorInput.value;
      saveState();
      renderPreview();
    });

    const qtyWrap = document.createElement("div");
    qtyWrap.className = "stepper-controls";
    qtyWrap.innerHTML = `
      <button type="button" class="step-btn minus">–</button>
      <span class="step-value">${item.cantidad || 1}</span>
      <button type="button" class="step-btn plus">+</button>`;
    qtyWrap.querySelector(".minus").addEventListener("click", () => {
      data.papeleria[i].cantidad = Math.max(1, (data.papeleria[i].cantidad || 1) - 1);
      saveState(); renderPapeleria(); renderPreview();
    });
    qtyWrap.querySelector(".plus").addEventListener("click", () => {
      data.papeleria[i].cantidad = (data.papeleria[i].cantidad || 1) + 1;
      saveState(); renderPapeleria(); renderPreview();
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "del-btn";
    delBtn.title = "Eliminar";
    delBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 7h12l-1 14H7L6 7zm3-4h6l1 2h4v2H2V5h4l1-2z"/></svg>`;
    delBtn.addEventListener("click", () => {
      data.papeleria.splice(i, 1);
      saveState(); renderPapeleria(); renderPreview();
    });

    subRow.appendChild(doctorInput);
    subRow.appendChild(qtyWrap);
    subRow.appendChild(delBtn);

    row.appendChild(tipoInput);
    row.appendChild(subRow);
    papeleriaList.appendChild(row);
  });
}

addPapeleriaBtn.addEventListener("click", () => {
  const data = currentData();
  data.papeleria.push({ tipo: "", doctor: "", cantidad: 1 });
  saveState();
  renderPapeleria();
});

// ---------------- Mensaje / preview ----------------
function companyLabel(key) {
  const found = COMPANIES.find(c => c.key === key);
  return found ? found.label : key;
}

function companyEmoji(key) {
  const found = COMPANIES.find(c => c.key === key);
  return found ? found.emoji : "";
}

function todayLabel() {
  const raw = new Date().toLocaleDateString("es-CO", {
    weekday: "long", day: "numeric", month: "long",
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function buildMessage(data, opts) {
  opts = opts || {};
  const forSend = !!opts.forSend;
  data = data || currentData();
  const auxName = currentAuxName();

  // en la vista previa del día se suman los tubos ya enviados en recogidas
  // pasadas + lo que llevas contado ahora; al enviar, solo se reporta lo
  // que llevas contado en este momento (la recogida actual)
  const tubesSource = forSend ? data.tubes : mergeTubeCounts(data.tubesReported, data.tubes);

  const relevantHours = forSend
    ? data.hours.filter(h => h.selected && !h.pickup)
    : data.hours.filter(h => h.selected);
  const relevantExtras = forSend
    ? data.extras.filter(e => e.company && e.time && !e.pickup)
    : data.extras.filter(e => e.company && e.time);
  const relevantCancelled = forSend
    ? data.hours.filter(h => h.cancelled && !h.cancelReported)
    : data.hours.filter(h => h.cancelled);

  const lines = [];
  lines.push("📋 *Reporte de recepción de muestras*");
  lines.push(`📅 ${todayLabel()}`);
  lines.push(`👤 Auxiliar: ${auxName}`);
  lines.push("");
  lines.push("⏰ *Horas:*");

  if (relevantHours.length === 0 && relevantExtras.length === 0) {
    lines.push(forSend ? "• Nada nuevo por reportar" : "• Sin horas marcadas");
  } else if (forSend) {
    // reporte de una sola recogida (la actual): lista simple, sin agrupar
    relevantHours.forEach(h => {
      lines.push(`• ${h.time} — ${companyEmoji(h.company)} ${companyLabel(h.company).toUpperCase()}`);
    });
    relevantExtras.forEach(e => {
      lines.push(`• ${formatExtraTime(e.time)} — ${companyEmoji(e.company)} ${companyLabel(e.company).toUpperCase()} (extra)`);
    });
  } else {
    // vista previa completa del día: agrupar por número de recogida;
    // lo marcado pero aún no enviado queda como "pendiente"
    const groups = {};
    const pendingLines = [];

    relevantHours.forEach(h => {
      const line = `• ${h.time} — ${companyEmoji(h.company)} ${companyLabel(h.company).toUpperCase()}`;
      if (h.pickup) { (groups[h.pickup] = groups[h.pickup] || []).push(line); }
      else pendingLines.push(line);
    });
    relevantExtras.forEach(e => {
      const line = `• ${formatExtraTime(e.time)} — ${companyEmoji(e.company)} ${companyLabel(e.company).toUpperCase()} (extra)`;
      if (e.pickup) { (groups[e.pickup] = groups[e.pickup] || []).push(line); }
      else pendingLines.push(line);
    });

    const pickupNums = Object.keys(groups).map(Number).sort((a, b) => a - b);
    const multiPickup = pickupNums.length > 1 || (pickupNums.length >= 1 && pendingLines.length > 0);

    if (!multiPickup) {
      const only = pickupNums.length ? groups[pickupNums[0]] : [];
      [...only, ...pendingLines].forEach(l => lines.push(l));
    } else {
      pickupNums.forEach(num => {
        lines.push(`🔁 *Recogida ${num}:*`);
        groups[num].forEach(l => lines.push(l));
        lines.push("");
      });
      if (pendingLines.length) {
        const nextNum = (pickupNums[pickupNums.length - 1] || 0) + 1;
        lines.push(`🕓 *Sin enviar aún (será la recogida ${nextNum}):*`);
        pendingLines.forEach(l => lines.push(l));
      } else {
        lines.pop();
      }
    }
  }

  if (relevantCancelled.length > 0) {
    lines.push("");
    lines.push("❌ *Cancelados:*");
    relevantCancelled.forEach(h => {
      lines.push(`• ${h.time} — ${companyEmoji(h.company)} ${companyLabel(h.company).toUpperCase()}`);
    });
  }

  lines.push("");
  lines.push("🧪 *Tubos recibidos:*");
  const tubesWithTotal = TUBOS.map(tb => {
    const c = tubesSource[tb.key];
    return { ...tb, total: c.vip + c.fsfb + c.poliza };
  }).filter(tb => tb.total > 0);

  if (tubesWithTotal.length === 0) {
    lines.push("• Sin tubos registrados");
  } else {
    tubesWithTotal.forEach(tb => {
      if (tb.key === "Otros" && data.otrosDetalle.trim()) {
        lines.push(`${tb.emoji} ${tb.key}: ${tb.total} (${data.otrosDetalle.trim()})`);
      } else {
        lines.push(`${tb.emoji} ${tb.key}: ${tb.total}`);
      }
    });
  }

  const patientTotals = { vip: 0, fsfb: 0, poliza: 0 };
  relevantHours.forEach(h => patientTotals[h.company]++);
  relevantExtras.forEach(e => patientTotals[e.company]++);

  const tubeTotals = { vip: 0, fsfb: 0, poliza: 0 };
  TUBOS.forEach(tb => {
    const c = tubesSource[tb.key];
    tubeTotals.vip += c.vip;
    tubeTotals.fsfb += c.fsfb;
    tubeTotals.poliza += c.poliza;
  });

  const patientLine = COMPANIES
    .filter(c => patientTotals[c.key] > 0)
    .map(c => `${c.emoji} ${c.label}: ${patientTotals[c.key]}`)
    .join("\n");

  const tubeBlocks = COMPANIES
    .filter(c => tubeTotals[c.key] > 0)
    .map(c => {
      const detail = TUBOS
        .filter(tb => tubesSource[tb.key][c.key] > 0)
        .map(tb => `   ${tb.emoji} ${tb.key}: ${tubesSource[tb.key][c.key]}`)
        .join("\n");
      return `${c.emoji} ${c.label} — Total: ${tubeTotals[c.key]}\n${detail}`;
    });

  lines.push("");
  lines.push("📊 *Totales por compañía:*");
  lines.push("👥 Pacientes:");
  lines.push(patientLine || "• sin datos");
  lines.push("");
  lines.push("🧪 Tubos:");
  lines.push(tubeBlocks.length ? tubeBlocks.join("\n\n") : "• sin datos");

  const papeleriaItems = data.papeleria.filter(p => p.tipo && p.tipo.trim());
  if (papeleriaItems.length > 0) {
    lines.push("");
    lines.push("📄 *Papelería recibida de doctores:*");
    papeleriaItems.forEach(p => {
      const doc = p.doctor && p.doctor.trim() ? ` — de ${p.doctor.trim()}` : "";
      lines.push(`• ${p.tipo.trim()} x${p.cantidad || 1}${doc}`);
    });
  }

  return lines.join("\n");
}

function formatExtraTime(t) {
  if (!t) return "--:--";
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${period}`;
}

function computeCounts() {
  const data = currentData();
  const markedHours = data.hours.filter(h => h.selected);
  const markedExtras = data.extras.filter(e => e.company && e.time);
  const patientTotal = markedHours.length + markedExtras.length;

  let tubeTotal = 0;
  TUBOS.forEach(tb => {
    const current = data.tubes[tb.key];
    const reported = data.tubesReported[tb.key];
    tubeTotal += current.vip + current.fsfb + current.poliza + reported.vip + reported.fsfb + reported.poliza;
  });

  return { patientTotal, tubeTotal };
}

// Nombre legible para una clave de auxiliar guardada (usada en el resumen del día)
function labelForAuxKey(key) {
  if (key === "custom") return "Otro / doctor";
  if (key.startsWith("fixed:")) return key.slice(6);
  return key;
}

// Suma pacientes y tubos de TODOS los auxiliares con datos de HOY.
// Si un auxiliar no se ha abierto hoy, sus datos guardados son de un día
// anterior y todavía no se reiniciaron (el reinicio es perezoso, ocurre
// al entrar a esa persona) — por eso aquí se filtran explícitamente por
// activeDate, para no sumar números viejos por accidente.
function buildDailySummary() {
  const today = localDateKey();
  const rows = [];
  let grandPatients = 0;
  let grandTubes = 0;

  Object.keys(state.byAux).forEach(key => {
    const d = state.byAux[key];
    if (!d || d.activeDate !== today) return;

    const patientTotal = d.hours.filter(h => h.selected).length
      + d.extras.filter(e => e.company && e.time).length;

    let tubeTotal = 0;
    TUBOS.forEach(tb => {
      const c = d.tubes[tb.key];
      const r = d.tubesReported[tb.key];
      tubeTotal += c.vip + c.fsfb + c.poliza + r.vip + r.fsfb + r.poliza;
    });

    if (patientTotal === 0 && tubeTotal === 0) return;

    rows.push({ name: labelForAuxKey(key), patientTotal, tubeTotal });
    grandPatients += patientTotal;
    grandTubes += tubeTotal;
  });

  rows.sort((a, b) => a.name.localeCompare(b.name, "es"));
  return { rows, grandPatients, grandTubes };
}

function renderSummaryModal() {
  const { rows, grandPatients, grandTubes } = buildDailySummary();

  if (rows.length === 0) {
    summaryContent.innerHTML = `<p class="summary-empty">Todavía no hay datos registrados hoy.</p>`;
    return;
  }

  const rowsHtml = rows.map(r => `
    <div class="summary-row">
      <span class="summary-name">${r.name}</span>
      <span class="summary-nums">👥 ${r.patientTotal} · 🧪 ${r.tubeTotal}</span>
    </div>`).join("");

  summaryContent.innerHTML = rowsHtml + `
    <div class="summary-row summary-total">
      <span class="summary-name">Total del día</span>
      <span class="summary-nums">👥 ${grandPatients} · 🧪 ${grandTubes}</span>
    </div>`;
}

let lastStats = { patientTotal: -1, tubeTotal: -1 };

function renderStats() {
  const { patientTotal, tubeTotal } = computeCounts();
  const paxChanged = patientTotal !== lastStats.patientTotal && lastStats.patientTotal !== -1;
  const tubeChanged = tubeTotal !== lastStats.tubeTotal && lastStats.tubeTotal !== -1;

  statsStrip.innerHTML = `
    <div class="stat-chip stat-pax">
      <span class="stat-icon">👥</span>
      <div>
        <div class="stat-value${paxChanged ? " bump" : ""}">${patientTotal}</div>
        <div class="stat-label">Pacientes</div>
      </div>
    </div>
    <div class="stat-chip stat-tubes">
      <span class="stat-icon">🧪</span>
      <div>
        <div class="stat-value${tubeChanged ? " bump" : ""}">${tubeTotal}</div>
        <div class="stat-label">Tubos</div>
      </div>
    </div>`;

  lastStats = { patientTotal, tubeTotal };
}

function renderPreview() {
  const data = currentData();
  const hasData = state.auxIndex !== null
    || data.hours.some(h => h.selected)
    || data.extras.some(e => e.company && e.time)
    || Object.values(data.tubes).some(c => c.vip + c.fsfb + c.poliza > 0)
    || data.papeleria.some(p => p.tipo && p.tipo.trim());

  preview.textContent = buildMessage();
  preview.classList.toggle("is-empty", !hasData);
  renderStats();
}

// ---------------- Acciones ----------------
function showToast(msg, duration) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), duration || 1800);
}

copyBtn.addEventListener("click", async () => {
  const data = currentData();
  const warning = validateBeforeSend(data);
  if (warning) { showToast(warning, 3400); return; }
  const text = buildMessage(data, { forSend: true });
  registerSendBatch(data);
  saveState();
  renderAll();
  try {
    await navigator.clipboard.writeText(text);
    showToast("Reporte copiado");
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showToast("Reporte copiado");
  }
});

sendBtn.addEventListener("click", () => {
  const data = currentData();
  const warning = validateBeforeSend(data);
  if (warning) { showToast(warning, 3400); return; }
  const text = buildMessage(data, { forSend: true });
  registerSendBatch(data);
  saveState();
  renderAll();
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank");
});

resetBtn.addEventListener("click", () => {
  if (!confirm("¿Iniciar un nuevo reporte para este auxiliar? Se perderá lo que no hayas enviado.")) return;
  const key = currentAuxKey();
  if (key) delete state.byAux[key];
  state.auxIndex = null;
  state.customName = "";
  saveState();
  renderAll();
});

undoPickupBtn.addEventListener("click", () => {
  const data = currentData();
  if (!confirm("¿Deshacer la última recogida enviada? Las horas y tubos de ese envío volverán a quedar pendientes.")) return;
  const undone = undoLastPickup(data);
  saveState();
  renderAll();
  if (undone) showToast("Última recogida deshecha");
});

// ---------------- Init ----------------
function renderAll() {
  renderAux();
  renderHours();
  renderExtras();
  renderTubes();
  renderPapeleria();
  renderPreview();
  if (dayResetHappened) {
    dayResetHappened = false;
    showToast("🗓️ Nuevo día — se reinició el reporte de " + currentAuxName(), 3200);
  }
}

renderAll();

// ---------------- PWA: service worker ----------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

// ---------------- PWA: instalación (botón + modal) ----------------
let deferredInstallPrompt = null;

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}

function openInstallModal() {
  if (deferredInstallPrompt) {
    installModalAndroid.hidden = false;
    installModalIOS.hidden = true;
  } else {
    installModalAndroid.hidden = true;
    installModalIOS.hidden = false;
  }
  installModal.hidden = false;
}

function closeInstallModal(dismissForGood) {
  installModal.hidden = true;
  if (dismissForGood) {
    try { localStorage.setItem(INSTALL_DISMISS_KEY, "1"); } catch (e) {}
  }
}

if (!isStandalone()) {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    installBtn.hidden = false;
    maybeAutoShowInstall();
  });

  if (isIOS()) {
    installBtn.hidden = false;
    maybeAutoShowInstall();
  }
}

function maybeAutoShowInstall() {
  let dismissed = false;
  try { dismissed = !!localStorage.getItem(INSTALL_DISMISS_KEY); } catch (e) {}
  if (dismissed || isStandalone()) return;
  setTimeout(() => {
    if (!isStandalone()) openInstallModal();
  }, 1400);
}

installBtn.addEventListener("click", openInstallModal);

installConfirmBtn.addEventListener("click", async () => {
  if (!deferredInstallPrompt) { closeInstallModal(false); return; }
  deferredInstallPrompt.prompt();
  try { await deferredInstallPrompt.userChoice; } catch (e) {}
  deferredInstallPrompt = null;
  closeInstallModal(true);
  installBtn.hidden = true;
});

installModalClose.addEventListener("click", () => closeInstallModal(true));
installModalDismiss.addEventListener("click", () => closeInstallModal(true));
installModal.addEventListener("click", (e) => {
  if (e.target === installModal) closeInstallModal(true);
});

window.addEventListener("appinstalled", () => {
  installBtn.hidden = true;
  closeInstallModal(true);
});

// ---------------- Resumen del día ----------------
summaryBtn.addEventListener("click", () => {
  renderSummaryModal();
  summaryModal.hidden = false;
});
summaryModalClose.addEventListener("click", () => { summaryModal.hidden = true; });
summaryModal.addEventListener("click", (e) => {
  if (e.target === summaryModal) summaryModal.hidden = true;
});

// ---------------- Respaldo: exportar / restaurar ----------------
exportBtn.addEventListener("click", () => {
  try {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reporte-logisticos-respaldo-${localDateKey()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Respaldo descargado");
  } catch (e) {
    showToast("No se pudo exportar el respaldo");
  }
});

importBtn.addEventListener("click", () => {
  importFile.value = "";
  importFile.click();
});

importFile.addEventListener("change", () => {
  const file = importFile.files && importFile.files[0];
  if (!file) return;

  if (!confirm("¿Restaurar este respaldo? Se reemplazarán todos los datos actuales de la app.")) {
    importFile.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || typeof parsed !== "object" || typeof parsed.byAux !== "object") {
        showToast("Ese archivo no parece ser un respaldo válido");
        return;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      state = loadState() || freshState();
      renderAll();
      showToast("Respaldo restaurado");
    } catch (e) {
      showToast("No se pudo leer el archivo de respaldo");
    }
  };
  reader.onerror = () => showToast("No se pudo leer el archivo de respaldo");
  reader.readAsText(file);
});