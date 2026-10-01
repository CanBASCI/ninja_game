/** Klavye durumu — karakter modülleri paylaşır */

export function createInput() {
  const keys = new Set();
  const input = {
    jumpQueued: false,
    /** Zıplama buffer bitiş zamanı (ms) — kısa basışlar kaçmasın */
    jumpBufferUntil: 0,
    ropeQueued: false,
    swingQueued: false,
    eQueued: false,
    xQueued: false,
  };

  const JUMP_BUFFER_MS = 160;

  window.addEventListener("keydown", (e) => {
    if (
      ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
        e.code
      )
    ) {
      e.preventDefault();
    }
    if ((e.code === "ArrowUp" || e.code === "KeyW") && !e.repeat) {
      input.jumpQueued = true;
      input.jumpBufferUntil = performance.now() + JUMP_BUFFER_MS;
    }
    if (e.code === "Digit3" && !e.repeat) {
      input.ropeQueued = true;
    }
    if (e.code === "Digit4" && !e.repeat) {
      input.swingQueued = true;
    }
    if (e.code === "KeyE" && !e.repeat) {
      input.eQueued = true;
    }
    if (e.code === "KeyX" && !e.repeat) {
      input.xQueued = true;
    }
    keys.add(e.code);
  });

  window.addEventListener("keyup", (e) => {
    keys.delete(e.code);
    // jumpQueued keyup’ta silinmez — buffer / başarılı zıplama tüketir
  });

  return { keys, input };
}
