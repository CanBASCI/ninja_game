/** Karakter görünüm menüsü — sadece ana karakter materyalleri */

export const lookSimple = {
  light: 3,
  shine: 0,
  lift: 0.4,
  /** Kamera Z — küçük = yakın, büyük = uzak */
  zoom: 14.0,
};

/** Kılıf: pos birim local, rot derece (UI) */
export const sheathPose = {
  posX: -0.18,
  posY: -0.01,
  posZ: 0.07,
  rotX: 27,
  rotY: -99,
  rotZ: -51,
};

/** Kılıf+katana: aynı + enine dönüş + boyut */
export const sheathFullPose = {
  posX: -0.3,
  posY: 0.1,
  posZ: 0.41,
  rotX: 28,
  rotY: -103,
  rotZ: -48,
  /** Uzun eksen etrafında (enine) ° */
  twist: 180,
  /** fit sonrası çarpan */
  scale: 1.4,
};

function degToRad(d) {
  return (d * Math.PI) / 180;
}

export function applySheathPose(hold) {
  if (!hold) return;
  hold.position.set(sheathPose.posX, sheathPose.posY, sheathPose.posZ);
  hold.rotation.set(
    degToRad(sheathPose.rotX),
    degToRad(sheathPose.rotY),
    degToRad(sheathPose.rotZ),
  );
}

/**
 * @param {THREE.Object3D | null} hold
 * @param {{ baseScale?: number, twistNode?: THREE.Object3D | null }} [opts]
 */
export function applySheathFullPose(hold, opts = {}) {
  if (!hold) return;
  const base = opts.baseScale ?? 1;
  hold.position.set(
    sheathFullPose.posX,
    sheathFullPose.posY,
    sheathFullPose.posZ,
  );
  hold.rotation.set(
    degToRad(sheathFullPose.rotX),
    degToRad(sheathFullPose.rotY),
    degToRad(sheathFullPose.rotZ),
  );
  const s = base * sheathFullPose.scale;
  hold.scale.setScalar(s);
  const twistNode = opts.twistNode;
  if (twistNode) {
    // Tip hizalı modelde uzun eksen ≈ local Y
    twistNode.rotation.set(0, degToRad(sheathFullPose.twist), 0);
  }
}

export function createLookController({
  getMaterials,
  getBaseColors,
  getCharLights,
}) {
  function applyLookSettings() {
    const lights = getCharLights?.();
    if (lights) {
      lights.hemi.intensity = 1.15;
      lights.sun.intensity = 1.35;
      lights.fill.intensity = 0;
      lights.rim.intensity = 0;
      lights.key.intensity = 0;
    }

    const L = lookSimple.light;
    const S = lookSimple.shine;
    const C = lookSimple.lift;
    const roughness = 1 - S * 0.75;
    const metalness = S * 0.28;
    const envMap = S * 1.4;
    const mats = getMaterials();
    const bases = getBaseColors();

    for (let i = 0; i < mats.length; i++) {
      const mat = mats[i];
      mat.roughness = roughness;
      mat.metalness = metalness;
      mat.envMapIntensity = envMap;
      if (bases[i] && mat.color) {
        mat.color.copy(bases[i]);
        mat.color.multiplyScalar(L);
        const lum =
          0.2126 * mat.color.r + 0.7152 * mat.color.g + 0.0722 * mat.color.b;
        if (lum < 0.12 * L + 0.01) mat.color.offsetHSL(0, 0, C);
      }
      mat.needsUpdate = true;
    }

    for (const row of document.querySelectorAll("#lookControls .look-row")) {
      const keyName = row.dataset.key;
      const el = row.querySelector(".val");
      const input = row.querySelector("input[type=range]");
      if (keyName in lookSimple) {
        if (el) el.textContent = Number(lookSimple[keyName]).toFixed(2);
        if (input) input.value = String(lookSimple[keyName]);
      }
    }
  }

  function buildLookPanel() {
    const root = document.getElementById("lookControls");
    if (!root) return;

    const rows = [
      { key: "light", label: "Karakter ışığı", step: 0.01, min: 0.2, max: 3 },
      { key: "shine", label: "Parlaklık / yansıma", step: 0.01, min: 0, max: 1 },
      { key: "lift", label: "Renk açıklığı", step: 0.01, min: 0, max: 0.4 },
      {
        key: "zoom",
        label: "Sahne yakın / uzak",
        step: 0.1,
        min: 3.5,
        max: 20,
      },
    ];

    root.innerHTML = "";
    for (const row of rows) {
      const div = document.createElement("div");
      div.className = "look-row";
      div.dataset.key = row.key;
      div.innerHTML = `
      <label>
        <span>${row.label}</span>
        <span class="val">0.00</span>
      </label>
      <input type="range" min="${row.min}" max="${row.max}" step="${row.step}" value="${lookSimple[row.key]}" />`;
      const input = div.querySelector("input");
      input.addEventListener("input", () => {
        lookSimple[row.key] = Number(input.value);
        applyLookSettings();
      });
      root.appendChild(div);
    }

    document.getElementById("lookCopy")?.addEventListener("click", async () => {
      const text = JSON.stringify(lookSimple, null, 2);
      try {
        await navigator.clipboard.writeText(text);
        const btn = document.getElementById("lookCopy");
        btn.textContent = "Kopyalandı!";
        setTimeout(() => {
          btn.textContent = "Değerleri kopyala";
        }, 1200);
      } catch {
        console.log(text);
        alert(text);
      }
    });

    applyLookSettings();
  }

  return { applyLookSettings, buildLookPanel, lookSimple };
}

