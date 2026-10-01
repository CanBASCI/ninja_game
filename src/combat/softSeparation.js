import * as THREE from "three";
import { createSlideDustFx } from "../fx/slideDust.js";

/**
 * Soft sep + koşu itmesi (stun / kayma tozu / max mesafe).
 * Düşmanlar `allowSoftSep` / `allowRunBump` ile özellik kapatabilir.
 */
export function createSoftSeparationSystem(scene, { layer = 1 } = {}) {
  const SOFT_SEP = {
    minDist: 1.3,
    resolve: 14,
    pushPlayer: 0.4,
    pushOther: 0.6,
    runBumpMaxDist: 3,
    runBumpClearPad: 0.35,
  };

  /** @type {Map<object, { active: boolean, stunned: boolean, startX: number, dir: number, skidFx: ReturnType<typeof createSlideDustFx> }>} */
  const bumpByUnit = new Map();
  const _feet = new THREE.Vector3();

  function softSeparate(a, b, dt, {
    minDist = SOFT_SEP.minDist,
    pushA = SOFT_SEP.pushPlayer,
    pushB = SOFT_SEP.pushOther,
  } = {}) {
    if (!a || !b) return false;
    let dx = b.position.x - a.position.x;
    let dist = Math.abs(dx);
    const dir = dist > 1e-5 ? Math.sign(dx) : 1;
    if (dist < 1e-5) dist = 0;
    if (dist >= minDist) return false;
    const overlap = minDist - dist;
    const step = Math.min(overlap, overlap * SOFT_SEP.resolve * dt);
    a.position.x -= dir * step * pushA;
    b.position.x += dir * step * pushB;
    return true;
  }

  function bumpState(unit) {
    let s = bumpByUnit.get(unit);
    if (!s) {
      s = {
        active: false,
        stunned: false,
        startX: 0,
        dir: 1,
        skidFx: createSlideDustFx(scene, { layer }),
      };
      bumpByUnit.set(unit, s);
    }
    return s;
  }

  function clearBump(unit) {
    const s = bumpByUnit.get(unit);
    if (!s) return;
    s.active = false;
    s.stunned = false;
    s.skidFx.setActive(false);
  }

  /**
   * @param {number} dt
   * @param {object} opts
   * @param {import('three').Object3D|null} opts.player
   * @param {boolean} opts.playerIgnores
   * @param {boolean} opts.playerRunning
   * @param {number} opts.playerFacing
   * @param {object[]} opts.units — enemy/bomber vb.
   */
  function update(dt, {
    player,
    playerIgnores = false,
    playerRunning = false,
    playerFacing = 1,
    units = [],
  }) {
    for (const unit of bumpByUnit.keys()) {
      if (!units.includes(unit)) {
        const s = bumpByUnit.get(unit);
        s?.skidFx.setActive(false);
        s?.skidFx.update(dt);
      }
    }

    if (!player || playerIgnores) {
      for (const unit of units) {
        const s = bumpByUnit.get(unit);
        if (s) {
          clearBump(unit);
          s.skidFx.update(dt);
        }
      }
      return;
    }

    const alive = [];
    for (const unit of units) {
      if (!unit?.character || unit.dead) {
        clearBump(unit);
        bumpByUnit.get(unit)?.skidFx.update(dt);
        continue;
      }
      if (unit.allowSoftSep === false) {
        clearBump(unit);
        bumpByUnit.get(unit)?.skidFx.update(dt);
        continue;
      }
      alive.push(unit);
    }

    for (const unit of alive) {
      const ec = unit.character;
      const s = bumpState(unit);
      const allowBump = unit.allowRunBump !== false;
      const dist = Math.abs(player.position.x - ec.position.x);
      const inContact = dist < SOFT_SEP.minDist;
      const clearDist = SOFT_SEP.minDist + SOFT_SEP.runBumpClearPad;

      if (!inContact && dist >= clearDist) {
        clearBump(unit);
      }

      let pushA = SOFT_SEP.pushPlayer;
      let pushB = SOFT_SEP.pushOther;
      let atPushCap = false;
      let skidding = false;

      if (allowBump && inContact && playerRunning) {
        if (!s.active) {
          s.active = true;
          s.stunned = false;
          s.startX = ec.position.x;
          s.dir =
            Math.sign(ec.position.x - player.position.x) || playerFacing || 1;
        }
        if (!s.stunned) {
          if (unit.applyRunBumpStun?.(1)) s.stunned = true;
          else s.stunned = true; // tekrar denemesin
        }

        const traveled = (ec.position.x - s.startX) * s.dir;
        if (traveled >= SOFT_SEP.runBumpMaxDist) {
          pushB = 0;
          pushA = 1;
          atPushCap = true;
          ec.position.x = s.startX + s.dir * SOFT_SEP.runBumpMaxDist;
        }
      } else if (s.active && (!playerRunning || !inContact)) {
        // koşu bırakıldı / temas koptu — cap state kalabilir ta clear’a
        if (!inContact && dist >= clearDist) clearBump(unit);
      }

      if (s.active && allowBump) {
        const traveled = (ec.position.x - s.startX) * s.dir;
        if (traveled >= SOFT_SEP.runBumpMaxDist) {
          pushB = 0;
          pushA = 1;
          atPushCap = true;
          ec.position.x = s.startX + s.dir * SOFT_SEP.runBumpMaxDist;
        }
      }

      const bumped = softSeparate(player, ec, dt, { pushA, pushB });
      skidding =
        allowBump &&
        bumped &&
        s.active &&
        playerRunning &&
        !atPushCap &&
        pushB > 0;

      if (skidding) {
        _feet.set(ec.position.x, 0.06, 0);
        s.skidFx.setActive(true);
        s.skidFx.update(dt, _feet, s.dir);
      } else {
        s.skidFx.setActive(false);
        s.skidFx.update(dt);
      }
    }

    // Düşman ↔ düşman soft sep
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        softSeparate(alive[i].character, alive[j].character, dt, {
          pushA: 0.5,
          pushB: 0.5,
        });
      }
    }
  }

  return { update, config: SOFT_SEP, softSeparate };
}
