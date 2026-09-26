// Canvas 2D HUD：姿态、按键、射线信息可视化
export class HUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  draw({ mode, sources, viewerPose }) {
    this.resize();
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    let y = 70;
    const line = (text, color = '#cfe3ff') => {
      ctx.fillStyle = color;
      ctx.font = '13px monospace';
      ctx.fillText(text, 16, y);
      y += 18;
    };

    line(`模式: ${mode}`, '#8fb8e8');
    if (viewerPose) {
      const p = viewerPose.transform.position;
      const q = viewerPose.transform.orientation;
      line(`头部位置: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
      line(`头部朝向: (${q.x.toFixed(2)}, ${q.y.toFixed(2)}, ${q.z.toFixed(2)}, ${q.w.toFixed(2)})`);
    }
    y += 6;

    for (const s of sources) {
      const label = s.kind === 'hand' ? '手部追踪'
        : s.kind === 'mouse' ? '鼠标模拟' : '控制器';
      line(`[${label}] ${s.handedness}`, '#7fe0a8');
      if (s.ray) {
        const o = s.ray.origin, d = s.ray.dir;
        line(`  射线原点: (${o[0].toFixed(2)}, ${o[1].toFixed(2)}, ${o[2].toFixed(2)})`);
        line(`  射线方向: (${d[0].toFixed(2)}, ${d[1].toFixed(2)}, ${d[2].toFixed(2)})`);
      }
      if (s.pose) {
        const p = s.pose.position;
        line(`  握持位置: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
      }
      if (s.buttons?.length) {
        const btns = s.buttons
          .map((b, i) => `${i}:${b.pressed ? '●' : b.touched ? '◐' : '○'}${b.value}`)
          .join(' ');
        line(`  按键: ${btns}`);
      }
      if (s.axes?.length) line(`  摇杆: [${s.axes.join(', ')}]`);
      if (s.gesture) line(`  手势: ${s.gesture}`, '#ffd97f');
      if (s.hitCube) line(`  命中方块 ✓`, '#7fe0a8');
      y += 6;
    }
    ctx.restore();
  }
}
