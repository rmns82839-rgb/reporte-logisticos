// ============================================================
// chat.js — Directorio con foto de perfil + chat 1-a-1 y grupal entre
// auxiliares de laboratorio y logísticos.
//
// FASE 1 (lo que hay acá): foto de perfil (la sube cada quien), directorio
// de personas, chat 1-a-1 con cualquiera, un chat grupal fijo ("Grupo
// general"), texto, fotos, notas de voz (mantener presionado el 🎤),
// emojis, eliminar tu propio mensaje, y notificaciones DENTRO de la app
// (nube + sonido) para mensajes nuevos, aunque el chat esté cerrado — no
// push del celular (eso pide permiso del sistema operativo y es aparte).
//
// FASE 2 (pendiente, se agrega después si se pide): @menciones con
// autocompletar, responder citando un mensaje de arriba.
//
// Requiere reglas de seguridad para las colecciones "profiles" y "chats"
// en Firestore (ver el mensaje aparte con las reglas exactas). Las fotos
// (de perfil y de chat) NO se guardan en Firebase Storage — se suben a
// Cloudinary (cuenta gratis, sin tarjeta) usando un "unsigned upload
// preset". Hay que configurar CLOUDINARY_CLOUD_NAME y
// CLOUDINARY_UPLOAD_PRESET más abajo con los datos de tu cuenta.
//
// Se usa igual desde auxiliar.html y desde index.html:
//   import { initChatSystem } from "./chat.js";
//   initChatSystem({ app, db, me: {phone, name}, role: "auxiliar"|"logistico", showToast });
// ============================================================

