import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  BOMBER_URL,
  BOMBER_TARGET_HEIGHT,
  BOMBER_ANIM,
  BOMBER_LOOPING,
  BOMBER_RADIUS,
  BOMBER_MAX_HP,
  BOMBER_BLAST_RADIUS,
} from "./bomberAnims.js";
import { ENEMY_URL } from "./anims.js";
import { createBomberAi } from "./bomberAi.js";
import { createFuseSparkFx } from "../fx/fuseSpark.js";
import { createExplosionFx } from "../fx/explosion.js";
import { createRunDustFx } from "../fx/runDust.js";
import { facingYaw } from "../scene/viewMode.js";

const GRAVITY = 28;
const JUMP_VY = 9.2;
/** Knife Enemy ile aynı ölüm zemin payı */
const DIE_GROUND_PAD = 0.06;

/**
 * Canlı bomba düşmanı — idle bekler, 10m’de koşar (+engel zıpla),
 * 3m’de Pull_Radish → bitince patlar.
 */
export function createBomber({
  scene,
  barriers = [],
  layerChar = 1,
  setAnimLabel = null,
  getTargetX = null,
  getIsCrouching = null,
  /** Patlama anında (worldPos) — oyuncu knockback vb. */
  onExplode = null,
}) {
  let character = null;
  let visual = null;
  let mixer = null;
  const actions = {};
  let currentAction = null;
  let currentAnimName = "";
  let facing = -1;
  let displayYaw = facingYaw(-1);
  let velocityY = 0;
  let grounded = true;
  let busyUntil = 0;
  let jumping = false;
  let stunUntil = 0;
  let runBumpStunTagged = false;
  let animFreeze = null;
  /** idle | chase | detonating | dead | gone */
  let state = "idle";
  let fuseMarker = null;
  let finishedListener = null;
  let detonateTimer = 0;
  let hp = BOMBER_MAX_HP;
  let hurtFlash = 0;
  const bomberMaterials = [];
  const footBones = [];
  /** Ölüm hizası — knife Enemy ile aynı (ayak + tüm kemikler) */
  const dieFootBones = [];
  const _bonePos = new THREE.Vector3();
  const FEET_PAD = 0.04;
  /** İlk spawn — patlama / ölüm sonrası buraya döner */
  const spawnPose = { x: -20, y: 0, z: 0, face: 1 };
  let respawnTimer = 0;

  const fuseFx = createFuseSparkFx(scene);
  const boomFx = createExplosionFx(scene);
  const runDustFx = createRunDustFx(scene, { layer: layerChar });
  const _boomPos = new THREE.Vector3();
  const _runFeet = new THREE.Vector3();

  const ai = createBomberAi({
    getTargetX,
    getSpawnX: () => spawnPose.x,
    getSpawnFace: () => spawnPose.face,
    getIsCrouching,
    getCharacter: () => character,
    getBusyUntil: () => busyUntil,
    getStunUntil: () => stunUntil,
    getState: () => state,
    setState: (s) => {
      state = s;
    },
    getCurrentAnimName: () => currentAnimName,
    getGrounded: () => grounded,
    getFacing: () => facing,
    setFacing: (face) => {
      facing = face >= 0 ? 1 : -1;
    },
    play: (...args) => play(...args),
    tryJump: () => tryJump(),
    findBarrierAhead: (dir, maxDist) => findBarrierAhead(dir, maxDist),
    faceTowardTarget: () => faceTowardTarget(),
    applyFacingPose: () => applyFacingPose(),
    beginDetonate: () => beginDetonate(),
  });

  function triggerHurtFlash() {
    hurtFlash = 1;
  }

  function updateHurtFlash(dt) {
    if (hurtFlash <= 0) {
      hurtFlash = 0;
      return;
    }
    hurtFlash = Math.max(0, hurtFlash - dt * 2.8);
    const e = hurtFlash * hurtFlash;
    for (const mat of bomberMaterials) {
      if (!mat?.emissive) continue;
      mat.emissive.setRGB(e * 1.0, e * 0.55, e * 0.08);
      if ("emissiveIntensity" in mat) mat.emissiveIntensity = 0.2 + e * 1.6;
    }
    if (hurtFlash <= 0) {
      for (const mat of bomberMaterials) {
        if (!mat?.emissive) continue;
        mat.emissive.setRGB(0, 0, 0);
        if ("emissiveIntensity" in mat) mat.emissiveIntensity = 1;
      }
    }
  }

  /** Oyuncu vuruşu — arkadan isabet = anında ölüm (patlama yok) */
  function playHit(damage = 1) {
    if (state === "gone" || state === "dead") return false;
    // Fitil çekiyorsa bile kes — patlamadan ölsün
    if (finishedListener && mixer) {
      mixer.removeEventListener("finished", finishedListener);
      finishedListener = null;
    }
    void damage;
    hp = 0;
    triggerHurtFlash();
    playDie();
    return true;
  }

  function clearDetonateWatchers() {
    if (finishedListener && mixer) {
      mixer.removeEventListener("finished", finishedListener);
      finishedListener = null;
    }
    if (detonateTimer) {
      window.clearTimeout(detonateTimer);
      detonateTimer = 0;
    }
  }

  /** Pull_Radish kaldığı yerden + bitince patlama */
  function armDetonateFinish(action) {
    if (!action || !mixer) return;
    clearDetonateWatchers();

    const scale = Math.max(0.01, action.getEffectiveTimeScale() || 1);
    const dur = action.getClip()?.duration ?? 0;
    const left = Math.max(0.05, (dur - action.time) / scale);

    finishedListener = (e) => {
      if (e.action !== action) return;
      clearDetonateWatchers();
      explodeNow();
    };
    mixer.addEventListener("finished", finishedListener);

    detonateTimer = window.setTimeout(() => {
      detonateTimer = 0;
      if (state === "detonating") explodeNow();
    }, left * 1000 + 80);

    busyUntil = performance.now() + left * 1000;
  }

  /** Koşu itmesi: Hit_Reaction; bitince önceki anim kaldığı yerden */
  function clearAnimFreeze({ resume = true } = {}) {
    if (!animFreeze) return;
    const f = animFreeze;
    animFreeze = null;
    if (!resume) return;
    if (!f.action) return;

    const hit = actions[BOMBER_ANIM.hit];
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
    next.time = f.time;

    currentAction = next;
    currentAnimName = f.name;
    const now = performance.now();
    busyUntil = now + Math.max(0, f.busyLeft || 0);
    setAnimLabel?.(`Bomber: ${f.name || "resume"}`);
    syncFuse();

    // Pull_Radish’e dönüş → patlama izleyicisini yeniden kur
    if (f.name === BOMBER_ANIM.pullRadish && state === "detonating") {
      armDetonateFinish(next);
    }
  }

  function applyRunBumpStun(sec = 1) {
    if (state === "gone" || state === "dead") {
      return false;
    }
    if (animFreeze && performance.now() < stunUntil) return true;
    if (animFreeze) clearAnimFreeze({ resume: true });

    if (!actions[BOMBER_ANIM.hit]) {
      console.warn("Bomber hit anim yok (run bump)");
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
      busyLeft: Math.max(0, busyUntil - now),
    };

    // Fitil çekiliyorsa patlama sayacını durdur — stun bitince kaldığı yerden
    if (state === "detonating") {
      clearDetonateWatchers();
    }

    stunUntil = now + sec * 1000;
    runBumpStunTagged = true;
    busyUntil = Math.max(busyUntil, stunUntil);
    triggerHurtFlash();
    play(BOMBER_ANIM.hit, {
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
      const hit = actions[BOMBER_ANIM.hit];
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

  /** Knife Enemy.js ile aynı: sadece gömülünce kaldır */
  function alignDeadToGround() {
    if (!character || !visual) return;
    character.updateMatrixWorld(true);
    const minY = getDeadPoseMinY();
    if (!Number.isFinite(minY)) return;
    if (minY < DIE_GROUND_PAD) {
      character.position.y += DIE_GROUND_PAD - minY;
    }
  }

  /**
   * Knife ile aynı ölüm: dying_backwards (Enemy_with_knife.glb).
   * Patlama yok — yerde uzanır, sonra spawn.
   */
  function playDie() {
    if (state === "dead" || state === "gone") return false;
    clearAnimFreeze({ resume: false });
    runBumpStunTagged = false;
    stunUntil = 0;
    clearDetonateWatchers();
    fuseFx.clear();
    state = "dead";
    hp = 0;
    busyUntil = Infinity;
    jumping = false;
    velocityY = 0;
    grounded = true;

    // Prosedürel yatırma kalıntısını temizle
    if (character) {
      character.rotation.set(0, 0, 0);
      character.quaternion.identity();
      character.position.y = 0;
      applyFacingPose({ instant: true });
    }

    if (!actions[BOMBER_ANIM.die]) {
      console.warn("Bomber die anim yok:", BOMBER_ANIM.die);
      if (character) {
        character.visible = false;
        if (character.parent) scene.remove(character);
      }
      state = "gone";
      respawnTimer = 1.1;
      return false;
    }

    if (mixer) mixer.stopAllAction();
    currentAction = null;
    currentAnimName = "";

    const action = play(BOMBER_ANIM.die, { fade: 0.12, force: true, once: true });
    if (action) {
      action.enabled = true;
      action.setEffectiveWeight(1);
      action.setEffectiveTimeScale(1);
      action.clampWhenFinished = true;
    }
    if (mixer) {
      mixer.update(0);
      alignDeadToGround();
    }

    finishedListener = (e) => {
      if (e.action !== action) return;
      mixer.removeEventListener("finished", finishedListener);
      finishedListener = null;
      if (action) {
        action.time = Math.max(0, action.getClip().duration - 1e-3);
        action.paused = true;
        action.setEffectiveWeight(1);
      }
      alignDeadToGround();
    };
    mixer.addEventListener("finished", finishedListener);

    const dur = actions[BOMBER_ANIM.die].getClip().duration;
    respawnTimer = dur + 1.6;
    setAnimLabel?.(`Bomber: ${BOMBER_ANIM.die}`);
    return true;
  }

  function applyFacingPose({ instant = false } = {}) {
    if (!character) return;
    const target = facingYaw(facing);
    if (instant) {
      displayYaw = target;
      character.rotation.y = displayYaw;
    }
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
      const left = b.x - b.halfT - BOMBER_RADIUS;
      const right = b.x + b.halfT + BOMBER_RADIUS;
      if (!(x > left && x < right)) continue;
      if (y >= b.height - 0.05) continue;
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
        if (jumping) {
          jumping = false;
          busyUntil = 0;
        }
      }
    }
  }

  function tryJump() {
    if (!actions[BOMBER_ANIM.jump]) return false;
    if (!grounded) return false;
    if (state === "detonating" || state === "gone" || state === "dead") {
      return false;
    }
    if (!action) return false;
    const dur = action.getClip().duration;
    busyUntil = now + dur * 1000 * 0.9;
    velocityY = JUMP_VY;
    grounded = false;
    jumping = true;
    return true;
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

  function play(name, { fade = 0.18, force = false, once = false, allowStun = false } = {}) {
    if (animFreeze && performance.now() < stunUntil && !allowStun) {
      if (name === BOMBER_ANIM.die) {
        clearAnimFreeze({ resume: false });
      } else {
        return currentAction;
      }
    }
    const next = actions[name];
    if (!next) {
      console.warn("Bomber missing anim:", name);
      return null;
    }
    if (currentAction === next && !force) return next;

    next.reset();
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    const loop = !once && BOMBER_LOOPING.has(name);
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
      if (fade <= 0) {
        next.weight = 1;
        next.enabled = true;
      } else {
        next.fadeIn(fade);
      }
    }
    next.play();
    currentAction = next;
    currentAnimName = name;
    setAnimLabel?.(`Bomber: ${name}`);
    syncFuse();
    return next;
  }

  function playOneShot(name) {
    if (state === "gone" || state === "dead") return false;
    const now = performance.now();
    if (now < busyUntil) return false;
    const action = play(name, { fade: 0.1, force: true, once: true });
    if (!action) return false;
    const dur = action.getClip().duration;
    busyUntil = now + dur * 1000 * 0.95;
    return true;
  }

  function syncFuse() {
    // Idle’da fitil sönük; koşu / pull radish vb. yanar
    const lit =
      state !== "gone" &&
      state !== "dead" &&
      currentAnimName !== BOMBER_ANIM.idle;
    fuseFx.setActive(lit);
  }

  function beginDetonate() {
    if (state === "detonating" || state === "gone" || state === "dead") {
      return false;
    }
    if (!actions[BOMBER_ANIM.pullRadish]) {
      explodeNow();
      return true;
    }
    state = "detonating";
    const action = play(BOMBER_ANIM.pullRadish, {
      fade: 0.08,
      force: true,
      once: true,
    });
    if (!action) {
      explodeNow();
      return true;
    }
    // Önceki 1.5×’ten %50 daha hızlı → 2.25×
    action.setEffectiveTimeScale(2.25);
    armDetonateFinish(action);
    return true;
  }

  function explodeNow() {
    if (state === "gone") return;
    state = "gone";
    busyUntil = Infinity;
    jumping = false;
    fuseFx.clear();
    clearAnimFreeze({ resume: false });
    runBumpStunTagged = false;
    stunUntil = 0;
    clearDetonateWatchers();
    if (mixer) mixer.stopAllAction();

    if (character) {
      character.updateMatrixWorld(true);
      if (fuseMarker) fuseMarker.getWorldPosition(_boomPos);
      else character.getWorldPosition(_boomPos);
      _boomPos.y = Math.max(0.6, _boomPos.y);
      boomFx.spawn(_boomPos, {
        color: 0xff6a18,
        count: 32,
        radius: BOMBER_BLAST_RADIUS,
      });
      onExplode?.(_boomPos.clone(), facing);
      character.visible = false;
      if (character.parent) scene.remove(character);
    }
    currentAction = null;
    currentAnimName = "";
    setAnimLabel?.("Bomber: exploded");
    // Kısa ara → ilk spawn noktasına yeniden
    respawnTimer = 1.1;
  }

  function respawn() {
    if (!character) return;
    clearDetonateWatchers();
    if (mixer) mixer.stopAllAction();
    character.visible = true;
    character.position.set(spawnPose.x, spawnPose.y, spawnPose.z);
    facing = spawnPose.face;
    velocityY = 0;
    grounded = true;
    jumping = false;
    busyUntil = 0;
    stunUntil = 0;
    runBumpStunTagged = false;
    clearAnimFreeze({ resume: false });
    state = "idle";
    hp = BOMBER_MAX_HP;
    hurtFlash = 0;
    character.rotation.set(0, 0, 0);
    character.quaternion.identity();
    applyFacingPose({ instant: true });
    if (!character.parent) scene.add(character);
    currentAction = null;
    currentAnimName = "";
    ai.reset?.();
    play(BOMBER_ANIM.idle, { fade: 0, force: true });
    if (mixer) mixer.update(0);
    setAnimLabel?.(`Bomber: ${BOMBER_ANIM.idle}`);
    syncFuse();
  }

  async function load({ x = -20, y = 0, z = 0, face = 1 } = {}) {
    spawnPose.x = x;
    spawnPose.y = y;
    spawnPose.z = z;
    spawnPose.face = face;
    const loader = new GLTFLoader();
    const [gltf, knifeGltf] = await Promise.all([
      loader.loadAsync(BOMBER_URL),
      loader.loadAsync(ENEMY_URL),
    ]);

    visual = gltf.scene;
    bomberMaterials.length = 0;
    visual.traverse((obj) => {
      obj.layers.set(layerChar);
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if (mat) bomberMaterials.push(mat);
        }
      }
    });

    const size = new THREE.Vector3();
    new THREE.Box3().setFromObject(visual).getSize(size);
    const modelScale = BOMBER_TARGET_HEIGHT / Math.max(size.y, 0.001);
    visual.scale.setScalar(modelScale);

    const bounds = new THREE.Box3().setFromObject(visual);
    visual.position.y = -bounds.min.y;

    character = new THREE.Group();
    character.name = "EnemyBomber";
    character.add(visual);
    character.position.set(x, y, z);
    facing = face;
    applyFacingPose({ instant: true });
    character.traverse((obj) => obj.layers.set(layerChar));
    scene.add(character);

    mixer = new THREE.AnimationMixer(visual);
    for (const clip of gltf.animations) {
      if (
        clip.name === BOMBER_ANIM.idle ||
        clip.name === BOMBER_ANIM.run ||
        clip.name === BOMBER_ANIM.walk ||
        clip.name === BOMBER_ANIM.pullRadish ||
        clip.name === BOMBER_ANIM.jump ||
        clip.name === BOMBER_ANIM.charge
      ) {
        // Root motion kaymasını kes (idle dahil — spawn’da kaymasın)
        makeInPlace(clip, { keepY: false });
      }
      actions[clip.name] = mixer.clipAction(clip);
    }

    // Knife enemy ile aynı ölüm clip’i — makeInPlace yok (Enemy’de de yok)
    const dieSrc = knifeGltf.animations.find((c) => c.name === BOMBER_ANIM.die);
    if (dieSrc) {
      const dieClip = dieSrc.clone();
      actions[dieClip.name] = mixer.clipAction(dieClip);
    } else {
      console.warn("Bomber: knife GLB’de dying_backwards yok");
    }

    // Koşu itmesi sersemliği — knife Hit_Reaction
    const hitSrc = knifeGltf.animations.find((c) => c.name === BOMBER_ANIM.hit);
    if (hitSrc) {
      const hitClip = hitSrc.clone();
      makeInPlace(hitClip, { keepY: true });
      actions[hitClip.name] = mixer.clipAction(hitClip);
    } else {
      console.warn("Bomber: knife GLB’de Hit_Reaction yok");
    }

    footBones.length = 0;
    dieFootBones.length = 0;
    visual.traverse((o) => {
      if (o.isSkinnedMesh && o.skeleton) {
        for (const b of o.skeleton.bones) {
          if (/Toe_End$|Foot$|ToeBase$/i.test(b.name)) {
            footBones.push(b);
            dieFootBones.push(b);
          }
        }
      }
      if ((o.isBone || o.type === "Bone") && /Toe_End$|Foot$|ToeBase$/i.test(o.name)) {
        footBones.push(o);
        dieFootBones.push(o);
      }
    });

    // Göbek bombası fitil ucu — Spine1 lokal (mesh’ten kestirim)
    let spine1 = null;
    visual.traverse((o) => {
      if (!o.isBone && o.type !== "Bone") return;
      if (/Spine1$/i.test(o.name) || o.name === "mixamorig:Spine1") {
        spine1 = o;
      }
    });
    fuseMarker = new THREE.Object3D();
    fuseMarker.name = "BomberFuseTip";
    // Model birimlerinde: göbek bombası üstü / fitil
    fuseMarker.position.set(0.12, 0.14, 0.42);
    if (spine1) spine1.add(fuseMarker);
    else visual.add(fuseMarker);
    fuseFx.bind(fuseMarker);

    state = "idle";
    hp = BOMBER_MAX_HP;
    play(BOMBER_ANIM.idle, { fade: 0 });
    mixer.update(0);
    character.updateMatrixWorld(true);
    const posed = new THREE.Box3().setFromObject(character);
    visual.position.y += -posed.min.y + 0.05;

    console.log(
      "Bomber yüklendi · scale",
      modelScale.toFixed(3),
      "· anims:",
      Object.keys(actions),
      "· fuse parent",
      spine1?.name || "visual",
    );
    return character;
  }

  function getPoseMinY() {
    let minY = Infinity;
    if (footBones.length) {
      for (const bone of footBones) {
        bone.getWorldPosition(_bonePos);
        if (_bonePos.y < minY) minY = _bonePos.y;
      }
    } else {
      visual?.traverse((o) => {
        if (!o.isSkinnedMesh || !o.skeleton) return;
        for (const bone of o.skeleton.bones) {
          bone.getWorldPosition(_bonePos);
          if (_bonePos.y < minY) minY = _bonePos.y;
        }
      });
    }
    return minY;
  }

  /** Knife Enemy.getPoseMinY ile aynı: ayak kemikleri + tüm skeleton */
  function getDeadPoseMinY() {
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

  /** Ayaklar zemine otursun (koşu / idle / pull radish) */
  function alignFeetToGround() {
    if (!character || !visual) return;
    character.updateMatrixWorld(true);
    const minY = getPoseMinY();
    if (!Number.isFinite(minY)) return;
    character.position.y += FEET_PAD - minY;
    if (character.position.y < 0) character.position.y = 0;
  }

  function updateMixer(dt) {
    if (mixer && state !== "gone") mixer.update(dt);
  }

  function updateRunDust(dt) {
    const running =
      !!character &&
      grounded &&
      state !== "gone" &&
      state !== "dead" &&
      state !== "detonating" &&
      !animFreeze &&
      performance.now() >= stunUntil &&
      (currentAnimName === BOMBER_ANIM.run ||
        currentAnimName === BOMBER_ANIM.charge);
    runDustFx.setActive(running);
    if (running) {
      character.updateMatrixWorld(true);
      _runFeet.set(character.position.x, 0.06, 0);
      if (footBones.length) {
        let n = 0;
        _runFeet.set(0, 0, 0);
        for (const bone of footBones) {
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
    boomFx.update(dt);
    fuseFx.update(dt);
    if (!character) return;

    if (state === "gone") {
      if (respawnTimer > 0) {
        respawnTimer -= dt;
        if (respawnTimer <= 0) {
          respawnTimer = 0;
          respawn();
        }
      }
      updateRunDust(dt);
      return;
    }

    if (state === "dead") {
      applyFacingPose({ instant: true });
      alignDeadToGround();
      if (respawnTimer > 0) {
        respawnTimer -= dt;
        if (respawnTimer <= 0) {
          respawnTimer = 0;
          respawn();
        }
      }
      updateRunDust(dt);
      return;
    }

    const prevX = character.position.x;
    tickRunBumpFreeze();
    if (state !== "detonating") {
      ai.update(dt);
      applyGravity(dt);
      // Rifle_Charge vb. ayakları gömüyor → yerdeyken her kare hizala
      if (grounded) alignFeetToGround();
    } else {
      faceTowardTarget();
      velocityY = 0;
      grounded = true;
      alignFeetToGround();
    }
    updateVisualFacing(dt);
    updateHurtFlash(dt);
    character.position.z = 0;
    resolveBarrierCollision(prevX);
    syncFuse();
    updateRunDust(dt);
  }

  function dispose() {
    fuseFx.dispose();
    boomFx.dispose?.();
    runDustFx.dispose();
    if (character) scene.remove(character);
    state = "gone";
  }

  return {
    load,
    update,
    updateMixer,
    dispose,
    beginDetonate,
    playHit,
    applyRunBumpStun,
    get character() {
      return character;
    },
    get facing() {
      return facing;
    },
    get dead() {
      return state === "gone" || state === "dead";
    },
    get state() {
      return state;
    },
    get hp() {
      return hp;
    },
    get isStunned() {
      return performance.now() < stunUntil;
    },
    get isRunBumpStunned() {
      return performance.now() < stunUntil && runBumpStunTagged;
    },
    get allowSoftSep() {
      return true;
    },
    get allowRunBump() {
      return true;
    },
  };
}
