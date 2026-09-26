// 输入源采集: 控制器(gamepad)、手部追踪、射线/握持姿态、输入丢失检测
import { mat4 } from './renderer.js';

export const HAND_JOINTS = [
  'wrist',
  'thumb-metacarpal','thumb-phalanx-proximal','thumb-phalanx-distal','thumb-tip',
  'index-finger-metacarpal','index-finger-phalanx-proximal','index-finger-phalanx-intermediate','index-finger-phalanx-distal','index-finger-tip',
  'middle-finger-metacarpal','middle-finger-phalanx-proximal','middle-finger-phalanx-intermediate','middle-finger-phalanx-distal','middle-finger-tip',
  'ring-finger-metacarpal','ring-finger-phalanx-proximal','ring-finger-phalanx-intermediate','ring-finger-phalanx-distal','ring-finger-tip',
  'pinky-finger-metacarpal','pinky-finger-phalanx-proximal','pinky-finger-phalanx-intermediate','pinky-finger-phalanx-distal','pinky-finger-tip',
];

export class InputTracker {
  constructor() {
    this.sources = new Map(); // XRInputSource -> state
    this.lostCount = 0;
    this.onInputLost = null;   // 回调
    this.onInputFound = null;
  }

  bindSession(session) {
    this.sources.clear();
    session.addEventListener('inputsourceschange', (e) => {
      for (const s of e.removed) {
        this.sources.delete(s);
        this.lostCount++;
        this.onInputLost?.(s);
      }
      for (const s of e.added) {
        this.onInputFound?.(s);
      }
    });
    // select / squeeze 事件由 main 记录
  }

  // 每帧调用: 采集所有输入源的姿态与按键
  update(frame, refSpace) {
    const out = [];
    if (!frame || !frame.session) return out;
    for (const src of frame.session.inputSources) {
      const state = {
        source: src,
        handedness: src.handedness,       // left / right / none
        targetRayMode: src.targetRayMode, // gaze / tracked-pointer / screen
        isHand: !!src.hand,
        rayPose: null, rayMatrix: null,
        gripPose: null, gripMatrix: null,
        buttons: [], axes: [],
        joints: null,
        lost: false,
      };
      try {
        const rayPose = frame.getPose(src.targetRaySpace, refSpace);
        if (rayPose) {
          state.rayPose = rayPose.transform;
          state.rayMatrix = mat4.fromPose(rayPose.transform);
        } else {
          state.lost = true; // 追踪暂时丢失
        }
        if (src.gripSpace) {
          const gripPose = frame.getPose(src.gripSpace, refSpace);
          if (gripPose) {
            state.gripPose = gripPose.transform;
            state.gripMatrix = mat4.fromPose(gripPose.transform);
          }
        }
        if (src.gamepad) {
          state.buttons = src.gamepad.buttons.map(b => ({
            pressed: b.pressed, touched: b.touched, value: +b.value.toFixed(3),
          }));
          state.axes = Array.from(src.gamepad.axes).map(a => +a.toFixed(3));
        }
        if (src.hand) {
          state.joints = {};
          let tracked = 0;
          for (const name of HAND_JOINTS) {
            const space = src.hand.get(name);
            if (!space) continue;
            const jp = frame.getJointPose(space, refSpace);
            if (jp) {
              state.joints[name] = { pos: jp.transform.position, radius: jp.radius };
              tracked++;
            }
          }
          state.jointsTracked = tracked;
          if (tracked === 0) state.lost = true;
        }
      } catch (e) {
        state.error = e.message;
        state.lost = true;
      }
      out.push(state);
    }
    return out;
  }
}
