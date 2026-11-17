// Aviso de "trabajando…" que NO bloquea la pantalla: una barra fina arriba
// con la moto cruzando de lado a lado y un texto corto. Sirve para que la
// app nunca se vea pegada mientras se habla con Firebase.
//   showBusy("Enviando…")  /  hideBusy()   (se pueden anidar)
//   withBusy(promesa, "Enviando…")  -> devuelve la misma promesa
(function () {
  var css = document.createElement("style");
  css.textContent =
    ".busy-bar{position:fixed;left:0;right:0;top:0;z-index:450;height:34px;pointer-events:none;" +
    "padding-top:env(safe-area-inset-top,0px);display:flex;align-items:center;justify-content:center;" +
    "background:linear-gradient(180deg,rgba(6,10,18,.92),rgba(6,10,18,.78));border-bottom:1px solid rgba(79,157,255,.35);" +
    "opacity:0;transform:translateY(-100%);transition:opacity .2s ease,transform .2s ease;}" +
    ".busy-bar.on{opacity:1;transform:translateY(0);}" +
    ".busy-bar-track{position:absolute;inset:0;overflow:hidden;}" +
    ".busy-bar-moto{position:absolute;top:50%;left:-12%;width:26px;height:26px;border-radius:7px;transform:translateY(-50%);" +
    "animation:busyMoto 1.4s cubic-bezier(.45,0,.55,1) infinite;}" +
    ".busy-bar-line{position:absolute;bottom:0;left:0;height:2px;width:30%;background:linear-gradient(90deg,transparent,#4f9dff,transparent);" +
    "animation:busyMoto 1.4s cubic-bezier(.45,0,.55,1) infinite;}" +
    ".busy-bar-text{position:relative;font-size:12px;font-weight:700;color:#dce6f5;letter-spacing:.02em;" +
    "background:rgba(6,10,18,.6);padding:2px 10px;border-radius:999px;max-width:80vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
    "@keyframes busyMoto{0%{left:-12%}100%{left:104%}}" +
    "@media (prefers-reduced-motion:reduce){.busy-bar-moto,.busy-bar-line{animation:none;left:8%}}";
  document.head.appendChild(css);

  var bar = document.createElement("div");
  bar.className = "busy-bar";
  bar.setAttribute("role", "status");
  bar.innerHTML = '<div class="busy-bar-track"><span class="busy-bar-line"></span>' +
    '<img class="busy-bar-moto" src="icons/loading-moto.png" alt=""></div><span class="busy-bar-text"></span>';
  function mount() { document.body.appendChild(bar); }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);

  var count = 0, showTimer = null, texts = [];
  function paint() {
    var t = texts.length ? texts[texts.length - 1] : "Trabajando…";
    bar.querySelector(".busy-bar-text").textContent = t;
  }
  window.showBusy = function (texto) {
    count++; texts.push(texto || "Trabajando…");
    paint();
    if (!showTimer && !bar.classList.contains("on")) {
      showTimer = setTimeout(function () { showTimer = null; if (count > 0) bar.classList.add("on"); }, 350);
    }
  };
  window.hideBusy = function () {
    count = Math.max(0, count - 1); texts.pop();
    if (count === 0) { clearTimeout(showTimer); showTimer = null; bar.classList.remove("on"); }
    else paint();
  };
  window.withBusy = function (promise, texto) {
    window.showBusy(texto);
    var done = function () { window.hideBusy(); };
    Promise.resolve(promise).then(done, done);
    return promise;
  };
})();
