import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  ENEMY_URL,
  ENEMY_TARGET_HEIGHT,
  ENEMY_ANIM,
  ENEMY_LOOPING,
  ENEMY_MOVE,
  ENEMY_MAX_HP,
  ENEMY_RADIUS,
  ENEMY_KNIFE_TRAIL_ANIMS,
} from "./anims.js";
import { createEnemyAi } from "./ai.js";
import { sampleEyeColorHex } from "./eyeColor.js";
import { createSwordTrail } from "../main_char/swordTrail.js";
import { createRunDustFx } from "../fx/runDust.js";
import { sceneSettings } from "../scene/sceneMenu.js";
import { getViewCam, facingYaw } from "../scene/viewMode.js";
import { lookSimple } from "../main_char/look.js";
import { dynamicShadowCast, applyCasterPolicy, applyDynamicCharEnv } from "../scene/shadowPolicy.js";

const GRAVITY = 28;
const JUMP_VY = 9.2;
const DOUBLE_JUMP_VY = 8.4;

/**
 * Bıçak düşmanı — boyut/duruş main gibi; kontrol edilebilir + AI.
 */
export function createEnemy({
  scene,
  camera,
  keys,
  input,
  barriers = [],
  layerChar = 1,
  envSun = null,
  setAnimLabel = null,
  /** @type {(() => number | null) | null} oyuncu X — enemy ona bakar */
  getTargetX = null,
  /** @type {(() => boolean) | null} oyuncu çömeliyor mu */
  getIsCrouching = null,
}) {
  let character = null;
  let visual = null;
  let mixer = null;
  const actions = {};
  let currentAction = null;
  let currentAnimName = "";
  let facing = -1;
  let smoothFacing = -1;
  /** Görsel yaw — ani flip yok, yumuşak döner */
  let displayYaw = facingYaw(-1);
  let velocityY = 0;
  let grounded = true;
  let canDoubleJump = true;
  let busyUntil = 0;
  let forcedAnim = null;
  let dead = false;
  let hp = ENEMY_MAX_HP;
  /** Perfect parry sersemlik bitiş zamanı */
  let stunUntil = 0;
  /** Son stun koşu itmesinden mi (oyuncu i-frame için) */
  let runBumpStunTagged = false;
  /** Koşu itmesi: mevcut animasyonu dondur / kaldığı yerden devam */
  let animFreeze = null;
  /** Perfect parry geri kayma */
  let knockbackVel = 0;
  /** İlk spawn — hedef kaybolunca buraya yürür */
  const spawnPose = { x: 3.8, y: 0, z: 0, face: -1 };
  const dieFootBones = [];
  const enemyMaterials = [];
  let hurtFlash = 0;
  const _bonePos = new THREE.Vector3();
  const _hpWorld = new THREE.Vector3();
  const _runFeet = new THREE.Vector3();
  const DIE_GROUND_PAD = 0.06;
  const hpWrap = document.getElementById("enemyHpWrap");
  const hpFill = document.getElementById("enemyHpFill");
  const runDustFx = createRunDustFx(scene, { layer: layerChar });
  let appliedCharEnv = null;

  let knifeTrailL = null;
  let knifeTrailR = null;
  let knifeTipL = null;
  let knifeBaseL = null;
  let knifeTipR = null;
  let knifeBaseR = null;

  const ai = createEnemyAi({
    getTargetX,
    getSpawnX: () => spawnPose.x,
    getSpawnFace: () => spawnPose.face,
    getIsCrouching,
    getCharacter: () => character,
    getBusyUntil: () => busyUntil,
    getStunUntil: () => stunUntil,
    getForcedAnim: () => forcedAnim,
    setForcedAnim: (v) => {
      forcedAnim = v;
    },
    getCurrentAnimName: () => currentAnimName,
    getCurrentAction: () => currentAction,
    getIsRunBumpFrozen: () =>
      !!runBumpStunTagged && performance.now() < stunUntil,
    getGrounded: () => grounded,
    getFacing: () => facing,
    setFacing: (face) => {
      facing = face >= 0 ? 1 : -1;
    },
    play: (...args) => play(...args),
    playOneShot: (name) => playOneShot(name),
    tryJump: () => tryJump(),
    findBarrierAhead: (dir, maxDist) => findBarrierAhead(dir, maxDist),
    faceTowardTarget: () => faceTowardTarget(),
    applyFacingPose: () => applyFacingPose(),
  });

  function updateKnifeTrails(dt) {
    if (!knifeTrailL || !knifeTrailR) return;
    const on =
      !dead &&
      !!forcedAnim &&
      ENEMY_KNIFE_TRAIL_ANIMS.has(forcedAnim) &&
      performance.now() < busyUntil;
    if (on && knifeTipL && knifeTipR) {
      knifeTrailL.bindMarkers(knifeTipL, knifeBaseL);
      knifeTrailR.bindMarkers(knifeTipR, knifeBaseR);
    }
    knifeTrailL.setActive(on);
    knifeTrailR.setActive(on);
    knifeTrailL.update(dt);
    knifeTrailR.update(dt);
  }

  function isControlled() {
    return sceneSettings.control === "enemy" && !dead;
  }

  function syncHpBar() {
    if (!hpFill) return;
    const pct = Math.max(0, Math.min(1, hp / ENEMY_MAX_HP));
    hpFill.style.width = `${pct * 100}%`;
  }

  function triggerHurtFlash() {
    hurtFlash = 1;
    if (hpWrap) {
      hpWrap.classList.remove("hurt");
      void hpWrap.offsetWidth;
      hpWrap.classList.add("hurt");
    }
  }

  function updateHurtFlash(dt) {
    if (hurtFlash <= 0) {
      hurtFlash = 0;
      return;
    }
    hurtFlash = Math.max(0, hurtFlash - dt * 2.8);
    const e = hurtFlash * hurtFlash;
    for (const mat of enemyMaterials) {
      if (!mat?.emissive) continue;
      mat.emissive.setRGB(e * 1.0, e * 0.05, e * 0.08);
      if ("emissiveIntensity" in mat) mat.emissiveIntensity = 0.2 + e * 1.6;
    }
    if (hurtFlash <= 0) {
      for (const mat of enemyMaterials) {
        if (!mat?.emissive) continue;
        mat.emissive.setRGB(0, 0, 0);
        if ("emissiveIntensity" in mat) mat.emissiveIntensity = 1;
      }
      hpWrap?.classList.remove("hurt");
    }
  }

  function updateHpBarPosition() {
    if (!hpWrap || !character || !camera) return;
    if (dead || hp <= 0) {
      hpWrap.hidden = true;
      return;
    }
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

  /** Skinned AABB yalan söyler — kemiklerden en düşük Y */
  function getPoseMinY() {
    let minY = Infinity;
    if (dieFootBones.length) {
      for (const bone of dieFootBones) {
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

  function alignDeadToGround() {
    if (!character || !visual) return;
    character.updateMatrixWorld(true);
    const minY = getPoseMinY();
    if (!Number.isFinite(minY)) return;
    if (minY < DIE_GROUND_PAD) {
      character.position.y += DIE_GROUND_PAD - minY;
    }
  }

  function applyFacingPose({ instant = false } = {}) {
    if (!character) return;
    const target = facingYaw(facing);
    if (instant) {
      displayYaw = target;
      character.rotation.y = displayYaw;
    }
    // Ani değilse updateVisualFacing(dt) yumuşatır
  }

  function updateVisualFacing(dt) {
    if (!character) return;
    const target = facingYaw(facing);
    let dy = target - displayYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const k = 1 - Math.exp(-5.2 * dt);
    displayYaw += dy * k;
    character.rotation.y = displayYaw;
  }

  /** Hedef soldaysa sola, sağdaysa sağa bak (yön, açı değil) */
  function faceTowardTarget() {
    if (!character || !getTargetX) return;
    const tx = getTargetX();
    if (tx == null || !Number.isFinite(tx)) return;
    const dx = tx - character.position.x;
    if (Math.abs(dx) < 0.08) return;
    facing = dx > 0 ? 1 : -1;
  }

  function findBarrierAhead(dir = facing, maxDist = 2.0) {
    if (!character || !barriers?.length) return null;
    const x = character.position.x;
    let best = null;
    let bestDist = maxDist;
    for (const b of barriers) {
      const faceX = b.x - dir * b.halfT;
      const d = (faceX - x) * dir;
      if (d > 0.12 && d < bestDist) {
        best = b;
        bestDist = d;
      }
    }
    return best;
  }

  function resolveBarrierCollision(prevX) {
    if (!character || !barriers?.length) return;
    let x = character.position.x;
    const y = character.position.y;

    for (const b of barriers) {
      const left = b.x - b.halfT - ENEMY_RADIUS;
      const right = b.x + b.halfT + ENEMY_RADIUS;
      if (!(x > left && x < right)) continue;
      // Üstünden aştıysa geçir
      if (y >= b.height - 0.05) continue;
      // Zıplarken yükselişte / yarı yükseklikte yan blok yok — yerinde zıplamasın
      if (!grounded && (velocityY > 0.5 || y >= b.height * 0.4)) continue;
      const mid = (left + right) / 2;
      if (prevX <= mid) x = left;
      else x = right;
    }

    character.position.x = x;
    character.position.y = Math.max(0, y);
  }

  function applyGravity(dt) {
    if (!character) return;
    velocityY -= GRAVITY * dt;
    character.position.y += velocityY * dt;
    if (character.position.y <= 0) {
      character.position.y = 0;
      velocityY = 0;
      if (!grounded) {
        grounded = true;
        canDoubleJump = true;
        if (forcedAnim === ENEMY_ANIM.jump) {
          busyUntil = 0;
          forcedAnim = null;
        }
      }
    }
  }

  function applyKnockbackMotion(dt) {
    if (!character || Math.abs(knockbackVel) < 0.04) {
      knockbackVel = 0;
      return;
    }
    const prevX = character.position.x;
    character.position.x += knockbackVel * dt;
    knockbackVel *= Math.exp(-7.5 * dt);
    resolveBarrierCollision(prevX);
  }

  /** Perfect parry: düşmanı geri kaydır — dir -1 sol / +1 sağ */
  function applyParryKnockback(dir) {
    if (dead || !character) return;
    knockbackVel = (dir >= 0 ? 1 : -1) * 8.5;
  }

  function knifeTrailHits(target) {
    if (!knifeTrailL || !knifeTrailR) return false;
    // Sadece J/L/K saldırı animinde
    if (
      !forcedAnim ||
      !ENEMY_KNIFE_TRAIL_ANIMS.has(forcedAnim) ||
      performance.now() >= busyUntil
    ) {
      return false;
    }
    return (
      knifeTrailL.hitsTarget(target, character) ||
      knifeTrailR.hitsTarget(target, character)
    );
  }

  function getKnifeHitPoint(target) {
    if (!knifeTrailL || !knifeTrailR) return null;
    if (
      !forcedAnim ||
      !ENEMY_KNIFE_TRAIL_ANIMS.has(forcedAnim) ||
      performance.now() >= busyUntil
    ) {
      return null;
    }
    return (
      knifeTrailL.getHitPoint(target, character) ||
      knifeTrailR.getHitPoint(target, character)
    );
  }

  function play(name, { fade = 0.18, force = false, once = false, allowStun = false } = {}) {
    // Koşu-itme stun: sadece Hit_Reaction / ölüm
    if (animFreeze && performance.now() < stunUntil && !allowStun) {
      if (name === ENEMY_ANIM.die) {
        clearAnimFreeze({ resume: false });
      } else {
        return currentAction;
      }
    }
    const next = actions[name];
    if (!next) {
      console.warn("Enemy missing anim:", name);
      return null;
    }
    if (currentAction === next && !force) return next;

    next.reset();
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    const loop = !once && ENEMY_LOOPING.has(name);
    if (loop) {
      next.setLoop(THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = false;
    } else {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    }

    if (currentAction && currentAction !== next) {
      currentAction.crossFadeTo(next, fade, false);
    } else {
      next.fadeIn(fade);
    }
    next.play();
    currentAction = next;
    currentAnimName = name;
    setAnimLabel?.(`Enemy: ${name}`);
    return next;
  }

  function playOneShot(name) {
    if (dead) return false;
    const now = performance.now();
    if (now < busyUntil) return false;
    const action = play(name, { fade: 0.1, force: true, once: true });
    if (!action) return false;
    forcedAnim = name;
    const dur = action.getClip().duration;
    busyUntil = now + dur * 1000 * 0.92;
    return true;
  }

  function playHit(damage = 1) {
    if (dead) return false;
    clearAnimFreeze({ resume: false });
    runBumpStunTagged = false;
    const dmg = Math.max(1, Math.floor(damage));
    hp = Math.max(0, hp - dmg);
    syncHpBar();
    triggerHurtFlash();
    if (hp <= 0) {
      playDie();
      return true;
    }
    if (!actions[ENEMY_ANIM.hit]) {
      console.warn("Enemy hit anim yok");
      return true;
    }
    const action = play(ENEMY_ANIM.hit, { fade: 0.08, force: true, once: true });
    if (!action) return true;
    forcedAnim = ENEMY_ANIM.hit;
    const dur = action.getClip().duration;
    busyUntil = performance.now() + dur * 1000 * 0.9;
    return true;
  }

  function applyParryStun(sec = 3) {
    if (dead) return false;
    // Parry hâlâ Hit_Reaction
    clearAnimFreeze({ resume: false });
    const now = performance.now();
    stunUntil = now + sec * 1000;
    runBumpStunTagged = false;
    if (!actions[ENEMY_ANIM.hit]) {
      busyUntil = Math.max(busyUntil, stunUntil);
      forcedAnim = null;
      play(ENEMY_ANIM.idle, { fade: 0.12, force: true });
      return true;
    }
    const action = play(ENEMY_ANIM.hit, { fade: 0.08, force: true, once: true });
    if (!action) return false;
    forcedAnim = ENEMY_ANIM.hit;
    const dur = action.getClip().duration;
    busyUntil = now + dur * 1000 * 0.95;
    return true;
  }

  function clearAnimFreeze({ resume = true } = {}) {
    if (!animFreeze) return;
    const f = animFreeze;
    animFreeze = null;
    if (!resume) return;
    if (!f.action) return;

    const hit = actions[ENEMY_ANIM.hit];
    const next = f.action;
    next.enabled = true;
    next.paused = false;
    next.time = f.time;
    next.setEffectiveWeight(1);
    next.setEffectiveTimeScale(f.scale > 0.01 ? f.scale : 1);
    next.play();

    if (currentAction && currentAction !== next) {
      currentAction.crossFadeTo(next, 0.12, false);
    } else if (hit && hit !== next && hit.isRunning()) {
      hit.crossFadeTo(next, 0.12, false);
    }
    // crossFade zamanı ezmesin
    next.time = f.time;

    currentAction = next;
    currentAnimName = f.name;
    forcedAnim = f.forced;
    const now = performance.now();
    busyUntil = now + Math.max(0, f.busyLeft || 0);
    setAnimLabel?.(`Enemy: ${f.name || "resume"}`);
  }

  /**
   * Koşu itmesi: Hit_Reaction stun; bitince önceki anim kaldığı yerden.
   */
  function applyRunBumpStun(sec = 1) {
    if (dead) return false;
    if (animFreeze && performance.now() < stunUntil) return true;
    if (animFreeze) clearAnimFreeze({ resume: true });

    if (!actions[ENEMY_ANIM.hit]) {
      console.warn("Enemy hit anim yok (run bump)");
      return false;
    }

    const action = currentAction;
    const now = performance.now();
    const scale = action?.getEffectiveTimeScale?.() ?? 1;
    animFreeze = {
      action,
      time: action?.time ?? 0,
      scale: Math.abs(scale) > 0.01 ? scale : 1,
      name: currentAnimName,
      forced: forcedAnim,
      busyLeft: Math.max(0, busyUntil - now),
    };

    stunUntil = now + sec * 1000;
    runBumpStunTagged = true;
    busyUntil = Math.max(busyUntil, stunUntil);
    forcedAnim = ENEMY_ANIM.hit;
    play(ENEMY_ANIM.hit, {
      fade: 0.08,
      force: true,
      once: true,
      allowStun: true,
    });
    return true;
  }

  function tickRunBumpFreeze() {
    if (!animFreeze) return;
    if (performance.now() < stunUntil) {
      // Stun clipi biterse son karede tut
      const hit = actions[ENEMY_ANIM.hit];
      if (hit && currentAction === hit) {
        const dur = hit.getClip()?.duration ?? 0;
        if (dur > 0 && hit.time >= dur - 0.02) {
          hit.paused = true;
          hit.time = dur;
          hit.setEffectiveTimeScale(0);
        }
      }
      return;
    }
    clearAnimFreeze({ resume: true });
    runBumpStunTagged = false;
  }

  function playDie() {
    if (!actions[ENEMY_ANIM.die]) {
      console.warn("Enemy die anim yok");
      return false;
    }
    clearAnimFreeze({ resume: false });
    dead = true;
    hp = 0;
    syncHpBar();
    if (hpWrap) hpWrap.hidden = true;
    busyUntil = Infinity;
    forcedAnim = ENEMY_ANIM.die;
    if (character) character.position.y = 0;
    play(ENEMY_ANIM.die, { fade: 0.12, force: true, once: true });
    setAnimLabel?.(`Enemy: ${ENEMY_ANIM.die}`);
    if (mixer) {
      mixer.update(0);
      alignDeadToGround();
    }
    return true;
  }

  function resetAlive() {
    dead = false;
    hp = ENEMY_MAX_HP;
    syncHpBar();
    busyUntil = 0;
    stunUntil = 0;
    runBumpStunTagged = false;
    clearAnimFreeze({ resume: false });
    forcedAnim = null;
    velocityY = 0;
    grounded = true;
    canDoubleJump = true;
    if (character) character.position.y = 0;
    play(ENEMY_ANIM.idle, { fade: 0.15, force: true });
    if (mixer && character) {
      mixer.update(0);
      character.updateMatrixWorld(true);
      const posed = new THREE.Box3().setFromObject(character);
      if (Number.isFinite(posed.min.y) && posed.min.y < 0.05) {
        character.position.y += 0.05 - posed.min.y;
      }
    }
  }

  function tryJump() {
    if (!actions[ENEMY_ANIM.jump]) return false;
    if (grounded) {
      if (!playOneShot(ENEMY_ANIM.jump)) return false;
      velocityY = JUMP_VY;
      grounded = false;
      canDoubleJump = true;
      return true;
    }
    if (!canDoubleJump) return false;
    if (!playOneShot(ENEMY_ANIM.jump)) return false;
    velocityY = DOUBLE_JUMP_VY;
    canDoubleJump = false;
    return true;
  }

  function desiredLocomotion() {
    const left = keys.has("KeyA") || keys.has("ArrowLeft");
    const right = keys.has("KeyD") || keys.has("ArrowRight");
    const moving = left !== right;
    const shift = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const ctrl = keys.has("ControlLeft") || keys.has("ControlRight");

    if (!moving) return { anim: ENEMY_ANIM.idle, speed: 0 };
    if (ctrl) return { anim: ENEMY_ANIM.charge, speed: ENEMY_MOVE.charge };
    if (shift) return { anim: ENEMY_ANIM.run, speed: ENEMY_MOVE.run };
    return { anim: ENEMY_ANIM.walk, speed: ENEMY_MOVE.walk };
  }

  function handleActionKeys() {
    if (!isControlled()) return;

    if (input.jumpQueued) {
      input.jumpQueued = false;
      tryJump();
    }

    const now = performance.now();
    if (now < busyUntil) return;

    if (keys.has("KeyJ")) {
      playOneShot(ENEMY_ANIM.punch);
      keys.delete("KeyJ");
    }
    if (keys.has("KeyL")) {
      playOneShot(ENEMY_ANIM.weaponCombo);
      keys.delete("KeyL");
    }
    if (keys.has("KeyK")) {
      playOneShot(ENEMY_ANIM.shieldPush);
      keys.delete("KeyK");
    }
  }

  function makeInPlace(clip, { keepY = false } = {}) {
    const track = clip.tracks.find((t) => /hips\.position$/i.test(t.name));
    if (!track) return;
    const x0 = track.values[0];
    const y0 = track.values[1];
    const z0 = track.values[2];
    for (let i = 0; i < track.values.length; i += 3) {
      track.values[i] = x0;
      if (!keepY) track.values[i + 1] = y0;
      track.values[i + 2] = z0;
    }
  }

  async function load({
    x = 3.8,
    y = 0,
    z = 0,
    face = -1,
  } = {}) {
    spawnPose.x = x;
    spawnPose.y = y;
    spawnPose.z = z;
    spawnPose.face = face;
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(ENEMY_URL);

    visual = gltf.scene;
    enemyMaterials.length = 0;
    visual.traverse((obj) => {
      obj.layers.set(layerChar);
      if (obj.isMesh) {
        obj.castShadow = dynamicShadowCast.enemy;
        obj.receiveShadow = true;
        obj.userData.dynamicShadowCaster = true;
        obj.userData.dynamicShadowKind = "enemy";
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if (mat) enemyMaterials.push(mat);
        }
      }
    });
    applyCasterPolicy(visual, "enemy");
    applyDynamicCharEnv(enemyMaterials, scene.userData.charEnvMap || null, 0.55);

    const size = new THREE.Vector3();
    new THREE.Box3().setFromObject(visual).getSize(size);
    const modelScale = ENEMY_TARGET_HEIGHT / Math.max(size.y, 0.001);
    visual.scale.setScalar(modelScale);

    const bounds = new THREE.Box3().setFromObject(visual);
    visual.position.y = -bounds.min.y;

    character = new THREE.Group();
    character.name = "EnemyWithKnife";
    character.add(visual);
    character.position.set(x, y, z);
    facing = face;
    smoothFacing = face;
    applyFacingPose({ instant: true });
    character.traverse((obj) => obj.layers.set(layerChar));
    scene.add(character);

    mixer = new THREE.AnimationMixer(visual);
    for (const clip of gltf.animations) {
      if (
        clip.name === ENEMY_ANIM.weaponCombo ||
        clip.name === ENEMY_ANIM.hit
      ) {
        makeInPlace(clip, { keepY: true });
      }
      actions[clip.name] = mixer.clipAction(clip);
    }

    dieFootBones.length = 0;
    const boneByName = new Map();
    visual.traverse((o) => {
      if (o.isSkinnedMesh && o.skeleton) {
        for (const b of o.skeleton.bones) {
          boneByName.set(b.name, b);
          if (/Toe_End$|Foot$|ToeBase$/i.test(b.name)) dieFootBones.push(b);
        }
      }
      if (o.isBone || o.type === "Bone") {
        boneByName.set(o.name, o);
        if (/Toe_End$|Foot$|ToeBase$/i.test(o.name)) dieFootBones.push(o);
      }
    });

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
    function makeTipBasePair(parent, tipName, tipY, ribbon = 0.22) {
      if (!parent) return { tip: null, base: null };
      const tip = new THREE.Object3D();
      tip.name = tipName;
      tip.position.set(0, tipY, 0);
      parent.add(tip);
      const base = new THREE.Object3D();
      base.name = tipName + "Base";
      const baseY = tipY >= 0 ? tipY - ribbon : tipY + ribbon;
      base.position.set(0, baseY, 0);
      parent.add(base);
      return { tip, base };
    }

    const leftFinger =
      boneGet(
        "mixamorig:LeftHandMiddle4",
        "mixamorigLeftHandMiddle4",
        "LeftHandMiddle4",
      ) ||
      boneFind(/LeftHandMiddle4$/i) ||
      boneGet("mixamorig:LeftHand", "LeftHand");
    const rightFinger =
      boneGet(
        "mixamorig:RightHandMiddle4",
        "mixamorigRightHandMiddle4",
        "RightHandMiddle4",
      ) ||
      boneFind(/RightHandMiddle4$/i) ||
      boneGet("mixamorig:RightHand", "RightHand");

    {
      const L = makeTipBasePair(leftFinger, "EnemyKnifeTipL", 0.28, 0.18);
      const R = makeTipBasePair(rightFinger, "EnemyKnifeTipR", 0.28, 0.18);
      knifeTipL = L.tip;
      knifeBaseL = L.base;
      knifeTipR = R.tip;
      knifeBaseR = R.base;
    }

    const eyeHex = sampleEyeColorHex(visual);
    knifeTrailL = createSwordTrail(scene, { color: eyeHex });
    knifeTrailR = createSwordTrail(scene, { color: eyeHex });
    console.log(
      "Enemy knife splash · eye",
      `#${eyeHex.toString(16).padStart(6, "0")}`,
      "· tips",
      !!knifeTipL && !!knifeTipR,
    );

    if (!actions[ENEMY_ANIM.idle]) {
      console.warn("Enemy idle anim yok:", ENEMY_ANIM.idle);
    } else {
      play(ENEMY_ANIM.idle, { fade: 0, force: true });
    }

    mixer.update(0);
    character.updateMatrixWorld(true);
    const posed = new THREE.Box3().setFromObject(character);
    const FEET_LIFT = 0.05;
    visual.position.y += -posed.min.y + FEET_LIFT;

    console.log(
      "Enemy yüklendi · scale",
      modelScale.toFixed(3),
      "· anims:",
      Object.keys(actions),
    );
    hp = ENEMY_MAX_HP;
    syncHpBar();
    return character;
  }

  function updateMixer(dt) {
    if (mixer) mixer.update(dt);
  }

  function updateRunDust(dt) {
    const running =
      !!character &&
      !dead &&
      grounded &&
      !animFreeze &&
      performance.now() >= stunUntil &&
      (currentAnimName === ENEMY_ANIM.run ||
        currentAnimName === ENEMY_ANIM.charge);
    runDustFx.setActive(running);
    if (running) {
      character.updateMatrixWorld(true);
      _runFeet.set(character.position.x, 0.06, 0);
      if (dieFootBones.length) {
        let n = 0;
        _runFeet.set(0, 0, 0);
        for (const bone of dieFootBones) {
          bone.getWorldPosition(_bonePos);
          _runFeet.add(_bonePos);
          n++;
        }
        if (n) {
          _runFeet.multiplyScalar(1 / n);
          _runFeet.y = Math.min(_runFeet.y, 0.08);
        }
      }
      runDustFx.update(dt, _runFeet, facing);
    } else {
      runDustFx.update(dt);
    }
  }

  function update(dt) {
    if (!character) return;

    updateHpBarPosition();
    updateHurtFlash(dt);
    updateKnifeTrails(dt);
    tickRunBumpFreeze();

    if (!isControlled()) {
      if (dead) {
        applyFacingPose({ instant: true });
        alignDeadToGround();
        updateRunDust(dt);
        return;
      }
      const prevX = character.position.x;
      if (sceneSettings.control === "main") {
        ai.update(dt);
      } else {
        faceTowardTarget();
        const now = performance.now();
        if (now >= busyUntil && forcedAnim && !animFreeze) {
          forcedAnim = null;
          play(ENEMY_ANIM.idle, { fade: 0.2, force: true });
        }
      }
      updateVisualFacing(dt);
      applyGravity(dt);
      character.position.z = 0;
      resolveBarrierCollision(prevX);
      applyKnockbackMotion(dt);
      updateRunDust(dt);
      return;
    }

    handleActionKeys();

    const left = keys.has("KeyA") || keys.has("ArrowLeft");
    const right = keys.has("KeyD") || keys.has("ArrowRight");
    if (left && !right) facing = -1;
    if (right && !left) facing = 1;
    else if (!left && !right) faceTowardTarget();
    updateVisualFacing(dt);

    const now = performance.now();
    const loco = desiredLocomotion();
    const prevX = character.position.x;

    if (now >= busyUntil) {
      forcedAnim = null;
      if (grounded) play(loco.anim);
    }

    let speed = 0;
    if (now >= busyUntil && grounded) {
      speed = loco.speed;
    } else if (!grounded) {
      speed = ENEMY_MOVE.run * 0.55;
    }

    character.position.x += facing * speed * dt;
    applyGravity(dt);
    character.position.z = 0;
    resolveBarrierCollision(prevX);
    applyKnockbackMotion(dt);
    updateRunDust(dt);

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

    const env = scene.userData.charEnvMap || null;
    if (env !== appliedCharEnv) {
      appliedCharEnv = env;
      applyDynamicCharEnv(enemyMaterials, env, 0.55);
    }
  }

  function setFacing(face) {
    facing = face >= 0 ? 1 : -1;
  }

  return {
    load,
    update,
    updateMixer,
    play,
    playHit,
    playDie,
    resetAlive,
    setFacing,
    knifeTrailHits,
    getKnifeHitPoint,
    applyParryStun,
    applyRunBumpStun,
    applyParryKnockback,
    get isStunned() {
      return performance.now() < stunUntil;
    },
    get isRunBumpStunned() {
      return performance.now() < stunUntil && runBumpStunTagged;
    },
    /** Soft sep / koşu itmesi — false ile kapat */
    get allowSoftSep() {
      return true;
    },
    get allowRunBump() {
      return true;
    },
    get character() {
      return character;
    },
    get facing() {
      return facing;
    },
    get dead() {
      return dead;
    },
    get hp() {
      return hp;
    },
    get maxHp() {
      return ENEMY_MAX_HP;
    },
  };
}
