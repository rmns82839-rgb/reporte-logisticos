// Pre / Post (dos tomas del mismo paciente, ej. glucosa pre y post carga).
// Módulo pequeño y sin dependencias del DOM: etiqueta cuál tarjeta es la
// PRE y cuál la POST, y calcula la ventana aproximada de la POST una vez
// se toma la PRE (2 h después, con margen de 15 min).
export const POST_DELAY_MIN = 120;
export const POST_WINDOW_MIN = 15;

export function esExamenDobleToma(examenes) {
  const texto = (examenes || []).join(" ").toUpperCase();
  return /PRE\s*Y?\s*POST|POST\s*[\s-]?\s*CARGA|POSCARGA|POS\s*PRANDIAL|POSPRANDIAL|2\s*TOMAS?\s*POST/.test(texto);
}

export function labelToMin(label) {
  const m = String(label || "").match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const per = m[3].toUpperCase();
  if (per === "PM" && h !== 12) h += 12;
  if (per === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

export function minToLabel(mins) {
  const t = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60), m = t % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// Etiqueta pre/post. Solo toca pacientes sin etiqueta, así es estable.
// Dentro de cada documento con examen de doble toma, la cita más temprana
// es la PRE y las siguientes son POST (enlazadas a la PRE).
export function ensurePrePostTags(patients) {
  const grupos = new Map();
  (patients || []).forEach(p => {
    const key = String(p.numDocumento || "").replace(/\D/g, "");
    if (!key) return;
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(p);
  });
  grupos.forEach(list => {
    if (list.length < 2 || !list.some(p => esExamenDobleToma(p.examenes))) return;
    if (list.every(p => p.tomaTipo)) return;
    const ordenados = list.slice().sort((a, b) => (labelToMin(a.horaCita) ?? 0) - (labelToMin(b.horaCita) ?? 0));
    const pre = ordenados[0];
    pre.tomaTipo = "pre";
    pre.parejaPostIds = ordenados.slice(1).map(x => x.id);
    ordenados.slice(1).forEach(post => {
      post.tomaTipo = "post";
      post.parejaPreId = pre.id;
    });
  });
}

export function postWindow(pre) {
  const t = labelToMin(pre && pre.horaToma);
  if (t === null) return null;
  const start = t + POST_DELAY_MIN;
  const end = start + POST_WINDOW_MIN;
  return { start, end, startLabel: minToLabel(start), endLabel: minToLabel(end) };
}

// Recalcula la hora estimada de cada POST a partir de la toma de su PRE.
// Se llama antes de guardar. Si la PRE aún no tiene toma, la POST vuelve a
// su hora original (solo si la hora la había puesto esta función).
export function syncPrePost(patients) {
  const byId = new Map((patients || []).map(p => [p.id, p]));
  (patients || []).forEach(p => {
    if (p.tomaTipo !== "post") return;
    const pre = byId.get(p.parejaPreId);
    if (!pre) return;
    const w = postWindow(pre);
    if (w) {
      p.postVentana = `${w.startLabel} – ${w.endLabel}`;
      if (!p.horaProgramada || p.horaProgramadaAuto) {
        p.horaProgramada = w.startLabel;
        p.horaProgramadaAuto = true;
      }
    } else {
      p.postVentana = "";
      if (p.horaProgramadaAuto) { p.horaProgramada = ""; p.horaProgramadaAuto = false; }
    }
  });
}

export function parejaDe(p, patients) {
  if (!p || !p.tomaTipo) return [];
  if (p.tomaTipo === "post") return (patients || []).filter(x => x.id === p.parejaPreId);
  return (patients || []).filter(x => (p.parejaPostIds || []).includes(x.id));
}

// Línea(s) para el reporte de WhatsApp. Vacío si no es pre/post.
export function prePostReportLines(p, patients, md = true) {
  if (!p || !p.tomaTipo) return [];
  const b = (t) => (md ? `*${t}*` : t);
  if (p.tomaTipo === "pre") {
    const w = postWindow(p);
    return [`🔬 ${b("Toma PRE")}${w ? ` — POST estimada: ${w.startLabel} a ${w.endLabel}` : " — POST pendiente de calcular"}`];
  }
  const pre = parejaDe(p, patients)[0];
  const lines = [`🔬 ${b("Toma POST")}${pre && pre.horaToma ? ` (PRE tomada ${pre.horaToma})` : ""}`];
  return lines;
}
