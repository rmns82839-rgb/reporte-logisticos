// ============================================================
// people.js — directorio de personas autorizadas a usar el panel
// en tiempo real (logísticos y coordinadores), por número de celular.
//
// Para agregar, quitar o cambiar a alguien: edita solo este archivo,
// nada más necesita tocarse. "coordinador: true" le da acceso al
// panel de coordinador (/coordinador.html) además del tablero en vivo.
// ============================================================

export const PEOPLE = {
  "3133815071": { name: "Ferney",   coordinador: true  },
  "3208924013": { name: "Giovanni", coordinador: false },
  "3158551115": { name: "Javier",   coordinador: false },
  "3163543894": { name: "Miguel",   coordinador: true  },
  "3503345890": { name: "Nelson",   coordinador: false },
  "3003656973": { name: "Wilson",   coordinador: false },
  "3174384202": { name: "Magda",    coordinador: true  },
};

// Clave compartida que exige Firestore para crear una asignación (ver
// reglas de seguridad). Debe ser IDÉNTICA, letra por letra, al campo
// "coordCode" del documento config/access en Firestore.
export const COORD_ACCESS_CODE = "coordinacion2026";

export function normalizePhone(raw) {
  return String(raw || "").replace(/\D/g, "");
}

// Devuelve { phone, name, coordinador } si el número está autorizado,
// o null si no se reconoce.
export function lookupPerson(rawPhone) {
  const phone = normalizePhone(rawPhone);
  const entry = PEOPLE[phone];
  if (!entry) return null;
  return { phone, name: entry.name, coordinador: !!entry.coordinador };
}