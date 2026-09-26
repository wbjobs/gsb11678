// 鼠标模拟降级: 无 WebXR 时用鼠标模拟一个控制器(姿态 + 射线 + 按键)
import { mat4 } from './renderer.js';

export class MouseFallback {
  constructor(canvas) {
    this.canvas = canvas;
    this.active = false;
    this.yaw = 0; this.pitch = 0;
    this.pos = [0, 1.5, 0.5];
    this.buttons = [
      { pressed: false, touched: false, value: 0 }, // 左键 = trigger
      { pressed: false, touched: false, value: 0 }, // 右键 = squeeze
    ];
    this.axes = [0, 0, 0, 0];
    this._onKey = (e) => this._key(e, true);
    this._onKeyUp = (e) => this._key(e, false);
    this._onMove = (e) => {
      if (!this.active) return;
      const r = this.canvas.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
      this.yaw = -nx * Math.PI * 0.6;
      this.pitch = -ny * Math.PI * 0.35;
      this.axes[2] = +nx.toFixed(3);
      this.axes[3] = +ny.toFixed(3);
    };
    this._onDown = (e) => { if (this.active && this.buttons[e.button]) { this.buttons[e.button].pressed = true; this.buttons[e.button].touched = true; this.buttons[e.button].value = 1; } };
    this._onUp = (e) => { if (this.buttons[e.button]) { this.buttons[e.button].pressed = false; this.buttons[e.button].value = 0; } };
    this._onWheel = (e) => {
      if (!this.active) return;
      this.pos[2] = Math.max(-2, Math.min(2, this.pos[2] + Math.sign(e.deltaY) * 0.05));
    };
  }

  _key(e, down) {
    if (!this.active) return;
    const s = 0.02;
    const k = e.key.toLowerCase();
    if (k === 'w') this.pos[2] -= s;
    if (k === 's') this.pos[2] += s;
    if (k === 'a') this.pos[0] -= s;
    if (k === 'd') this.pos[0] += s;
    if (k === 'q') this.pos[1] -= s;
    if (k === 'e') this.pos[1] += s;
  }

  start() {
    this.active = true;
    const c = this.canvas;
    c.addEventListener('mousemove', this._onMove);
    c.addEventListener('mousedown', this._onDown);
    window.addEventListener('mouseup', this._onUp);
    c.addEventListener('wheel', this._onWheel);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKeyUp);
  }

  stop() {
    this.active = false;
    const c = this.canvas;
    c.removeEventListener('mousemove', this._onMove);
    c.removeEventListener('mousedown', this._onDown);
    window.removeEventListener('mouseup', this._onUp);
    c.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('keyup', this._onKeyUp);
  }

  // 生成与真实输入源同构的状态
  getState() {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    // yaw(Y) * pitch(X) 旋转矩阵
    const m = [
      cy, 0, -sy, 0,
      sy * sp, cp, cy * sp, 0,
      sy * cp, -sp, cy * cp, 0,
      this.pos[0], this.pos[1], this.pos[2], 1,
    ];
    return {
      handedness: 'right',
      targetRayMode: 'tracked-pointer',
      isHand: false,
      simulated: true,
      rayMatrix: m,
      gripMatrix: m,
      rayPose: null, gripPose: null,
      buttons: this.buttons.map(b => ({ ...b })),
      axes: [...this.axes],
      joints: null,
      lost: false,
    };
  }
}