import {
  doc, setDoc, getDoc, addDoc, collection, query, orderBy, limit,
  onSnapshot, serverTimestamp, updateDoc, arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { PEOPLE, AUXILIARES_LAB } from "./people.js";

const AVATAR_COLORS = ["#4A8DFB", "#F1453B", "#FFB020", "#1FD290", "#C58CF0", "#3FAFA6", "#F0C33C", "#E29A3E", "#8C9BFF"];
function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < String(name || "").length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
function initials(name) { return String(name || "?").slice(0, 2).toUpperCase(); }
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const EMOJIS = [
  "😀", "😂", "😅", "😉", "😍", "🥰", "😘", "😎", "🤔", "😴",
  "😭", "😡", "🙏", "👍", "👎", "👏", "🙌", "💪", "🔥", "✅",
  "❌", "⚠️", "⏰", "📍", "🚗", "🏍️", "🏠", "☕", "💧", "🩸",
  "🧪", "💉", "📋", "📦", "💵", "💳", "🎉", "❤️", "😊", "🤝",
];

const GROUP_CHAT_ID = "grupo-general";
function dmChatId(phoneA, phoneB) {
  return "dm_" + [phoneA, phoneB].sort().join("_");
}

// ---- Subida de fotos a Cloudinary (reemplaza Firebase Storage, que ahora
// exige plan de pago). Datos de tu cuenta gratis en cloudinary.com — ver
// instrucciones para crear el "unsigned upload preset". ----
const CLOUDINARY_CLOUD_NAME = "dmiuwqsyh";
const CLOUDINARY_UPLOAD_PRESET = "reporte_logisticos";

async function uploadToCloudinary(blob, folder) {
  const form = new FormData();
  form.append("file", blob);
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  form.append("folder", folder);
  const resp = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: "POST",
    body: form,
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Cloudinary respondió ${resp.status}: ${errText}`);
  }
  const data = await resp.json();
  return data.secure_url;
}

// El audio (notas de voz) en Cloudinary se sube por el endpoint "video"
// (así maneja Cloudinary los archivos de solo-audio, no hay un endpoint
// separado para audio puro).
async function uploadToCloudinaryAudio(blob, folder) {
  const form = new FormData();
  form.append("file", blob);
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  form.append("folder", folder);
  const resp = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`, {
    method: "POST",
    body: form,
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Cloudinary respondió ${resp.status}: ${errText}`);
  }
  const data = await resp.json();
  return data.secure_url;
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

// ---- Sonido de notificación (dos tonitos sintetizados, sin archivo de
// audio que descargar) — los navegadores bloquean el audio hasta que hay
// al menos un toque del usuario en la página, así que se "desbloquea" el
// AudioContext apenas toca lo que sea, y se reusa después. ----
let audioCtx = null;
function unlockAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  }
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
}
document.addEventListener("click", unlockAudio, { once: true, capture: true });
document.addEventListener("touchstart", unlockAudio, { once: true, capture: true });

function playNotificationSound() {
  try {
    unlockAudio();
    if (!audioCtx || audioCtx.state !== "running") return;
    const t0 = audioCtx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = t0 + i * 0.12;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.28);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  } catch (e) { /* si el navegador bloquea el audio, no pasa nada grave */ }
}

// Reduce el tamaño de una foto antes de subirla — para que no se demore
// una eternidad en 4G y no se coma el plan de datos de nadie.
function resizeImageFile(file, maxDim = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No se pudo procesar la imagen"))), "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No se pudo leer la imagen")); };
    img.src = url;
  });
}

export function initChatSystem(deps) {
  const { app, db, me, role, showToast } = deps;
  if (!me || !me.phone) return null;

  const notify = (msg) => { if (showToast) showToast(msg); else console.log(msg); };

  // ---- Directorio: todos los logísticos + auxiliares, menos yo ----
  const directorio = [];
  Object.entries(PEOPLE).forEach(([phone, p]) => {
    if (phone !== me.phone) directorio.push({ phone, name: p.name, role: "logistico" });
  });
  Object.entries(AUXILIARES_LAB).forEach(([phone, p]) => {
    if (phone !== me.phone) directorio.push({ phone, name: p.name, role: "auxiliar" });
  });
  directorio.sort((a, b) => a.name.localeCompare(b.name));

  // ---- Elementos del DOM (deben existir ya en la página) ----
  const chatBtn = document.getElementById("chatBtn");
  const chatModal = document.getElementById("chatModal");
  const chatModalClose = document.getElementById("chatModalClose");
  const chatDirectoryView = document.getElementById("chatDirectoryView");
  const chatDirectoryList = document.getElementById("chatDirectoryList");
  const chatThreadView = document.getElementById("chatThreadView");
  const chatThreadBack = document.getElementById("chatThreadBack");
  const chatThreadAvatar = document.getElementById("chatThreadAvatar");
  const chatThreadName = document.getElementById("chatThreadName");
  const chatMessages = document.getElementById("chatMessages");
  const chatTextInput = document.getElementById("chatTextInput");
  const chatSendBtn = document.getElementById("chatSendBtn");
  const chatEmojiBtn = document.getElementById("chatEmojiBtn");
  const chatEmojiPanel = document.getElementById("chatEmojiPanel");
  const chatPhotoBtn = document.getElementById("chatPhotoBtn");
  const chatPhotoInput = document.getElementById("chatPhotoInput");
  const chatVoiceBtn = document.getElementById("chatVoiceBtn");
  const chatVoiceTimer = document.getElementById("chatVoiceTimer");
  const chatMsgActionSheet = document.getElementById("chatMsgActionSheet");
  const chatMsgActionHide = document.getElementById("chatMsgActionHide");
  const chatMsgActionDelete = document.getElementById("chatMsgActionDelete");
  const chatMsgActionCancel = document.getElementById("chatMsgActionCancel");

  const profileModal = document.getElementById("profileModal");
  const profileModalClose = document.getElementById("profileModalClose");
  const profilePhotoPreview = document.getElementById("profilePhotoPreview");
  const profilePhotoInput = document.getElementById("profilePhotoInput");
  const profilePhotoBtn = document.getElementById("profilePhotoBtn");
  const profileName = document.getElementById("profileName");

  if (!chatBtn || !chatModal) return null; // esta página no tiene el chat montado

  if (chatEmojiPanel) {
    chatEmojiPanel.innerHTML = EMOJIS.map((e) => `<button type="button" class="chat-emoji-item">${e}</button>`).join("");
  }

  let unsubMessages = null;
  let currentChatId = null;
  let currentChatName = null;

  // Puntico rojo sobre el botón 💬 mientras haya algún chat con mensajes
  // sin leer — además de la nube flotante, que solo dura unos segundos en
  // pantalla y se puede pasar por alto.
  const unreadChats = new Set();
  function actualizarBadgeChat() {
    if (chatBtn) chatBtn.classList.toggle("has-unread", unreadChats.size > 0);
  }

  function avatarHtml(photoURL, name) {
    if (photoURL) return `<img src="${escapeHtml(photoURL)}" alt="" class="chat-avatar-img">`;
    return `<span class="chat-avatar-fallback" style="background:${avatarColor(name)};">${escapeHtml(initials(name))}</span>`;
  }

  // ---- Mi foto de perfil ----
  async function getMyProfile() {
    try {
      const snap = await getDoc(doc(db, "profiles", me.phone));
      return snap.exists() ? snap.data() : null;
    } catch (e) {
      console.warn("[chat.js] No se pudo leer el perfil:", e);
      return null;
    }
  }

  async function refreshMyAvatarBadge() {
    const perfil = await getMyProfile();
    const avatarEl = document.getElementById("welcomeAvatar");
    if (avatarEl) avatarEl.innerHTML = avatarHtml(perfil?.photoURL, me.name);
    if (profilePhotoPreview) profilePhotoPreview.innerHTML = avatarHtml(perfil?.photoURL, me.name);
    if (profileName) profileName.textContent = me.name;
  }
  refreshMyAvatarBadge();

  const welcomeAvatarEl = document.getElementById("welcomeAvatar");
  if (welcomeAvatarEl && profileModal) {
    welcomeAvatarEl.style.cursor = "pointer";
    welcomeAvatarEl.title = "Tocar para cambiar tu foto de perfil";
    welcomeAvatarEl.addEventListener("click", () => { profileModal.hidden = false; });
  }
  if (profileModalClose) profileModalClose.addEventListener("click", () => { profileModal.hidden = true; });
  if (profilePhotoBtn && profilePhotoInput) {
    profilePhotoBtn.addEventListener("click", () => profilePhotoInput.click());
    profilePhotoInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        notify("📤 Subiendo foto...");
        const blob = await resizeImageFile(file, 512, 0.85);
        const url = await uploadToCloudinary(blob, "profile-photos");
        await setDoc(doc(db, "profiles", me.phone), {
          name: me.name, role, photoURL: url, updatedAt: serverTimestamp(),
        }, { merge: true });
        await refreshMyAvatarBadge();
        notify("✅ Foto de perfil actualizada");
      } catch (err) {
        console.error("[chat.js] Error subiendo foto de perfil:", err);
        notify("⚠️ No se pudo subir la foto. Revisa tu conexión.");
      }
    });
  }

  // ---- Directorio ----
  async function renderDirectory() {
    if (!chatDirectoryList) return;
    chatDirectoryList.innerHTML = '<p class="card-hint" style="margin:8px 0 0;">Cargando...</p>';

    const filas = await Promise.all(directorio.map(async (p) => {
      let photoURL = null;
      try {
        const snap = await getDoc(doc(db, "profiles", p.phone));
        if (snap.exists()) photoURL = snap.data().photoURL || null;
      } catch (e) { /* si falla, se muestra con iniciales, no es grave */ }
      return { ...p, photoURL };
    }));

    const grupoRow = `
      <button type="button" class="chat-directory-row" data-chat="group">
        <span class="chat-avatar-fallback chat-avatar-group">👥</span>
        <span class="chat-directory-info">
          <span class="chat-directory-name">Grupo general</span>
          <span class="chat-directory-sub">Todos los auxiliares y logísticos</span>
        </span>
      </button>`;

    const personRows = filas.map((p) => `
      <button type="button" class="chat-directory-row" data-chat="dm" data-phone="${p.phone}" data-name="${escapeHtml(p.name)}" data-photo="${escapeHtml(p.photoURL || "")}">
        ${avatarHtml(p.photoURL, p.name)}
        <span class="chat-directory-info">
          <span class="chat-directory-name">${escapeHtml(p.name)}</span>
          <span class="chat-directory-sub">${p.role === "auxiliar" ? "🧪 Auxiliar de laboratorio" : "🏍️ Logístico"}</span>
        </span>
      </button>`).join("");

    chatDirectoryList.innerHTML = grupoRow + personRows;

    chatDirectoryList.querySelectorAll(".chat-directory-row").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.chat === "group") openThread(GROUP_CHAT_ID, "Grupo general", true);
        else openThread(dmChatId(me.phone, btn.dataset.phone), btn.dataset.name, false, btn.dataset.photo);
      });
    });
  }

  // ---- Hilo de chat ----
  async function ensureChatDoc(chatId, isGroup) {
    const ref_ = doc(db, "chats", chatId);
    const snap = await getDoc(ref_);
    if (!snap.exists()) {
      await setDoc(ref_, {
        type: isGroup ? "group" : "dm",
        createdAt: serverTimestamp(),
        lastMessageText: "",
        lastMessageAt: serverTimestamp(),
        lastMessageFrom: "",
      });
    }
  }

  function renderMessages(docs) {
    if (!chatMessages) return;
    const cercaDelFinal = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 80;

    // Ya no hay botones de 🗑️/🙈 sueltos en cada mensaje (se podían tocar
    // sin querer al hacer scroll). Ahora se mantiene presionado el mensaje
    // (como WhatsApp) y aparece un menú con "Ocultar solo para mí"
    // (cualquier mensaje, mío o del otro, borrado o no) y, si es mío y
    // todavía no está borrado, "Eliminar para todos".
    chatMessages.innerHTML = docs.map((m) => {
      const mio = m.from === me.phone;
      if (m.deleted) {
        return `<div class="chat-bubble-row ${mio ? "mine" : "theirs"}" data-id="${m.id}" data-mio="${mio ? "1" : "0"}" data-deleted="1">
          <div class="chat-bubble chat-bubble-deleted">
            ${mio ? "" : `<span class="chat-bubble-from">${escapeHtml(m.fromName)}</span>`}
            <em>🚫 Se eliminó este mensaje</em>
          </div>
        </div>`;
      }
      const cuerpo = m.type === "image"
        ? `<img src="${escapeHtml(m.imageURL)}" alt="" class="chat-bubble-img" data-full="${escapeHtml(m.imageURL)}">`
        : m.type === "audio"
          ? `<div class="chat-voice-msg" data-src="${escapeHtml(m.audioURL)}">
              <button type="button" class="chat-voice-play" aria-label="Reproducir">▶</button>
              <div class="chat-voice-bar"><div class="chat-voice-bar-fill"></div></div>
              <span class="chat-voice-time">${m.audioDuration ? formatDuration(m.audioDuration) : "0:00"}</span>
              <audio preload="none" src="${escapeHtml(m.audioURL)}"></audio>
            </div>`
          : `<span class="chat-bubble-text">${escapeHtml(m.text)}</span>`;
      const hora = m.createdAt && typeof m.createdAt.toDate === "function"
        ? m.createdAt.toDate().toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" })
        : "";
      return `<div class="chat-bubble-row ${mio ? "mine" : "theirs"}" data-id="${m.id}" data-mio="${mio ? "1" : "0"}" data-deleted="0">
        <div class="chat-bubble">
          ${mio ? "" : `<span class="chat-bubble-from">${escapeHtml(m.fromName)}</span>`}
          ${cuerpo}
          <span class="chat-bubble-time">${hora}</span>
        </div>
      </div>`;
    }).join("");

    chatMessages.querySelectorAll(".chat-bubble-img").forEach((img) => {
      img.addEventListener("click", () => window.open(img.dataset.full, "_blank"));
    });
    chatMessages.querySelectorAll(".chat-bubble-row").forEach((row) => {
      let timer = null;
      let movio = false;
      const empezar = () => {
        movio = false;
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!movio) mostrarAccionesMensaje(row.dataset.id, row.dataset.mio === "1", row.dataset.deleted === "1");
        }, 500);
      };
      const cancelar = () => { clearTimeout(timer); };
      row.addEventListener("pointerdown", empezar);
      row.addEventListener("pointerup", cancelar);
      row.addEventListener("pointerleave", cancelar);
      row.addEventListener("pointercancel", cancelar);
      row.addEventListener("pointermove", () => { movio = true; clearTimeout(timer); });
      row.addEventListener("contextmenu", (e) => e.preventDefault());
    });
    chatMessages.querySelectorAll(".chat-voice-msg").forEach((wrap) => {
      const audio = wrap.querySelector("audio");
      const playBtn = wrap.querySelector(".chat-voice-play");
      const bar = wrap.querySelector(".chat-voice-bar");
      const fill = wrap.querySelector(".chat-voice-bar-fill");
      const timeEl = wrap.querySelector(".chat-voice-time");
      playBtn.addEventListener("click", () => {
        if (audio.paused) {
          chatMessages.querySelectorAll("audio").forEach((a) => { if (a !== audio) { a.pause(); a.currentTime = 0; } });
          chatMessages.querySelectorAll(".chat-voice-play").forEach((b) => { if (b !== playBtn) b.textContent = "▶"; });
          audio.play().catch(() => notify("⚠️ No se pudo reproducir la nota de voz"));
        } else {
          audio.pause();
        }
      });
      audio.addEventListener("play", () => { playBtn.textContent = "⏸"; });
      audio.addEventListener("pause", () => { playBtn.textContent = "▶"; });
      audio.addEventListener("ended", () => { playBtn.textContent = "▶"; fill.style.width = "0%"; });
      audio.addEventListener("timeupdate", () => {
        if (audio.duration) {
          fill.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
          timeEl.textContent = formatDuration(audio.currentTime * 1000);
        }
      });
      audio.addEventListener("loadedmetadata", () => {
        if (isFinite(audio.duration) && !audio.currentTime) timeEl.textContent = formatDuration(audio.duration * 1000);
      });
      bar.addEventListener("click", (e) => {
        if (!audio.duration) return;
        const rect = bar.getBoundingClientRect();
        const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        audio.currentTime = pct * audio.duration;
      });
    });

    if (cercaDelFinal) chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // ---- Menú de acciones al mantener presionado un mensaje ----
  let accionMsgId = null;
  function mostrarAccionesMensaje(messageId, mio, deleted) {
    accionMsgId = messageId;
    if (chatMsgActionDelete) chatMsgActionDelete.hidden = !(mio && !deleted);
    if (chatMsgActionSheet) chatMsgActionSheet.hidden = false;
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
  }
  function cerrarAccionesMensaje() {
    if (chatMsgActionSheet) chatMsgActionSheet.hidden = true;
    accionMsgId = null;
  }
  if (chatMsgActionSheet) {
    chatMsgActionSheet.addEventListener("click", (e) => { if (e.target === chatMsgActionSheet) cerrarAccionesMensaje(); });
  }
  if (chatMsgActionCancel) chatMsgActionCancel.addEventListener("click", cerrarAccionesMensaje);
  if (chatMsgActionHide) chatMsgActionHide.addEventListener("click", () => {
    const id = accionMsgId;
    cerrarAccionesMensaje();
    if (id) ocultarParaMi(id);
  });
  if (chatMsgActionDelete) chatMsgActionDelete.addEventListener("click", () => {
    const id = accionMsgId;
    cerrarAccionesMensaje();
    if (id) eliminarMensaje(id);
  });

  async function ocultarParaMi(messageId) {
    if (!currentChatId) return;
    try {
      await updateDoc(doc(db, "chats", currentChatId, "messages", messageId), {
        hiddenFor: arrayUnion(me.phone),
      });
    } catch (e) {
      console.error("[chat.js] No se pudo ocultar el mensaje:", e);
      notify("⚠️ No se pudo ocultar el mensaje");
    }
  }

  async function eliminarMensaje(messageId) {
    if (!currentChatId) return;
    if (!confirm("¿Eliminar este mensaje para todos?")) return;
    try {
      await updateDoc(doc(db, "chats", currentChatId, "messages", messageId), {
        deleted: true, text: "", imageURL: null,
      });
    } catch (e) {
      console.error("[chat.js] No se pudo eliminar el mensaje:", e);
      notify("⚠️ No se pudo eliminar el mensaje");
    }
  }

  async function openThread(chatId, name, isGroup, photoURL) {
    currentChatId = chatId;
    currentChatName = name;
    if (chatThreadName) chatThreadName.textContent = name;
    if (chatThreadAvatar) {
      chatThreadAvatar.innerHTML = isGroup
        ? '<span class="chat-avatar-fallback chat-avatar-group">👥</span>'
        : avatarHtml(photoURL, name);
    }
    if (chatDirectoryView) chatDirectoryView.hidden = true;
    if (chatThreadView) chatThreadView.hidden = false;
    if (chatMessages) chatMessages.innerHTML = '<p class="card-hint" style="margin:8px 0;">Cargando mensajes...</p>';
    if (chatEmojiPanel) chatEmojiPanel.hidden = true;

    try {
      await ensureChatDoc(chatId, isGroup);
    } catch (e) {
      console.error("[chat.js] No se pudo abrir el chat:", e);
      notify("⚠️ No se pudo abrir el chat — revisa tu conexión");
      return;
    }

    if (unsubMessages) unsubMessages();
    const q = query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "desc"), limit(200));
    unsubMessages = onSnapshot(q, (snap) => {
      const docs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((m) => !(Array.isArray(m.hiddenFor) && m.hiddenFor.includes(me.phone)))
        .reverse();
      renderMessages(docs);
    }, (err) => {
      console.error("[chat.js] Error escuchando mensajes:", err);
    });

    // Se guarda en Firestore (no en el celular) hasta qué momento ya viste
    // este chat — así funciona aunque cambies de celular, reinstales la
    // app, o el navegador recargue la página en segundo plano.
    try {
      await updateDoc(doc(db, "chats", chatId), { [`lastReadBy.${me.phone}`]: serverTimestamp() });
    } catch (e) { /* no es crítico */ }
  }

  function closeThread() {
    if (unsubMessages) { unsubMessages(); unsubMessages = null; }
    currentChatId = null;
    if (chatThreadView) chatThreadView.hidden = true;
    if (chatDirectoryView) chatDirectoryView.hidden = false;
  }

  async function enviarTexto() {
    const texto = (chatTextInput?.value || "").trim();
    if (!texto || !currentChatId) return;
    chatTextInput.value = "";
    try {
      await addDoc(collection(db, "chats", currentChatId, "messages"), {
        from: me.phone, fromName: me.name, type: "text", text: texto,
        createdAt: serverTimestamp(), deleted: false,
      });
      await updateDoc(doc(db, "chats", currentChatId), {
        lastMessageText: texto, lastMessageAt: serverTimestamp(), lastMessageFrom: me.phone,
      });
    } catch (e) {
      console.error("[chat.js] No se pudo enviar el mensaje:", e);
      notify("⚠️ No se pudo enviar — revisa tu conexión");
      chatTextInput.value = texto; // se lo devuelve para que no se pierda lo escrito
    }
  }

  async function enviarFoto(file) {
    if (!currentChatId) return;
    try {
      notify("📤 Enviando foto...");
      const blob = await resizeImageFile(file, 1280, 0.8);
      const url = await uploadToCloudinary(blob, `chat-media/${currentChatId}`);
      await addDoc(collection(db, "chats", currentChatId, "messages"), {
        from: me.phone, fromName: me.name, type: "image", imageURL: url,
        createdAt: serverTimestamp(), deleted: false,
      });
      await updateDoc(doc(db, "chats", currentChatId), {
        lastMessageText: "📷 Foto", lastMessageAt: serverTimestamp(), lastMessageFrom: me.phone,
      });
    } catch (e) {
      console.error("[chat.js] No se pudo enviar la foto:", e);
      notify("⚠️ No se pudo enviar la foto — revisa tu conexión");
    }
  }

  async function enviarAudio(blob, duracionMs) {
    if (!currentChatId) return;
    try {
      notify("📤 Enviando nota de voz...");
      const url = await uploadToCloudinaryAudio(blob, `chat-media/${currentChatId}`);
      await addDoc(collection(db, "chats", currentChatId, "messages"), {
        from: me.phone, fromName: me.name, type: "audio", audioURL: url, audioDuration: duracionMs,
        createdAt: serverTimestamp(), deleted: false,
      });
      await updateDoc(doc(db, "chats", currentChatId), {
        lastMessageText: "🎤 Nota de voz", lastMessageAt: serverTimestamp(), lastMessageFrom: me.phone,
      });
    } catch (e) {
      console.error("[chat.js] No se pudo enviar la nota de voz:", e);
      notify("⚠️ No se pudo enviar la nota de voz — revisa tu conexión");
    }
  }

  // ---- Notas de voz: mantener presionado el botón 🎤 para grabar, soltar
  // para enviar. Usa Pointer Events para que funcione igual con dedo
  // (celular) y con mouse (computador). ----
  let mediaRecorder = null;
  let audioChunks = [];
  let recStartTime = 0;
  let recTimerInterval = null;
  let grabando = false;

  function detenerGrabacion(enviar) {
    if (!mediaRecorder || mediaRecorder.state !== "recording") return;
    mediaRecorder._enviarAlParar = enviar;
    mediaRecorder.stop();
  }

  async function iniciarGrabacion() {
    if (!currentChatId || grabando) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      notify("⚠️ Este navegador no permite grabar audio");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      grabando = true;
      audioChunks = [];
      const tipoSoportado = ["audio/webm", "audio/mp4", "audio/ogg"].find(
        (t) => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)
      );
      mediaRecorder = tipoSoportado ? new MediaRecorder(stream, { mimeType: tipoSoportado }) : new MediaRecorder(stream);
      recStartTime = Date.now();
      mediaRecorder.addEventListener("dataavailable", (e) => { if (e.data.size > 0) audioChunks.push(e.data); });
      mediaRecorder.addEventListener("stop", () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(recTimerInterval);
        grabando = false;
        if (chatVoiceBtn) chatVoiceBtn.classList.remove("recording");
        if (chatVoiceTimer) chatVoiceTimer.hidden = true;
        const duracion = Date.now() - recStartTime;
        const enviar = mediaRecorder._enviarAlParar !== false;
        const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        mediaRecorder = null;
        if (!enviar) return; // se canceló (deslizó el dedo fuera del botón, etc.)
        if (duracion < 800) { notify("⚠️ Nota de voz muy corta"); return; }
        enviarAudio(blob, duracion);
      });
      mediaRecorder.start();
      if (chatVoiceBtn) chatVoiceBtn.classList.add("recording");
      if (chatVoiceTimer) { chatVoiceTimer.hidden = false; chatVoiceTimer.textContent = "0:00"; }
      recTimerInterval = setInterval(() => {
        if (chatVoiceTimer) chatVoiceTimer.textContent = formatDuration(Date.now() - recStartTime);
      }, 250);
    } catch (e) {
      console.error("[chat.js] No se pudo grabar audio:", e);
      notify("⚠️ No se pudo acceder al micrófono. Revisa los permisos.");
    }
  }

  // ---- Notificaciones en vivo (nube + sonido) para cualquier mensaje
  // nuevo, aunque el chat de esa persona esté cerrado ----
  function notifyContainer() {
    let cont = document.getElementById("chatNotifyContainer");
    if (!cont) {
      cont = document.createElement("div");
      cont.id = "chatNotifyContainer";
      cont.className = "chat-notify-container";
      document.body.appendChild(cont);
    }
    return cont;
  }

  function mostrarNotificacionChat(nombre, texto, chatId, isGroup, photoURL) {
    playNotificationSound();
    const cont = notifyContainer();
    const bubble = document.createElement("div");
    bubble.className = "chat-notify-bubble";
    const preview = String(texto || "").slice(0, 90);
    bubble.innerHTML = `
      <span class="chat-notify-avatar">${avatarHtml(photoURL, nombre)}</span>
      <span class="chat-notify-body"><span class="chat-notify-name">${escapeHtml(nombre)}</span><br><span class="chat-notify-text">${isGroup ? "En el grupo: " : ""}${escapeHtml(preview)}</span></span>
      <button type="button" class="chat-notify-close" aria-label="Cerrar">✕</button>
    `;
    bubble.addEventListener("click", (e) => {
      if (e.target.closest(".chat-notify-close")) { bubble.remove(); return; }
      chatModal.hidden = false;
      openThread(chatId, nombre, isGroup, photoURL);
      bubble.remove();
    });
    cont.appendChild(bubble);
    requestAnimationFrame(() => bubble.classList.add("show"));
    setTimeout(() => {
      bubble.classList.remove("show");
      setTimeout(() => bubble.remove(), 300);
    }, 6500);
  }

  function initGlobalNotifications() {
    const infoPorChat = { [GROUP_CHAT_ID]: { name: "Grupo general", isGroup: true, photoURL: null } };
    directorio.forEach((p) => {
      infoPorChat[dmChatId(me.phone, p.phone)] = { name: p.name, isGroup: false, phone: p.phone, photoURL: null };
    });

    // "¿Ya lo vi?" se calcula comparando dos campos que viven en el
    // documento del chat en Firestore — lastMessageAt (cuándo llegó el
    // último mensaje) contra lastReadBy.<mi teléfono> (cuándo yo lo marqué
    // como visto, al abrir ese chat). Esto NO depende de nada guardado en
    // el celular, así que funciona aunque cambies de dispositivo,
    // reinstales la app, o el navegador recargue la página sola. La
    // primera vez que esto corre en un chat que nunca marcaste como
    // visto, puede avisarte de un mensaje que ya estaba pendiente — es
    // correcto, es justo lo que no habías visto todavía.
    Object.keys(infoPorChat).forEach((chatId) => {
      onSnapshot(doc(db, "chats", chatId), (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        if (!data.lastMessageAt || typeof data.lastMessageAt.toMillis !== "function") return;
        if (data.lastMessageFrom === me.phone) return; // lo mandé yo

        const millis = data.lastMessageAt.toMillis();
        const leido = data.lastReadBy && data.lastReadBy[me.phone] && typeof data.lastReadBy[me.phone].toMillis === "function"
          ? data.lastReadBy[me.phone].toMillis()
          : 0;
        if (millis <= leido) return; // ya lo marqué como visto

        const yaLoEstoyViendo = currentChatId === chatId && chatModal && !chatModal.hidden;
        if (yaLoEstoyViendo) return;

        unreadChats.add(chatId);
        actualizarBadgeChat();
        const info = infoPorChat[chatId];
        mostrarNotificacionChat(info.name, data.lastMessageText, chatId, info.isGroup, info.photoURL);
      }, (err) => {
        console.warn(`[chat.js] Notificaciones de ${chatId} no disponibles:`, err);
      });
    });

    // Fotos para que la nube de notificación no siempre muestre iniciales.
    directorio.forEach(async (p) => {
      try {
        const snap = await getDoc(doc(db, "profiles", p.phone));
        if (snap.exists() && infoPorChat[dmChatId(me.phone, p.phone)]) {
          infoPorChat[dmChatId(me.phone, p.phone)].photoURL = snap.data().photoURL || null;
        }
      } catch (e) { /* se queda con iniciales, no es grave */ }
    });
  }
  initGlobalNotifications();

  // ---- Eventos ----
  chatBtn.addEventListener("click", () => {
    chatModal.hidden = false;
    closeThread();
    unreadChats.clear();
    actualizarBadgeChat();
    if (window.showAppLoading) window.showAppLoading("Abriendo el chat…");
    const terminar = () => { if (window.hideAppLoading) window.hideAppLoading(); };
    renderDirectory().then(terminar).catch(terminar);
  });
  if (chatModalClose) chatModalClose.addEventListener("click", () => { chatModal.hidden = true; closeThread(); });
  if (chatThreadBack) chatThreadBack.addEventListener("click", closeThread);
  if (chatSendBtn) chatSendBtn.addEventListener("click", enviarTexto);
  if (chatTextInput) chatTextInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviarTexto(); }
  });
  if (chatEmojiBtn && chatEmojiPanel) {
    chatEmojiBtn.addEventListener("click", () => { chatEmojiPanel.hidden = !chatEmojiPanel.hidden; });
    chatEmojiPanel.querySelectorAll(".chat-emoji-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (chatTextInput) { chatTextInput.value += btn.textContent; chatTextInput.focus(); }
      });
    });
  }
  if (chatPhotoBtn && chatPhotoInput) {
    chatPhotoBtn.addEventListener("click", () => chatPhotoInput.click());
    chatPhotoInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (file) enviarFoto(file);
    });
  }
  if (chatVoiceBtn) {
    chatVoiceBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); iniciarGrabacion(); });
    chatVoiceBtn.addEventListener("pointerup", () => detenerGrabacion(true));
    chatVoiceBtn.addEventListener("pointerleave", () => detenerGrabacion(false));
    chatVoiceBtn.addEventListener("pointercancel", () => detenerGrabacion(false));
    chatVoiceBtn.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  return { openThread };
}