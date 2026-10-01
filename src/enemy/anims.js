/** Enemy anim / asset / hareket / can sabitleri */

export const ENEMY_URL = "./public/enemy/Enemy_with_knife.glb?v=2";

/** Ana karakterle aynı hedef boy (MainChar modelScale hedefi) */
export const ENEMY_TARGET_HEIGHT = 1.75;

export const ENEMY_ANIM = {
  /** Atanmış idle — spawn / bekleyiş / idle’a her dönüşte bu */
  idle: "Idle_5",
  walk: "walking_2_inplace",
  walk2: "Walking",
  run: "Female_Throwing_Stance_Charge_inplace",
  charge: "Female_Throwing_Stance_Charge_inplace",
  punch: "Punch_Combo_1",
  jump: "Regular_Jump",
  shieldPush: "Shield_Push_Left",
  weaponCombo: "Weapon_Combo",
  die: "dying_backwards",
  hit: "Hit_Reaction",
};

export const ENEMY_LOOPING = new Set([
  ENEMY_ANIM.idle,
  ENEMY_ANIM.walk,
  ENEMY_ANIM.walk2,
  ENEMY_ANIM.run,
  ENEMY_ANIM.charge,
]);

export const ENEMY_MOVE = {
  walk: 2.4,
  /** Main char koşu 5.2 → %25 yavaş */
  run: 5.2 * 0.75,
  charge: 6.2 * 0.75,
};

/** Engel çarpışma yarıçapı */
export const ENEMY_RADIUS = 0.55;

/** Can barı */
export const ENEMY_MAX_HP = 20;

/** Main char isabet hasarı */
export const ENEMY_DAMAGE = {
  unarmed: 2,
  armed: 4,
};

/** Splash açılan saldırılar */
export const ENEMY_KNIFE_TRAIL_ANIMS = new Set([
  ENEMY_ANIM.weaponCombo,
  ENEMY_ANIM.punch,
  ENEMY_ANIM.shieldPush,
]);
