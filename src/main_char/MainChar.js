import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  ANIM,
  JUMP_ANIMS,
  LOOPING,
  MOVE_SPEED,
  FIGHT_MOVE_SCALE,
  MODEL_URL,
  FIGHT_URL,
  CLIMB_URL,
  KATANA_URL,
  KATANA_SHEATH_URL,
  KATANA_SHEATH_WITH_KATANA_URL,
  VAULT_MAX_DIST,
  CHAR_RADIUS,
  ANIM_SPEED,
  PLAYER_MAX_HP,
} from "./anims.js";
import {
  createLookController,
  createSheathController,
  createSheathFullController,
  lookSimple,
  applySheathPose,
  applySheathFullPose,
} from "./look.js";
import { createSwordTrail } from "./swordTrail.js";
import { createRopeHookFx } from "../fx/ropeHook.js";
import { createSlideDustFx } from "../fx/slideDust.js";
import { createRunDustFx } from "../fx/runDust.js";
import { createDoubleJumpDustFx } from "../fx/doubleJumpDust.js";
import { sceneSettings } from "../scene/sceneMenu.js";
import { getViewCam, facingYaw } from "../scene/viewMode.js";
import { findRopeLatch } from "../scene/ropeAnchors.js";
import {
  dynamicShadowCast,
  wantsDynamicKeyShadow,
  applyCasterPolicy,
  applyDynamicCharEnv,
  applyShadowFrustum,
  anchorLightToShadowVolume,
  getAllowDynamicShadows,
} from "../scene/shadowPolicy.js";

/**
 * Ana oyuncu karakteri.
 * Dünya (sahne, engeller, kamera) dışarıdan verilir — enemy için aynı kalıp kullanılabilir.
 */
