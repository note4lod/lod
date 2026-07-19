(() => {
  "use strict";

  const CFG = window.EP_CONFIG || { MASTER_MODE: true, VERSION: "1.7.0-MASTER" };
  const $ = (id) => document.getElementById(id);
  const canvas = $("chartCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rad = (d) => d * Math.PI / 180;
  const deg = (r) => r * 180 / Math.PI;
  const norm = (d) => (d % 360 + 360) % 360;
  const kn2ms = (k) => k * 0.514444;
  const DEFAULT_SHIP = Object.freeze({ length: 150, beam: 24, maxSpeed: 14, draft: 7.5, minUkc: 1 });
  const ENGINE_NAMES = new Map([
    [-1, "TAM TORNİSTAN"], [-0.55, "YARIM TORNİSTAN"], [-0.25, "PEK AĞIR TORNİSTAN"],
    [0, "STOP"], [0.22, "PEK AĞIR İLERİ"], [0.45, "AĞIR İLERİ"], [0.7, "YARIM İLERİ"], [1, "TAM İLERİ"]
  ]);
  const LEVELS = [
    { id: 1, name: "Temel Kumanda", desc: "Sakin hava, geniş kanal", depth: 18, half: 300, wind: [0,0], current: [0,0], traffic: 0, time: 420, seed: .3 },
    { id: 2, name: "Enine Akıntı", desc: "1.4 kn sancaktan iskeleye", depth: 18, half: 270, wind: [0,0], current: [1.4,270], traffic: 0, time: 420, seed: .8 },
    { id: 3, name: "Kuvvetli Rüzgâr", desc: "22 kn batı rüzgârı", depth: 18, half: 250, wind: [22,270], current: [.5,20], traffic: 1, time: 400, seed: 1.2 },
    { id: 4, name: "Sığ Su", desc: "Squat ve düşük UKC", depth: 12.6, half: 235, wind: [8,160], current: [.8,95], traffic: 1, time: 390, seed: 1.7, shoal: true },
    { id: 5, name: "Yoğun Trafik", desc: "Karşı ve kesişen gemiler", depth: 18, half: 240, wind: [10,220], current: [.7,40], traffic: 4, time: 380, seed: 2.1 },
    { id: 6, name: "Dar Kanal", desc: "Sınırlı dönüş alanı", depth: 15, half: 170, wind: [16,310], current: [1.2,120], traffic: 3, time: 370, seed: 2.8, shoal: true },
    { id: 7, name: "Birleşik Etkiler", desc: "Rüzgâr, akıntı, trafik, sığlık", depth: 13.5, half: 185, wind: [26,250], current: [1.8,80], traffic: 5, time: 360, seed: 3.4, shoal: true },
    { id: 8, name: "Kaptan Seviyesi", desc: "Fırtına ve kritik geçiş", depth: 12.2, half: 155, wind: [34,300], current: [2.5,110], traffic: 6, time: 340, seed: 4.1, shoal: true }
  ];
  const TUTORIAL = [
    ["Köprüüstüne Hoş Geldiniz", "HDG pruva yönü, COG yere göre rota, SOG yere göre sürat ve ROT dönüş oranıdır.", "HDG · COG · SOG · ROT"],
    ["Gemi Özellikleri", "Boy, en, azami sürat, draft ve minimum UKC değerleri manevra davranışını değiştirir.", "L × B · Draft · Vmax"],
    ["UKC ve Squat", "UKC; derinlikten draft ve sürate bağlı squat çıkarılarak hesaplanır. Minimum değerin altı Game Over'dır.", "Derinlik − Draft − Squat"],
    ["Dümen", "İskele ve sancak düğmeleri tek dokunuşta 1° değiştirir; basılı tutulunca devam eder. ORTA dümeni sıfırlar.", "İSKELE · ORTA · SANCAK"],
    ["Makine Telgrafı", "İleri ve tornistan kademeleri hedef sürati belirler. Büyük gemiler daha geç hızlanır ve daha geç durur.", "TORNİSTAN · STOP · İLERİ"],
    ["PRED", "Pembe kesik çizgi 120 saniyelik tahmini izi; gemi gölgeleri gelecekteki konumu gösterir.", "120 saniye tahmin"],
    ["Rüzgâr ve Akıntı", "HDG ile COG arasındaki fark çevresel sürüklenmeyi gösterir.", "Leeway · Set · Drift"],
    ["Görev", "Güvenli derinlikte kalın, trafikten kaçının ve hedef hattına süre dolmadan ulaşın.", "Emniyetli seyir"]
  ];

  let ship = loadShip();
  let physics = derivePhysics(ship);
  let selectedLevel = 1;
  let unlocked = CFG.MASTER_MODE ? 8 : clamp(Number(localStorage.getItem("epUnlockedLevel") || 1), 1, 8);
  let state = null;
  let last = performance.now();
  let rudderTimer = null;
  let tutorialIndex = 0;
  let deferredInstall = null;

  function loadShip() {
    try { return { ...DEFAULT_SHIP, ...JSON.parse(localStorage.getItem("epShipConfig") || "null") }; }
    catch { return { ...DEFAULT_SHIP }; }
  }
  function derivePhysics(s) {
    const slender = s.length / s.beam;
    const cb = clamp(.72 + (6.2 - slender) * .018, .58, .84);
    const displacement = s.length * s.beam * s.draft * cb * 1.025;
    const mass = clamp(displacement / 18000, .2, 8);
    const turnDiameter = s.length * (2.75 + .35 * clamp(slender / 6, .75, 1.4));
    const stoppingDistance = s.length * (3.7 + .55 * Math.sqrt(mass)) * Math.pow(s.maxSpeed / 14, 1.2);
    const accelTau = 20 + s.length * .22 + Math.sqrt(mass) * 9;
    const yawTau = 4 + s.length * .085 + Math.sqrt(mass) * 2.2;
    const maxRot = clamp(1900 / s.length * (.8 + .2 * 24 / s.beam), 3.2, 42);
    const maxSquat = squatFor(s.maxSpeed, s, cb, s.draft + s.minUkc + 4);
    return { cb, displacement, turnDiameter, stoppingDistance, accelTau, yawTau, maxRot, safeDepth: s.draft + s.minUkc + maxSquat };
  }
  function squatFor(speed, s, cb, depth) {
    const ratio = depth / Math.max(s.draft, .1);
    const boost = 1 + clamp((2.5 - ratio) * .45, 0, 1.2);
    return clamp(.0075 * cb * speed * speed * (1 + s.draft / 18) * boost, 0, s.draft * .3);
  }
  function readShip() {
    return {
      length: Number($("shipLengthInput").value), beam: Number($("shipBeamInput").value),
      maxSpeed: Number($("shipSpeedInput").value), draft: Number($("shipDraftInput").value),
      minUkc: Number($("shipUkcInput").value)
    };
  }
  function validateShip(s) {
    const e = [];
    if (s.length < 40 || s.length > 400) e.push("Boy 40–400 m olmalı.");
    if (s.beam < 7 || s.beam > 70) e.push("En 7–70 m olmalı.");
    if (s.beam >= s.length * .45) e.push("En, boya göre çok büyük.");
    if (s.maxSpeed < 4 || s.maxSpeed > 32) e.push("Sürat 4–32 kn olmalı.");
    if (s.draft < 1.5 || s.draft > 20) e.push("Draft 1.5–20 m olmalı.");
    if (s.minUkc < .3 || s.minUkc > 5) e.push("Minimum UKC 0.3–5 m olmalı.");
    return e;
  }
  function writeShip() {
    $("shipLengthInput").value = ship.length; $("shipBeamInput").value = ship.beam;
    $("shipSpeedInput").value = ship.maxSpeed; $("shipDraftInput").value = ship.draft; $("shipUkcInput").value = ship.minUkc;
  }
  function previewShip() {
    const s = readShip(), errors = validateShip(s), p = derivePhysics(s);
    $("displacementPreview").textContent = `${Math.round(p.displacement).toLocaleString("tr-TR")} t`;
    $("turnPreview").textContent = `${Math.round(p.turnDiameter)} m`;
    $("stopPreview").textContent = `${Math.round(p.stoppingDistance)} m`;
    $("safeDepthPreview").textContent = `${p.safeDepth.toFixed(1)} m`;
    $("shipValidation").textContent = errors.length ? errors.join(" ") : "Değerler uygun.";
    $("shipValidation").classList.toggle("ok", !errors.length);
    return !errors.length;
  }
  function acceptShip() {
    const candidate = readShip(), errors = validateShip(candidate);
    if (errors.length) { previewShip(); showToast(errors[0]); return false; }
    ship = candidate; physics = derivePhysics(ship); localStorage.setItem("epShipConfig", JSON.stringify(ship)); return true;
  }

  function channelCenter(y, level, worldW = 1800) {
    return worldW * .5 + Math.sin(y / 620 + level.seed) * (95 + level.id * 7) + Math.sin(y / 260 + level.seed * 2) * 28;
  }
  function depthAt(x, y, level, worldW = 1800) {
    const c = channelCenter(y, level, worldW), lateral = Math.abs(x - c);
    let d = level.depth + 5.4 - Math.max(0, lateral - 58) * (.035 + level.id * .0016);
    d += Math.sin(x / 170 + y / 270 + level.seed) * .65;
    if (level.shoal) {
      const q1 = Math.exp(-(((x - (c + 95)) / 115) ** 2 + ((y - 1750) / 290) ** 2));
      const q2 = Math.exp(-(((x - (c - 110)) / 95) ** 2 + ((y - 930) / 230) ** 2));
      d -= q1 * (3.8 + level.id * .25) + q2 * (3.2 + level.id * .2);
    }
    if (lateral > level.half + 280) d = -2;
    return clamp(d, -2, 28);
  }
  function vector(speed, direction) {
    const a = rad(direction); return { x: Math.sin(a) * kn2ms(speed), y: -Math.cos(a) * kn2ms(speed) };
  }
  function windVector(level) {
    const leeway = level.wind[0] * .04 * (150 / ship.length) * (7.5 / ship.draft) * (ship.beam / 24);
    return vector(leeway, level.wind[1] + 180);
  }
  function currentVector(level) { return vector(level.current[0], level.current[1]); }

  function spawnTraffic(level, worldW, worldH) {
    const list = [];
    for (let i = 0; i < level.traffic; i++) {
      const inbound = i % 2 === 0, y = 650 + i * ((worldH - 1200) / Math.max(level.traffic, 1));
      const c = channelCenter(y, level, worldW), crossing = level.id >= 5 && i === level.traffic - 1;
      list.push({ x: crossing ? c - 430 : c + (inbound ? 65 : -65), y, heading: crossing ? 90 : inbound ? 180 : 0, speed: crossing ? 7 : 6.5 + i % 3, length: 85 + i % 3 * 35, beam: 14 + i % 3 * 4, crossing, name: `T${i + 1}` });
    }
    return list;
  }
  function createState(level) {
    const worldW = 1800, worldH = 3400, y = 2920, x = channelCenter(y, level, worldW), depth = depthAt(x, y, level, worldW);
    return { running: true, paused: false, ended: false, level, worldW, worldH, x, y, cameraX: x, cameraY: y, heading: 0, speed: 0, engine: 0, rudder: 0, rot: 0, cog: 0, sog: 0, depth, squat: 0, ukc: depth - ship.draft, elapsed: 0, goalY: 300, zoom: matchMedia("(orientation:portrait)").matches ? .33 : .43, orientation: "N-UP", prediction: true, trail: [], traffic: spawnTraffic(level, worldW, worldH), closestTraffic: Infinity, minUkcSeen: Infinity, distance: 0 };
  }
  function integrate(s, dt, external = true) {
    const target = s.engine >= 0 ? s.engine * ship.maxSpeed : s.engine * ship.maxSpeed * .45;
    let tau = physics.accelTau;
    if (s.speed > 0 && target < s.speed) tau *= s.engine < 0 ? .48 : .78;
    s.speed += (target - s.speed) * clamp(dt / tau, 0, .3);
    const depth = depthAt(s.x, s.y, s.level, s.worldW);
    const shallow = clamp((depth / ship.draft - 1.03) / 1.35, .28, 1);
    const targetRot = s.rudder / 35 * physics.maxRot * clamp(Math.abs(s.speed) / ship.maxSpeed, 0, 1.25) * shallow * (s.speed >= 0 ? 1 : -.65);
    s.rot += (targetRot - s.rot) * clamp(dt / physics.yawTau, 0, .35);
    s.heading = norm(s.heading + s.rot / 60 * dt);
    const h = rad(s.heading), water = kn2ms(s.speed);
    let vx = Math.sin(h) * water, vy = -Math.cos(h) * water;
    if (external) { const c = currentVector(s.level), w = windVector(s.level); vx += c.x + w.x; vy += c.y + w.y; }
    s.x += vx * dt; s.y += vy * dt; s.sog = Math.hypot(vx, vy) / .514444;
    s.cog = s.sog > .03 ? norm(deg(Math.atan2(vx, -vy))) : s.heading;
    s.depth = depthAt(s.x, s.y, s.level, s.worldW); s.squat = squatFor(Math.abs(s.speed), ship, physics.cb, Math.max(s.depth, .1)); s.ukc = s.depth - ship.draft - s.squat;
  }
  function update(dt) {
    if (!state || !state.running || state.paused || state.ended) return;
    const ox = state.x, oy = state.y; integrate(state, dt, true);
    state.elapsed += dt; state.distance += Math.hypot(state.x - ox, state.y - oy); state.minUkcSeen = Math.min(state.minUkcSeen, state.ukc);
    state.trail.push({ x: state.x, y: state.y }); if (state.trail.length > 900) state.trail.shift();
    state.cameraX += (state.x - state.cameraX) * clamp(dt * 2.5, 0, 1); state.cameraY += (state.y - state.cameraY) * clamp(dt * 2.5, 0, 1);
    for (const t of state.traffic) {
      const a = rad(t.heading); t.x += Math.sin(a) * kn2ms(t.speed) * dt; t.y += -Math.cos(a) * kn2ms(t.speed) * dt;
      if (!t.crossing) t.x += (channelCenter(t.y, state.level, state.worldW) + (t.heading === 180 ? 65 : -65) - t.x) * clamp(dt * .015, 0, .08);
      if (t.y < -200) t.y = state.worldH + 150; if (t.y > state.worldH + 200) t.y = -150; if (t.x > state.worldW + 300) t.x = -250;
      const d = Math.hypot(t.x - state.x, t.y - state.y); state.closestTraffic = Math.min(state.closestTraffic, d);
      if (d < ship.length * .48 + t.length * .5) return finish(false, `${t.name} trafik gemisiyle çatışma oldu.`);
    }
    if (state.depth <= 0 || state.ukc < ship.minUkc) return finish(false, `Kullanılabilir UKC ${state.ukc.toFixed(2)} m oldu. Gerekli minimum ${ship.minUkc.toFixed(1)} m.`);
    if (state.elapsed > state.level.time) return finish(false, "Görev süresi doldu.");
    const goalC = channelCenter(state.goalY, state.level, state.worldW);
    if (state.y <= state.goalY && Math.abs(state.x - goalC) < state.level.half * .72) finish(true, "Hedef geçiş hattına emniyetli şekilde ulaştınız.");
  }

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2), r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr)); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function anchor() {
    const r = canvas.getBoundingClientRect();
    if (!state) return { x: r.width / 2, y: r.height / 2 };
    const portrait = matchMedia("(orientation:portrait)").matches;
    if (!portrait) return { x: r.width / 2, y: r.height * .58 };
    const controlsTop = $("controls").classList.contains("hidden") ? r.height * .82 : $("controls").getBoundingClientRect().top - r.top;
    return { x: r.width / 2, y: clamp(controlsTop - 155, r.height * .46, r.height * .7) };
  }
  function w2s(x, y, s = state) {
    const a = anchor(); let dx = (x - s.cameraX) * s.zoom, dy = (y - s.cameraY) * s.zoom;
    if (s.orientation === "H-UP") { const q = rad(-s.heading), rx = dx * Math.cos(q) - dy * Math.sin(q), ry = dx * Math.sin(q) + dy * Math.cos(q); dx = rx; dy = ry; }
    return { x: a.x + dx, y: a.y + dy };
  }
  function edgeAt(y, threshold, side) {
    const c = channelCenter(y, state.level, state.worldW);
    if (depthAt(c, y, state.level, state.worldW) < threshold) return null;
    let lo = 0, hi = state.level.half + 460;
    for (let i = 0; i < 13; i++) { const mid = (lo + hi) / 2; if (depthAt(c + side * mid, y, state.level, state.worldW) >= threshold) lo = mid; else hi = mid; }
    return c + side * lo;
  }
  function paintBand(minY, maxY, threshold, fill, stroke) {
    const step = 70, start = Math.floor(minY / step) * step, rows = [];
    for (let y = start; y <= maxY + step; y += step) { const l = edgeAt(y, threshold, -1), r = edgeAt(y, threshold, 1); if (l !== null && r !== null) rows.push({ y, l, r }); }
    if (rows.length < 2) return;
    ctx.beginPath(); rows.forEach((q, i) => { const p = w2s(q.l, q.y); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
    for (let i = rows.length - 1; i >= 0; i--) { const q = rows[i], p = w2s(q.r, q.y); ctx.lineTo(p.x, p.y); }
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1.1; ctx.stroke();
  }
  function drawChart(r) {
    const vw = r.width / state.zoom, vh = r.height / state.zoom, minX = state.cameraX - vw / 2 - 300, maxX = state.cameraX + vw / 2 + 300, minY = state.cameraY - vh * .72 - 300, maxY = state.cameraY + vh * .45 + 300;
    ctx.fillStyle = "#b8b184"; ctx.fillRect(0, 0, r.width, r.height);
    const req = ship.draft + ship.minUkc;
    paintBand(minY, maxY, .05, "#68bada", "rgba(27,75,94,.5)");
    paintBand(minY, maxY, req, "#91cfdd", "rgba(45,110,126,.4)");
    paintBand(minY, maxY, Math.max(req + 2, 12), "#c2e1df", "rgba(55,118,119,.32)");
    paintBand(minY, maxY, Math.max(req + 4, 16), "#d9ebe3", "rgba(65,118,111,.26)");
    paintBand(minY, maxY, Math.max(req + 8, 21), "#edf3e9", "rgba(75,119,106,.2)");
    const grid = 240, x0 = Math.floor(minX / grid) * grid, x1 = Math.ceil(maxX / grid) * grid, y0 = Math.floor(minY / grid) * grid, y1 = Math.ceil(maxY / grid) * grid;
    ctx.strokeStyle = "rgba(39,88,92,.16)"; ctx.lineWidth = 1;
    for (let x = x0; x <= x1; x += grid) { const a = w2s(x, y0), b = w2s(x, y1); ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); }
    for (let y = y0; y <= y1; y += grid) { const a = w2s(x0,y), b = w2s(x1,y); ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); }
    ctx.strokeStyle = "rgba(194,89,178,.6)"; ctx.lineWidth = 2; ctx.setLineDash([14,12]); ctx.beginPath();
    let first = true; for (let y = Math.floor(minY / 60) * 60; y <= maxY; y += 60) { const p = w2s(channelCenter(y,state.level,state.worldW),y); first ? (ctx.moveTo(p.x,p.y), first=false) : ctx.lineTo(p.x,p.y); } ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "rgba(42,84,82,.78)"; ctx.font = "11px system-ui"; ctx.textAlign = "center";
    for (let y = Math.floor(minY / 320) * 320; y <= maxY; y += 320) { const c = channelCenter(y,state.level,state.worldW); [-.68,-.25,.25,.68].forEach((f,i) => { const x = c + state.level.half * f + Math.sin(y/210+i)*18, d = depthAt(x,y,state.level,state.worldW), p = w2s(x,y); if (d>0 && p.x>15 && p.x<r.width-15 && p.y>15 && p.y<r.height-15) ctx.fillText(d.toFixed(d<10?1:0),p.x,p.y); }); }
    const buoy = (x,y,side) => { const p=w2s(x,y); if(p.x<-15||p.x>r.width+15||p.y<-15||p.y>r.height+15)return; ctx.save();ctx.translate(p.x,p.y);ctx.beginPath();ctx.moveTo(0,-8);ctx.lineTo(-5,6);ctx.lineTo(5,6);ctx.closePath();ctx.fillStyle=side==="P"?"#e46662":"#49bc78";ctx.fill();ctx.strokeStyle="#183b3d";ctx.stroke();ctx.fillStyle="#244e4f";ctx.font="bold 10px system-ui";ctx.fillText(side,7,4);ctx.restore(); };
    for (let y = Math.floor(minY / 520) * 520; y <= maxY; y += 520) { const c=channelCenter(y,state.level,state.worldW),e=state.level.half*.82; buoy(c-e,y,"P");buoy(c+e,y+240,"S"); }
  }
  function drawGoal() { const c=channelCenter(state.goalY,state.level,state.worldW),a=w2s(c-state.level.half*.72,state.goalY),b=w2s(c+state.level.half*.72,state.goalY),m=w2s(c,state.goalY);ctx.save();ctx.strokeStyle="#36c873";ctx.lineWidth=5;ctx.setLineDash([18,11]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle="rgba(8,55,34,.9)";ctx.font="bold 12px system-ui";ctx.textAlign="center";ctx.fillText("HEDEF GEÇİŞ HATTI",m.x,m.y-12);ctx.restore(); }
  function drawTrail() { if(state.trail.length<2)return;ctx.save();ctx.strokeStyle="rgba(38,91,96,.65)";ctx.lineWidth=2;ctx.beginPath();state.trail.forEach((q,i)=>{const p=w2s(q.x,q.y);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)});ctx.stroke();ctx.restore(); }
  function drawShip(x,y,heading,alpha=1,ghost=false) { const p=w2s(x,y),len=clamp(ship.length*state.zoom,31,76),beam=clamp(ship.beam*state.zoom,10,26),display=state.orientation==="H-UP"?0:heading;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(rad(display));ctx.globalAlpha=alpha;ctx.fillStyle=ghost?"#70df91":"#42ee78";ctx.strokeStyle=ghost?"#267547":"#052d1c";ctx.lineWidth=ghost?1.5:3;ctx.shadowColor=ghost?"transparent":"rgba(0,0,0,.5)";ctx.shadowBlur=ghost?0:5;ctx.beginPath();ctx.moveTo(0,-len/2);ctx.lineTo(beam/2,-len*.27);ctx.lineTo(beam/2,len/2);ctx.lineTo(-beam/2,len/2);ctx.lineTo(-beam/2,-len*.27);ctx.closePath();ctx.fill();ctx.stroke();if(!ghost){ctx.shadowBlur=0;ctx.fillStyle="#f3fff5";ctx.fillRect(-beam*.32,-len*.08,beam*.64,len*.24);ctx.fillStyle="#092d1d";ctx.beginPath();ctx.arc(0,0,3.3,0,Math.PI*2);ctx.fill();}ctx.restore(); }
  function drawTraffic(t) { const p=w2s(t.x,t.y),len=clamp(t.length*state.zoom,20,55),beam=clamp(t.beam*state.zoom,7,18),display=state.orientation==="H-UP"?norm(t.heading-state.heading):t.heading;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(rad(display));ctx.fillStyle="#f0b65d";ctx.strokeStyle="#714e20";ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(0,-len/2);ctx.lineTo(beam/2,-len*.25);ctx.lineTo(beam/2,len/2);ctx.lineTo(-beam/2,len/2);ctx.lineTo(-beam/2,-len*.25);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore(); }
  function prediction() { const s={...state,trail:[],traffic:[]},pts=[{x:s.x,y:s.y,heading:s.heading,t:0}];for(let t=3;t<=120;t+=3){integrate(s,3,true);pts.push({x:s.x,y:s.y,heading:s.heading,t});if(s.depth<=0||s.ukc<ship.minUkc)break;}return pts; }
  function drawPrediction() {
    const pts=prediction(),screen=pts.map(q=>({...q,p:w2s(q.x,q.y)}));
    let span=0;for(let i=1;i<screen.length;i++)span+=Math.hypot(screen[i].p.x-screen[i-1].p.x,screen[i].p.y-screen[i-1].p.y);
    ctx.save();ctx.strokeStyle="rgba(217,92,190,.96)";ctx.lineWidth=3.2;ctx.setLineDash([13,9]);ctx.beginPath();
    if(span<8){const p=w2s(state.x,state.y),h=rad(state.orientation==="H-UP"?0:state.heading);ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+Math.sin(h)*70,p.y-Math.cos(h)*70);}
    else screen.forEach((q,i)=>i?ctx.lineTo(q.p.x,q.p.y):ctx.moveTo(q.p.x,q.p.y));ctx.stroke();ctx.setLineDash([]);
    if(span>=8)pts.filter(q=>q.t>0&&q.t%15===0).forEach(q=>drawShip(q.x,q.y,q.heading,.25,true));
    ctx.restore();
  }
  function drawEnvironment(r) { const portrait=matchMedia("(orientation:portrait)").matches,x=52,y=portrait?190:r.height-112;ctx.save();ctx.globalAlpha=.9;ctx.fillStyle="rgba(5,31,36,.84)";ctx.beginPath();ctx.arc(x,y,36,0,Math.PI*2);ctx.fill();const arrow=(d,c,l)=>{const a=rad(d);ctx.strokeStyle=c;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.sin(a)*l,y-Math.cos(a)*l);ctx.stroke();};if(state.level.wind[0])arrow(state.level.wind[1]+180,"#ffd25d",29);if(state.level.current[0])arrow(state.level.current[1],"#62d4ed",25);ctx.fillStyle="#dce8e5";ctx.font="bold 9px system-ui";ctx.textAlign="center";ctx.fillText(`RÜZGÂR ${state.level.wind[0]}`,x,y-7);ctx.fillText(`AKINTI ${state.level.current[0]}`,x,y+12);ctx.restore(); }
  function drawScale(r) { const px=500*state.zoom,y=r.height-15,x=r.width/2-px/2;ctx.save();ctx.strokeStyle="rgba(19,68,72,.75)";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+px,y);ctx.stroke();ctx.fillStyle="rgba(19,68,72,.85)";ctx.font="bold 10px system-ui";ctx.textAlign="center";ctx.fillText("500 m",r.width/2,y-5);ctx.restore(); }
  function drawMenu() { const r=canvas.getBoundingClientRect(),g=ctx.createLinearGradient(0,0,0,r.height);g.addColorStop(0,"#173b43");g.addColorStop(1,"#06161b");ctx.fillStyle=g;ctx.fillRect(0,0,r.width,r.height);ctx.strokeStyle="rgba(121,232,223,.08)";for(let x=0;x<r.width;x+=58){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,r.height);ctx.stroke();}for(let y=0;y<r.height;y+=58){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(r.width,y);ctx.stroke();} }
  function draw() { const r=canvas.getBoundingClientRect();ctx.clearRect(0,0,r.width,r.height);if(!state||$("startScreen").classList.contains("visible")){drawMenu();return;}drawChart(r);drawGoal();drawTrail();state.traffic.forEach(drawTraffic);if(state.prediction)drawPrediction();drawShip(state.x,state.y,state.heading,1,false);drawEnvironment(r);drawScale(r); }

  function updateLabels() {
    if(!state)return;const f=(v)=>`${norm(v).toFixed(1).padStart(5,"0")}°`;
    $("hdgValue").textContent=f(state.heading);$("cogValue").textContent=f(state.cog);$("sogValue").textContent=`${state.sog.toFixed(1)} kn`;$("rotValue").textContent=`${state.rot.toFixed(1)}°/dk`;$("depthValue").textContent=`${state.depth.toFixed(1)} m`;$("ukcValue").textContent=`${state.ukc.toFixed(2)} m`;$("ukcValue").className=state.ukc<ship.minUkc+.6?"danger":"safe";$("levelLabel").textContent=`${state.level.id} · ${state.level.name}`;$("windLabel").textContent=state.level.wind[0]?`${state.level.wind[0]} kn / ${state.level.wind[1]}°`:"Sakin";$("currentLabel").textContent=state.level.current[0]?`${state.level.current[0]} kn / ${state.level.current[1]}°`:"Yok";$("goalLabel").textContent=`${Math.max(0,Math.round(state.y-state.goalY))} m`;
  }
  function rudderText(v){return v<0?`İSKELE ${Math.abs(v)}°`:v>0?`SANCAK ${v}°`:"ORTA 0°";}
  function setRudder(v){if(!state)return;state.rudder=clamp(Math.round(v),-35,35);$("rudderSlider").value=state.rudder;$("rudderLabel").textContent=rudderText(state.rudder);$("rudderCommandReadout").textContent=rudderText(state.rudder);$("midshipsButton").classList.toggle("active",state.rudder===0);}
  function setEngine(v){if(!state)return;state.engine=Number(v);document.querySelectorAll("[data-engine]").forEach(b=>b.classList.toggle("active",Number(b.dataset.engine)===state.engine));const n=ENGINE_NAMES.get(state.engine)||"STOP";$("engineLabel").textContent=n;$("engineCommandReadout").textContent=n;}
  function finish(success,message){if(!state||state.ended)return;state.ended=true;state.running=false;setEngine(0);if(success&&!CFG.MASTER_MODE&&selectedLevel===unlocked&&unlocked<8){unlocked++;localStorage.setItem("epUnlockedLevel",String(unlocked));}$("resultEyebrow").textContent=success?"GÖREV TAMAMLANDI":"MANEVRA SONUCU";$("resultTitle").textContent=success?"Başarılı Manevra":"Game Over";$("resultTitle").className=success?"safe":"danger";$("resultMessage").textContent=message;$("resultStats").innerHTML=`<div><span>Süre</span><b>${Math.floor(state.elapsed/60)}:${String(Math.floor(state.elapsed%60)).padStart(2,"0")}</b></div><div><span>Mesafe</span><b>${Math.round(state.distance)} m</b></div><div><span>En düşük UKC</span><b>${Number.isFinite(state.minUkcSeen)?state.minUkcSeen.toFixed(2):"--"} m</b></div><div><span>En yakın trafik</span><b>${Number.isFinite(state.closestTraffic)?Math.round(state.closestTraffic):"--"} m</b></div>`;$("nextLevelButton").classList.toggle("hidden",!success||selectedLevel>=8);$("messageModal").classList.remove("hidden");$("messageModal").classList.add("visible");}
  function startLevel(id=selectedLevel){if(!acceptShip())return;selectedLevel=clamp(id,1,8);state=createState(LEVELS[selectedLevel-1]);$("startScreen").classList.remove("visible");$("startScreen").classList.add("hidden");$("tutorialOverlay").classList.add("hidden");["topHud","statusStrip","chartTools","controls","gameBrand"].forEach(id2=>$(id2).classList.remove("hidden"));setRudder(0);setEngine(0);updateLabels();last=performance.now();}
  function menu(){if(state)state.running=false;["topHud","statusStrip","chartTools","controls","gameBrand"].forEach(id=>$(id).classList.add("hidden"));$("messageModal").classList.add("hidden");$("messageModal").classList.remove("visible");$("startScreen").classList.remove("hidden");$("startScreen").classList.add("visible");renderLevels();}
  function renderLevels(){const grid=$("levelGrid");grid.innerHTML="";const t=document.createElement("button");t.className="level-card tutorial-card";t.innerHTML="<strong>Tanıtım</strong><span>Kumandaları adım adım öğren</span>";t.addEventListener("click",()=>showTutorial(0));grid.appendChild(t);LEVELS.forEach(l=>{const b=document.createElement("button"),locked=!CFG.MASTER_MODE&&l.id>unlocked;b.className=`level-card${selectedLevel===l.id?" selected":""}${locked?" locked":""}`;b.disabled=locked;b.innerHTML=`<strong>${l.id}. ${l.name}</strong><span>${l.desc}</span>`;b.addEventListener("click",()=>{selectedLevel=l.id;renderLevels();$("startButton").textContent=`LEVEL ${l.id}'E BAŞLA`;});grid.appendChild(b);});$("progressText").textContent=CFG.MASTER_MODE?"MASTER · Tüm leveller açık":`Level ${unlocked} açık`;$("masterBadge").classList.toggle("hidden",!CFG.MASTER_MODE);}
  function showTutorial(i=0){tutorialIndex=clamp(i,0,TUTORIAL.length-1);const s=TUTORIAL[tutorialIndex];$("tutorialStepLabel").textContent=`${tutorialIndex+1} / ${TUTORIAL.length}`;$("tutorialProgressBar").style.width=`${(tutorialIndex+1)/TUTORIAL.length*100}%`;$("tutorialTitle").textContent=s[0];$("tutorialText").textContent=s[1];$("tutorialVisual").innerHTML=`<div class="tutorial-demo"><div><b>${tutorialIndex+1}</b><span>${s[2]}</span></div></div>`;$("tutorialBackButton").disabled=tutorialIndex===0;$("tutorialNextButton").textContent=tutorialIndex===TUTORIAL.length-1?"LEVEL 1'E BAŞLA":"İLERİ";$("tutorialOverlay").classList.remove("hidden");$("tutorialOverlay").classList.add("visible");}
  function closeTutorial(){$("tutorialOverlay").classList.add("hidden");$("tutorialOverlay").classList.remove("visible");}
  function showToast(text){const t=$("toast");t.textContent=text;t.classList.add("show");clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>t.classList.remove("show"),2200);}
  function beginHold(step){if(!state)return;setRudder(state.rudder+step);clearTimeout(rudderTimer);rudderTimer=setTimeout(()=>{rudderTimer=setInterval(()=>setRudder(state.rudder+step),120);},320);}
  function endHold(){clearTimeout(rudderTimer);clearInterval(rudderTimer);rudderTimer=null;}

  function bind(){
    ["shipLengthInput","shipBeamInput","shipSpeedInput","shipDraftInput","shipUkcInput"].forEach(id=>$(id).addEventListener("input",previewShip));
    $("resetShipButton").addEventListener("click",()=>{ship={...DEFAULT_SHIP};writeShip();previewShip();});$("ukcInfoButton").addEventListener("click",()=>$("ukcHelp").classList.toggle("hidden"));
    $("startButton").addEventListener("click",()=>startLevel(selectedLevel));$("tutorialButton").addEventListener("click",()=>showTutorial(0));$("tutorialBackButton").addEventListener("click",()=>showTutorial(tutorialIndex-1));$("tutorialSkipButton").addEventListener("click",closeTutorial);$("tutorialNextButton").addEventListener("click",()=>{if(tutorialIndex===TUTORIAL.length-1){closeTutorial();selectedLevel=1;startLevel(1);}else showTutorial(tutorialIndex+1);});
    [["portRudderButton",-1],["starboardRudderButton",1]].forEach(([id,step])=>{const b=$(id);b.addEventListener("pointerdown",e=>{e.preventDefault();b.setPointerCapture?.(e.pointerId);beginHold(step);});["pointerup","pointercancel","pointerleave","lostpointercapture"].forEach(ev=>b.addEventListener(ev,endHold));});
    $("midshipsButton").addEventListener("click",()=>setRudder(0));$("rudderSlider").addEventListener("input",e=>setRudder(Number(e.target.value)));document.querySelectorAll("[data-engine]").forEach(b=>b.addEventListener("click",()=>setEngine(Number(b.dataset.engine))));
    $("zoomIn").addEventListener("click",()=>{if(state)state.zoom=clamp(state.zoom*1.18,.2,1.2)});$("zoomOut").addEventListener("click",()=>{if(state)state.zoom=clamp(state.zoom/1.18,.2,1.2)});$("centerShip").addEventListener("click",()=>{if(state){state.cameraX=state.x;state.cameraY=state.y;}});$("orientationToggle").addEventListener("click",()=>{if(!state)return;state.orientation=state.orientation==="N-UP"?"H-UP":"N-UP";$("orientationToggle").textContent=state.orientation;});$("predictionToggle").addEventListener("click",()=>{if(!state)return;state.prediction=!state.prediction;$("predictionToggle").classList.toggle("active",state.prediction);});$("pauseButton").addEventListener("click",()=>{if(!state)return;state.paused=!state.paused;$("pauseButton").textContent=state.paused?"▶":"Ⅱ";});
    $("gameMenuButton").addEventListener("click",menu);$("menuButton").addEventListener("click",menu);$("restartButton").addEventListener("click",()=>startLevel(selectedLevel));$("nextLevelButton").addEventListener("click",()=>startLevel(Math.min(8,selectedLevel+1)));
    window.addEventListener("resize",()=>{resize();if(state){state.cameraX=state.x;state.cameraY=state.y;}});window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;$("installButton").classList.remove("hidden");});$("installButton").addEventListener("click",async()=>{if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;}});
  }
  function loop(now){const dt=clamp((now-last)/1000,0,.06);last=now;update(dt);updateLabels();draw();requestAnimationFrame(loop);}
  function init(){writeShip();previewShip();renderLevels();bind();resize();if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});requestAnimationFrame(loop);}
  init();
})();