export function createSheathController({ getSheath }) {
  function syncLabels() {
    for (const row of document.querySelectorAll("#sheathControls .look-row")) {
      const keyName = row.dataset.key;
      const el = row.querySelector(".val");
      const input = row.querySelector("input[type=range]");
      if (!(keyName in sheathPose)) continue;
      if (el) el.textContent = Number(sheathPose[keyName]).toFixed(2);
      if (input) input.value = String(sheathPose[keyName]);
    }
  }

  function apply() {
    applySheathPose(getSheath?.());
    syncLabels();
  }

  function buildSheathPanel() {
    const root = document.getElementById("sheathControls");
    if (!root) return;

    const rows = [
      { key: "posX", label: "Konum X", step: 0.01, min: -0.8, max: 0.8 },
      { key: "posY", label: "Konum Y", step: 0.01, min: -0.5, max: 0.5 },
      { key: "posZ", label: "Konum Z", step: 0.01, min: -0.5, max: 0.5 },
      { key: "rotX", label: "Eğim X (°)", step: 1, min: -180, max: 180 },
      { key: "rotY", label: "Eğim Y (°)", step: 1, min: -180, max: 180 },
      { key: "rotZ", label: "Eğim Z (°)", step: 1, min: -180, max: 180 },
    ];

    root.innerHTML = "";
    for (const row of rows) {
      const div = document.createElement("div");
      div.className = "look-row";
      div.dataset.key = row.key;
      div.innerHTML = `
      <label>
        <span>${row.label}</span>
        <span class="val">0.00</span>
      </label>
      <input type="range" min="${row.min}" max="${row.max}" step="${row.step}" value="${sheathPose[row.key]}" />`;
      const input = div.querySelector("input");
      input.addEventListener("input", () => {
        sheathPose[row.key] = Number(input.value);
        apply();
      });
      root.appendChild(div);
    }

    document.getElementById("sheathCopy")?.addEventListener("click", async () => {
      const text = [
        `pos: (${sheathPose.posX.toFixed(3)}, ${sheathPose.posY.toFixed(3)}, ${sheathPose.posZ.toFixed(3)})`,
        `rot°: (${sheathPose.rotX.toFixed(1)}, ${sheathPose.rotY.toFixed(1)}, ${sheathPose.rotZ.toFixed(1)})`,
        `rot rad: (${degToRad(sheathPose.rotX).toFixed(4)}, ${degToRad(sheathPose.rotY).toFixed(4)}, ${degToRad(sheathPose.rotZ).toFixed(4)})`,
        JSON.stringify(sheathPose, null, 2),
      ].join("\n");
      try {
        await navigator.clipboard.writeText(text);
        const btn = document.getElementById("sheathCopy");
        btn.textContent = "Kopyalandı!";
        setTimeout(() => {
          btn.textContent = "Değerleri kopyala";
        }, 1200);
      } catch {
        console.log(text);
        alert(text);
      }
    });

    apply();
  }

  return { applySheathPose: apply, buildSheathPanel, sheathPose };
}

