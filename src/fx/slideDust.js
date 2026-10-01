import * as THREE from "three";

/**
 * Slide kayma bulutu — koşu tozunun yoğun, yere yapışık hali.
 * Yatay uzayan beyaz puflar + hafif kıvılcım noktaları.
 */
export function createSlideDustFx(scene, { layer = 1 } = {}) {
  const active = [];
  const puffGeo = new THREE.PlaneGeometry(0.32, 0.22);
  const sparkGeo = new THREE.PlaneGeometry(0.08, 0.08);
  let emitAcc = 0;
  let activeSlide = false;

  function softDustTexture() {
    const size = 64;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(
      size * 0.5,
      size * 0.55,
      0,
      size * 0.5,
      size * 0.5,
      size * 0.48,
    );
    g.addColorStop(0, "rgba(255, 255, 255, 0.85)");
    g.addColorStop(0.2, "rgba(255, 255, 255, 0.55)");
    g.addColorStop(0.5, "rgba(245, 245, 250, 0.22)");
    g.addColorStop(1, "rgba(230, 230, 235, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  function sparkTexture() {
    const size = 32;
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
      size * 0.4,
    );
    g.addColorStop(0, "rgba(255, 255, 255, 1)");
    g.addColorStop(0.35, "rgba(255, 252, 240, 0.7)");
    g.addColorStop(1, "rgba(255, 240, 200, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  const puffMap = softDustTexture();
  const sparkMap = sparkTexture();

  function setActive(on) {
    activeSlide = !!on;
    if (!activeSlide) emitAcc = 0;
  }

  function spawnPuff(origin, facing) {
    const mat = new THREE.MeshBasicMaterial({
      map: puffMap,
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(puffGeo, mat);
    const back = facing >= 0 ? -1 : 1;
    mesh.position.set(
      origin.x + back * (0.05 + Math.random() * 0.35),
      0.02 + Math.random() * 0.05,
      (Math.random() - 0.5) * 0.45,
    );
    mesh.lookAt(mesh.position.x, mesh.position.y, mesh.position.z + 1);
    const sx = 0.9 + Math.random() * 1.1;
    const sy = 0.45 + Math.random() * 0.45;
    mesh.scale.set(sx, sy, 1);
    mesh.renderOrder = 8;
    mesh.layers.set(layer);
    scene.add(mesh);

    active.push({
      kind: "puff",
      mesh,
      age: 0,
      life: 0.32 + Math.random() * 0.28,
      vel: new THREE.Vector3(
        back * (0.8 + Math.random() * 1.4),
        0.12 + Math.random() * 0.28,
        (Math.random() - 0.5) * 0.45,
      ),
      spin: (Math.random() - 0.5) * 1.4,
      sx,
      sy,
    });
  }

  function spawnSpark(origin, facing) {
    const mat = new THREE.MeshBasicMaterial({
      map: sparkMap,
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(sparkGeo, mat);
    const back = facing >= 0 ? -1 : 1;
    mesh.position.set(
      origin.x + back * Math.random() * 0.2,
      0.015 + Math.random() * 0.03,
      (Math.random() - 0.5) * 0.25,
    );
    mesh.lookAt(mesh.position.x, mesh.position.y, mesh.position.z + 1);
    mesh.scale.setScalar(0.4 + Math.random() * 0.5);
    mesh.renderOrder = 10;
    mesh.layers.set(layer);
    scene.add(mesh);

    active.push({
      kind: "spark",
      mesh,
      age: 0,
      life: 0.1 + Math.random() * 0.1,
      vel: new THREE.Vector3(
        back * (2.2 + Math.random() * 2.5),
        0.4 + Math.random() * 1.2,
        (Math.random() - 0.5) * 0.8,
      ),
    });
  }

  function update(dt, feetWorld = null, facing = 1) {
    if (activeSlide && feetWorld) {
      emitAcc += dt;
      const rate = 0.016;
      while (emitAcc >= rate) {
        emitAcc -= rate;
        spawnPuff(feetWorld, facing);
        spawnPuff(feetWorld, facing);
        if (Math.random() < 0.55) spawnPuff(feetWorld, facing);
        if (Math.random() < 0.4) spawnSpark(feetWorld, facing);
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
      const fade = (1 - u) * (1 - u);

      if (p.kind === "puff") {
        p.vel.y *= Math.exp(-1.8 * dt);
        p.vel.x *= Math.exp(-0.9 * dt);
        p.vel.multiplyScalar(Math.exp(-0.55 * dt));
        p.mesh.rotation.z += p.spin * dt;
        p.mesh.material.opacity = 0.7 * fade;
        p.mesh.scale.set(p.sx * (1 + u * 1.1), p.sy * (1 + u * 0.7), 1);
      } else {
        p.vel.y *= Math.exp(-4 * dt);
        p.vel.multiplyScalar(Math.exp(-1.5 * dt));
        p.mesh.material.opacity = 0.9 * fade;
        p.mesh.scale.setScalar(0.4 * (1 - u * 0.6));
      }
    }
  }

  function dispose() {
    setActive(false);
    for (const p of active) {
      scene.remove(p.mesh);
      p.mesh.material?.dispose?.();
    }
    active.length = 0;
    puffGeo.dispose();
    sparkGeo.dispose();
    puffMap.dispose();
    sparkMap.dispose();
  }

  return { setActive, update, dispose };
}
