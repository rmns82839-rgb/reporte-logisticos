// papeleria.js — Checklist de papelería física por paciente (recibos,
// consentimientos, habeas data) y resumen del día. Reutiliza el
// contador de tubos de exams.js — ninguna lógica de tubos se repite
// aquí, solo se importa.
//
// Portado de la lógica real de RutaLab Pro:
//  - Consentimiento venopunción: solo si el paciente tiene algún examen
//    que NO sea orina/materia fecal (si todo es orina/heces, no hay
//    pinchazo de por medio)
//  - 🚨 Consentimiento VIH: solo FSFB + el texto de exámenes menciona "vih"
//  - Consentimiento paso de sonda: solo si el texto menciona "sonda"
//  - Recibo de caja: solo si el paciente paga (valor > 0)
//  - Rotulación de tubos: siempre
//  - Habeas Data: solo FSFB

import { computeTubeCounts, findInCatalogo, splitExamCodeName, TUBOS_AUX, renderExamChipsHtml } from "./exams.js";

const TUBOS_NO_SANGRE = ["Orina", "Orina 24h", "Materia fecal"];

function necesitaVenopuncion(catalogo, examenes) {
  if (!examenes || examenes.length === 0) return false;
  return examenes.some(examStr => {
    const { codigo, nombre } = splitExamCodeName(examStr);
    const r = findInCatalogo(catalogo, codigo, nombre);
    if (!r.entry) return true; // si no sabemos qué tubo es, mejor asumir que sí hay pinchazo
    return !TUBOS_NO_SANGRE.includes(r.entry.tubo);
  });
}

// Checklist de papelería física para UN paciente.
//   valor  = getValorFinal(p) ya calculado por quien llama esto
//   esFsfb = isFsfb(p) ya calculado por quien llama esto
export function checklistPaciente(catalogo, p, valor, esFsfb) {
  const texto = (p.examenes || []).join(" ").toLowerCase();
  // El VIH aplica para VIP y para FSFB por igual — antes solo se
  // pedía a FSFB.
  const tieneVih = /vih/.test(texto);
  const tieneSonda = /sonda/.test(texto) && !p.sondaRetirada;
  const veno = necesitaVenopuncion(catalogo, p.examenes);

  const items = [];
  if (veno) items.push({ key: "veno", label: "🩸 Consentimiento venopunción" });
  if (tieneVih) items.push({ key: "vih", label: "🚨 Consentimiento VIH" });
  if (tieneSonda) items.push({ key: "sonda", label: "🚽 Consentimiento paso de sonda" });
  if (esFsfb) {
    items.push({ key: "habeas", label: "📄 Habeas Data" });
    items.push({ key: "planilla", label: "📋 Planilla de entrega" });
  }
  if (valor > 0) items.push({ key: "recibo", label: "🧾 Recibo de caja / factura" });
  items.push({ key: "rotulacion", label: "🏷️ Rotulación de tubos" });
  return items;
}

// Resumen del día completo: recibos por compañía, cuántos consentimientos
// de cada tipo, y el total de tubos de cada color para TODOS los
// pacientes (sumando — cada paciente necesita los suyos propios, no se
// comparten entre pacientes distintos).
export function resumenDelDia(catalogo, patients, getValorFinal, isFsfb) {
  let recibosFsfb = 0, recibosVip = 0, venos = 0, sondas = 0, habeasFsfb = 0, planillasFsfb = 0;
  // El VIH aplica para VIP y para FSFB por igual, pero se cuentan aparte
  // para poder distinguir de cuál convenio es cada consentimiento.
  let vihsFsfb = 0, vihsVip = 0;
  const tubosPorColor = {};
  let totalTubosDia = 0;
  let totalCubrirLuzDia = 0;

  patients.forEach(p => {
    if (p.estado === "cancelado") return;
    const valor = getValorFinal(p);
    const esF = isFsfb(p);
    if (valor > 0) { if (esF) recibosFsfb++; else recibosVip++; }
    if (esF) { habeasFsfb++; planillasFsfb++; }

    const texto = (p.examenes || []).join(" ").toLowerCase();
    if (/sonda/.test(texto) && !p.sondaRetirada) sondas++;
    if (/vih/.test(texto)) { if (esF) vihsFsfb++; else vihsVip++; }
    if (necesitaVenopuncion(catalogo, p.examenes)) venos++;

    const conteo = computeTubeCounts(catalogo, p.examenes);
    conteo.tubos.forEach(t => {
      tubosPorColor[t.tubo] = (tubosPorColor[t.tubo] || 0) + t.cantidad;
    });
    totalTubosDia += conteo.totalTubos;
    totalCubrirLuzDia += conteo.totalCubrirLuz;
  });

  return { recibosFsfb, recibosVip, venos, sondas, vihsFsfb, vihsVip, habeasFsfb, planillasFsfb, tubosPorColor, totalTubosDia, totalCubrirLuzDia };
}

