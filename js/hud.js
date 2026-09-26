// Canvas 2D HUD: 在视口上叠加姿态/按键文本信息
export class HUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
  }

  draw(lines, modeLabel) {
    this.resize();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.font = `${12 * dpr}px ui-monospace, monospace`;
    ctx.textBaseline = 'top';
    let y = 10 * dpr;
    ctx.fillStyle = 'rgba(16,20,28,0.6)';
    const width = Math.min(this.canvas.width - 20 * dpr, 460 * dpr);
    const height = (lines.length + 1) * 18 * dpr + 16 * dpr;
    ctx.fillRect(8 * dpr, 8 * dpr, width, height);
    ctx.fillStyle = '#8fb4f0';
    ctx.fillText(`模式: ${modeLabel}`, 16 * dpr, y);
    y += 18 * dpr;
    ctx.fillStyle = '#dfe6f0';
    for (const line of lines) {
      ctx.fillText(line, 16 * dpr, y);
      y += 18 * dpr;
    }
  }
}
