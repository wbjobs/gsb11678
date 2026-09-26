// 主入口：装配支持检测、会话、输入、渲染、HUD 与日志
import { Renderer } from './renderer.js';
import { HUD } from './hud.js';
import { InputManager } from './input.js';
import { SessionManager } from './session.js';
import { mat4 } from './math.js';
import { logEvent, recentEvents, exportAll } from './db.js';

const $ = (id) => document.getElementById(id);
const banner = $('banner');
const sourceList = $('source-list');
const logList = $('log-list');

let bannerTimer = null;
function showBanner(level, text, sticky = false) {
  banner.className = level;
  banner.textContent = text;
  clearTimeout(bannerTimer);
  if (!sticky) bannerTimer = setTimeout(() => banner.classList.add('hidden'), 5000);
}

// ---------- 渲染器与 HUD ----------
let renderer;
try {
  renderer = new Renderer($('gl-canvas'));
} catch (err) {
  showBanner('error', `WebGL 初始化失败：${err.message}`, true);
  throw err;
}
const hud = new HUD($('hud-canvas'));

// ---------- 面板 ----------
function renderSources(sources) {
  if (!sources.length) {
    sourceList.innerHTML = '<div class="log-item">暂无输入源</div>';
    return;
  }
  sourceList.innerHTML = sources.map((s) => {
    const badge = s.kind === 'hand' ? '<span class="badge hand">手部</span>'
      : s.kind === 'mouse' ? '<span class="badge mouse">鼠标</span>'
      : '<span class="badge controller">手柄</span>';
    const btns = (s.buttons ?? []).map((b, i) =>
      `<div class="row">键${i}: <b>${b.pressed ? '按下' : b.touched ? '触摸' : '松开'}</b> (${b.value})</div>`).join('');
    const axes = s.axes?.length ? `<div class="row">摇杆: <b>[${s.axes.join(', ')}]</b></div>` : '';
    const gesture = s.gesture ? `<div class="row">手势: <b>${s.gesture}</b></div>` : '';
    const ray = s.ray
      ? `<div class="row">射线: <b>(${s.ray.dir.map((v) => v.toFixed(2)).join(', ')})</b></div>` : '';
    return `<div class="source-card">
      <div class="title"><span>${s.handedness}</span>${badge}</div>
      ${ray}${btns}${axes}${gesture}
    </div>`;
  }).join('');
}

async function renderLogs() {
  try {
    const events = await recentEvents(30);
    logList.innerHTML = events.map((e) =>
      `<div class="log-item ${e.level}">[${new Date(e.ts).toLocaleTimeString()}] ${e.type}</div>`).join('');
  } catch { /* IndexedDB 不可用时忽略 */ }
}

// ---------- 输入 ----------
const input = new InputManager(renderer, {
  onSourcesChanged: () => renderSources(input.listSources()),
  onEvent: (type, detail, level) => {
    logEvent(type, detail, level);
    renderLogs();
  },
});

// ---------- 会话 ----------
let xrSession = null;
let xrRefSpace = null;
let handHintShown = false;

const sessionMgr = new SessionManager({
  onStatus: (level, text) => showBanner(level, text, level === 'error'),
  onSessionStart(session, refSpace) {
    xrSession = session;
    xrRefSpace = refSpace;
    handHintShown = false;
    updateButtons();
    // 手部追踪可用性提示：请求了但未启用
    if (!session.enabledFeatures?.includes('hand-tracking')) {
      showBanner('warn', '当前设备/浏览器未启用手部追踪，将仅显示控制器输入', false);
      logEvent('hand-tracking-unavailable', {}, 'warn');
      handHintShown = true;
    }
    session.requestAnimationFrame(onXRFrame);
  },
  onSessionEnd() {
    xrSession = null;
    xrRefSpace = null;
    input.sources.clear();
    renderSources(input.listSources());
    updateButtons();
    showBanner('info', '会话已结束，可重新进入');
    renderLogs();
  },
  onSourcesChange() {
    input.syncSources(xrSession);
  },
});

function updateButtons() {
  $('btn-vr').disabled = !!xrSession || !sessionMgr.support.vr;
  $('btn-ar').disabled = !!xrSession || !sessionMgr.support.ar;
  $('btn-end').disabled = !xrSession;
}

