/** Canlı bomba (Enemy_boomber_run) sabitleri */

export const BOMBER_URL = "./public/enemy/Enemy_boomber_run.glb?v=1";

export const BOMBER_TARGET_HEIGHT = 1.75;

export const BOMBER_ANIM = {
  /** Atanmış idle — spawn / bekleyiş / idle’a her dönüşte bu */
  idle: "CrouchLookAroundBow",
  run: "Rifle_Charge_inplace",
  walk: "Walking",
  pullRadish: "Pull_Radish",
  jump: "Jump_Over_Obstacle_2",
  charge: "Rifle_Charge_inplace",
  /** Knife enemy ile aynı ölüm clip (dying_backwards) */
  die: "dying_backwards",
  /** Knife Hit_Reaction — koşu itmesi sersemliği */
  hit: "Hit_Reaction",
};

export const BOMBER_LOOPING = new Set([
  BOMBER_ANIM.idle,
  BOMBER_ANIM.run,
  BOMBER_ANIM.walk,
  BOMBER_ANIM.charge,
]);

export const BOMBER_MOVE = {
  run: 5.2 * 0.75,
  walk: 2.4,
};

export const BOMBER_RADIUS = 0.55;

/** Patlama hasar + görsel yarıçapı (aynı) */
export const BOMBER_BLAST_RADIUS = 3;

/** Bomber can — arkadan tek vuruşta ölür */
export const BOMBER_MAX_HP = 1;

/** Aggro / patlama mesafeleri (≈ metre) */
export const BOMBER_AI = {
  aggroRange: 10,
  /** Bu mesafeye gelince Pull_Radish → anim bitince patla */
  detonateRange: 3,
  /** Engel yüzeyi bu mesafedeyse zıpla */
  jumpBarrierDist: 2.0,
  /** Hedef kaybolunca idle bekleyip sonra spawn’a dön (sn) */
  lostIdleSec: 2,
  /** Idle beklerken yön değiştirme (sn) */
  idleTurnSec: 10,
};
