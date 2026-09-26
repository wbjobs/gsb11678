// 轻量 3D 数学库：vec3 / mat4，避免外部依赖
export const vec3 = {
  create: () => [0, 0, 0],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  length: (a) => Math.hypot(a[0], a[1], a[2]),
  normalize(a) {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
};

export const mat4 = {
  identity() {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  },
  multiply(a, b) {
    const out = new Array(16).fill(0);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++)
        for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return out;
  },
  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    const nf = 1 / (near - far);
    return [
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ];
  },
  lookAt(eye, center, up) {
    const z = vec3.normalize(vec3.sub(eye, center));
    const x = vec3.normalize(vec3.cross(up, z));
    const y = vec3.cross(z, x);
    return [
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -vec3.dot(x, eye), -vec3.dot(y, eye), -vec3.dot(z, eye), 1,
    ];
  },
  invert(m) {
    // 通用 4x4 求逆（伴随矩阵法）
    const inv = new Array(16);
    const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3],
      m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7],
      m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11],
      m12 = m[12], m13 = m[13], m14 = m[14], m15 = m[15];
    inv[0] = m5 * m10 * m15 - m5 * m11 * m14 - m9 * m6 * m15 + m9 * m7 * m14 + m13 * m6 * m11 - m13 * m7 * m10;
    inv[4] = -m4 * m10 * m15 + m4 * m11 * m14 + m8 * m6 * m15 - m8 * m7 * m14 - m12 * m6 * m11 + m12 * m7 * m10;
    inv[8] = m4 * m9 * m15 - m4 * m11 * m13 - m8 * m5 * m15 + m8 * m7 * m13 + m12 * m5 * m11 - m12 * m7 * m9;
    inv[12] = -m4 * m9 * m14 + m4 * m10 * m13 + m8 * m5 * m14 - m8 * m6 * m13 - m12 * m5 * m10 + m12 * m6 * m9;
    inv[1] = -m1 * m10 * m15 + m1 * m11 * m14 + m9 * m2 * m15 - m9 * m3 * m14 - m13 * m2 * m11 + m13 * m3 * m10;
    inv[5] = m0 * m10 * m15 - m0 * m11 * m14 - m8 * m2 * m15 + m8 * m3 * m14 + m12 * m2 * m11 - m12 * m3 * m10;
    inv[9] = -m0 * m9 * m15 + m0 * m11 * m13 + m8 * m1 * m15 - m8 * m3 * m13 - m12 * m1 * m11 + m12 * m3 * m9;
    inv[13] = m0 * m9 * m14 - m0 * m10 * m13 - m8 * m1 * m14 + m8 * m2 * m13 + m12 * m1 * m10 - m12 * m2 * m9;
    inv[2] = m1 * m6 * m15 - m1 * m7 * m14 - m5 * m2 * m15 + m5 * m3 * m14 + m13 * m2 * m7 - m13 * m3 * m6;
    inv[6] = -m0 * m6 * m15 + m0 * m7 * m14 + m4 * m2 * m15 - m4 * m3 * m14 - m12 * m2 * m7 + m12 * m3 * m6;
    inv[10] = m0 * m5 * m15 - m0 * m7 * m13 - m4 * m1 * m15 + m4 * m3 * m13 + m12 * m1 * m7 - m12 * m3 * m5;
    inv[14] = -m0 * m5 * m14 + m0 * m6 * m13 + m4 * m1 * m14 - m4 * m2 * m13 - m12 * m1 * m6 + m12 * m2 * m5;
    inv[3] = -m1 * m6 * m11 + m1 * m7 * m10 + m5 * m2 * m11 - m5 * m3 * m10 - m9 * m2 * m7 + m9 * m3 * m6;
    inv[7] = m0 * m6 * m11 - m0 * m7 * m10 - m4 * m2 * m11 + m4 * m3 * m10 + m8 * m2 * m7 - m8 * m3 * m6;
    inv[11] = -m0 * m5 * m11 + m0 * m7 * m9 + m4 * m1 * m11 - m4 * m3 * m9 - m8 * m1 * m7 + m8 * m3 * m5;
    inv[15] = m0 * m5 * m10 - m0 * m6 * m9 - m4 * m1 * m10 + m4 * m2 * m9 + m8 * m1 * m6 - m8 * m2 * m5;
    let det = m0 * inv[0] + m1 * inv[4] + m2 * inv[8] + m3 * inv[12];
    if (!det) return mat4.identity();
    det = 1.0 / det;
    return inv.map((v) => v * det);
  },
  transformPoint(m, p) {
    const [x, y, z] = p;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
    ];
  },
  transformDir(m, d) {
    const [x, y, z] = d;
    return [
      m[0] * x + m[4] * y + m[8] * z,
      m[1] * x + m[5] * y + m[9] * z,
      m[2] * x + m[6] * y + m[10] * z,
    ];
  },
};

// 从 XRRigidTransform 提取位置与 -Z 朝向
export function poseToRay(transform) {
  const m = transform.matrix;
  const origin = [m[12], m[13], m[14]];
  const dir = vec3.normalize([-m[8], -m[9], -m[10]]);
  return { origin, dir };
}
