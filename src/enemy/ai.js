import { ENEMY_ANIM, ENEMY_MOVE } from "./anims.js";

/** Aggro / dövüş mesafeleri (sahne birimi ≈ metre) */
export const AI_CONFIG = {
  aggroRange: 5,
  attackRange: 1.7,
  /** Soft sep ile uyumlu — bundan içeri yürüme */
  holdDist: 1.6,
  /** Bundan uzaksa koş, yakınsa yürü */
  chaseFastDist: 3.5,
  /** Engel yüzeyi bu mesafedeyse zıpla */
  jumpBarrierDist: 2.0,
  /** Spawn’a dönüş toleransı */
  spawnArriveDist: 0.2,
  /** Hedef kaybolunca idle bekleyip sonra spawn’a dön (sn) */
  lostIdleSec: 2,
  /** Idle beklerken yön değiştirme (sn) */
  idleTurnSec: 10,
  /** Perfect parry sonrası sersemlik (sn) */
  parryStunSec: 3,
  attacks: [
    ENEMY_ANIM.weaponCombo,
    ENEMY_ANIM.punch,
    ENEMY_ANIM.shieldPush,
  ],
};

/**
 * Enemy AI — yaklaşınca kovala; engelde zıpla; yakında dövüş.
 * Hedef kaybolunca / aggro dışı spawn’a yürüyerek döner.
 *
 * @param {object} api
 */
