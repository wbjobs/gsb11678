// WebGL 渲染: 地面网格、输入射线、姿态坐标轴、手部关节点
const VS = `
attribute vec3 aPos;
attribute vec3 aColor;
uniform mat4 uVP;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uVP * vec4(aPos, 1.0);
  gl_PointSize = 6.0;
}`;

const FS = `
precision mediump float;
varying vec3 vColor;
void main() { gl_FragColor = vec4(vColor, 1.0); }`;

// 列主序 4x4 矩阵工具
export const mat4 = {
  identity() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; },
  multiply(a, b) {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c*4+r] += a[k*4+r] * b[c*4+k];
    return o;
  },
  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
    return [f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0];
  },
  invertRigid(m) {
    // 逆转置旋转 + 平移 (适用于刚体变换)
    const t = [m[0],m[4],m[8], m[1],m[5],m[9], m[2],m[6],m[10]];
    const p = [m[12], m[13], m[14]];
    const np = [
      -(t[0]*p[0]+t[3]*p[1]+t[6]*p[2]),
      -(t[1]*p[0]+t[4]*p[1]+t[7]*p[2]),
      -(t[2]*p[0]+t[5]*p[1]+t[8]*p[2]),
    ];
    return [t[0],t[1],t[2],0, t[3],t[4],t[5],0, t[6],t[7],t[8],0, np[0],np[1],np[2],1];
  },
  fromPose(p) {
    // XRRigidTransform {position:{x,y,z}, orientation:{x,y,z,w}} -> mat4
    const { x, y, z, w } = p.orientation;
    const { x: px, y: py, z: pz } = p.position;
    const x2=x+x, y2=y+y, z2=z+z;
    const xx=x*x2, xy=x*y2, xz=x*z2, yy=y*y2, yz=y*z2, zz=z*z2, wx=w*x2, wy=w*y2, wz=w*z2;
    return [
      1-(yy+zz), xy+wz, xz-wy, 0,
      xy-wz, 1-(xx+zz), yz+wx, 0,
      xz+wy, yz-wx, 1-(xx+yy), 0,
      px, py, pz, 1,
    ];
  },
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { xrCompatible: true }) ||
              canvas.getContext('webgl');
    this.glError = null;
    if (!this.gl) { this.glError = 'WebGL 不可用'; return; }
    const gl = this.gl;
    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        this.glError = gl.getShaderInfoLog(s);
      }
      gl.attachShader(prog, s);
    }
    gl.linkProgram(prog);
    gl.useProgram(prog);
    this.prog = prog;
    this.aPos = gl.getAttribLocation(prog, 'aPos');
    this.aColor = gl.getAttribLocation(prog, 'aColor');
    this.uVP = gl.getUniformLocation(prog, 'uVP');
    this.buffer = gl.createBuffer();
    gl.enable(gl.DEPTH_TEST);
    this.verts = [];   // 线段顶点 [x,y,z,r,g,b ...]
    this.points = [];  // 点顶点
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
  }

  beginFrame() { this.verts.length = 0; this.points.length = 0; }

  line(a, b, color) { this.verts.push(...a, ...color, ...b, ...color); }
  point(p, color) { this.points.push(...p, ...color); }

  addGrid(size = 10, divisions = 20) {
    const c1 = [0.18, 0.22, 0.3], c2 = [0.3, 0.36, 0.48];
    const half = size / 2, step = size / divisions;
    for (let i = 0; i <= divisions; i++) {
      const v = -half + i * step;
      const c = i === divisions / 2 ? c2 : c1;
      this.line([v, 0, -half], [v, 0, half], c);
      this.line([-half, 0, v], [half, 0, v], c);
    }
  }

  // 姿态坐标轴 (RGB = XYZ)
  addAxes(poseMatrix, len = 0.08) {
    const m = poseMatrix;
    const o = [m[12], m[13], m[14]];
    const axes = [
      [[m[0], m[1], m[2]], [1, 0.25, 0.25]],
      [[m[4], m[5], m[6]], [0.25, 1, 0.25]],
      [[m[8], m[9], m[10]], [0.35, 0.55, 1]],
    ];
    for (const [dir, color] of axes) {
      this.line(o, [o[0]+dir[0]*len, o[1]+dir[1]*len, o[2]+dir[2]*len], color);
    }
  }

  addRay(originMatrix, color = [1, 0.8, 0.2], len = 5) {
    const m = originMatrix;
    const o = [m[12], m[13], m[14]];
    // 射线沿 -Z
    const d = [-m[8], -m[9], -m[10]];
    this.line(o, [o[0]+d[0]*len, o[1]+d[1]*len, o[2]+d[2]*len], color);
    this.point(o, color);
  }

  draw(vpMatrix, viewport = null, clear = true) {
    if (!this.gl) return;
    const gl = this.gl;
    if (viewport) {
      gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
    } else {
      this.resize();
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
    if (clear) {
      gl.clearColor(0.04, 0.05, 0.08, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }
    gl.uniformMatrix4fv(this.uVP, false, new Float32Array(vpMatrix));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);

    const draw = (data, mode, pointSize) => {
      if (!data.length) return;
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(this.aPos);
      gl.enableVertexAttribArray(this.aColor);
      gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 24, 0);
      gl.vertexAttribPointer(this.aColor, 3, gl.FLOAT, false, 24, 12);
      gl.drawArrays(mode, 0, data.length / 6);
    };
    draw(this.verts, gl.LINES);
    draw(this.points, gl.POINTS);
  }
}
