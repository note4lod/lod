from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
app_path = ROOT / "app.js"
css_path = ROOT / "styles.css"
index_path = ROOT / "index.html"
config_path = ROOT / "config.js"
sw_path = ROOT / "sw.js"
readme_path = ROOT / "README.md"

app = app_path.read_text(encoding="utf-8")

new_draw_chart = r'''  function drawChart(rect) {
    const visibleW = rect.width / state.zoom;
    const visibleH = rect.height / state.zoom;
    const pad = 260;
    const minX = state.cameraX - visibleW / 2 - pad;
    const maxX = state.cameraX + visibleW / 2 + pad;
    const minY = state.cameraY - visibleH / 2 - pad;
    const maxY = state.cameraY + visibleH / 2 + pad;
    const yStep = 48;
    const lateralStep = 14;
    const maxSearch = state.level.channelHalf + 470;

    ctx.save();
    ctx.fillStyle = "#b8b184";
    ctx.fillRect(0, 0, rect.width, rect.height);

    function edgePair(y, threshold) {
      const center = channelCenterAt(y, state.level, state.worldW);
      if (depthAt(center, y, state.level, state.worldW) < threshold) return null;
      let left = center;
      let right = center;
      for (let offset = lateralStep; offset <= maxSearch; offset += lateralStep) {
        if (depthAt(center - offset, y, state.level, state.worldW) >= threshold) left = center - offset;
        else break;
      }
      for (let offset = lateralStep; offset <= maxSearch; offset += lateralStep) {
        if (depthAt(center + offset, y, state.level, state.worldW) >= threshold) right = center + offset;
        else break;
      }
      return { left, right };
    }

    function paintBand(threshold, color, strokeColor) {
      let segment = [];
      const flush = () => {
        if (segment.length < 2) { segment = []; return; }
        ctx.beginPath();
        segment.forEach((row, index) => {
          const p = worldToScreen(row.left, row.y);
          if (index === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        });
        for (let i = segment.length - 1; i >= 0; i -= 1) {
          const row = segment[i];
          const p = worldToScreen(row.right, row.y);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        if (strokeColor) {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        segment = [];
      };

      for (let y = minY; y <= maxY; y += yStep) {
        const pair = edgePair(y, threshold);
        if (pair) segment.push({ y, ...pair });
        else flush();
      }
      flush();
    }

    const requiredDepth = ship.draft + ship.minUkc;
    paintBand(0.05, "#66b9d8", "rgba(33,91,108,.55)");
    paintBand(requiredDepth, "#91cfdd", "rgba(52,119,132,.42)");
    paintBand(requiredDepth + 2, "#c1e1df", "rgba(61,127,127,.34)");
    paintBand(15, "#d9ebe3", "rgba(73,126,119,.28)");
    paintBand(21, "#edf3e9", "rgba(80,125,112,.22)");

    const gridMeters = 220;
    const gridMinX = Math.floor(minX / gridMeters) * gridMeters;
    const gridMaxX = Math.ceil(maxX / gridMeters) * gridMeters;
    const gridMinY = Math.floor(minY / gridMeters) * gridMeters;
    const gridMaxY = Math.ceil(maxY / gridMeters) * gridMeters;
    ctx.strokeStyle = "rgba(39,88,92,.17)";
    ctx.lineWidth = 1;
    for (let x = gridMinX; x <= gridMaxX; x += gridMeters) {
      const a = worldToScreen(x, gridMinY);
      const b = worldToScreen(x, gridMaxY);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let y = gridMinY; y <= gridMaxY; y += gridMeters) {
      const a = worldToScreen(gridMinX, y);
      const b = worldToScreen(gridMaxX, y);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    ctx.save();
    ctx.strokeStyle = "rgba(193,91,177,.52)";
    ctx.lineWidth = 2;
    ctx.setLineDash([13, 12]);
    ctx.beginPath();
    let routeStarted = false;
    for (let y = minY; y <= maxY; y += 55) {
      const x = channelCenterAt(y, state.level, state.worldW);
      const p = worldToScreen(x, y);
      if (!routeStarted) { ctx.moveTo(p.x, p.y); routeStarted = true; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "rgba(42,84,82,.78)";
    ctx.font = "11px system-ui";
    ctx.textAlign = "center";
    const soundingStep = 300;
    for (let y = Math.floor(minY / soundingStep) * soundingStep; y <= maxY; y += soundingStep) {
      const center = channelCenterAt(y, state.level, state.worldW);
      [-0.68, -0.25, 0.25, 0.68].forEach((factor, index) => {
        const x = center + state.level.channelHalf * factor + Math.sin(y / 210 + index) * 18;
        const depth = depthAt(x, y, state.level, state.worldW);
        const p = worldToScreen(x, y);
        if (depth > 0 && p.x > 18 && p.x < rect.width - 18 && p.y > 18 && p.y < rect.height - 18) {
          ctx.fillText(depth.toFixed(depth < 10 ? 1 : 0), p.x, p.y);
        }
      });
    }

    function drawLateralMark(x, y, side) {
      const p = worldToScreen(x, y);
      if (p.x < -20 || p.x > rect.width + 20 || p.y < -20 || p.y > rect.height + 20) return;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(-5, 6); ctx.lineTo(5, 6); ctx.closePath();
      ctx.fillStyle = side === "P" ? "#e46662" : "#49bc78";
      ctx.fill();
      ctx.strokeStyle = "#183b3d";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "rgba(25,57,59,.9)";
      ctx.font = "bold 10px system-ui";
      ctx.textAlign = "left";
      ctx.fillText(side, 7, 4);
      ctx.restore();
    }

    const buoyStep = 520;
    for (let y = Math.floor(minY / buoyStep) * buoyStep; y <= maxY; y += buoyStep) {
      const center = channelCenterAt(y, state.level, state.worldW);
      const edge = state.level.channelHalf * 0.82;
      drawLateralMark(center - edge, y, "P");
      drawLateralMark(center + edge, y + buoyStep * 0.46, "S");
    }

    ctx.restore();
  }
'''