// Antes este resumen iba siempre visible y con position:sticky — al hacer
// scroll dentro de la lista de pacientes se quedaba pegado arriba y tapaba
// la información de los pacientes debajo. Ahora va en un <details> cerrado
// por defecto (no ocupa espacio hasta que se toca), sin sticky, pero
// conserva el fondo parallax de siempre. Los chips de recibos/
// consentimientos usan el mismo tamaño y el mismo armado (flex-wrap, sin
// scroll horizontal) que los chips de "Tubos del día" para que se vean
// iguales entre sí.
export function renderResumenDelDiaHtml(resumen) {
  const items = [
    ["Recibos FSFB", resumen.recibosFsfb, "var(--fsfb)"],
    ["Recibos VIP", resumen.recibosVip, "var(--vip)"],
    ["Venopunción", resumen.venos, "#10b981"],
    ["Sondas", resumen.sondas, "#f59e0b"],
  ];
  if (resumen.habeasFsfb > 0) items.push(["📄 Habeas Data FSFB", resumen.habeasFsfb, "var(--fsfb)"]);
  // VIH separado por convenio — antes salía un solo número mezclando VIP y
  // FSFB, ahora cada chip dice de cuál convenio es.
  if (resumen.vihsFsfb > 0) items.push(["🚨 VIH FSFB", resumen.vihsFsfb, "var(--fsfb)"]);
  if (resumen.vihsVip > 0) items.push(["🚨 VIH VIP", resumen.vihsVip, "var(--vip)"]);

  const pillsHtml = items.map(([label, n, color]) => `
    <span class="papeleria-tubo-chip"><strong style="color:${color};">${n}</strong> ${label}</span>
  `).join("");

  // Planilla de entrega: solo aplica si hay pacientes FSFB hoy — no tiene
  // una cantidad propia que valga la pena contar (es una por paciente,
  // igual a Habeas Data), así que se muestra como aviso de "sí aplica
  // hoy", sin número, en vez de un conteo.
  const planillaChipHtml = resumen.planillasFsfb > 0
    ? `<span class="papeleria-tubo-chip" style="color:var(--fsfb); font-weight:800;">📋 Planilla de entrega</span>`
    : "";

  const tubosEntries = Object.entries(resumen.tubosPorColor);
  const luzTxt = resumen.totalCubrirLuzDia > 0 ? ` · 🌑 ${resumen.totalCubrirLuzDia} cubierto${resumen.totalCubrirLuzDia !== 1 ? "s" : ""} de la luz` : "";
  const tubosHtml = tubosEntries.length > 0
    ? `<div class="papeleria-tubos-total">
        <span class="papeleria-tubos-label">🧪 Tubos del día — total ${resumen.totalTubosDia}${luzTxt}</span>
        <div class="papeleria-tubos-chips">
          ${tubosEntries.map(([tubo, n]) => {
            const tb = TUBOS_AUX.find(t => t.key === tubo);
            return `<span class="papeleria-tubo-chip">${tb ? tb.emoji : ""} ${n} ${tubo}</span>`;
          }).join("")}
        </div>
      </div>`
    : "";

  return `<details class="papeleria-resumen-details">
    <summary>📊 Recibos y consentimientos del día</summary>
    <div class="papeleria-parallax-wrap">
      <div id="papeleriaParallaxBg" class="papeleria-parallax-bg"></div>
      <div class="papeleria-parallax-content">
        <div class="papeleria-tubos-chips">${pillsHtml}${planillaChipHtml}</div>
        ${tubosHtml}
      </div>
    </div>
  </details>`;
}

// Efecto parallax sutil del fondo del resumen — se llama UNA vez al
// cargar la página. El fondo se mueve un poco más lento que el scroll,
// dando sensación de profundidad. Vuelve a buscar el elemento en cada
// scroll (se recrea cada vez que se repinta el resumen), así que no
// importa si el contenido cambia.
let parallaxInited = false;
export function initPapeleriaParallax() {
  if (parallaxInited) return;
  parallaxInited = true;
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const el = document.getElementById("papeleriaParallaxBg");
      if (el) {
        const rect = el.parentElement.getBoundingClientRect();
        el.style.transform = `translateY(${rect.top * 0.15}px)`;
      }
      ticking = false;
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  // El resumen ahora vive dentro de su propio contenedor con scroll
  // interno (.papeleria-scroll-wrap) — ese scroll no dispara el evento
  // en window, así que hay que escucharlo aparte (con capture, porque
  // el scroll no burbujea).
  document.addEventListener("scroll", (e) => {
    if (e.target.classList && e.target.classList.contains("papeleria-scroll-wrap")) onScroll();
  }, { passive: true, capture: true });
}

