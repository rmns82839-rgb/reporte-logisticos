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

// ---------------- Estado: uno por auxiliar ----------------
function localDateKey(d) {
  d = d || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function freshAuxData() {
  return {
    hours: buildFixedHours(),
    extras: [],
    tubes: emptyTubeState(),
    otrosDetalle: "",
    papeleria: [],
    pickupsToday: { date: localDateKey(), count: 0 },
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
      });
      if (!d.pickupsToday || typeof d.pickupsToday.count !== "number") {
        d.pickupsToday = { date: localDateKey(), count: 0 };
      }
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
function currentData() {
  const key = currentAuxKey();
  if (!key) return freshAuxData();
  if (!state.byAux[key]) state.byAux[key] = freshAuxData();
  return state.byAux[key];
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
// envíe no repite lo que ya se mandó en este.
function registerSendBatch(data) {
  ensurePickupsToday(data);
  const pendingReceived = [];
  data.hours.forEach(h => { if (h.selected && !h.pickup) pendingReceived.push(h); });
  data.extras.forEach(e => { if (e.company && e.time && !e.pickup) pendingReceived.push(e); });

  if (pendingReceived.length > 0) {
    data.pickupsToday.count += 1;
    const num = data.pickupsToday.count;
    pendingReceived.forEach(h => { h.pickup = num; });
  }

  data.hours.forEach(h => { if (h.cancelled) h.cancelReported = true; });
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
  const el = e.target.closest(".btn, .icon-btn, .aux-chip, .step-btn, .cancel-btn, .ghost-btn, .del-btn, .aux-other-btn");
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
const extraList = document.getElementById("extraList");
const addExtraBtn = document.getElementById("addExtraBtn");

const tubeListA = document.getElementById("tubeListA");
const tubeListB = document.getElementById("tubeListB");
const tubeBadgeA = document.getElementById("tubeBadgeA");
const tubeBadgeB = document.getElementById("tubeBadgeB");

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
    row.className = "hour-row" + (slot.selected ? " is-set" : "") + (slot.cancelled ? " is-cancelled" : "") + (i === lastToggledHourIndex ? " pop" : "");

    const label = document.createElement("span");
    label.className = "hour-time";
    label.textContent = slot.time;
    if (slot.pickup) {
      const tag = document.createElement("span");
      tag.className = "pickup-tag";
      tag.title = `Recogida ${slot.pickup}`;
      tag.textContent = slot.pickup;
      label.appendChild(tag);
    }

    // toggle de dos posiciones: ✓ Recibido / ✕ Cancelado (mutuamente excluyentes)
    const toggle = document.createElement("div");
    toggle.className = "status-toggle";

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

    toggle.appendChild(receivedBtn);
    toggle.appendChild(cancelBtn);

    // desplegable de compañía (recibido) o etiqueta roja (cancelado) — comparten la misma celda
    const select = buildCompanySelect(slot.company, (val) => {
      data.hours[i].company = val;
      saveState();
      renderPreview();
    });
    select.disabled = !slot.selected;
    select.hidden = !!slot.cancelled;

    const cancelLabel = document.createElement("span");
    cancelLabel.className = "cancel-label";
    cancelLabel.textContent = "🚫 Cancelado";
    cancelLabel.hidden = !slot.cancelled;

    row.appendChild(label);
    row.appendChild(toggle);
    row.appendChild(select);
    row.appendChild(cancelLabel);
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
  if (data.pickupsToday.count > 0) {
    pickupInfo.hidden = false;
    pickupInfo.textContent = `🔁 Recogidas registradas hoy: ${data.pickupsToday.count}`;
  } else {
    pickupInfo.hidden = true;
  }
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
  data.extras.push({ time: "", company: "vip", pickup: null });
  saveState();
  renderExtras();
});

// ---------------- Render: Tubos (dos acordeones) ----------------
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

      box.querySelector(".minus").addEventListener("click", () => {
        counts[c.key] = Math.max(0, counts[c.key] - 1);
        lastToggledTube = { key: tb.key, company: c.key };
        saveState(); renderTubes(); renderPreview();
      });
      box.querySelector(".plus").addEventListener("click", () => {
        counts[c.key] += 1;
        lastToggledTube = { key: tb.key, company: c.key };
        saveState(); renderTubes(); renderPreview();
      });

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
    const c = data.tubes[tb.key];
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
    const c = data.tubes[tb.key];
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
        .filter(tb => data.tubes[tb.key][c.key] > 0)
        .map(tb => `   ${tb.emoji} ${tb.key}: ${data.tubes[tb.key][c.key]}`)
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
    const c = data.tubes[tb.key];
    tubeTotal += c.vip + c.fsfb + c.poliza;
  });

  return { patientTotal, tubeTotal };
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
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 1800);
}

copyBtn.addEventListener("click", async () => {
  const data = currentData();
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

// ---------------- Init ----------------
function renderAll() {
  renderAux();
  renderHours();
  renderExtras();
  renderTubes();
  renderPapeleria();
  renderPreview();
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