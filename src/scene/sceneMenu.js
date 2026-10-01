/** Sahne menüsü — gece / gündüz + Scene 1/2/3 + 2D / 2.5D + kontrol + asset editor */

import { ASSET_CATALOG, ASSET_GROUPS } from "./assetEditor.js";

export const sceneSettings = {
  mode: "night", // "day" | "night"
  /** "1" mevcut · "2" gece cobble · "3" sakura vadisi */
  worldPack: "3",
  /** "2d" düz yandan · "2.5d" yöne göre kamera/karakter açısı */
  view: "2d",
  /** "main" | "enemy" */
  control: "main",
  /** Limbo alt açıklık (metre) */
  limboClearance: 1.5,
  /** Asset editor — düşman AI/anim dondur */
  enemiesPaused: true,
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

/** Scene 2 gece — ShipGame hissi: ışık ay göbeğinden */
const PRESETS_PACK2_NIGHT = {
  bg: 0x05010c,
  fog: 0x0c0612,
  fogNear: 8,
  fogFar: 28,
  hemiSky: 0x0a0c12,
  hemiGround: 0x030305,
  /** 0 — hemi kameraya bakan gövdeyi fill ediyordu */
  hemiI: 0,
  sunColor: 0xdce8ff,
  sunI: 0.62,
  /** Ay sprite ile aynı yön (−X / yukarı / −Z) */
  sunPos: [-4, 12.2, -22],
  exposure: 0.82,
};

/** Scene 3 — mor / pembe gece paleti (sakura) */
const PRESETS_PACK3_NIGHT = {
  bg: 0x0a0414,
  fog: 0x140818,
  fogNear: 8,
  fogFar: 30,
  hemiSky: 0x180c20,
  hemiGround: 0x060308,
  hemiI: 0.08,
  sunColor: 0xffd0e8,
  sunI: 0.55,
  /** Ay sprite ile aynı yön (layout Scene2) */
  sunPos: [-4, 12.2, -22],
  exposure: 0.88,
};

export function createSceneMenu({
  scene,
  renderer,
  envHemi,
  envSun,
  limboBarrier = null,
  setWorldPack = null,
  bakeEnvShadows = null,
  assetEditor = null,
  onModeChange,
  onViewChange,
  onControlChange,
  onWorldPackChange,
  onEnemyDieTest,
  onLimboClearanceChange,
}) {
  function applySceneMode(mode = sceneSettings.mode) {
    sceneSettings.mode = mode in PRESETS ? mode : "day";
    let p = PRESETS[sceneSettings.mode] || PRESETS.day;
    if (sceneSettings.worldPack === "2" && sceneSettings.mode === "night") {
      p = PRESETS_PACK2_NIGHT;
    } else if (
      sceneSettings.worldPack === "3" &&
      sceneSettings.mode === "night"
    ) {
      p = PRESETS_PACK3_NIGHT;
    }

    scene.background?.set?.(p.bg);
    if (scene.fog) {
      scene.fog.color.set(p.fog);
      if (scene.fog.isFogExp2) {
        if (sceneSettings.mode === "night" && sceneSettings.worldPack === "3") {
          scene.fog.density = 0.028;
        } else if (
          sceneSettings.mode === "night" &&
          sceneSettings.worldPack === "2"
        ) {
          scene.fog.density = 0.034;
        } else {
          scene.fog.density = 0.02;
        }
      } else {
        scene.fog.near = p.fogNear;
        scene.fog.far = p.fogFar;
      }
    }
    if (envHemi) {
      envHemi.color.set(p.hemiSky);
      envHemi.groundColor.set(p.hemiGround);
      envHemi.intensity = p.hemiI;
    }
    if (envSun) {
      envSun.color.set(p.sunColor);
      envSun.intensity = p.sunI;
      const [sx, sy, sz] = p.sunPos;
      envSun.userData.lightOffset = { x: sx, y: sy, z: sz };
      bakeEnvShadows?.();
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

  function setWorld(pack) {
    const next = pack === "3" ? "3" : pack === "2" ? "2" : "1";
    const prev = sceneSettings.worldPack;
    sceneSettings.worldPack = next;
    setWorldPack?.(next);
    applySceneMode(sceneSettings.mode);
    syncUi();
    onWorldPackChange?.(next);
    if (prev !== next && typeof window !== "undefined") {
      console.log(
        `%c[PERF] pack switch ${prev} → ${next}`,
        "color:#fa0;font-weight:bold",
      );
      window.__perfDump?.();
    }
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
    for (const btn of document.querySelectorAll("#sceneControls [data-pack]")) {
      btn.classList.toggle("active", btn.dataset.pack === sceneSettings.worldPack);
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

    syncAssetEditorUi();
  }

  async function copyText(text, btn, label) {
    try {
      await navigator.clipboard.writeText(text);
      if (btn) {
        const prev = btn.textContent;
        btn.textContent = "Kopyalandı!";
        setTimeout(() => {
          btn.textContent = label || prev;
        }, 1200);
      }
    } catch {
      console.log(text);
      alert(text);
    }
  }

  function fillAssetSelect() {
    const groupEl = document.getElementById("aeGroup");
    const assetEl = document.getElementById("aeAsset");
    if (!groupEl || !assetEl) return;
    const group = groupEl.value || ASSET_GROUPS[0];
    const items = ASSET_CATALOG.filter((c) => c.group === group);
    assetEl.innerHTML = items
      .map(
        (c) =>
          `<option value="${c.path}">${c.label || c.path.split("/").pop()}</option>`,
      )
      .join("");
  }

  function syncAssetEditorUi() {
    if (!assetEditor) return;
    const toggle = document.getElementById("aeToggle");
    if (toggle) {
      toggle.classList.toggle("active", assetEditor.isEnabled());
      toggle.textContent = assetEditor.isEnabled()
        ? "Editör Açık"
        : "Editör Kapalı";
    }

    const pauseBtn = document.getElementById("aePauseEnemies");
    if (pauseBtn) {
      pauseBtn.classList.toggle("active", !!sceneSettings.enemiesPaused);
      pauseBtn.textContent = sceneSettings.enemiesPaused
        ? "Düşmanlar Pause · Aç"
        : "Düşmanları Pause";
    }

    const mode = assetEditor.getTransformMode?.() || "translate";
    for (const btn of document.querySelectorAll("#aeGizmoMode [data-gizmo]")) {
      btn.classList.toggle("active", btn.dataset.gizmo === mode);
    }

    const listEl = document.getElementById("aeList");
    if (listEl) {
      const items = assetEditor.listPlacements();
      const sel = assetEditor.getSelected();
      listEl.innerHTML = items.length
        ? items
            .map((p) => {
              const name = p.path.split("/").pop();
              const active = sel?.id === p.id ? "active" : "";
              return `<button type="button" class="ae-list-item ${active}" data-id="${p.id}">${name}<span>${p.id}</span></button>`;
            })
            .join("")
        : `<p class="hint ae-empty">Henüz yerleşim yok</p>`;
      for (const btn of listEl.querySelectorAll("[data-id]")) {
        btn.addEventListener("click", () => {
          assetEditor.setSelected(btn.dataset.id);
        });
      }
    }

    const sel = assetEditor.getSelected();
    const fields = document.getElementById("aeFields");
    if (fields) fields.style.opacity = sel ? "1" : "0.45";
    if (!sel) return;

    setNum("aePosX", sel.position[0]);
    setNum("aePosY", sel.position[1]);
    setNum("aePosZ", sel.position[2]);
    setNum("aeRotX", sel.rotation[0]);
    setNum("aeRotY", sel.rotation[1]);
    setNum("aeRotZ", sel.rotation[2]);
    setNum("aeScaleX", sel.scale[0]);
    setNum("aeScaleY", sel.scale[1]);
    setNum("aeScaleZ", sel.scale[2]);
    const parentEl = document.getElementById("aeParent");
    if (parentEl) parentEl.value = sel.parent || "root";
    const roleEl = document.getElementById("aeRole");
    if (roleEl) roleEl.value = sel.role || "decor";
  }

  function setNum(id, v) {
    const el = document.getElementById(id);
    if (!el) return;
    if (document.activeElement === el) return;
    el.value = String(Number(v).toFixed(3));
  }

  function readSelectedPatchFromUi() {
    return {
      position: [
        Number(document.getElementById("aePosX")?.value) || 0,
        Number(document.getElementById("aePosY")?.value) || 0,
        Number(document.getElementById("aePosZ")?.value) || 0,
      ],
      rotation: [
        Number(document.getElementById("aeRotX")?.value) || 0,
        Number(document.getElementById("aeRotY")?.value) || 0,
        Number(document.getElementById("aeRotZ")?.value) || 0,
      ],
      scale: [
        Number(document.getElementById("aeScaleX")?.value) || 1,
        Number(document.getElementById("aeScaleY")?.value) || 1,
        Number(document.getElementById("aeScaleZ")?.value) || 1,
      ],
      parent: document.getElementById("aeParent")?.value || "root",
      role: document.getElementById("aeRole")?.value || "decor",
    };
  }

  function wireAssetEditor() {
    if (!assetEditor) return;

    document.getElementById("aeToggle")?.addEventListener("click", () => {
      assetEditor.setEnabled(!assetEditor.isEnabled());
      syncAssetEditorUi();
    });

    document.getElementById("aePauseEnemies")?.addEventListener("click", () => {
      sceneSettings.enemiesPaused = !sceneSettings.enemiesPaused;
      syncAssetEditorUi();
    });

    const groupEl = document.getElementById("aeGroup");
    if (groupEl) {
      groupEl.innerHTML = ASSET_GROUPS.map(
        (g) => `<option value="${g}">${g}</option>`,
      ).join("");
      groupEl.addEventListener("change", fillAssetSelect);
      fillAssetSelect();
    }

    document.getElementById("aeAdd")?.addEventListener("click", async () => {
      const path = document.getElementById("aeAsset")?.value;
      if (!path) return;
      if (!assetEditor.isEnabled()) assetEditor.setEnabled(true);
      try {
        await assetEditor.addFromCatalog(path);
      } catch (err) {
        console.warn(err);
        alert("Asset yüklenemedi: " + (err?.message || err));
      }
    });

    for (const btn of document.querySelectorAll("#aeGizmoMode [data-gizmo]")) {
      btn.addEventListener("click", () => {
        assetEditor.setTransformMode(btn.dataset.gizmo);
        syncAssetEditorUi();
      });
    }

    const applyUi = () => {
      if (!assetEditor.getSelected()) return;
      assetEditor.updateSelected(readSelectedPatchFromUi());
    };

    for (const id of [
      "aePosX",
      "aePosY",
      "aePosZ",
      "aeRotX",
      "aeRotY",
      "aeRotZ",
      "aeScaleX",
      "aeScaleY",
      "aeScaleZ",
      "aeParent",
      "aeRole",
    ]) {
      document.getElementById(id)?.addEventListener("change", applyUi);
      document.getElementById(id)?.addEventListener("input", applyUi);
    }

    document.getElementById("aeUniform")?.addEventListener("input", (e) => {
      const v = Number(e.target.value) || 1;
      for (const id of ["aeScaleX", "aeScaleY", "aeScaleZ"]) {
        const el = document.getElementById(id);
        if (el) el.value = String(v);
      }
      applyUi();
    });

    document.getElementById("aeCopyAll")?.addEventListener("click", () => {
      copyText(
        assetEditor.getExportJson(),
        document.getElementById("aeCopyAll"),
        "Copy All",
      );
    });
    document.getElementById("aeCopySel")?.addEventListener("click", () => {
      const sel = assetEditor.getSelected();
      if (!sel) {
        alert("Önce bir yerleşim seç");
        return;
      }
      copyText(
        assetEditor.getExportJson(sel.id),
        document.getElementById("aeCopySel"),
        "Copy Selected",
      );
    });
    document.getElementById("aeDelete")?.addEventListener("click", () => {
      assetEditor.removeSelected();
    });
    document.getElementById("aeClear")?.addEventListener("click", () => {
      if (confirm("Tüm editör yerleşimleri silinsin mi?")) {
        assetEditor.clearAll();
      }
    });
  }

  function buildScenePanel() {
    const root = document.getElementById("sceneControls");
    if (!root) return;

    root.innerHTML = `
      <div class="scene-mode-row">
        <button type="button" data-mode="day">Gündüz</button>
        <button type="button" data-mode="night">Gece</button>
      </div>
      <p class="hint scene-subhint">Sahne</p>
      <div class="scene-mode-row">
        <button type="button" data-pack="1">Scene 1</button>
        <button type="button" data-pack="2">Scene 2</button>
        <button type="button" data-pack="3">Scene 3</button>
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
    for (const btn of root.querySelectorAll("[data-pack]")) {
      btn.addEventListener("click", () => {
        setWorld(btn.dataset.pack);
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

    setWorld(sceneSettings.worldPack);
    setLimboClearance(sceneSettings.limboClearance);
    syncUi();
  }

  function buildAssetEditorPanel() {
    const root = document.getElementById("assetEditorControls");
    if (!root || !assetEditor) return;

    root.innerHTML = `
      <p class="hint scene-subhint">Gizmo: sürükle taşı · T/R/G · tıkla seç · Copy → sohbete yapıştır</p>
      <button type="button" id="aeToggle" class="scene-full-btn ae-toggle">Editör Kapalı</button>
      <button type="button" id="aePauseEnemies" class="scene-full-btn ae-pause">Düşmanları Pause</button>
      <div class="scene-mode-row" id="aeGizmoMode">
        <button type="button" data-gizmo="translate">Move</button>
        <button type="button" data-gizmo="rotate">Rotate</button>
        <button type="button" data-gizmo="scale">Scale</button>
      </div>
      <label class="ae-label">Grup
        <select id="aeGroup"></select>
      </label>
      <label class="ae-label">Asset
        <select id="aeAsset"></select>
      </label>
      <button type="button" id="aeAdd" class="scene-full-btn">Ekle</button>
      <div id="aeList" class="ae-list"></div>
      <div id="aeFields" class="ae-fields">
        <label class="ae-label">Layer (export · mid/far parallax; editörde kaymaz)
          <select id="aeParent">
            <option value="root">root</option>
            <option value="mid">mid (Z≈-8)</option>
            <option value="far">far (Z≈-16)</option>
          </select>
        </label>
        <label class="ae-label">Role
          <select id="aeRole">
            <option value="decor">decor</option>
            <option value="vault">vault</option>
            <option value="limbo">limbo</option>
            <option value="climbVisual">climbVisual</option>
            <option value="zone">zone</option>
          </select>
        </label>
        <p class="hint scene-subhint">Position</p>
        <div class="ae-xyz">
          <input id="aePosX" type="number" step="0.05" title="X" />
          <input id="aePosY" type="number" step="0.05" title="Y" />
          <input id="aePosZ" type="number" step="0.05" title="Z" />
        </div>
        <p class="hint scene-subhint">Rotation (deg)</p>
        <div class="ae-xyz">
          <input id="aeRotX" type="number" step="1" title="RX" />
          <input id="aeRotY" type="number" step="1" title="RY" />
          <input id="aeRotZ" type="number" step="1" title="RZ" />
        </div>
        <p class="hint scene-subhint">Scale · uniform <input id="aeUniform" type="number" step="0.05" value="1" class="ae-uni" /></p>
        <div class="ae-xyz">
          <input id="aeScaleX" type="number" step="0.05" title="SX" />
          <input id="aeScaleY" type="number" step="0.05" title="SY" />
          <input id="aeScaleZ" type="number" step="0.05" title="SZ" />
        </div>
      </div>
      <div class="scene-mode-row ae-copy-row">
        <button type="button" id="aeCopyAll">Copy All</button>
        <button type="button" id="aeCopySel">Copy Selected</button>
      </div>
      <div class="scene-mode-row">
        <button type="button" id="aeDelete">Sil</button>
        <button type="button" id="aeClear">Clear All</button>
      </div>
    `;

    wireAssetEditor();
    syncAssetEditorUi();
  }

  return {
    buildScenePanel,
    buildAssetEditorPanel,
    applySceneMode,
    setView,
    setControl,
    setWorld,
    setLimboClearance,
    syncAssetEditorUi,
    sceneSettings,
  };
}
