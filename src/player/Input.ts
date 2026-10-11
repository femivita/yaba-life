/** Keyboard, mouse and touch input folded into one small state object. */
export class Input {
  readonly keys = new Set<string>();
  /** accumulated look delta in pixels since last read */
  look = { x: 0, y: 0 };
  zoom = 0;
  /** virtual joystick, -1..1 */
  stick = { x: 0, y: 0, active: false };
  private dragging = false;
  private stickId: number | null = null;
  private lookId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private last = { x: 0, y: 0 };
  readonly stickEl: HTMLDivElement;
  readonly knobEl: HTMLDivElement;

  constructor(el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      this.zoom += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });

    this.stickEl = document.createElement('div');
    this.stickEl.className = 'stick';
    this.knobEl = document.createElement('div');
    this.knobEl.className = 'knob';
    this.stickEl.appendChild(this.knobEl);
    document.body.appendChild(this.stickEl);

    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && e.clientX < innerWidth * 0.45 && this.stickId === null) {
        this.stickId = e.pointerId;
        this.stickOrigin = { x: e.clientX, y: e.clientY };
        this.stick.active = true;
        this.stickEl.style.display = 'block';
        this.stickEl.style.left = `${e.clientX - 60}px`;
        this.stickEl.style.top = `${e.clientY - 60}px`;
      } else if (this.lookId === null) {
        this.lookId = e.pointerId;
        this.dragging = true;
        this.last = { x: e.clientX, y: e.clientY };
      }
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) {
        const dx = e.clientX - this.stickOrigin.x;
        const dy = e.clientY - this.stickOrigin.y;
        const l = Math.hypot(dx, dy);
        const m = Math.min(l, 50) / (l || 1);
        this.stick.x = (dx * m) / 50;
        this.stick.y = (dy * m) / 50;
        this.knobEl.style.transform = `translate(${dx * m}px, ${dy * m}px)`;
      } else if (e.pointerId === this.lookId && this.dragging) {
        this.look.x += e.clientX - this.last.x;
        this.look.y += e.clientY - this.last.y;
        this.last = { x: e.clientX, y: e.clientY };
      }
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.stickId) {
        this.stickId = null;
        this.stick = { x: 0, y: 0, active: false };
        this.stickEl.style.display = 'none';
        this.knobEl.style.transform = '';
      }
      if (e.pointerId === this.lookId) {
        this.lookId = null;
        this.dragging = false;
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /** movement intent in camera space: x = strafe right, y = forward */
  move() {
    let x = 0;
    let y = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (this.stick.active) {
      x += this.stick.x;
      y -= this.stick.y;
    }
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return { x, y, run: k.has('ShiftLeft') || k.has('ShiftRight') || Math.hypot(this.stick.x, this.stick.y) > 0.92 };
  }

  takeLook() {
    const l = this.look;
    this.look = { x: 0, y: 0 };
    return l;
  }

  takeZoom() {
    const z = this.zoom;
    this.zoom = 0;
    return z;
  }
}