export function createSheathFullController({ getSheathFull, getApplyOpts }) {
  function syncLabels() {
    for (const row of document.querySelectorAll(
      "#sheathFullControls .look-row",
    )) {
      const keyName = row.dataset.key;
      const el = row.querySelector(".val");
      const input = row.querySelector("input[type=range]");
      if (!(keyName in sheathFullPose)) continue;
      if (el) el.textContent = Number(sheathFullPose[keyName]).toFixed(2);
      if (input) input.value = String(sheathFullPose[keyName]);
    }
  }

  function apply() {
    applySheathFullPose(getSheathFull?.(), getApplyOpts?.() || {});
    syncLabels();
  }

  function buildSheathFullPanel() {
    const root = document.getElementById("sheathFullControls");
    if (!root) return;

    const rows = [
      { key: "posX", label: "Konum X", step: 0.01, min: -0.8, max: 0.8 },
      { key: "posY", label: "Konum Y", step: 0.01, min: -0.5, max: 0.5 },
      { key: "posZ", label: "Konum Z", step: 0.01, min: -0.5, max: 0.5 },
      { key: "rotX", label: "Eğim X (°)", step: 1, min: -180, max: 180 },
      { key: "rotY", label: "Eğim Y (°)", step: 1, min: -180, max: 180 },
      { key: "rotZ", label: "Eğim Z (°)", step: 1, min: -180, max: 180 },
      { key: "twist", label: "Enine dön (°)", step: 1, min: -180, max: 180 },
      { key: "scale", label: "Boyut", step: 0.01, min: 0.3, max: 2.5 },
    ];

    root.innerHTML = "";
    for (const row of rows) {
      const div = document.createElement("div");
      div.className = "look-row";
      div.dataset.key = row.key;
      div.innerHTML = `
      <label>
        <span>${row.label}</span>
        <span class="val">0.00</span>
      </label>
      <input type="range" min="${row.min}" max="${row.max}" step="${row.step}" value="${sheathFullPose[row.key]}" />`;
      const input = div.querySelector("input");
      input.addEventListener("input", () => {
        sheathFullPose[row.key] = Number(input.value);
        apply();
      });
      root.appendChild(div);
    }

    document
      .getElementById("sheathFullCopy")
      ?.addEventListener("click", async () => {
        const text = [
          `pos: (${sheathFullPose.posX.toFixed(3)}, ${sheathFullPose.posY.toFixed(3)}, ${sheathFullPose.posZ.toFixed(3)})`,
          `rot°: (${sheathFullPose.rotX.toFixed(1)}, ${sheathFullPose.rotY.toFixed(1)}, ${sheathFullPose.rotZ.toFixed(1)})`,
          `twist°: ${sheathFullPose.twist.toFixed(1)}`,
          `scale: ${sheathFullPose.scale.toFixed(3)}`,
          JSON.stringify(sheathFullPose, null, 2),
        ].join("\n");
        try {
          await navigator.clipboard.writeText(text);
          const btn = document.getElementById("sheathFullCopy");
          btn.textContent = "Kopyalandı!";
          setTimeout(() => {
            btn.textContent = "Değerleri kopyala";
          }, 1200);
        } catch {
          console.log(text);
          alert(text);
        }
      });

    apply();
  }

  return {
    applySheathFullPose: apply,
    buildSheathFullPanel,
    sheathFullPose,
  };
}
