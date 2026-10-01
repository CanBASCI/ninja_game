import * as THREE from "three";

/**
 * Çift zıplama tozu — slide dust benzeri ama origin.y’de (havada ayak hizası).
 * slideDust.js zemine kilitli kalır; buna dokunulmaz.
 */
export function createDoubleJumpDustFx(scene, { layer = 1 } = {}) {
  const active = [];
  const puffGeo = new THREE.PlaneGeometry(0.28, 0.2);
  const sparkGeo = new THREE.PlaneGeometry(0.07, 0.07);
  let emitAcc = 0;
  let activeBurst = false;

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
    g.addColorStop(0, "rgba(255, 255, 255, 0.8)");
    g.addColorStop(0.22, "rgba(255, 255, 255, 0.5)");
    g.addColorStop(0.55, "rgba(245, 245, 250, 0.2)");
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
    activeBurst = !!on;
    if (!activeBurst) emitAcc = 0;
  }

  function spawnPuff(origin, facing) {
    const mat = new THREE.MeshBasicMaterial({
      map: puffMap,
      color: 0xffffff,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(puffGeo, mat);
    const back = facing >= 0 ? -1 : 1;
    const y0 = origin.y;
    mesh.position.set(
      origin.x + back * (0.04 + Math.random() * 0.28) + (Math.random() - 0.5) * 0.2,
      y0 - 0.04 + Math.random() * 0.12,
      (Math.random() - 0.5) * 0.4,
    );
    mesh.lookAt(mesh.position.x, mesh.position.y, mesh.position.z + 1);
    const sx = 0.75 + Math.random() * 0.9;
    const sy = 0.4 + Math.random() * 0.4;
    mesh.scale.set(sx, sy, 1);
    mesh.renderOrder = 9;
    mesh.layers.set(layer);
    scene.add(mesh);

    active.push({
      kind: "puff",
      mesh,
      age: 0,
      life: 0.28 + Math.random() * 0.22,
      vel: new THREE.Vector3(
        back * (0.5 + Math.random() * 1.1) + (Math.random() - 0.5) * 0.6,
        -0.35 + Math.random() * 0.9,
        (Math.random() - 0.5) * 0.4,
      ),
      spin: (Math.random() - 0.5) * 1.6,
      sx,
      sy,
    });
  }

  function spawnSpark(origin, facing) {
    const mat = new THREE.MeshBasicMaterial({
      map: sparkMap,
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(sparkGeo, mat);
    const back = facing >= 0 ? -1 : 1;
    const y0 = origin.y;
    mesh.position.set(
      origin.x + back * Math.random() * 0.18,
      y0 + Math.random() * 0.08,
      (Math.random() - 0.5) * 0.22,
    );
    mesh.lookAt(mesh.position.x, mesh.position.y, mesh.position.z + 1);
    mesh.scale.setScalar(0.35 + Math.random() * 0.45);
    mesh.renderOrder = 11;
    mesh.layers.set(layer);
    scene.add(mesh);

    active.push({
      kind: "spark",
      mesh,
      age: 0,
      life: 0.09 + Math.random() * 0.1,
      vel: new THREE.Vector3(
        back * (1.4 + Math.random() * 2),
        0.2 + Math.random() * 1.4,
        (Math.random() - 0.5) * 0.7,
      ),
    });
  }

  function update(dt, feetWorld = null, facing = 1) {
    if (activeBurst && feetWorld) {
      emitAcc += dt;
      const rate = 0.014;
      while (emitAcc >= rate) {
        emitAcc -= rate;
        spawnPuff(feetWorld, facing);
        spawnPuff(feetWorld, facing);
        if (Math.random() < 0.5) spawnPuff(feetWorld, facing);
        if (Math.random() < 0.45) spawnSpark(feetWorld, facing);
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
        p.vel.y *= Math.exp(-1.4 * dt);
        p.vel.x *= Math.exp(-0.85 * dt);
        p.vel.multiplyScalar(Math.exp(-0.5 * dt));
        p.mesh.rotation.z += p.spin * dt;
        p.mesh.material.opacity = 0.65 * fade;
        p.mesh.scale.set(p.sx * (1 + u * 1.05), p.sy * (1 + u * 0.65), 1);
      } else {
        p.vel.y *= Math.exp(-3.5 * dt);
        p.vel.multiplyScalar(Math.exp(-1.4 * dt));
        p.mesh.material.opacity = 0.85 * fade;
        p.mesh.scale.setScalar(0.35 * (1 - u * 0.55));
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