export function createEnemyAi(api) {
  const {
    getTargetX,
    getSpawnX,
    getSpawnFace,
    getIsCrouching,
    getCharacter,
    getBusyUntil,
    getStunUntil,
    getForcedAnim,
    setForcedAnim,
    getCurrentAnimName,
    getCurrentAction,
    getIsRunBumpFrozen,
    getGrounded,
    getFacing,
    setFacing,
    play,
    playOneShot,
    tryJump,
    findBarrierAhead,
    faceTowardTarget,
    applyFacingPose,
  } = api;

  const {
    aggroRange,
    attackRange,
    holdDist = 1.6,
    chaseFastDist,
    jumpBarrierDist,
    spawnArriveDist,
    attacks,
  } = AI_CONFIG;
  const idleTurnSec = AI_CONFIG.idleTurnSec ?? 10;

  /** Hedef kayıp → idle bekleme bitiş zamanı (0 = zamana bağlı değil) */
  let lostIdleUntil = 0;
  let wasTracking = false;
  let nextIdleTurnAt = 0;

  /** Çömelip düşmanın arkasındaysa görünmez */
  function isStealthedBehind(tx, enemyX) {
    if (!getIsCrouching?.()) return false;
    const face = getFacing?.() ?? 1;
    const dx = tx - enemyX;
    if (Math.abs(dx) < 0.25) return false;
    return dx * face < 0;
  }

  /** Idle: her N sn rastgele sola/sağa bak */
  function tickIdleTurn(now) {
    if (nextIdleTurnAt <= 0) {
      nextIdleTurnAt = now + idleTurnSec * 1000;
      applyFacingPose();
      return;
    }
    if (now >= nextIdleTurnAt) {
      nextIdleTurnAt = now + idleTurnSec * 1000;
      setFacing(Math.random() < 0.5 ? -1 : 1);
    }
    applyFacingPose();
  }

  function playIdlePose(now) {
    tickIdleTurn(now);
    if (getCurrentAnimName() !== ENEMY_ANIM.idle) {
      play(ENEMY_ANIM.idle, { fade: 0.2, force: true });
    }
  }

  /** Ana karakter yok / aggro dışı → önce idle, sonra spawn’a yürü */
  function returnToSpawn(dt) {
    const character = getCharacter();
    if (!character) return;

    const now = performance.now();
    const spawnX = getSpawnX?.();
    const towardSpawn =
      spawnX != null && Number.isFinite(spawnX)
        ? spawnX - character.position.x
        : 0;
    const dir = towardSpawn === 0 ? 1 : towardSpawn > 0 ? 1 : -1;

    // Zıplama busy: havadayken spawn yönüne koşu hızıyla süzül
    if (now < getBusyUntil()) {
      if (!getGrounded() && Math.abs(towardSpawn) > spawnArriveDist) {
        setFacing(dir);
        applyFacingPose();
        character.position.x += dir * ENEMY_MOVE.run * 0.75 * dt;
        character.position.z = 0;
      }
      return;
    }

    if (getForcedAnim()) setForcedAnim(null);

    // Yeni kayıp: idle bekle
    if (wasTracking) {
      wasTracking = false;
      lostIdleUntil = now + AI_CONFIG.lostIdleSec * 1000;
    }

    if (now < lostIdleUntil) {
      playIdlePose(now);
      return;
    }

    if (spawnX == null || !Number.isFinite(spawnX)) {
      playIdlePose(now);
      return;
    }

    if (Math.abs(towardSpawn) <= spawnArriveDist) {
      character.position.x = spawnX;
      character.position.z = 0;
      playIdlePose(now);
      return;
    }

    setFacing(dir);
    applyFacingPose();

    const barrier = findBarrierAhead?.(dir, jumpBarrierDist);
    if (barrier && getGrounded()) {
      if (tryJump?.()) {
        character.position.x += dir * ENEMY_MOVE.run * 0.12;
        character.position.z = 0;
      }
      return;
    }

    if (getGrounded() && getCurrentAnimName() !== ENEMY_ANIM.walk) {
      play(ENEMY_ANIM.walk, { fade: 0.15 });
    }
    if (getGrounded()) {
      character.position.x += dir * ENEMY_MOVE.walk * dt;
      character.position.z = 0;
    }
  }

  function update(dt) {
    const character = getCharacter();
    if (!character) return;

    const now = performance.now();

    // Perfect parry / koşu-itme sersemliği
    const stunUntil = getStunUntil?.() ?? 0;
    if (now < stunUntil) {
      // Koşu itmesi: mevcut anim donuk kalsın — idle’a çekme
      if (getIsRunBumpFrozen?.()) return;

      const forced = getForcedAnim();
      if (forced === ENEMY_ANIM.hit) {
        const action = getCurrentAction?.();
        const dur = action?.getClip()?.duration ?? 0;
        if (action && dur > 0 && action.time >= dur - 0.04) {
          setForcedAnim(null);
          play(ENEMY_ANIM.idle, { fade: 0.15, force: true });
        }
        return;
      }
      if (getCurrentAnimName() !== ENEMY_ANIM.idle) {
        play(ENEMY_ANIM.idle, { fade: 0.2, force: true });
      }
      return;
    }

    const tx = getTargetX?.();
    if (tx == null || !Number.isFinite(tx)) {
      returnToSpawn(dt);
      return;
    }

    // Çömelerek arkadaysa aggro yok (yüzünü çevirmeden önce bak)
    if (isStealthedBehind(tx, character.position.x)) {
      returnToSpawn(dt);
      return;
    }

    const dx = tx - character.position.x;
    const dist = Math.abs(dx);
    const dir = dx > 0 ? 1 : -1;
    faceTowardTarget();
    applyFacingPose();

    // Saldırı / hit / zıplama one-shot sürerken: havadaysa yine hedefe süzül
    if (now < getBusyUntil()) {
      if (!getGrounded() && dist > attackRange) {
        setFacing(dir);
        applyFacingPose();
        character.position.x += dir * ENEMY_MOVE.run * 0.55 * dt;
        character.position.z = 0;
      }
      return;
    }

    if (getForcedAnim()) setForcedAnim(null);

    // Aggro dışı → önce idle, sonra spawn
    if (dist > aggroRange) {
      returnToSpawn(dt);
      return;
    }

    // Takipte — kayıp beklemesini sıfırla
    wasTracking = true;
    lostIdleUntil = 0;
    nextIdleTurnAt = 0;

    // Soft sep / hold: daha yaklaşma; menzildeyse vur
    if (dist <= holdDist && getGrounded()) {
      if (dist <= attackRange) {
        const pick = attacks[Math.floor(Math.random() * attacks.length)];
        playOneShot(pick);
      } else if (getCurrentAnimName() !== ENEMY_ANIM.idle) {
        play(ENEMY_ANIM.idle, { fade: 0.15 });
      }
      return;
    }

    // Yakın → dövüş (yerdeyken)
    if (dist <= attackRange && getGrounded()) {
      const pick = attacks[Math.floor(Math.random() * attacks.length)];
      playOneShot(pick);
      return;
    }

    // Engel yolda mı → zıpla
    setFacing(dir);
    applyFacingPose();
    const barrier = findBarrierAhead?.(dir, jumpBarrierDist);
    if (barrier && getGrounded()) {
      tryJump?.();
      return;
    }

    // Ara mesafe → uzaksa koş, yakınsa yürü
    const chaseFast = dist > chaseFastDist;
    const speed = chaseFast ? ENEMY_MOVE.run : ENEMY_MOVE.walk;
    const anim = chaseFast ? ENEMY_ANIM.run : ENEMY_ANIM.walk;
    if (getGrounded() && getCurrentAnimName() !== anim) {
      play(anim, { fade: 0.15 });
    }
    character.position.x += dir * speed * dt;
    character.position.z = 0;
  }

  return { update, config: AI_CONFIG };
}
