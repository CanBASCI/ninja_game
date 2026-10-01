import * as THREE from "three";

/**
 * Koşu ayak tozu — yumuşak beyaz puflar (world space).
 */
export function createRunDustFx(scene, { layer = 1 } = {}) {
  const active = [];
  const geo = new THREE.PlaneGeometry(0.24, 0.24);
  let emitAcc = 0;
  let activeRun = false;

  function softDustTexture() {
    const size = 64;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(
      size * 0.5,
      size * 0.5,
      0,
      size * 0.5,
      size * 0.5,
      size * 0.48,
    );
    g.addColorStop(0, "rgba(255, 255, 255, 0.75)");
    g.addColorStop(0.25, "rgba(250, 250, 252, 0.5)");
    g.addColorStop(0.55, "rgba(235, 235, 240, 0.22)");
    g.addColorStop(1, "rgba(220, 220, 225, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  const map = softDustTexture();

  function setActive(on) {
    activeRun = !!on;
    if (!activeRun) emitAcc = 0;
  }

  function spawnPuff(origin, facing) {
    const mat = new THREE.MeshBasicMaterial({
      map,
      color: 0xffffff,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const back = facing >= 0 ? -1 : 1;
    mesh.position.set(
      origin.x + back * (0.1 + Math.random() * 0.22),
      0.03 + Math.random() * 0.07,
      (Math.random() - 0.5) * 0.32,
    );
    mesh.lookAt(mesh.position.x, mesh.position.y, mesh.position.z + 1);
    mesh.scale.setScalar(0.45 + Math.random() * 0.45);
    mesh.renderOrder = 8;
    mesh.layers.set(layer);
    scene.add(mesh);

    const vel = new THREE.Vector3(
      back * (0.45 + Math.random() * 0.85),
      0.28 + Math.random() * 0.45,
      (Math.random() - 0.5) * 0.35,
    );
    active.push({
      mesh,
      age: 0,
      life: 0.26 + Math.random() * 0.24,
      vel,
      spin: (Math.random() - 0.5) * 2.2,
    });
  }

  function update(dt, feetWorld = null, facing = 1) {
    if (activeRun && feetWorld) {
      emitAcc += dt;
      const rate = 0.038;
      while (emitAcc >= rate) {
        emitAcc -= rate;
        spawnPuff(feetWorld, facing);
        if (Math.random() < 0.35) spawnPuff(feetWorld, facing);
      }
    } else {
      emitAcc = 0;
    }

    for (let i = active.length - 1; i >= 0; i--) {
      const p = active[i];
      p.age += dt;
      const u = p.age / p.life;
      if (u >= 1) {
        scene.remove(p.mesh);
        p.mesh.material?.dispose?.();
        active.splice(i, 1);
        continue;
      }
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.y *= Math.exp(-2.4 * dt);
      p.vel.x *= Math.exp(-1.5 * dt);
      p.vel.multiplyScalar(Math.exp(-0.9 * dt));
      p.mesh.rotation.z += p.spin * dt;
      const fade = (1 - u) * (1 - u);
      p.mesh.material.opacity = 0.62 * fade;
      p.mesh.scale.setScalar(0.45 + u * 1.2);
    }
  }

  function dispose() {
    setActive(false);
    for (const p of active) {
      scene.remove(p.mesh);
      p.mesh.material?.dispose?.();
    }
    active.length = 0;
    geo.dispose();
    map.dispose();
  }

  return { setActive, update, dispose };
}
