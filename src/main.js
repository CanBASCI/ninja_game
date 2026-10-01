import * as THREE from "three";
import {
  createScene,
  LAYER_CHAR,
  createInput,
  createSceneMenu,
  createAssetEditor,
  sceneSettings,
} from "./scene/index.js";
import {
  createMainChar,
  PLAYER_DAMAGE,
} from "./main_char/index.js";
import { createEnemy, createBomber, ENEMY_DAMAGE, BOMBER_BLAST_RADIUS } from "./enemy/index.js";
import { createHitSparkFx } from "./fx/hitSpark.js";
import { createParryClashFx } from "./fx/parryClash.js";
import { createSoftSeparationSystem } from "./combat/softSeparation.js";
import { createPerfMonitor, logPackStats } from "./scene/perfLog.js";

const statusEl = document.getElementById("status");
const animEl = document.getElementById("anim");
const helpEl = document.getElementById("help");
const hudTitleEl = document.querySelector("#hud h1");
const menuToggleBtn = document.getElementById("menuToggle");
const editorToggleBtn = document.getElementById("editorToggle");
const clearPlacementsBtn = document.getElementById("clearPlacementsBtn");
const assetEditorPanel = document.getElementById("assetEditorPanel");

function syncMenuToggle() {
  const open = !document.body.classList.contains("menus-hidden");
  if (menuToggleBtn) {
    menuToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
    menuToggleBtn.title = open ? "Menüleri kapat" : "Menüleri aç";
  }
}

function syncEditorToggle() {
  const open = !document.body.classList.contains("editor-hidden");
  if (editorToggleBtn) {
    editorToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
    editorToggleBtn.title = open ? "Asset Editor kapat" : "Asset Editor aç";
  }
  if (assetEditorPanel) {
    if (open) assetEditorPanel.removeAttribute("hidden");
    else assetEditorPanel.setAttribute("hidden", "");
  }
}

menuToggleBtn?.addEventListener("click", () => {
  document.body.classList.toggle("menus-hidden");
  syncMenuToggle();
});
syncMenuToggle();

editorToggleBtn?.addEventListener("click", () => {
  document.body.classList.toggle("editor-hidden");
  const open = !document.body.classList.contains("editor-hidden");
  syncEditorToggle();
  if (!open) {
    assetEditor?.setEnabled?.(false);
  } else {
    assetEditor?.setEnabled?.(true);
    sceneMenu?.syncAssetEditorUi?.();
  }
});
syncEditorToggle();

clearPlacementsBtn?.addEventListener("click", () => {
  const ok = window.confirm(
    "Kayıtlı Scene2/Scene3 yerleşimlerini silip sayfayı yenile?\n(localStorage — builtin sahne kalır)",
  );
  if (!ok) return;
  try {
    localStorage.removeItem("ninja_scene2_placements");
    localStorage.removeItem("ninja_scene3_placements");
  } catch (err) {
    console.warn("placements clear:", err);
  }
  location.reload();
});

const HELP_MAIN = `
  <div><b>Hareket</b> · <kbd>A</kbd>/<kbd>D</kbd> ←/→ yürü · <kbd>Shift</kbd> koş · <kbd>Ctrl</kbd> sprint · <kbd>↓</kbd>/<kbd>S</kbd> eğil · ←/→ ile eğilerek yürü · kılıç eldeyken savaş yürü · <kbd>G</kbd> taşı</div>
  <div><b>Zıpla / parkour</b> · <kbd>↑</kbd>/<kbd>W</kbd> zıpla (havada tekrar = çift zıpla) · koşarken <kbd>↓</kbd> slide · koşarak engel → otomatik vault/roll · <kbd>Space</kbd>/<kbd>R</kbd> elle vault</div>
  <div><b>Kılıçlı</b> · <kbd>J</kbd> savurma · <kbd>K</kbd> thrust · <kbd>L</kbd> çift bıçak spin · <kbd>E</kbd> rastgele J/K/L · splash enemy’ye değince isabet</div>
  <div><b>Kılıçsız</b> · <kbd>X</kbd> kına · <kbd>J</kbd> yumruk · <kbd>K</kbd> flying kick · <kbd>L</kbd> tekmeler sırayla · <kbd>E</kbd> rastgele punch/kick</div>
  <div><b>Savunma</b> · <kbd>F</kbd> vuruş anında bas = perfect parry (~0.3sn pencere; basılı bekleyince olmaz) · <kbd>P</kbd> öl / kalk</div>
  <div><b>Özel</b> · <kbd>1</kbd> yüz · suda otomatik yüz · <kbd>3</kbd> dikey ip (çık → bekle → tekrar 3 in) · <kbd>4</kbd> salıncak ipi (45° kanca · tekrar 4 / ↓ bırak · W zıpla) · engellerden sonra su</div>
`;

