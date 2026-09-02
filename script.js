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
    list.push({ time: formatTime(h, m), selected: false, company: "vip" });
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
function freshAuxData() {
  return {
    hours: buildFixedHours(),
    extras: [],
    tubes: emptyTubeState(),
    otrosDetalle: "",
    papeleria: [],
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

// ---------------- DOM refs ----------------
const auxGrid = document.getElementById("auxGrid");
const auxOtherBtn = document.getElementById("auxOtherBtn");
const auxOtherWrap = document.getElementById("auxOtherWrap");
const auxOtherInput = document.getElementById("auxOtherInput");

const hourGridA = document.getElementById("hourGridA");
const hourGridB = document.getElementById("hourGridB");
const hourBadgeA = document.getElementById("hourBadgeA");
const hourBadgeB = document.getElementById("hourBadgeB");
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

function selectAux(i) {
  state.auxIndex = i;
  saveState();
  renderAll();
}

function renderAux() {
  auxGrid.innerHTML = "";
  AUXILIARES.forEach((name, i) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "aux-chip" + (state.auxIndex === i ? " active" : "");
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
    row.className = "hour-row" + (slot.selected ? " is-set" : "");

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "hour-check";
    check.checked = !!slot.selected;
    check.setAttribute("aria-label", `Recibido a las ${slot.time}`);
    check.addEventListener("change", () => {
      data.hours[i].selected = check.checked;
      saveState();
      renderHours();
      renderPreview();
    });

    const label = document.createElement("span");
    label.className = "hour-time";
    label.textContent = slot.time;

    const select = buildCompanySelect(slot.company, (val) => {
      data.hours[i].company = val;
      saveState();
      renderPreview();
    });
    select.disabled = !slot.selected;

    row.appendChild(check);
    row.appendChild(label);
    row.appendChild(select);
    container.appendChild(row);
  }
}

function renderHours() {
  const data = currentData();
  renderHourGroup(hourGridA, data, 0, HOURS_SPLIT);
  renderHourGroup(hourGridB, data, HOURS_SPLIT, data.hours.length);

  const countA = data.hours.slice(0, HOURS_SPLIT).filter(h => h.selected).length;
  const countB = data.hours.slice(HOURS_SPLIT).filter(h => h.selected).length;
  hourBadgeA.textContent = `${countA}/${HOURS_SPLIT}`;
  hourBadgeB.textContent = `${countB}/${data.hours.length - HOURS_SPLIT}`;
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
  data.extras.push({ time: "", company: "vip" });
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
      box.className = `stepper co-${c.key}`;
      box.innerHTML = `
        <span class="stepper-label"><i class="co-dot co-dot-${c.key}"></i>${c.label}</span>
        <div class="stepper-controls">
          <button type="button" class="step-btn minus">–</button>
          <span class="step-value">${counts[c.key]}</span>
          <button type="button" class="step-btn plus">+</button>
        </div>`;

      box.querySelector(".minus").addEventListener("click", () => {
        counts[c.key] = Math.max(0, counts[c.key] - 1);
        saveState(); renderTubes(); renderPreview();
      });
      box.querySelector(".plus").addEventListener("click", () => {
        counts[c.key] += 1;
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

function buildMessage() {
  const data = currentData();
  const auxName = currentAuxName();

  const markedHours = data.hours.filter(h => h.selected);
  const markedExtras = data.extras.filter(e => e.company && e.time);

  const lines = [];
  lines.push("📋 *Reporte de recepción de muestras*");
  lines.push(`📅 ${todayLabel()}`);
  lines.push(`👤 Auxiliar: ${auxName}`);
  lines.push("");
  lines.push("⏰ *Horas:*");

  if (markedHours.length === 0 && markedExtras.length === 0) {
    lines.push("• Sin horas marcadas");
  } else {
    markedHours.forEach(h => {
      lines.push(`• ${h.time} — ${companyEmoji(h.company)} ${companyLabel(h.company).toUpperCase()}`);
    });
    markedExtras.forEach(e => {
      lines.push(`• ${formatExtraTime(e.time)} — ${companyEmoji(e.company)} ${companyLabel(e.company).toUpperCase()} (extra)`);
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
  markedHours.forEach(h => patientTotals[h.company]++);
  markedExtras.forEach(e => patientTotals[e.company]++);

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
  const text = buildMessage();
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
  const text = buildMessage();
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