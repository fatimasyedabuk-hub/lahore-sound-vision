/* Lahore, in 88 seconds.
   - the composed soundscape plays on one <audio> element, with our own controls
   - a Web Audio AnalyserNode listens to the sound; the loudness drives the photo (scale, colour),
     the blurred background, and bars drawn around the arch
   - the scene changes follow the playhead
   - Mix mode plays five looping <audio> elements, each with its own switch and volume
   If the browser can't analyse the audio (page opened from file://), pre-measured loudness
   (js/envelopes.js) is used instead so the picture still moves. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var ENV = window.ENVELOPES || {};

  /* ---------- data ---------- */
  var IMG = {
    sky: "assets/images/sky.jpg", badshahi: "assets/images/badshahi.jpg", gate: "assets/images/walled-city.jpg",
    food: "assets/images/food-street.jpg", traffic: "assets/images/traffic.jpg"
  };
  var ALT = {
    sky: "Kites in an evening sky over Lahore", badshahi: "Badshahi Mosque at sunset",
    gate: "A street in the walled city of Lahore", food: "Food Street in the old city at night",
    traffic: "Rickshaws and motorbikes in Lahore traffic"
  };
  var SCENES = [
    { t: 0, name: "Rooftops at dusk", line: "Crows and kites circle as the light goes.", img: "sky" },
    { t: 13, name: "Badshahi Mosque", line: "The call to prayer rolls out over the old city.", img: "badshahi" },
    { t: 38, name: "Delhi Gate", line: "Inside the walled city the bazaar is loud.", img: "gate" },
    { t: 54, name: "Food Street", line: "Pans, oil and a long line of hungry people.", img: "food" },
    { t: 66, name: "Busy roads", line: "Rickshaws, horns and motorbikes.", img: "traffic" },
    { t: 79, name: "Back to the rooftops", line: "The noise drops. The crows are still up there.", img: "sky" }
  ];
  var STEMS = [
    { key: "azaan", el: "aAzaan", name: "Call to prayer", note: "Badshahi Mosque", img: "badshahi", vol: 0.8 },
    { key: "bazaar", el: "aBazaar", name: "Bazaar", note: "Delhi Gate", img: "gate", vol: 0.6 },
    { key: "food", el: "aFood", name: "Food street", note: "Frying and chatter", img: "food", vol: 0.8 },
    { key: "traffic", el: "aTraffic", name: "Traffic", note: "Rickshaws and horns", img: "traffic", vol: 0.6 },
    { key: "birds", el: "aBirds", name: "Crows and kites", note: "The rooftops", img: "sky", vol: 0.8 }
  ];
  var DEFAULT_DUR = 88;

  /* ---------- elements ---------- */
  var master = { key: "soundscape", el: $("aMaster"), k: 4.5, lv: 0, vol: 0.8 };
  var stems = STEMS.map(function (s) {
    return { key: s.key, el: $(s.el), cfg: s, k: 9, lv: 0, vol: s.vol, on: false };
  });
  var all = [master].concat(stems);
  var mode = "listen";
  var muted = false;
  var status = $("status");

  function fmt(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60); }
  function fill(r) { r.style.setProperty("--fill", ((r.value - r.min) / (r.max - r.min) * 100) + "%"); }
  function say(msg) { status.textContent = msg || ""; }
  function dur() { return isFinite(master.el.duration) && master.el.duration > 1 ? master.el.duration : DEFAULT_DUR; }

  /* ---------- pictures ---------- */
  var imgs = [$("imgA"), $("imgB")], bgs = [$("bgA"), $("bgB")], front = 0, shownKey = null;
  Object.keys(IMG).forEach(function (k) { var i = new Image(); i.src = IMG[k]; });
  function show(key) {
    if (key === shownKey) return;
    var first = shownKey === null;
    shownKey = key;
    var nxt = first ? 0 : 1 - front;
    imgs[nxt].src = IMG[key]; imgs[nxt].alt = ALT[key];
    bgs[nxt].style.backgroundImage = 'url("' + IMG[key] + '")';
    imgs[nxt].classList.add("on"); bgs[nxt].classList.add("on");
    if (!first) { imgs[front].classList.remove("on"); bgs[front].classList.remove("on"); }
    front = nxt;
  }
  show("sky");

  /* ---------- Web Audio (only on http/https; Chrome mutes element sources on file://) ---------- */
  var ctx = null, busAn = null, freq = new Uint8Array(128);
  function initGraph() {
    if (ctx || !/^https?:$/.test(location.protocol)) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      var bus = ctx.createGain();
      busAn = ctx.createAnalyser(); busAn.fftSize = 256; busAn.smoothingTimeConstant = 0.78;
      bus.connect(busAn); busAn.connect(ctx.destination);
      all.forEach(function (a) {
        var src = ctx.createMediaElementSource(a.el);
        a.gain = ctx.createGain();
        a.an = ctx.createAnalyser(); a.an.fftSize = 512; a.buf = new Uint8Array(a.an.fftSize);
        src.connect(a.gain); a.gain.connect(a.an); a.an.connect(bus);
        a.el.volume = 1;
      });
      applyVolumes();
    } catch (e) { ctx = null; busAn = null; }
  }
  function wake() {
    initGraph();
    if (ctx && ctx.state === "suspended") ctx.resume();
  }
  function applyVolumes() {
    all.forEach(function (a) {
      var v = muted ? 0 : a.vol;
      if (a.gain) a.gain.gain.value = v; else a.el.volume = v;
    });
  }

  /* ---------- loudness of one audio element, 0..1 ---------- */
  function measure(a) {
    var v = 0;
    if (a.an) {
      a.an.getByteTimeDomainData(a.buf);
      var sum = 0;
      for (var i = 0; i < a.buf.length; i++) { var d = (a.buf[i] - 128) / 128; sum += d * d; }
      v = Math.min(1, Math.sqrt(sum / a.buf.length) * a.k);
    } else if (!a.el.paused && ENV[a.key]) {
      var e = ENV[a.key];
      v = e[Math.floor(a.el.currentTime * 20) % e.length] * (muted ? 0 : a.vol);
    }
    a.lv += (v - a.lv) * 0.35;
    return a.lv;
  }

  /* ---------- the arch outline, shared by the clip-path and the sound bars ---------- */
  var archwrap = $("archwrap"), canvas = $("viz"), g = canvas.getContext("2d");
  var PAD = 64, W = 0, H = 0, dpr = 1;
  var N = 84, pts = [];
  function bez(p0, p1, p2, p3, t) {
    var u = 1 - t;
    return [u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0],
            u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1]];
  }
  function sizeCanvas() {
    PAD = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--pad")) || 64;
    W = archwrap.clientWidth; H = archwrap.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = (W + PAD * 2) * dpr; canvas.height = (H + PAD * 2) * dpr;
    g.setTransform(dpr, 0, 0, dpr, PAD * dpr, PAD * dpr);
    // sample the outline (left side, curve, curve, right side), then space N bars evenly along it
    var path = [], i, t;
    for (i = 0; i <= 20; i++) path.push([0, 1 - 0.55 * i / 20]);
    for (i = 1; i <= 60; i++) path.push(bez([0, .45], [0, .2], [.35, .1], [.5, 0], i / 60));
    for (i = 1; i <= 60; i++) path.push(bez([.5, 0], [.65, .1], [1, .2], [1, .45], i / 60));
    for (i = 1; i <= 20; i++) path.push([1, .45 + 0.55 * i / 20]);
    path = path.map(function (p) { return [p[0] * W, p[1] * H]; });
    var cum = [0];
    for (i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i-1][0], path[i][1] - path[i-1][1]));
    var total = cum[cum.length - 1], j = 1;
    pts = [];
    for (i = 0; i < N; i++) {
      var s = (i + 0.5) / N * total;
      while (j < cum.length - 1 && cum[j] < s) j++;
      var f = (s - cum[j-1]) / (cum[j] - cum[j-1] || 1);
      var x = path[j-1][0] + (path[j][0] - path[j-1][0]) * f, y = path[j-1][1] + (path[j][1] - path[j-1][1]) * f;
      var tx = path[j][0] - path[j-1][0], ty = path[j][1] - path[j-1][1], L = Math.hypot(tx, ty) || 1;
      pts.push({ x: x, y: y, nx: ty / L, ny: -tx / L, u: i / (N - 1) });
    }
  }

  /* ---------- drawing ---------- */
  var bars = new Float32Array(N), ripples = [], px = 0, py = 0, tpx = 0, tpy = 0, avg = 0, clock = 0;
  function readBars(level) {
    var haveFreq = false;
    if (busAn) { busAn.getByteFrequencyData(freq); haveFreq = true; }
    for (var i = 0; i < N; i++) {
      var u = pts[i].u, m = 1 - Math.abs(2 * u - 1), v;     // 0 at the foot of the arch, 1 at the top
      if (haveFreq) {
        v = freq[2 + Math.floor((1 - m) * 70)] / 255;       // low sounds near the ground... top = high
        v = Math.pow(v, 1.4) * 1.5;
      } else {
        v = level * (0.55 + 0.45 * Math.sin(i * 0.9 + clock * 3) * Math.sin(i * 0.31 - clock * 1.7));
      }
      v = Math.max(0, Math.min(1, v));
      bars[i] += (v - bars[i]) * (v > bars[i] ? 0.6 : 0.14);
    }
  }
  function draw(level) {
    g.clearRect(-PAD, -PAD, W + PAD * 2, H + PAD * 2);
    var grad = g.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, "#2cc0b0"); grad.addColorStop(1, "#f4b223");
    g.strokeStyle = grad; g.lineCap = "round"; g.lineWidth = Math.max(2.5, W / 120);
    var amp = PAD * 0.8, gap = 8;
    for (var i = 0; i < N; i++) {
      var p = pts[i], len = 3 + bars[i] * amp;
      g.globalAlpha = 0.45 + bars[i] * 0.55;
      g.beginPath();
      g.moveTo(p.x + p.nx * gap, p.y + p.ny * gap);
      g.lineTo(p.x + p.nx * (gap + len), p.y + p.ny * (gap + len));
      g.stroke();
    }
    g.globalAlpha = 1;
    for (var r = ripples.length - 1; r >= 0; r--) {
      var rp = ripples[r]; rp.r += 3.2; rp.a -= 0.014;
      if (rp.a <= 0) { ripples.splice(r, 1); continue; }
      g.strokeStyle = "rgba(246,238,219," + rp.a.toFixed(2) + ")"; g.lineWidth = 2;
      g.beginPath(); g.arc(rp.x, rp.y, rp.r, 0, 6.2832); g.stroke();
    }
  }

  /* ---------- scenes ---------- */
  var sceneList = $("scenes"), sceneBtns = [], current = -1;
  SCENES.forEach(function (s, i) {
    var li = document.createElement("li"), b = document.createElement("button");
    b.type = "button";
    b.innerHTML = '<span></span><span class="tc"></span>';
    b.children[0].textContent = s.name; b.children[1].textContent = fmt(s.t);
    b.addEventListener("click", function () { seek(s.t + 0.05); if (master.el.paused) play(); });
    li.appendChild(b); sceneList.appendChild(li); sceneBtns.push(b);
  });
  function sceneAt(t) { var k = 0; SCENES.forEach(function (s, i) { if (t >= s.t) k = i; }); return k; }
  function setScene(i) {
    if (i === current) return;
    current = i;
    sceneBtns.forEach(function (b, k) { if (k === i) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current"); });
    $("capTitle").textContent = SCENES[i].name; $("capLine").textContent = SCENES[i].line;
    show(SCENES[i].img);
  }
  setScene(0);

  /* ---------- listen controls ---------- */
  var seekEl = $("seek"), volEl = $("vol");
  function play() {
    wake();
    var p = master.el.play();
    if (p && p.catch) p.catch(function () { say("The audio could not start. Check your sound and try again."); });
    setTimeout(function () {
      if (!master.el.paused && master.el.currentTime < 0.3) say("No sound yet? Check your volume and silent switch, then press play again.");
    }, 2500);
  }
  function toggle() { if (master.el.paused) play(); else master.el.pause(); }
  function seek(t) { master.el.currentTime = Math.max(0, Math.min(dur() - 0.05, t)); tick(true); }
  function sync() {
    document.body.classList.toggle("is-playing", !master.el.paused && mode === "listen");
    $("playBtn").setAttribute("aria-label", master.el.paused ? "Play" : "Pause");
    $("archPlay").setAttribute("aria-label", "Play the soundscape");
  }
  ["play", "pause", "ended"].forEach(function (e) { master.el.addEventListener(e, sync); });
  master.el.addEventListener("ended", function () { setScene(0); });
  master.el.addEventListener("loadedmetadata", function () { seekEl.max = dur(); $("tAll").textContent = fmt(dur()); });
  all.forEach(function (a) {
    a.el.addEventListener("error", function () { say("A sound file did not load (" + a.key + ")."); });
  });
  $("playBtn").addEventListener("click", toggle);
  $("archPlay").addEventListener("click", function (e) { e.stopPropagation(); if (mode === "listen") play(); else { setMode("listen"); play(); } });
  seekEl.addEventListener("input", function () { master.el.currentTime = parseFloat(seekEl.value); tick(true); });
  volEl.addEventListener("input", function () { all.forEach(function (a) { a.vol = parseFloat(volEl.value); }); stems.forEach(function (s) { s.row && (s.row.vol.value = s.vol, fill(s.row.vol)); }); muted = false; $("muteBtn").setAttribute("aria-pressed", "false"); applyVolumes(); fill(volEl); });
  $("muteBtn").addEventListener("click", function () { muted = !muted; this.setAttribute("aria-pressed", muted); this.setAttribute("aria-label", muted ? "Unmute" : "Mute"); applyVolumes(); });
  fill(volEl); fill(seekEl);
  master.el.volume = master.vol;

  /* ---------- mix mode ---------- */
  var stemList = $("stems");
  stems.forEach(function (s) {
    var c = s.cfg, li = document.createElement("li");
    li.className = "stem";
    li.innerHTML =
      '<button type="button" class="tog" aria-pressed="false">Off</button>' +
      '<div class="name"><span></span><small></small></div>' +
      '<div class="row"><input type="range" min="0" max="1" step="0.01" aria-label=""><div class="meter" aria-hidden="true"><i></i></div></div>';
    li.querySelector(".name span").textContent = c.name;
    li.querySelector(".name small").textContent = c.note;
    var r = { li: li, tog: li.querySelector(".tog"), vol: li.querySelector("input"), meter: li.querySelector(".meter i") };
    r.vol.value = s.vol; r.vol.setAttribute("aria-label", c.name + " volume"); fill(r.vol);
    r.tog.setAttribute("aria-label", c.name);
    r.tog.addEventListener("click", function () { setStem(s, !s.on); });
    r.vol.addEventListener("input", function () { s.vol = parseFloat(r.vol.value); fill(r.vol); applyVolumes(); });
    s.row = r; stemList.appendChild(li);
  });
  function setStem(s, on) {
    s.on = on;
    s.row.tog.setAttribute("aria-pressed", on); s.row.tog.textContent = on ? "On" : "Off";
    s.row.li.classList.toggle("on", on);
    if (on) { wake(); applyVolumes(); var p = s.el.play(); if (p && p.catch) p.catch(function () { say("The audio could not start."); }); }
    else s.el.pause();
    document.body.classList.toggle("is-mixing", mode === "mix" && stems.some(function (x) { return x.on; }));
    if (!on) s.lv = 0;
    var n = stems.filter(function (x) { return x.on; }).length;
    say(mode === "mix" ? (n ? n + (n === 1 ? " sound is" : " sounds are") + " in the mix." : "Nothing is playing. Switch a sound on.") : "");
  }
  $("allOn").addEventListener("click", function () { stems.forEach(function (s) { setStem(s, true); }); });
  $("allOff").addEventListener("click", function () { stems.forEach(function (s) { setStem(s, false); }); });

  /* ---------- tabs ---------- */
  var tabL = $("tabListen"), tabM = $("tabMix");
  function setMode(m) {
    mode = m;
    var mix = m === "mix";
    tabL.setAttribute("aria-selected", !mix); tabM.setAttribute("aria-selected", mix);
    tabL.tabIndex = mix ? -1 : 0; tabM.tabIndex = mix ? 0 : -1;
    $("listenPanel").hidden = mix; $("mixPanel").hidden = !mix;
    if (mix) { master.el.pause(); } else { stems.forEach(function (s) { if (s.on) setStem(s, false); }); }
    document.body.classList.remove("is-mixing");
    say(""); sync();
    if (mix) { setStem(stems[4], true); } else { show(SCENES[current].img); }
  }
  tabL.addEventListener("click", function () { setMode("listen"); });
  tabM.addEventListener("click", function () { setMode("mix"); });
  [tabL, tabM].forEach(function (t) {
    t.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { var other = t === tabL ? tabM : tabL; other.click(); other.focus(); }
    });
  });

  /* ---------- pointer: parallax and ripples ---------- */
  window.addEventListener("pointermove", function (e) {
    tpx = (e.clientX / window.innerWidth - 0.5) * 2; tpy = (e.clientY / window.innerHeight - 0.5) * 2;
  });
  $("arch").addEventListener("pointerdown", function (e) {
    var b = archwrap.getBoundingClientRect();
    ripples.push({ x: e.clientX - b.left, y: e.clientY - b.top, r: 6, a: 0.8 });
    boost = 1;
  });
  var boost = 0;

  /* ---------- keyboard ---------- */
  document.addEventListener("keydown", function (e) {
    var t = e.target, tag = t && t.tagName;
    if (e.key === " " && tag !== "BUTTON" && tag !== "INPUT" && tag !== "A" && mode === "listen") { e.preventDefault(); toggle(); }
    else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && tag !== "INPUT" && tag !== "BUTTON" && mode === "listen") {
      seek(master.el.currentTime + (e.key === "ArrowRight" ? 5 : -5));
    } else if ((e.key === "m" || e.key === "M") && tag !== "INPUT") { $("muteBtn").click(); }
  });

  /* ---------- the loop ---------- */
  var lastSeek = -1;
  function tick(force) {
    var t = master.el.currentTime;
    if (force || t !== lastSeek) {
      lastSeek = t;
      if (document.activeElement !== seekEl || force !== true) seekEl.value = t;
      fill(seekEl); $("tNow").textContent = fmt(t);
      seekEl.setAttribute("aria-valuetext", fmt(t) + " of " + fmt(dur()));
      if (mode === "listen") setScene(sceneAt(t));
    }
  }
  function frame(ms) {
    clock = ms / 1000;
    var level = 0;
    if (mode === "listen") {
      level = measure(master);
    } else {
      var best = null, bestV = 0.04;
      stems.forEach(function (s) {
        var v = s.on ? measure(s) : 0;
        s.row.meter.style.width = Math.round(v * 100) + "%";
        level = Math.max(level, v);
        if (s.on && v > bestV) { bestV = v; best = s; }
      });
      show(best ? best.cfg.img : (stems.some(function (s) { return s.on; }) ? shownKey : "sky"));
    }
    boost *= 0.92;
    var lv = Math.min(1, Math.max(level, boost * 0.7));
    avg += (lv - avg) * 0.25;
    var el = document.documentElement;
    if (reduce) { el.style.setProperty("--lv", 0); }
    else {
      px += (tpx - px) * 0.06; py += (tpy - py) * 0.06;
      el.style.setProperty("--lv", avg.toFixed(3));
      el.style.setProperty("--px", px.toFixed(3)); el.style.setProperty("--py", py.toFixed(3));
    }
    readBars(lv); draw(lv);
    if (mode === "listen") tick(false);
    requestAnimationFrame(frame);
  }

  sizeCanvas();
  window.addEventListener("resize", sizeCanvas);
  if (window.ResizeObserver) new ResizeObserver(sizeCanvas).observe(archwrap);
  seekEl.max = dur(); $("tAll").textContent = fmt(dur());
  sync();
  requestAnimationFrame(frame);

  /* test hook */
  window.__lahore = { get ctx() { return !!ctx; }, get scene() { return current; } };
})();
