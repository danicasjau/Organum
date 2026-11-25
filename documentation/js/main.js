/* ORGANUM documentation site — small, dependency-free behaviour. */
(function () {
  "use strict";

  var root = document.documentElement;

  /* ---------- theme (mirrors the app's data-theme switch) ---------- */
  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    document.querySelectorAll("[data-theme-set]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-theme-set") === theme));
    });
    document.querySelectorAll("img[data-light]").forEach(function (img) {
      if (!img.dataset.dark) img.dataset.dark = img.getAttribute("src");
      img.setAttribute("src", theme === "light" ? img.dataset.light : img.dataset.dark);
    });
    try { localStorage.setItem("organum-docs-theme", theme); } catch (e) { /* storage unavailable */ }
  }
  document.querySelectorAll("[data-theme-set]").forEach(function (b) {
    b.addEventListener("click", function () { applyTheme(b.getAttribute("data-theme-set")); });
  });
  var saved = null;
  try { saved = localStorage.getItem("organum-docs-theme"); } catch (e) { /* ignore */ }
  if (saved === "light") applyTheme("light");

  /* ---------- mobile menu ---------- */
  var menuBtn = document.querySelector(".menu-btn");
  var links = document.getElementById("navlinks");
  if (menuBtn) {
    menuBtn.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", String(open));
    });
    links.addEventListener("click", function (e) {
      if (e.target.tagName === "A") { links.classList.remove("open"); menuBtn.setAttribute("aria-expanded", "false"); }
    });
  }

  /* ---------- intro video player ---------- */
  var v = document.getElementById("introVideo");
  var playBtn = document.getElementById("introPlay");
  var track = document.getElementById("introTrack");
  var bar = track ? track.querySelector("i") : null;
  var timeEl = document.getElementById("introTime");
  function fmt(s) {
    s = Math.max(0, Math.floor(s || 0));
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }
  function toggle() {
    if (v.paused) { v.play(); } else { v.pause(); }
  }
  if (v) {
    playBtn.addEventListener("click", toggle);
    v.addEventListener("click", toggle);
    v.addEventListener("play", function () { playBtn.textContent = "❚❚ Pause"; });
    v.addEventListener("pause", function () { playBtn.textContent = "▶ Play"; });
    v.addEventListener("ended", function () { playBtn.textContent = "↺ Replay"; });
    v.addEventListener("timeupdate", function () {
      var d = v.duration || 50;
      bar.style.width = (100 * v.currentTime / d) + "%";
      timeEl.textContent = fmt(v.currentTime) + " / " + fmt(d);
    });
    v.addEventListener("loadedmetadata", function () { timeEl.textContent = "00:00 / " + fmt(v.duration); });
    track.addEventListener("click", function (e) {
      var r = track.getBoundingClientRect();
      v.currentTime = ((e.clientX - r.left) / r.width) * (v.duration || 0);
    });
    document.getElementById("introFull").addEventListener("click", function () {
      var el = v;
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitEnterFullscreen) el.webkitEnterFullscreen();
    });
    document.querySelectorAll('a[href="#intro"]').forEach(function (a) {
      a.addEventListener("click", function () { setTimeout(function () { v.play(); }, 350); });
    });
  }

  /* ---------- tabs ---------- */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  function selectTab(tab) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      var panel = document.getElementById(t.getAttribute("aria-controls"));
      panel.classList.toggle("on", on);
      panel.querySelectorAll("video").forEach(function (vid) {
        if (on) { vid.preload = "auto"; vid.play().catch(function () {}); } else { vid.pause(); }
      });
    });
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { selectTab(t); });
    t.addEventListener("keydown", function (e) {
      var j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
      if (j === null) return;
      var next = tabs[(j + tabs.length) % tabs.length];
      next.focus();
      selectTab(next);
    });
  });

  /* ---------- workflow simulator (rules from backend/app/services/workflow.py) ---------- */
  var flow = document.getElementById("flow");
  var logEl = document.getElementById("flowLog");
  var ORDER = ["WTG", "RDY", "IP", "P_LEAD", "P_SUP", "P_CLIENT", "APP"];
  var REVIEW = [
    { s: "P_LEAD", box: "needLead", who: "lead_marco", perm: "task.approve.lead" },
    { s: "P_SUP", box: "needSup", who: "sup_elena", perm: "task.approve.sup" },
    { s: "P_CLIENT", box: "needClient", who: "cli_jordan", perm: "task.approve.client" }
  ];
  var state = "WTG";
  var retakes = 0;
  var clock = 0;

  function enabledStages() {
    return REVIEW.filter(function (r) { return document.getElementById(r.box).checked; });
  }
  function log(html) {
    clock += 1;
    var line = document.createElement("div");
    line.innerHTML = '<span class="t">[' + String(clock).padStart(2, "0") + "]</span> " + html;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function render() {
    var shown = state === "RTK" ? "IP" : state;
    var idx = ORDER.indexOf(shown);
    var active = enabledStages().map(function (r) { return r.s; });
    flow.classList.toggle("retake", state === "RTK");
    flow.querySelectorAll(".st").forEach(function (el) {
      var s = el.getAttribute("data-s");
      var i = ORDER.indexOf(s);
      el.classList.toggle("now", i === idx);
      el.classList.toggle("done", i < idx);
      var skipped = s.indexOf("P_") === 0 && active.indexOf(s) === -1;
      el.style.opacity = skipped ? "0.35" : "";
      if (s === "IP") {
        el.querySelector("b").textContent = state === "RTK" ? "RTK" : "IP";
        el.querySelector("small").textContent = state === "RTK" ? "Retake" : "In progress";
      }
    });
  }
  function firstStageAfter(current) {
    var st = enabledStages();
    if (!current) return st.length ? st[0] : null;
    var i = st.map(function (r) { return r.s; }).indexOf(current);
    return st[i + 1] || null;
  }
  function next() {
    if (state === "WTG") {
      state = "RDY";
      log('<span class="who">system</span> upstream Lookdev approved → <span class="ok">WTG → RDY</span>');
    } else if (state === "RDY" || state === "RTK") {
      var from = state;
      state = "IP";
      log('<span class="who">art_sam</span> starts work → ' + from + " → IP");
    } else if (state === "IP") {
      var first = firstStageAfter(null);
      log('<span class="who">art_sam</span> publishes <b>v000' + (retakes + 1) + "</b> and submits");
      if (first) {
        state = first.s;
        log("routed to first review stage → IP → " + state + (state === "P_CLIENT" ? " (version shared with client)" : ""));
      } else {
        state = "APP";
        log('<span class="ok">no review stages enabled → APP</span>');
      }
    } else if (state.indexOf("P_") === 0) {
      var cur = REVIEW.filter(function (r) { return r.s === state; })[0];
      var nxt = firstStageAfter(state);
      var to = nxt ? nxt.s : "APP";
      log('<span class="who">' + cur.who + "</span> approves (" + cur.perm + ") → " + state + " → " + (to === "APP" ? '<span class="ok">APP</span>' : to));
      state = to;
      if (to === "APP") log('<span class="ok">approved version recorded; downstream Lighting task WTG → RDY</span>');
    } else if (state === "APP") {
      log("task is approved. Use <b>Retake</b> to reopen it, or <b>Reset</b>.");
    }
    render();
  }
  function retake() {
    if (state.indexOf("P_") === 0 || state === "APP") {
      var who = state === "APP" ? "dir_alex" : REVIEW.filter(function (r) { return r.s === state; })[0].who;
      retakes += 1;
      log('<span class="who">' + who + '</span> <span class="bad">retake</span> with note “rim light too hot on frame 1012” → ' + state + ' → <span class="bad">RTK</span> (retakes: ' + retakes + ")");
      state = "RTK";
      render();
    } else {
      log("Retake is only possible during review or after approval (a note is required).");
    }
  }
  function reset() {
    state = "WTG"; retakes = 0; clock = 0; logEl.innerHTML = "";
    log("task <b>hero_robot / Lighting / beauty</b> waits on upstream Lookdev → <b>WTG</b>");
    render();
  }
  if (flow) {
    document.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function () {
        var a = b.getAttribute("data-act");
        if (a === "next") next(); else if (a === "retake") retake(); else reset();
      });
    });
    REVIEW.forEach(function (r) { document.getElementById(r.box).addEventListener("change", render); });
    reset();
  }

  /* ---------- gallery + lightbox ---------- */
  var SHOTS = [
    ["phase6b-entities-dark.png", "Entities browser"],
    ["phase2-viewer-dark.png", "2D viewer & scopes"],
    ["phase3-3d-dark.png", "3D viewport"],
    ["phase3-3d-frozen.png", "3D frozen for annotation"],
    ["phase4-video-dark.png", "Video playback"],
    ["phase4-audio-dark.png", "Audio waveform & spectrogram"],
    ["phase4-timeline-dark.png", "EDL timeline"],
    ["phase5-hdr-dark.png", "HDR image"],
    ["phase5-pdf-dark.png", "PDF brief"],
    ["phase5-csv-dark.png", "CSV data grid"],
    ["phase6c-layerstrip-dark.png", "EXR AOVs in the layer strip"],
    ["phase6c-udim-dark.png", "UDIM mosaic"],
    ["phase6b-entity-tab-dark.png", "Entity inspector"],
    ["phase6a-settings-project-dark.png", "Project settings"],
    ["phase6a-settings-departments-dark.png", "Departments catalog"],
    ["phase7a-users-dark.png", "Users directory"],
    ["phase7a-admin-dark.png", "Roles & permissions"],
    ["phase7a-client-dark.png", "Client view"],
    ["phase7a-me-dark.png", "My profile"],
    ["phase7a-login-dark.png", "Sign in"],
    ["phase1-gallery-dark.png", "Widget gallery"],
    ["phase5-gallery-dark.png", "Charts & data widgets"],
    ["phase2-viewer-light.png", "Light theme — viewer"],
    ["phase3-3d-light.png", "Light theme — 3D"]
  ];
  var grid = document.getElementById("galleryGrid");
  var list = [];
  SHOTS.forEach(function (s) {
    var b = document.createElement("button");
    b.type = "button";
    b.innerHTML = '<img src="assets/img/' + s[0] + '" alt="' + s[1] + '" loading="lazy" /><span>' + s[1] + "</span>";
    grid.appendChild(b);
    var entry = { src: "assets/img/" + s[0], cap: s[1] };
    list.push(entry);
    b.addEventListener("click", function () { openLb(list.indexOf(entry)); });
  });

  var lb = document.getElementById("lb");
  var lbImg = document.getElementById("lbImg");
  var lbCap = document.getElementById("lbCap");
  var lbIdx = document.getElementById("lbIdx");
  var cur = 0;
  var lastFocus = null;
  function show(i) {
    cur = (i + list.length) % list.length;
    lbImg.src = list[cur].src;
    lbImg.alt = list[cur].cap;
    lbCap.textContent = list[cur].cap;
    lbIdx.textContent = (cur + 1) + " / " + list.length;
  }
  function openLb(i) {
    lastFocus = document.activeElement;
    show(i);
    lb.classList.add("on");
    lb.querySelector('[data-lb="close"]').focus();
    document.body.style.overflow = "hidden";
  }
  function closeLb() {
    lb.classList.remove("on");
    document.body.style.overflow = "";
    if (lastFocus) lastFocus.focus();
  }
  lb.addEventListener("click", function (e) {
    var a = e.target.getAttribute("data-lb");
    if (a === "prev") show(cur - 1);
    else if (a === "next") show(cur + 1);
    else if (a === "close" || e.target === lb || e.target.classList.contains("lb-stage")) closeLb();
  });
  document.addEventListener("keydown", function (e) {
    if (!lb.classList.contains("on")) return;
    if (e.key === "Escape") closeLb();
    if (e.key === "ArrowRight") show(cur + 1);
    if (e.key === "ArrowLeft") show(cur - 1);
  });

  // Screenshots inside the page open in the lightbox too.
  document.querySelectorAll(".media img, .tabpanel .shot img").forEach(function (img) {
    img.addEventListener("click", function () {
      var src = img.getAttribute("src");
      var i = list.map(function (x) { return x.src; }).indexOf(src);
      if (i === -1) { list.push({ src: src, cap: img.alt }); i = list.length - 1; }
      openLb(i);
    });
  });
})();