pattern = re.compile(r"  function drawChart\(rect\) \{.*?\n  \}\n\n  function drawGoal\(\) \{", re.S)
if not pattern.search(app):
    raise SystemExit("drawChart function block not found")
app = pattern.sub(new_draw_chart + "\n  function drawGoal() {", app, count=1)
app = app.replace('zoom: 0.42,', 'zoom: window.matchMedia("(orientation: portrait)").matches ? 0.30 : 0.42,')
app_path.write_text(app, encoding="utf-8")

css = css_path.read_text(encoding="utf-8")
marker = "/* v1.6 COMPACT PORTRAIT + REALISTIC CHART */"
if marker in css:
    css = css.split(marker)[0].rstrip() + "\n"
css += r'''

/* v1.6 COMPACT PORTRAIT + REALISTIC CHART */
#chartCanvas { image-rendering:auto; }
@media (orientation:portrait) and (max-width:760px) {
  #topHud {
    top:calc(var(--safe-top) + 2px);
    left:7px;
    right:69px;
    min-height:68px;
    height:68px;
    display:grid;
    grid-template-columns:repeat(3,minmax(0,1fr));
    grid-template-rows:repeat(2,34px);
    padding-right:34px;
    border-radius:14px;
    overflow:hidden;
  }
  #topHud .metric { padding:2px 2px; min-height:34px; }
  #topHud .metric:nth-child(n+4) { border-top:1px solid var(--line); }
  #topHud .metric span { font-size:7px; letter-spacing:.08em; }
  #topHud .metric strong { font-size:10px; line-height:1.05; }
  #pauseButton { position:absolute; right:0; top:0; bottom:0; width:34px; border-left:1px solid var(--line); font-size:18px; }

  #statusStrip {
    top:calc(var(--safe-top) + 75px);
    left:7px;
    right:69px;
    grid-template-columns:repeat(3,minmax(0,1fr));
    border-radius:13px;
  }
  #statusStrip > div { padding:5px 3px; }
  #statusStrip > div:nth-child(n+4) { display:none; }
  #statusStrip span { font-size:7px; letter-spacing:.09em; }
  #statusStrip b { margin-top:2px; font-size:10px; }

  #chartTools { top:calc(var(--safe-top) + 2px); right:5px; width:58px; border-radius:15px; }
  .tool-btn { height:43px; font-size:18px; }
  .tool-btn.wide { font-size:9px; letter-spacing:.04em; }
  .tool-btn.menu-tool { height:57px; font-size:9px; }

  #controls { left:7px; right:7px; bottom:calc(var(--safe-bottom) + 4px); gap:5px; }
  .control-card { border-radius:14px; padding:6px 8px; }
  .control-title { margin-bottom:5px; }
  .control-title span { font-size:8px; }
  .control-title strong { font-size:12px; }
  .rudder-hold-grid { gap:5px; grid-template-columns:1.2fr .58fr 1.2fr; }
  .rudder-hold-grid button { min-height:43px; border-radius:10px; }
  .rudder-hold-grid button span { font-size:12px; }
  .rudder-hold-grid button b { margin-top:2px; font-size:6px; letter-spacing:.05em; }
  .range-wrap { margin-top:4px; gap:5px; font-size:9px; }
  .range-wrap input { height:17px; }
  .telegraph-grid { gap:4px; }
  .telegraph-grid button { min-height:35px; border-radius:9px; font-size:7px; line-height:1; }
  #gameBrand { left:10px; bottom:calc(var(--safe-bottom) + 218px); font-size:9px; color:rgba(10,55,63,.68); }
}

@media (orientation:portrait) and (max-width:390px) {
  #topHud { right:65px; }
  #statusStrip { right:65px; }
  #chartTools { width:54px; }
  .tool-btn { height:40px; }
  .tool-btn.menu-tool { height:52px; }
  .rudder-hold-grid button span { font-size:11px; }
  .telegraph-grid button { font-size:6.5px; }
}
'''
css_path.write_text(css, encoding="utf-8")