const HELP_ENEMY = `
  <div><b>Hareket</b> · <kbd>A</kbd>/<kbd>D</kbd> ←/→ yürü · <kbd>Shift</kbd>/<kbd>Ctrl</kbd> charge koşu</div>
  <div><b>Zıpla</b> · <kbd>↑</kbd>/<kbd>W</kbd> zıpla (havada tekrar = çift zıpla)</div>
  <div><b>Saldırı</b> · <kbd>J</kbd> yumruk · <kbd>L</kbd> silah combo · <kbd>K</kbd> kalkan itme</div>
  <div><b>Test</b> · Sahne → <b>enemy ölüm test</b> · kılıç splash enemy’ye değerse isabet</div>
`;

function setStatus(text) {
  statusEl.textContent = text;
}
function setAnimLabel(name) {
  animEl.textContent = `Animasyon: ${name}`;
}

function applyControlHud(control) {
  const isEnemy = control === "enemy";
  if (hudTitleEl) {
    hudTitleEl.textContent = isEnemy ? "enemy_with_knife" : "Ninja Test";
  }
  if (helpEl) {
    helpEl.innerHTML = isEnemy ? HELP_ENEMY : HELP_MAIN;
  }
  setStatus(
    isEnemy
      ? "Kontrol: enemy_with_knife · A/D yürü · Shift koş · W zıpla · J/L/K saldırı"
      : "Kontrol: Main Char",
  );
}

const { keys, input } = createInput();
const {
  scene,
  camera,
  renderer,
  envHemi,
  envSun,
  barriers,
  limboBarrier,
  waterZone,
  pack2Root,
  pack2Api,
  pack3Root,
  pack3Api,
  staticReady,
  setWorldPack,
  getWorldPack,
  updateWorld,
  bakeEnvShadows,
  onResize,
  render,
} = createScene();

let enemyRef = null;

const assetEditor = createAssetEditor({
  scene,
  camera,
  renderer,
  pack2Root,
  pack3Root,
  barriers,
  limboBarrier,
  getLayers: () => {
    const pack = sceneSettings.worldPack;
    if (pack === "3") {
      return (
        pack3Api?.getLayers?.() || {
          root: pack3Root,
          mid: pack3Root,
          far: pack3Root,
        }
      );
    }
    return (
      pack2Api?.getLayers?.() || {
        root: pack2Root,
        mid: pack2Root,
        far: pack2Root,
      }
    );
  },
  onChange: () => {
    sceneMenu?.syncAssetEditorUi?.();
  },
});

const sceneMenu = createSceneMenu({
  scene,
  renderer,
  envHemi,
  envSun,
  limboBarrier,
  setWorldPack,
  bakeEnvShadows,
  assetEditor,
  onWorldPackChange: (pack) => {
    const props =
      pack === "3" ? pack3Api?.getEditableProps?.() || [] : null;
    assetEditor.setActivePack?.(pack, props).then(() => {
      sceneMenu?.syncAssetEditorUi?.();
    });
  },
  onControlChange: (control) => {
    applyControlHud(control);
  },
  onEnemyDieTest: () => {
    if (!enemyRef) return;
    if (enemyRef.dead) {
      enemyRef.resetAlive();
      setStatus("enemy_with_knife · yeniden ayakta");
      return;
    }
    enemyRef.playDie();
    setStatus("enemy_with_knife · ölüm animasyonu");
  },
});
sceneMenu.buildScenePanel();
sceneMenu.buildAssetEditorPanel();

// Builtin sahne prop’larını editöre al + storage
Promise.all([assetEditor.ready, staticReady])
  .then(() => {
    const pack = sceneSettings.worldPack === "3" ? "3" : "2";
    const props =
      pack === "3"
        ? pack3Api?.getEditableProps?.() || []
        : pack2Api?.getEditableProps?.() || [];
    return assetEditor.bootstrap(props, pack);
  })
  .then(() => {
    sceneMenu.syncAssetEditorUi?.();
    console.log("%c[PERF] staticReady — pack karşılaştırması", "color:#8cf;font-weight:bold");
    if (pack2Root) logPackStats("ScenePack2", pack2Root);
    if (pack3Root) logPackStats("ScenePack3", pack3Root);
    perf.dumpNow();
  })
  .catch((err) => console.warn("assetEditor bootstrap:", err));

