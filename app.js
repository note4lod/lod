(() => {
  "use strict";

  const CFG = window.EP_CONFIG || { MASTER_MODE: false, VERSION: "1.6.0", CACHE_NAME: "ep-maneuver-v1.6" };
  const $ = (id) => document.getElementById(id);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const degToRad = (d) => d * Math.PI / 180;
  const radToDeg = (r) => r * 180 / Math.PI;
  const normDeg = (d) => (d % 360 + 360) % 360;
  const knToMps = (kn) => kn * 0.514444;
  const formatDeg = (v) => `${normDeg(v).toFixed(1).padStart(5, "0")}°`;

  const ENGINE_NAMES = new Map([
    [-1, "TAM TORNİSTAN"], [-0.55, "YARIM TORNİSTAN"], [-0.25, "PEK AĞIR TORNİSTAN"],
    [0, "STOP"], [0.22, "PEK AĞIR İLERİ"], [0.45, "AĞIR İLERİ"], [0.7, "YARIM İLERİ"], [1, "TAM İLERİ"]
  ]);

  const LEVELS = [
    { id: 1, name: "Temel Kumanda", desc: "Sakin hava, geniş kanal", baseDepth: 18, channelHalf: 300, wind: [0, 0], current: [0, 0], traffic: 0, time: 420, seed: 0.3 },
    { id: 2, name: "Enine Akıntı", desc: "1.4 kn sancaktan iskeleye", baseDepth: 18, channelHalf: 270, wind: [0, 0], current: [1.4, 270], traffic: 0, time: 420, seed: 0.8 },
    { id: 3, name: "Kuvvetli Rüzgâr", desc: "22 kn batı rüzgârı", baseDepth: 18, channelHalf: 250, wind: [22, 270], current: [0.5, 20], traffic: 1, time: 400, seed: 1.2 },
    { id: 4, name: "Sığ Su", desc: "Squat ve düşük UKC", baseDepth: 12.6, channelHalf: 235, wind: [8, 160], current: [0.8, 95], traffic: 1, time: 390, seed: 1.7, shoals: true },
    { id: 5, name: "Yoğun Trafik", desc: "Karşı ve kesişen gemiler", baseDepth: 18, channelHalf: 240, wind: [10, 220], current: [0.7, 40], traffic: 4, time: 380, seed: 2.1 },
    { id: 6, name: "Dar Kanal", desc: "Sınırlı dönüş alanı", baseDepth: 15, channelHalf: 170, wind: [16, 310], current: [1.2, 120], traffic: 3, time: 370, seed: 2.8, shoals: true },
    { id: 7, name: "Birleşik Etkiler", desc: "Rüzgâr, akıntı, trafik ve sığlık", baseDepth: 13.5, channelHalf: 185, wind: [26, 250], current: [1.8, 80], traffic: 5, time: 360, seed: 3.4, shoals: true },
    { id: 8, name: "Kaptan Seviyesi", desc: "Fırtına ve kritik geçiş", baseDepth: 12.2, channelHalf: 155, wind: [34, 300], current: [2.5, 110], traffic: 6, time: 340, seed: 4.1, shoals: true }
  ];

  const DEFAULT_SHIP = Object.freeze({ length: 150, beam: 24, maxSpeed: 14, draft: 7.5, minUkc: 1.0 });
  const TUTORIAL = [
    ["Köprüüstüne Hoş Geldiniz", "Bu tanıtım kumandaları ve göstergeleri sırayla açıklar.", "HDG geminin pruva yönüdür. COG, rüzgâr ve akıntı sonrasında yere göre izlenen rotadır. SOG yere göre sürattir."],
    ["Gemi Özellikleri", "Ana menüden boy, en, azami sürat, draft ve minimum UKC değiştirilebilir.", "Büyük ve ağır gemi daha yavaş hızlanır, daha geç durur ve daha geniş dönüş dairesine ihtiyaç duyar."],
    ["UKC ve Squat", "UKC, omurga ile deniz tabanı arasındaki emniyet mesafesidir.", "Kullanılabilir UKC = Derinlik − Draft − Squat. Sürat arttıkça squat yükselir."],
    ["Üst Göstergeler", "HDG, COG, SOG, ROT, derinlik ve UKC anlık olarak gösterilir.", "ROT dakikadaki dönüş oranıdır. UKC kırmızıya dönerse sığ su tehlikesi vardır."],
    ["Dümen Kumandası", "İSKELE veya SANCAK düğmesine dokununca dümen 1° değişir.", "Düğmeye basılı tuttukça 1°'er devam eder. ORTA dümeni doğrudan 0° yapar."],
    ["Makine Telgrafı", "İleri kademeleri hedef sürati artırır; tornistan kademeleri yavaşlatır ve geri yol verir.", "Gemi ölçüleri büyüdükçe komut ile gerçek sürat değişimi arasındaki gecikme artar."],
    ["PRED Manevra Tahmini", "Pembe kesik çizgi 120 saniyelik tahmini izi gösterir.", "Oklar ve yarı saydam gemi gölgeleri gelecekteki dönüş yönünü ve konumları gösterir."],
    ["Göreve Hazırsınız", "Emniyetli derinlikte kalın, trafik gemilerinden uzak durun ve hedef hattına ulaşın.", "Şimdi Level 1'e başlayabilirsiniz."]
  ];

  let ship = loadShip();
  let physics = deriveShipPhysics(ship);
  let selectedLevel = 1;
  let unlockedLevel = CFG.MASTER_MODE ? LEVELS.length : clamp(Number(localStorage.getItem("epUnlockedLevel") || 1), 1, LEVELS.length);
  let state = null;
  let tutorialIndex = 0;
  let rudderTimer = null;
  let deferredInstallPrompt = null;
  let lastFrame = performance.now();
  let lastDraw = 0;

  const canvas = $("chartCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });

  function loadShip() {
    try {
      const saved = JSON.parse(localStorage.getItem("epShipConfig") || "null");
      return saved ? { ...DEFAULT_SHIP, ...saved } : { ...DEFAULT_SHIP };
    } catch { return { ...DEFAULT_SHIP }; }
  }

  function saveShip() { localStorage.setItem("epShipConfig", JSON.stringify(ship)); }

  function squatFor(speedKn, s, cb, depth) {
    const ratio = depth / Math.max(s.draft, 0.1);
    const shallowBoost = 1 + clamp((2.5 - ratio) * 0.45, 0, 1.25);
    return clamp(0.0075 * cb * speedKn * speedKn * (1 + s.draft / 18) * shallowBoost, 0, s.draft * 0.3);
  }

  function deriveShipPhysics(s) {
    const slenderness = s.length / s.beam;
    const cb = clamp(0.72 + (6.2 - slenderness) * 0.018, 0.58, 0.84);
    const displacement = s.length * s.beam * s.draft * cb * 1.025;
    const massFactor = clamp(displacement / 18000, 0.2, 8);
    const turnDiameter = s.length * (2.75 + 0.35 * clamp(slenderness / 6, 0.75, 1.4)) * Math.pow(14 / s.maxSpeed, 0.1);
    const stoppingDistance = s.length * (3.7 + 0.55 * Math.sqrt(massFactor)) * Math.pow(s.maxSpeed / 14, 1.2);
    const maxSquat = squatFor(s.maxSpeed, s, cb, s.draft + s.minUkc + 4);
    const safeDepth = s.draft + s.minUkc + maxSquat;
    const accelTau = 20 + s.length * 0.22 + Math.sqrt(massFactor) * 9;
    const yawTau = 4 + s.length * 0.085 + Math.sqrt(massFactor) * 2.2;
    const maxRot = clamp(1900 / s.length * (0.8 + 0.2 * 24 / s.beam), 3.2, 42);
    return { cb, displacement, turnDiameter, stoppingDistance, maxSquat, safeDepth, accelTau, yawTau, maxRot };
  }

  function validateShip(s) {
    const errors = [];
    if (s.length < 40 || s.length > 400) errors.push("Gemi boyu 40–400 m olmalı.");
    if (s.beam < 7 || s.beam > 70) errors.push("Gemi eni 7–70 m olmalı.");
    if (s.beam >= s.length * 0.45) errors.push("Gemi eni boya göre çok büyük.");
    if (s.maxSpeed < 4 || s.maxSpeed > 32) errors.push("Azami sürat 4–32 kn olmalı.");
    if (s.draft < 1.5 || s.draft > 20) errors.push("Draft 1.5–20 m olmalı.");
    if (s.minUkc < 0.3 || s.minUkc > 5) errors.push("Minimum UKC 0.3–5 m olmalı.");
    return errors;
  }

  function readShipInputs() {
    return {
      length: Number($("shipLengthInput").value), beam: Number($("shipBeamInput").value),
      maxSpeed: Number($("shipSpeedInput").value), draft: Number($("shipDraftInput").value),
      minUkc: Number($("shipUkcInput").value)
    };
  }

  function writeShipInputs() {
    $("shipLengthInput").value = ship.length;
    $("shipBeamInput").value = ship.beam;
    $("shipSpeedInput").value = ship.maxSpeed;
    $("shipDraftInput").value = ship.draft;
    $("shipUkcInput").value = ship.minUkc;
  }

  function refreshShipPreview() {
    const candidate = readShipInputs();
    const errors = validateShip(candidate);
    const p = deriveShipPhysics(candidate);
    $("displacementPreview").textContent = `${Math.round(p.displacement).toLocaleString("tr-TR")} t`;
    $("turnPreview").textContent = `${Math.round(p.turnDiameter)} m`;
    $("stopPreview").textContent = `${Math.round(p.stoppingDistance)} m`;
    $("safeDepthPreview").textContent = `${p.safeDepth.toFixed(1)} m`;
    $("shipValidation").textContent = errors[0] || "Değerler uygun. Simülasyon fiziği otomatik hesaplanacak.";
    $("shipValidation").classList.toggle("ok", errors.length === 0);
    return errors.length === 0;
  }

  function acceptShipInputs() {
    const candidate = readShipInputs();
    const errors = validateShip(candidate);
    if (errors.length) { showToast(errors[0]); return false; }
    ship = candidate;
    physics = deriveShipPhysics(ship);
    saveShip();
    return true;
  }

  function renderLevels() {
    const grid = $("levelGrid");
    grid.innerHTML = "";
    LEVELS.forEach((level) => {
      const open = CFG.MASTER_MODE || level.id <= unlockedLevel;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `level-card${selectedLevel === level.id ? " selected" : ""}${open ? "" : " locked"}`;
      button.innerHTML = `<strong>${level.id}. ${level.name}</strong><span>${level.desc}</span>`;
      button.disabled = !open;
      button.addEventListener("click", () => {
        selectedLevel = level.id;
        renderLevels();
        $("startButton").textContent = `LEVEL ${level.id}'E BAŞLA`;
      });
      grid.appendChild(button);
    });
    $("masterBadge").classList.toggle("hidden", !CFG.MASTER_MODE);
    $("progressText").textContent = CFG.MASTER_MODE ? "Tüm leveller açık" : `Level ${unlockedLevel} açık`;
  }

  function channelCenterAt(y, level, worldW = 1800) {
    return worldW * 0.5 + Math.sin(y / 620 + level.seed) * (95 + level.id * 7) + Math.sin(y / 260 + level.seed * 2) * 28;
  }

  function depthAt(x, y, level, worldW = 1800) {
    const center = channelCenterAt(y, level, worldW);
    const lateral = Math.abs(x - center);
    let depth = level.baseDepth + 5.4 - Math.max(0, lateral - 58) * (0.035 + level.id * 0.0016);
    depth += Math.sin(x / 170 + y / 270 + level.seed) * 0.65;
    if (level.shoals) {
      const s1 = Math.exp(-(((x - (center + 95)) / 115) ** 2 + ((y - 1750) / 290) ** 2));
      const s2 = Math.exp(-(((x - (center - 110)) / 95) ** 2 + ((y - 930) / 230) ** 2));
      depth -= s1 * (3.8 + level.id * 0.25) + s2 * (3.2 + level.id * 0.2);
    }
    if (lateral > level.channelHalf + 260) depth = -2;
    return clamp(depth, -2, 28);
  }

  function spawnTraffic(level, worldW, worldH) {
    const ships = [];
    for (let i = 0; i < level.traffic; i += 1) {
      const inbound = i % 2 === 0;
      const y = 650 + i * ((worldH - 1200) / Math.max(level.traffic, 1));
      const center = channelCenterAt(y, level, worldW);
      const crossing = level.id >= 5 && i === level.traffic - 1;
      ships.push({
        x: crossing ? center - 430 : center + (inbound ? 65 : -65), y,
        heading: crossing ? 90 : inbound ? 180 : 0, speed: crossing ? 7 : 6.5 + (i % 3),
        length: 85 + (i % 3) * 35, beam: 14 + (i % 3) * 4, name: `T${i + 1}`, crossing
      });
    }
    return ships;
  }

  function currentVector(level) {
    const [speed, toDeg] = level.current;
    const r = degToRad(toDeg);
    return { x: Math.sin(r) * knToMps(speed), y: -Math.cos(r) * knToMps(speed) };
  }

  function windVector(level) {
    const [speed, fromDeg] = level.wind;
    const toDeg = fromDeg + 180;
    const leewayKn = speed * 0.04 * (150 / ship.length) * (7.5 / ship.draft) * (ship.beam / 24);
    const r = degToRad(toDeg);
    return { x: Math.sin(r) * knToMps(leewayKn), y: -Math.cos(r) * knToMps(leewayKn) };
  }

  function createState(level) {
    const worldW = 1800, worldH = 3400, startY = 2920;
    const x = channelCenterAt(startY, level, worldW);
    const depth = depthAt(x, startY, level, worldW);
    return {
      running: true, paused: false, ended: false, level, worldW, worldH, x, y: startY,
      heading: 0, speed: 0, engine: 0, rudder: 0, rot: 0, cog: 0, sog: 0,
      depth, squat: 0, ukc: depth - ship.draft, elapsed: 0, goalY: 300,
      zoom: matchMedia("(orientation: portrait)").matches ? 0.29 : 0.42,
      cameraX: x, cameraY: startY - 350, orientation: "N-UP", prediction: true,
      trail: [], traffic: spawnTraffic(level, worldW, worldH), minUkcSeen: Infinity,
      closestTraffic: Infinity, distanceTravelled: 0
    };
  }

  function startLevel(id = selectedLevel) {
    if (!acceptShipInputs()) return;
    selectedLevel = clamp(id, 1, LEVELS.length);
    state = createState(LEVELS[selectedLevel - 1]);
    $("startScreen").classList.remove("visible");
    $("startScreen").classList.add("hidden");
    $("tutorialOverlay").classList.add("hidden");
    ["topHud", "statusStrip", "chartTools", "controls", "gameBrand"].forEach((id2) => $(id2).classList.remove("hidden"));
    setRudder(0); setEngine(0); updateLabels();
    lastFrame = performance.now();
  }

  function returnToMenu() {
    if (state) state.running = false;
    ["topHud", "statusStrip", "chartTools", "controls", "gameBrand"].forEach((id) => $(id).classList.add("hidden"));
    $("messageModal").classList.add("hidden");
    $("messageModal").classList.remove("visible");
    $("startScreen").classList.remove("hidden");
    $("startScreen").classList.add("visible");
    renderLevels();
  }

  function integrate(s, dt, external = true) {
    const depth = depthAt(s.x, s.y, s.level, s.worldW);
    const targetSpeed = s.engine >= 0 ? s.engine * ship.maxSpeed : s.engine * ship.maxSpeed * 0.45;
    let tau = physics.accelTau;
    if (s.speed > 0 && targetSpeed < s.speed) tau *= s.engine < 0 ? 0.48 : 0.78;
    if (s.speed < 0 && targetSpeed > s.speed) tau *= 0.58;
    s.speed += (targetSpeed - s.speed) * clamp(dt / tau, 0, 0.3);
    const ratio = depth / Math.max(ship.draft, 0.1);
    const shallowTurn = clamp((ratio - 1.03) / 1.35, 0.28, 1);
    const speedEffect = clamp(Math.abs(s.speed) / ship.maxSpeed, 0, 1.25);
    const targetRot = (s.rudder / 35) * physics.maxRot * speedEffect * shallowTurn * (s.speed >= 0 ? 1 : -0.65);
    s.rot += (targetRot - s.rot) * clamp(dt / physics.yawTau, 0, 0.35);
    s.heading = normDeg(s.heading + s.rot / 60 * dt);
    const h = degToRad(s.heading);
    let vx = Math.sin(h) * knToMps(s.speed);
    let vy = -Math.cos(h) * knToMps(s.speed);
    if (external) {
      const c = currentVector(s.level), w = windVector(s.level);
      vx += c.x + w.x; vy += c.y + w.y;
    }
    s.x += vx * dt; s.y += vy * dt;
    s.sog = Math.hypot(vx, vy) / 0.514444;
    s.cog = s.sog > 0.03 ? normDeg(radToDeg(Math.atan2(vx, -vy))) : s.heading;
    s.depth = depthAt(s.x, s.y, s.level, s.worldW);
    s.squat = squatFor(Math.abs(s.speed), ship, physics.cb, Math.max(s.depth, 0.1));
    s.ukc = s.depth - ship.draft - s.squat;
  }

  function updateTraffic(dt) {
    for (const t of state.traffic) {
      const r = degToRad(t.heading);
      t.x += Math.sin(r) * knToMps(t.speed) * dt;
      t.y += -Math.cos(r) * knToMps(t.speed) * dt;
      if (!t.crossing) {
        const desired = channelCenterAt(t.y, state.level, state.worldW) + (t.heading === 180 ? 65 : -65);
        t.x += (desired - t.x) * clamp(dt * 0.015, 0, 0.08);
      }
      if (t.y < -200) t.y = state.worldH + 150;
      if (t.y > state.worldH + 200) t.y = -150;
      if (t.x > state.worldW + 300) t.x = -250;
      const d = Math.hypot(t.x - state.x, t.y - state.y);
      state.closestTraffic = Math.min(state.closestTraffic, d);
      if (d < ship.length * 0.48 + t.length * 0.5) { finishLevel(false, `${t.name} trafik gemisiyle çatışma oldu.`); return; }
    }
  }

  function updateSimulation(dt) {
    if (!state || !state.running || state.paused || state.ended) return;
    const bx = state.x, by = state.y;
    integrate(state, dt, true);
    state.elapsed += dt;
    state.distanceTravelled += Math.hypot(state.x - bx, state.y - by);
    state.minUkcSeen = Math.min(state.minUkcSeen, state.ukc);
    state.trail.push({ x: state.x, y: state.y });
    if (state.trail.length > 900) state.trail.shift();
    updateTraffic(dt);
    state.cameraX += (state.x - state.cameraX) * clamp(dt * 1.7, 0, 1);
    state.cameraY += ((state.y - 300 / state.zoom) - state.cameraY) * clamp(dt * 1.7, 0, 1);
    if (state.depth <= 0 || state.ukc < ship.minUkc) { finishLevel(false, `Kullanılabilir UKC ${state.ukc.toFixed(2)} m oldu. Gerekli minimum ${ship.minUkc.toFixed(1)} m.`); return; }
    if (state.x < 0 || state.x > state.worldW || state.y < -120 || state.y > state.worldH + 100) { finishLevel(false, "Emniyetli seyir alanının dışına çıktınız."); return; }
    if (state.elapsed > state.level.time) { finishLevel(false, "Görev süresi doldu."); return; }
    const goalCenter = channelCenterAt(state.goalY, state.level, state.worldW);
    if (state.y <= state.goalY && Math.abs(state.x - goalCenter) < state.level.channelHalf * 0.72) finishLevel(true, "Hedef geçiş hattına emniyetli şekilde ulaştınız.");
  }

  function finishLevel(success, message) {
    if (!state || state.ended) return;
    state.ended = true; state.running = false; setEngine(0);
    if (success && !CFG.MASTER_MODE && selectedLevel === unlockedLevel && unlockedLevel < LEVELS.length) {
      unlockedLevel += 1; localStorage.setItem("epUnlockedLevel", String(unlockedLevel));
    }
    $("resultEyebrow").textContent = success ? "GÖREV TAMAMLANDI" : "MANEVRA SONUCU";
    $("resultTitle").textContent = success ? "Başarılı Manevra" : "Game Over";
    $("resultTitle").className = success ? "safe" : "danger";
    $("resultMessage").textContent = message;
    $("resultStats").innerHTML = `<div><span>Süre</span><b>${formatTime(state.elapsed)}</b></div><div><span>Mesafe</span><b>${Math.round(state.distanceTravelled)} m</b></div><div><span>En düşük UKC</span><b>${Number.isFinite(state.minUkcSeen) ? state.minUkcSeen.toFixed(2) : "--"} m</b></div><div><span>En yakın trafik</span><b>${Number.isFinite(state.closestTraffic) ? Math.round(state.closestTraffic) : "--"} m</b></div>`;
    $("nextLevelButton").classList.toggle("hidden", !success || selectedLevel >= LEVELS.length);
    $("messageModal").classList.remove("hidden"); $("messageModal").classList.add("visible");
  }

  function setRudder(value) {
    if (!state) return;
    state.rudder = clamp(Math.round(value), -35, 35);
    $("rudderSlider").value = state.rudder;
    $("rudderLabel").textContent = rudderText(state.rudder);
    $("rudderCommandReadout").textContent = rudderText(state.rudder);
    $("midshipsButton").classList.toggle("active", state.rudder === 0);
  }

  function rudderText(v) { return v < 0 ? `İSKELE ${Math.abs(v)}°` : v > 0 ? `SANCAK ${v}°` : "ORTA 0°"; }

  function setEngine(value) {
    if (!state) return;
    state.engine = Number(value);
    document.querySelectorAll("[data-engine]").forEach((b) => b.classList.toggle("active", Number(b.dataset.engine) === state.engine));
    const name = ENGINE_NAMES.get(state.engine) || "STOP";
    $("engineLabel").textContent = name; $("engineCommandReadout").textContent = name;
  }

  function updateLabels() {
    if (!state) return;
    $("hdgValue").textContent = formatDeg(state.heading);
    $("cogValue").textContent = formatDeg(state.cog);
    $("sogValue").textContent = `${state.sog.toFixed(1)} kn`;
    $("rotValue").textContent = `${state.rot.toFixed(1)}°/dk`;
    $("depthValue").textContent = `${state.depth.toFixed(1)} m`;
    $("ukcValue").textContent = `${state.ukc.toFixed(2)} m`;
    $("ukcValue").className = state.ukc < ship.minUkc + 0.6 ? "danger" : "safe";
    $("levelLabel").textContent = `${state.level.id} · ${state.level.name}`;
    $("windLabel").textContent = state.level.wind[0] ? `${state.level.wind[0]} kn / ${state.level.wind[1]}°` : "Sakin";
    $("currentLabel").textContent = state.level.current[0] ? `${state.level.current[0]} kn / ${state.level.current[1]}°` : "Yok";
    $("goalLabel").textContent = `${Math.max(0, Math.round(state.y - state.goalY))} m`;
  }

  function formatTime(sec) { return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`; }

  function resizeCanvas() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function worldToScreen(x, y, s = state) {
    const rect = canvas.getBoundingClientRect();
    let dx = (x - s.cameraX) * s.zoom, dy = (y - s.cameraY) * s.zoom;
    if (s.orientation === "H-UP") {
      const a = degToRad(-s.heading);
      const rx = dx * Math.cos(a) - dy * Math.sin(a);
      const ry = dx * Math.sin(a) + dy * Math.cos(a);
      dx = rx; dy = ry;
    }
    return { x: rect.width / 2 + dx, y: rect.height / 2 + dy };
  }

  function drawMenuBackground() {
    const rect = canvas.getBoundingClientRect();
    const g = ctx.createLinearGradient(0, 0, 0, rect.height);
    g.addColorStop(0, "#173b43"); g.addColorStop(1, "#06161b");
    ctx.fillStyle = g; ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = "rgba(121,232,223,.08)"; ctx.lineWidth = 1;
    for (let x = 0; x < rect.width; x += 58) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rect.height); ctx.stroke(); }
    for (let y = 0; y < rect.height; y += 58) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(rect.width, y); ctx.stroke(); }
  }

  function drawChart(rect) {
    const visibleW = rect.width / state.zoom, visibleH = rect.height / state.zoom, pad = 260;
    const minX = state.cameraX - visibleW / 2 - pad, maxX = state.cameraX + visibleW / 2 + pad;
    const minY = state.cameraY - visibleH / 2 - pad, maxY = state.cameraY + visibleH / 2 + pad;
    const yStep = 65, lateralStep = 20, maxSearch = state.level.channelHalf + 470;
    ctx.save(); ctx.fillStyle = "#b8b184"; ctx.fillRect(0, 0, rect.width, rect.height);

    function edgePair(y, threshold) {
      const center = channelCenterAt(y, state.level, state.worldW);
      if (depthAt(center, y, state.level, state.worldW) < threshold) return null;
      let left = center, right = center;
      for (let o = lateralStep; o <= maxSearch; o += lateralStep) { if (depthAt(center - o, y, state.level, state.worldW) >= threshold) left = center - o; else break; }
      for (let o = lateralStep; o <= maxSearch; o += lateralStep) { if (depthAt(center + o, y, state.level, state.worldW) >= threshold) right = center + o; else break; }
      return { left, right };
    }

    function paintBand(threshold, color, stroke) {
      let segment = [];
      const flush = () => {
        if (segment.length < 2) { segment = []; return; }
        ctx.beginPath();
        segment.forEach((r, i) => { const p = worldToScreen(r.left, r.y); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
        for (let i = segment.length - 1; i >= 0; i -= 1) { const r = segment[i], p = worldToScreen(r.right, r.y); ctx.lineTo(p.x, p.y); }
        ctx.closePath(); ctx.fillStyle = color; ctx.fill();
        ctx.strokeStyle = stroke; ctx.lineWidth = 1.1; ctx.stroke(); segment = [];
      };
      for (let y = minY; y <= maxY; y += yStep) { const pair = edgePair(y, threshold); pair ? segment.push({ y, ...pair }) : flush(); }
      flush();
    }

    const req = ship.draft + ship.minUkc;
    [
      [0.05, "#68bada", "rgba(30,82,101,.48)"],
      [req, "#91cfdd", "rgba(45,110,126,.38)"],
      [Math.max(req + 2, 12), "#c2e1df", "rgba(55,118,119,.30)"],
      [Math.max(req + 4, 16), "#d9ebe3", "rgba(65,118,111,.25)"],
      [Math.max(req + 8, 21), "#edf3e9", "rgba(75,119,106,.20)"]
    ].forEach((b) => paintBand(...b));

    const grid = 240;
    const gx0 = Math.floor(minX / grid) * grid, gx1 = Math.ceil(maxX / grid) * grid;
    const gy0 = Math.floor(minY / grid) * grid, gy1 = Math.ceil(maxY / grid) * grid;
    ctx.strokeStyle = "rgba(39,88,92,.16)"; ctx.lineWidth = 1;
    for (let x = gx0; x <= gx1; x += grid) { const a = worldToScreen(x, gy0), b = worldToScreen(x, gy1); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    for (let y = gy0; y <= gy1; y += grid) { const a = worldToScreen(gx0, y), b = worldToScreen(gx1, y); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }

    ctx.save(); ctx.strokeStyle = "rgba(194,89,178,.55)"; ctx.lineWidth = 2; ctx.setLineDash([14, 12]); ctx.beginPath();
    let started = false;
    for (let y = minY; y <= maxY; y += 60) { const p = worldToScreen(channelCenterAt(y, state.level, state.worldW), y); started ? ctx.lineTo(p.x, p.y) : (ctx.moveTo(p.x, p.y), started = true); }
    ctx.stroke(); ctx.restore();

    ctx.fillStyle = "rgba(42,84,82,.78)"; ctx.font = "11px system-ui"; ctx.textAlign = "center";
    for (let y = Math.floor(minY / 320) * 320; y <= maxY; y += 320) {
      const center = channelCenterAt(y, state.level, state.worldW);
      [-0.68, -0.25, 0.25, 0.68].forEach((f, i) => {
        const x = center + state.level.channelHalf * f + Math.sin(y / 210 + i) * 18;
        const d = depthAt(x, y, state.level, state.worldW), p = worldToScreen(x, y);
        if (d > 0 && p.x > 18 && p.x < rect.width - 18 && p.y > 18 && p.y < rect.height - 18) ctx.fillText(d.toFixed(d < 10 ? 1 : 0), p.x, p.y);
      });
    }

    function mark(x, y, side) {
      const p = worldToScreen(x, y);
      if (p.x < -15 || p.x > rect.width + 15 || p.y < -15 || p.y > rect.height + 15) return;
      ctx.save(); ctx.translate(p.x, p.y); ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(-5, 6); ctx.lineTo(5, 6); ctx.closePath();
      ctx.fillStyle = side === "P" ? "#e46662" : "#49bc78"; ctx.fill(); ctx.strokeStyle = "#183b3d"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = "#244e4f"; ctx.font = "bold 10px system-ui"; ctx.textAlign = "left"; ctx.fillText(side, 7, 4); ctx.restore();
    }
    for (let y = Math.floor(minY / 520) * 520; y <= maxY; y += 520) {
      const c = channelCenterAt(y, state.level, state.worldW), e = state.level.channelHalf * 0.82;
      mark(c - e, y, "P"); mark(c + e, y + 240, "S");
    }
    ctx.restore();
  }

  function drawGoal() {
    const c = channelCenterAt(state.goalY, state.level, state.worldW);
    const a = worldToScreen(c - state.level.channelHalf * 0.72, state.goalY), b = worldToScreen(c + state.level.channelHalf * 0.72, state.goalY), m = worldToScreen(c, state.goalY);
    ctx.save(); ctx.strokeStyle = "#36c873"; ctx.lineWidth = 5; ctx.setLineDash([18, 11]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "rgba(8,55,34,.9)"; ctx.font = "bold 12px system-ui"; ctx.textAlign = "center"; ctx.fillText("HEDEF GEÇİŞ HATTI", m.x, m.y - 12); ctx.restore();
  }

  function drawTrail() {
    if (state.trail.length < 2) return;
    ctx.save(); ctx.strokeStyle = "rgba(38,91,96,.62)"; ctx.lineWidth = 2; ctx.beginPath();
    state.trail.forEach((pt, i) => { const p = worldToScreen(pt.x, pt.y); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke(); ctx.restore();
  }

  function predictionPoints() {
    const s = { ...state, trail: [], traffic: [] }, pts = [{ x: s.x, y: s.y, heading: s.heading, t: 0 }];
    for (let t = 3; t <= 120; t += 3) { integrate(s, 3, true); pts.push({ x: s.x, y: s.y, heading: s.heading, t }); if (s.depth <= 0 || s.ukc < ship.minUkc) break; }
    return pts;
  }

  function drawPrediction() {
    const pts = predictionPoints();
    ctx.save(); ctx.strokeStyle = "rgba(210,112,193,.88)"; ctx.lineWidth = 3; ctx.setLineDash([13, 10]); ctx.beginPath();
    pts.forEach((pt, i) => { const p = worldToScreen(pt.x, pt.y); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke(); ctx.setLineDash([]);
    pts.filter((p) => p.t > 0 && p.t % 15 === 0).forEach((p) => { drawOwnShip(p.x, p.y, p.heading, 0.22, true); drawArrow(p.x, p.y, p.heading); }); ctx.restore();
  }

  function drawArrow(x, y, heading) {
    const p = worldToScreen(x, y); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(degToRad(heading)); ctx.fillStyle = "rgba(210,112,193,.8)";
    ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(-5, -8); ctx.lineTo(5, -8); ctx.closePath(); ctx.fill(); ctx.restore();
  }

  function drawOwnShip(x, y, heading, alpha = 1, ghost = false) {
    const p = worldToScreen(x, y), len = clamp(ship.length * state.zoom, 27, 74), beam = clamp(ship.beam * state.zoom, 9, 25);
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(degToRad(heading)); ctx.globalAlpha = alpha;
    ctx.fillStyle = ghost ? "#70df91" : "#65e58c"; ctx.strokeStyle = "#153d32"; ctx.lineWidth = ghost ? 1 : 2;
    ctx.beginPath(); ctx.moveTo(0, -len / 2); ctx.lineTo(beam / 2, -len * 0.27); ctx.lineTo(beam / 2, len / 2); ctx.lineTo(-beam / 2, len / 2); ctx.lineTo(-beam / 2, -len * 0.27); ctx.closePath(); ctx.fill(); ctx.stroke();
    if (!ghost) { ctx.fillStyle = "#e9f4e8"; ctx.fillRect(-beam * 0.32, -len * 0.08, beam * 0.64, len * 0.24); ctx.fillStyle = "#153d32"; ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  function drawTrafficShip(t) {
    const p = worldToScreen(t.x, t.y), len = clamp(t.length * state.zoom, 20, 55), beam = clamp(t.beam * state.zoom, 7, 18);
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(degToRad(t.heading)); ctx.fillStyle = "#f0b65d"; ctx.strokeStyle = "#714e20"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -len / 2); ctx.lineTo(beam / 2, -len * 0.25); ctx.lineTo(beam / 2, len / 2); ctx.lineTo(-beam / 2, len / 2); ctx.lineTo(-beam / 2, -len * 0.25); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }

  function drawEnvironment(rect) {
    const portrait = matchMedia("(orientation: portrait)").matches;
    const x = 55, y = portrait ? 190 : rect.height - 115, r = 38;
    ctx.save(); ctx.globalAlpha = 0.88; ctx.fillStyle = "rgba(5,31,36,.84)"; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    const arrow = (deg, color, length) => { const a = degToRad(deg); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(a) * length, y - Math.cos(a) * length); ctx.stroke(); };
    if (state.level.wind[0]) arrow(state.level.wind[1] + 180, "#ffd25d", 31);
    if (state.level.current[0]) arrow(state.level.current[1], "#62d4ed", 27);
    ctx.fillStyle = "#dce8e5"; ctx.font = "bold 9px system-ui"; ctx.textAlign = "center"; ctx.fillText(`RÜZGÂR ${state.level.wind[0]}`, x, y - 7); ctx.fillText(`AKINTI ${state.level.current[0]}`, x, y + 12); ctx.restore();
  }

  function drawScale(rect) {
    const meters = 500, px = meters * state.zoom, y = rect.height - 16, x = rect.width / 2 - px / 2;
    ctx.save(); ctx.strokeStyle = "rgba(19,68,72,.75)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + px, y); ctx.stroke(); ctx.fillStyle = "rgba(19,68,72,.8)"; ctx.font = "bold 10px system-ui"; ctx.textAlign = "center"; ctx.fillText("500 m", rect.width / 2, y - 5); ctx.restore();
  }

  function draw() {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (!state || $("startScreen").classList.contains("visible")) { drawMenuBackground(); return; }
    drawChart(rect); drawGoal(); drawTrail(); if (state.prediction) drawPrediction(); state.traffic.forEach(drawTrafficShip); drawOwnShip(state.x, state.y, state.heading); drawEnvironment(rect); drawScale(rect);
  }

  function loop(now) {
    const dt = clamp((now - lastFrame) / 1000, 0, 0.06); lastFrame = now;
    updateSimulation(dt); updateLabels();
    if (now - lastDraw > 30) { draw(); lastDraw = now; }
    requestAnimationFrame(loop);
  }

  function showTutorial(index = 0) {
    tutorialIndex = clamp(index, 0, TUTORIAL.length - 1);
    const step = TUTORIAL[tutorialIndex];
    $("tutorialStepLabel").textContent = `${tutorialIndex + 1} / ${TUTORIAL.length}`;
    $("tutorialProgressBar").style.width = `${(tutorialIndex + 1) / TUTORIAL.length * 100}%`;
    $("tutorialTitle").textContent = step[0]; $("tutorialText").textContent = step[1];
    $("tutorialVisual").innerHTML = `<div class="tutorial-demo"><div><b>${tutorialIndex + 1}</b><span>${step[2]}</span></div></div>`;
    $("tutorialBackButton").disabled = tutorialIndex === 0;
    $("tutorialNextButton").textContent = tutorialIndex === TUTORIAL.length - 1 ? "LEVEL 1'E BAŞLA" : "İLERİ";
    $("tutorialOverlay").classList.remove("hidden"); $("tutorialOverlay").classList.add("visible");
  }

  function closeTutorial() { $("tutorialOverlay").classList.add("hidden"); $("tutorialOverlay").classList.remove("visible"); }
  function showToast(text) { const t = $("toast"); t.textContent = text; t.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => t.classList.remove("show"), 2200); }

  function beginRudderHold(step) {
    if (!state) return;
    setRudder(state.rudder + step);
    clearTimeout(rudderTimer);
    rudderTimer = setTimeout(() => { rudderTimer = setInterval(() => setRudder(state.rudder + step), 120); }, 320);
  }
  function endRudderHold() { clearTimeout(rudderTimer); clearInterval(rudderTimer); rudderTimer = null; }

  function bindEvents() {
    ["shipLengthInput", "shipBeamInput", "shipSpeedInput", "shipDraftInput", "shipUkcInput"].forEach((id) => $(id).addEventListener("input", refreshShipPreview));
    $("resetShipButton").addEventListener("click", () => { ship = { ...DEFAULT_SHIP }; writeShipInputs(); refreshShipPreview(); });
    $("ukcInfoButton").addEventListener("click", () => $("ukcHelp").classList.toggle("hidden"));
    $("startButton").addEventListener("click", () => startLevel(selectedLevel));
    $("tutorialButton").addEventListener("click", () => showTutorial(0));
    $("tutorialBackButton").addEventListener("click", () => showTutorial(tutorialIndex - 1));
    $("tutorialSkipButton").addEventListener("click", closeTutorial);
    $("tutorialNextButton").addEventListener("click", () => { if (tutorialIndex >= TUTORIAL.length - 1) { closeTutorial(); selectedLevel = 1; startLevel(1); } else showTutorial(tutorialIndex + 1); });

    [["portRudderButton", -1], ["starboardRudderButton", 1]].forEach(([id, step]) => {
      const b = $(id); b.addEventListener("pointerdown", (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); beginRudderHold(step); });
      ["pointerup", "pointercancel", "pointerleave", "lostpointercapture"].forEach((ev) => b.addEventListener(ev, endRudderHold));
    });
    $("midshipsButton").addEventListener("click", () => setRudder(0));
    $("rudderSlider").addEventListener("input", (e) => setRudder(Number(e.target.value)));
    document.querySelectorAll("[data-engine]").forEach((b) => b.addEventListener("click", () => setEngine(Number(b.dataset.engine))));

    $("zoomIn").addEventListener("click", () => { if (state) state.zoom = clamp(state.zoom * 1.18, 0.18, 1.2); });
    $("zoomOut").addEventListener("click", () => { if (state) state.zoom = clamp(state.zoom / 1.18, 0.18, 1.2); });
    $("centerShip").addEventListener("click", () => { if (state) { state.cameraX = state.x; state.cameraY = state.y - 300 / state.zoom; } });
    $("orientationToggle").addEventListener("click", () => { if (!state) return; state.orientation = state.orientation === "N-UP" ? "H-UP" : "N-UP"; $("orientationToggle").textContent = state.orientation; });
    $("predictionToggle").addEventListener("click", () => { if (!state) return; state.prediction = !state.prediction; $("predictionToggle").classList.toggle("active", state.prediction); });
    $("pauseButton").addEventListener("click", () => { if (!state) return; state.paused = !state.paused; $("pauseButton").textContent = state.paused ? "▶" : "Ⅱ"; });
    $("gameMenuButton").addEventListener("click", returnToMenu);
    $("menuButton").addEventListener("click", returnToMenu);
    $("restartButton").addEventListener("click", () => { $("messageModal").classList.add("hidden"); startLevel(selectedLevel); });
    $("nextLevelButton").addEventListener("click", () => { $("messageModal").classList.add("hidden"); startLevel(Math.min(LEVELS.length, selectedLevel + 1)); });

    addEventListener("keydown", (e) => { if (!state) return; if (e.key === "ArrowLeft") setRudder(state.rudder - 1); if (e.key === "ArrowRight") setRudder(state.rudder + 1); });
    addEventListener("resize", () => { resizeCanvas(); if (state && matchMedia("(orientation: portrait)").matches && state.zoom > 0.38) state.zoom = 0.29; });
    addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstallPrompt = e; $("installButton").classList.remove("hidden"); });
    $("installButton").addEventListener("click", async () => { if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; $("installButton").classList.add("hidden"); });
  }

  function init() {
    writeShipInputs(); refreshShipPreview(); renderLevels(); bindEvents(); resizeCanvas(); drawMenuBackground();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    requestAnimationFrame(loop);
  }

  init();
})();