export function createMainChar(world) {
  const {
    scene,
    camera,
    barriers,
    waterZone = null,
    keys,
    input,
    layerChar,
    setStatus,
    setAnimLabel,
    envSun,
  } = world;

  const characterMaterials = [];
  let baseCharacterColors = [];

  let mixer = null;
  const actions = {};
  let currentAction = null;
  let currentAnimName = "";
  let character = null;
  let visual = null;
  let groundOffset = null;
  let katana = null;
  let katanaSheath = null;
  let katanaSheathFull = null;
  let sheathEmptyProp = null;
  let sheathFullProp = null;
  let sheathFullTwist = null;
  let sheathFullBaseScale = 1;
  /** true = kılıç elde + boş kılıf · default: kınında */
  let katanaDrawn = false;

  const swordTrail = createSwordTrail(scene);
  const limbTrailL = createSwordTrail(scene);
  const limbTrailR = createSwordTrail(scene);
  let katanaTipMarker = null;
  let katanaBaseMarker = null;
  /** Punch/kick splash uçları */
  let handTipL = null;
  let handBaseL = null;
  let handTipR = null;
  let handBaseR = null;
  let footTipL = null;
  let footBaseL = null;
  let footTipR = null;
  let footBaseR = null;

  let rightHandBone = null;
  let leftHandBone = null;
  let baseVisualY = 0;
  let hipsBone = null;
  let idleHipsY = null;
  const footBones = [];
  const handBones = [];
  const _footPos = new THREE.Vector3();
  const _handAvg = new THREE.Vector3();
  const _bonePos = new THREE.Vector3();
  const DIE_GROUND_PAD = 0.06;
  let facing = 1;
  /** Kamera / karakter açı yumuşatma (−1…1) */
  let smoothFacing = 1;
  /** Görsel yaw — facing anında değişir, dönüş yumuşak */
  let displayYaw = facingYaw(1);
  /** Dönüş hızı (düşük = daha yavaş) */
  const FACING_TURN_RATE = 6;
  let velocityY = 0;
  let grounded = true;
  /** Havada ikinci zıplama hakkı */
  let canDoubleJump = true;
  let busyUntil = 0;
  let forcedAnim = null;
  let dead = false;
  let hp = PLAYER_MAX_HP;
  const hpWrap = document.getElementById("playerHpWrap");
  const hpFill = document.getElementById("playerHpFill");
  const damageFlashEl = document.getElementById("damageFlash");
  const _hpWorld = new THREE.Vector3();
  /** 1 → 0 hasar kırmızı flaş */
  let hurtFlash = 0;
  let knockbackVel = 0;
  /** Parry: F’ye basıldığı an (perfect pencere için) */
  let parryStartedAt = 0;
  const PARRY_PERFECT_MS = 300;
  let modelScale = 1;
  const rootMotionCurves = {};
  let prevRootZ = null;
  let vaultYScale = 1;
  let vaultTargetBarrier = null;
  let vaultHandTargetX = null;
  let vaultHandTargetY = null;
  /** Vault/roll sırasında korunacak min ileri hız (koşu momentumu) */
  let vaultMomentum = 0;
  /** Vault başındaki bakış — ortada çevirince engel asisti ters tarafa fırlatmasın */
  let vaultFacing = 1;
  /** Otomatik vault — aynı engelde aynı yönden spam olmasın */
  let lastAutoVaultBarrier = null;
  let lastAutoVaultFacing = 0;
  /** Limbo altındayken tuş bırakılsa da engel bitene kadar eğilmeye devam */
  let limboCrouchHold = false;
  /** ground → up → hang → down → land → ground */
  let ropeState = "ground";
  /** Asılıyken sabit lift — her kare yeniden ölçülmesin (titreme) */
  let ropeLiftY = 0;
  let ropeFloorLift = 0;
  let ropeNeedRemeasure = false;
  /** 3’e basıldığı andaki yükseklik (havadan başlayınca yerden sıfırlamasın) */
  let ropeUpFromLift = 0;
  let ropeDescentReady = false;
  let ropeDescentTop = null;
  let ropeLandFrom = 0;
  let ropeLandT = 0;
  /** hang → hang1 yükseklik kilidi (hang1 pozu uygulandıktan sonra) */
  let hangLockPendingRefY = null;
  let hangLockWaitMixer = false;
  /** Saplanan kanca — bir kez kilitlenir, anim boyunca oynamaz */
  const ropeHookAnchor = new THREE.Vector3();
  let ropeHookAnchorSet = false;
  const ropeHookFx = createRopeHookFx(scene, { layer: layerChar });
  const slideDustFx = createSlideDustFx(scene, { layer: layerChar });
  const runDustFx = createRunDustFx(scene, { layer: layerChar });
  const doubleJumpDustFx = createDoubleJumpDustFx(scene, { layer: layerChar });
  /** Yerden zıplama tozu bitiş zamanı (slideDust — zemin) */
  let jumpDustUntil = 0;
  /** Çift zıplama tozu bitiş zamanı (havada ayak) */
  let doubleJumpDustUntil = 0;
  const _ropeHand = new THREE.Vector3();
  const _slideFeet = new THREE.Vector3();

  /** null | fly | swing — 4 tuşu salıncak ipi */
  let swingState = null;
  const swingAnchor = new THREE.Vector3();
  let swingLength = 4;
  let swingFlyT = 0;
  let swingVx = 0;
  let swingVy = 0;
  let airVelX = 0;
  const swingFlyFrom = new THREE.Vector3();
  const SWING_RANGE = 5.5;
  const SWING_MIN_LEN = 2.2;
  const SWING_FLY_DUR = 0.14;
  const SWING_JUMP_BOOST = 5.5;
  const SWING_PIVOT_Y = 1.15;
  /** Jump clip’inin havadaki karesi (0–1) — sallanma pozu */
  const SWING_POSE_T = 0.42;
  /** Backflip: hız aynı, clip’in son kısmı kesilir (~0.68s oynar) */
  const SWING_RELEASE_CUT = 0.68;
  /** Salıncak → backflip / backflip → crouch blend */
  const SWING_START_FADE = 0.14;
  const SWING_TO_CROUCH_FADE = 0.2;

  const JUMP_VY = 9.2;
  const DOUBLE_JUMP_VY = 8.4;
  const GRAVITY = 18;
  /** Yerden ayrıldıktan sonra hâlâ yer zıplaması sayılır */
  const COYOTE_MS = 110;
  let coyoteUntil = 0;
  /** Birbirini kesebilen one-shot hareketler (saldırı / zıpla / parkour / özel)
   *  Kılıçsız punch/kick burada YOK — bitmeden diğeri başlamasın */
  const ACTION_CANCEL = new Set([
    ANIM.jump,
    ANIM.vault,
    ANIM.roll,
    ANIM.slide,
    ANIM.slash,
    ANIM.spin,
    ANIM.thrust,
    ANIM.parry,
    ANIM.swingRelease,
  ]);
  const ATTACK_ANIMS = new Set([
    ANIM.slash,
    ANIM.spin,
    ANIM.thrust,
    ANIM.punch,
    ANIM.kick,
    ANIM.kickAlt,
    ANIM.kickSpartan,
    ANIM.kickHigh,
    ANIM.kickSweep,
  ]);
  const UNARMED_ANIMS = new Set([
    ANIM.punch,
    ANIM.kick,
    ANIM.kickAlt,
    ANIM.kickSpartan,
    ANIM.kickHigh,
    ANIM.kickSweep,
  ]);
  const TRAIL_ANIMS = new Set([ANIM.slash, ANIM.spin, ANIM.thrust]);
  /** Bu one-shot’larda hasar alınmaz */
  const DAMAGE_INVULN = new Set([
    ANIM.slide,
    ANIM.vault,
    ANIM.roll,
    ANIM.swingRelease,
  ]);
  /** J/L/K: segment + reverse combo — sadece kılıçlı */
  const REVERSE_COMBO = {
    [ANIM.slash]: { skip: 1.5, segmentSec: 1.6, fullFirst: false },
    [ANIM.spin]: { skip: 0, segmentSec: 0.8, fullFirst: true },
    [ANIM.thrust]: { skip: 0.4, segmentSec: 1.0, fullFirst: false },
  };
  const UNARMED_KICKS = [
    ANIM.kick,
    ANIM.kickAlt,
    ANIM.kickSpartan,
    ANIM.kickHigh,
    ANIM.kickSweep,
  ];
  let unarmedKickIndex = 0;
  /** Tekme/yumruk: hips XZ kilit (root motion yemesin) */
  let hipsLockXZ = null;
  let comboFlipQueued = false;
  let comboSegmentTarget = null;
  let comboAnim = null;
  let comboSegmenting = false;
  /** E ile başlayan saldırı zinciri */
  let eComboPick = null;
  /** E'de kaç reverse yapıldı — 1'den sonra bitir, sonraki E yeni random */
  let eComboReversals = 0;

  function comboAbsScale(animName) {
    return Math.abs(ANIM_SPEED[animName] ?? 1) || 1;
  }

  function beginComboSegment(animName, forward, fromTime) {
    if (!currentAction) return;
    const cfg = REVERSE_COMBO[animName];
    if (!cfg) return;
    const clipDur = currentAction.getClip().duration;
    const t = THREE.MathUtils.clamp(fromTime, cfg.skip, clipDur);
    const scale = comboAbsScale(animName);
    const seg = cfg.segmentSec * scale;
    currentAction.paused = false;
    currentAction.enabled = true;
    currentAction.time = t;
    comboSegmenting = true;
    if (forward) {
      currentAction.setEffectiveTimeScale(scale);
      comboSegmentTarget = Math.min(clipDur, t + seg);
    } else {
      currentAction.setEffectiveTimeScale(-scale);
      comboSegmentTarget = Math.max(cfg.skip, t - seg);
    }
    const playLen = Math.max(0.05, Math.abs(comboSegmentTarget - t));
    busyUntil = performance.now() + (playLen / scale) * 1000 * 1.05;
    forcedAnim = animName;
    comboAnim = animName;
  }

  function clearCombo() {
    comboFlipQueued = false;
    comboSegmentTarget = null;
    comboAnim = null;
    comboSegmenting = false;
    eComboPick = null;
    eComboReversals = 0;
  }

  function shouldLockHips(name) {
    return (
      !!name &&
      (name === ANIM.punch ||
        name === ANIM.spin ||
        UNARMED_KICKS.includes(name))
    );
  }

  function captureHipsLock() {
    if (!hipsBone) {
      hipsLockXZ = null;
      return;
    }
    hipsLockXZ = { x: hipsBone.position.x, z: hipsBone.position.z };
  }

  function applyHipsLock() {
    if (!hipsBone || !hipsLockXZ || !shouldLockHips(forcedAnim)) return;
    hipsBone.position.x = hipsLockXZ.x;
    hipsBone.position.z = hipsLockXZ.z;
  }

  function endEComboChain() {
    clearCombo();
    busyUntil = 0;
    forcedAnim = null;
  }

  function triggerSpinExtras() {
    prevRootZ = null;
    vaultYScale = 1;
    vaultTargetBarrier = null;
    // Havada / zıplamada dikey hızı kesme (özellikle L reverse combo)
    if (!grounded || character.position.y > 0.04) return;
    velocityY = 0;
    grounded = true;
  }

  function startEAttack() {
    const inCombo =
      eComboPick &&
      forcedAnim === eComboPick &&
      comboAnim === eComboPick;

    let pick;
    if (inCombo) {
      pick = eComboPick;
    } else if (katanaDrawn) {
      const armed = [ANIM.slash, ANIM.spin, ANIM.thrust];
      pick = armed[Math.floor(Math.random() * armed.length)];
      eComboPick = pick;
      eComboReversals = 0;
    } else {
      // Kılıçsız: kesmesiz tam anim, her E yeni rastgele
      const unarmed = [ANIM.punch, ...UNARMED_KICKS];
      pick = unarmed[Math.floor(Math.random() * unarmed.length)];
      eComboPick = null;
      eComboReversals = 0;
      if (playOneShot(pick)) {
        if (UNARMED_KICKS.includes(pick)) triggerSpinExtras();
        return true;
      }
      return false;
    }

    if (startReverseCombo(pick)) {
      if (pick === ANIM.spin) triggerSpinExtras();
      return true;
    }
    if (!inCombo) {
      eComboPick = null;
      eComboReversals = 0;
    }
    return false;
  }

  function updateComboSegment() {
    if (
      !comboAnim ||
      forcedAnim !== comboAnim ||
      !currentAction ||
      comboSegmentTarget == null
    ) {
      return;
    }
    const forward = currentAction.getEffectiveTimeScale() > 0;
    const t = currentAction.time;
    const hit = forward
      ? t >= comboSegmentTarget - 0.001
      : t <= comboSegmentTarget + 0.001;
    if (!hit) return;

    currentAction.time = comboSegmentTarget;

    // E zinciri: ileri → (opsiyonel) 1 reverse → bitir → sonraki E yeni random
    if (eComboPick) {
      if (comboFlipQueued && eComboReversals < 1) {
        comboFlipQueued = false;
        eComboReversals += 1;
        beginComboSegment(comboAnim, !forward, comboSegmentTarget);
        return;
      }
      endEComboChain();
      return;
    }

    if (comboFlipQueued) {
      comboFlipQueued = false;
      beginComboSegment(comboAnim, !forward, comboSegmentTarget);
    } else {
      clearCombo();
      busyUntil = 0;
    }
  }

  function startReverseCombo(animName) {
    const cfg = REVERSE_COMBO[animName];
    if (forcedAnim === animName && currentAction && comboAnim === animName) {
      if (cfg?.fullFirst && !comboSegmenting) {
        // Tam oynatmadan combo'ya geç: önce 1 sn aynı yönde, bitince reverse
        const forward = currentAction.getEffectiveTimeScale() > 0;
        beginComboSegment(animName, forward, currentAction.time);
        comboFlipQueued = true;
      } else {
        comboFlipQueued = true;
      }
      return true;
    }
    if (playOneShot(animName, null, { comboForward: true })) {
      comboFlipQueued = false;
      return true;
    }
    return false;
  }

  function isRunningInput() {
    return (
      keys.has("ShiftLeft") ||
      keys.has("ShiftRight") ||
      keys.has("ControlLeft") ||
      keys.has("ControlRight") ||
      currentAnimName === ANIM.run ||
      currentAnimName === ANIM.sprint
    );
  }

  /** Aktif latch yüksekliği — yoksa ekran tepesi */
  let activeRopeLatchY = null;

  /** Eski sabit asılma: görünür alanın üst bandı */
  function getScreenHangY() {
    const camY = lookSimple.camY ?? 2.75;
    const lookY = lookSimple.lookY ?? 1.75;
    const camZ = lookSimple.zoom;
    const dist = Math.hypot(camZ, camY - lookY);
    const halfH = dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
    return lookY + halfH * 0.85;
  }

  function getRopeHangY() {
    if (activeRopeLatchY != null && Number.isFinite(activeRopeLatchY)) {
      return activeRopeLatchY;
    }
    return getScreenHangY();
  }

  // Karakter ışıkları — ay key + kamera fill (sadece LAYER_CHAR)
  const charHemi = new THREE.HemisphereLight(0x9aa8c4, 0x1c1824, 0.7);
  charHemi.layers.set(layerChar);
  scene.add(charHemi);

  const charSun = new THREE.DirectionalLight(0xdce8ff, 1.0);
  charSun.castShadow = wantsDynamicKeyShadow();
  applyShadowFrustum(charSun, { autoUpdate: true });
  charSun.layers.set(layerChar);
  scene.add(charSun);
  scene.add(charSun.target);

  const charFill = new THREE.DirectionalLight(0xc5d0e8, 0.95);
  charFill.layers.set(layerChar);
  scene.add(charFill);
  scene.add(charFill.target);

  const charRim = new THREE.DirectionalLight(0xb8c8e8, 0.4);
  charRim.layers.set(layerChar);
  scene.add(charRim);
  scene.add(charRim.target);

  const charKey = new THREE.PointLight(0xfff2dd, 0, 16, 1.6);
  charKey.position.set(0, 2.4, 3.5);
  charKey.layers.set(layerChar);
  scene.add(charKey);

  const bootOff = envSun?.userData?.lightOffset || { x: -4, y: 12.2, z: -22 };
  if (envSun?.color) charSun.color.copy(envSun.color);

  function syncCharLightsFromMoon() {
    const off = envSun?.userData?.lightOffset || bootOff;
    anchorLightToShadowVolume(charSun, off);
    if (envSun) charSun.color.copy(envSun.color);
    // Bake bitince dinamik gölge açılsın
    charSun.castShadow = wantsDynamicKeyShadow();

    // Fill: kameradan (+Z) → bakan yüz aydınlanır (ağaç/ENV etkilenmez)
    const a = { x: 12, y: 0, z: 0 };
    charFill.position.set(a.x, a.y + 3.5, a.z + 24);
    charFill.target.position.set(a.x, a.y + 1.0, a.z);
    charFill.target.updateMatrixWorld();
    charFill.updateMatrixWorld();

    // Rim: ay tarafı hafif kenar
    charRim.position.set(a.x + off.x * 0.45, a.y + off.y * 0.55, a.z + off.z * 0.45);
    charRim.target.position.set(a.x, a.y + 1.0, a.z);
    charRim.target.updateMatrixWorld();
    charRim.updateMatrixWorld();
  }
  syncCharLightsFromMoon();

  let appliedCharEnv = null;
  function syncCharEnvMap() {
    const env = scene.userData.charEnvMap || null;
    if (env === appliedCharEnv) return;
    appliedCharEnv = env;
    look.applyLookSettings();
  }

  const look = createLookController({
    getMaterials: () => characterMaterials,
    getBaseColors: () => baseCharacterColors,
    getCharLights: () => ({
      hemi: charHemi,
      sun: charSun,
      fill: charFill,
      rim: charRim,
      key: charKey,
    }),
    getCharEnvMap: () => scene.userData.charEnvMap || null,
  });
  look.buildLookPanel();

  const sheathTune = createSheathController({
    getSheath: () => katanaSheath,
  });
  sheathTune.buildSheathPanel();

  const sheathFullTune = createSheathFullController({
    getSheathFull: () => katanaSheathFull,
    getApplyOpts: () => ({
      baseScale: sheathFullBaseScale,
      twistNode: sheathFullTwist,
    }),
  });
  sheathFullTune.buildSheathFullPanel();

  function setKatanaDrawn(drawn) {
    katanaDrawn = !!drawn;
    if (katana) katana.visible = katanaDrawn;
    if (sheathEmptyProp) sheathEmptyProp.visible = katanaDrawn;
    if (sheathFullProp) sheathFullProp.visible = !katanaDrawn;
  }

  function isInWaterZone() {
    if (!waterZone || waterZone.enabled === false || !character) return false;
    const x = character.position.x;
    const z = character.position.z;
    return (
      x >= waterZone.minX &&
      x <= waterZone.maxX &&
      z >= waterZone.minZ &&
      z <= waterZone.maxZ
    );
  }

  /** Su / ip (3) — kılıç kınında kalır */
  function mustSheatheKatana() {
    return isInWaterZone() || ropeState !== "ground" || !!swingState;
  }

  function ensureKatanaDrawn() {
    if (mustSheatheKatana()) return;
    if (!katanaDrawn) setKatanaDrawn(true);
  }

  function forceSheatheIfNeeded() {
    if (mustSheatheKatana() && katanaDrawn) setKatanaDrawn(false);
  }

  function updateVisualFacing(dt, { instant = false } = {}) {
    if (!character) return;
    const target = facingYaw(facing);
    if (instant) {
      displayYaw = target;
      character.rotation.y = displayYaw;
      return;
    }
    let dy = target - displayYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const k = 1 - Math.exp(-FACING_TURN_RATE * dt);
    displayYaw += dy * k;
    character.rotation.y = displayYaw;
  }

  function isJumpAnim(name) {
    return JUMP_ANIMS.has(name);
  }

  function isSwingAirAnim(name) {
    return name === ANIM.swingHang || name === ANIM.swingRelease;
  }

  function tryJump(animName) {
    if (swingState === "swing" || swingState === "fly") {
      releaseSwing({ jump: true });
      return true;
    }
    if (ropeState !== "ground") return false;
    if (!actions[animName]) return false;

    const now = performance.now();
    const groundJump = grounded || now < coyoteUntil;

    if (groundJump) {
      if (!playOneShot(animName)) return false;
      velocityY = JUMP_VY;
      grounded = false;
      coyoteUntil = 0;
      canDoubleJump = true;
      if (groundOffset) groundOffset.position.y = 0;
      // Yerden kalkış tozu (slide efekti)
      jumpDustUntil = performance.now() + 200;
      return true;
    }

    // Çift zıplama
    if (!canDoubleJump) return false;
    if (!playOneShot(animName)) return false;
    velocityY = DOUBLE_JUMP_VY;
    canDoubleJump = false;
    if (groundOffset) groundOffset.position.y = 0;
    doubleJumpDustUntil = performance.now() + 220;
    return true;
  }

  function averageHandWorldPos(out) {
    if (!handBones.length) return null;
    out.set(0, 0, 0);
    let n = 0;
    for (const bone of handBones) {
      bone.getWorldPosition(_footPos);
      out.add(_footPos);
      n++;
    }
    if (!n) return null;
    out.multiplyScalar(1 / n);
    return out;
  }

  /**
   * Engel üstü platform desteği.
   * Sadece üstten / zaten üstündeyken yere basar; yandan çarpınca kaydırmaz.
   */
  function getBarrierFloorY(x, prevY) {
    let floorY = 0;
    for (const b of barriers) {
      const topL = b.x - b.halfT;
      const topR = b.x + b.halfT;
      const margin = 0.14;
      if (x < topL - margin || x > topR + margin) continue;
      const top = b.height;
      const fromAbove = prevY >= top - 0.18;
      const alreadyOn = grounded && prevY >= top - 0.08;
      if (fromAbove || alreadyOn) {
        floorY = Math.max(floorY, top);
      }
    }
    return floorY;
  }

  function resolveBarrierCollision(prevX) {
    if (!character) return;

    const vaulting =
      forcedAnim === ANIM.vault || forcedAnim === ANIM.roll;
    let x = character.position.x;
    let y = character.position.y;

    for (const b of barriers) {
      const left = b.x - b.halfT - CHAR_RADIUS;
      const right = b.x + b.halfT + CHAR_RADIUS;
      const overlapping = x > left && x < right;

      if (vaulting && vaultTargetBarrier === b && vaultHandTargetX != null) {
        const dur = currentAction?.getClip()?.duration ?? 1;
        const t = (currentAction?.time ?? 0) / Math.max(dur, 0.001);
        const isRoll = forcedAnim === ANIM.roll;
        const vf = vaultFacing;
        const nearFace = b.x - vf * b.halfT;
        const farClear = b.x + vf * (b.halfT + CHAR_RADIUS + 0.25);

        if (isRoll) {
          // İlk ~1 sn (t<0.5): engelde kilitlenme — root motion ileri gidebilsin
          // Sadece çok erken kısa el yaklaşımı, sonra serbest
          if (t >= 0.05 && t <= 0.12) {
            character.position.x = x;
            character.position.y = y;
            character.updateMatrixWorld(true);
            const hand = averageHandWorldPos(_handAvg);
            if (hand) {
              x += (vaultHandTargetX - hand.x) * 0.25;
              y += (vaultHandTargetY - hand.y) * 0.25;
            }
          }
          // İlk saniyede minimum ileri ilerleme (takılı kalmasın)
          if (t < 0.5) {
            const u = t / 0.5;
            const fromX = vaultHandTargetX - vf * 0.55;
            const toX = nearFace + vf * 0.35;
            const assistX = fromX + (toX - fromX) * u;
            if (vf > 0) x = Math.max(x, assistX);
            else x = Math.min(x, assistX);
          }
          if (t >= 0.48) {
            const u = Math.min(1, (t - 0.48) / 0.45);
            if (vf > 0) x = Math.max(x, nearFace + (farClear - nearFace) * u);
            else x = Math.min(x, nearFace + (farClear - nearFace) * u);
          }
          continue;
        }

        if (t <= 0.32) {
          const bodyLimit = nearFace - vf * 0.15;
          if (vf > 0) x = Math.min(x, bodyLimit);
          else x = Math.max(x, bodyLimit);
        }

        if (t >= 0.08 && t <= 0.42) {
          character.position.x = x;
          character.position.y = y;
          character.updateMatrixWorld(true);
          const hand = averageHandWorldPos(_handAvg);
          if (hand) {
            x += vaultHandTargetX - hand.x;
            y += vaultHandTargetY - hand.y;
          } else {
            x = vaultHandTargetX;
            y = vaultHandTargetY;
          }
        }

        if (t >= 0.48) {
          const u = Math.min(1, (t - 0.48) / 0.45);
          if (vf > 0) x = Math.max(x, nearFace + (farClear - nearFace) * u);
          else x = Math.min(x, nearFace + (farClear - nearFace) * u);
        }
        continue;
      }

      // Limbo önce: ayaktayken görsel gövde payı + kemer kalınlığı
      if (b.passUnder) {
        if (vaulting) continue;
        const ducking =
          forcedAnim === ANIM.slide ||
          currentAnimName === ANIM.crouchIdle ||
          currentAnimName === ANIM.crouchWalk ||
          limboCrouchHold ||
          isCrouchKeyDown();
        // Ayakta: mesh omuzları CHAR_RADIUS’dan taşar — ekstra pay
        const bodyR =
          ducking && grounded ? CHAR_RADIUS : CHAR_RADIUS + 0.24;
        const L = b.x - b.halfT - bodyR;
        const R = b.x + b.halfT + bodyR;
        if (!(x > L && x < R)) continue;
        // Ayaktayken / zıplarken kirişe çarp; eğilince serbest
        if (ducking && grounded) continue;
        // Üstünden atladıysa geç
        if (y >= b.height - 0.12) continue;
        const mid = (L + R) / 2;
        if (prevX <= mid) x = L;
        else x = R;
        continue;
      }

      if (!overlapping) continue;
      if (vaulting) continue;

      // Engel üstünde duruyorsa yandan itme
      if (y >= b.height - 0.12) continue;

      const mid = (left + right) / 2;
      if (prevX <= mid) x = left;
      else x = right;
    }

    character.position.x = x;
    character.position.y = Math.max(0, y);
  }

  /** Karakter gövdesi limbo (eğilerek geçilen) engelle X’te kesişiyor mu */
  function isOverlappingLimbo(x = character?.position.x) {
    if (!Number.isFinite(x)) return false;
    for (const b of barriers) {
      if (!b?.passUnder) continue;
      const bodyR = CHAR_RADIUS + 0.24;
      const left = b.x - b.halfT - bodyR;
      const right = b.x + b.halfT + bodyR;
      if (x > left && x < right) return true;
    }
    return false;
  }

  function isCrouchKeyDown() {
    const shift = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const ctrl = keys.has("ControlLeft") || keys.has("ControlRight");
    const running = shift || ctrl;
    return (
      keys.has("KeyC") ||
      keys.has("KeyS") ||
      (keys.has("ArrowDown") && !running)
    );
  }

  /**
   * Limbo içindeyken eğilmeye başlandıysa, engelden tamamen çıkana kadar
   * tuş bırakılsa bile crouch devam eder (ayakta kalıp köşeden fırlamasın).
   */
  function refreshLimboCrouchHold() {
    if (!character || ropeState !== "ground" || swingState) {
      limboCrouchHold = false;
      return;
    }
    if (!isOverlappingLimbo()) {
      limboCrouchHold = false;
      return;
    }
    const ducking =
      isCrouchKeyDown() ||
      limboCrouchHold ||
      forcedAnim === ANIM.slide ||
      currentAnimName === ANIM.crouchIdle ||
      currentAnimName === ANIM.crouchWalk;
    if (ducking) limboCrouchHold = true;
  }

  function wantsCrouch() {
    refreshLimboCrouchHold();
    return isCrouchKeyDown() || limboCrouchHold;
  }

  function findBarrierAhead(maxDist = VAULT_MAX_DIST) {
    if (!character) return null;
    let best = null;
    let bestDist = Infinity;
    for (const b of barriers) {
      if (b.vaultable === false || b.passUnder) continue;
      const dist = (b.x - character.position.x) * facing;
      if (dist < 0 || dist > maxDist) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = b;
      }
    }
    return best;
  }

  function beginVaultRootMotion(animName, barrier) {
    prevRootZ = null;
    vaultYScale = 1;
    vaultTargetBarrier = barrier || null;
    vaultHandTargetX = null;
    vaultHandTargetY = null;
    vaultFacing = facing < 0 ? -1 : 1;
    const curve = rootMotionCurves[animName];
    if (!curve || !barrier) return;

    const STANDOFF = animName === ANIM.roll ? 0.55 : 0.12;
    vaultHandTargetX = barrier.x - vaultFacing * (barrier.halfT + STANDOFF);
    vaultHandTargetY = barrier.height + (animName === ANIM.roll ? 0.58 : 0.14);

    // Geri çekme yok — koşu momentumunu kesmesin.
    // Sadece engelin içine gömüldüysek hafif geri al.
    const faceX = barrier.x - vaultFacing * barrier.halfT;
    const into = (character.position.x - faceX) * vaultFacing;
    if (into > 0.15) {
      character.position.x = faceX - vaultFacing * 0.05;
    }
    if (animName === ANIM.roll) {
      character.position.y = Math.max(character.position.y, 0.58);
    }

    const animPeak = Math.max(0.01, (curve.peakY - curve.y0) * modelScale);
    const need = barrier.height * 1.05;
    vaultYScale = Math.max(1.15, need / animPeak);
    if (animName === ANIM.roll) {
      vaultYScale *= 1.58;
    }
  }

  function sampleRootAxis(animName, time, axis) {
    const curve = rootMotionCurves[animName];
    if (!curve) return null;
    const values = axis === "y" ? curve.ys : curve.zs;
    const { times } = curve;
    if (time <= times[0]) return values[0];
    if (time >= times[times.length - 1]) return values[values.length - 1];
    for (let i = 0; i < times.length - 1; i++) {
      if (time >= times[i] && time <= times[i + 1]) {
        const u =
          (time - times[i]) / Math.max(1e-6, times[i + 1] - times[i]);
        return values[i] + (values[i + 1] - values[i]) * u;
      }
    }
    return values[values.length - 1];
  }

  function extractRootMotion(clip, { keepY = false } = {}) {
    const track = clip.tracks.find((t) => /hips\.position$/i.test(t.name));
    if (!track) return;
    const times = Array.from(track.times);
    const ys = [];
    const zs = [];
    for (let i = 0; i < track.values.length; i += 3) {
      ys.push(track.values[i + 1]);
      zs.push(track.values[i + 2]);
    }
    const x0 = track.values[0];
    const y0 = ys[0];
    const z0 = zs[0];
    for (let i = 0; i < track.values.length; i += 3) {
      track.values[i] = x0;
      if (!keepY) track.values[i + 1] = y0;
      track.values[i + 2] = z0;
    }
    rootMotionCurves[clip.name] = {
      times,
      zs,
      ys,
      y0,
      peakY: Math.max(...ys),
    };
  }

  /** Hips XZ (ve isteğe bağlı Y) kilitle — yerinde oynasın */
  function makeInPlace(clip, { keepY = false } = {}) {
    let track =
      clip.tracks.find((t) => /hips.*\.position$/i.test(t.name)) ||
      clip.tracks.find((t) => /hips/i.test(t.name) && /\.position$/i.test(t.name));

    // İsim uymasa: en çok XZ gezen position track (= root motion)
    if (!track) {
      let best = null;
      let bestTravel = 0;
      for (const t of clip.tracks) {
        if (!/\.position$/i.test(t.name) || t.values.length < 6) continue;
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (let i = 0; i < t.values.length; i += 3) {
          const x = t.values[i];
          const z = t.values[i + 2];
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
        const travel = maxX - minX + (maxZ - minZ);
        if (travel > bestTravel) {
          bestTravel = travel;
          best = t;
        }
      }
      track = best;
    }

    if (!track) {
      console.warn("makeInPlace: position track yok →", clip.name);
      return;
    }

    const x0 = track.values[0];
    const y0 = track.values[1];
    const z0 = track.values[2];
    for (let i = 0; i < track.values.length; i += 3) {
      track.values[i] = x0;
      if (!keepY) track.values[i + 1] = y0;
      track.values[i + 2] = z0;
    }
  }

  function applyRootMotion() {
    if (!forcedAnim || !currentAction || !rootMotionCurves[forcedAnim]) {
      prevRootZ = null;
      vaultYScale = 1;
      return false;
    }
    const z = sampleRootAxis(forcedAnim, currentAction.time, "z");
    const y = sampleRootAxis(forcedAnim, currentAction.time, "y");
    if (z == null || y == null) return false;

    const curve = rootMotionCurves[forcedAnim];
    if (prevRootZ != null) {
      const boost =
        forcedAnim === ANIM.vault
          ? 1.65
          : forcedAnim === ANIM.roll
            ? 1.75
            : 1;
      const moveFace =
        forcedAnim === ANIM.vault || forcedAnim === ANIM.roll
          ? vaultFacing
          : facing;
      const dz = (z - prevRootZ) * modelScale * boost;
      character.position.x += moveFace * dz;
    }
    if (forcedAnim === ANIM.slide) {
      // Yer animleri — sadece ileri root motion, Y kalkmasın
      character.position.y = 0;
    } else {
      character.position.y = Math.max(
        0,
        (y - curve.y0) * modelScale * vaultYScale
      );
    }
    velocityY = 0;
    prevRootZ = z;
    return true;
  }

  function play(name, { fade = 0.18, force = false, once = false } = {}) {
    const next = actions[name];
    if (!next) {
      console.warn("Missing animation:", name);
      return null;
    }
    if (currentAction === next && !force) return next;

    next.reset();
    next.setEffectiveTimeScale(ANIM_SPEED[name] ?? 1);
    next.setEffectiveWeight(1);
    if (!once && LOOPING.has(name)) {
      next.setLoop(THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = false;
    } else {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    }

    if (currentAction && currentAction !== next) {
      if (fade <= 1e-4) {
        // Anında kes — crossFade 0 bile eski pozu bir süre taşır
        currentAction.stop();
        currentAction.setEffectiveWeight(0);
        next.play();
      } else {
        currentAction.crossFadeTo(next, fade, false);
        next.play();
      }
    } else {
      next.fadeIn(Math.max(fade, 0));
      next.play();
    }
    currentAction = next;
    currentAnimName = name;
    setAnimLabel(name);
    if (rootMotionCurves[name]) prevRootZ = null;
    return next;
  }

  function playOneShot(name, lockMs, { fade: fadeOpt, comboForward } = {}) {
    const now = performance.now();
    // Zıpla / parkour / saldırı / özel — birbirini kesebilir
    // Slide kendini kesmesin (arka arkaya kayma yok)
    const canCancel =
      ACTION_CANCEL.has(name) &&
      ACTION_CANCEL.has(forcedAnim) &&
      !(name === ANIM.slide && forcedAnim === ANIM.slide);
    if (now < busyUntil && !canCancel) return false;

    // Tekme/yumruk başlamadan duruş hips XZ — sonra her kare kilitle
    if (shouldLockHips(name)) captureHipsLock();
    else hipsLockXZ = null;

    const fade =
      fadeOpt ??
      (isJumpAnim(name) || /jump/i.test(name) ? 0.04 : 0.12);
    const action = play(name, { fade, force: true });
    if (!action) return false;

    if (canCancel) {
      prevRootZ = null;
      vaultYScale = 1;
      vaultTargetBarrier = null;
      vaultHandTargetX = null;
      vaultHandTargetY = null;
      vaultMomentum = 0;
      if (groundOffset) groundOffset.rotation.x = 0;
    }

    forcedAnim = name;
    const absScale = Math.abs(ANIM_SPEED[name] ?? 1) || 1;
    const clipDur = action.getClip().duration;
    let playLen = clipDur;
    const comboCfg = REVERSE_COMBO[name];

    if (comboCfg) {
      const forward = comboForward !== false;
      const scale = absScale;
      action.setEffectiveTimeScale(forward ? scale : -scale);
      comboFlipQueued = false;
      comboAnim = name;
      comboSegmenting = false;

      if (comboCfg.fullFirst) {
        // Tek basış: tam animasyon (combo mash'te başlar)
        action.time = forward ? comboCfg.skip : clipDur;
        comboSegmentTarget = null;
        playLen = clipDur - comboCfg.skip;
      } else {
        const seg = comboCfg.segmentSec * scale;
        if (forward) {
          action.time = comboCfg.skip;
          comboSegmentTarget = Math.min(clipDur, comboCfg.skip + seg);
        } else {
          action.time = clipDur;
          comboSegmentTarget = Math.max(comboCfg.skip, clipDur - seg);
        }
        comboSegmenting = true;
        playLen = Math.abs(comboSegmentTarget - action.time);
      }
    } else {
      action.setEffectiveTimeScale(absScale);
      clearCombo();
    }

    const duration = lockMs ?? (playLen / absScale) * 1000;
    // İniş/çıkış: lift blend anim bitene kadar sürsün
    // Combo segment: erken bitmesin (updateComboSegment yönetir)
    const hold =
      name === ANIM.hang || name === ANIM.hang2
        ? 0.99
        : name === ANIM.slide
          ? 1.0
          : comboCfg && !comboCfg.fullFirst
            ? 1.15
            : comboCfg?.fullFirst
              ? 0.92
              : 0.92;
    busyUntil = now + duration * hold;
    return true;
  }

  /** Kılıçlı hareket ölçeği (fight/walk) */
  function getArmedMoveScale() {
    return katanaDrawn ? FIGHT_MOVE_SCALE : 1;
  }

  /** Shift koşu / Ctrl sprint — kılıçlıysa aynı ölçekle */
  function getRunMoveSpeed(sprint = false) {
    const base = sprint ? MOVE_SPEED.sprint : MOVE_SPEED.run;
    return base * getArmedMoveScale();
  }

  function desiredLocomotion() {
    if (sceneSettings.control !== "main") {
      if (ropeState !== "ground") {
        if (ropeState === "hang") return { anim: ANIM.hang1, speed: 0 };
        if (ropeState === "up") return { anim: ANIM.hang, speed: 0 };
        if (ropeState === "down") return { anim: ANIM.hang2, speed: 0 };
        if (ropeState === "land") return { anim: ANIM.crouchIdle, speed: 0 };
      }
      return { anim: ANIM.idle, speed: 0 };
    }

    if (ropeState !== "ground") {
      if (ropeState === "hang") return { anim: ANIM.hang1, speed: 0 };
      if (ropeState === "up") return { anim: ANIM.hang, speed: 0 };
      if (ropeState === "down") return { anim: ANIM.hang2, speed: 0 };
      if (ropeState === "land") return { anim: ANIM.crouchIdle, speed: 0 };
    }

    const left = keys.has("KeyA") || keys.has("ArrowLeft");
    const right = keys.has("KeyD") || keys.has("ArrowRight");
    const moving = left !== right;
    const shift = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const ctrl = keys.has("ControlLeft") || keys.has("ControlRight");
    const running = shift || ctrl;
    // Aşağı ok koşarken slide — çömelme değil; limbo içinde tutuş devam eder
    const crouch = wantsCrouch();
    const carry = keys.has("KeyG");

    if (keys.has("Digit1") || isInWaterZone()) {
      // Yüzme: 1 basılı veya su alanında
      return {
        anim: ANIM.swim,
        speed: moving ? MOVE_SPEED.swim : 0,
      };
    }

    if (!moving) {
      if (crouch) return { anim: ANIM.crouchIdle, speed: 0 };
      return { anim: ANIM.idle, speed: 0 };
    }

    if (carry) return { anim: ANIM.carry, speed: MOVE_SPEED.carry };
    // Kılıçlı: walk’taki oran (fight/walk) run / sprint / crouch’a da
    const armedScale = getArmedMoveScale();
    if (crouch) {
      return {
        anim: ANIM.crouchWalk,
        speed: MOVE_SPEED.crouch * armedScale,
      };
    }
    if (ctrl) {
      return {
        anim: ANIM.sprint,
        speed: getRunMoveSpeed(true),
      };
    }
    if (shift) {
      return {
        anim: ANIM.run,
        speed: getRunMoveSpeed(false),
      };
    }
    // Kılıç elde → savaş yürüyüşü
    if (katanaDrawn) {
      return { anim: ANIM.fightWalk, speed: MOVE_SPEED.fight };
    }
    return { anim: ANIM.walk, speed: MOVE_SPEED.walk };
  }

  function startRopeDescent() {
    // Tırmanış / asılıyken 3 → kaldığın yerden in
    busyUntil = 0;
    hangLockPendingRefY = null;
    hangLockWaitMixer = false;
    ropeNeedRemeasure = false;
    if (groundOffset) {
      ropeLiftY = groundOffset.position.y;
    }

    character.updateMatrixWorld(true);
    let worldTop = -Infinity;
    visual?.traverse((obj) => {
      if (!(obj.isBone || obj.type === "Bone")) return;
      obj.getWorldPosition(_footPos);
      if (_footPos.y > worldTop) worldTop = _footPos.y;
    });
    ropeDescentTop = Number.isFinite(worldTop)
      ? worldTop
      : getRopeHangY();

    if (!playOneShot(ANIM.hang2, null, { fade: 0 })) return false;
    ropeDescentReady = false;
    ropeState = "down";
    return true;
  }

  function handleRopeKey() {
    if (!input.ropeQueued) return;
    input.ropeQueued = false;
    if (swingState) return;

    if (ropeState === "ground") {
      const now = performance.now();
      // Havada / zıplarken de 3 çalışsın — jump busy kilidini kır
      if (now < busyUntil) {
        if (!isJumpAnim(forcedAnim) && grounded) return;
        busyUntil = 0;
      }

      const handY =
        (character?.position.y ?? 0) +
        (groundOffset?.position.y ?? 0) +
        SWING_PIVOT_Y * 0.85;
      const hangY = getScreenHangY();
      const latch = findRopeLatch(character.position.x, handY, {
        mode: "hang",
        facing,
        hangY,
      });
      if (!latch) return; // üstte örtü yok → boş gökyüzüne atma

      // Önce kınına — hang boyunca el/kılıç pozu değişmesin
      setKatanaDrawn(false);
      if (playOneShot(ANIM.hang)) {
        ropeState = "up";
        ropeLiftY = 0;
        ropeNeedRemeasure = true;
        hangLockPendingRefY = null;
        hangLockWaitMixer = false;
        velocityY = 0;
        grounded = true;
        canDoubleJump = true;
        // Havadaki Y’yi groundOffset’e aktar — yerden başlamasın
        const airY =
          (character?.position.y ?? 0) + (groundOffset?.position.y ?? 0);
        ropeUpFromLift = Math.max(0, airY);
        if (character) character.position.y = 0;
        if (groundOffset) {
          groundOffset.position.y = ropeUpFromLift;
          groundOffset.rotation.x = 0;
        }
        activeRopeLatchY = hangY;
        // Kanca ekran tepesinde, karakter X’te
        ropeHookAnchor.set(latch.x, hangY, latch.z ?? 0);
        ropeHookAnchorSet = true;
      }
    } else if (ropeState === "up" || ropeState === "hang") {
      startRopeDescent();
    }
  }

  function sampleRopeHand(_out) {
    if (leftHandBone) {
      leftHandBone.getWorldPosition(_out);
      return _out;
    }
    const left = handBones.find((b) => /LeftHand$/i.test(b.name));
    if (left) {
      left.getWorldPosition(_out);
      return _out;
    }
    character.getWorldPosition(_out);
    _out.y += SWING_PIVOT_Y;
    return _out;
  }

  function applySwingPose() {
    const action = actions[ANIM.jump];
    if (!action) {
      play(ANIM.idle, { fade: 0.1, force: true });
      forcedAnim = ANIM.idle;
      return;
    }
    if (currentAnimName !== ANIM.jump || currentAction !== action) {
      play(ANIM.jump, { fade: 0.1, force: true, once: true });
    }
    forcedAnim = ANIM.jump;
    busyUntil = Infinity;
    const dur = Math.max(0.001, action.getClip().duration);
    action.enabled = true;
    action.paused = true;
    action.time = dur * SWING_POSE_T;
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(0);
  }

  function beginSwing() {
    if (!character || ropeState !== "ground" || swingState) return false;

    const dir = facing >= 0 ? 1 : -1;
    const handY =
      character.position.y +
      (groundOffset?.position.y ?? 0) +
      SWING_PIVOT_Y;
    const ox = character.position.x;
    const ceilY = getScreenHangY();

    // Üstte örtü yoksa boş gökyüzüne atma
    const latch = findRopeLatch(ox, handY, {
      mode: "swing",
      facing: dir,
      hangY: ceilY,
    });
    if (!latch) return false;

    // Eski salıncak: 45° ileri-yukarı kanca
    const c45 = Math.SQRT1_2;
    let range = SWING_RANGE;
    let ax = ox + dir * range * c45;
    let ay = handY + range * c45;
    if (ay > ceilY) {
      const rise = ceilY - handY;
      if (rise < 0.8) return false;
      range = rise / c45;
      if (range < SWING_MIN_LEN) return false;
      ax = ox + dir * range * c45;
      ay = ceilY;
    }

    setKatanaDrawn(false);

    swingAnchor.set(ax, ay, 0);
    swingFlyFrom.set(ox, handY, 0);
    swingLength = range;
    swingFlyT = 0;
    swingState = "fly";
    activeRopeLatchY = ay;

    // Koşu / zıplama hızından başlangıç salınımı
    const shift = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const ctrl = keys.has("ControlLeft") || keys.has("ControlRight");
    const base =
      ctrl || shift
        ? MOVE_SPEED.run
        : grounded
          ? MOVE_SPEED.walk
          : MOVE_SPEED.run * 0.65;
    swingVx = dir * base * (grounded ? 1.05 : 1.15);
    swingVy = Math.max(0, velocityY) * 0.35;

    grounded = false;
    velocityY = 0;
    canDoubleJump = true;
    if (groundOffset) groundOffset.position.y = 0;
    applySwingPose();

    ropeHookAnchor.copy(swingAnchor);
    ropeHookAnchorSet = true;
    ropeHookFx.setActive(true);
    setAnimLabel?.(`Swing: ${ANIM.jump}`);
    return true;
  }

  function releaseSwing({ jump = false } = {}) {
    if (!swingState) return;
    airVelX = swingVx;
    velocityY = swingVy + (jump ? SWING_JUMP_BOOST : 1.2);
    if (jump && Math.abs(airVelX) < 2) {
      airVelX = (facing >= 0 ? 1 : -1) * MOVE_SPEED.run * 0.85;
    }
    swingState = null;
    swingFlyT = 0;
    swingVx = 0;
    swingVy = 0;
    grounded = false;
    canDoubleJump = true;
    ropeHookAnchorSet = false;
    ropeHookFx.setActive(false);
    activeRopeLatchY = null;

    // 4 veya W: aynı backflip → crouch düşüş (W’de ekstra zıplama hızı yukarıda)
    if (actions[ANIM.swingRelease]) {
      play(ANIM.swingRelease, {
        fade: SWING_START_FADE,
        force: true,
        once: true,
      });
      forcedAnim = ANIM.swingRelease;
      if (currentAction) {
        currentAction.paused = false;
        currentAction.setEffectiveTimeScale(
          ANIM_SPEED[ANIM.swingRelease] ?? 1,
        );
        currentAction.time = 0;
        currentAction.clampWhenFinished = true;
      }
      const absScale = Math.abs(ANIM_SPEED[ANIM.swingRelease] ?? 1) || 1;
      const dur = actions[ANIM.swingRelease].getClip().duration;
      // Tam 1s’lik oynatışın %80’i — son 0.20s kes
      busyUntil =
        performance.now() + (dur / absScale) * 1000 * SWING_RELEASE_CUT;
      setAnimLabel?.(
        `Swing: release · ${ANIM.swingRelease}${jump ? " +jump" : ""}`,
      );
    } else if (jump) {
      play(ANIM.jump, { fade: 0.06, force: true, once: true });
      forcedAnim = ANIM.jump;
      if (currentAction) {
        currentAction.paused = false;
        currentAction.setEffectiveTimeScale(ANIM_SPEED[ANIM.jump] ?? 1);
        currentAction.time = 0;
      }
      const dur = actions[ANIM.jump]?.getClip()?.duration ?? 0.6;
      busyUntil =
        performance.now() +
        (dur / (ANIM_SPEED[ANIM.jump] ?? 1)) * 1000 * 0.7;
      setAnimLabel?.(`Swing: release · ${ANIM.jump}`);
    } else {
      applySwingPose();
      busyUntil = Infinity;
      setAnimLabel?.(`Swing: release · ${ANIM.jump}`);
    }
  }

  /** Backflip son karesi yatık — yere değince dik crouch */
  function finishSwingReleaseUpright() {
    clearCombo();
    forcedAnim = null;
    busyUntil = 0;
    vaultMomentum = 0;
    hipsLockXZ = null;
    if (groundOffset) {
      groundOffset.position.y = 0;
      groundOffset.rotation.x = 0;
    }
    if (currentAnimName === ANIM.crouchIdle) {
      // Zaten crouch düşüşte — tekrar kesme
      if (grounded) alignFeetToGround();
      setAnimLabel?.(`Swing: land · ${ANIM.crouchIdle}`);
      return;
    }
    play(ANIM.crouchIdle, { fade: SWING_TO_CROUCH_FADE, force: true });
    if (character) character.position.y = Math.max(0, character.position.y);
    if (grounded) alignFeetToGround();
    setAnimLabel?.(`Swing: land · ${ANIM.crouchIdle}`);
  }

  /** Backflip havada bitti — crouch pozuyla düş (yumuşak blend) */
  function finishSwingReleaseAirFall() {
    clearCombo();
    hipsLockXZ = null;
    vaultMomentum = 0;
    if (groundOffset) {
      groundOffset.position.y = 0;
      groundOffset.rotation.x = 0;
    }
    if (!actions[ANIM.crouchIdle]) {
      forcedAnim = null;
      busyUntil = 0;
      return;
    }
    if (currentAnimName === ANIM.crouchIdle) {
      forcedAnim = ANIM.crouchIdle;
      busyUntil = Infinity;
      return;
    }
    play(ANIM.crouchIdle, { fade: SWING_TO_CROUCH_FADE, force: true });
    forcedAnim = ANIM.crouchIdle;
    busyUntil = Infinity;
    if (currentAction) {
      currentAction.paused = false;
      currentAction.setEffectiveTimeScale(1);
    }
    setAnimLabel?.(`Swing: fall · ${ANIM.crouchIdle}`);
  }

  function handleSwingKey() {
    if (!input.swingQueued) return;
    input.swingQueued = false;
    if (sceneSettings.control !== "main") return;
    if (dead) return;
    if (ropeState !== "ground") return;

    if (swingState === "swing" || swingState === "fly") {
      releaseSwing({ jump: false });
      return;
    }
    const now = performance.now();
    if (now < busyUntil) {
      if (!isJumpAnim(forcedAnim) && grounded) return;
      busyUntil = 0;
    }
    beginSwing();
  }

  /** @returns {boolean} swing aktifse true — normal hareket/gravity atlanır */
  function updateSwing(dt) {
    if (!swingState || !character) return false;
    applySwingPose();

    if (swingState === "fly") {
      swingFlyT += dt;
      const u = Math.min(1, swingFlyT / SWING_FLY_DUR);
      // Kanca hedefe uçar
      ropeHookAnchor.lerpVectors(swingFlyFrom, swingAnchor, u * u * (3 - 2 * u));
      ropeHookAnchorSet = true;

      // Karakter hafif süzülür
      character.position.x += swingVx * dt * 0.55;
      character.position.y += swingVy * dt;
      swingVy -= GRAVITY * 0.35 * dt;

      if (u >= 1) {
        swingState = "swing";
        sampleRopeHand(_ropeHand);
        swingLength = Math.max(
          SWING_MIN_LEN,
          Math.hypot(
            _ropeHand.x - swingAnchor.x,
            _ropeHand.y - swingAnchor.y,
          ),
        );
        ropeHookAnchor.copy(swingAnchor);
        setAnimLabel?.(`Swing: ${ANIM.jump}`);
      }
      return true;
    }

    // Pendulum constraint
    let x = character.position.x;
    let y = character.position.y + SWING_PIVOT_Y;
    const ax = swingAnchor.x;
    const ay = swingAnchor.y;

    // A/D ile salınım kuvveti
    const left = keys.has("KeyA") || keys.has("ArrowLeft");
    const right = keys.has("KeyD") || keys.has("ArrowRight");
    if (left !== right) {
      const pump = left ? -1 : 1;
      swingVx += pump * 14 * dt;
      facing = pump;
    }

    swingVy -= GRAVITY * dt;
    x += swingVx * dt;
    y += swingVy * dt;

    let dx = x - ax;
    let dy = y - ay;
    let dist = Math.hypot(dx, dy);
    if (dist > 1e-5) {
      const nx = dx / dist;
      const ny = dy / dist;
      x = ax + nx * swingLength;
      y = ay + ny * swingLength;
      const vn = swingVx * nx + swingVy * ny;
      swingVx -= vn * nx;
      swingVy -= vn * ny;
    }

    swingVx *= Math.exp(-0.55 * dt);
    swingVy *= Math.exp(-0.2 * dt);

    character.position.x = x;
    character.position.y = y - SWING_PIVOT_Y;
    character.position.z = 0;

    if (Math.abs(swingVx) > 0.45) {
      facing = swingVx > 0 ? 1 : -1;
    }

    // Yere değdi
    if (character.position.y <= 0.04) {
      character.position.y = 0;
      releaseSwing({ jump: false });
      grounded = true;
      velocityY = 0;
      airVelX = 0;
      play(desiredLocomotion().anim, { fade: 0.12, force: true });
    }

    ropeHookAnchor.copy(swingAnchor);
    ropeHookAnchorSet = true;
    return true;
  }

  /** groundOffset=0 iken hang pozu kemik min/max Y */
  function measureHangExtents() {
    const saved = groundOffset.position.y;
    groundOffset.position.y = 0;
    character.updateMatrixWorld(true);
    let minY = Infinity;
    let maxY = -Infinity;
    visual.traverse((obj) => {
      if (!(obj.isBone || obj.type === "Bone")) return;
      obj.getWorldPosition(_footPos);
      if (_footPos.y < minY) minY = _footPos.y;
      if (_footPos.y > maxY) maxY = _footPos.y;
    });
    groundOffset.position.y = saved;
    character.updateMatrixWorld(true);
    return {
      minY: Number.isFinite(minY) ? minY : 0,
      maxY: Number.isFinite(maxY) ? maxY : 1,
    };
  }

  function hangTargetLiftFromExtents(ext) {
    let lift = getRopeHangY() - ext.maxY;
    if (ext.minY + lift < 0.06) lift = 0.06 - ext.minY;
    return lift;
  }

  /** Asılış referans yüksekliği (kalça / kemik tepesi) */
  function measureHangRefY() {
    if (!visual) return 0;
    character.updateMatrixWorld(true);
    if (hipsBone) {
      hipsBone.getWorldPosition(_footPos);
      return _footPos.y;
    }
    let maxY = -Infinity;
    visual.traverse((obj) => {
      if (!(obj.isBone || obj.type === "Bone")) return;
      obj.getWorldPosition(_footPos);
      if (_footPos.y > maxY) maxY = _footPos.y;
    });
    return Number.isFinite(maxY) ? maxY : 0;
  }

  /** hang → hang1: clip kök Y kaybolunca lift ile aynı dünya yüksekliğini koru */
  function lockHangLiftToRefY(refY) {
    if (!groundOffset) return;
    const saved = groundOffset.position.y;
    groundOffset.position.y = 0;
    character.updateMatrixWorld(true);
    const y0 = measureHangRefY();
    ropeLiftY = refY - y0;
    groundOffset.position.y = ropeLiftY;
    ropeNeedRemeasure = false;
    if (!Number.isFinite(ropeLiftY)) {
      ropeLiftY = saved;
      groundOffset.position.y = saved;
    }
  }

  /** İp + kanca görseli — dikey asılma veya salıncak */
  function updateRopeHookVisual() {
    const ropeHang =
      ropeState === "up" ||
      ropeState === "hang" ||
      ropeState === "down" ||
      ropeState === "land";
    const swinging = !!swingState;
    const active = ropeHang || swinging;
    ropeHookFx.setActive(active);
    if (!active || !character) {
      if (!swinging) ropeHookAnchorSet = false;
      return;
    }

    character.updateMatrixWorld(true);
    sampleRopeHand(_ropeHand);

    if (swinging) {
      if (!ropeHookAnchorSet) {
        ropeHookAnchor.copy(swingAnchor);
        ropeHookAnchorSet = true;
      }
      ropeHookFx.update(
        _ropeHand,
        ropeHookAnchor.y,
        ropeHookAnchor.x,
        ropeHookAnchor.z,
      );
      return;
    }

    if (!ropeHookAnchorSet) {
      ropeHookAnchor.set(character.position.x, getRopeHangY(), 0);
      ropeHookAnchorSet = true;
    }

    // İniş: kanca yerinde kalsın; ip kısalır
    ropeHookFx.update(
      _ropeHand,
      ropeHookAnchor.y,
      ropeHookAnchor.x,
      ropeHookAnchor.z,
    );
  }

  function alignHangAboveGround() {
    if (!groundOffset || !visual) return;

    const smoothstep = (t) => {
      const x = Math.min(1, Math.max(0, t));
      return x * x * (3 - 2 * x);
    };

    /** Zemin 3× → orta 2× → üst/tavan 1× (height 0=zemin, 1=tavan) */
    const ropeHeightTimeScale = (height01) => {
      const h = Math.min(1, Math.max(0, height01));
      if (h < 0.5) {
        // 0→0.5: 3 → 2
        return 3 - h * 2;
      }
      // 0.5→1: 2 → 1
      return 2 - (h - 0.5) * 2;
    };

    // İniş: hang1 tepe yüksekliğini koruyarak hang2 lift ayarla, sonra in
    if (ropeState === "down" && currentAction) {
      const dur = Math.max(0.001, currentAction.getClip().duration);
      const t = Math.min(1, Math.max(0, currentAction.time / dur));
      // hang2 pozu yerleşene kadar bekle, sonra aynı tepeye göre lift kilitle
      if (!ropeDescentReady) {
        // Mixer bir kare hang2 uygulayana kadar bekle
        if (currentAnimName !== ANIM.hang2 || currentAction.time < 1e-4) {
          groundOffset.position.y = ropeLiftY;
          return;
        }
        const ext = measureHangExtents();
        const top = ropeDescentTop ?? getRopeHangY();
        ropeLiftY = top - ext.maxY;
        ropeFloorLift = Math.max(0, 0.06 - ext.minY);
        groundOffset.position.y = ropeLiftY;
        ropeDescentReady = true;
        return;
      }
      // İnerken: tavanda (t≈0) normal, zemine yaklaşınca (t→1) 2×
      const base = ANIM_SPEED[ANIM.hang2] ?? 1;
      currentAction.setEffectiveTimeScale(base * ropeHeightTimeScale(1 - t));
      // Linear — smoothstep sonda duruyordu, sonra ani düşüş gibi görünüyordu
      groundOffset.position.y =
        ropeLiftY + (ropeFloorLift - ropeLiftY) * t;
      // Clip bitince bekleme (busyUntil fazla kalmasın)
      if (t >= 0.98) busyUntil = 0;
      return;
    }

    // Asılı idle: hang1 pozu mixer’da oturunca ref kilidi; sonra lift sabit
    if (ropeState === "hang") {
      if (hangLockPendingRefY != null) {
        if (hangLockWaitMixer) {
          // Bu karede henüz hang1 mixer’dan geçmedi — lift’i koru
          hangLockWaitMixer = false;
          groundOffset.position.y = ropeLiftY;
          return;
        }
        lockHangLiftToRefY(hangLockPendingRefY);
        hangLockPendingRefY = null;
      } else if (ropeNeedRemeasure) {
        ropeLiftY = hangTargetLiftFromExtents(measureHangExtents());
        ropeNeedRemeasure = false;
      }
      groundOffset.position.y = ropeLiftY;
      return;
    }

    // Çıkış: mevcut yükseklikten (yer veya hava) asılma hedefine blend
    if (ropeState === "up" && currentAction) {
      if (ropeNeedRemeasure || ropeLiftY === 0) {
        const ext = measureHangExtents();
        ropeLiftY = hangTargetLiftFromExtents(ext);
        ropeNeedRemeasure = false;
      }
      const dur = Math.max(0.001, currentAction.getClip().duration);
      const t = Math.min(1, Math.max(0, currentAction.time / dur));
      // Çıkarken: zeminde (t≈0) 2×, ortada (t≈0.5) 1×, üstte 1×
      const base = ANIM_SPEED[ANIM.hang] ?? 1;
      currentAction.setEffectiveTimeScale(base * ropeHeightTimeScale(t));
      const blend = smoothstep(t);
      groundOffset.position.y =
        ropeUpFromLift + (ropeLiftY - ropeUpFromLift) * blend;
      return;
    }

    groundOffset.position.y = 0;
  }

  function startVault(animName, barrier) {
    if (!barrier || !grounded) return false;
    // Vault öncesi koşu hızını kilitle — anim boyunca düşmesin
    const ctrl = keys.has("ControlLeft") || keys.has("ControlRight");
    const shift = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const runningAnim =
      currentAnimName === ANIM.run || currentAnimName === ANIM.sprint;
    if (ctrl) vaultMomentum = MOVE_SPEED.sprint;
    else if (shift || runningAnim) vaultMomentum = MOVE_SPEED.run;
    else vaultMomentum = MOVE_SPEED.walk * 1.15;

    if (!playOneShot(animName)) {
      vaultMomentum = 0;
      return false;
    }
    beginVaultRootMotion(animName, barrier);
    velocityY = 0;
    grounded = true;
    return true;
  }

  function isRunningIntoVaultRange() {
    const shift = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const ctrl = keys.has("ControlLeft") || keys.has("ControlRight");
    const runningAnim =
      currentAnimName === ANIM.run || currentAnimName === ANIM.sprint;
    if (!shift && !ctrl && !runningAnim) return false;

    const left = keys.has("KeyA") || keys.has("ArrowLeft");
    const right = keys.has("KeyD") || keys.has("ArrowRight");
    if (left === right) return false;
    if (facing > 0 && !right) return false;
    if (facing < 0 && !left) return false;
    return true;
  }

  /** Koşarak engel alanına girince rastgele vault veya roll */
  function tryAutoVault() {
    if (!grounded || ropeState !== "ground") return;
    if (performance.now() < busyUntil) return;
    if (forcedAnim === ANIM.vault || forcedAnim === ANIM.roll) return;

    if (!isRunningIntoVaultRange()) {
      lastAutoVaultBarrier = null;
      lastAutoVaultFacing = 0;
      return;
    }

    const barrier = findBarrierAhead(VAULT_MAX_DIST);
    if (!barrier) {
      lastAutoVaultBarrier = null;
      lastAutoVaultFacing = 0;
      return;
    }
    // Aynı engel + aynı yön: landing spam engeli
    // Ters yönden (geri dönüş) tekrar vault serbest
    if (
      barrier === lastAutoVaultBarrier &&
      lastAutoVaultFacing !== 0 &&
      facing === lastAutoVaultFacing
    ) {
      return;
    }

    const anim = Math.random() < 0.5 ? ANIM.vault : ANIM.roll;
    if (startVault(anim, barrier)) {
      lastAutoVaultBarrier = barrier;
      lastAutoVaultFacing = vaultFacing;
    }
  }

  function getPoseMinY() {
    let minY = Infinity;
    if (footBones.length) {
      for (const bone of footBones) {
        bone.getWorldPosition(_bonePos);
        if (_bonePos.y < minY) minY = _bonePos.y;
      }
    }
    visual?.traverse((o) => {
      if (o.isSkinnedMesh && o.skeleton) {
        for (const bone of o.skeleton.bones) {
          bone.getWorldPosition(_bonePos);
          if (_bonePos.y < minY) minY = _bonePos.y;
        }
      }
    });
    return minY;
  }

  /** Ölüm pozu zemine gömülmesin — en düşük kemiği pad’e çek */
  function alignDeadToGround() {
    if (!character || !groundOffset || !visual) return;
    groundOffset.position.y = 0;
    character.position.y = 0;
    character.updateMatrixWorld(true);
    const minY = getPoseMinY();
    if (!Number.isFinite(minY)) return;
    if (minY < DIE_GROUND_PAD) {
      groundOffset.position.y = DIE_GROUND_PAD - minY;
    }
  }

  function syncHpBar() {
    if (!hpFill) return;
    const pct = Math.max(0, Math.min(1, hp / PLAYER_MAX_HP));
    hpFill.style.width = `${pct * 100}%`;
  }

  function triggerHurtFlash() {
    hurtFlash = 1;
    if (hpWrap) {
      hpWrap.classList.remove("hurt");
      void hpWrap.offsetWidth;
      hpWrap.classList.add("hurt");
    }
    if (damageFlashEl) {
      damageFlashEl.classList.remove("on");
      void damageFlashEl.offsetWidth;
      damageFlashEl.classList.add("on");
    }
  }

  function updateHurtFlash(dt) {
    if (hurtFlash <= 0) {
      hurtFlash = 0;
      return;
    }
    hurtFlash = Math.max(0, hurtFlash - dt * 2.8);
    const e = hurtFlash * hurtFlash;
    for (const mat of characterMaterials) {
      if (!mat?.emissive) continue;
      // Flashbang — beyaz
      mat.emissive.setRGB(e * 1.0, e * 1.0, e * 1.05);
      if ("emissiveIntensity" in mat) mat.emissiveIntensity = 0.2 + e * 2.2;
    }
    if (hurtFlash <= 0) {
      for (const mat of characterMaterials) {
        if (!mat?.emissive) continue;
        mat.emissive.setRGB(0, 0, 0);
        if ("emissiveIntensity" in mat) mat.emissiveIntensity = 1;
      }
      hpWrap?.classList.remove("hurt");
      damageFlashEl?.classList.remove("on");
    }
  }

  function updateHpBarPosition() {
    if (!hpWrap || !character || !camera) return;
    character.updateMatrixWorld(true);
    character.getWorldPosition(_hpWorld);
    _hpWorld.y += 2.05;
    _hpWorld.project(camera);
    if (_hpWorld.z > 1) {
      hpWrap.hidden = true;
      return;
    }
    const x = (_hpWorld.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-_hpWorld.y * 0.5 + 0.5) * window.innerHeight;
    hpWrap.style.left = `${x}px`;
    hpWrap.style.top = `${y}px`;
    hpWrap.hidden = false;
    syncHpBar();
  }

  /**
   * Hasar al. Can bitince otomatik full dolar.
   * @returns {{ hit: boolean, refilled: boolean, hp: number }}
   */
  function takeDamage(amount = 1) {
    if (!character || dead) return { hit: false, refilled: false, hp };
    if (!canTakeDamageNow()) return { hit: false, refilled: false, hp };
    const dmg = Math.max(1, Math.floor(amount));
    hp = Math.max(0, hp - dmg);
    syncHpBar();
    triggerHurtFlash();
    let refilled = false;
    if (hp <= 0) {
      hp = PLAYER_MAX_HP;
      refilled = true;
      syncHpBar();
      setStatus?.(`Can bitti → yenilendi (${PLAYER_MAX_HP})`);
    } else {
      setStatus?.(`Can: ${hp}/${PLAYER_MAX_HP}`);
    }
    return { hit: true, refilled, hp };
  }

  /** Darbe alınabilir mi — i-frame / parkour / ip / parry dışı */
  function canTakeDamageNow() {
    if (dead || !character) return false;
    if (ropeState !== "ground" || swingState) return false;
    if (forcedAnim === ANIM.parry && performance.now() < busyUntil) return false;
    if (DAMAGE_INVULN.has(forcedAnim) && performance.now() < busyUntil) {
      return false;
    }
    return true;
  }

  function playDead() {
    if (dead) return false;
    if (!actions[ANIM.dead]) {
      console.warn("Dead anim yok");
      return false;
    }
    dead = true;
    clearCombo();
    ropeState = "ground";
    swingState = null;
    airVelX = 0;
    ropeHookAnchorSet = false;
    ropeHookFx.setActive(false);
    activeRopeLatchY = null;
    velocityY = 0;
    if (character) character.position.y = 0;
    if (groundOffset) {
      groundOffset.position.y = 0;
      groundOffset.rotation.x = 0;
    }
    grounded = true;
    const action = play(ANIM.dead, { fade: 0.12, force: true, once: true });
    if (!action) return false;
    forcedAnim = ANIM.dead;
    busyUntil = Infinity;
    setStatus("Öldün · P ile kalk");
    return true;
  }

  function resetAlive() {
    if (!dead) return;
    dead = false;
    busyUntil = 0;
    forcedAnim = null;
    clearCombo();
    velocityY = 0;
    grounded = true;
    canDoubleJump = true;
    ropeState = "ground";
    swingState = null;
    airVelX = 0;
    ropeHookAnchorSet = false;
    ropeHookFx.setActive(false);
    activeRopeLatchY = null;
    if (character) character.position.y = 0;
    if (groundOffset) {
      groundOffset.position.y = 0;
      groundOffset.rotation.x = 0;
    }
    play(ANIM.idle, { fade: 0.15, force: true });
    setStatus("Kontrol: Main Char");
  }

  function handleActionKeys() {
    if (sceneSettings.control !== "main") return;

    if (keys.has("KeyP")) {
      keys.delete("KeyP");
      if (dead) resetAlive();
      else playDead();
      return;
    }

    if (dead) return;
    handleRopeKey();
    handleSwingKey();
    if (swingState) {
      if (keys.has("ArrowDown") || keys.has("KeyS")) {
        keys.delete("ArrowDown");
        keys.delete("KeyS");
        releaseSwing({ jump: false });
        return;
      }
      if (
        input.jumpQueued ||
        performance.now() < (input.jumpBufferUntil || 0)
      ) {
        if (tryJump(ANIM.jump)) {
          input.jumpQueued = false;
          input.jumpBufferUntil = 0;
        }
      }
      return;
    }
    if (ropeState !== "ground") return;

    if (
      input.jumpQueued ||
      performance.now() < (input.jumpBufferUntil || 0)
    ) {
      if (tryJump(ANIM.jump)) {
        input.jumpQueued = false;
        input.jumpBufferUntil = 0;
      } else if (performance.now() >= (input.jumpBufferUntil || 0)) {
        input.jumpQueued = false;
      }
    }
    if (keys.has("Space")) {
      const barrier = findBarrierAhead(VAULT_MAX_DIST);
      if (startVault(ANIM.vault, barrier)) {
        lastAutoVaultBarrier = barrier;
        lastAutoVaultFacing = vaultFacing;
      }
      keys.delete("Space");
    }
    if (keys.has("KeyR")) {
      const barrier = findBarrierAhead(VAULT_MAX_DIST);
      if (startVault(ANIM.roll, barrier)) {
        lastAutoVaultBarrier = barrier;
        lastAutoVaultFacing = vaultFacing;
      }
      keys.delete("KeyR");
    }

    tryAutoVault();

    if (input.xQueued) {
      input.xQueued = false;
      if (!mustSheatheKatana()) setKatanaDrawn(!katanaDrawn);
    }

    const canAttack = !isRunningInput();
    // J/L/K: kılıçlı → reverse-combo; kılıçsız → tam anim (kesme yok)
    if (keys.has("KeyJ")) {
      if (canAttack) {
        if (katanaDrawn) startReverseCombo(ANIM.slash);
        else playOneShot(ANIM.punch);
      }
      keys.delete("KeyJ");
    }
    if (keys.has("KeyK")) {
      if (canAttack) {
        if (katanaDrawn) startReverseCombo(ANIM.thrust);
        else if (playOneShot(ANIM.kickAlt)) triggerSpinExtras();
      }
      keys.delete("KeyK");
    }
    if (keys.has("KeyL")) {
      if (canAttack) {
        if (katanaDrawn) {
          if (startReverseCombo(ANIM.spin)) triggerSpinExtras();
        } else {
          const kickAnim = UNARMED_KICKS[unarmedKickIndex % UNARMED_KICKS.length];
          unarmedKickIndex += 1;
          if (playOneShot(kickAnim)) triggerSpinExtras();
        }
      }
      keys.delete("KeyL");
    }
    // F: kısa perfect pencere (basıştan ~300ms); basılı tutmak yetmez
    if (keys.has("KeyF") && canAttack) {
      if (forcedAnim !== ANIM.parry) {
        if (playOneShot(ANIM.parry)) {
          clearCombo();
          parryStartedAt = performance.now();
        }
      } else if (currentAction && currentAnimName === ANIM.parry) {
        const dur = currentAction.getClip().duration;
        if (currentAction.time > dur - 0.04) {
          currentAction.time = dur - 0.02;
          currentAction.setEffectiveTimeScale(0);
        }
        busyUntil = performance.now() + 200;
      }
    } else if (forcedAnim === ANIM.parry && !keys.has("KeyF")) {
      clearCombo();
      forcedAnim = null;
      busyUntil = 0;
      parryStartedAt = 0;
      if (currentAction) currentAction.setEffectiveTimeScale(1);
    }
    // E: tek basış; kılıçlı J/L, kılıçsız punch/kick — zincir bitince yeniden random
    if (input.eQueued) {
      input.eQueued = false;
      if (canAttack) startEAttack();
    }
    keys.delete("KeyE");

    // Shift/Ctrl koşu + çömelme tuşu (S / C / ↓) → slide
    {
      const slideKey =
        keys.has("ArrowDown") || keys.has("KeyS") || keys.has("KeyC");
      // Animasyon bitmeden yeni kayma yok
      if (slideKey && grounded && forcedAnim !== ANIM.slide) {
        const left = keys.has("KeyA") || keys.has("ArrowLeft");
        const right = keys.has("KeyD") || keys.has("ArrowRight");
        const moving = left !== right;
        const shift = keys.has("ShiftLeft") || keys.has("ShiftRight");
        const ctrl = keys.has("ControlLeft") || keys.has("ControlRight");
        const runningAnim =
          currentAnimName === ANIM.run || currentAnimName === ANIM.sprint;
        const running = shift || ctrl || runningAnim;
        if (moving && running && playOneShot(ANIM.slide)) {
          // Kılıçlı/kılıçsız koşu hızıyla birebir aynı
          const sprinting = ctrl || currentAnimName === ANIM.sprint;
          vaultMomentum = getRunMoveSpeed(sprinting);
          prevRootZ = null;
          vaultYScale = 1;
          vaultTargetBarrier = null;
          velocityY = 0;
          grounded = true;
          keys.delete("ArrowDown");
          keys.delete("KeyS");
          keys.delete("KeyC");
        }
      }
    }
  }

  function alignFeetToGround() {
    if (!groundOffset || !character) return;
    // Havada / zıplamada ayak kilidi animasyonu eziyor
    if (isJumpAnim(forcedAnim) || !grounded || character.position.y > 0.04) {
      return;
    }

    if (ropeState === "land") return;

    const hanging =
      currentAnimName === ANIM.hang ||
      currentAnimName === ANIM.hang1 ||
      currentAnimName === ANIM.hang2;

    if (hanging) {
      alignHangAboveGround();
      return;
    }

    if (currentAnimName === ANIM.idle && hipsBone) {
      idleHipsY = hipsBone.position.y;
    }

    groundOffset.position.y = 0;
    character.updateMatrixWorld(true);

    let minY = Infinity;
    for (const bone of footBones) {
      bone.getWorldPosition(_footPos);
      if (_footPos.y < minY) minY = _footPos.y;
    }

    if (Number.isFinite(minY)) {
      let sole = 0.02;
      if (currentAnimName === ANIM.crouchIdle) sole = 0.03;
      if (currentAnimName === ANIM.crouchWalk) sole = 0;
      groundOffset.position.y = character.position.y - minY + sole;
      return;
    }

    const crouching =
      currentAnimName === ANIM.crouchIdle ||
      currentAnimName === ANIM.crouchWalk;
    if (!crouching || !visual) return;

    const refY = idleHipsY ?? 0.4786;
    const localSink = hipsBone
      ? refY - hipsBone.position.y
      : currentAnimName === ANIM.crouchIdle
        ? 0.35
        : 0.13;
    groundOffset.position.y = Math.max(0, localSink * visual.scale.y);
  }

  function update(dt) {
    if (!character) return;
    updateHpBarPosition();
    updateHurtFlash(dt);
    if (!swingState) updateRopeHookVisual();

    forceSheatheIfNeeded();

    const swordTrailOn =
      katanaDrawn &&
      !!forcedAnim &&
      TRAIL_ANIMS.has(forcedAnim) &&
      performance.now() < busyUntil;
    const punchOn =
      !katanaDrawn &&
      forcedAnim === ANIM.punch &&
      performance.now() < busyUntil;
    const kickOn =
      !katanaDrawn &&
      UNARMED_KICKS.includes(forcedAnim) &&
      performance.now() < busyUntil;

    swordTrail.setActive(swordTrailOn);
    if (punchOn && handTipL && handTipR) {
      limbTrailL.bindMarkers(handTipL, handBaseL);
      limbTrailR.bindMarkers(handTipR, handBaseR);
    } else if (kickOn && footTipL && footTipR) {
      limbTrailL.bindMarkers(footTipL, footBaseL);
      limbTrailR.bindMarkers(footTipR, footBaseR);
    }
    limbTrailL.setActive(punchOn || kickOn);
    limbTrailR.setActive(punchOn || kickOn);

    swordTrail.update(dt);
    limbTrailL.update(dt);
    limbTrailR.update(dt);

    // Slide: ilk 1s kayma tozu, son 0.5s koşu tozu | Run/Sprint: ayak tozu | Zıplama
    const sliding = forcedAnim === ANIM.slide && performance.now() < busyUntil;
    const slideT = sliding && currentAction ? currentAction.time : 0;
    const slideSkidPhase = sliding && slideT < 1.0;
    const slideRunPhase = sliding && slideT >= 1.0;
    const jumpDustOn = performance.now() < jumpDustUntil;
    const doubleJumpDustOn = performance.now() < doubleJumpDustUntil;
    const runningDust =
      slideRunPhase ||
      (grounded &&
        !sliding &&
        !forcedAnim &&
        (currentAnimName === ANIM.run || currentAnimName === ANIM.sprint));
    const skidDustOn = slideSkidPhase || jumpDustOn;
    slideDustFx.setActive(skidDustOn);
    runDustFx.setActive(runningDust);
    doubleJumpDustFx.setActive(doubleJumpDustOn);

    const needFeet = skidDustOn || runningDust || doubleJumpDustOn;
    if (needFeet && character) {
      character.updateMatrixWorld(true);
      _slideFeet.set(character.position.x, 0.06, 0);
      if (footBones.length) {
        let n = 0;
        _slideFeet.set(0, 0, 0);
        for (const bone of footBones) {
          bone.getWorldPosition(_footPos);
          _slideFeet.add(_footPos);
          n++;
        }
        if (n) {
          _slideFeet.multiplyScalar(1 / n);
          // Yer slide/run/ilk zıplama: yere yapışık
          if (!doubleJumpDustOn) {
            _slideFeet.y = Math.min(_slideFeet.y, 0.08);
          }
        }
      } else if (doubleJumpDustOn) {
        _slideFeet.y = Math.max(0.2, character.position.y + 0.08);
      }
    }
    if (skidDustOn) slideDustFx.update(dt, _slideFeet, facing);
    else slideDustFx.update(dt);
    if (runningDust) runDustFx.update(dt, _slideFeet, facing);
    else runDustFx.update(dt);
    if (doubleJumpDustOn) doubleJumpDustFx.update(dt, _slideFeet, facing);
    else doubleJumpDustFx.update(dt);

    updateComboSegment();
    applyHipsLock();

    handleActionKeys();
    applyHipsLock();

    // Salıncak: kendi fiziği — normal hareket / gravity yok
    if (updateSwing(dt)) {
      updateRopeHookVisual();
      updateVisualFacing(dt);
      const { CAM_Z, CAM_SIDE } = getViewCam();
      const turnK = Math.min(1, dt * 3.2);
      smoothFacing += (facing - smoothFacing) * turnK;
      const sideOff = sceneSettings.view === "2d" ? 0 : smoothFacing * CAM_SIDE;
      const lookOff = sceneSettings.view === "2d" ? 0 : smoothFacing * 0.4;
      const targetCamX = character.position.x + sideOff;
      const targetLookX = character.position.x - lookOff;
      camera.position.x += (targetCamX - camera.position.x) * turnK;
      camera.position.y = lookSimple.camY ?? 2.75;
      camera.position.z = CAM_Z;
      camera.up.set(0, 1, 0);
      camera.lookAt(targetLookX, lookSimple.lookY ?? 1.75, 0);
      return;
    }

    if (dead) {
      if (currentAction && forcedAnim === ANIM.dead) {
        const dur = currentAction.getClip().duration;
        if (currentAction.time > dur - 0.02) {
          currentAction.time = dur - 0.001;
          currentAction.paused = true;
        }
      }
      alignDeadToGround();
      // Kamera takip devam
      const { CAM_Z, CAM_SIDE } = getViewCam();
      const turnK = Math.min(1, dt * 3.2);
      smoothFacing += (facing - smoothFacing) * turnK;
      const sideOff = sceneSettings.view === "2d" ? 0 : smoothFacing * CAM_SIDE;
      const lookOff = sceneSettings.view === "2d" ? 0 : smoothFacing * 0.4;
      const targetCamX = character.position.x + sideOff;
      const targetLookX = character.position.x - lookOff;
      camera.position.x += (targetCamX - camera.position.x) * turnK;
      camera.position.y = lookSimple.camY ?? 2.75;
      camera.position.z = CAM_Z;
      camera.up.set(0, 1, 0);
      camera.lookAt(targetLookX, lookSimple.lookY ?? 1.75, 0);
      return;
    }

    const now = performance.now();
    const left = keys.has("KeyA") || keys.has("ArrowLeft");
    const right = keys.has("KeyD") || keys.has("ArrowRight");
    const moving = left !== right;

    // İpte asılıyken sağ/sol ile dön (hareket yok); çıkış/inişte yön kilitli
    // Vault/roll sırasında yön kilitli — engel asisti ters tarafa fırlatmasın
    const vaultLocked =
      forcedAnim === ANIM.vault || forcedAnim === ANIM.roll;
    if (
      sceneSettings.control === "main" &&
      (ropeState === "ground" || ropeState === "hang") &&
      !swingState &&
      !vaultLocked
    ) {
      const prevFacing = facing;
      if (left && !right) facing = -1;
      if (right && !left) facing = 1;
      // Yön değiştiyse aynı engeli ters taraftan tekrar atlayabilsin
      if (facing !== prevFacing) {
        lastAutoVaultBarrier = null;
        lastAutoVaultFacing = 0;
      }
    }
    if (vaultLocked) facing = vaultFacing;

    {
      // Karakter yumuşak döner; facing anında, görsel yaw lerp
      updateVisualFacing(dt);
    }

    const loco = desiredLocomotion();
    if (now >= busyUntil) {
      prevRootZ = null;
      vaultTargetBarrier = null;
      vaultHandTargetX = null;
      vaultHandTargetY = null;
      vaultMomentum = 0;
      if (ropeState === "up") {
        // hang bitiş dünya yüksekliğini sakla — hang1 pozu bir sonraki mixer’dan sonra kilitlenir
        hangLockPendingRefY = measureHangRefY();
        hangLockWaitMixer = true;
        ropeLiftY = groundOffset?.position.y ?? ropeLiftY;
        ropeNeedRemeasure = false;
        ropeState = "hang";
        forcedAnim = ANIM.hang1;
        play(ANIM.hang1, { fade: 0, force: true });
        if (currentAction) {
          currentAction.setEffectiveWeight(1);
          currentAction.time = 0;
        }
      } else if (ropeState === "down") {
        // İniş clip bitti → yere kadar sit; değince kesilecek
        ropeLandFrom = groundOffset?.position.y ?? ropeFloorLift;
        ropeLandT = 0;
        ropeState = "land";
        play(ANIM.crouchIdle, {
          fade: 0.15,
          force: true,
          once: true,
        });
        forcedAnim = ANIM.crouchIdle;
        busyUntil = performance.now() + 5000; // land bitene kadar tut
      } else if (ropeState === "land") {
        // Yere oturana kadar sit (update)
      } else if (ropeState === "hang") {
        forcedAnim = ANIM.hang1;
        if (currentAnimName !== ANIM.hang1) play(ANIM.hang1);
      } else if (forcedAnim === ANIM.swingRelease && !grounded) {
        // Backflip süresi bitti — yatık son karede düşme, dik jump pozu
        finishSwingReleaseAirFall();
      } else if (isJumpAnim(forcedAnim) && !grounded) {
        // Clip bitti ama henüz yerde değil — idle'a geçme, son karede tut
        if (currentAction) {
          const dur = currentAction.getClip().duration;
          if (currentAction.time > dur - 0.02) {
            currentAction.time = dur - 0.001;
            currentAction.paused = true;
          }
        }
      } else if (forcedAnim === ANIM.swingRelease && grounded) {
        finishSwingReleaseUpright();
      } else {
        clearCombo();
        forcedAnim = null;
        hipsLockXZ = null;
        if (grounded) play(loco.anim);
      }
    }

    // busy sürmese bile backflip bittiyse havada dik düşüşe geç
    if (
      forcedAnim === ANIM.swingRelease &&
      !grounded &&
      currentAction &&
      !swingState
    ) {
      const dur = currentAction.getClip().duration;
      if (dur > 0 && currentAction.time >= dur * SWING_RELEASE_CUT) {
        finishSwingReleaseAirFall();
      }
    }

    const prevX = character.position.x;
    const usingRoot = applyRootMotion();

    const airAnims = new Set([
      ...JUMP_ANIMS,
      ANIM.vault,
      ANIM.roll,
      ANIM.slide,
      ANIM.swingHang,
      ANIM.swingRelease,
    ]);
    // Slash / thrust / spin / punch / parry: yürürken hafif hareket; tekme yerinde
    const moveDuringAction = new Set([
      ...airAnims,
      ANIM.slash,
      ANIM.spin,
      ANIM.thrust,
      ANIM.punch,
      ANIM.parry,
    ]);
    let speed = 0;
    if (
      ropeState === "ground" &&
      !usingRoot &&
      (!forcedAnim ||
        moveDuringAction.has(forcedAnim) ||
        LOOPING.has(forcedAnim))
    ) {
      if (moving) {
        if (ATTACK_ANIMS.has(forcedAnim) || forcedAnim === ANIM.parry) {
          // Havada: zıplama mesafesinin %50'si; yerde: walk %25 (parry aynı)
          const inAir = !grounded || character.position.y > 0.04;
          speed = inAir ? MOVE_SPEED.run * 0.5 : MOVE_SPEED.walk * 0.25;
        } else {
          speed = loco.speed || MOVE_SPEED.walk;
          if (isJumpAnim(forcedAnim)) speed = MOVE_SPEED.run;
        }
      }
    }

    if (
      usingRoot &&
      vaultMomentum > 0 &&
      (forcedAnim === ANIM.vault ||
        forcedAnim === ANIM.roll ||
        forcedAnim === ANIM.slide)
    ) {
      const moveFace =
        forcedAnim === ANIM.slide ? facing : vaultFacing;
      const moved = (character.position.x - prevX) * moveFace;
      const want = vaultMomentum * dt;
      if (forcedAnim === ANIM.slide) {
        // Slide: kılıçlı/kılıçsız koşu hızı (vaultMomentum) — root motion ezmesin
        character.position.x = prevX + facing * want;
      } else if (moved < want) {
        // Vault/roll: yavaşsa tamamla, hızlıysa bırak
        character.position.x += moveFace * (want - moved);
      }
    } else {
      character.position.x += facing * speed * dt;
      if (!grounded && Math.abs(airVelX) > 0.05) {
        character.position.x += airVelX * dt;
        airVelX *= Math.exp(-1.4 * dt);
      } else if (grounded) {
        airVelX = 0;
      }
    }

    if (!usingRoot) {
      if (ropeState !== "ground") {
        velocityY = 0;
        character.position.y = 0;
      } else {
        const prevY = character.position.y;
        velocityY -= GRAVITY * dt;
        character.position.y += velocityY * dt;

        // Zemin veya engel üstü
        const floorY =
          velocityY <= 0.08
            ? getBarrierFloorY(character.position.x, prevY)
            : 0;

        if (character.position.y <= floorY && velocityY <= 0) {
          const wasAir = !grounded;
          character.position.y = floorY;
          velocityY = 0;
          grounded = true;
          if (wasAir) {
            canDoubleJump = true;
            // Backflip / crouch düşüş — yere değince eğilme pozu kalsın
            if (
              forcedAnim === ANIM.swingRelease ||
              forcedAnim === ANIM.crouchIdle
            ) {
              finishSwingReleaseUpright();
            } else {
              busyUntil = 0;
              forcedAnim = null;
              vaultMomentum = 0;
              play(desiredLocomotion().anim, { fade: 0.12 });
            }
          }
        } else if (character.position.y > floorY + 0.04) {
          if (grounded) {
            coyoteUntil = performance.now() + COYOTE_MS;
          }
          grounded = false;
        }
      }
    } else {
      velocityY = 0;
    }

    character.position.z = 0;
    resolveBarrierCollision(prevX);

    // Parry knockback: engel çözümünden sonra uygula
    if (Math.abs(knockbackVel) >= 0.04) {
      const kbPrev = character.position.x;
      character.position.x += knockbackVel * dt;
      knockbackVel *= Math.exp(-7.5 * dt);
      resolveBarrierCollision(kbPrev);
    } else {
      knockbackVel = 0;
    }

    // İniş sonrası: hang offset → idle ayak, yumuşak
    if (ropeState === "land" && groundOffset) {
      ropeLandT += dt;
      const LAND_DUR = 0.45;
      const u = Math.min(1, ropeLandT / LAND_DUR);
      const s = u * u * (3 - 2 * u);

      groundOffset.position.y = 0;
      character.updateMatrixWorld(true);
      let minY = Infinity;
      for (const bone of footBones) {
        bone.getWorldPosition(_footPos);
        if (_footPos.y < minY) minY = _footPos.y;
      }
      const footTarget = Number.isFinite(minY)
        ? character.position.y - minY + 0.04
        : 0;
      groundOffset.position.y = ropeLandFrom * (1 - s) + footTarget * s;

      if (u >= 1) {
        // Yere değdi → sit bitsin, idle
        ropeState = "ground";
        forcedAnim = null;
        busyUntil = 0;
        ropeLiftY = 0;
        ropeFloorLift = 0;
        ropeUpFromLift = 0;
        ropeNeedRemeasure = false;
        ropeDescentReady = false;
        ropeDescentTop = null;
        ropeLandFrom = 0;
        ropeLandT = 0;
        ropeHookAnchorSet = false;
        ropeHookFx.setActive(false);
        activeRopeLatchY = null;
        play(desiredLocomotion().anim, { fade: 0.15 });
      }
    } else {
      const skipFeetAlign = new Set([
        ANIM.vault,
        ANIM.roll,
        ANIM.slide,
        ANIM.swingHang,
        ANIM.swingRelease,
        ...JUMP_ANIMS,
      ]);
      const inAir = !grounded || character.position.y > 0.04;
      const jumping =
        isJumpAnim(forcedAnim) ||
        isJumpAnim(currentAnimName) ||
        isSwingAirAnim(forcedAnim);
      if (!skipFeetAlign.has(forcedAnim) && !inAir && !jumping) {
        alignFeetToGround();
      } else if (jumping && groundOffset) {
        groundOffset.position.y = 0;
      } else if (forcedAnim === ANIM.roll && groundOffset) {
        groundOffset.position.y = 0.18;
      } else if (forcedAnim === ANIM.slide && groundOffset) {
        groundOffset.position.y = 0.15;
      }
    }

    // Roll: kafa tarafı zemine giriyorsa hafif yukarı eğ
    if (groundOffset) {
      if (forcedAnim === ANIM.roll && currentAction) {
        const dur = Math.max(currentAction.getClip().duration, 0.001);
        const t = Math.min(1, currentAction.time / dur);
        const u = t < 0.2 ? 0 : Math.min(1, (t - 0.2) / 0.45);
        const ROLL_HEAD_PITCH = 0.55; // ~31°
        // Parent rotation.y zaten aynalıyor — facing ile çarpma solda ters çeviriyordu
        groundOffset.rotation.x = ROLL_HEAD_PITCH * u;
      } else {
        groundOffset.rotation.x = 0;
      }
    }

    // Kamera: 2D düz / 2.5D yöne göre (kontrol main iken)
    if (sceneSettings.control === "main") {
      const { CAM_Z, CAM_SIDE } = getViewCam();
      const turnK = Math.min(1, dt * 3.2);
      smoothFacing += (facing - smoothFacing) * turnK;

      const sideOff = sceneSettings.view === "2d" ? 0 : smoothFacing * CAM_SIDE;
      const lookOff = sceneSettings.view === "2d" ? 0 : smoothFacing * 0.4;
      const targetCamX = character.position.x + sideOff;
      const targetLookX = character.position.x - lookOff;
      camera.position.x += (targetCamX - camera.position.x) * turnK;
      camera.position.y = lookSimple.camY ?? 2.75;
      camera.position.z = CAM_Z;
      camera.up.set(0, 1, 0);
      camera.lookAt(targetLookX, lookSimple.lookY ?? 1.75, 0);

      charKey.position.set(character.position.x, 2.4, 3.5);
    }

    // Key light her zaman ay yönünden (kontrol kimde olursa olsun)
    syncCharLightsFromMoon();
    syncCharEnvMap();
  }

  async function load() {
    setStatus("Model yükleniyor…");
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(MODEL_URL);

    visual = gltf.scene;
    characterMaterials.length = 0;
    baseCharacterColors = [];
    visual.traverse((obj) => {
      if (obj.isMesh) {
        obj.userData.dynamicShadowCaster = true;
        obj.userData.dynamicShadowKind = "mainChar";
        obj.castShadow =
          getAllowDynamicShadows() && dynamicShadowCast.mainChar;
        obj.receiveShadow = true;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if (!mat) continue;
          if (mat.color) baseCharacterColors.push(mat.color.clone());
          else baseCharacterColors.push(new THREE.Color(0x222222));
          characterMaterials.push(mat);
        }
      }
    });
    applyCasterPolicy(visual, "mainChar");    look.applyLookSettings();

    const size = new THREE.Vector3();
    new THREE.Box3().setFromObject(visual).getSize(size);
    modelScale = 1.75 / Math.max(size.y, 0.001);
    visual.scale.setScalar(modelScale);

    const bounds = new THREE.Box3().setFromObject(visual);
    baseVisualY = -bounds.min.y;
    visual.position.y = baseVisualY;

    character = new THREE.Group();
    groundOffset = new THREE.Group();
    groundOffset.add(visual);
    character.add(groundOffset);
    character.position.set(0, 0, 0);
    character.traverse((obj) => obj.layers.set(layerChar));
    scene.add(character);

    hipsBone = null;
    footBones.length = 0;
    handBones.length = 0;
    const boneByName = new Map();
    visual.traverse((obj) => {
      const consider = (b) => {
        boneByName.set(b.name, b);
        if (/hips$/i.test(b.name)) hipsBone = b;
      };
      if (obj.isSkinnedMesh && obj.skeleton) {
        for (const b of obj.skeleton.bones) consider(b);
      }
      if (obj.isBone || obj.type === "Bone") consider(obj);
    });
    for (const [name, b] of boneByName) {
      if (/Toe_End$/i.test(name)) footBones.push(b);
      if (/Hand$/i.test(name) && !/HandMiddle/i.test(name)) handBones.push(b);
    }
    if (!footBones.length) {
      for (const [name, b] of boneByName) {
        if (/Foot$/i.test(name)) footBones.push(b);
      }
    }
    console.log(
      "Hips:",
      hipsBone?.name,
      "Feet:",
      footBones.map((b) => b.name),
      "Hands:",
      handBones.map((b) => b.name)
    );

    function boneGet(...names) {
      for (const n of names) {
        const b = boneByName.get(n);
        if (b) return b;
      }
      return null;
    }
    function boneFind(re) {
      for (const [n, b] of boneByName) {
        if (re.test(n)) return b;
      }
      return null;
    }
    function makeTipOn(parent, name, localY = 0.06) {
      if (!parent) return null;
      const tip = new THREE.Object3D();
      tip.name = name;
      tip.position.set(0, localY, 0);
      parent.add(tip);
      return tip;
    }
    /** Splash şerit kalınlığı kılıç gibi olsun diye base uca yakın */
    function makeTipBasePair(parent, tipName, tipY, ribbon = 0.1) {
      if (!parent) return { tip: null, base: null };
      const tip = makeTipOn(parent, tipName, tipY);
      const base = new THREE.Object3D();
      base.name = tipName + "Base";
      // Tip’in biraz gerisi — kılıç tip/base mesafesine yakın
      const baseY = tipY >= 0 ? tipY - ribbon : tipY + ribbon;
      base.position.set(0, baseY, 0);
      parent.add(base);
      return { tip, base };
    }

    const leftHand =
      boneGet("mixamorig:LeftHand", "mixamorigLeftHand", "LeftHand") ||
      boneFind(/^mixamorig:?LeftHand$/i);
    const rightHand =
      boneGet("mixamorig:RightHand", "mixamorigRightHand", "RightHand") ||
      boneFind(/^mixamorig:?RightHand$/i);
    leftHandBone = leftHand;
    const leftFinger =
      boneGet(
        "mixamorig:LeftHandMiddle4",
        "mixamorigLeftHandMiddle4",
        "LeftHandMiddle4",
      ) || boneFind(/LeftHandMiddle4$/i) || leftHand;
    const rightFinger =
      boneGet(
        "mixamorig:RightHandMiddle4",
        "mixamorigRightHandMiddle4",
        "RightHandMiddle4",
      ) || boneFind(/RightHandMiddle4$/i) || rightHand;
    const leftToe =
      boneGet("mixamorig:LeftToe_End", "mixamorigLeftToe_End", "LeftToe_End") ||
      boneFind(/LeftToe_End$/i) ||
      boneFind(/LeftToeBase$/i);
    const rightToe =
      boneGet("mixamorig:RightToe_End", "mixamorigRightToe_End", "RightToe_End") ||
      boneFind(/RightToe_End$/i) ||
      boneFind(/RightToeBase$/i);
    const leftFoot =
      boneGet("mixamorig:LeftFoot", "mixamorigLeftFoot", "LeftFoot") ||
      boneFind(/LeftFoot$/i);
    const rightFoot =
      boneGet("mixamorig:RightFoot", "mixamorigRightFoot", "RightFoot") ||
      boneFind(/RightFoot$/i);

    {
      const L = makeTipBasePair(leftFinger, "PunchTipL", 0.48, 0.22);
      const R = makeTipBasePair(rightFinger, "PunchTipR", 0.48, 0.22);
      handTipL = L.tip;
      handBaseL = L.base;
      handTipR = R.tip;
      handBaseR = R.base;
    }
    {
      const L = makeTipBasePair(leftToe || leftFoot, "KickTipL", -0.72, 0.26);
      const R = makeTipBasePair(rightToe || rightFoot, "KickTipR", -0.72, 0.26);
      footTipL = L.tip;
      footBaseL = L.base;
      footTipR = R.tip;
      footBaseR = R.base;
    }
    console.log(
      "Limb splash · hands",
      !!handTipL && !!handTipR,
      "· feet",
      !!footTipL && !!footTipR,
    );

    rightHandBone =
      rightHand ||
      boneGet("RightHand", "mixamorigRightHand") ||
      [...boneByName.entries()].find(
        ([n]) =>
          /right.*hand$/i.test(n) &&
          !/middle|thumb|index|pinky|ring/i.test(n)
      )?.[1] ||
      handBones.find((b) => /right/i.test(b.name)) ||
      null;

    async function loadProp(url) {
      const g = await loader.loadAsync(url);
      const root = g.scene;
      root.traverse((o) => {
        o.layers.set(layerChar);
        if (o.isMesh) {
          o.userData.dynamicShadowCaster = true;
          o.userData.dynamicShadowKind = "mainChar";
          o.castShadow =
            getAllowDynamicShadows() && dynamicShadowCast.mainChar;
          o.receiveShadow = true;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const mat of mats) {
            if (!mat) continue;
            // Kılıç/kılıf da look + CHAR IBL alsın
            if (mat.color) baseCharacterColors.push(mat.color.clone());
            else baseCharacterColors.push(new THREE.Color(0x888888));
            characterMaterials.push(mat);
          }
        }
      });
      applyDynamicCharEnv(
        characterMaterials,
        scene.userData.charEnvMap || null,
        0.55,
      );
      return root;
    }

    function fitWorldLongest(obj, targetLen) {
      character.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const longest = Math.max(size.x, size.y, size.z, 0.001);
      obj.scale.multiplyScalar(targetLen / longest);
    }

    // Kılıç: elde (Katana.glb)
    if (rightHandBone) {
      try {
        const blade = await loadProp(KATANA_URL);
        const kBox0 = new THREE.Box3().setFromObject(blade);
        const kLen = kBox0.max.y - kBox0.min.y;
        // Kabza tutuşu (kılıf ayarından bağımsız)
        const gripY = kBox0.min.y + kLen * 0.12;
        const hold = new THREE.Group();
        hold.name = "KatanaHold";
        blade.position.set(0, -gripY, 0);
        // Trail: uç (daha önde) + uca yakın kenar
        katanaTipMarker = new THREE.Object3D();
        katanaTipMarker.name = "KatanaTip";
        katanaTipMarker.position.set(0, kBox0.max.y + kLen * 0.22, 0);
        blade.add(katanaTipMarker);
        katanaBaseMarker = new THREE.Object3D();
        katanaBaseMarker.name = "KatanaTrailBase";
        katanaBaseMarker.position.set(0, kBox0.max.y - kLen * 0.06, 0);
        blade.add(katanaBaseMarker);
        hold.rotation.set(0, 0, -Math.PI / 2);
        hold.add(blade);
        rightHandBone.add(hold);
        fitWorldLongest(hold, 1.4375);
        katana = hold;
        swordTrail.bindMarkers(katanaTipMarker, katanaBaseMarker);
        console.log("Katana el →", rightHandBone.name);
      } catch (err) {
        console.warn("Katana yüklenemedi:", err);
      }
    }

    // Kılıf: belde — çekiliyse boş kılıf, kınındaysa sheath+katana (ayrı pose)
    const hipsAttach =
      hipsBone ||
      boneByName.get("Hips") ||
      boneByName.get("mixamorigHips") ||
      [...boneByName.entries()].find(([n]) => /hips$/i.test(n))?.[1] ||
      null;
    if (hipsAttach) {
      try {
        function alignTipOrigin(prop, tipFrac = 0.08) {
          const box = new THREE.Box3().setFromObject(prop);
          const len = box.max.y - box.min.y;
          const mouthY = box.max.y - len * tipFrac;
          prop.position.set(0, -mouthY, 0);
        }

        const emptyHold = new THREE.Group();
        emptyHold.name = "KatanaSheathHold";
        const empty = await loadProp(KATANA_SHEATH_URL);
        alignTipOrigin(empty, 0.08);
        emptyHold.add(empty);
        hipsAttach.add(emptyHold);
        fitWorldLongest(emptyHold, 1.1);
        katanaSheath = emptyHold;
        sheathEmptyProp = emptyHold;
        applySheathPose(emptyHold);

        const fullHold = new THREE.Group();
        fullHold.name = "KatanaSheathFullHold";
        const twist = new THREE.Group();
        twist.name = "KatanaSheathFullTwist";
        const full = await loadProp(KATANA_SHEATH_WITH_KATANA_URL);
        alignTipOrigin(full, 0.08);
        twist.add(full);
        fullHold.add(twist);
        hipsAttach.add(fullHold);
        fitWorldLongest(fullHold, 1.1);
        sheathFullBaseScale = fullHold.scale.x;
        sheathFullTwist = twist;
        katanaSheathFull = fullHold;
        sheathFullProp = fullHold;
        applySheathFullPose(fullHold, {
          baseScale: sheathFullBaseScale,
          twistNode: twist,
        });

        setKatanaDrawn(katanaDrawn);
        look.applyLookSettings();
        console.log("Katana kılıf →", hipsAttach.name);
      } catch (err) {
        console.warn("Katana kılıf yüklenemedi:", err);
      }
    } else {
      console.warn("Hips bulunamadı — kılıf takılmadı");
    }

    mixer = new THREE.AnimationMixer(visual);
    const found = [];

    function prepareClip(clip) {
      if (clip.name === ANIM.vault || clip.name === ANIM.roll) {
        extractRootMotion(clip);
      } else if (clip.name === ANIM.slide) {
        extractRootMotion(clip, { keepY: true });
      } else if (
        clip.name === ANIM.spin ||
        clip.name === ANIM.punch ||
        clip.name === ANIM.kick ||
        clip.name === ANIM.kickAlt ||
        clip.name === ANIM.kickSpartan ||
        clip.name === ANIM.kickHigh ||
        clip.name === ANIM.kickSweep ||
        clip.name === ANIM.thrust ||
        clip.name === ANIM.slash ||
        clip.name === ANIM.parry ||
        clip.name === ANIM.dead ||
        /kick/i.test(clip.name) ||
        /punch/i.test(clip.name)
      ) {
        // Tekme/yumruk: XZ tamamen kilitle (Y serbest — zıplama tekmeleri)
        makeInPlace(clip, { keepY: true });
      } else if (clip.name === ANIM.swim) {
        makeInPlace(clip);
      } else if (
        clip.name === ANIM.hang ||
        clip.name === ANIM.hang1 ||
        clip.name === ANIM.hang2 ||
        clip.name === ANIM.swingHang
      ) {
        // Hepsi yerinde + Y kilit — yükseklik sadece groundOffset/ropeLiftY
        makeInPlace(clip);
      } else if (clip.name === ANIM.swingRelease) {
        // XZ kilitle; Y serbest — Y kilitlenince takla yerinde yatay kalıyordu
        makeInPlace(clip, { keepY: true });
      }
    }

    function registerClips(clipList, { overwrite = false } = {}) {
      for (const clip of clipList) {
        if (actions[clip.name] && !overwrite) continue;
        prepareClip(clip);
        actions[clip.name] = mixer.clipAction(clip);
        if (!found.includes(clip.name)) found.push(clip.name);
      }
    }

    registerClips(gltf.animations);

    try {
      const fightGltf = await loader.loadAsync(FIGHT_URL);
      registerClips(fightGltf.animations);
      console.log("Fight GLB anims yüklendi:", fightGltf.animations.map((c) => c.name));
    } catch (err) {
      console.warn("Fight GLB yüklenemedi:", err);
    }

    try {
      const climbGltf = await loader.loadAsync(CLIMB_URL);
      registerClips(climbGltf.animations);
      console.log(
        "Climb/swing GLB anims yüklendi:",
        climbGltf.animations.map((c) => c.name),
      );
    } catch (err) {
      console.warn("Climb/swing GLB yüklenemedi:", err);
    }

    for (const name of Object.values(ANIM)) {
      if (!actions[name]) {
        const fuzzy = found.find(
          (n) =>
            n.toLowerCase() === name.toLowerCase() ||
            n.toLowerCase().includes(name.toLowerCase())
        );
        if (fuzzy) actions[name] = actions[fuzzy];
      }
    }

    play(ANIM.idle, { fade: 0 });
    hp = PLAYER_MAX_HP;
    syncHpBar();
    setStatus(`Hazır · ${found.length} animasyon · WASD ile dene`);
    console.log("Animations:", found);
  }

  function updateMixer(dt) {
    if (mixer) mixer.update(dt);
  }

  return {
    load,
    update,
    updateMixer,
    get character() {
      return character;
    },
    get facing() {
      return facing;
    },
    get katanaDrawn() {
      return katanaDrawn;
    },
    get isParrying() {
      return forcedAnim === ANIM.parry && performance.now() < busyUntil;
    },
    /** İpte (çıkış / asılı / iniş) — ayak yere basınca false */
    get isRopeAirborne() {
      return ropeState !== "ground" || !!swingState;
    },
    /**
     * Soft sep yok: üzerinden atla, slide, vault/roll ile geç.
     * Yerden koşup içinden geçmeyi engellemez.
     */
    get ignoresSoftSeparation() {
      if (dead || this.isRopeAirborne) return true;
      if (!grounded || character?.position.y > 0.12) return true;
      if (
        forcedAnim === ANIM.slide ||
        forcedAnim === ANIM.vault ||
        forcedAnim === ANIM.roll ||
        isJumpAnim(forcedAnim)
      ) {
        return true;
      }
      return false;
    },
    /** Slide sırasında darbe yok */
    get isSliding() {
      return forcedAnim === ANIM.slide && performance.now() < busyUntil;
    },
    /** true → hasar alınabilir (slide / vault / roll / ip / parry dışı) */
    get canTakeDamage() {
      return canTakeDamageNow();
    },
    /** Çömelme (arkadan gizlilik) */
    get isCrouching() {
      if (
        currentAnimName === ANIM.crouchIdle ||
        currentAnimName === ANIM.crouchWalk ||
        limboCrouchHold
      ) {
        return true;
      }
      if (!grounded || ropeState !== "ground") return false;
      return isCrouchKeyDown();
    },
    /** Shift/Ctrl koşu veya run/sprint anim */
    get isRunning() {
      return isRunningInput();
    },
    /** Perfect: F’ye bastıktan sonraki kısa pencere (~300ms) */
    get isPerfectParryWindow() {
      if (!this.isParrying || !parryStartedAt) return false;
      const age = performance.now() - parryStartedAt;
      return age >= 0 && age <= PARRY_PERFECT_MS;
    },
    /** Parry’de düşman vurunca sen kay — dir: -1 sol / +1 sağ */
    applyParryKnockback(dir) {
      if (dead || !character) return;
      const d = dir >= 0 ? 1 : -1;
      knockbackVel = d * 8.5;
    },
    takeDamage,
    get hp() {
      return hp;
    },
    get maxHp() {
      return PLAYER_MAX_HP;
    },
    /** J/L yakın dövüş saldırısı aktif mi */
    get isMeleeAttacking() {
      return (
        ATTACK_ANIMS.has(forcedAnim) && performance.now() < busyUntil
      );
    },
    /** Splash↔karakter hacmi enemy’ye değiyor mu */
    swordTrailHits(target) {
      return (
        swordTrail.hitsTarget(target, character) ||
        limbTrailL.hitsTarget(target, character) ||
        limbTrailR.hitsTarget(target, character)
      );
    },
  };
}
