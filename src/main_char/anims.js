/** Ana karakter animasyon isimleri + hareket hızları */

/** Görünen model + locomotion */
export const MODEL_URL = "./public/main_char/Main_char_move.glb?v=1";
/** Saldırı / dövüş / ölüm klipleri (aynı rig) */
export const FIGHT_URL = "./public/main_char/Main_char_fight.glb?v=1";
/** Parkour / salıncak / tırmanma klipleri */
export const CLIMB_URL = "./public/main_char/blockjump_swaing_climbing.glb?v=1";

export const KATANA_URL = "./public/main_char/Katana.glb";
export const KATANA_SHEATH_URL = "./public/main_char/katana_sheath.glb";
/** Kılıç kınında — yoksa boş kılıf + katana birleşimi kullanılır */
export const KATANA_SHEATH_WITH_KATANA_URL =
  "./public/main_char/katana_sheath_with_katana.glb";

export const ANIM = {
  /** Atanmış idle — başlangıç / idle’a her dönüşte bu */
  idle: "Idle_5",
  walk: "Spear_Walk",
  run: "Female_Throwing_Stance_Charge_inplace",
  sprint: "Female_Throwing_Stance_Charge_inplace",
  crouchWalk: "Cautious_Crouch_Walk_Forward_inplace",
  crouchIdle: "CrouchLookAroundBow",
  fightWalk: "Walk_Fight_Forward",
  jump: "Regular_Jump",
  vault: "Parkour_Vault_1",
  roll: "Parkour_Vault_with_Roll",
  slide: "slide_light",
  // Kılıçlı
  slash: "Reaping_Swing",
  spin: "Double_Blade_Spin",
  thrust: "Thrust_Slash",
  // Kılıçsız
  punch: "Punch_Combo_2",
  kick: "Roundhouse_Kick",
  kickAlt: "Flying_Fist_Kick",
  kickSpartan: "Spartan_Kick",
  kickHigh: "Step_in_High_Kick",
  kickSweep: "Sweeping_Kick",
  // Savunma / ölüm
  parry: "Sword_Parry_Backward_1",
  dead: "Dead",
  carry: "Carry_Heavy_Cannon_Forward",
  swim: "Swim_Forward",
  hang: "Upside_Down_Rope_Hang",
  hang1: "Upside_Down_Rope_Hang_1",
  hang2: "Upside_Down_Rope_Hang_2",
  /** 4: salıncak asılı idle */
  swingHang: "Rope_Hang_Idle",
  /** 4 bırakınca backflip → crouch */
  swingRelease: "Rope_Hang_Backflip_to_Crouch",
};

export const LOOPING = new Set([
  ANIM.idle,
  ANIM.walk,
  ANIM.run,
  ANIM.sprint,
  ANIM.crouchWalk,
  ANIM.crouchIdle,
  ANIM.fightWalk,
  ANIM.carry,
  ANIM.swim,
  ANIM.hang1,
  ANIM.swingHang,
]);

export const MOVE_SPEED = {
  walk: 2.4,
  run: 5.2,
  sprint: 7.4,
  crouch: 1.4,
  /** Kılıçlı walk — kılıçsıza göre oran: fight/walk */
  fight: 2.0,
  carry: 1.6,
  swim: 2.2,
};

/** Kılıçlı hareket çarpanı (fightWalk / walk = 2.0/2.4) */
export const FIGHT_MOVE_SCALE = MOVE_SPEED.fight / MOVE_SPEED.walk;

export const VAULT_MAX_DIST = 2.0;
export const CHAR_RADIUS = 0.55;

export const JUMP_ANIMS = new Set([ANIM.jump]);

/** Oyuncu can */
export const PLAYER_MAX_HP = 20;

/** Oyuncunun yediği hasar */
export const PLAYER_DAMAGE = {
  knife: 2,
  bomber: 6,
};

/** Anim hız çarpanı (2 = yarı sürede biter) */
export const ANIM_SPEED = {
  [ANIM.slash]: 2,
  [ANIM.spin]: 2,
  [ANIM.thrust]: 2,
  [ANIM.punch]: 2,
  [ANIM.kick]: 2,
  [ANIM.kickAlt]: 2,
  [ANIM.kickSpartan]: 2,
  [ANIM.kickHigh]: 2,
  [ANIM.kickSweep]: 2,
  [ANIM.fightWalk]: 1.171875,
  /** 1.875s → 1.0s */
  [ANIM.swingRelease]: 1.875 / 1.0,
};
