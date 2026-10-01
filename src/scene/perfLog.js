/**
 * Sahne performans teşhisi — konsola periyodik + pack özeti.
 * Aç/kapa: window.__PERF_LOG = true/false (default true)
 */

/** @param {THREE.Object3D} root */
export function countSceneStats(root) {
  let meshes = 0;
  let triangles = 0;
  let castShadow = 0;
  let receiveShadow = 0;
  let materials = 0;
  let textures = 0;
  let skinned = 0;
  let transparent = 0;
  let customDepth = 0;
  const seenMat = new Set();
  const seenTex = new Set();

  root.traverse((o) => {
    if (o.isSkinnedMesh) skinned += 1;
    if (!o.isMesh) return;
    meshes += 1;
    if (o.castShadow) castShadow += 1;
    if (o.receiveShadow) receiveShadow += 1;
    if (o.customDepthMaterial) customDepth += 1;

    const geo = o.geometry;
    if (geo) {
      const idx = geo.index;
      if (idx) triangles += idx.count / 3;
      else {
        const pos = geo.getAttribute("position");
        if (pos) triangles += pos.count / 3;
      }
    }

    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (!seenMat.has(m.uuid)) {
        seenMat.add(m.uuid);
        materials += 1;
        if (m.transparent || m.opacity < 1) transparent += 1;
        for (const key of [
          "map",
          "normalMap",
          "roughnessMap",
          "metalnessMap",
          "emissiveMap",
          "alphaMap",
        ]) {
          const t = m[key];
          if (t && !seenTex.has(t.uuid)) {
            seenTex.add(t.uuid);
            textures += 1;
          }
        }
      }
    }
  });

  return {
    meshes,
    triangles: Math.round(triangles),
    castShadow,
    receiveShadow,
    materials,
    textures,
    skinned,
    transparent,
    customDepth,
  };
}

export function logPackStats(label, root) {
  const s = countSceneStats(root);
  console.log(
    `%c[PERF] ${label}`,
    "color:#8cf;font-weight:bold",
    `\n  meshes=${s.meshes}  tris=${s.triangles.toLocaleString()}  castShadow=${s.castShadow}  customDepth=${s.customDepth}`,
    `\n  materials=${s.materials}  textures=${s.textures}  transparent=${s.transparent}  skinned=${s.skinned}`,
  );
  return s;
}

/**
 * @param {{
 *   renderer: import("three").WebGLRenderer,
 *   scene: import("three").Object3D,
 *   getPack?: () => string,
 *   packRoots?: Record<string, import("three").Object3D | null | undefined>,
 * }} opts
 */
export function createPerfMonitor({
  renderer,
  scene,
  getPack = () => "?",
  packRoots = {},
}) {
  let enabled = true;
  if (typeof window !== "undefined") {
    if (window.__PERF_LOG === false) enabled = false;
    window.__PERF_LOG = enabled;
    window.__perfDump = () => dumpNow();
  }

  let frames = 0;
  let accMs = 0;
  let updateMs = 0;
  let renderMs = 0;
  let lastLog = performance.now();
  const INTERVAL = 2000;

  function dumpNow() {
    const pack = getPack();
    const info = renderer.info;
    console.log(
      `%c[PERF] dump pack=${pack}`,
      "color:#fa0;font-weight:bold",
      {
        memory: { ...info.memory },
        render: { ...info.render },
        programs: info.programs?.length,
      },
    );
    for (const [id, root] of Object.entries(packRoots)) {
      if (root) logPackStats(`pack${id}`, root);
    }
    logPackStats("fullScene", scene);
  }

  /** Call once per frame after work */
  function tick(frameDtMs, parts = {}) {
    if (typeof window !== "undefined" && window.__PERF_LOG === false) {
      enabled = false;
      return;
    }
    enabled = true;

    frames += 1;
    accMs += frameDtMs;
    updateMs += parts.updateMs || 0;
    renderMs += parts.renderMs || 0;

    const now = performance.now();
    if (now - lastLog < INTERVAL) return;

    const fps = frames / ((now - lastLog) / 1000);
    const avgFrame = accMs / frames;
    const avgUpdate = updateMs / frames;
    const avgRender = renderMs / frames;
    const info = renderer.info;
    const pack = getPack();

    console.log(
      `%c[PERF] ${fps.toFixed(1)} fps · pack=${pack}`,
      fps < 30 ? "color:#f66;font-weight:bold" : "color:#6c6",
      `\n  frame=${avgFrame.toFixed(2)}ms  updateWorld=${avgUpdate.toFixed(2)}ms  render=${avgRender.toFixed(2)}ms`,
      `\n  drawCalls=${info.render.calls}  tris=${info.render.triangles.toLocaleString()}  lines=${info.render.lines}  points=${info.render.points}`,
      `\n  geoms=${info.memory.geometries}  textures=${info.memory.textures}  programs=${info.programs?.length ?? "?"}`,
    );

    // Aktif pack özeti (seyrek)
    const root = packRoots[pack];
    if (root) {
      const s = countSceneStats(root);
      console.log(
        `  → pack${pack}: meshes=${s.meshes} tris=${s.triangles.toLocaleString()} castShadow=${s.castShadow} customDepth=${s.customDepth}`,
      );
    }

    frames = 0;
    accMs = 0;
    updateMs = 0;
    renderMs = 0;
    lastLog = now;
  }

  return { tick, dumpNow, logPackStats };
}