// "22323050" -> "22.323.050" (formato colombiano)
function formatCedula(numDoc) {
  const digits = String(numDoc || "").replace(/\D/g, "");
  if (!digits) return numDoc || "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Lista de chequeo por paciente, para el desplegable debajo del resumen.
// Orden: nombre, ficha (documento/dirección/compañía/solicitud), las
// recomendaciones de FSFB si las trae (esa columna en FSFB no es de
// exámenes reales, así que se muestran aparte, no como chip de examen),
// y por último el checklist de papelería.
export function renderChecklistListaHtml(catalogo, patients, getValorFinal, isFsfb, escapeHtml, getCompanyColor) {
  const activos = patients.filter(p => p.estado !== "cancelado");
  if (activos.length === 0) return '<p class="card-hint">Sin pacientes activos hoy.</p>';

  return activos.map((p, idx) => {
    const valor = getValorFinal(p);
    const esFsfb = isFsfb(p);
    const items = checklistPaciente(catalogo, p, valor, esFsfb);
    const coColor = getCompanyColor ? getCompanyColor(p) : (esFsfb ? "var(--fsfb)" : "var(--vip)");
    const listo = !!p.papeleriaListo;

    const recomendacionesHtml = (esFsfb && p.examenes && p.examenes.length > 0)
      ? `<div class="papeleria-reco">
          <span class="papeleria-reco-label">🚨 Recomendaciones FSFB</span>
          ${p.examenes.map(e => `<p class="papeleria-reco-item">${escapeHtml(e)}</p>`).join("")}
        </div>`
      : "";

    const conteo = computeTubeCounts(catalogo, p.examenes);
    const porColor = {};
    conteo.tubos.forEach(t => { porColor[t.tubo] = (porColor[t.tubo] || 0) + t.cantidad; });
    const tubosChipsPaciente = Object.entries(porColor).map(([tubo, n]) => {
      const tb = TUBOS_AUX.find(x => x.key === tubo);
      return `<span class="papeleria-tubo-chip">${tb ? tb.emoji : ""} ${n} ${escapeHtml(tubo)}</span>`;
    }).join("");
    const tubosHtml = conteo.totalTubos > 0
      ? `<div class="papeleria-tubos-paciente">
          <span class="papeleria-tubos-paciente-label">🧪 ${conteo.totalTubos} tubo${conteo.totalTubos !== 1 ? "s" : ""}</span>
          <div class="papeleria-tubos-chips">${tubosChipsPaciente}</div>
        </div>`
      : "";

    const pagoHtml = valor > 0
      ? `<p class="papeleria-pago">💳 Paga $${valor.toLocaleString("es-CO")}</p>`
      : `<p class="papeleria-pago papeleria-pago-no">Sin pago</p>`;

    // Para FSFB esa columna trae recomendaciones, no exámenes reales — ya
    // se muestra arriba como "Recomendaciones FSFB", no hay que repetirla.
    const examenesHtml = (!esFsfb && p.examenes && p.examenes.length > 0)
      ? `<div class="papeleria-examenes" data-pid="${p.id}">
          <span class="papeleria-examenes-label">🧪 Exámenes a tomar</span>
          <div class="exam-list">${renderExamChipsHtml(catalogo, p.examenes, escapeHtml)}</div>
        </div>`
      : "";

    return `
      <details class="papeleria-patient-row${listo ? " done" : ""}" style="border-left-color:${coColor};">
        <summary class="papeleria-patient-name">
          <span class="papeleria-patient-num">${idx + 1}</span>
          <span class="papeleria-patient-name-text">${escapeHtml(p.nombrePaciente || "(sin nombre)")}</span>
          <div class="papeleria-patient-side">
            <button type="button" class="papeleria-done-btn${listo ? " active" : ""}" data-pid="${p.id}" title="Marcar papelería lista">${listo ? "✅" : "⬜"}</button>
            <span class="papeleria-patient-pago-badge${valor > 0 ? " pago-si" : " pago-no"}">${valor > 0 ? "💳 Paga" : "Sin pago"}</span>
          </div>
        </summary>
        <div class="papeleria-info-grid">
          <div class="papeleria-info-row"><span>Documento</span><strong>${escapeHtml(p.tipoDocumento)} ${escapeHtml(formatCedula(p.numDocumento))}</strong></div>
          <div class="papeleria-info-row"><span>Dirección</span><strong>${escapeHtml(p.direccion || "—")}</strong></div>
          <div class="papeleria-info-row"><span>Compañía</span><strong style="color:${coColor};">${escapeHtml(p.tipoCliente || "—")}</strong></div>
        </div>
        <div class="papeleria-solicitud-chip" style="background:${coColor};">${escapeHtml(p.solicitud || "—")}</div>
        ${tubosHtml}
        ${pagoHtml}
        ${examenesHtml}
        ${recomendacionesHtml}
        <div class="papeleria-patient-items">${items.map(it => `<span class="papeleria-chip">${escapeHtml(it.label)}</span>`).join("")}</div>
        ${examenesHtml ? `<div class="papeleria-pago-bottom">${pagoHtml}</div>` : ""}
        <button type="button" class="ghost-btn papeleria-collapse-btn">▲ Colapsar</button>
      </details>
    `;
  }).join("");
}