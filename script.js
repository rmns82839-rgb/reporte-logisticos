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
  { key: "Amarillo",     emoji: "🟡" },
  { key: "Lila",         emoji: "🟣" },
  { key: "Azul",         emoji: "🔵" },
  { key: "Rojo",         emoji: "🔴" },
  { key: "Transparente", emoji: "⚪" },
  { key: "Orina",        emoji: "💧" },
  { key: "Orina 24h",    emoji: "🕐" },
  { key: "Saliva",       emoji: "💦" },
  { key: "Materia fecal",emoji: "💩" },
  { key: "Laminas",      emoji: "🩸" },
  { key: "Hisopo nasal", emoji: "👃" },
  { key: "Azul rey",     emoji: "👑" },
];

// (los 10 tipos de tubo ahora se muestran todos juntos dentro del modal
// de cada compañía, sin dividir en dos grupos)

// División de las 13 franjas fijas de horas para los dos acordeones
const HOURS_SPLIT = 7; // 5:00 AM .. 8:00 AM = 7 franjas; el resto va al segundo grupo

const STORAGE_KEY = "reporte_logisticos_state_v5";
const INSTALL_DISMISS_KEY = "reporte_logisticos_install_dismissed_v1";

function buildFixedHours() {
  const list = [];
  let h = 5, m = 0;
  for (let i = 0; i < 13; i++) {
    list.push({ time: formatTime(h, m), selected: false, company: "vip", cancelled: false, pickup: null, cancelReported: false, count: 1 });
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

let customTubeIdCounter = 0;
function nextCustomTubeId() {
  customTubeIdCounter += 1;
  return "ct" + Date.now() + "_" + customTubeIdCounter;
}

function freshAuxData() {
  return {
    activeDate: localDateKey(),
    hours: buildFixedHours(),
    extras: [],
    tubes: emptyTubeState(),
    tubesReported: emptyTubeState(), // acumulado de recogidas ya enviadas hoy
    customTubes: [], // "Otro" tubo/objeto escrito a mano, por compañía: {id, company, label, qty, pickup}
    papeleria: [],
    pickupsToday: { date: localDateKey(), count: 0 },
    pickupLog: [], // historial de lo enviado, para poder deshacer la última recogida
    sentReports: [], // texto exacto de cada reporte copiado/enviado (para consultar después)
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
      if (typeof d.otrosDetalle === "string") delete d.otrosDetalle; // "Otros" ya no existe como tipo de tubo
      if (!Array.isArray(d.customTubes)) d.customTubes = [];
      d.customTubes.forEach(c => {
        if (typeof c.pickup === "undefined") c.pickup = null;
        if (typeof c.qty !== "number" || c.qty < 1) c.qty = 1;
        if (!c.id) c.id = nextCustomTubeId();
      });
      if (!Array.isArray(d.extras)) d.extras = [];
      if (!Array.isArray(d.papeleria)) d.papeleria = [];
      d.papeleria.forEach(p => { if (typeof p.pickup === "undefined") p.pickup = null; });
      if (!Array.isArray(d.hours) || d.hours.some(h => typeof h.selected === "undefined")) {
        delete parsed.byAux[key];
        return;
      }
      d.hours.forEach(h => {
        if (typeof h.cancelled !== "boolean") h.cancelled = false;
        if (typeof h.pickup === "undefined") h.pickup = null;
        if (typeof h.cancelReported !== "boolean") h.cancelReported = false;
        if (typeof h.count !== "number" || h.count < 1) h.count = 1;
      });
      d.extras.forEach(e => {
        if (typeof e.pickup === "undefined") e.pickup = null;
        if (!e.id) e.id = nextExtraId();
      });
      if (!d.pickupsToday || typeof d.pickupsToday.count !== "number") {
        d.pickupsToday = { date: localDateKey(), count: 0 };
      }
      if (!Array.isArray(d.pickupLog)) d.pickupLog = [];
      if (!Array.isArray(d.sentReports)) d.sentReports = [];
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
  pushCoordinatorSync();
}

// Manda un resumen liviano del auxiliar activo al panel de coordinador
// (si sync.js cargó y ya sabe quién es este logístico). Si algo de esto
// no está disponible, simplemente no hace nada — la app sigue 100% local.
function pushCoordinatorSync() {
  if (!window.ReporteSync) return;
  const auxKey = currentAuxKey();
  if (!auxKey) return;
  const data = state.byAux[auxKey];
  if (!data) return;

  const patientTotal = data.hours.filter(h => h.selected).reduce((sum, h) => sum + (h.count || 1), 0)
    + data.extras.filter(e => e.company && e.time).length;

  let tubeTotal = 0;
  TUBOS.forEach(tb => {
    const c = data.tubes[tb.key];
    const r = data.tubesReported[tb.key];
    tubeTotal += c.vip + c.fsfb + c.poliza + r.vip + r.fsfb + r.poliza;
  });

  window.ReporteSync.syncAux(auxKey, currentAuxName(), {
    patientTotal,
    tubeTotal,
    pickupsToday: data.pickupsToday ? data.pickupsToday.count : 0,
  });
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
  const papeleriaIndices = [];
  data.papeleria.forEach((p, i) => { if (p.tipo && p.tipo.trim() && !p.pickup) papeleriaIndices.push(i); });
  const customTubeIndices = [];
  data.customTubes.forEach((c, i) => { if (!c.pickup) customTubeIndices.push(i); });

  let pickupNum = null;
  if (hourIndices.length > 0 || extraIds.length > 0 || papeleriaIndices.length > 0 || customTubeIndices.length > 0) {
    data.pickupsToday.count += 1;
    pickupNum = data.pickupsToday.count;
    hourIndices.forEach(i => { data.hours[i].pickup = pickupNum; });
    data.extras.forEach(e => { if (extraIds.includes(e.id)) e.pickup = pickupNum; });
    papeleriaIndices.forEach(i => { data.papeleria[i].pickup = pickupNum; });
    customTubeIndices.forEach(i => { data.customTubes[i].pickup = pickupNum; });
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

  if (hourIndices.length > 0 || extraIds.length > 0 || cancelledHourIndices.length > 0 || tubesNonZero || papeleriaIndices.length > 0 || customTubeIndices.length > 0) {
    if (!Array.isArray(data.pickupLog)) data.pickupLog = [];
    data.pickupLog.push({ pickupNum, hourIndices, extraIds, cancelledHourIndices, tubeDelta, papeleriaIndices, customTubeIndices });
  }

  return { pickupNum, hourIndices, extraIds, tubeDelta };
}

// Cuenta pacientes/tubos de la recogida que se acaba de registrar, para
// mandarlo al historial de la Red de logísticos.
function pickupEventCounts(data, batch) {
  const patientCount = batch.hourIndices.reduce((sum, i) => sum + ((data.hours[i] && data.hours[i].count) || 1), 0)
    + batch.extraIds.length;
  let tubeCount = 0;
  TUBOS.forEach(tb => {
    const d = batch.tubeDelta[tb.key];
    if (d) tubeCount += d.vip + d.fsfb + d.poliza;
  });
  return { patientCount, tubeCount };
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
  (last.papeleriaIndices || []).forEach(i => {
    if (data.papeleria[i]) data.papeleria[i].pickup = null;
  });
  (last.customTubeIndices || []).forEach(i => {
    if (data.customTubes[i]) data.customTubes[i].pickup = null;
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

  // Cada compañía que tenga un paciente pendiente debe tener al menos un
  // tubo registrado de esa misma compañía (si hay VIP y FSFB pendientes
  // pero solo metiste tubos VIP, algo se quedó sin registrar).
  const companiesWithPatients = new Set(pendingReceived.map(p => p.company));
  const tubesByCompany = { vip: 0, fsfb: 0, poliza: 0 };
  TUBOS.forEach(tb => {
    const c = data.tubes[tb.key];
    tubesByCompany.vip += c.vip;
    tubesByCompany.fsfb += c.fsfb;
    tubesByCompany.poliza += c.poliza;
  });

  const missing = [...companiesWithPatients].filter(company => tubesByCompany[company] === 0);
  if (missing.length > 0) {
    const nombres = missing.map(c => companyLabel(c).toUpperCase()).join(" y ");
    return `Tienes paciente(s) de ${nombres} pero no registraste tubos de ${missing.length > 1 ? "esas compañías" : "esa compañía"}. Revisa antes de enviar.`;
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
  const el = e.target.closest(".btn, .icon-btn, .aux-chip, .step-btn, .cancel-btn, .ghost-btn, .del-btn, .aux-other-btn, .place-action, .btn-secondary-sm, .status-btn, .history-copy-btn");
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

const pickupInfo = document.getElementById("pickupInfo");
const undoPickupBtn = document.getElementById("undoPickupBtn");
const hourCompanyCountVip = document.getElementById("hourCompanyCountVip");
const hourCompanyCountFsfb = document.getElementById("hourCompanyCountFsfb");
const hourCompanyCountPoliza = document.getElementById("hourCompanyCountPoliza");
const hourChipsGrid = document.getElementById("hourChipsGrid");
const hourChipsBadge = document.getElementById("hourChipsBadge");
const hourCompanyExtraList = document.getElementById("hourCompanyExtraList");
const hourCompanyAddExtraBtn = document.getElementById("hourCompanyAddExtraBtn");
const tubeCompanyBadge = document.getElementById("tubeCompanyBadge");

const tubeCompanyBtnVip = document.getElementById("tubeCompanyBtnVip");
const tubeCompanyBtnFsfb = document.getElementById("tubeCompanyBtnFsfb");
const tubeCompanyBtnPoliza = document.getElementById("tubeCompanyBtnPoliza");
const tubeCompanyCountVip = document.getElementById("tubeCompanyCountVip");
const tubeCompanyCountFsfb = document.getElementById("tubeCompanyCountFsfb");
const tubeCompanyCountPoliza = document.getElementById("tubeCompanyCountPoliza");
const tubeCompanyModal = document.getElementById("tubeCompanyModal");
const tubeCompanyModalTitle = document.getElementById("tubeCompanyModalTitle");
const tubeCompanyModalClose = document.getElementById("tubeCompanyModalClose");
const tubeCompanyModalDone = document.getElementById("tubeCompanyModalDone");
const tubeCompanyGrid = document.getElementById("tubeCompanyGrid");
const tubeCompanyCustomList = document.getElementById("tubeCompanyCustomList");
const tubeCompanyAddOtroBtn = document.getElementById("tubeCompanyAddOtroBtn");
const customTubeModal = document.getElementById("customTubeModal");
const customTubeModalClose = document.getElementById("customTubeModalClose");
const customTubeLabelInput = document.getElementById("customTubeLabelInput");
const customTubeQtyMinus = document.getElementById("customTubeQtyMinus");
const customTubeQtyValue = document.getElementById("customTubeQtyValue");
const customTubeQtyPlus = document.getElementById("customTubeQtyPlus");
const customTubeAddBtn = document.getElementById("customTubeAddBtn");
const tubeCompanyPapeleriaWrap = document.getElementById("tubeCompanyPapeleriaWrap");
const tubesInfo = document.getElementById("tubesInfo");

const papeleriaList = document.getElementById("papeleriaList");
const addPapeleriaBtn = document.getElementById("addPapeleriaBtn");

const preview = document.getElementById("preview");
const copyBtn = document.getElementById("copyBtn");
const sendBtn = document.getElementById("sendBtn");
const installBtn = document.getElementById("installBtn");
const installModal = document.getElementById("installModal");
const installModalAndroid = document.getElementById("installModalAndroid");
const installModalIOS = document.getElementById("installModalIOS");
const installConfirmBtn = document.getElementById("installConfirmBtn");
const installModalClose = document.getElementById("installModalClose");
const installModalDismiss = document.getElementById("installModalDismiss");
const resetBtn = document.getElementById("resetBtn");
const toast = document.getElementById("toast");
const statsStrip = document.getElementById("statsStrip");

const assignmentBanner = document.getElementById("assignmentBanner");
const assignmentBannerTime = document.getElementById("assignmentBannerTime");
const assignmentBannerText = document.getElementById("assignmentBannerText");
const assignmentBannerMaps = document.getElementById("assignmentBannerMaps");
const assignmentBannerWaze = document.getElementById("assignmentBannerWaze");
const assignmentBannerDoneBtn = document.getElementById("assignmentBannerDoneBtn");

const welcomeStrip = document.getElementById("welcomeStrip");
const welcomeAvatar = document.getElementById("welcomeAvatar");
const welcomeGreeting = document.getElementById("welcomeGreeting");

const networkBtn = document.getElementById("networkBtn");
const networkModal = document.getElementById("networkModal");
const networkModalClose = document.getElementById("networkModalClose");
const networkContent = document.getElementById("networkContent");

const summaryBtn = document.getElementById("summaryBtn");
const summaryModal = document.getElementById("summaryModal");
const summaryModalClose = document.getElementById("summaryModalClose");
const summaryContent = document.getElementById("summaryContent");

const historyBtn = document.getElementById("historyBtn");
const historyModal = document.getElementById("historyModal");
const historyModalClose = document.getElementById("historyModalClose");
const historyContent = document.getElementById("historyContent");

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

// ---------------- Colores/etiquetas por compañía (compartidos por horas y tubos) ----------------

// ---------------- Render: Horas fijas (dos acordeones) ----------------

// Convierte "5:00 AM" -> 300 (minutos desde medianoche), para poder
// comparar contra la hora actual y resaltar la franja "en curso".
function timeToMinutes(timeStr) {
  const m = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const period = m[3].toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

// Índice de la franja que corresponde a la hora del reloj en este momento
// (-1 si el reloj está fuera del rango de horas fijas, ej. de noche).
function findCurrentSlotIndex(hours) {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let i = 0; i < hours.length; i++) {
    const start = timeToMinutes(hours[i].time);
    const end = i + 1 < hours.length ? timeToMinutes(hours[i + 1].time) : start + 30;
    if (start !== null && nowMin >= start && nowMin < end) return i;
  }
  return -1;
}

let openCompany = null; // "vip" | "fsfb" | "poliza" | null mientras el modal está abierto

// Pacientes pendientes (sin enviar) para una compañía: horas marcadas +
// horas extraordinarias.
function sumCompanyPatients(data, company) {
  let n = 0;
  data.hours.forEach(h => {
    if (h.selected && h.company === company && !h.pickup) n += h.count || 1;
  });
  data.extras.forEach(e => {
    if (e.company === company && e.time && !e.pickup) n += 1;
  });
  return n;
}

// Botones de compañía: pacientes (horas) y tubos, juntos. Más abajo
// también maneja el aviso de recogida y "deshacer", que son del
// auxiliar completo (no de una sola compañía).
function renderCompanyButtons() {
  const data = currentData();
  hourCompanyCountVip.textContent = sumCompanyPatients(data, "vip");
  hourCompanyCountFsfb.textContent = sumCompanyPatients(data, "fsfb");
  hourCompanyCountPoliza.textContent = sumCompanyPatients(data, "poliza");
  tubeCompanyCountVip.textContent = sumCompanyTubes(data, "vip");
  tubeCompanyCountFsfb.textContent = sumCompanyTubes(data, "fsfb");
  tubeCompanyCountPoliza.textContent = sumCompanyTubes(data, "poliza");

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

  let reportedTotal = 0;
  TUBOS.forEach(tb => {
    const r = data.tubesReported[tb.key];
    reportedTotal += r.vip + r.fsfb + r.poliza;
  });
  (data.customTubes || []).forEach(c => { if (c.pickup) reportedTotal += c.qty || 0; });
  if (reportedTotal > 0) {
    tubesInfo.hidden = false;
    tubesInfo.textContent = `✅ Ya enviaste ${reportedTotal} tubos hoy — el contador se reinició para la siguiente recogida`;
  } else {
    tubesInfo.hidden = true;
  }
}

// Chips de horas: las 13 franjas fijas en un solo grupo, una compañía a
// la vez. Toque normal marca recibido; el ✕ de la esquina cancela; si ya
// la tiene otra compañía, se ve apagada y avisa en vez de cambiarla.
function renderHourChips(company) {
  const data = currentData();
  const currentIdx = findCurrentSlotIndex(data.hours);
  hourChipsGrid.innerHTML = "";
  let countMine = 0;

  data.hours.forEach((slot, i) => {
    const ownedByOther = (slot.selected || slot.cancelled) && slot.company && slot.company !== company;
    const isMine = slot.company === company;
    if (isMine && slot.selected) countMine++;

    const wrap = document.createElement("div");
    wrap.className = "hour-chip-wrap"
      + (isMine && slot.selected ? " is-set" : "")
      + (isMine && slot.cancelled ? " is-cancelled" : "")
      + (isMine && slot.pickup ? " is-reported" : "")
      + (i === currentIdx ? " is-now" : "")
      + (i === lastToggledHourIndex ? " pop" : "")
      + (ownedByOther ? " locked" : "");
    wrap.style.setProperty("--co-color", `var(--${company})`);

    const ownerLabel = ownedByOther ? (TUBE_COMPANY_META[slot.company]?.label || slot.company) : null;
    function tryClaim(action) {
      if (ownedByOther) {
        showToast(`Esta hora ya está marcada para ${ownerLabel}. Quítala ahí primero.`, 3200);
        return;
      }
      action();
    }

    const chipBtn = document.createElement("button");
    chipBtn.type = "button";
    chipBtn.className = "hour-chip";
    chipBtn.textContent = slot.time;
    chipBtn.title = ownedByOther ? `Tomada por ${ownerLabel}` : (isMine && slot.selected ? "Recibido — toca para deshacer" : "Marcar como recibido");
    chipBtn.addEventListener("click", () => tryClaim(() => {
      const nowSelected = !(isMine && slot.selected);
      data.hours[i].selected = nowSelected;
      data.hours[i].company = company;
      if (nowSelected) data.hours[i].cancelled = false;
      lastToggledHourIndex = i;
      saveState();
      renderCompanyButtons();
      renderHourChips(company);
      renderPreview();
    }));

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "hour-chip-cancel";
    cancelBtn.textContent = "✕";
    cancelBtn.title = ownedByOther ? `Tomada por ${ownerLabel}` : (isMine && slot.cancelled ? "Cancelado — toca para deshacer" : "Marcar como cancelado");
    cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      tryClaim(() => {
        const nowCancelled = !(isMine && slot.cancelled);
        data.hours[i].cancelled = nowCancelled;
        data.hours[i].company = company;
        if (nowCancelled) data.hours[i].selected = false;
        lastToggledHourIndex = i;
        saveState();
        renderCompanyButtons();
        renderHourChips(company);
        renderPreview();
      });
    });

    wrap.appendChild(chipBtn);
    wrap.appendChild(cancelBtn);

    if (isMine && slot.pickup) {
      const badge = document.createElement("span");
      badge.className = "hour-chip-count is-sent";
      badge.textContent = `R${slot.pickup}`;
      badge.title = `Ya se envió en la recogida ${slot.pickup}`;
      wrap.appendChild(badge);
    } else if (isMine && (slot.selected || slot.cancelled)) {
      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = "hour-chip-count" + (slot.count > 1 ? " active" : "");
      badge.textContent = `×${slot.count || 1}`;
      badge.title = "Toca para sumar otro paciente a esta misma hora (×2, ×3)";
      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        const current = data.hours[i].count || 1;
        data.hours[i].count = current >= 3 ? 1 : current + 1;
        lastToggledHourIndex = i;
        saveState();
        renderCompanyButtons();
        renderHourChips(company);
        renderPreview();
      });
      wrap.appendChild(badge);
    }

    hourChipsGrid.appendChild(wrap);
  });

  lastToggledHourIndex = null;
  hourChipsBadge.textContent = `${countMine}/${data.hours.length}`;
  renderHourCompanyExtras(company);
}

function renderHourCompanyExtras(company) {
  const data = currentData();
  hourCompanyExtraList.innerHTML = "";
  data.extras.forEach((extra, i) => {
    if (extra.company !== company) return;
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

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "del-btn";
    delBtn.title = "Eliminar";
    delBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 7h12l-1 14H7L6 7zm3-4h6l1 2h4v2H2V5h4l1-2z"/></svg>`;
    delBtn.addEventListener("click", () => {
      data.extras.splice(i, 1);
      saveState();
      renderCompanyButtons();
      renderHourCompanyExtras(company);
      renderPreview();
    });

    row.appendChild(timeInput);
    row.appendChild(delBtn);
    hourCompanyExtraList.appendChild(row);
  });
}

hourCompanyAddExtraBtn.addEventListener("click", () => {
  if (!openCompany) return;
  const data = currentData();
  data.extras.push({ time: "", company: openCompany, pickup: null, id: nextExtraId() });
  saveState();
  renderHourCompanyExtras(openCompany);
});

function renderHours() {
  renderCompanyButtons();
  if (openCompany) {
    renderHourChips(openCompany);
    renderTubeCompanyGrid(openCompany);
  }
}

function renderExtras() {
  renderHours();
}

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
    // "captura" el puntero: el mantener-presionado no se corta si el
    // dedo/mouse se mueve un poco fuera del botón mientras se sostiene
    try { btn.setPointerCapture(e.pointerId); } catch (err) { /* no soportado, sigue igual */ }
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
  btn.addEventListener("pointercancel", stop);
}

const TUBE_COMPANY_META = {
  vip:    { label: "VIP",    emoji: "🔴" },
  fsfb:   { label: "FSFB",   emoji: "🔵" },
  poliza: { label: "Poliza", emoji: "🟡" },
};

function sumCompanyTubes(data, company) {
  let n = 0;
  TUBOS.forEach(tb => { n += data.tubes[tb.key][company] || 0; });
  (data.customTubes || []).forEach(c => { if (c.company === company && !c.pickup) n += c.qty || 0; });
  return n;
}

// Cuadrícula de los 10 tipos de tubo, con un solo contador cada uno,
// escogida para la compañía que se abrió (VIP, FSFB o Poliza).
function renderTubeCompanyGrid(company) {
  const data = currentData();
  const meta = TUBE_COMPANY_META[company];
  tubeCompanyModalTitle.textContent = `${meta.emoji} ${meta.label}`;
  tubeCompanyModal.classList.remove("co-vip", "co-fsfb", "co-poliza");
  tubeCompanyModal.classList.add(`co-${company}`);
  tubeCompanyPapeleriaWrap.hidden = company !== "poliza";
  if (company === "poliza") renderPapeleria();
  tubeCompanyBadge.textContent = sumCompanyTubes(data, company);
  tubeCompanyGrid.innerHTML = "";

  TUBOS.forEach(tb => {
    const counts = data.tubes[tb.key];
    const qty = counts[company] || 0;
    const active = qty > 0;

    const tile = document.createElement("div");
    tile.className = "tube-co-tile" + (active ? " active" : "")
      + (lastToggledTube && lastToggledTube.key === tb.key && lastToggledTube.company === company ? " pop" : "");
    tile.style.setProperty("--co-color", `var(--${company})`);
    tile.innerHTML = `
      ${active ? `<div class="tube-co-badge">${qty}</div>` : ""}
      <div class="tube-co-emoji">${tb.emoji}</div>
      <div class="tube-co-label">${tb.key}</div>
      <div class="tube-co-controls">
        <button type="button" class="tube-co-step minus">−</button>
        <span class="tube-co-value">${qty}</span>
        <button type="button" class="tube-co-step plus">+</button>
      </div>`;

    const valueEl = tile.querySelector(".tube-co-value");
    const onRelease = () => {
      lastToggledTube = { key: tb.key, company };
      saveState();
      renderCompanyButtons();
      renderTubeCompanyGrid(company);
      renderPreview();
    };

    bindHoldStepper(
      tile.querySelector(".minus"), -1,
      () => counts[company], (v) => { counts[company] = v; },
      valueEl, null, () => counts[company], onRelease
    );
    bindHoldStepper(
      tile.querySelector(".plus"), 1,
      () => counts[company], (v) => { counts[company] = v; },
      valueEl, null, () => counts[company], onRelease
    );

    tubeCompanyGrid.appendChild(tile);
  });

  lastToggledTube = null;
  renderTubeCompanyCustomList(company);
}

function escapeHtmlTube(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Lista de "otros" que se agregaron a mano para esta compañía (texto libre
// + cantidad) — se muestran debajo de la cuadrícula fija de tubos.
function renderTubeCompanyCustomList(company) {
  const data = currentData();
  const items = data.customTubes.filter(c => c.company === company);
  if (items.length === 0) {
    tubeCompanyCustomList.innerHTML = "";
    return;
  }
  tubeCompanyCustomList.innerHTML = items.map(c => `
    <div class="tube-custom-row">
      <span class="tube-custom-label">${escapeHtmlTube(c.label)} ×${c.qty}</span>
      <button type="button" class="del-btn tube-custom-del" data-id="${c.id}" title="Eliminar">
        <svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M6 7h12l-1 14H7L6 7zm3-4h6l1 2h4v2H2V5h4l1-2z"/></svg>
      </button>
    </div>
  `).join("");

  tubeCompanyCustomList.querySelectorAll(".tube-custom-del").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      data.customTubes = data.customTubes.filter(c => c.id !== id);
      saveState();
      renderCompanyButtons();
      renderTubeCompanyCustomList(company);
      renderPreview();
    });
  });
}

// ---------------- Sub-modal "Otro": texto libre + cantidad, por compañía ----------------
let customTubeQty = 1;
let customTubeTargetCompany = null;

function openCustomTubeModal(company) {
  customTubeTargetCompany = company;
  customTubeLabelInput.value = "";
  customTubeQty = 1;
  customTubeQtyValue.textContent = "1";
  customTubeModal.hidden = false;
  customTubeLabelInput.focus();
}

function closeCustomTubeModal() {
  customTubeModal.hidden = true;
  customTubeTargetCompany = null;
}

tubeCompanyAddOtroBtn.addEventListener("click", () => {
  if (openCompany) openCustomTubeModal(openCompany);
});
customTubeModalClose.addEventListener("click", closeCustomTubeModal);
customTubeModal.addEventListener("click", (e) => {
  if (e.target === customTubeModal) closeCustomTubeModal();
});
customTubeQtyMinus.addEventListener("click", () => {
  customTubeQty = Math.max(1, customTubeQty - 1);
  customTubeQtyValue.textContent = customTubeQty;
});
customTubeQtyPlus.addEventListener("click", () => {
  customTubeQty += 1;
  customTubeQtyValue.textContent = customTubeQty;
});
customTubeAddBtn.addEventListener("click", () => {
  const label = customTubeLabelInput.value.trim();
  if (!label) { customTubeLabelInput.focus(); return; }
  const data = currentData();
  if (!Array.isArray(data.customTubes)) data.customTubes = [];
  data.customTubes.push({
    id: nextCustomTubeId(),
    company: customTubeTargetCompany,
    label,
    qty: customTubeQty,
    pickup: null,
  });
  saveState();
  const company = customTubeTargetCompany;
  closeCustomTubeModal();
  renderCompanyButtons();
  renderTubeCompanyCustomList(company);
  renderPreview();
});
customTubeLabelInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") customTubeAddBtn.click();
});

