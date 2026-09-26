// 输入管理：XR 控制器 / 手部追踪 / 手势识别 / 鼠标模拟降级
import { vec3, poseToRay } from './math.js';
import { HAND_JOINTS } from './renderer.js';

const HAND_COLOR_LEFT = [0.4, 0.9, 1.0, 1];
const HAND_COLOR_RIGHT = [1.0, 0.7, 0.4, 1];
const RAY_COLOR_LEFT = [0.4, 0.9, 1.0, 1];
const RAY_COLOR_RIGHT = [1.0, 0.7, 0.4, 1];
const RAY_COLOR_MOUSE = [1.0, 0.85, 0.3, 1];

// 基于手部关节的简单手势识别
export function detectGesture(joints) {
  const wrist = joints['wrist'];
  const indexTip = joints['index-finger-tip'];
  const thumbTip = joints['thumb-tip'];
  const middleTip = joints['middle-finger-tip'];
  const pinkyTip = joints['pinky-finger-tip'];
  if (!wrist || !indexTip || !thumbTip) return '未知';
  const dist = (a, b) => vec3.length(vec3.sub(a, b));
  const pinchDist = dist(indexTip, thumbTip);
  const extended = (tip) => dist(tip, wrist) > 0.12;
  const idx = extended(indexTip);
  // 捏合：指尖相触且食指处于伸展状态（排除握拳时拇指贴近食指的误判）
  if (pinchDist < 0.025 && dist(indexTip, wrist) > 0.08) return '捏合 (Pinch)';
  const mid = middleTip && extended(middleTip);
  const pk = pinkyTip && extended(pinkyTip);
  if (idx && mid && pk) return '张开手掌';
  if (idx && !mid) return '指向';
  if (!idx && !mid && !pk) return '握拳';
  return '半握';
}

export class InputManager {
  constructor(renderer, callbacks) {
    this.renderer = renderer;
    this.cb = callbacks; // { onSourcesChanged, onEvent }
    this.sources = new Map(); // XRInputSource -> state
    this.fallback = {
      active: false,
      mouse: { x: 0, y: 0, down: false },
      ray: null,
    };
    this._bindMouse();
  }

  // ---------- XR 输入源 ----------
  syncSources(session) {
    if (!session) return;
    const seen = new Set();
    for (const src of session.inputSources) {
      seen.add(src);
      if (!this.sources.has(src)) {
        this.sources.set(src, {
          source: src,
          handedness: src.handedness || 'none',
          kind: src.hand ? 'hand' : 'controller',
          buttons: [],
          axes: [],
          pose: null,
          ray: null,
          joints: null,
          gesture: null,
          lost: false,
        });
        this.cb.onEvent('input-added', {
          handedness: src.handedness,
          kind: src.hand ? 'hand' : (src.gamepad?.id || 'controller'),
        });
      }
    }
    // 输入丢失处理：标记并移除
    for (const [src, state] of this.sources) {
      if (!seen.has(src)) {
        state.lost = true;
        this.cb.onEvent('input-lost', { handedness: state.handedness, kind: state.kind }, 'warn');
        this.sources.delete(src);
      }
    }
    this.cb.onSourcesChanged();
  }

  updateFrame(frame, refSpace) {
    for (const state of this.sources.values()) {
      const src = state.source;
      // 目标射线姿态
      const targetPose = frame.getPose(src.targetRaySpace, refSpace);
      state.ray = targetPose ? poseToRay(targetPose.transform) : null;
      // 握持姿态
      if (src.gripSpace) {
        const grip = frame.getPose(src.gripSpace, refSpace);
        state.pose = grip ? grip.transform : null;
      }
      // 手柄按键 / 摇杆
      if (src.gamepad) {
        state.buttons = src.gamepad.buttons.map((b) => ({
          pressed: b.pressed, touched: b.touched, value: +b.value.toFixed(2),
        }));
        state.axes = src.gamepad.axes.map((a) => +a.toFixed(2));
      }
      // 手部追踪
      if (src.hand) {
        const joints = {};
        let ok = 0;
        for (const name of HAND_JOINTS) {
          const space = src.hand.get(name);
          if (!space) continue;
          const pose = frame.getJointPose(space, refSpace);
          if (pose) {
            const m = pose.transform.matrix;
            joints[name] = [m[12], m[13], m[14]];
            ok++;
          }
        }
        state.joints = ok ? joints : null;
        state.gesture = ok ? detectGesture(joints) : null;
      }
    }
  }

  rayColor(state) {
    if (state.handedness === 'left') return RAY_COLOR_LEFT;
    if (state.handedness === 'right') return RAY_COLOR_RIGHT;
    return [0.8, 0.8, 0.8, 1];
  }

  handColor(state) {
    return state.handedness === 'left' ? HAND_COLOR_LEFT : HAND_COLOR_RIGHT;
  }

  // ---------- 鼠标模拟降级 ----------
  _bindMouse() {
    const canvas = document.getElementById('gl-canvas');
    canvas.addEventListener('mousemove', (e) => {
      this.fallback.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.fallback.mouse.y = -((e.clientY / window.innerHeight) * 2 - 1);
    });
    canvas.addEventListener('mousedown', () => {
      this.fallback.mouse.down = true;
      if (this.fallback.active) this.cb.onEvent('mouse-press', {}, 'info');
    });
    canvas.addEventListener('mouseup', () => {
      this.fallback.mouse.down = false;
      if (this.fallback.active) this.cb.onEvent('mouse-release', {}, 'info');
    });
  }

  setFallback(active) {
    this.fallback.active = active;
    this.cb.onSourcesChanged();
  }

  // 由相机 VP 逆矩阵生成鼠标射线
  fallbackRay(invVP) {
    const { x, y } = this.fallback.mouse;
    const pNear = this._unproject(invVP, x, y, -1);
    const pFar = this._unproject(invVP, x, y, 1);
    const dir = vec3.normalize(vec3.sub(pFar, pNear));
    return { origin: pNear, dir };
  }

  _unproject(invVP, x, y, z) {
    const m = invVP;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
    ];
  }

  // 汇总给渲染器 / HUD 的数据
  collect(invVP) {
    const rays = [];
    const hands = [];
    for (const state of this.sources.values()) {
      if (state.ray) {
        const hit = this.renderer.rayHit(state.ray.origin, state.ray.dir);
        rays.push({ ...state.ray, color: this.rayColor(state), hit: hit?.point });
        state.hitCube = hit?.cube ?? null;
      }
      if (state.joints) hands.push({ joints: state.joints, color: this.handColor(state) });
    }
    let fallbackRay = null;
    if (this.fallback.active) {
      fallbackRay = this.fallbackRay(invVP);
      const hit = this.renderer.rayHit(fallbackRay.origin, fallbackRay.dir);
      rays.push({ ...fallbackRay, color: RAY_COLOR_MOUSE, hit: hit?.point });
      this.fallback.hitCube = hit?.cube ?? null;
    }
    return { rays, hands, fallbackRay };
  }

  listSources() {
    const list = [...this.sources.values()];
    if (this.fallback.active) {
      list.push({
        kind: 'mouse', handedness: 'n/a', fallback: true,
        buttons: [{ pressed: this.fallback.mouse.down, value: this.fallback.mouse.down ? 1 : 0 }],
        axes: [+this.fallback.mouse.x.toFixed(2), +this.fallback.mouse.y.toFixed(2)],
        gesture: this.fallback.mouse.down ? '按下' : '移动',
      });
    }
    return list;
  }
}