// ---------- XR 帧循环 ----------
function onXRFrame(time, frame) {
  if (!xrSession) return;
  xrSession.requestAnimationFrame(onXRFrame);
  input.syncSources(xrSession);
  input.updateFrame(frame, xrRefSpace);

  // 手部追踪运行时提示：会话支持但 5 秒内未见任何手
  if (!handHintShown && time > 5000) {
    const hasHand = [...input.sources.values()].some((s) => s.kind === 'hand');
    const hasAnySource = sessionMgr.session.inputSources.length > 0;
    if (!hasHand && hasAnySource) {
      showBanner('warn', '未检测到手部追踪输入，可尝试控制器或检查设备设置');
      logEvent('hand-tracking-not-detected', {}, 'warn');
      handHintShown = true;
    }
  }

  const viewerPose = frame.getViewerPose(xrRefSpace);
  let vp;
  if (viewerPose) {
    const view = viewerPose.views[0];
    vp = mat4.multiply(
      Array.from(view.projectionMatrix),
      Array.from(view.transform.inverse.matrix));
  } else {
    vp = defaultVP();
  }
  const invVP = mat4.invert(vp);
  const scene = input.collect(invVP);
  renderer.render(vp, scene);
  hud.draw({
    mode: xrSession.mode === 'immersive-ar' ? 'AR 会话' : 'VR 会话',
    sources: input.listSources(),
    viewerPose,
  });
  throttledRenderSources();
}

// 面板 DOM 更新节流（约 5Hz），避免每帧重建 innerHTML
let lastPanelUpdate = 0;
function throttledRenderSources() {
  const now = performance.now();
  if (now - lastPanelUpdate < 200) return;
  lastPanelUpdate = now;
  renderSources(input.listSources());
}

// ---------- 降级（非 XR）帧循环 ----------
let viewerYaw = 0.4;
let viewerPitch = -0.15;

function defaultVP() {
  const aspect = window.innerWidth / window.innerHeight;
  const proj = mat4.perspective(Math.PI / 3, aspect, 0.05, 100);
  const eye = [0, 1.6, 0];
  const target = [
    eye[0] + Math.sin(viewerYaw) * Math.cos(viewerPitch),
    eye[1] + Math.sin(viewerPitch),
    eye[2] - Math.cos(viewerYaw) * Math.cos(viewerPitch),
  ];
  return mat4.multiply(proj, mat4.lookAt(eye, target, [0, 1, 0]));
}

function fallbackLoop() {
  if (xrSession) return; // XR 会话期间由 XR 帧循环接管
  const vp = defaultVP();
  const invVP = mat4.invert(vp);
  const scene = input.collect(invVP);
  renderer.render(vp, scene);
  hud.draw({
    mode: input.fallback.active ? '鼠标模拟（降级）' : '桌面预览',
    sources: input.listSources(),
    viewerPose: null,
  });
  requestAnimationFrame(fallbackLoop);
}

// 拖拽旋转视角
(() => {
  let dragging = false, lastX = 0, lastY = 0;
  const canvas = $('gl-canvas');
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2 || e.shiftKey) { dragging = true; lastX = e.clientX; lastY = e.clientY; }
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    viewerYaw += (e.clientX - lastX) * 0.005;
    viewerPitch = Math.max(-1.4, Math.min(1.4, viewerPitch - (e.clientY - lastY) * 0.005));
    lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
})();

// ---------- 按钮 ----------
$('btn-vr').addEventListener('click', () => sessionMgr.start('immersive-vr'));
$('btn-ar').addEventListener('click', () => sessionMgr.start('immersive-ar'));
$('btn-end').addEventListener('click', () => sessionMgr.end());
$('btn-fallback').addEventListener('click', () => {
  const next = !input.fallback.active;
  input.setFallback(next);
  $('btn-fallback').textContent = next ? '关闭模拟' : '鼠标模拟';
  showBanner('info', next ? '鼠标模拟已开启：移动鼠标控制射线，左键按压' : '鼠标模拟已关闭');
  logEvent('fallback-toggle', { active: next });
});
$('btn-export').addEventListener('click', async () => {
  try {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `webxr-input-log-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    showBanner('error', `导出失败：${err.message}`);
  }
});

// ---------- 启动 ----------
(async function init() {
  const support = await sessionMgr.detectSupport();
  if (!('xr' in navigator)) {
    // 浏览器不支持 WebXR：自动降级到鼠标模拟
    input.setFallback(true);
    $('btn-fallback').textContent = '关闭模拟';
  } else if (!support.vr && !support.ar) {
    showBanner('warn', '未检测到可用的 VR/AR 设备，可使用鼠标模拟模式', true);
  }
  updateButtons();
  renderSources(input.listSources());
  renderLogs();
  requestAnimationFrame(fallbackLoop);
})();
