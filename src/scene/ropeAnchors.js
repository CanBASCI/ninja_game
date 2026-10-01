/**
 * Root üst örtü kayıtları — sahnede tall root objesi varsa 3/4 açılır.
 * Kanca objeye yapışmaz: eski gibi (karakter X, ekran tepesi Y).
 *
 * @typedef {{ x: number, halfW: number, topY: number, z?: number }} RopeCover
 */

/** @type {RopeCover[]} */
const covers = [];

export function clearRopeAnchors() {
  covers.length = 0;
}

/**
 * @param {{ x: number, halfW?: number, topY?: number, y?: number, z?: number }} a
 */
export function addRopeAnchor(a) {
  if (!a || !Number.isFinite(a.x)) return;
  const topY = Number.isFinite(a.topY)
    ? a.topY
    : Number.isFinite(a.y)
      ? a.y
      : 4;
  covers.push({
    x: a.x,
    halfW: Math.max(0.5, a.halfW ?? 1.2),
    topY,
    z: a.z ?? 0,
  });
}

export function getRopeAnchors() {
  return covers;
}

/** Sahnede el hizasının üstünde en az bir root örtüsü var mı? */
export function hasTallRootCover(y) {
  for (const c of covers) {
    if (c.topY >= y + 0.6) return true;
  }
  return false;
}

/**
 * Örtü kaydı varsa latch döner — X serbest (karakter), Y = opts.hangY (ekran tepesi).
 * @param {number} x
 * @param {number} y
 * @param {{ mode?: "hang" | "swing", facing?: number, hangY: number }} opts
 */
export function findRopeLatch(x, y, opts = {}) {
  const mode = opts.mode === "swing" ? "swing" : "hang";
  const facing = opts.facing >= 0 ? 1 : -1;
  const hangY = Number.isFinite(opts.hangY) ? opts.hangY : y + 3.2;

  // Root’ta yüksek obje yoksa boş gökyüzüne rope yok
  if (!hasTallRootCover(y)) return null;

  if (mode === "hang") {
    return { x, y: hangY, z: 0, halfW: 99 };
  }

  // Swing: aynı serbestlik, kanca biraz bakış yönünde
  return {
    x: x + facing * 1.35,
    y: hangY,
    z: 0,
    halfW: 99,
  };
}

/** Eski isim — yatay band artık gate değil; tall cover var mı diye bakar */
export function findOverheadCover(x, y) {
  if (!hasTallRootCover(y)) return null;
  return covers[0] || { x, halfW: 99, topY: y + 3, z: 0 };
}
