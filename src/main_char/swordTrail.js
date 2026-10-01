import * as THREE from "three";

const HISTORY = 72;
const RENDER_SEGS = 96;

/** Soft white→transparent (eksponansiyel, basamaksız) */
function createTrailAlphaMap() {
  const w = 512;
  const h = 64;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, h);

  for (let x = 0; x < w; x++) {
    const u = x / (w - 1);
    // Soft ease-in: kuyruk uzun süre şeffaf, uca doğru yumuşak açılır
    const along = Math.pow(u, 2.1);
    for (let y = 0; y < h; y++) {
      const v = y / (h - 1);
      // Kenar soft (smoothstep)
      const edge = Math.min(v, 1 - v) * 2;
      const across = edge * edge * (3 - 2 * edge);
      const a = Math.min(1, along * across) * 255;
      const i = (y * w + x) * 4;
      img.data[i] = a;
      img.data[i + 1] = a;
      img.data[i + 2] = a;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function smoothPolyline(points, outCount) {
  if (points.length < 2) return points.slice();
  if (points.length === 2) {
    const out = [];
    for (let i = 0; i < outCount; i++) {
      const t = i / (outCount - 1);
      out.push(points[0].clone().lerp(points[1], t));
    }
    return out;
  }
  const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.35);
  return curve.getPoints(outCount - 1);
}

/**
 * Kılıç ucu trail — yoğun örnekleme + soft alpha.
 * @param {THREE.Scene} scene
 * @param {{ color?: number }} [opts]
 */
export function createSwordTrail(scene, { color = 0xffffff } = {}) {
  let tipMarker = null;
  let baseMarker = null;
  let active = false;
  let fade = 0;
  const tipHist = [];
  const baseHist = [];
  const _tip = new THREE.Vector3();
  const _base = new THREE.Vector3();
  const alphaMap = createTrailAlphaMap();

  function makeLayer(opacity, layerColor = color) {
    const positions = new Float32Array(RENDER_SEGS * 2 * 3);
    const uvs = new Float32Array(RENDER_SEGS * 2 * 2);
    const indices = [];
    for (let i = 0; i < RENDER_SEGS; i++) {
      const u = i / (RENDER_SEGS - 1);
      // Soft U yeniden dağıtım: daha fazla texel uca yakın
      const uSoft = Math.pow(u, 0.85);
      uvs[i * 4 + 0] = uSoft;
      uvs[i * 4 + 1] = 0;
      uvs[i * 4 + 2] = uSoft;
      uvs[i * 4 + 3] = 1;
    }
    for (let i = 0; i < RENDER_SEGS - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);

    const mat = new THREE.MeshBasicMaterial({
      color: layerColor,
      alphaMap,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 10;
    scene.add(mesh);
    return { mesh, positions, baseOpacity: opacity };
  }

  const layers = [
    makeLayer(0.16, color),
    makeLayer(0.38, color),
    makeLayer(0.72, color),
  ];
  const widthScales = [0.85, 0.5, 0.18];
  /** Zemin altı splash görünmesin */
  const GROUND_Y = 0.02;

  function clampGround(v) {
    if (v.y < GROUND_Y) v.y = GROUND_Y;
    return v;
  }

  function setColor(hex) {
    for (const L of layers) {
      L.mesh.material.color.setHex(hex);
    }
  }

  function bindMarkers(tip, base) {
    tipMarker = tip;
    baseMarker = base;
  }

  function clearHistory() {
    tipHist.length = 0;
    baseHist.length = 0;
  }

  function setActive(on) {
    const next = !!on;
    if (next && !active) clearHistory();
    if (!next && active) {
      // Kapanırken yeni el örnekleri alma — yürürken yanlış isabet olmasın
      // (mevcut history fade ile sönsün)
    }
    active = next;
  }

  function writeRibbon(layer, wScale, tips, bases) {
    const { positions } = layer;
    for (let i = 0; i < RENDER_SEGS; i++) {
      const t = tips[i];
      const b = bases[i];
      const ty = Math.max(t.y, GROUND_Y);
      const by = Math.max(b.y, GROUND_Y);
      const mx = (t.x + b.x) * 0.5;
      const my = (ty + by) * 0.5;
      const mz = (t.z + b.z) * 0.5;
      const o = i * 6;
      positions[o] = mx + (t.x - mx) * wScale;
      positions[o + 1] = my + (ty - my) * wScale;
      positions[o + 2] = mz + (t.z - mz) * wScale;
      positions[o + 3] = mx + (b.x - mx) * wScale;
      positions[o + 4] = my + (by - my) * wScale;
      positions[o + 5] = mz + (b.z - mz) * wScale;
    }
    layer.mesh.geometry.attributes.position.needsUpdate = true;
  }

  function update(dt) {
    // Sadece aktifken örnekle — fade sırasında yürüyen el trail’e yazılmasın
    if (tipMarker && baseMarker && active) {
      tipMarker.getWorldPosition(_tip);
      baseMarker.getWorldPosition(_base);
      clampGround(_tip);
      clampGround(_base);
      const last = tipHist[tipHist.length - 1];
      if (!last || last.distanceToSquared(_tip) > 1e-8) {
        tipHist.push(_tip.clone());
        baseHist.push(_base.clone());
      } else {
        last.copy(_tip);
        baseHist[baseHist.length - 1].copy(_base);
      }
      while (tipHist.length > HISTORY) tipHist.shift();
      while (baseHist.length > HISTORY) baseHist.shift();
    }

    const target = active ? 1 : 0;
    fade += (target - fade) * Math.min(1, dt * (active ? 10 : 2.8));
    if (fade < 0.01 && !active) {
      fade = 0;
      clearHistory();
      for (const L of layers) L.mesh.visible = false;
      return;
    }

    if (tipHist.length < 3) return;

    const tips = smoothPolyline(tipHist, RENDER_SEGS);
    const bases = smoothPolyline(baseHist, RENDER_SEGS);

    for (let i = 0; i < layers.length; i++) {
      const L = layers[i];
      writeRibbon(L, widthScales[i], tips, bases);
      L.mesh.visible = true;
      L.mesh.material.opacity = L.baseOpacity * fade;
    }
  }

  const _enemyBox = new THREE.Box3();
  const _charPos = new THREE.Vector3();
  const _sample = new THREE.Vector3();
  const _dir = new THREE.Vector3();

  /**
   * Sadece splash/trail civarı isabet (karaktere doğru ince dilim).
   * Uzaktaki splash ile karakter arası tüm koridor isabet sayılmaz.
   * @returns {boolean}
   */
  function hitsTarget(target, attacker, { pad = 0.18, recent = 14 } = {}) {
    return !!getHitPoint(target, attacker, { pad, recent });
  }

  /** İsabet varsa dünya uzayında temas noktası — sadece splash AKTİFken */
  function getHitPoint(target, attacker, { pad = 0.18, recent = 14 } = {}) {
    if (!active) return null;
    if (!target || tipHist.length < 2) return null;
    if (fade < 0.15) return null;

    target.updateMatrixWorld(true);
    _enemyBox.setFromObject(target);
    _enemyBox.expandByScalar(pad);

    if (attacker) {
      attacker.getWorldPosition(_charPos);
      _charPos.y += 1.05;
    }

    const start = Math.max(0, tipHist.length - recent);
    for (let i = start; i < tipHist.length; i++) {
      const tip = tipHist[i];
      const base = baseHist[i] || tip;

      if (_enemyBox.containsPoint(tip)) return tip.clone();
      if (_enemyBox.containsPoint(base)) return base.clone();
      _sample.copy(tip).lerp(base, 0.5);
      if (_enemyBox.containsPoint(_sample)) return _sample.clone();

      if (attacker) {
        _dir.copy(_charPos).sub(tip);
        const dist = _dir.length();
        if (dist > 1e-4) {
          _dir.multiplyScalar(1 / dist);
          const reach = Math.min(0.45, dist * 0.35);
          for (let t = 0.2; t <= 1; t += 0.25) {
            _sample.copy(tip).addScaledVector(_dir, reach * t);
            if (_enemyBox.containsPoint(_sample)) return _sample.clone();
          }
        }
      }
    }
    return null;
  }

  return {
    bindMarkers,
    setActive,
    setColor,
    update,
    hitsTarget,
    getHitPoint,
    get active() {
      return active;
    },
    get fade() {
      return fade;
    },
  };
}