index = index_path.read_text(encoding="utf-8")
index = re.sub(r'<meta name="app-version" content="[^"]+"', '<meta name="app-version" content="1.6.0"', index)
index = index.replace("v1.5", "v1.6")
index_path.write_text(index, encoding="utf-8")

config = config_path.read_text(encoding="utf-8")
master = "MASTER_MODE: true" in config
config = re.sub(r'VERSION: "[^"]+"', f'VERSION: "1.6.0{"-MASTER" if master else ""}"', config)
config = re.sub(r'CACHE_NAME: "[^"]+"', f'CACHE_NAME: "ep-maneuver-v1.6-{"master" if master else "normal"}"', config)
config_path.write_text(config, encoding="utf-8")

sw = sw_path.read_text(encoding="utf-8")
sw = re.sub(r'const CACHE_NAME = "[^"]+";', f'const CACHE_NAME = "ep-maneuver-v1.6-{"master" if master else "normal"}";', sw)
sw_path.write_text(sw, encoding="utf-8")

readme = readme_path.read_text(encoding="utf-8")
readme = readme.replace("## v1.5", "## v1.6")
if "Gerçekçi kıvrımlı" not in readme:
    readme = readme.replace("## v1.6\n", "## v1.6\n\n- Gerçekçi kıvrımlı ECDIS derinlik konturları ve lateral şamandıralar\n- Mobil dik ekranda kompakt HUD ve daha geniş oyun alanı\n")
readme_path.write_text(readme, encoding="utf-8")

print("v1.6 patch applied", "MASTER" if master else "NORMAL")
