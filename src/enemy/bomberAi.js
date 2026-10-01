import { BOMBER_ANIM, BOMBER_MOVE, BOMBER_AI } from "./bomberAnims.js";

/**
 * Bomber AI — 10m+ idle; yaklaşınca koş + engelde zıpla;
 * 3m’de Pull_Radish → anim bitince patla.
 * Hedef kaybolunca / aggro dışı spawn’a yürüyerek döner.
 */
export function createBomberAi(api) {
  const {
    getTargetX,
    getSpawnX,
    getSpawnFace,
    getIsCrouching,
    getCharacter,
    getBusyUntil,
    getStunUntil,
    getState,
    setState,
    getCurrentAnimName,
    getGrounded,
    getFacing,
    setFacing,
    play,
    tryJump,
    findBarrierAhead,
    faceTowardTarget,
    applyFacingPose,
    beginDetonate,
  } = api;

  const { aggroRange, detonateRange, jumpBarrierDist, lostIdleSec, idleTurnSec } =
    BOMBER_AI;
  const SPAWN_ARRIVE = 0.2;
  const turnSec = idleTurnSec ?? 10;

  let lostIdleUntil = 0;
  let wasTracking = false;
  let nextIdleTurnAt = 0;
  let settledAtSpawn = false;

  function isStealthedBehind(tx, enemyX) {
    if (!getIsCrouching?.()) return false;
    const face = getFacing?.() ?? 1;
    const dx = tx - enemyX;
    if (Math.abs(dx) < 0.25) return false;
    return dx * face < 0;
  }

  function tickIdleTurn(now) {
    if (nextIdleTurnAt <= 0) {
      nextIdleTurnAt = now + turnSec * 1000;
      return;
    }
    if (now >= nextIdleTurnAt) {
      nextIdleTurnAt = now + turnSec * 1000;
      setFacing(Math.random() < 0.5 ? -1 : 1);
    }
  }

  function playIdlePose(now) {
    tickIdleTurn(now);
    if (getCurrentAnimName() !== BOMBER_ANIM.idle) {
      play(BOMBER_ANIM.idle, { fade: 0.2, force: true });
    }
  }

  function returnToSpawn(dt) {
    const character = getCharacter();
    if (!character) return;

    setState("idle");

    const now = performance.now();
    const spawnX = getSpawnX?.();
    const towardSpawn =
      spawnX != null && Number.isFinite(spawnX)
        ? spawnX - character.position.x
        : 0;
    const dir = towardSpawn === 0 ? 1 : towardSpawn > 0 ? 1 : -1;

    // Zıplama busy: havadayken spawn yönüne koşu hızıyla süzül
    if (now < getBusyUntil()) {
      if (!getGrounded() && Math.abs(towardSpawn) > SPAWN_ARRIVE) {
        setFacing(dir);
        character.position.x += dir * BOMBER_MOVE.run * 0.75 * dt;
        character.position.z = 0;
      }
      return;
    }

    if (wasTracking) {
      wasTracking = false;
      lostIdleUntil = now + (lostIdleSec ?? 2) * 1000;
    }

    if (now < lostIdleUntil) {
      settledAtSpawn = false;
      playIdlePose(now);
      return;
    }

    if (spawnX == null || !Number.isFinite(spawnX)) {
      playIdlePose(now);
      return;
    }

    if (Math.abs(towardSpawn) <= SPAWN_ARRIVE) {
      character.position.x = spawnX;
      character.position.z = 0;
      // Sadece ilk oturuşta spawn yüzü — her kare reset idle dönüşünü bozuyordu
      if (!settledAtSpawn) {
        settledAtSpawn = true;
        const spawnFace = getSpawnFace?.();
        if (spawnFace === 1 || spawnFace === -1) setFacing(spawnFace);
        nextIdleTurnAt = now + turnSec * 1000;
      }
      playIdlePose(now);
      return;
    }

    settledAtSpawn = false;
    setFacing(dir);

    const barrier = findBarrierAhead?.(dir, jumpBarrierDist);
    if (barrier && getGrounded()) {
      if (tryJump?.()) {
        character.position.x += dir * BOMBER_MOVE.run * 0.12;
        character.position.z = 0;
      }
      return;
    }

    if (getGrounded() && getCurrentAnimName() !== BOMBER_ANIM.walk) {
      play(BOMBER_ANIM.walk, { fade: 0.15 });
    }
    if (getGrounded()) {
      character.position.x += dir * BOMBER_MOVE.walk * dt;
      character.position.z = 0;
    }
  }

  function update(dt) {
    const character = getCharacter();
    if (!character) return;

    const state = getState();
    if (state === "gone" || state === "dead" || state === "detonating") return;

    // Koşu itmesi sersemliği
    if (performance.now() < (getStunUntil?.() ?? 0)) {
      applyFacingPose?.();
      return;
    }

    const tx = getTargetX?.();
    if (tx == null || !Number.isFinite(tx)) {
      returnToSpawn(dt);
      return;
    }

    // Çömelerek arkadaysa aggro / patlama yok
    if (isStealthedBehind(tx, character.position.x)) {
      returnToSpawn(dt);
      return;
    }

    faceTowardTarget();
    applyFacingPose();

    const dx = tx - character.position.x;
    const dist = Math.abs(dx);
    const dir = dx > 0 ? 1 : -1;

    // Zıplama one-shot sürerken: havada hedefe süzül
    if (performance.now() < getBusyUntil()) {
      if (!getGrounded() && dist > detonateRange) {
        setFacing(dir);
        applyFacingPose();
        character.position.x += dir * BOMBER_MOVE.run * 0.7 * dt;
        character.position.z = 0;
      }
      return;
    }

    // 3m → Pull_Radish (bitince patlar)
    if (dist <= detonateRange && getGrounded()) {
      setFacing(dir);
      applyFacingPose();
      beginDetonate();
      return;
    }

    // Aggro dışı → önce idle, sonra spawn
    if (dist > aggroRange) {
      returnToSpawn(dt);
      return;
    }

    // Takipte
    wasTracking = true;
    lostIdleUntil = 0;
    nextIdleTurnAt = 0;

    // Kovala — engelde zıpla
    setState("chase");
    setFacing(dir);
    applyFacingPose();

    const barrier = findBarrierAhead?.(dir, jumpBarrierDist);
    if (barrier && getGrounded()) {
      tryJump?.();
      return;
    }

    if (getGrounded() && getCurrentAnimName() !== BOMBER_ANIM.run) {
      play(BOMBER_ANIM.run, { fade: 0.12 });
    }
    if (getGrounded()) {
      character.position.x += dir * BOMBER_MOVE.run * dt;
      character.position.z = 0;
    }
  }

  function reset() {
    lostIdleUntil = 0;
    wasTracking = false;
    nextIdleTurnAt = 0;
    settledAtSpawn = false;
  }

  return { update, reset, config: BOMBER_AI };
}
