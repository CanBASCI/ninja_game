/**
 * Bake texture’dan doygun göz rengi örnekle (splash rengi).
 * @param {import("three").Object3D} root
 * @returns {number} hex 0xRRGGBB
 */
export function sampleEyeColorHex(root) {
  let map = null;
  root.traverse((o) => {
    if (map || !o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m?.map?.image) {
        map = m.map;
        break;
      }
    }
  });
  const fallback = 0xfd2e3a;
  const img = map?.image;
  if (!img?.width) return fallback;

  try {
    const c = document.createElement("canvas");
    const tw = Math.min(256, img.width);
    const th = Math.min(256, img.height);
    c.width = tw;
    c.height = th;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, tw, th);
    const { data } = ctx.getImageData(0, 0, tw, th);
    const scored = [];
    const step = 3;
    for (let y = 0; y < th; y += step) {
      for (let x = 0; x < tw; x += step) {
        const i = (y * tw + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        if (mx < 60) continue;
        const sat = (mx - mn) / mx;
        if (sat < 0.42) continue;
        // Ten / kahve tonlarını ele
        if (r > g && g >= b - 8 && r > 90 && sat < 0.58) continue;
        // Gözler: mavi/cyan/yeşil/amber veya doygun kırmızı iris
        const cool = b > r + 12 || g > r + 12;
        const amber = r > 140 && g > 90 && b < 100 && sat > 0.4;
        const vividRed = r > 180 && r > g + 80 && r > b + 80 && sat > 0.45;
        if (!cool && !amber && !vividRed) continue;
        scored.push({ r, g, b, w: sat * mx });
      }
    }
    if (!scored.length) return fallback;
    scored.sort((a, b) => b.w - a.w);
    const top = scored.slice(0, Math.min(40, scored.length));
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let sw = 0;
    for (const p of top) {
      sr += p.r * p.w;
      sg += p.g * p.w;
      sb += p.b * p.w;
      sw += p.w;
    }
    const r = Math.round(sr / sw);
    const g = Math.round(sg / sw);
    const b = Math.round(sb / sw);
    return (r << 16) | (g << 8) | b;
  } catch {
    return fallback;
  }
}
