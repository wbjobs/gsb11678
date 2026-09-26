// WebGL 渲染器：地面网格、输入射线、手部骨架、可交互方块
import { mat4, vec3 } from './math.js';

const VERT = `
attribute vec3 aPos;
uniform mat4 uVP;
uniform mat4 uModel;
void main() { gl_Position = uVP * uModel * vec4(aPos, 1.0); }
`;
const FRAG = `
precision mediump float;
uniform vec4 uColor;
void main() { gl_FragColor = uColor; }
`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('Shader: ' + gl.getShaderInfoLog(s));
  }
  return s;
}

// 立方体 8 顶点 + 12 条边（线框）
const CUBE_VERTS = [
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
];
const CUBE_EDGES = [
  0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7,
];
// 立方体三角面索引（用于命中测试的实体渲染）
const CUBE_TRIS = [
  0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
  0, 4, 5, 0, 5, 1, 2, 6, 7, 2, 7, 3,
  0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2,
];

// 手部骨骼连接（WebXR Hand API 关节顺序）
export const HAND_JOINTS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];
const HAND_BONES = [];
for (let f = 0; f < 5; f++) {
  const base = 1 + f * 4;
  HAND_BONES.push([0, base]);
  for (let j = 0; j < 3; j++) HAND_BONES.push([base + j, base + j + 1]);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { alpha: true, antialias: true });
    if (!this.gl) throw new Error('WebGL 不可用');
    const gl = this.gl;
    this.program = gl.createProgram();
    gl.attachShader(this.program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(this.program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error('Link: ' + gl.getProgramInfoLog(this.program));
    }
    this.aPos = gl.getAttribLocation(this.program, 'aPos');
    this.uVP = gl.getUniformLocation(this.program, 'uVP');
    this.uModel = gl.getUniformLocation(this.program, 'uModel');
    this.uColor = gl.getUniformLocation(this.program, 'uColor');

    this.cubeBuf = this._buffer(CUBE_VERTS);
    this.cubeEdgeBuf = this._indexBuffer(CUBE_EDGES);
    this.cubeTriBuf = this._indexBuffer(CUBE_TRIS);
    this.gridBuf = this._buffer(this._buildGrid(10, 0.5));
    this.gridCount = this.gridBuf.count;
    this.lineBuf = gl.createBuffer();
    this.pointBuf = gl.createBuffer();

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // 可交互方块：位置 / 尺寸 / 颜色 / 状态
    this.cubes = [
      { pos: [-0.6, 1.2, -1.5], size: 0.25, color: [0.3, 0.6, 1.0, 1], hovered: false, grabbed: false },
      { pos: [0.0, 1.4, -1.8], size: 0.25, color: [0.4, 1.0, 0.6, 1], hovered: false, grabbed: false },
      { pos: [0.6, 1.1, -1.5], size: 0.25, color: [1.0, 0.55, 0.3, 1], hovered: false, grabbed: false },
    ];
  }

  _buffer(data) {
    const gl = this.gl;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    return { buf, count: data.length / 3 };
  }

  _indexBuffer(data) {
    const gl = this.gl;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(data), gl.STATIC_DRAW);
    return { buf, count: data.length };
  }

  _buildGrid(half, step) {
    const lines = [];
    for (let i = -half; i <= half; i++) {
      lines.push(i * step, 0, -half * step, i * step, 0, half * step);
      lines.push(-half * step, 0, i * step, half * step, 0, i * step);
    }
    return lines;
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

  _draw(bufObj, mode, vp, model, color, countOverride) {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.uVP, false, vp);
    gl.uniformMatrix4fv(this.uModel, false, model);
    gl.uniform4fv(this.uColor, color);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufObj.buf ?? bufObj);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(mode, 0, countOverride ?? bufObj.count);
  }

  _drawIndexed(bufObj, idxObj, mode, vp, model, color) {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.uVP, false, vp);
    gl.uniformMatrix4fv(this.uModel, false, model);
    gl.uniform4fv(this.uColor, color);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufObj.buf ?? bufObj);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxObj.buf);
    gl.drawElements(mode, idxObj.count, gl.UNSIGNED_SHORT, 0);
  }

  // rays: [{origin, dir, color, hit}]  hands: [{joints: {name: [x,y,z]}, color}]
  render(vp, { rays = [], hands = [], fallbackCursor = null } = {}) {
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.043, 0.055, 0.078, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    const I = mat4.identity();

    // 地面网格
    this._draw(this.gridBuf, gl.LINES, vp, I, [0.2, 0.28, 0.38, 0.8]);

    // 方块：实体 + 线框，悬停/抓取时变色
    for (const c of this.cubes) {
      const model = this._model(c.pos, c.size);
      let color = c.color;
      if (c.grabbed) color = [1.0, 0.9, 0.2, 1];
      else if (c.hovered) color = [color[0] * 0.4 + 0.6, color[1] * 0.4 + 0.6, color[2] * 0.4 + 0.6, 1];
      this._drawIndexed(this.cubeBuf, this.cubeTriBuf, gl.TRIANGLES, vp, model, [color[0], color[1], color[2], 0.85]);
      this._drawIndexed(this.cubeBuf, this.cubeEdgeBuf, gl.LINES, vp, model, [1, 1, 1, 0.6]);
    }

    // 输入射线
    for (const ray of rays) {
      const end = ray.hit ?? vec3.add(ray.origin, vec3.scale(ray.dir, 5));
      const data = [...ray.origin, ...end];
      const gl2 = this.gl;
      gl2.bindBuffer(gl2.ARRAY_BUFFER, this.lineBuf);
      gl2.bufferData(gl2.ARRAY_BUFFER, new Float32Array(data), gl2.DYNAMIC_DRAW);
      this._draw({ buf: this.lineBuf }, gl2.LINES, vp, I, ray.color, 2);
      // 命中点光标
      const cursorModel = this._model(end, 0.03);
      this._drawIndexed(this.cubeBuf, this.cubeTriBuf, gl2.TRIANGLES, vp, cursorModel, ray.color);
    }

    // 手部骨架
    for (const hand of hands) {
      const pts = HAND_JOINTS.map((j) => hand.joints[j]).filter(Boolean);
      if (!pts.length) continue;
      const boneData = [];
      for (const [a, b] of HAND_BONES) {
        const pa = hand.joints[HAND_JOINTS[a]];
        const pb = hand.joints[HAND_JOINTS[b]];
        if (pa && pb) boneData.push(...pa, ...pb);
      }
      if (boneData.length) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(boneData), gl.DYNAMIC_DRAW);
        this._draw({ buf: this.lineBuf }, gl.LINES, vp, I, hand.color, boneData.length / 3);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts.flat()), gl.DYNAMIC_DRAW);
      this._draw({ buf: this.pointBuf }, gl.POINTS, vp, I, [1, 1, 1, 1], pts.length);
    }

    // 鼠标模拟光标
    if (fallbackCursor) {
      const m = this._model(fallbackCursor, 0.04);
      this._drawIndexed(this.cubeBuf, this.cubeTriBuf, gl.TRIANGLES, vp, m, [1, 0.85, 0.3, 1]);
    }
  }

  _model(pos, size) {
    return [
      size, 0, 0, 0,
      0, size, 0, 0,
      0, 0, size, 0,
      pos[0], pos[1], pos[2], 1,
    ];
  }

  // 射线与方块（AABB）求交，返回最近命中点
  rayHit(origin, dir) {
    let best = null;
    for (const c of this.cubes) {
      const half = c.size / 2;
      const min = vec3.sub(c.pos, [half, half, half]);
      const max = vec3.add(c.pos, [half, half, half]);
      let tmin = -Infinity, tmax = Infinity;
      for (let i = 0; i < 3; i++) {
        const inv = 1 / (dir[i] || 1e-9);
        let t0 = (min[i] - origin[i]) * inv;
        let t1 = (max[i] - origin[i]) * inv;
        if (t0 > t1) [t0, t1] = [t1, t0];
        tmin = Math.max(tmin, t0);
        tmax = Math.min(tmax, t1);
      }
      if (tmax >= tmin && tmax > 0) {
        const t = tmin > 0 ? tmin : tmax;
        if (!best || t < best.t) best = { t, cube: c, point: vec3.add(origin, vec3.scale(dir, t)) };
      }
    }
    return best;
  }
}
