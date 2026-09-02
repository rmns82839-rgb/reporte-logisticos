// ============================================================
// Reporte Logísticos — sin base de datos, todo en memoria/localStorage
// ============================================================

const AUXILIARES = [
  "Cristian", "Iván", "Brenda", "Jonathan", "Marlio",
  "Camilo", "Milena", "Luis", "Edison"
];

// Orden de opciones en cada desplegable: VIP primero (preseleccionado),
// FSFB segunda opción, Poliza tercera. "" = Sin marcar (esa hora no llegó).
const COMPANIES = [
  { key: "vip",    label: "VIP",    css: "c-vip" },
  { key: "fsfb",   label: "FSFB",   css: "c-fsfb" },
  { key: "poliza", label: "Poliza", css: "c-poliza" },
];
const DEFAULT_COMPANY = "vip";

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

const STORAGE_KEY = "reporte_logisticos_state_v2";

function buildFixedHours() {
  const list = [];
  let h = 5, m = 0;
  for (let i = 0; i < 13; i++) {
    list.push({ time: formatTime(h, m), company: DEFAULT_COMPANY });
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

function freshState() {
  return {
    auxIndex: null,
    hours: buildFixedHours(),
    extras: [],
    tubes: emptyTubeState(),
    otrosDetalle: "",
  };
}

let state = loadState() || freshState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.tubes || !parsed.hours) return null;
    TUBOS.forEach(tb => {
      if (!parsed.tubes[tb.key]) parsed.tubes[tb.key] = { vip: 0, fsfb: 0, poliza: 0 };
    });
    if (typeof parsed.otrosDetalle !== "string") parsed.otrosDetalle = "";
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

// ---------------- DOM refs ----------------
const auxGrid = document.getElementById("auxGrid");
const hourGrid = document.getElementById("hourGrid");
const extraList = document.getElementById("extraList");
const addExtraBtn = document.getElementById("addExtraBtn");
const tubeList = document.getElementById("tubeList");
const preview = document.getElementById("preview");
const copyBtn = document.getElementById("copyBtn");
const sendBtn = document.getElementById("sendBtn");
const resetBtn = document.getElementById("resetBtn");
const toast = document.getElementById("toast");

// ---------------- Render: Auxiliares ----------------
function renderAux() {
  auxGrid.innerHTML = "";
  AUXILIARES.forEach((name, i) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "aux-chip" + (state.auxIndex === i ? " active" : "");
    chip.innerHTML = `<span class="avatar">${initials(name)}</span><span>${name}</span>`;
    chip.addEventListener("click", () => {
      state.auxIndex = i;
      saveState();
      renderAux();
      renderPreview();
    });
    auxGrid.appendChild(chip);
  });
}

function initials(name) {
  return name.slice(0, 2).toUpperCase();
}

// ---------------- Select de compañía (reutilizable) ----------------
function buildCompanySelect(currentValue, onChange) {
  const select = document.createElement("select");
  select.className = "company-select";

  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "Sin marcar";
  select.appendChild(blank);

  COMPANIES.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.key;
    opt.textContent = c.label;
    select.appendChild(opt);
  });

  select.value = currentValue || "";
  applyCompanyClass(select, currentValue);

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

// ---------------- Render: Horas fijas ----------------
function renderHours() {
  hourGrid.innerHTML = "";
  state.hours.forEach((slot, i) => {
    const row = document.createElement("div");
    row.className = "hour-row";
    const label = document.createElement("span");
    label.className = "hour-time";
    label.textContent = slot.time;
    row.appendChild(label);

    const select = buildCompanySelect(slot.company, (val) => {
      state.hours[i].company = val;
      saveState();
      renderPreview();
    });
    row.appendChild(select);

    hourGrid.appendChild(row);
  });
}

