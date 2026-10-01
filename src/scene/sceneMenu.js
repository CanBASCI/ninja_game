/** Sahne menüsü — gece / gündüz + 2D / 2.5D + kontrol */

export const sceneSettings = {
  mode: "night", // "day" | "night"
  /** "2d" düz yandan · "2.5d" yöne göre kamera/karakter açısı */
  view: "2d",
  /** "main" | "enemy" */
  control: "main",
  /** Limbo alt açıklık (metre) */
  limboClearance: 1.50,
};

const PRESETS = {
  day: {
    bg: 0x87a0c4,
    fog: 0x87a0c4,
    fogNear: 18,
    fogFar: 42,
    hemiSky: 0xddeeff,
    hemiGround: 0x445566,
    hemiI: 1.15,
    sunColor: 0xfff2d6,
    sunI: 1.35,
    sunPos: [6, 12, 4],
    exposure: 1.0,
  },
  night: {
    bg: 0x0a1020,
    fog: 0x0a1020,
    fogNear: 10,
    fogFar: 32,
    hemiSky: 0x1c2740,
    hemiGround: 0x06080f,
    hemiI: 0.28,
    sunColor: 0xb8c8e8,
    sunI: 0.22,
    sunPos: [-5, 11, -4],
    exposure: 0.72,
  },
};

export function createSceneMenu({
  scene,
  renderer,
  envHemi,
  envSun,
  limboBarrier = null,
  onModeChange,
  onViewChange,
  onControlChange,
  onEnemyDieTest,
  onLimboClearanceChange,
}) {
  function applySceneMode(mode = sceneSettings.mode) {
    const p = PRESETS[mode] || PRESETS.day;
    sceneSettings.mode = mode in PRESETS ? mode : "day";

    scene.background?.set?.(p.bg);
    if (scene.fog) {
      scene.fog.color.set(p.fog);
      scene.fog.near = p.fogNear;
      scene.fog.far = p.fogFar;
    }
    if (envHemi) {
      envHemi.color.set(p.hemiSky);
      envHemi.groundColor.set(p.hemiGround);
      envHemi.intensity = p.hemiI;
    }
    if (envSun) {
      envSun.color.set(p.sunColor);
      envSun.intensity = p.sunI;
      envSun.position.set(p.sunPos[0], p.sunPos[1], p.sunPos[2]);
    }
    if (renderer) renderer.toneMappingExposure = p.exposure;

    syncUi();
    onModeChange?.(sceneSettings.mode);
  }

  function setView(view) {
    const next = view === "2d" ? "2d" : "2.5d";
    if (sceneSettings.view === next) {
      syncUi();
      return;
    }
    sceneSettings.view = next;
    syncUi();
    onViewChange?.(sceneSettings.view);
  }

  function setControl(control) {
    const next = control === "enemy" ? "enemy" : "main";
    if (sceneSettings.control === next) {
      syncUi();
      return;
    }
    sceneSettings.control = next;
    syncUi();
    onControlChange?.(sceneSettings.control);
  }

  function setLimboClearance(value) {
    const c = Math.min(2.2, Math.max(0.7, Number(value) || 1.5));
    sceneSettings.limboClearance = c;
    limboBarrier?.setClearance?.(c);
    onLimboClearanceChange?.(c);
    syncUi();
  }

  function syncUi() {
    for (const btn of document.querySelectorAll("#sceneControls [data-mode]")) {
      btn.classList.toggle("active", btn.dataset.mode === sceneSettings.mode);
    }
    for (const btn of document.querySelectorAll("#sceneControls [data-view]")) {
      btn.classList.toggle("active", btn.dataset.view === sceneSettings.view);
    }
    for (const btn of document.querySelectorAll("#sceneControls [data-control]")) {
      btn.classList.toggle(
        "active",
        btn.dataset.control === sceneSettings.control,
      );
    }
    const slider = document.getElementById("limboClearance");
    const valEl = document.getElementById("limboClearanceVal");
    if (slider) slider.value = String(sceneSettings.limboClearance);
    if (valEl) valEl.textContent = sceneSettings.limboClearance.toFixed(2);
  }

  function buildScenePanel() {
    const root = document.getElementById("sceneControls");
    if (!root) return;

    root.innerHTML = `
      <div class="scene-mode-row">
        <button type="button" data-mode="day">Gündüz</button>
        <button type="button" data-mode="night">Gece</button>
      </div>
      <p class="hint scene-subhint">Kamera</p>
      <div class="scene-mode-row">
        <button type="button" data-view="2d">2D</button>
        <button type="button" data-view="2.5d">2.5D</button>
      </div>
      <p class="hint scene-subhint">Kontrol</p>
      <div class="scene-mode-row">
        <button type="button" data-control="main">Main Char</button>
        <button type="button" data-control="enemy">enemy_with_knife</button>
      </div>
      <p class="hint scene-subhint">Limbo yüksekliği <span id="limboClearanceVal">1.50</span>m</p>
      <div class="scene-slider-row">
        <input type="range" id="limboClearance" min="0.7" max="2.2" step="0.05" value="1.50" />
      </div>
      <button type="button" id="enemyDieTest" class="scene-full-btn">enemy ölüm test</button>
    `;

    for (const btn of root.querySelectorAll("[data-mode]")) {
      btn.addEventListener("click", () => {
        applySceneMode(btn.dataset.mode);
      });
    }
    for (const btn of root.querySelectorAll("[data-view]")) {
      btn.addEventListener("click", () => {
        setView(btn.dataset.view);
      });
    }
    for (const btn of root.querySelectorAll("[data-control]")) {
      btn.addEventListener("click", () => {
        setControl(btn.dataset.control);
      });
    }
    document.getElementById("enemyDieTest")?.addEventListener("click", () => {
      onEnemyDieTest?.();
    });
    document.getElementById("limboClearance")?.addEventListener("input", (e) => {
      setLimboClearance(e.target.value);
    });

    applySceneMode(sceneSettings.mode);
    setLimboClearance(sceneSettings.limboClearance);
    syncUi();
  }

  return {
    buildScenePanel,
    applySceneMode,
    setView,
    setControl,
    setLimboClearance,
    sceneSettings,
  };
}
