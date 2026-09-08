// ============================================================
// sync.js — puente entre la app (100% local) y Firebase.
// Si algo aquí falla (sin internet, Firebase caído, etc.) la app
// principal sigue funcionando exactamente igual, solo que ese
// logístico no se ve en el panel de coordinador hasta que vuelva
// la conexión. Nunca se pierde ni se bloquea nada local por esto.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, serverTimestamp,
  collection, query, where, onSnapshot, updateDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { lookupPerson } from "./people.js";

const firebaseConfig = {
  apiKey: "AIzaSyDjDVuIAWXxTJUrp406Rb7zrRGoQB4GHwg",
  authDomain: "reporte-logisticos.firebaseapp.com",
  projectId: "reporte-logisticos",
  storageBucket: "reporte-logisticos.firebasestorage.app",
  messagingSenderId: "382009731060",
  appId: "1:382009731060:web:b0cd599f69d98bdf1afba1",
};

let db = null;
let authReady = false;
let readyResolvers = [];

function whenReady() {
  return new Promise((resolve) => {
    if (authReady) resolve();
    else readyResolvers.push(resolve);
  });
}

try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  const auth = getAuth(app);

  signInAnonymously(auth).catch((e) => {
    console.warn("[sync.js] No se pudo iniciar sesión anónima (sin panel de coordinador por ahora):", e);
  });

  onAuthStateChanged(auth, (user) => {
    if (user) {
      authReady = true;
      readyResolvers.forEach((fn) => fn());
      readyResolvers = [];
    }
  });
} catch (e) {
  console.warn("[sync.js] Firebase no disponible, la app sigue 100% local.", e);
}

// ---------------- Identidad local: quién es este celular ----------------
// Ahora se identifica por número de celular contra la lista autorizada
// (people.js), no por nombre libre — así el mismo número siempre es la
// misma persona, sin importar si cambia de celular o reinstala la app.
const IDENTITY_KEY = "reporte_logisticos_identity_v2";

function getMyIdentity() {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// Intenta iniciar sesión con un número. Devuelve la persona
// { phone, name, coordinador } si el número está autorizado, o null si
// no se reconoce (en ese caso no se guarda nada, la app sigue local).
function loginWithPhone(rawPhone) {
  const person = lookupPerson(rawPhone);
  if (!person) return null;
  try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(person)); } catch (e) { /* sin storage, no pasa nada grave */ }
  return person;
}

function logout() {
  try { localStorage.removeItem(IDENTITY_KEY); } catch (e) {}
}

function slug(str) {
  return String(str)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase();
}

// Misma lógica de fecha local (no UTC) que usa el resto de la app,
// para que "hoy" signifique lo mismo en todos lados.
function localDateKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---------------- Envío de estado al panel de coordinador ----------------
// Se manda un resumen liviano (no todos los detalles de horas/tubos),
// con un pequeño "debounce" para no escribir en Firebase decenas de
// veces por segundo mientras alguien mantiene presionado un contador.
const debounceTimers = {};

function syncAux(auxKey, auxName, summary) {
  if (!db) return; // Firebase no disponible: seguimos en modo 100% local
  const me = getMyIdentity();
  if (!me) return; // todavía no inició sesión con un número reconocido

  const dateKey = localDateKey();
  const docId = `${dateKey}_${me.phone}_${slug(auxKey)}`;

  clearTimeout(debounceTimers[docId]);
  debounceTimers[docId] = setTimeout(async () => {
    try {
      await whenReady();
      const ref = doc(db, "dailyStatus", docId);
      await setDoc(ref, {
        date: dateKey,
        logisticoId: me.phone,
        logisticoName: me.name,
        auxKey,
        auxName,
        patientTotal: summary.patientTotal || 0,
        tubeTotal: summary.tubeTotal || 0,
        pickupsToday: summary.pickupsToday || 0,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      console.warn("[sync.js] No se pudo sincronizar con el panel de coordinador (sigue guardado local):", e);
    }
  }, 1500);
}

// ---------------- Asignaciones del coordinador ----------------
// El coordinador crea una asignación (logístico + auxiliar + dirección)
// desde /coordinador.html. Aquí el logístico la escucha en vivo para
// mostrarle el aviso dentro de la app normal.
let assignmentUnsub = null;

function listenMyAssignments(callback) {
  if (!db) return () => {};
  const me = getMyIdentity();
  if (!me) return () => {};

  if (assignmentUnsub) { assignmentUnsub(); assignmentUnsub = null; }

  const dateKey = localDateKey();
  const q = query(
    collection(db, "assignments"),
    where("date", "==", dateKey),
    where("logisticoPhone", "==", me.phone)
  );

  whenReady().then(() => {
    assignmentUnsub = onSnapshot(q, (snap) => {
      const docs = [];
      snap.forEach(docSnap => docs.push({ id: docSnap.id, ...docSnap.data() }));
      callback(docs);
    }, (e) => {
      console.warn("[sync.js] No se pudo escuchar asignaciones:", e);
    });
  });

  return () => { if (assignmentUnsub) { assignmentUnsub(); assignmentUnsub = null; } };
}

async function markAssignmentSeen(id) {
  if (!db) return;
  try {
    await whenReady();
    await updateDoc(doc(db, "assignments", id), { status: "vista", seenAt: serverTimestamp() });
  } catch (e) { /* si falla, no pasa nada — el coordinador solo no ve el cambio de estado */ }
}

async function markAssignmentDone(id) {
  if (!db) return;
  try {
    await whenReady();
    await updateDoc(doc(db, "assignments", id), { status: "hecha", doneAt: serverTimestamp() });
  } catch (e) { console.warn("[sync.js] No se pudo marcar la asignación como hecha:", e); }
}

window.ReporteSync = {
  getMyIdentity, loginWithPhone, logout, syncAux,
  listenMyAssignments, markAssignmentSeen, markAssignmentDone,
};