function openTubeCompanyModal(company) {
  openCompany = company;
  renderHourChips(company);
  renderTubeCompanyGrid(company);
  tubeCompanyModal.hidden = false;
}

function closeTubeCompanyModal() {
  tubeCompanyModal.hidden = true;
  openCompany = null;
}

tubeCompanyBtnVip.addEventListener("click", () => openTubeCompanyModal("vip"));
tubeCompanyBtnFsfb.addEventListener("click", () => openTubeCompanyModal("fsfb"));
tubeCompanyBtnPoliza.addEventListener("click", () => openTubeCompanyModal("poliza"));
tubeCompanyModalClose.addEventListener("click", closeTubeCompanyModal);
tubeCompanyModalDone.addEventListener("click", closeTubeCompanyModal);
tubeCompanyModal.addEventListener("click", (e) => {
  if (e.target === tubeCompanyModal) closeTubeCompanyModal();
});

function renderTubes() {
  renderHours();
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
  data.papeleria.push({ tipo: "", doctor: "", cantidad: 1, pickup: null });
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

// Hora exacta (solo hora y minutos, hora de Colombia), en el mismo
// formato "6:45 AM" que ya usa el resto de la app.
function nowTimeLabel() {
  const now = new Date();
  return formatTime(now.getHours(), now.getMinutes());
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
  const relevantCustomTubes = forSend
    ? data.customTubes.filter(c => !c.pickup)
    : data.customTubes.slice();

  const lines = [];
  lines.push("📋 *Reporte de recepción de muestras*");
  lines.push(`📅 ${todayLabel()} — 🕐 ${nowTimeLabel()}`);
  lines.push(`👤 Auxiliar: ${auxName}`);
  lines.push("");
  lines.push("⏰ *Horas:*");

  const hourLine = h => Array.from({ length: h.count > 1 ? h.count : 1 }, () =>
    `• ${h.time} — ${companyEmoji(h.company)} ${companyLabel(h.company).toUpperCase()}`
  );

  if (relevantHours.length === 0 && relevantExtras.length === 0) {
    lines.push(forSend ? "• Nada nuevo por reportar" : "• Sin horas marcadas");
  } else if (forSend) {
    // reporte de una sola recogida (la actual): lista simple, sin agrupar
    relevantHours.forEach(h => {
      hourLine(h).forEach(l => lines.push(l));
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
      const linesForHour = hourLine(h);
      if (h.pickup) { (groups[h.pickup] = groups[h.pickup] || []).push(...linesForHour); }
      else pendingLines.push(...linesForHour);
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
      const times = h.count > 1 ? h.count : 1;
      for (let k = 0; k < times; k++) {
        lines.push(`• ${h.time} — ${companyEmoji(h.company)} ${companyLabel(h.company).toUpperCase()}`);
      }
    });
  }

  lines.push("");
  lines.push("🧪 *Tubos recibidos:*");
  const tubesWithTotal = TUBOS.map(tb => {
    const c = tubesSource[tb.key];
    return { ...tb, total: c.vip + c.fsfb + c.poliza };
  }).filter(tb => tb.total > 0);

  if (tubesWithTotal.length === 0 && relevantCustomTubes.length === 0) {
    lines.push("• Sin tubos registrados");
  } else {
    tubesWithTotal.forEach(tb => {
      lines.push(`${tb.emoji} ${tb.key}: ${tb.total}`);
    });
    const customByLabel = {};
    relevantCustomTubes.forEach(c => { customByLabel[c.label] = (customByLabel[c.label] || 0) + c.qty; });
    Object.entries(customByLabel).forEach(([label, qty]) => {
      lines.push(`📝 ${label}: ${qty}`);
    });
  }

  const patientTotals = { vip: 0, fsfb: 0, poliza: 0 };
  relevantHours.forEach(h => { patientTotals[h.company] += (h.count || 1); });
  relevantExtras.forEach(e => patientTotals[e.company]++);

  const tubeTotals = { vip: 0, fsfb: 0, poliza: 0 };
  TUBOS.forEach(tb => {
    const c = tubesSource[tb.key];
    tubeTotals.vip += c.vip;
    tubeTotals.fsfb += c.fsfb;
    tubeTotals.poliza += c.poliza;
  });
  relevantCustomTubes.forEach(c => { tubeTotals[c.company] += c.qty; });

  const patientLine = COMPANIES
    .filter(c => patientTotals[c.key] > 0)
    .map(c => `${c.emoji} ${c.label}: ${patientTotals[c.key]}`)
    .join("\n");

  const tubeBlocks = COMPANIES
    .filter(c => tubeTotals[c.key] > 0)
    .map(c => {
      const fixedDetail = TUBOS
        .filter(tb => tubesSource[tb.key][c.key] > 0)
        .map(tb => `   ${tb.emoji} ${tb.key}: ${tubesSource[tb.key][c.key]}`);
      const customDetail = relevantCustomTubes
        .filter(ct => ct.company === c.key)
        .map(ct => `   📝 ${ct.label}: ${ct.qty}`);
      const detail = [...fixedDetail, ...customDetail].join("\n");
      return `${c.emoji} ${c.label} — Total: ${tubeTotals[c.key]}\n${detail}`;
    });

  lines.push("");
  lines.push("📊 *Totales por compañía:*");
  lines.push("👥 Pacientes:");
  lines.push(patientLine || "• sin datos");
  lines.push("");
  lines.push("🧪 Tubos:");
  lines.push(tubeBlocks.length ? tubeBlocks.join("\n\n") : "• sin datos");

  const papeleriaItems = forSend
    ? data.papeleria.filter(p => p.tipo && p.tipo.trim() && !p.pickup)
    : data.papeleria.filter(p => p.tipo && p.tipo.trim());
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
  const patientTotal = markedHours.reduce((sum, h) => sum + (h.count || 1), 0) + markedExtras.length;

  let tubeTotal = 0;
  TUBOS.forEach(tb => {
    const current = data.tubes[tb.key];
    const reported = data.tubesReported[tb.key];
    tubeTotal += current.vip + current.fsfb + current.poliza + reported.vip + reported.fsfb + reported.poliza;
  });
  data.customTubes.forEach(c => { tubeTotal += c.qty || 0; });

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

    const patientTotal = d.hours.filter(h => h.selected).reduce((sum, h) => sum + (h.count || 1), 0)
      + d.extras.filter(e => e.company && e.time).length;

    let tubeTotal = 0;
    TUBOS.forEach(tb => {
      const c = d.tubes[tb.key];
      const r = d.tubesReported[tb.key];
      tubeTotal += c.vip + c.fsfb + c.poliza + r.vip + r.fsfb + r.poliza;
    });
    (d.customTubes || []).forEach(c => { tubeTotal += c.qty || 0; });

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

function formatHistoryTime(ts) {
  return new Date(ts).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}

// Se arma con el DOM (no innerHTML con texto interpolado) porque el
// reporte puede incluir texto libre que escribió el usuario (nombre de
// "Otro" auxiliar, doctor de papelería, detalle de "Otros" tubo, etc.)
function renderHistoryModal() {
  const data = currentData();
  historyContent.innerHTML = "";
  const reports = data.sentReports || [];

  if (reports.length === 0) {
    const p = document.createElement("p");
    p.className = "summary-empty";
    p.textContent = `Todavía no se ha copiado ni enviado nada hoy para ${currentAuxName()}.`;
    historyContent.appendChild(p);
    return;
  }

  reports.forEach(r => {
    const item = document.createElement("div");
    item.className = "history-item";

    const head = document.createElement("div");
    head.className = "history-item-head";

    const time = document.createElement("span");
    time.className = "history-time";
    time.textContent = "🕓 " + formatHistoryTime(r.sentAt);

    const copyAgainBtn = document.createElement("button");
    copyAgainBtn.type = "button";
    copyAgainBtn.className = "history-copy-btn";
    copyAgainBtn.textContent = "Copiar de nuevo";
    copyAgainBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(r.text);
      } catch (e) {
        const ta = document.createElement("textarea");
        ta.value = r.text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      buzz(90);
      showToast("Reporte copiado");
    });

    head.appendChild(time);
    head.appendChild(copyAgainBtn);

    const pre = document.createElement("pre");
    pre.className = "history-text";
    pre.textContent = r.text;

    item.appendChild(head);
    item.appendChild(pre);
    historyContent.appendChild(item);
  });
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
    || data.customTubes.length > 0
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

// Vibración corta de confirmación. Solo funciona en Android/Chrome — iOS
// Safari no soporta la API de vibración, así que ahí simplemente no pasa nada.
function buzz(pattern) {
  if (navigator.vibrate) {
    try { navigator.vibrate(pattern || 120); } catch (e) {}
  }
}

// Guarda el texto exacto que se copió/envió, para poder consultarlo o
// volver a copiarlo después desde "Historial de reportes". Se guardan
// como máximo los últimos 30 por auxiliar para no crecer sin límite.
function logSentReport(data, text) {
  if (!Array.isArray(data.sentReports)) data.sentReports = [];
  data.sentReports.unshift({ text, sentAt: Date.now() });
  if (data.sentReports.length > 30) data.sentReports.length = 30;
}

copyBtn.addEventListener("click", async () => {
  const data = currentData();
  const warning = validateBeforeSend(data);
  if (warning) { showToast(warning, 3400); return; }
  const text = buildMessage(data, { forSend: true });
  logSentReport(data, text);
  const batch = registerSendBatch(data);
  saveState();
  renderAll();
  if (batch.pickupNum && window.ReporteSync) {
    window.ReporteSync.logPickupEvent(currentAuxKey(), currentAuxName(), pickupEventCounts(data, batch));
  }
  try {
    await navigator.clipboard.writeText(text);
    buzz(90);
    showToast("Reporte copiado");
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    buzz(90);
    showToast("Reporte copiado");
  }
});

sendBtn.addEventListener("click", () => {
  const data = currentData();
  const warning = validateBeforeSend(data);
  if (warning) { showToast(warning, 3400); return; }
  const text = buildMessage(data, { forSend: true });
  logSentReport(data, text);
  const batch = registerSendBatch(data);
  saveState();
  renderAll();
  if (batch.pickupNum && window.ReporteSync) {
    window.ReporteSync.logPickupEvent(currentAuxKey(), currentAuxName(), pickupEventCounts(data, batch));
  }
  if (currentAssignment && currentAssignment.auxName === currentAuxName() && window.ReporteSync) {
    window.ReporteSync.markAssignmentDone(currentAssignment.id);
    assignmentBanner.hidden = true;
  }
  buzz([80, 60, 80]);
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank");
});

resetBtn.addEventListener("click", () => {
  if (!confirm("¿Borrar TODOS los datos de este auxiliar (horas, tubos, papelería, historial de hoy)? No se puede deshacer.")) return;
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

// ---------------- Título del topbar: carrusel automático si no cabe ----------------
// Si "Reporte Logísticos" no entra completo (celular angosto, o los 4
// botones del topbar dejan poco espacio), en vez de cortarlo con "..."
// lo desliza de a poco para que se alcance a leer completo.
function setupTitleMarquee() {
  const h1 = document.querySelector(".topbar h1");
  const track = document.getElementById("titleTrack");
  if (!h1 || !track) return;
  track.classList.remove("marquee");
  track.style.removeProperty("--marquee-distance");
  const overflow = track.scrollWidth - h1.clientWidth;
  if (overflow > 4) {
    track.style.setProperty("--marquee-distance", `-${overflow + 6}px`);
    track.classList.add("marquee");
  }
}
window.addEventListener("load", () => {
  setupTitleMarquee();
  setTimeout(setupTitleMarquee, 400); // reintenta tras cargar la fuente Sora
});
window.addEventListener("resize", setupTitleMarquee);

// Refresca la marca de "hora actual" cada minuto, aunque el usuario no
// toque nada — así no se queda pegada en una franja vieja si la app se
// deja abierta un rato.
setInterval(() => { renderHours(); }, 60000);

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

// ---------------- Aviso antes de perder datos sin enviar ----------------
function hasUnsentData(data) {
  const pendingHours = data.hours.some(h => (h.selected && !h.pickup) || (h.cancelled && !h.cancelReported));
  const pendingExtras = data.extras.some(e => e.company && e.time && !e.pickup);
  const pendingTubes = TUBOS.some(tb => {
    const c = data.tubes[tb.key];
    return c.vip > 0 || c.fsfb > 0 || c.poliza > 0;
  });
  const pendingPapeleria = data.papeleria.some(p => p.tipo && p.tipo.trim() && !p.pickup);
  const pendingCustomTubes = data.customTubes.some(c => !c.pickup);
  return pendingHours || pendingExtras || pendingTubes || pendingPapeleria || pendingCustomTubes;
}

function anyUnsentDataToday() {
  const today = localDateKey();
  return Object.values(state.byAux).some(d => d.activeDate === today && hasUnsentData(d));
}

window.addEventListener("beforeunload", (e) => {
  if (anyUnsentDataToday()) {
    e.preventDefault();
    e.returnValue = "";
  }
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

historyBtn.addEventListener("click", () => {
  renderHistoryModal();
  historyModal.hidden = false;
});
historyModalClose.addEventListener("click", () => { historyModal.hidden = true; });
historyModal.addEventListener("click", (e) => {
  if (e.target === historyModal) historyModal.hidden = true;
});

// ---------------- Aviso de asignación del coordinador ----------------
// Muestra un aviso arriba de la app cuando el coordinador le asigna a
// este logístico una dirección/auxiliar. Se actualiza solo, sin recargar.
let currentAssignment = null;

function renderAssignmentBanner(list) {
  if (!list) return;
  const pending = list
    .filter(a => a.status !== "hecha")
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

  const a = pending[0] || null;
  currentAssignment = a;

  if (!a) {
    assignmentBanner.hidden = true;
    return;
  }

  assignmentBanner.hidden = false;
  assignmentBannerText.textContent = `Ve donde ${a.auxName}${a.hora ? " (" + a.hora + ")" : ""} — ${a.address}${a.solicitud ? " · N° " + a.solicitud : ""}${a.note ? " · " + a.note : ""}`;
  assignmentBannerTime.textContent = a.createdAt?.toMillis
    ? new Date(a.createdAt.toMillis()).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })
    : "";

  const q = encodeURIComponent(a.address);
  assignmentBannerMaps.href = `https://www.google.com/maps/search/?api=1&query=${q}`;
  assignmentBannerWaze.href = `https://waze.com/ul?q=${q}&navigate=yes`;

  if (a.status === "pendiente" && window.ReporteSync) {
    window.ReporteSync.markAssignmentSeen(a.id);
  }
}

function startAssignmentListener() {
  if (!window.ReporteSync || !window.ReporteSync.getMyIdentity()) return;
  window.ReporteSync.listenMyAssignments(renderAssignmentBanner);
}

assignmentBannerDoneBtn.addEventListener("click", () => {
  if (!currentAssignment || !window.ReporteSync) return;
  window.ReporteSync.markAssignmentDone(currentAssignment.id);
  assignmentBanner.hidden = true;
  showToast("Asignación marcada como hecha");
});

// ---------------- Saludo con avatar del logístico ----------------
function renderWelcomeStrip() {
  if (!window.ReporteSync) { welcomeStrip.hidden = true; return; }
  const me = window.ReporteSync.getMyIdentity();
  if (!me) { welcomeStrip.hidden = true; return; }
  welcomeStrip.hidden = false;
  welcomeAvatar.style.background = avatarColor(me.name);
  welcomeAvatar.textContent = initials(me.name);
  welcomeGreeting.textContent = `¡Hola, ${me.name}! 👋`;
}

window.addEventListener("load", () => {
  renderWelcomeStrip();
  setTimeout(startAssignmentListener, 800);
});

// ---------------- Red de logísticos: quién le recibe a quién, en vivo ----------------
let networkUnsub = null;

function networkTimeAgo(ts) {
  if (!ts || typeof ts.toMillis !== "function") return "sin datos";
  const min = Math.floor((Date.now() - ts.toMillis()) / 60000);
  if (min < 1) return "justo ahora";
  if (min === 1) return "hace 1 min";
  if (min < 60) return `hace ${min} min`;
  return `hace ${Math.floor(min / 60)} h`;
}

function escapeHtmlNet(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Agrupa por auxiliar y numera las recogidas en orden real de llegada
// (sin importar de qué celular vinieron) — así se ve "Recogida 1 = Ferney,
// Recogida 2 = Giovanni" tal cual pasó, con la dirección de la asignación.
function renderPickupHistory(events) {
  if (events === null) {
    networkContent.innerHTML = '<p class="summary-empty">No se pudo cargar la Red — revisa tu conexión a internet o inténtalo de nuevo en un momento.</p>';
    return;
  }
  if (events.length === 0) {
    networkContent.innerHTML = '<p class="summary-empty">Todavía no hay recogidas registradas hoy.</p>';
    return;
  }
  events.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));

  const byAux = {};
  events.forEach(ev => {
    const key = ev.auxKey || ev.auxName;
    (byAux[key] = byAux[key] || { auxName: ev.auxName, list: [] }).list.push(ev);
  });

  networkContent.innerHTML = Object.values(byAux).map(group => `
    <div class="network-aux-group">
      <div class="network-aux-name">${escapeHtmlNet(group.auxName)}</div>
      ${group.list.map((ev, i) => `
        <div class="network-item">
          <div class="network-item-top">
            <span>Recogida ${i + 1} — ${escapeHtmlNet(ev.logisticoName || "?")}</span>
            <span class="network-item-time">${networkTimeAgo(ev.createdAt)}</span>
          </div>
          <div class="network-item-nums">
            <span>👥 ${ev.patientCount || 0} pacientes</span>
            <span>🧪 ${ev.tubeCount || 0} tubos</span>
            <span class="network-item-loc">📍 ${ev.address ? escapeHtmlNet(ev.address) : "Sin asignación"}</span>
          </div>
        </div>
      `).join("")}
    </div>
  `).join("");
}

const networkCoordinatorsEl = document.getElementById("networkCoordinators");
const networkAssignmentsEl = document.getElementById("networkAssignments");
let assignmentsUnsub = null;

function renderNetworkCoordinators(assignments) {
  if (assignments === null) {
    networkCoordinatorsEl.innerHTML = '<p class="summary-empty">No se pudo cargar.</p>';
    return;
  }
  const names = [...new Set(assignments.map(a => a.createdBy).filter(Boolean))];
  if (names.length === 0) {
    networkCoordinatorsEl.innerHTML = '<p class="summary-empty">Nadie ha asignado nada hoy.</p>';
    return;
  }
  networkCoordinatorsEl.innerHTML = names.map(n => `<span class="coord-chip">👤 ${escapeHtmlNet(n)}</span>`).join("");
}

function renderNetworkAssignments(assignments) {
  if (assignments === null) {
    networkAssignmentsEl.innerHTML = '<p class="summary-empty">No se pudo cargar — revisa tu conexión o inténtalo de nuevo.</p>';
    return;
  }
  if (assignments.length === 0) {
    networkAssignmentsEl.innerHTML = '<p class="summary-empty">Sin asignaciones todavía.</p>';
    return;
  }
  const sorted = [...assignments].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  networkAssignmentsEl.innerHTML = sorted.map(d => `
    <div class="assign-item">
      <div class="assign-item-top">
        <span>${escapeHtmlNet(d.logisticoName || "?")} → ${escapeHtmlNet(d.auxName || "?")}${d.hora ? " · 🕐 " + escapeHtmlNet(d.hora) : ""}</span>
        <span class="assign-badge assign-badge-${d.status}">${
          d.status === "pendiente" ? "Pendiente" : d.status === "vista" ? "Vista" : "Hecha"
        }</span>
      </div>
      <div class="assign-item-addr">📍 ${escapeHtmlNet(d.address || "")}${d.solicitud ? " · N° " + escapeHtmlNet(d.solicitud) : ""}${d.note ? " · " + escapeHtmlNet(d.note) : ""} — asignó ${escapeHtmlNet(d.createdBy || "?")}</div>
    </div>
  `).join("");
}

networkBtn.addEventListener("click", () => {
  networkModal.hidden = false;
  networkContent.innerHTML = '<p class="summary-empty">Cargando...</p>';
  networkAssignmentsEl.innerHTML = '<p class="summary-empty">Cargando...</p>';
  networkCoordinatorsEl.innerHTML = '<p class="summary-empty">Cargando...</p>';
  if (!window.ReporteSync) {
    networkContent.innerHTML = '<p class="summary-empty">No se pudo conectar.</p>';
    networkAssignmentsEl.innerHTML = "";
    networkCoordinatorsEl.innerHTML = "";
    return;
  }
  if (networkUnsub) networkUnsub();
  if (assignmentsUnsub) assignmentsUnsub();
  networkUnsub = window.ReporteSync.listenPickupHistory(renderPickupHistory);
  assignmentsUnsub = window.ReporteSync.listenAllAssignments((docs) => {
    renderNetworkCoordinators(docs);
    renderNetworkAssignments(docs);
  });

  setTimeout(() => {
    if (networkContent.innerHTML.includes("Cargando...")) {
      networkContent.innerHTML = '<p class="summary-empty">Está tardando más de lo normal. Cierra e inténtalo de nuevo — puede ser conexión o permisos de Firestore.</p>';
    }
    if (networkAssignmentsEl.innerHTML.includes("Cargando...")) {
      networkAssignmentsEl.innerHTML = '<p class="summary-empty">Está tardando más de lo normal.</p>';
    }
    if (networkCoordinatorsEl.innerHTML.includes("Cargando...")) {
      networkCoordinatorsEl.innerHTML = "";
    }
  }, 7000);
});

function closeNetworkModal() {
  networkModal.hidden = true;
  if (networkUnsub) { networkUnsub(); networkUnsub = null; }
  if (assignmentsUnsub) { assignmentsUnsub(); assignmentsUnsub = null; }
}
networkModalClose.addEventListener("click", closeNetworkModal);
networkModal.addEventListener("click", (e) => {
  if (e.target === networkModal) closeNetworkModal();
});

// ---------------- Identidad del logístico (para el panel de coordinador) ----------------
// Se pregunta una sola vez por celular, apenas se confirma que sync.js
// cargó correctamente. Si Firebase no está disponible (sin internet,
// CDN bloqueado, etc.) simplemente no se pregunta nada y la app sigue
// funcionando exactamente igual que siempre.
const IDENTITY_SKIPPED_KEY = "reporte_logisticos_identity_skipped";

window.addEventListener("load", () => {
  if (!window.ReporteSync) return;
  if (window.ReporteSync.getMyIdentity()) return;
  let skipped = false;
  try { skipped = !!localStorage.getItem(IDENTITY_SKIPPED_KEY); } catch (e) {}
  if (skipped) return;

  const identityModal = document.getElementById("identityModal");
  const identityInput = document.getElementById("identityInput");
  const identityError = document.getElementById("identityError");
  const identitySaveBtn = document.getElementById("identitySaveBtn");
  const identitySkipBtn = document.getElementById("identitySkipBtn");
  if (!identityModal || !identityInput || !identitySaveBtn || !identitySkipBtn) return;

  identityModal.hidden = false;

  identitySaveBtn.addEventListener("click", () => {
    const val = identityInput.value.trim();
    if (!val) { identityInput.focus(); return; }
    const person = window.ReporteSync.loginWithPhone(val);
    if (!person) {
      identityError.style.display = "block";
      identityInput.focus();
      return;
    }
    identityModal.hidden = true;
    pushCoordinatorSync();
    startAssignmentListener();
    renderWelcomeStrip();
    showToast(`¡Listo, ${person.name}! Ya apareces en el panel de coordinador.`, 2600);
  });

  identitySkipBtn.addEventListener("click", () => {
    try { localStorage.setItem(IDENTITY_SKIPPED_KEY, "1"); } catch (e) {}
    identityModal.hidden = true;
  });

  identityInput.addEventListener("input", () => { identityError.style.display = "none"; });
  identityInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") identitySaveBtn.click();
  });
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