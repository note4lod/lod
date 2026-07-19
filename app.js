(() => {
  "use strict";

  const CFG = window.EP_CONFIG || { MASTER_MODE: false, VERSION: "1.5.0", CACHE_NAME: "ep-maneuver-v1.5" };
  const $ = (id) => document.getElementById(id);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const degToRad = (d) => d * Math.PI / 180;
  const radToDeg = (r) => r * 180 / Math.PI;
  const normDeg = (d) => (d % 360 + 360) % 360;
  const knToMps = (kn) => kn * 0.514444;
  const formatDeg = (v) => `${normDeg(v).toFixed(1).padStart(5, "0")}°`;
  const engineNames = new Map([
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
    { id: 7, name: "Birleşik Etkiler", desc: "Rüzgâr, akıntı, trafik, sığlık", baseDepth: 13.5, channelHalf: 185, wind: [26, 250], current: [1.8, 80], traffic: 5, time: 360, seed: 3.4, shoals: true },
    { id: 8, name: "Kaptan Seviyesi", desc: "Fırtına ve kritik geçiş", baseDepth: 12.2, channelHalf: 155, wind: [34, 300], current: [2.5, 110], traffic: 6, time: 340, seed: 4.1, shoals: true }
  ];

  const DEFAULT_SHIP = Object.freeze({ length: 150, beam: 24, maxSpeed: 14, draft: 7.5, minUkc: 1.0 });
  let ship = loadShip();
  let physics = deriveShipPhysics(ship);
  let selectedLevel = 1;
  let unlockedLevel = CFG.MASTER_MODE ? LEVELS.length : Number(localStorage.getItem("epUnlockedLevel") || 1);
  unlockedLevel = clamp(unlockedLevel, 1, LEVELS.length);
  let deferredInstallPrompt = null;
  let rudderHoldTimer = null;
  let animationId = 0;
  let lastFrame = performance.now();
  let tutorialIndex = 0;
  let state = null;

  const canvas = $("chartCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });

  const tutorialSteps = [
    {
      title: "Köprüüstüne Hoş Geldiniz",
      text: "Bu tanıtım, simülatördeki kumandaları ve göstergeleri sırayla açıklar. İlerlemek için İLERİ düğmesine dokunun.",
      visual: `<div class="tutorial-demo"><div><b>HDG</b><span>Pruva yönü</span></div><div><b>COG</b><span>Yere göre rota</span></div><div><b>SOG</b><span>Yere göre sürat</span></div></div>`
    },
    {
      title: "Gemi Özellikleri",
      text: "Ana menüde boy, en, azami sürat, draft ve minimum UKC değerlerini değiştirebilirsiniz. Büyük ve ağır gemi daha yavaş hızlanır, daha geç durur ve daha geniş döner.",
      visual: `<div class="tutorial-demo"><div><b>L × B</b><span>Boy ve en</span></div><div><b>T</b><span>Draft</span></div><div><b>Vmax</b><span>Azami sürat</span></div></div>`
    },
    {
      title: "UKC ve Squat",
      text: "UKC, omurga ile deniz tabanı arasındaki boşluktur. Sürat yükseldikçe squat artar ve gemi suya daha fazla gömülür. Kullanılabilir UKC minimum değerin altına düşerse oyun biter.",
      visual: `<div class="tutorial-demo"><div><b>Derinlik</b><span>Harita değeri</span></div><div><b>− Draft</b><span>Suya batım</span></div><div><b>− Squat</b><span>Hız etkisi</span></div></div>`
    },
    {
      title: "Üst Göstergeler",
      text: "HDG geminin baktığı yönü, COG rüzgâr ve akıntı sonrası gerçek hareket yönünü, SOG yere göre sürati, ROT ise dakikadaki dönüş oranını gösterir.",
      visual: `<div class="tutorial-demo"><div><b>HDG 000°</b><span>Pruva</span></div><div><b>COG 004°</b><span>Gerçek iz</span></div><div><b>ROT 8°/dk</b><span>Dönüş hızı</span></div></div>`
    },
    {
      title: "Dümen Kumandası",
      text: "İSKELE veya SANCAK düğmesine bir kez basınca dümen 1° değişir. Basılı tuttukça 1°'er devam eder. ORTA düğmesi dümeni doğrudan 0° yapar.",
      visual: `<div class="tutorial-demo"><div><b>◀ İSKELE</b><span>Eksi dümen</span></div><div><b>ORTA</b><span>0°</span></div><div><b>SANCAK ▶</b><span>Artı dümen</span></div></div>`
    },
    {
      title: "Makine Telgrafı",
      text: "İleri kademeler hedef sürati artırır. Tornistan kademeleri gemiyi yavaşlatır ve geriye götürür. Büyük gemilerde komut ile gerçek sürat değişimi arasında gecikme vardır.",
      visual: `<div class="tutorial-demo"><div><b>TORNİSTAN</b><span>Geri / fren</span></div><div><b>STOP</b><span>Makine sıfır</span></div><div><b>İLERİ</b><span>Hızlanma</span></div></div>`
    },
    {
      title: "PRED Manevra Tahmini",
      text: "PRED açıkken pembe kesik çizgi 120 saniyelik tahmini izi gösterir. Yarı saydam gemi gölgeleri yaklaşık 15 saniyelik aralıklarla gelecekteki konumu gösterir. Tahmin, mevcut dümen ve makine komutuna göre sürekli yenilenir.",
      visual: `<div style="width:100%;height:110px;position:relative"><svg viewBox="0 0 500 110" width="100%" height="100%" aria-label="Tahmini dönüş izi"><path d="M30 90 C150 90 210 70 250 30 S390 15 470 22" fill="none" stroke="#df8acb" stroke-width="4" stroke-dasharray="13 10"/><g fill="#70df91" opacity=".4"><path d="M55 96 l-8-20 16 0z"/><path d="M210 67 l-8-20 16 0z"/><path d="M355 26 l-8-20 16 0z"/></g></svg></div>`
    },
    {
      title: "Göreve Hazırsınız",
      text: "Haritada güvenli derinlikte kalın, trafik gemilerine yaklaşmayın ve hedef geçiş hattına süre dolmadan ulaşın. Tanıtımı tamamladığınızda Level 1 otomatik başlayacak.",
      visual: `<div class="tutorial-demo"><div><b>Derinlik</b><span>Draft + squat + UKC</span></div><div><b>Trafik</b><span>Emniyetli mesafe</span></div><div><b>Hedef</b><span>Yeşil geçiş hattı</span></div></div>`
    }
  ];

  function loadShip() {
    try {
      const saved = JSON.parse(localStorage.getItem("epShipConfig") || "null");
      return saved ? { ...DEFAULT_SHIP, ...saved } : { ...DEFAULT_SHIP };
    } catch {
      return { ...DEFAULT_SHIP };
    }
  }

  function saveShip() {
    localStorage.setItem("epShipConfig", JSON.stringify(ship));
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
    return { cb, displacement, massFactor, turnDiameter, stoppingDistance, maxSquat, safeDepth, accelTau, yawTau, maxRot };
  }

  function squatFor(speedKn, s, cb, depth) {
    const ratio = depth / Math.max(s.draft, 0.1);
    const shallowBoost = 1 + clamp((2.5 - ratio) * 0.45, 0, 1.2);
    return clamp(0.0075 * cb * speedKn * speedKn * (1 + s.draft / 18) * shallowBoost, 0, s.draft * 0.3);
  }

  function validateShip(candidate = ship) {
    const errors = [];
    if (candidate.length < 40 || candidate.length > 400) errors.push("Gemi boyu 40–400 m olmalı.");
    if (candidate.beam < 7 || candidate.beam > 70) errors.push("Gemi eni 7–70 m olmalı.");
    if (candidate.beam >= candidate.length * 0.45) errors.push("Gemi eni, boya göre çok büyük.");
    if (candidate.maxSpeed < 4 || candidate.maxSpeed > 32) errors.push("Azami sürat 4–32 kn olmalı.");
    if (candidate.draft < 1.5 || candidate.draft > 20) errors.push("Draft 1.5–20 m olmalı.");
    if (candidate.minUkc < 0.3 || candidate.minUkc > 5) errors.push("Minimum UKC 0.3–5 m olmalı.");
    return errors;
  }

  function readShipInputs() {
    return {
      length: Number($("shipLengthInput").value),
      beam: Number($("shipBeamInput").value),
      maxSpeed: Number($("shipSpeedInput").value),
      draft: Number($("shipDraftInput").value),
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
    const box = $("shipValidation");
    if (errors.length) {
      box.textContent = errors[0];
      box.classList.remove("ok");
      $("startButton").disabled = true;
      $("tutorialButton").disabled = true;
      return false;
    }
    box.textContent = "Gemi değerleri geçerli. Fizik modeli otomatik güncellendi.";
    box.classList.add("ok");
    ship = candidate;
    physics = p;
    saveShip();
    $("startButton").disabled = false;
    $("tutorialButton").disabled = false;
    return true;
  }

  function renderLevels() {
    const grid = $("levelGrid");
    grid.innerHTML = "";
    const tutorial = document.createElement("button");
    tutorial.className = "level-card tutorial-card";
    tutorial.innerHTML = `<strong>Tanıtım</strong><span>Düğmeleri ve göstergeleri adım adım öğren</span>`;
    tutorial.addEventListener("click", startTutorial);
    grid.appendChild(tutorial);

    LEVELS.forEach((level) => {
      const open = CFG.MASTER_MODE || level.id <= unlockedLevel;
      const button = document.createElement("button");
      button.className = `level-card${selectedLevel === level.id ? " selected" : ""}${open ? "" : " locked"}`;
      button.disabled = !open;
      button.innerHTML = `<strong>${level.id}. ${level.name}</strong><span>${open ? level.desc : "Kilitli"}</span>`;
      button.addEventListener("click", () => {
        selectedLevel = level.id;
        $("startButton").textContent = `LEVEL ${selectedLevel}'E BAŞLA`;
        renderLevels();
      });
      grid.appendChild(button);
    });
    $("progressText").textContent = CFG.MASTER_MODE ? "Tüm leveller açık" : `Level ${unlockedLevel} seviyesine kadar açık`;
    $("masterBadge").classList.toggle("hidden", !CFG.MASTER_MODE);
  }

  function startTutorial() {
    if (!refreshShipPreview()) return;
    tutorialIndex = 0;
    $("tutorialOverlay").classList.remove("hidden");
    $("tutorialOverlay").classList.add("visible");
    renderTutorialStep();
  }

  function renderTutorialStep() {
    const step = tutorialSteps[tutorialIndex];
    $("tutorialStepLabel").textContent = `${tutorialIndex + 1} / ${tutorialSteps.length}`;
    $("tutorialProgressBar").style.width = `${((tutorialIndex + 1) / tutorialSteps.length) * 100}%`;
    $("tutorialTitle").textContent = step.title;
    $("tutorialText").textContent = step.text;
    $("tutorialVisual").innerHTML = step.visual;
    $("tutorialBackButton").disabled = tutorialIndex === 0;
    $("tutorialNextButton").textContent = tutorialIndex === tutorialSteps.length - 1 ? "LEVEL 1'E GEÇ" : "İLERİ";
  }

  function closeTutorial() {
    $("tutorialOverlay").classList.add("hidden");
    $("tutorialOverlay").classList.remove("visible");
  }

  function beginLevel(levelId) {
    if (!refreshShipPreview()) return;
    selectedLevel = levelId;
    const level = LEVELS[levelId - 1];
    const worldW = 1800;
    const worldH = 3300;
    const startY = 2920;
    const channelX = channelCenterAt(startY, level, worldW);
    state = {
      running: true,
      paused: false,
      ended: false,
      level,
      worldW,
      worldH,
      x: channelX,
      y: startY,
      heading: 0,
      speed: 0,
      engine: 0,
      rudder: 0,
      rot: 0,
      cog: 0,
      sog: 0,
      depth: depthAt(channelX, startY, level, worldW),
      squat: 0,
      ukc: 0,
      elapsed: 0,
      goalY: 310,
      zoom: 0.42,
      cameraX: channelX,
      cameraY: startY - 350,
      orientation: "N-UP",
      prediction: true,
      trail: [],
      traffic: spawnTraffic(level, worldW, worldH),
      minUkcSeen: Infinity,
      closestTraffic: Infinity,
      distanceTravelled: 0,
      lastX: channelX,
      lastY: startY
    };
    closeTutorial();
    $("startScreen").classList.add("hidden");
    $("startScreen").classList.remove("visible");
    ["topHud", "statusStrip", "chartTools", "controls", "gameBrand"].forEach((id) => $(id).classList.remove("hidden"));
    setRudder(0);
    setEngine(0);
    updateLabels();
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
    drawMenuBackground();
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
      const shoal1 = Math.exp(-(((x - (center + 95)) / 115) ** 2 + ((y - 1750) / 290) ** 2));
      const shoal2 = Math.exp(-(((x - (center - 110)) / 95) ** 2 + ((y - 930) / 230) ** 2));
      depth -= shoal1 * (3.8 + level.id * 0.25) + shoal2 * (3.2 + level.id * 0.2);
    }
    if (lateral > level.channelHalf + 260) depth = -2;
    return clamp(depth, -2, 28);
  }

  function spawnTraffic(level, worldW, worldH) {
    const ships = [];
    for (let i = 0; i < level.traffic; i++) {
      const inbound = i % 2 === 0;
      const y = 650 + i * ((worldH - 1200) / Math.max(level.traffic, 1));
      const center = channelCenterAt(y, level, worldW);
      const crossing = level.id >= 5 && i === level.traffic - 1;
      ships.push({
        x: crossing ? center - 430 : center + (inbound ? 65 : -65),
        y,
        heading: crossing ? 90 : inbound ? 180 : 0,
        speed: crossing ? 7 : 6.5 + (i % 3),
        length: 85 + (i % 3) * 35,
        beam: 14 + (i % 3) * 4,
        name: `T${i + 1}`,
        crossing
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

  function integrate(snapshot, dt, includeExternal = true) {
    const level = snapshot.level;
    const depth = depthAt(snapshot.x, snapshot.y, level, snapshot.worldW);
    const targetSpeed = snapshot.engine >= 0 ? snapshot.engine * ship.maxSpeed : snapshot.engine * ship.maxSpeed * 0.45;
    let tau = physics.accelTau;
    if (snapshot.speed > 0 && targetSpeed < snapshot.speed) tau *= snapshot.engine < 0 ? 0.48 : 0.78;
    if (snapshot.speed < 0 && targetSpeed > snapshot.speed) tau *= 0.58;
    snapshot.speed += (targetSpeed - snapshot.speed) * clamp(dt / tau, 0, 0.3);

    const ratio = depth / Math.max(ship.draft, 0.1);
    const shallowTurn = clamp((ratio - 1.03) / 1.35, 0.28, 1);
    const speedEffect = clamp(Math.abs(snapshot.speed) / Math.max(ship.maxSpeed, 0.1), 0, 1.25);
    const targetRot = (snapshot.rudder / 35) * physics.maxRot * speedEffect * shallowTurn * (snapshot.speed >= 0 ? 1 : -0.65);
    snapshot.rot += (targetRot - snapshot.rot) * clamp(dt / physics.yawTau, 0, 0.35);
    snapshot.heading = normDeg(snapshot.heading + snapshot.rot / 60 * dt);

    const h = degToRad(snapshot.heading);
    const waterSpeed = knToMps(snapshot.speed);
    let vx = Math.sin(h) * waterSpeed;
    let vy = -Math.cos(h) * waterSpeed;
    if (includeExternal) {
      const c = currentVector(level);
      const w = windVector(level);
      vx += c.x + w.x;
      vy += c.y + w.y;
    }
    snapshot.x += vx * dt;
    snapshot.y += vy * dt;
    snapshot.sog = Math.hypot(vx, vy) / 0.514444;
    snapshot.cog = snapshot.sog > 0.03 ? normDeg(radToDeg(Math.atan2(vx, -vy))) : snapshot.heading;
    snapshot.depth = depthAt(snapshot.x, snapshot.y, level, snapshot.worldW);
    snapshot.squat = squatFor(Math.abs(snapshot.speed), ship, physics.cb, Math.max(snapshot.depth, 0.1));
    snapshot.ukc = snapshot.depth - ship.draft - snapshot.squat;
  }

  function updateSimulation(dt) {
    if (!state || !state.running || state.paused || state.ended) return;
    const beforeX = state.x;
    const beforeY = state.y;
    integrate(state, dt, true);
    state.elapsed += dt;
    state.distanceTravelled += Math.hypot(state.x - beforeX, state.y - beforeY);
    state.minUkcSeen = Math.min(state.minUkcSeen, state.ukc);
    state.trail.push({ x: state.x, y: state.y });
    if (state.trail.length > 900) state.trail.shift();

    updateTraffic(dt);
    state.cameraX += (state.x - state.cameraX) * clamp(dt * 1.7, 0, 1);
    state.cameraY += ((state.y - 300 / state.zoom) - state.cameraY) * clamp(dt * 1.7, 0, 1);

    if (state.depth <= 0 || state.ukc < ship.minUkc) {
      finishLevel(false, `Kullanılabilir UKC ${state.ukc.toFixed(2)} m oldu. Gerekli minimum UKC ${ship.minUkc.toFixed(1)} m.`);
      return;
    }
    if (state.x < 0 || state.x > state.worldW || state.y < -120 || state.y > state.worldH + 100) {
      finishLevel(false, "Emniyetli seyir alanının dışına çıktınız.");
      return;
    }
    if (state.elapsed > state.level.time) {
      finishLevel(false, "Görev süresi doldu.");
      return;
    }
    const goalCenter = channelCenterAt(state.goalY, state.level, state.worldW);
    if (state.y <= state.goalY && Math.abs(state.x - goalCenter) < state.level.channelHalf * 0.72) {
      finishLevel(true, "Hedef geçiş hattına emniyetli şekilde ulaştınız.");
    }
  }

  function updateTraffic(dt) {
    for (const t of state.traffic) {
      const r = degToRad(t.heading);
      t.x += Math.sin(r) * knToMps(t.speed) * dt;
      t.y += -Math.cos(r) * knToMps(t.speed) * dt;
      if (!t.crossing) {
        const desiredX = channelCenterAt(t.y, state.level, state.worldW) + (t.heading === 180 ? 65 : -65);
        t.x += (desiredX - t.x) * clamp(dt * 0.015, 0, 0.08);
      }
      if (t.y < -200) t.y = state.worldH + 150;
      if (t.y > state.worldH + 200) t.y = -150;
      if (t.x > state.worldW + 300) t.x = -250;
      const d = Math.hypot(t.x - state.x, t.y - state.y);
      state.closestTraffic = Math.min(state.closestTraffic, d);
      const collisionRange = ship.length * 0.48 + t.length * 0.5;
      if (d < collisionRange) {
        finishLevel(false, `${t.name} trafik gemisiyle çatışma oldu.`);
        return;
      }
    }
  }

  function finishLevel(success, message) {
    if (!state || state.ended) return;
    state.ended = true;
    state.running = false;
    setEngine(0);
    if (success && !CFG.MASTER_MODE && selectedLevel === unlockedLevel && unlockedLevel < LEVELS.length) {
      unlockedLevel += 1;
      localStorage.setItem("epUnlockedLevel", String(unlockedLevel));
    }
    $("resultEyebrow").textContent = success ? "GÖREV TAMAMLANDI" : "MANEVRA SONUCU";
    $("resultTitle").textContent = success ? "Başarılı Manevra" : "Game Over";
    $("resultTitle").className = success ? "safe" : "danger";
    $("resultMessage").textContent = message;
    $("resultStats").innerHTML = `
      <div><span>Süre</span><b>${formatTime(state.elapsed)}</b></div>
      <div><span>Mesafe</span><b>${Math.round(state.distanceTravelled)} m</b></div>
      <div><span>En düşük UKC</span><b>${Number.isFinite(state.minUkcSeen) ? state.minUkcSeen.toFixed(2) : "--"} m</b></div>
      <div><span>En yakın trafik</span><b>${Number.isFinite(state.closestTraffic) ? Math.round(state.closestTraffic) : "--"} m</b></div>`;
    $("nextLevelButton").classList.toggle("hidden", !success || selectedLevel >= LEVELS.length);
    $("messageModal").classList.remove("hidden");
    $("messageModal").classList.add("visible");
  }

  function setRudder(value) {
    if (!state) return;
    state.rudder = clamp(Math.round(value), -35, 35);
    $("rudderSlider").value = state.rudder;
    $("rudderLabel").textContent = rudderText(state.rudder);
    $("rudderCommandReadout").textContent = rudderText(state.rudder);
    $("midshipsButton").classList.toggle("active", state.rudder === 0);
  }

  function rudderText(v) {
    if (v < 0) return `İSKELE ${Math.abs(v)}°`;
    if (v > 0) return `SANCAK ${v}°`;
    return "ORTA 0°";
  }

  function setEngine(value) {
    if (!state) return;
    state.engine = Number(value);
    document.querySelectorAll("[data-engine]").forEach((b) => b.classList.toggle("active", Number(b.dataset.engine) === state.engine));
    const name = engineNames.get(state.engine) || "STOP";
    $("engineLabel").textContent = name;
    $("engineCommandReadout").textContent = name;
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

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function worldToScreen(x, y, snapshot = state) {
    const rect = canvas.getBoundingClientRect();
    let dx = (x - snapshot.cameraX) * snapshot.zoom;
    let dy = (y - snapshot.cameraY) * snapshot.zoom;
    if (snapshot.orientation === "H-UP") {
      const a = degToRad(-snapshot.heading);
      const rx = dx * Math.cos(a) - dy * Math.sin(a);
      const ry = dx * Math.sin(a) + dy * Math.cos(a);
      dx = rx;
      dy = ry;
    }
    return { x: rect.width / 2 + dx, y: rect.height / 2 + dy };
  }

  function draw() {
    if (!state || $("startScreen").classList.contains("visible")) {
      drawMenuBackground();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    drawChart(rect);
    drawGoal();
    drawTrail();
    if (state.prediction) drawPrediction();
    state.traffic.forEach(drawTrafficShip);
    drawOwnShip(state.x, state.y, state.heading, 1, false);
    drawEnvironmentalRose();
    drawScaleBar(rect);
  }

  function drawMenuBackground() {
    const rect = canvas.getBoundingClientRect();
    const g = ctx.createLinearGradient(0, 0, 0, rect.height);
    g.addColorStop(0, "#14363e");
    g.addColorStop(1, "#06151a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = "rgba(121,232,223,.09)";
    ctx.lineWidth = 1;
    for (let x = 0; x < rect.width; x += 54) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rect.height); ctx.stroke(); }
    for (let y = 0; y < rect.height; y += 54) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(rect.width, y); ctx.stroke(); }
  }

  function depthColor(depth) {
    if (depth <= 0) return "#b6ab76";
    if (depth < ship.draft + ship.minUkc) return "#67b8d5";
    if (depth < ship.draft + ship.minUkc + 2) return "#8fd1df";
    if (depth < 15) return "#c2e1df";
    return "#d8e9df";
  }

  function drawChart(rect) {
    const cellMeters = clamp(90 / state.zoom, 120, 260);
    const halfW = rect.width / state.zoom / 2 + cellMeters;
    const halfH = rect.height / state.zoom / 2 + cellMeters;
    const minX = Math.floor((state.cameraX - halfW) / cellMeters) * cellMeters;
    const maxX = state.cameraX + halfW;
    const minY = Math.floor((state.cameraY - halfH) / cellMeters) * cellMeters;
    const maxY = state.cameraY + halfH;
    for (let x = minX; x < maxX; x += cellMeters) {
      for (let y = minY; y < maxY; y += cellMeters) {
        const d = depthAt(x + cellMeters / 2, y + cellMeters / 2, state.level, state.worldW);
        const p1 = worldToScreen(x, y);
        const p2 = worldToScreen(x + cellMeters, y + cellMeters);
        ctx.fillStyle = depthColor(d);
        ctx.globalAlpha = 0.96;
        ctx.fillRect(Math.min(p1.x, p2.x) - 1, Math.min(p1.y, p2.y) - 1, Math.abs(p2.x - p1.x) + 2, Math.abs(p2.y - p1.y) + 2);
        ctx.globalAlpha = 1;
      }
    }
    ctx.strokeStyle = "rgba(35,88,92,.23)";
    ctx.lineWidth = 1;
    for (let x = minX; x <= maxX; x += cellMeters) {
      const a = worldToScreen(x, minY), b = worldToScreen(x, maxY);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let y = minY; y <= maxY; y += cellMeters) {
      const a = worldToScreen(minX, y), b = worldToScreen(maxX, y);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.fillStyle = "rgba(39,87,89,.76)";
    ctx.font = "12px system-ui";
    ctx.textAlign = "center";
    for (let x = minX; x < maxX; x += cellMeters * 2) {
      for (let y = minY; y < maxY; y += cellMeters * 2) {
        const p = worldToScreen(x + cellMeters / 2, y + cellMeters / 2);
        const d = depthAt(x + cellMeters / 2, y + cellMeters / 2, state.level, state.worldW);
        if (p.x > 20 && p.x < rect.width - 20 && p.y > 20 && p.y < rect.height - 20 && d > 0) ctx.fillText(d.toFixed(0), p.x, p.y);
      }
    }
  }

  function drawGoal() {
    const center = channelCenterAt(state.goalY, state.level, state.worldW);
    const left = worldToScreen(center - state.level.channelHalf * 0.72, state.goalY);
    const right = worldToScreen(center + state.level.channelHalf * 0.72, state.goalY);
    ctx.save();
    ctx.strokeStyle = "#36c873";
    ctx.lineWidth = 5;
    ctx.setLineDash([18, 11]);
    ctx.beginPath(); ctx.moveTo(left.x, left.y); ctx.lineTo(right.x, right.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(8,55,34,.9)";
    const mid = worldToScreen(center, state.goalY);
    ctx.font = "bold 13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("HEDEF GEÇİŞ HATTI", mid.x, mid.y - 12);
    ctx.restore();
  }

  function drawTrail() {
    if (state.trail.length < 2) return;
    ctx.save();
    ctx.strokeStyle = "rgba(40,98,102,.62)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    state.trail.forEach((pt, i) => { const p = worldToScreen(pt.x, pt.y); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
    ctx.stroke();
    ctx.restore();
  }

  function getPrediction() {
    const s = { ...state, trail: [], traffic: [] };
    const points = [{ x: s.x, y: s.y, heading: s.heading, t: 0 }];
    for (let t = 3; t <= 120; t += 3) {
      integrate(s, 3, true);
      points.push({ x: s.x, y: s.y, heading: s.heading, t });
      if (s.depth <= 0 || s.ukc < ship.minUkc) break;
    }
    return points;
  }

  function drawPrediction() {
    const points = getPrediction();
    ctx.save();
    ctx.strokeStyle = "rgba(210,112,193,.82)";
    ctx.lineWidth = 3;
    ctx.setLineDash([13, 10]);
    ctx.beginPath();
    points.forEach((pt, i) => { const p = worldToScreen(pt.x, pt.y); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
    ctx.stroke();
    ctx.setLineDash([]);
    points.filter((p) => p.t > 0 && p.t % 15 === 0).forEach((p) => drawOwnShip(p.x, p.y, p.heading, 0.2, true));
    ctx.restore();
  }

  function drawOwnShip(x, y, heading, alpha = 1, ghost = false) {
    const p = worldToScreen(x, y);
    const scale = state.zoom;
    const lengthPx = clamp(ship.length * scale, 25, 105);
    const beamPx = clamp(ship.beam * scale, 8, 28);
    const angle = degToRad(heading - (state.orientation === "H-UP" ? state.heading : 0));
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(angle);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(0, -lengthPx * 0.55);
    ctx.lineTo(beamPx * 0.52, -lengthPx * 0.24);
    ctx.lineTo(beamPx * 0.48, lengthPx * 0.48);
    ctx.lineTo(0, lengthPx * 0.57);
    ctx.lineTo(-beamPx * 0.48, lengthPx * 0.48);
    ctx.lineTo(-beamPx * 0.52, -lengthPx * 0.24);
    ctx.closePath();
    ctx.fillStyle = ghost ? "#72dc8e" : "#50df78";
    ctx.fill();
    ctx.strokeStyle = ghost ? "#2f9260" : "#052e20";
    ctx.lineWidth = ghost ? 1.5 : 3;
    ctx.stroke();
    if (!ghost) {
      ctx.fillStyle = "#e6f5e9";
      ctx.fillRect(-beamPx * 0.32, -lengthPx * 0.02, beamPx * 0.64, lengthPx * 0.22);
      ctx.strokeStyle = "#112c25";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -lengthPx * 0.55); ctx.lineTo(0, -lengthPx * 0.82); ctx.stroke();
    }
    ctx.restore();
  }

  function drawTrafficShip(t) {
    const p = worldToScreen(t.x, t.y);
    const scale = state.zoom;
    const len = clamp(t.length * scale, 18, 68);
    const beam = clamp(t.beam * scale, 7, 20);
    const angle = degToRad(t.heading - (state.orientation === "H-UP" ? state.heading : 0));
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(angle);
    ctx.fillStyle = "rgba(241,91,84,.86)";
    ctx.strokeStyle = "#5a1716"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -len * .55); ctx.lineTo(beam * .5, -len * .22); ctx.lineTo(beam * .45, len * .48); ctx.lineTo(-beam * .45, len * .48); ctx.lineTo(-beam * .5, -len * .22); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#5a1716"; ctx.font = "bold 11px system-ui"; ctx.textAlign = "center"; ctx.fillText(t.name, p.x, p.y + len * .8);
  }

  function drawEnvironmentalRose() {
    const rect = canvas.getBoundingClientRect();
    const x = 76, y = rect.height - (document.getElementById("controls").classList.contains("hidden") ? 75 : 345);
    ctx.save();
    ctx.fillStyle = "rgba(5,31,36,.82)"; ctx.beginPath(); ctx.arc(x, y, 56, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(121,232,223,.45)"; ctx.stroke();
    drawVectorArrow(x - 15, y + 18, state.level.wind[1] + 180, 35, "#ffd25d");
    drawVectorArrow(x + 14, y + 18, state.level.current[1], 35, "#72e3de");
    ctx.font = "bold 11px system-ui"; ctx.textAlign = "center";
    ctx.fillStyle = "#ffd25d"; ctx.fillText(`RÜZGÂR ${state.level.wind[0]}`, x, y - 20);
    ctx.fillStyle = "#72e3de"; ctx.fillText(`AKINTI ${state.level.current[0]}`, x, y + 43);
    ctx.restore();
  }

  function drawVectorArrow(x, y, deg, len, color) {
    const r = degToRad(deg);
    const ex = x + Math.sin(r) * len;
    const ey = y - Math.cos(r) * len;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(r); ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(-5, 2); ctx.lineTo(5, 2); ctx.closePath(); ctx.fill(); ctx.restore();
  }

  function drawScaleBar(rect) {
    const meters = 500;
    const px = meters * state.zoom;
    const x = rect.width / 2 - px / 2;
    const y = rect.height - 18;
    ctx.save(); ctx.strokeStyle = "rgba(10,55,63,.75)"; ctx.fillStyle = "rgba(10,55,63,.85)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + px, y); ctx.stroke();
    ctx.font = "bold 12px system-ui"; ctx.textAlign = "center"; ctx.fillText("500 m", rect.width / 2, y - 6); ctx.restore();
  }

  function updateLoop(now) {
    const dt = clamp((now - lastFrame) / 1000, 0, 0.08);
    lastFrame = now;
    updateSimulation(dt);
    updateLabels();
    draw();
    animationId = requestAnimationFrame(updateLoop);
  }

  function showToast(text) {
    const toast = $("toast");
    toast.textContent = text;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function bindRudderHold(button) {
    const step = Number(button.dataset.rudderStep);
    const start = (event) => {
      event.preventDefault();
      if (!state || state.ended) return;
      setRudder(state.rudder + step);
      clearTimeout(rudderHoldTimer);
      rudderHoldTimer = setTimeout(() => {
        rudderHoldTimer = setInterval(() => setRudder(state.rudder + step), 120);
      }, 330);
    };
    const stop = () => { clearTimeout(rudderHoldTimer); clearInterval(rudderHoldTimer); rudderHoldTimer = null; };
    button.addEventListener("pointerdown", start);
    ["pointerup", "pointercancel", "pointerleave"].forEach((name) => button.addEventListener(name, stop));
  }

  function bindEvents() {
    ["shipLengthInput", "shipBeamInput", "shipSpeedInput", "shipDraftInput", "shipUkcInput"].forEach((id) => $(id).addEventListener("input", refreshShipPreview));
    $("resetShipButton").addEventListener("click", () => { ship = { ...DEFAULT_SHIP }; physics = deriveShipPhysics(ship); writeShipInputs(); refreshShipPreview(); });
    $("ukcInfoButton").addEventListener("click", () => $("ukcHelp").classList.toggle("hidden"));
    $("startButton").addEventListener("click", () => beginLevel(selectedLevel));
    $("tutorialButton").addEventListener("click", startTutorial);
    $("tutorialBackButton").addEventListener("click", () => { tutorialIndex = Math.max(0, tutorialIndex - 1); renderTutorialStep(); });
    $("tutorialSkipButton").addEventListener("click", () => { closeTutorial(); showToast("Tanıtım atlandı"); });
    $("tutorialNextButton").addEventListener("click", () => {
      if (tutorialIndex < tutorialSteps.length - 1) { tutorialIndex += 1; renderTutorialStep(); }
      else { closeTutorial(); selectedLevel = 1; beginLevel(1); }
    });
    bindRudderHold($("portRudderButton"));
    bindRudderHold($("starboardRudderButton"));
    $("midshipsButton").addEventListener("click", () => setRudder(0));
    $("rudderSlider").addEventListener("input", (e) => setRudder(Number(e.target.value)));
    document.querySelectorAll("[data-engine]").forEach((button) => button.addEventListener("click", () => setEngine(Number(button.dataset.engine))));
    $("zoomIn").addEventListener("click", () => { if (state) state.zoom = clamp(state.zoom * 1.18, 0.22, 1.3); });
    $("zoomOut").addEventListener("click", () => { if (state) state.zoom = clamp(state.zoom / 1.18, 0.22, 1.3); });
    $("centerShip").addEventListener("click", () => { if (state) { state.cameraX = state.x; state.cameraY = state.y - 300 / state.zoom; } });
    $("orientationToggle").addEventListener("click", () => { if (!state) return; state.orientation = state.orientation === "N-UP" ? "H-UP" : "N-UP"; $("orientationToggle").textContent = state.orientation; });
    $("predictionToggle").addEventListener("click", () => { if (!state) return; state.prediction = !state.prediction; $("predictionToggle").classList.toggle("active", state.prediction); });
    $("pauseButton").addEventListener("click", () => { if (!state || state.ended) return; state.paused = !state.paused; $("pauseButton").textContent = state.paused ? "▶" : "Ⅱ"; showToast(state.paused ? "Simülasyon duraklatıldı" : "Simülasyon devam ediyor"); });
    $("gameMenuButton").addEventListener("click", returnToMenu);
    $("menuButton").addEventListener("click", returnToMenu);
    $("restartButton").addEventListener("click", () => { $("messageModal").classList.add("hidden"); $("messageModal").classList.remove("visible"); beginLevel(selectedLevel); });
    $("nextLevelButton").addEventListener("click", () => { $("messageModal").classList.add("hidden"); $("messageModal").classList.remove("visible"); selectedLevel = Math.min(LEVELS.length, selectedLevel + 1); beginLevel(selectedLevel); });
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstallPrompt = e; $("installButton").classList.remove("hidden"); });
    $("installButton").addEventListener("click", async () => { if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; $("installButton").classList.add("hidden"); });
    window.addEventListener("keydown", (e) => {
      if (!state || !state.running) return;
      if (e.key === "ArrowLeft") setRudder(state.rudder - 1);
      if (e.key === "ArrowRight") setRudder(state.rudder + 1);
      if (e.key === "0") setRudder(0);
      if (e.key === " ") { e.preventDefault(); setEngine(0); }
    });
  }

  function init() {
    writeShipInputs();
    refreshShipPreview();
    renderLevels();
    bindEvents();
    resizeCanvas();
    drawMenuBackground();
    if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
    cancelAnimationFrame(animationId);
    animationId = requestAnimationFrame(updateLoop);
  }

  init();
})();
