// exams.js — Catálogo de exámenes/tubos del módulo de auxiliares.
// Separado de auxiliar.html para que ese archivo no siga creciendo.
// Se conecta pasándole `db` (Firestore ya inicializado en auxiliar.html)
// en cada llamada — este archivo NUNCA inicializa Firebase por su cuenta,
// para no repetir el bug de doble-inicialización que ya tuvimos antes.

import {
  collection, doc, getDocs, setDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export function perplexityUrl(codigo, nombre) {
  const query = `Examen de laboratorio "${nombre}"${codigo ? ` (código CUPS ${codigo})` : ""}: ¿en qué tubo se toma (color y anticoagulante), requiere ayuno, condiciones especiales de la muestra (proteger de luz, frío), y se puede combinar con otros exámenes en el mismo tubo? ¿Para qué sirve?`;
  return `https://www.perplexity.ai/search?q=${encodeURIComponent(query)}`;
}

export const TUBOS_AUX = [
  { key: "Amarillo",      emoji: "🟡", color: "#e8b923", esTubo: true },
  { key: "Lila",          emoji: "🟣", color: "#9b6fd6", esTubo: true },
  { key: "Azul",          emoji: "🔵", color: "#3b82f6", esTubo: true },
  { key: "Rojo",          emoji: "🔴", color: "#e5484d", esTubo: true },
  { key: "Azul rey",      emoji: "👑", color: "#1e3a8a", esTubo: true },
  { key: "Transparente",  emoji: "⚪", color: "#9ca3af", esTubo: true },
  { key: "Orina",         emoji: "💧", color: "#d4a24c", esTubo: true },
  { key: "Orina 24h",     emoji: "🕐", color: "#b8863f", esTubo: true },
  { key: "Saliva",        emoji: "💦", color: "#67c9d6", esTubo: true },
  { key: "Materia fecal", emoji: "💩", color: "#8b5e3c", esTubo: true },
  { key: "Laminas",       emoji: "🩸", color: "#e07a9e", esTubo: true },
  { key: "Hisopo nasal",  emoji: "👃", color: "#4fb286", esTubo: true },
  { key: "Sonda Vesical", emoji: "🚰", color: "#78716c", esTubo: false },
];

// ---------------- Emparejamiento (portado tal cual de RutaLab Pro) ----------------
// Ya probado y depurado ahí — sin tildes, por palabras significativas
// ≥4 letras, overlap del 60% del set más pequeño. La diferencia: aquí
// emparejamos primero por CÓDIGO CUPS cuando existe (100% confiable), y
// solo caemos al fuzzy matching de nombre para los que no traen código
// (ej. "PERFIL LIPIDICO").
export function normStr(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function sigW(s) {
  return new Set(normStr(s).split(" ").filter(w => w.length >= 4));
}
export function examNamesMatch(nombreA, nombreB) {
  const a = normStr(nombreA), b = normStr(nombreB);
  if (a === b) return true;
  const wa = sigW(nombreA), wb = sigW(nombreB);
  if (wa.size === 0 || wb.size === 0) return false;
  const [shorter, longer] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  let common = 0;
  shorter.forEach(w => { if (longer.has(w)) common++; });
  return (common / shorter.size) >= 0.6;
}

// "902210 HEMOGRAMA IV" -> {codigo:"902210", nombre:"HEMOGRAMA IV"}
// "903841-O CREATININA EN ORINA" -> {codigo:"903841-O", nombre:"CREATININA EN ORINA"}
// "PERFIL LIPIDICO" (sin código) -> {codigo:"", nombre:"PERFIL LIPIDICO"}
export function splitExamCodeName(examStr) {
  const m = String(examStr || "").trim().match(/^(\d{4,7}(?:-[A-Za-z0-9]+)?)\s+(.+)$/);
  if (m) return { codigo: m[1], nombre: m[2].trim() };
  return { codigo: "", nombre: String(examStr || "").trim() };
}

export function collectUniqueExams(patients) {
  const map = new Map();
  patients.forEach(p => {
    (p.examenes || []).forEach(examStr => {
      const { codigo, nombre } = splitExamCodeName(examStr);
      if (!nombre) return;
      const key = codigo || normStr(nombre);
      if (!map.has(key)) map.set(key, { codigo, nombre });
    });
  });
  return [...map.values()];
}

// ---------------- Catálogo en Firestore ----------------
export async function fetchExamCatalogo(db) {
  try {
    const snap = await getDocs(collection(db, "examenesCatalogo"));
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    return list;
  } catch (e) {
    console.warn("[exams.js] No se pudo traer el catálogo de exámenes:", e);
    return [];
  }
}

// Caché compartido en memoria — la Guía de exámenes y los chips de
// colores en la tarjeta del paciente usan el mismo catálogo, para no
// pedirlo a Firebase más de una vez por sesión. invalidateCatalogoCache()
// se llama después de clasificar/editar algo, para refrescarlo.
let catalogoCache = null;
export async function getCatalogoCached(db) {
  if (catalogoCache) return catalogoCache;
  catalogoCache = await fetchExamCatalogo(db);
  return catalogoCache;
}
export function invalidateCatalogoCache() {
  catalogoCache = null;
}

// ---------------- Correcciones de nombres pegados ----------------
// Cuando el auxiliar corrige o separa un examen que vino mal armado
// desde el Excel, se guarda esa corrección para siempre en Firebase
// (con quién y cuándo) — así, si el mismo texto pegado vuelve a
// aparecer en otra planilla (el mismo error de la fuente original se
// repite seguido), se aplica solo, sin que toque corregirlo de nuevo.
function correccionDocId(textoOriginal) {
  return normStr(textoOriginal).replace(/\s+/g, "_").slice(0, 120) || "correccion";
}

export async function guardarCorreccionExamen(db, textoOriginal, partes, editadoPor) {
  try {
    await setDoc(doc(db, "correccionesExamenes", correccionDocId(textoOriginal)), {
      original: textoOriginal,
      partes,
      editadoPor: editadoPor || "",
      actualizadoEn: serverTimestamp(),
    }, { merge: true });
    return true;
  } catch (e) {
    console.warn("[exams.js] No se pudo guardar la corrección:", e);
    return false;
  }
}

let correccionesCache = null;
export async function getCorreccionesCached(db) {
  if (correccionesCache) return correccionesCache;
  try {
    const snap = await getDocs(collection(db, "correccionesExamenes"));
    const map = new Map();
    snap.forEach(d => map.set(d.data().original, d.data().partes));
    correccionesCache = map;
  } catch (e) {
    console.warn("[exams.js] No se pudo traer las correcciones de exámenes:", e);
    correccionesCache = new Map();
  }
  return correccionesCache;
}
export function invalidateCorreccionesCache() {
  correccionesCache = null;
}

// Aplica las correcciones ya conocidas a una lista de exámenes recién
// importada — si un texto coincide EXACTO con uno ya corregido antes,
// se reemplaza solo por sus partes corregidas.
export function aplicarCorrecciones(examenes, correccionesMap) {
  if (!correccionesMap || correccionesMap.size === 0) return examenes;
  const resultado = [];
  examenes.forEach(texto => {
    const partes = correccionesMap.get(texto);
    if (partes && partes.length) resultado.push(...partes);
    else resultado.push(texto);
  });
  return resultado;
}

// Chips de colores para la lista de exámenes de la tarjeta del paciente
// — cada examen se pinta con el color real del tubo que le corresponde
// según el catálogo. Sin clasificar todavía = chip gris con "?".
export function renderExamChipsHtml(catalogo, examenes, escapeHtml) {
  if (!examenes || examenes.length === 0) return "";
  return examenes.map((examStr, idx) => {
    const { codigo, nombre } = splitExamCodeName(examStr);
    const r = findInCatalogo(catalogo, codigo, nombre);
    const tb = r.entry ? TUBOS_AUX.find(t => t.key === r.entry.tubo) : null;
    const color = tb ? tb.color : "#6b7280";
    const emoji = tb ? tb.emoji : "❓";
    const luz = r.entry && r.entry.cubrirLuz ? " 🌑" : "";
    const sinClasificar = !r.entry;
    const cls = sinClasificar ? "exam-chip exam-chip-unclassified" : "exam-chip";
    const attrs = sinClasificar ? ` data-codigo="${escapeHtml(codigo)}" data-nombre="${escapeHtml(nombre)}" title="Toca para clasificar"` : "";
    return `<div class="${cls}" style="border-left-color:${color};"${attrs}><span class="exam-chip-tube">${emoji}</span><span class="exam-chip-name">${escapeHtml(examStr)}${luz}</span><button type="button" class="exam-chip-edit-btn" data-idx="${idx}" title="Editar o separar el nombre">✏️</button></div>`;
  }).join("");
}

// Busca coincidencia. Devuelve tres estados posibles:
//  - { entry: {...} }                 -> ya está clasificado, nada que hacer
//  - { conflict: true, existentes }   -> el código YA existe pero para un
//                                        nombre distinto (ej. H. Pylori en
//                                        sangre vs en materia fecal) — el
//                                        auxiliar tiene que decidir
//  - { entry: null, conflict: false } -> de verdad es nuevo
export function findInCatalogo(catalogo, codigo, nombre) {
  if (codigo) {
    // Incluye variantes ya creadas antes: "902210", "902210-2", "902210-3"...
    const mismoCodigo = catalogo.filter(c => c.codigo === codigo || String(c.codigo || "").startsWith(`${codigo}-`));
    const matchLimpio = mismoCodigo.find(c => examNamesMatch(nombre, c.nombre));
    if (matchLimpio) return { entry: matchLimpio, conflict: false };
    if (mismoCodigo.length > 0) return { entry: null, conflict: true, existentes: mismoCodigo };
  }
  const porNombre = catalogo.find(c => examNamesMatch(nombre, c.nombre));
  if (porNombre) return { entry: porNombre, conflict: false };
  return { entry: null, conflict: false, existentes: [] };
}

export function examDocId(codigo, nombre) {
  return codigo || normStr(nombre).replace(/\s+/g, "_").slice(0, 80) || "examen";
}

// ---------------- Contador de tubos ----------------
// Función pura (sin DOM, sin Firebase) — recibe el catálogo ya cargado y
// la lista de exámenes de un paciente, y devuelve cuántos tubos FÍSICOS
// hacen falta, agrupando lo que se puede compartir (respetando la
// capacidad de cada grupo) y separando lo que va solo o necesita varios
// tubos (ej. PTH). Reutilizable desde la tarjeta de paciente y desde
// papelería — ninguna de las dos tiene que repetir esta lógica.
export function computeTubeCounts(catalogo, examenes) {
  const resultado = { tubos: [], sinClasificar: [], totalTubos: 0 };
  if (!examenes || examenes.length === 0) return resultado;

  const multiples = [];       // exámenes con cantidadTubos > 1 — van solos, ocupan varios tubos
  const vaSoloIndividual = []; // sin grupo — 1 tubo cada uno
  const conGrupo = new Map();  // "tubo|grupo" -> {tubo, grupo, capacidad, cubrirLuz, examenes:[]}

  examenes.forEach(examStr => {
    const { codigo, nombre } = splitExamCodeName(examStr);
    const r = findInCatalogo(catalogo, codigo, nombre);
    if (!r.entry) { resultado.sinClasificar.push(examStr); return; }

    const entry = r.entry;
    const cant = entry.cantidadTubos || 1;
    if (cant > 1) {
      multiples.push({ tubo: entry.tubo, cantidad: cant, cubrirLuz: !!entry.cubrirLuz, nombre: examStr });
      return;
    }
    if (entry.grupo) {
      const key = `${entry.tubo}|${entry.grupo}`;
      if (!conGrupo.has(key)) conGrupo.set(key, { tubo: entry.tubo, grupo: entry.grupo, capacidad: entry.capacidadGrupo || 2, cubrirLuz: false, examenes: [] });
      const bucket = conGrupo.get(key);
      bucket.examenes.push(examStr);
      if (entry.cubrirLuz) bucket.cubrirLuz = true;
      return;
    }
    vaSoloIndividual.push({ tubo: entry.tubo, cubrirLuz: !!entry.cubrirLuz, nombre: examStr });
  });

  multiples.forEach(m => {
    resultado.tubos.push({ tubo: m.tubo, cantidad: m.cantidad, cubrirLuz: m.cubrirLuz, examenes: [m.nombre], vaSolo: true });
  });

  conGrupo.forEach(bucket => {
    const numTubos = Math.ceil(bucket.examenes.length / bucket.capacidad);
    for (let i = 0; i < numTubos; i++) {
      const trozo = bucket.examenes.slice(i * bucket.capacidad, (i + 1) * bucket.capacidad);
      resultado.tubos.push({ tubo: bucket.tubo, cantidad: 1, cubrirLuz: bucket.cubrirLuz, examenes: trozo, grupo: bucket.grupo });
    }
  });

  vaSoloIndividual.forEach(v => {
    resultado.tubos.push({ tubo: v.tubo, cantidad: 1, cubrirLuz: v.cubrirLuz, examenes: [v.nombre], vaSolo: true });
  });

  // Lo que no es tubo de verdad (ej. Sonda Vesical) se separa aparte —
  // no cuenta en el total de tubos, aunque sí quedó clasificado.
  resultado.procedimientos = [];
  resultado.tubos = resultado.tubos.filter(t => {
    const tb = TUBOS_AUX.find(x => x.key === t.tubo);
    if (tb && tb.esTubo === false) {
      resultado.procedimientos.push(t);
      return false;
    }
    return true;
  });

  resultado.totalTubos = resultado.tubos.reduce((sum, t) => sum + t.cantidad, 0);
  resultado.totalCubrirLuz = resultado.tubos.filter(t => t.cubrirLuz).reduce((sum, t) => sum + t.cantidad, 0);
  return resultado;
}

// Render de referencia para el resultado de computeTubeCounts — se usa
// tal cual en la tarjeta de paciente, y papelería la puede reutilizar.
export function renderTubeCountHtml(resultado, escapeHtml) {
  if (resultado.totalTubos === 0 && resultado.sinClasificar.length === 0 && (!resultado.procedimientos || resultado.procedimientos.length === 0)) return "";

  // Resumen compacto por color: "🟡 2 Amarillo · 🟣 1 Lila · 💧 1 Orina"
  const porColor = {};
  resultado.tubos.forEach(t => { porColor[t.tubo] = (porColor[t.tubo] || 0) + t.cantidad; });
  const resumenCompacto = Object.entries(porColor).map(([tubo, n]) => {
    const tb = TUBOS_AUX.find(x => x.key === tubo);
    return `${tb ? tb.emoji : ""} ${n} ${escapeHtml(tubo)}`;
  }).join(" · ");

  const lineas = resultado.tubos.map(t => {
    const tb = TUBOS_AUX.find(x => x.key === t.tubo);
    const emoji = tb ? tb.emoji : "❓";
    const luz = t.cubrirLuz ? " 🌑" : "";
    const candado = t.vaSolo ? " 🔒" : "";
    const cantidadTxt = t.cantidad > 1 ? ` ×${t.cantidad}` : "";
    const detalle = t.examenes.map(e => escapeHtml(e)).join(", ");
    return `<div class="tube-count-row" style="border-left-color:${tb ? tb.color : "#6b7280"};">
      <span class="tube-count-main">${emoji} ${escapeHtml(t.tubo)}${cantidadTxt}${luz}${candado}</span>
      <span class="tube-count-detail">${detalle}</span>
    </div>`;
  }).join("");

  const procedimientosHtml = (resultado.procedimientos && resultado.procedimientos.length > 0)
    ? `<p class="tube-count-procedimientos-label">📋 Otros procedimientos (no son tubos)</p>
       <div class="tube-count-list">${resultado.procedimientos.map(t => {
         const tb = TUBOS_AUX.find(x => x.key === t.tubo);
         return `<div class="tube-count-row" style="border-left-color:${tb ? tb.color : "#6b7280"};">
           <span class="tube-count-main">${tb ? tb.emoji : "❓"} ${escapeHtml(t.tubo)}</span>
           <span class="tube-count-detail">${t.examenes.map(e => escapeHtml(e)).join(", ")}</span>
         </div>`;
       }).join("")}</div>`
    : "";

  const sinClasificarHtml = resultado.sinClasificar.length > 0
    ? `<p class="tube-count-warning">⚠️ ${resultado.sinClasificar.length} examen${resultado.sinClasificar.length !== 1 ? "es" : ""} sin clasificar todavía, no cuenta${resultado.sinClasificar.length !== 1 ? "n" : ""} en este estimado: ${resultado.sinClasificar.map(e => escapeHtml(e)).join(", ")}</p>`
    : "";

  const luzTxt = resultado.totalCubrirLuz > 0 ? ` · 🌑 ${resultado.totalCubrirLuz} cubierto${resultado.totalCubrirLuz !== 1 ? "s" : ""} de la luz` : "";

  return `
    <p class="tube-count-total">🧪 Se estiman ${resultado.totalTubos} tubo${resultado.totalTubos !== 1 ? "s" : ""}${luzTxt}</p>
    ${resumenCompacto ? `<p class="tube-count-summary">${resumenCompacto}</p>` : ""}
    <div class="tube-count-list">${lineas}</div>
    ${procedimientosHtml}
    ${sinClasificarHtml}
  `;
}

// Para cuando el mismo código CUPS resulta siendo un examen distinto
// (ej. 234556 y 234556-2) — busca el siguiente sufijo libre.
export function nextCodeVariant(catalogo, codigo) {
  if (!codigo) return codigo;
  const existentes = new Set(catalogo.map(c => c.codigo));
  if (!existentes.has(codigo)) return codigo;
  let n = 2;
  while (existentes.has(`${codigo}-${n}`)) n++;
  return `${codigo}-${n}`;
}

export async function guardarClasificacionExamen(db, docId, datos, clasificadoPor) {
  try {
    await setDoc(doc(db, "examenesCatalogo", docId), {
      codigo: datos.codigo || "",
      nombre: datos.nombre,
      tubo: datos.tubo,
      cantidadTubos: datos.cantidadTubos || 1,
      grupo: datos.grupo || "",
      capacidadGrupo: datos.grupo ? (datos.capacidadGrupo || 2) : 0,
      cubrirLuz: !!datos.cubrirLuz,
      descripcion: (datos.descripcion || "").trim(),
      clasificadoPor: clasificadoPor || "",
      actualizadoEn: serverTimestamp(),
    }, { merge: true });
    return true;
  } catch (e) {
    console.warn("[exams.js] No se pudo guardar la clasificación:", e);
    return false;
  }
}

// ---------------- Modal: clasificar exámenes nuevos al importar ----------------
// Se llama una vez por import, después de parsear los pacientes. Si algo
// falla revisando el catálogo (sin señal, etc.) NUNCA bloquea el import
// en sí — llama a onDone igual, con nuevosCount = -1 para avisar que no
// se pudo revisar.
//
// Un examen puede caer en 2 categorías:
//  - "nuevo": no hay ni código ni nombre parecido en el catálogo.
//  - "conflicto": el código CUPS ya existe, pero para un nombre distinto
//    (ej. H. Pylori antígeno en materia fecal vs anticuerpos en sangre,
//    ambos con el mismo código). El auxiliar decide si es el mismo
//    examen (se actualiza el nombre) o uno distinto (se guarda aparte
//    como código-2, código-3...).
// ---------------- Desplegable único: "¿cómo se toma este examen?" ----------------
// En vez de escribir un nombre de grupo a mano, el auxiliar elige una de
// 4 opciones fijas. El grupo se arma solo, ligado al color del tubo
// elegido — así dos exámenes del mismo color y la misma opción siempre
// comparten tubo, y nunca se mezclan colores distintos.
export const TUBO_BEHAVIOR_OPTIONS = [
  { value: "grupo5", label: "🧪 Hasta 5 exámenes en un tubo" },
  { value: "grupo2", label: "🧪 Hasta 2 exámenes en un tubo" },
  { value: "solo", label: "🔒 Va solo en un tubo" },
  { value: "doble", label: "🔒 Se toman 2 tubos" },
];

export function deriveTuboFields(tubo, behavior) {
  switch (behavior) {
    case "grupo5": return { grupo: `${tubo}-5`, capacidadGrupo: 5, cantidadTubos: 1 };
    case "grupo2": return { grupo: `${tubo}-2`, capacidadGrupo: 2, cantidadTubos: 1 };
    case "doble":  return { grupo: "", capacidadGrupo: 0, cantidadTubos: 2 };
    case "solo":
    default:       return { grupo: "", capacidadGrupo: 0, cantidadTubos: 1 };
  }
}

// Para precargar el desplegable al editar un examen ya clasificado.
export function inferTuboBehavior(entry) {
  if ((entry.cantidadTubos || 1) > 1) return "doble";
  if (entry.grupo && entry.capacidadGrupo === 5) return "grupo5";
  if (entry.grupo && entry.capacidadGrupo === 2) return "grupo2";
  return "solo";
}

export function tuboBehaviorSelectHtml(selectClass, idx, selected) {
  return `<select class="text-input ${selectClass}" data-idx="${idx}">
    ${TUBO_BEHAVIOR_OPTIONS.map(opt => `<option value="${opt.value}"${selected === opt.value ? " selected" : ""}>${opt.label}</option>`).join("")}
  </select>`;
}

export function checkAndClassifyNewExams(deps, allPatients, onDone) {
  const { db, examScanFilter } = deps;
  (async () => {
    try {
      const scanPatients = examScanFilter ? allPatients.filter(examScanFilter) : allPatients;
      const uniqueExams = collectUniqueExams(scanPatients);
      const catalogo = await fetchExamCatalogo(db);

      const nuevos = [];
      const conflictos = [];
      uniqueExams.forEach(ex => {
        const r = findInCatalogo(catalogo, ex.codigo, ex.nombre);
        if (r.entry) return;
        if (r.conflict) conflictos.push({ ...ex, existentes: r.existentes });
        else nuevos.push(ex);
      });

      if (nuevos.length === 0 && conflictos.length === 0) { onDone(allPatients, 0); return; }

      openExamClasificarModal(deps, nuevos, conflictos, catalogo, allPatients, onDone);
    } catch (e) {
      console.warn("[exams.js] No se pudo revisar el catálogo, se importa igual:", e);
      onDone(allPatients, -1);
    }
  })();

  function openExamClasificarModal(deps, nuevos, conflictos, catalogo, allPatients, onDone) {
    const { db, me, escapeHtml, showToast } = deps;
    const modal = document.getElementById("examClasificarModal");
    const list = document.getElementById("examClasificarList");
    const skipBtn = document.getElementById("examClasificarSkipBtn");
    const continueBtn = document.getElementById("examClasificarContinueBtn");

    // omitido = "por ahora no lo clasifico" — no cuenta para poder
    // continuar, y no se guarda nada de él (se vuelve a preguntar la
    // próxima vez que aparezca).
    // Para conflictos: resolucion arranca en null ("mismo" | "diferente").
    const pending = [
      ...nuevos.map(n => ({ ...n, tipo: "nuevo", tubo: "", tuboBehavior: "solo", cubrirLuz: false, descripcion: "", omitido: false })),
      ...conflictos.map(c => ({ ...c, tipo: "conflicto", tubo: "", tuboBehavior: "solo", cubrirLuz: false, descripcion: "", omitido: false, resolucion: null })),
    ];

    function tubosPickerHtml(ex, i) {
      const tuboInfo = TUBOS_AUX.find(t => t.key === ex.tubo);
      const esNoTubo = tuboInfo && tuboInfo.esTubo === false;
      return `
        <div class="exam-clasificar-chips">
          ${TUBOS_AUX.map(tb => `
            <button type="button" class="tube-pick-chip${ex.tubo === tb.key ? " active" : ""}" data-idx="${i}" data-tube="${tb.key}" title="${tb.key}">
              <span class="emoji">${tb.emoji}</span><span>${tb.key.slice(0, 4)}</span>
            </button>
          `).join("")}
        </div>
        <div class="exam-clasificar-extra">
          <label class="exam-clasificar-extra-field exam-behavior-field" data-idx-behavior="${i}" style="${esNoTubo ? "display:none;" : ""}">
            ¿Cómo se toma este examen?
            ${tuboBehaviorSelectHtml("exam-tubo-behavior", i, ex.tuboBehavior)}
          </label>
          <label class="exam-clasificar-extra-field exam-clasificar-solo exam-luz-field" data-idx-luz="${i}" style="${esNoTubo ? "display:none;" : ""}">
            <input type="checkbox" class="cubrir-luz-check" data-idx="${i}" ${ex.cubrirLuz ? "checked" : ""}>
            🌑 Cubrir de la luz
          </label>
          <label class="exam-clasificar-extra-field">
            ¿Para qué sirve? (opcional)
            <input type="text" class="text-input exam-descripcion-input" data-idx="${i}" value="${ex.descripcion || ""}" placeholder="Ej: mide el azúcar en sangre">
          </label>
          <a class="ghost-btn exam-perplexity-link" href="${perplexityUrl(ex.codigo, ex.nombre)}" target="_blank" rel="noopener">🔮 Preguntar en Perplexity</a>
        </div>
        <button type="button" class="ghost-btn exam-clasificar-skip" data-idx="${i}" style="margin-top:6px;">⏭️ Omitir este examen</button>
      `;
    }

    function pintarLista() {
      list.innerHTML = pending.map((ex, i) => {
        if (ex.omitido) {
          return `<div class="exam-clasificar-item omitted" data-idx="${i}">
            <div class="exam-clasificar-name">${escapeHtml(ex.nombre)} ${ex.codigo ? `<span class="exam-clasificar-code">#${escapeHtml(ex.codigo)}</span>` : ""}</div>
            <p class="card-hint" style="margin:6px 0 0;">⏭️ Omitido por ahora</p>
          </div>`;
        }

        if (ex.tipo === "conflicto" && !ex.resolucion) {
          const existente = ex.existentes[0];
          return `<div class="exam-clasificar-item exam-clasificar-conflict" data-idx="${i}">
            <div class="exam-clasificar-name">
              ${escapeHtml(ex.nombre)} <span class="exam-clasificar-code">#${escapeHtml(ex.codigo)}</span>
            </div>
            <p class="exam-conflict-warning">⚠️ Este código ya existe para "<strong>${escapeHtml(existente.nombre)}</strong>" (${escapeHtml(existente.tubo || "sin tubo")}). ¿Es el mismo examen con otro nombre, o uno diferente que comparte el código?</p>
            <div class="exam-conflict-buttons">
              <button type="button" class="ghost-btn exam-conflict-mismo" data-idx="${i}">Es el mismo examen</button>
              <button type="button" class="btn btn-primary exam-conflict-diferente" data-idx="${i}" style="width:auto;">Es diferente</button>
            </div>
          </div>`;
        }

        return `<div class="exam-clasificar-item" data-idx="${i}">
          <div class="exam-clasificar-name">
            ${escapeHtml(ex.nombre)}
            ${ex.codigo ? `<span class="exam-clasificar-code">#${escapeHtml(ex.codigo)}${ex.tipo === "conflicto" ? " (aparte)" : ""}</span>` : ""}
          </div>
          ${tubosPickerHtml(ex, i)}
        </div>`;
      }).join("");

      list.querySelectorAll(".tube-pick-chip").forEach(chip => {
        chip.addEventListener("click", () => {
          const idx = parseInt(chip.dataset.idx, 10);
          pending[idx].tubo = chip.dataset.tube;
          const item = list.querySelector(`.exam-clasificar-item[data-idx="${idx}"]`);
          item.querySelectorAll(".tube-pick-chip").forEach(c => c.classList.toggle("active", c.dataset.tube === chip.dataset.tube));
          item.classList.add("done");

          const tuboInfo = TUBOS_AUX.find(t => t.key === chip.dataset.tube);
          const esNoTubo = tuboInfo && tuboInfo.esTubo === false;
          const behaviorField = list.querySelector(`.exam-behavior-field[data-idx-behavior="${idx}"]`);
          const luzField = list.querySelector(`.exam-luz-field[data-idx-luz="${idx}"]`);
          if (behaviorField) behaviorField.style.display = esNoTubo ? "none" : "";
          if (luzField) luzField.style.display = esNoTubo ? "none" : "";
          if (esNoTubo) { pending[idx].tuboBehavior = "solo"; pending[idx].cubrirLuz = false; }

          actualizarBotonContinuar();
        });
      });
      list.querySelectorAll(".exam-tubo-behavior").forEach(sel => {
        sel.addEventListener("change", () => {
          pending[parseInt(sel.dataset.idx, 10)].tuboBehavior = sel.value;
        });
      });
      list.querySelectorAll(".cubrir-luz-check").forEach(chk => {
        chk.addEventListener("change", () => {
          pending[parseInt(chk.dataset.idx, 10)].cubrirLuz = chk.checked;
        });
      });
      list.querySelectorAll(".exam-descripcion-input").forEach(inp => {
        inp.addEventListener("input", () => {
          pending[parseInt(inp.dataset.idx, 10)].descripcion = inp.value;
        });
      });
      list.querySelectorAll(".exam-clasificar-skip").forEach(btn => {
        btn.addEventListener("click", () => {
          pending[parseInt(btn.dataset.idx, 10)].omitido = true;
          pintarLista();
          actualizarBotonContinuar();
        });
      });
      list.querySelectorAll(".exam-conflict-mismo").forEach(btn => {
        btn.addEventListener("click", () => {
          pending[parseInt(btn.dataset.idx, 10)].resolucionMismo = true;
          pending[parseInt(btn.dataset.idx, 10)].omitido = true; // no se guarda nada nuevo, ya existe
          pintarLista();
          actualizarBotonContinuar();
        });
      });
      list.querySelectorAll(".exam-conflict-diferente").forEach(btn => {
        btn.addEventListener("click", () => {
          pending[parseInt(btn.dataset.idx, 10)].resolucion = "diferente";
          pintarLista();
          actualizarBotonContinuar();
        });
      });
    }

    function actualizarBotonContinuar() {
      continueBtn.disabled = pending.some(ex => {
        if (ex.omitido) return false;
        if (ex.tipo === "conflicto" && !ex.resolucion) return true; // falta decidir
        return !ex.tubo;
      });
    }

    pintarLista();
    actualizarBotonContinuar();
    modal.hidden = false;

    // Los botones se reasignan cada vez (onclick, no addEventListener) —
    // así no se van acumulando handlers viejos de imports anteriores.
    skipBtn.onclick = () => {
      modal.hidden = true;
      onDone(allPatients, nuevos.length + conflictos.length);
    };

    continueBtn.onclick = async () => {
      continueBtn.disabled = true;
      continueBtn.textContent = "Guardando...";
      let guardados = 0, fallidos = 0;
      for (const ex of pending) {
        if (ex.omitido || !ex.tubo) continue;
        const docId = ex.tipo === "conflicto"
          ? nextCodeVariant(catalogo, ex.codigo)
          : examDocId(ex.codigo, ex.nombre);
        const codigoFinal = ex.tipo === "conflicto" ? docId : ex.codigo;
        const campos = deriveTuboFields(ex.tubo, ex.tuboBehavior);
        const ok = await guardarClasificacionExamen(
          db, docId,
          { codigo: codigoFinal, nombre: ex.nombre, tubo: ex.tubo, ...campos, cubrirLuz: ex.cubrirLuz, descripcion: ex.descripcion },
          me ? me.name : ""
        );
        if (ok) guardados++; else fallidos++;
      }
      continueBtn.textContent = "Guardar y continuar";
      modal.hidden = true;
      if (showToast) {
        showToast(
          fallidos > 0
            ? `⚠️ Se guardaron ${guardados}, pero ${fallidos} no se pudieron guardar — revisa tu conexión`
            : `✅ ${guardados} examen${guardados !== 1 ? "es" : ""} clasificado${guardados !== 1 ? "s" : ""}`,
          fallidos > 0 ? 4000 : 2400
        );
      }
      onDone(allPatients, nuevos.length + conflictos.length);
    };
  }
}



// ---------------- Guía de exámenes (buscar/ver/corregir lo ya clasificado) ----------------
// Se inicializa una sola vez al cargar la página — solo trae el catálogo
// de Firestore la primera vez que se abre el desplegable, no antes.
export function initExamGuide(deps) {
  const { db, escapeHtml, showToast } = deps;

  const badge = document.getElementById("examGuideBadge");
  const search = document.getElementById("examGuideSearch");
  const list = document.getElementById("examGuideList");
  const editModal = document.getElementById("examGuideEditModal");
  const editClose = document.getElementById("examGuideEditClose");
  const editName = document.getElementById("examGuideEditName");
  const editChips = document.getElementById("examGuideEditChips");
  const examGuideEditBehavior = document.getElementById("examGuideEditBehavior");
  const examGuideEditDescripcion = document.getElementById("examGuideEditDescripcion");
  const examGuideEditPerplexity = document.getElementById("examGuideEditPerplexity");
  const examGuideEditLuz = document.getElementById("examGuideEditLuz");
  const examGuideEditSaveBtn = document.getElementById("examGuideEditSaveBtn");

  let catalogo = [];
  let loaded = false;

  async function loadIfNeeded() {
    if (loaded) return;
    loaded = true;
    list.innerHTML = '<p class="card-hint" style="margin:8px 0 0;">Cargando...</p>';
    catalogo = await getCatalogoCached(db);
    catalogo.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
    render();
  }

  function render() {
    const term = normStr(search.value);
    const filtered = term
      ? catalogo.filter(ex => normStr(ex.nombre).includes(term) || String(ex.codigo || "").includes(term))
      : catalogo;

    badge.textContent = catalogo.length;

    if (filtered.length === 0) {
      list.innerHTML = catalogo.length === 0
        ? '<p class="card-hint" style="margin:8px 0 0;">Todavía no hay exámenes clasificados — se van agregando solos con cada planilla que importes.</p>'
        : '<p class="card-hint" style="margin:8px 0 0;">Sin resultados para esa búsqueda.</p>';
      return;
    }

    list.innerHTML = filtered.map(ex => {
      const tb = TUBOS_AUX.find(t => t.key === ex.tubo);
      const quien = formatQuienCuando(ex);
      return `
        <div class="exam-guide-row">
          <div class="exam-guide-info">
            <span class="exam-guide-name">${escapeHtml(ex.nombre)}</span>
            ${ex.codigo ? `<span class="exam-guide-code">#${escapeHtml(ex.codigo)}</span>` : ""}
            ${ex.descripcion ? `<span class="exam-guide-desc">${escapeHtml(ex.descripcion)}</span>` : ""}
            ${quien ? `<span class="exam-guide-who">${escapeHtml(quien)}</span>` : ""}
          </div>
          <button type="button" class="exam-guide-tube-btn" data-id="${ex.id}">${tb ? `${tb.emoji} ${tb.key} · ${TUBO_BEHAVIOR_OPTIONS.find(o => o.value === inferTuboBehavior(ex))?.label || "va solo"}${ex.cubrirLuz ? " 🌑" : ""}` : "❓ Sin clasificar"}</button>
        </div>
      `;
    }).join("");

    list.querySelectorAll(".exam-guide-tube-btn").forEach(btn => {
      btn.addEventListener("click", () => openEditTube(btn.dataset.id));
    });
  }

  // "Iván · 23/09 6:15 p. m."
  function formatQuienCuando(ex) {
    let cuando = "";
    if (ex.actualizadoEn && typeof ex.actualizadoEn.toDate === "function") {
      const d = ex.actualizadoEn.toDate();
      const fecha = d.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit" });
      const hora = d.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
      cuando = `${fecha} ${hora}`;
    }
    if (ex.clasificadoPor && cuando) return `${ex.clasificadoPor} · ${cuando}`;
    return ex.clasificadoPor || cuando || "";
  }

  function openEditTube(id) {
    const ex = catalogo.find(e => e.id === id);
    if (!ex) return;
    openEditForEntry(ex, false, null);
  }

  // Para clasificar directamente un examen que todavía no está en el
  // catálogo (ej. tocando el chip ❓ en la tarjeta del paciente) — sin
  // tener que ir primero a buscarlo en la Guía.
  function openEditForExam(codigo, nombre, onClassified) {
    const id = examDocId(codigo, nombre);
    let ex = catalogo.find(e => e.id === id);
    const esNuevo = !ex;
    if (!ex) ex = { id, codigo: codigo || "", nombre, tubo: "", cantidadTubos: 1, grupo: "", capacidadGrupo: 0, cubrirLuz: false };
    openEditForEntry(ex, esNuevo, onClassified);
  }

  function openEditForEntry(ex, esNuevo, onClassified) {
    let tuboElegido = ex.tubo || "";
    let behaviorElegido = inferTuboBehavior(ex);

    editName.textContent = ex.nombre + (ex.codigo ? ` (#${ex.codigo})` : "");

    const examGuideEditBehaviorField = document.getElementById("examGuideEditBehaviorField");
    const examGuideEditLuzField = document.getElementById("examGuideEditLuzField");

    function actualizarVisibilidadNoTubo() {
      const tuboInfo = TUBOS_AUX.find(t => t.key === tuboElegido);
      const esNoTubo = tuboInfo && tuboInfo.esTubo === false;
      if (examGuideEditBehaviorField) examGuideEditBehaviorField.style.display = esNoTubo ? "none" : "";
      if (examGuideEditLuzField) examGuideEditLuzField.style.display = esNoTubo ? "none" : "";
      if (esNoTubo) { behaviorElegido = "solo"; examGuideEditLuz.checked = false; }
    }

    function pintarChipsTubo() {
      editChips.innerHTML = TUBOS_AUX.map(tb => `
        <button type="button" class="tube-pick-chip${tuboElegido === tb.key ? " active" : ""}" data-tube="${tb.key}" title="${tb.key}">
          <span class="emoji">${tb.emoji}</span><span>${tb.key.slice(0, 4)}</span>
        </button>
      `).join("");
      editChips.querySelectorAll(".tube-pick-chip").forEach(chip => {
        chip.addEventListener("click", () => {
          tuboElegido = chip.dataset.tube;
          pintarChipsTubo();
          actualizarVisibilidadNoTubo();
        });
      });
    }
    pintarChipsTubo();
    actualizarVisibilidadNoTubo();
    examGuideEditBehavior.innerHTML = TUBO_BEHAVIOR_OPTIONS.map(opt =>
      `<option value="${opt.value}"${behaviorElegido === opt.value ? " selected" : ""}>${opt.label}</option>`
    ).join("");
    examGuideEditBehavior.onchange = () => { behaviorElegido = examGuideEditBehavior.value; };
    examGuideEditLuz.checked = !!ex.cubrirLuz;
    examGuideEditDescripcion.value = ex.descripcion || "";
    examGuideEditPerplexity.href = perplexityUrl(ex.codigo, ex.nombre);

    examGuideEditSaveBtn.onclick = async () => {
      if (!tuboElegido) { showToast("Elige un tubo", 1800); return; }
      examGuideEditSaveBtn.disabled = true;
      examGuideEditSaveBtn.textContent = "Guardando...";
      const campos = deriveTuboFields(tuboElegido, behaviorElegido);
      const ok = await guardarClasificacionExamen(
        db, ex.id,
        { codigo: ex.codigo, nombre: ex.nombre, tubo: tuboElegido, ...campos, cubrirLuz: examGuideEditLuz.checked, descripcion: examGuideEditDescripcion.value },
        deps.me ? deps.me.name : ""
      );
      examGuideEditSaveBtn.disabled = false;
      examGuideEditSaveBtn.textContent = "Guardar cambios";
      if (ok) {
        ex.tubo = tuboElegido;
        ex.cantidadTubos = campos.cantidadTubos;
        ex.grupo = campos.grupo;
        ex.capacidadGrupo = campos.capacidadGrupo;
        ex.cubrirLuz = examGuideEditLuz.checked;
        ex.descripcion = examGuideEditDescripcion.value.trim();
        if (esNuevo) catalogo.push(ex);
        invalidateCatalogoCache();
        render();
        editModal.hidden = true;
        showToast("Clasificación actualizada", 1800);
        if (onClassified) onClassified();
      } else {
        showToast("No se pudo guardar — revisa tu conexión", 2400);
      }
    };

    editModal.hidden = false;
  }

  editClose.addEventListener("click", () => { editModal.hidden = true; });
  editModal.addEventListener("click", (e) => {
    if (e.target === editModal) editModal.hidden = true;
  });

  search.addEventListener("input", render);
  search.closest("details").addEventListener("toggle", (e) => {
    if (e.target.open) loadIfNeeded();
  });

  // Se llama después de clasificar exámenes nuevos durante un import,
  // para que la próxima vez que se abra la guía traiga los datos frescos.
  return {
    invalidate() { loaded = false; invalidateCatalogoCache(); },
    async refreshBadgeOnly() {
      const c = await getCatalogoCached(db);
      badge.textContent = c.length;
    },
    openEditForExam,
  };
}