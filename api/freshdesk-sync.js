// Función serverless de Vercel — sincroniza tiempos con Freshdesk.
// Calcada de la Edge Function de Supabase que ya usa RutaLab Pro
// (freshdesk-sync), solo que corre en Vercel para no depender de
// Supabase. Misma lógica, mismos campos, mismo formato de petición.
//
// Variables de entorno necesarias en Vercel (Settings → Environment
// Variables): FRESHDESK_API_KEY, FRESHDESK_DOMAIN (opcional, por
// defecto "emermedicaassist").

// "5:33" o "05:33" -> "5:33" (sin segundos, sin cero inicial)
function hm(t) {
  if (!t) return null;
  const m = String(t).match(/(\d{1,2}):(\d{2})/);
  return m ? `${parseInt(m[1], 10)}:${m[2]}` : null;
}
// "5:45" -> [5, 45]
function hmNums(t) {
  if (!t) return [null, null];
  const m = String(t).match(/(\d{1,2}):(\d{2})/);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [null, null];
}
// Valida formato YYYY-MM-DD
function fechaOk(f) {
  if (!f) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(f)) ? String(f) : null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const API_KEY = process.env.FRESHDESK_API_KEY;
  const DOMAIN = process.env.FRESHDESK_DOMAIN || "emermedicaassist";
  if (!API_KEY) {
    res.status(500).json({ error: "Falta FRESHDESK_API_KEY" });
    return;
  }

  const { solicitudes, tiempos } = req.body || {};
  if (!solicitudes || !solicitudes.length) {
    res.status(400).json({ error: "Sin solicitudes" });
    return;
  }

  // Construir custom_fields solo con lo que tenga valor
  const cf = {};
  const f = fechaOk(tiempos?.fecha);
  if (f) cf.cf_fecha_arribo = f;
  if (tiempos?.arriboSitio) cf.cf_hora_minuto_arribo = hm(tiempos.arriboSitio);
  if (tiempos?.arriboPac) cf.cf_hora_minuto_paciente = hm(tiempos.arriboPac);
  if (tiempos?.toma) {
    const [h, m] = hmNums(tiempos.toma);
    if (h !== null) { cf.cf_hora_toma_de_muestras = h; cf.cf_minuto_toma_de_muestras = m; }
  }
  if (tiempos?.salida) cf.cf_hora_salida_lab = hm(tiempos.salida);

  if (Object.keys(cf).length === 0) {
    res.status(200).json({ ok: false, error: "Sin datos que actualizar" });
    return;
  }

  const auth = "Basic " + Buffer.from(`${API_KEY}:X`).toString("base64");
  const resultados = [];

  for (const sol of solicitudes) {
    const id = String(sol).replace(/\D/g, "");
    if (!id) continue;
    const url = `https://${DOMAIN}.freshdesk.com/api/v2/tickets/${id}`;
    try {
      const r = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": auth },
        body: JSON.stringify({ custom_fields: cf }),
      });
      const ok = r.ok;
      const txt = ok ? "" : await r.text();
      resultados.push({ solicitud: id, ok, status: r.status, error: ok ? null : txt.slice(0, 250) });
    } catch (e) {
      resultados.push({ solicitud: id, ok: false, error: String(e).slice(0, 250) });
    }
  }

  const okCount = resultados.filter(r => r.ok).length;
  res.status(200).json({
    ok: okCount > 0, actualizados: okCount, total: resultados.length, campos: Object.keys(cf), resultados,
  });
}