const mainChar = createMainChar({
  scene,
  camera,
  barriers,
  waterZone,
  keys,
  input,
  layerChar: LAYER_CHAR,
  setStatus,
  setAnimLabel,
  envSun,
});

const enemy = createEnemy({
  scene,
  camera,
  keys,
  input,
  barriers,
  layerChar: LAYER_CHAR,
  envSun,
  setAnimLabel,
  getTargetX: () =>
    mainChar.isRopeAirborne
      ? null
      : (mainChar.character?.position.x ?? null),
  getIsCrouching: () => !!mainChar.isCrouching,
});
enemyRef = enemy;

const bomber = createBomber({
  scene,
  barriers,
  layerChar: LAYER_CHAR,
  setAnimLabel,
  getTargetX: () =>
    mainChar.isRopeAirborne
      ? null
      : (mainChar.character?.position.x ?? null),
  getIsCrouching: () => !!mainChar.isCrouching,
  onExplode: (pos) => {
    const pc = mainChar.character;
    if (!pc) return;
    if (!mainChar.canTakeDamage) return;
    const dist = Math.abs(pc.position.x - pos.x);
    if (dist > BOMBER_BLAST_RADIUS) return;
    mainChar.takeDamage?.(PLAYER_DAMAGE.bomber);
    hitSparkFx.spawn(
      new THREE.Vector3(pc.position.x, 1.1, 0),
      { color: 0xff8a30, count: 12 },
    );
  },
});

const clock = new THREE.Clock();
let enemyHitCooldown = 0;
let playerHitCooldown = 0;
let parryKnockCooldown = 0;
const hitSparkFx = createHitSparkFx(scene);
const parryClashFx = createParryClashFx(scene);
const softSep = createSoftSeparationSystem(scene, { layer: LAYER_CHAR });

const perf = createPerfMonitor({
  renderer,
  scene,
  getPack: () => getWorldPack?.() ?? sceneSettings.worldPack,
  packRoots: { "1": null, "2": pack2Root, "3": pack3Root },
});

window.addEventListener("resize", onResize);

function hitDamageFor(target) {
  let damage = mainChar.katanaDrawn
    ? ENEMY_DAMAGE.armed
    : ENEMY_DAMAGE.unarmed;
  const pc = mainChar.character;
  if (!pc || !target?.character) return damage;
  const dx = pc.position.x - target.character.position.x;
  const face = target.facing ?? 1;
  if (Math.abs(dx) > 0.15 && dx * face < 0) damage *= 2;
  return damage;
}

function tryHitEnemy(dt) {
  enemyHitCooldown = Math.max(0, enemyHitCooldown - dt);
  if (enemyHitCooldown > 0) return;
  if (sceneSettings.control !== "main") return;
  if (enemy.dead) return;
  const ec = enemy.character;
  const pc = mainChar.character;
  if (!ec || !pc) return;
  if (!mainChar.swordTrailHits(ec)) return;
  const damage = hitDamageFor(enemy);
  const dx = pc.position.x - ec.position.x;
  const face = enemy.facing ?? 1;
  if (enemy.playHit(damage)) {
    enemyHitCooldown = 0.5;
    const backstab = Math.abs(dx) > 0.15 && dx * face < 0;
    hitSparkFx.spawn(
      new THREE.Vector3((pc.position.x + ec.position.x) * 0.5, 1.2, 0),
      { color: backstab ? 0xffe066 : 0xfff2c0, count: backstab ? 16 : 11 },
    );
  }
}

let bomberHitCooldown = 0;
function tryHitBomber(dt) {
  bomberHitCooldown = Math.max(0, bomberHitCooldown - dt);
  if (bomberHitCooldown > 0) return;
  if (sceneSettings.control !== "main") return;
  if (bomber.dead) return;
  const bc = bomber.character;
  const pc = mainChar.character;
  if (!bc || !pc || !bc.visible) return;
  if (!mainChar.swordTrailHits(bc)) return;
  // Sadece arkadan — önden yaklaşınca zaten patlıyor
  const dx = pc.position.x - bc.position.x;
  const face = bomber.facing ?? 1;
  const backstab = Math.abs(dx) > 0.15 && dx * face < 0;
  if (!backstab) return;
  const damage = hitDamageFor(bomber);
  if (bomber.playHit?.(damage)) {
    bomberHitCooldown = 0.5;
    hitSparkFx.spawn(
      new THREE.Vector3((pc.position.x + bc.position.x) * 0.5, 1.2, 0),
      { color: 0xffaa44, count: 16 },
    );
  }
}