// ---------------- Render: Horas extra ----------------
function renderExtras() {
  extraList.innerHTML = "";
  state.extras.forEach((extra, i) => {
    const row = document.createElement("div");
    row.className = "extra-row";

    const timeInput = document.createElement("input");
    timeInput.type = "time";
    timeInput.value = extra.time || "";
    timeInput.addEventListener("change", () => {
      state.extras[i].time = timeInput.value;
      saveState();
      renderPreview();
    });

    const select = buildCompanySelect(extra.company, (val) => {
      state.extras[i].company = val;
      saveState();
      renderPreview();
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "del-btn";
    delBtn.title = "Eliminar";
    delBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 7h12l-1 14H7L6 7zm3-4h6l1 2h4v2H2V5h4l1-2z"/></svg>`;
    delBtn.addEventListener("click", () => {
      state.extras.splice(i, 1);
      saveState(); renderExtras(); renderPreview();
    });

    row.appendChild(timeInput);
    row.appendChild(select);
    row.appendChild(delBtn);
    extraList.appendChild(row);
  });
}

addExtraBtn.addEventListener("click", () => {
  state.extras.push({ time: "", company: DEFAULT_COMPANY });
  saveState();
  renderExtras();
});

// ---------------- Render: Tubos ----------------
function renderTubes() {
  tubeList.innerHTML = "";
  TUBOS.forEach(tb => {
    const counts = state.tubes[tb.key];
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
      box.className = "stepper";
      box.innerHTML = `
        <span class="stepper-label">${c.label}</span>
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
      noteInput.value = state.otrosDetalle || "";
      noteInput.addEventListener("input", () => {
        state.otrosDetalle = noteInput.value;
        saveState();
        renderPreview();
      });
      noteWrap.appendChild(noteInput);
      row.appendChild(noteWrap);
    }

    tubeList.appendChild(row);
  });
}

// ---------------- Mensaje / preview ----------------
function companyLabel(key) {
  const found = COMPANIES.find(c => c.key === key);
  return found ? found.label : key;
}

function buildMessage() {
  const auxName = state.auxIndex !== null ? AUXILIARES[state.auxIndex] : "(sin seleccionar)";

  const markedHours = state.hours.filter(h => h.company);
  const markedExtras = state.extras.filter(e => e.company && e.time);

  const lines = [];
  lines.push("*Reporte de recepción de muestras*");
  lines.push(`👤 Auxiliar: ${auxName}`);
  lines.push("");
  lines.push("⏰ Horas:");

  if (markedHours.length === 0 && markedExtras.length === 0) {
    lines.push("• Sin horas marcadas");
  } else {
    markedHours.forEach(h => {
      lines.push(`• ${h.time} — ${companyLabel(h.company).toUpperCase()}`);
    });
    markedExtras.forEach(e => {
      lines.push(`• ${formatExtraTime(e.time)} — ${companyLabel(e.company).toUpperCase()} (extra)`);
    });
  }

  lines.push("");
  lines.push("🧪 Tubos recibidos:");
  const tubesWithTotal = TUBOS.map(tb => {
    const c = state.tubes[tb.key];
    return { ...tb, total: c.vip + c.fsfb + c.poliza };
  }).filter(tb => tb.total > 0);

  if (tubesWithTotal.length === 0) {
    lines.push("• Sin tubos registrados");
  } else {
    tubesWithTotal.forEach(tb => {
      if (tb.key === "Otros" && state.otrosDetalle.trim()) {
        lines.push(`${tb.emoji} ${tb.key}: ${tb.total} (${state.otrosDetalle.trim()})`);
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
    const c = state.tubes[tb.key];
    tubeTotals.vip += c.vip;
    tubeTotals.fsfb += c.fsfb;
    tubeTotals.poliza += c.poliza;
  });

  const patientLine = COMPANIES
    .filter(c => patientTotals[c.key] > 0)
    .map(c => `${c.label}: ${patientTotals[c.key]}`)
    .join(" · ");

  const tubeLine = COMPANIES
    .filter(c => tubeTotals[c.key] > 0)
    .map(c => `${c.label}: ${tubeTotals[c.key]}`)
    .join(" · ");

  lines.push("");
  lines.push("*Totales por compañía:*");
  lines.push(`👥 Pacientes — ${patientLine || "sin datos"}`);
  lines.push(`🧪 Tubos — ${tubeLine || "sin datos"}`);

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

function renderPreview() {
  preview.textContent = buildMessage();
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
  if (!confirm("¿Iniciar un nuevo reporte? Se perderá lo que no hayas enviado.")) return;
  state = freshState();
  saveState();
  renderAll();
});

// ---------------- Init ----------------
function renderAll() {
  renderAux();
  renderHours();
  renderExtras();
  renderTubes();
  renderPreview();
}

renderAll();

// ---------------- PWA: service worker ----------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}