/** Bıçak düşmanı isabet → oyuncu canı (parry yoksa) */
function tryHitPlayer(dt) {
  playerHitCooldown = Math.max(0, playerHitCooldown - dt);
  if (playerHitCooldown > 0) return;
  if (sceneSettings.control !== "main") return;
  if (enemy.dead) return;
  if (enemy.isStunned) return;
  if (!mainChar.canTakeDamage) return;
  const pc = mainChar.character;
  const ec = enemy.character;
  if (!pc || !ec) return;
  if (!enemy.knifeTrailHits(pc)) return;

  const hitPt =
    enemy.getKnifeHitPoint?.(pc) ||
    new THREE.Vector3(
      (pc.position.x + ec.position.x) * 0.5,
      1.15,
      0,
    );
  hitSparkFx.spawn(hitPt, { color: 0xff6060, count: 10 });
  mainChar.takeDamage(PLAYER_DAMAGE.knife);
  playerHitCooldown = 0.55;
}

/** Perfect: kısa F penceresi → düşman kayar + stun
 *  Bekleyen parry (F basılı, pencere dışı): splash değince SEN kayarsın */
function tryParryKnockback(dt) {
  parryKnockCooldown = Math.max(0, parryKnockCooldown - dt);
  if (parryKnockCooldown > 0) return;
  if (sceneSettings.control !== "main") return;
  if (enemy.dead) return;
  if (enemy.isStunned) return;
  if (!mainChar.isParrying) return;

  const pc = mainChar.character;
  const ec = enemy.character;
  if (!pc || !ec) return;

  // Sadece bakılan yöndeki (önündeki) düşman
  const along = (ec.position.x - pc.position.x) * mainChar.facing;
  if (along < 0.15) return;

  if (!enemy.knifeTrailHits(pc)) return;

  const hitPt =
    enemy.getKnifeHitPoint?.(pc) ||
    new THREE.Vector3(
      (pc.position.x + ec.position.x) * 0.5,
      1.15,
      0,
    );

  if (mainChar.isPerfectParryWindow) {
    // Temas noktasını belirginleştir — perfect parry işareti
    parryClashFx.spawn(hitPt, { color: 0xff9a2e });
    hitSparkFx.spawn(hitPt, { color: 0xffb04a, count: 10 });
    const dir = ec.position.x >= pc.position.x ? 1 : -1;
    enemy.applyParryKnockback(dir);
    enemy.applyParryStun(3);
    parryKnockCooldown = 0.5;
    return;
  }

  // Bekleyen parry: sen geri kay (stun yok)
  hitSparkFx.spawn(hitPt, { color: 0xd0e8ff, count: 8 });
  const dir = pc.position.x >= ec.position.x ? 1 : -1;
  mainChar.applyParryKnockback(dir);
  parryKnockCooldown = 0.45;
}

function animate() {
  requestAnimationFrame(animate);
  const t0 = performance.now();
  const dt = Math.min(clock.getDelta(), 0.05);
  mainChar.updateMixer(dt);
  mainChar.update(dt);
  if (!sceneSettings.enemiesPaused) {
    enemy.updateMixer(dt);
    enemy.update(dt);
    bomber.updateMixer(dt);
    bomber.update(dt);
    softSep.update(dt, {
      player: mainChar.character,
      playerIgnores: !!mainChar.ignoresSoftSeparation,
      playerRunning: !!mainChar.isRunning,
      playerFacing: mainChar.facing ?? 1,
      units: [enemy, bomber],
    });
    tryHitEnemy(dt);
    tryHitBomber(dt);
    tryHitPlayer(dt);
    tryParryKnockback(dt);
  }
  hitSparkFx.update(dt);
  parryClashFx.update(dt);
  const t1 = performance.now();
  updateWorld(camera.position.x);
  const t2 = performance.now();
  render();
  const t3 = performance.now();
  perf.tick(t3 - t0, {
    updateMs: t2 - t1,
    renderMs: t3 - t2,
  });
}

setStatus("Sahne yükleniyor…");

Promise.all([
  mainChar.load(),
  enemy.load({ x: 3.8, face: -1 }),
  bomber.load({ x: -20, face: 1 }),
  staticReady,
])
  .then(() => {
    applyControlHud(sceneSettings.control);
    onResize();
    animate();
  })
  .catch((err) => {
    console.error(err);
    setStatus("Yükleme hatası: " + err.message);
  });
