// 主流程: 能力检测、会话生命周期、渲染循环、输入展示、降级与恢复
import { detectSupport, renderBadges } from './support.js';
import { Renderer, mat4 } from './renderer.js';
import { InputTracker } from './input.js';
import { MouseFallback } from './fallback.js';
import { HUD } from './hud.js';
import * as db from './db.js';

const $ = (id) => document.getElementById(id);
const els = {
  badges: $('support-badges'), btnVr: $('btn-vr'), btnAr: $('btn-ar'),
  btnEnd: $('btn-end'), btnResume: $('btn-resume'), btnFallback: $('btn-fallback'),
  chkLog: $('chk-log'), sessionState: $('session-state'), message: $('message'),
  inputList: $('input-list'), eventLog: $('event-log'), btnClearLog: $('btn-clear-log'),
  glCanvas: $('gl-canvas'), hudCanvas: $('hud-canvas'),
};

let support = null;
let session = null;
let refSpace = null;
let sessionMode = null;          // 'immersive-vr' | 'immersive-ar'
let sessionInit = null;          // 用于恢复会话
let manualEnd = false;           // 区分主动结束与意外中断
let fallbackMode = false;
let rafId = null;

const renderer = new Renderer(els.glCanvas);
const hud = new HUD(els.hudCanvas);
const tracker = new InputTracker();
const fallback = new MouseFallback(els.glCanvas);

// ---------- 日志 ----------
async function log(type, detail, level = 'info') {
  const entry = await db.logEvent(type, detail, level);
  appendLogDOM(entry);
  refreshStoredLogCount();
}
function appendLogDOM(entry) {
  const div = document.createElement('div');
  if (entry.level !== 'info') div.className = entry.level;
  const time = new Date(entry.ts).toLocaleTimeString();
  div.textContent = `[${time}] ${entry.type} ${entry.detail !== '{}' ? entry.detail : ''}`;
  els.eventLog.prepend(div);
  while (els.eventLog.children.length > 100) els.eventLog.lastChild.remove();
}
async function refreshStoredLogCount() { /* 占位: 可扩展显示持久化条数 */ }

function setMessage(text, isError = false) {
  els.message.textContent = text || '';
  els.message.style.color = isError ? '#f0a8a8' : '#f0c674';
}
function setSessionState(text) { els.sessionState.textContent = `会话: ${text}`; }

// ---------- 会话生命周期 ----------
async function startSession(mode) {
  if (!support?.xrApi) { enterFallback('浏览器不支持 WebXR，已切换到鼠标模拟'); return; }
  try {
    sessionInit = {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'],
    };
    session = await navigator.xr.requestSession(mode, sessionInit);
    sessionMode = mode;
    manualEnd = false;
    log('session-start', { mode });

    session.addEventListener('end', onSessionEnd);
    session.addEventListener('select', (e) => log('select', { hand: e.inputSource.handedness }));
    session.addEventListener('selectstart', (e) => log('selectstart', { hand: e.inputSource.handedness }));
    session.addEventListener('selectend', (e) => log('selectend', { hand: e.inputSource.handedness }));
    session.addEventListener('squeeze', (e) => log('squeeze', { hand: e.inputSource.handedness }));
    session.addEventListener('inputsourceschange', (e) => {
      for (const s of e.removed) log('input-lost', { hand: s.handedness, isHand: !!s.hand }, 'warn');
      for (const s of e.added) log('input-added', { hand: s.handedness, isHand: !!s.hand });
    });
    session.addEventListener('visibilitychange', () => {
      log('visibilitychange', { state: session.visibilityState }, 'warn');
      if (session.visibilityState !== 'visible') {
        setMessage('会话不可见(可能被系统挂起)，恢复后可继续');
      }
    });

    try {
      refSpace = await session.requestReferenceSpace('local-floor');
    } catch {
      refSpace = await session.requestReferenceSpace('local');
      log('refspace-fallback', { using: 'local' }, 'warn');
    }

    // 手部追踪可用性确认
    const wantsHand = sessionInit.optionalFeatures.includes('hand-tracking');
    if (wantsHand) {
      let hasHand = false;
      for (const s of session.inputSources) if (s.hand) hasHand = true;
      support.handTracking = hasHand;
      if (!hasHand) {
        setMessage('手部追踪不可用或未检测到手部输入源');
        log('hand-tracking-unavailable', {}, 'warn');
      }
      renderBadges(support, els.badges);
    }

    // 绑定 XR 帧缓冲层
    if (renderer.gl) {
      try {
        await renderer.gl.makeXRCompatible();
        session.updateRenderState({ baseLayer: new XRWebGLLayer(session, renderer.gl) });
      } catch (e) {
        log('xrlayer-error', { error: e.message }, 'warn');
      }
    }

    tracker.bindSession(session);
    tracker.onInputLost = () => setMessage('输入源丢失(控制器断开或追踪丢失)');
    tracker.onInputFound = () => setMessage('');

    updateButtons();
    setSessionState(`${mode} 运行中`);
    setMessage('');
    session.requestAnimationFrame(onXRFrame);
  } catch (e) {
    session = null;
    log('session-error', { mode, error: e.message }, 'err');
    if (e.name === 'NotSupportedError') {
      enterFallback(`设备未连接或不支持 ${mode}，已切换到鼠标模拟`);
    } else if (e.name === 'SecurityError') {
      setMessage('会话请求被拒绝(需要用户手势或权限)', true);
    } else {
      setMessage(`会话启动失败: ${e.message}，可尝试鼠标模拟模式`, true);
    }
  }
}

function onSessionEnd() {
  const wasManual = manualEnd;
  log('session-end', { manual: wasManual });
  session = null;
  refSpace = null;
  updateButtons();
  if (!wasManual) {
    // 意外中断: 提供恢复
    setSessionState('意外中断');
    setMessage('会话意外中断，点击“恢复会话”重连');
    els.btnResume.hidden = false;
    els.btnResume.disabled = false;
    log('session-interrupted', {}, 'warn');
  } else {
    setSessionState('已结束');
  }
  // 回到非 XR 渲染循环
  startFlatLoop();
}

async function resumeSession() {
  if (!sessionMode) return;
  els.btnResume.hidden = true;
  log('session-resume-attempt', { mode: sessionMode });
  await startSession(sessionMode);
}

async function endSession() {
  if (!session) return;
  manualEnd = true;
  try { await session.end(); } catch { /* 已结束 */ }
}

// ---------- 降级模式 ----------
function enterFallback(reason) {
  if (fallbackMode) return;
  fallbackMode = true;
  fallback.start();
  els.btnFallback.textContent = '退出鼠标模拟';
  setMessage(reason || '鼠标模拟模式: 移动鼠标控制射线，左键=trigger，右键=squeeze，WASD/QE 移动');
  setSessionState('鼠标模拟(降级)');
  log('fallback-enter', { reason });
  updateButtons();
  startFlatLoop();
}
function exitFallback() {
  fallbackMode = false;
  fallback.stop();
  els.btnFallback.textContent = '鼠标模拟模式';
  setMessage('');
  setSessionState('未启动');
  log('fallback-exit', {});
  updateButtons();
}

// ---------- 渲染循环 ----------
function onXRFrame(time, frame) {
  if (!session) return;
  session.requestAnimationFrame(onXRFrame);
  const states = tracker.update(frame, refSpace);

  const layer = session.renderState.baseLayer;
  const pose = refSpace ? frame.getViewerPose(refSpace) : null;
  if (layer && pose && renderer.gl) {
    renderer.gl.bindFramebuffer(renderer.gl.FRAMEBUFFER, layer.framebuffer);
    renderer.beginFrame();
    renderer.addGrid();
    buildInputGeometry(states);
    let first = true;
    for (const view of pose.views) {
      const vp = layer.getViewport(view);
      const vpMatrix = mat4.multiply(view.projectionMatrix, view.transform.inverse.matrix);
      renderer.draw(vpMatrix, vp, first);
      first = false;
    }
    renderer.gl.bindFramebuffer(renderer.gl.FRAMEBUFFER, null);
    hud.draw(states.map(describeState), sessionMode);
  } else {
    // 无法获得查看者姿态(追踪丢失): 仍更新面板
    renderScene(states, null, sessionMode);
  }
  updateInputPanel(states);
}

function startFlatLoop() {
  if (rafId) return;
  const loop = () => {
    rafId = requestAnimationFrame(loop);
    const states = fallbackMode ? [fallback.getState()] : [];
    // 固定相机视角
    const proj = mat4.perspective(Math.PI / 3, Math.max(els.glCanvas.width, 1) / Math.max(els.glCanvas.height, 1), 0.05, 50);
    const view = mat4.invertRigid(mat4.fromPose({
      position: { x: 0, y: 1.6, z: 2.5 },
      orientation: quatFromEuler(-0.25, 0, 0),
    }));
    renderScene(states, mat4.multiply(proj, view), fallbackMode ? '鼠标模拟' : '待机');
    if (fallbackMode) updateInputPanel(states);
  };
  loop();
}

function quatFromEuler(x, y, z) {
  const cx = Math.cos(x/2), sx = Math.sin(x/2);
  const cy = Math.cos(y/2), sy = Math.sin(y/2);
  const cz = Math.cos(z/2), sz = Math.sin(z/2);
  return {
    x: sx*cy*cz + cx*sy*sz, y: cx*sy*cz - sx*cy*sz,
    z: cx*cy*sz + sx*sy*cz, w: cx*cy*cz - sx*sy*sz,
  };
}

function buildInputGeometry(states) {
  for (const st of states) {
    const color = st.handedness === 'left' ? [0.4, 0.8, 1] : [1, 0.6, 0.3];
    if (st.rayMatrix) renderer.addRay(st.rayMatrix, [1, 0.85, 0.2]);
    if (st.gripMatrix) renderer.addAxes(st.gripMatrix, 0.1);
    else if (st.rayMatrix) renderer.addAxes(st.rayMatrix, 0.06);
    if (st.joints) {
      for (const name of Object.keys(st.joints)) {
        const p = st.joints[name].pos;
        renderer.point([p.x, p.y, p.z], color);
      }
    }
  }
}

function renderScene(states, vpOverride, modeLabel) {
  renderer.beginFrame();
  renderer.addGrid();
  buildInputGeometry(states);
  renderer.draw(vpOverride || mat4.identity());
  hud.draw(states.map(describeState), modeLabel || 'XR');
}

function fmtVec(p) { return p ? `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})` : 'N/A'; }

function describeState(st) {
  const hand = st.handedness === 'left' ? '左手' : st.handedness === 'right' ? '右手' : '未知';
  const kind = st.isHand ? '手部' : st.simulated ? '模拟控制器' : '控制器';
  const pressed = st.buttons.map((b, i) => b.pressed ? i : null).filter(v => v !== null);
  let s = `${hand} ${kind} 射线:${st.targetRayMode} 按键:[${pressed.join(',')}]`;
  if (st.isHand) s += ` 关节:${st.jointsTracked || 0}/25`;
  if (st.lost) s += ' [追踪丢失]';
  return s;
}

// ---------- 输入面板 ----------
function updateInputPanel(states) {
  if (!states.length) {
    els.inputList.innerHTML = '<p class="empty">暂无输入源</p>';
    return;
  }
  els.inputList.innerHTML = '';
  for (const st of states) {
    const card = document.createElement('div');
    card.className = 'input-card';
    const hand = st.handedness === 'left' ? '左手' : st.handedness === 'right' ? '右手' : '未知手';
    const kind = st.isHand ? '手部追踪' : st.simulated ? '鼠标模拟' : '控制器';
    const tags = [`<span class="tag">${st.targetRayMode}</span>`];
    if (st.isHand) tags.push('<span class="tag hand">hand</span>');
    if (st.lost) tags.push('<span class="tag lost">追踪丢失</span>');

    const btnGrid = st.buttons.map((b, i) =>
      `<div class="btn-ind ${b.pressed ? 'pressed' : ''}" title="value=${b.value}">${i}</div>`).join('');

    card.innerHTML = `
      <div class="title">${hand} · ${kind} ${tags.join('')}</div>
      <pre>射线原点: ${st.rayPose ? fmtVec(st.rayPose.position) : '(矩阵)'}
握持姿态: ${st.gripPose ? fmtVec(st.gripPose.position) : 'N/A'}
摇杆轴: [${st.axes.join(', ')}]${st.isHand ? `\n关节追踪: ${st.jointsTracked || 0}/25` : ''}</pre>
      <div class="btn-grid">${btnGrid}</div>`;
    els.inputList.appendChild(card);
  }
}

// ---------- UI 状态 ----------
function updateButtons() {
  const inSession = !!session;
  els.btnVr.disabled = inSession || fallbackMode || !support?.immersiveVr;
  els.btnAr.disabled = inSession || fallbackMode || !support?.immersiveAr;
  els.btnEnd.disabled = !inSession;
  els.btnFallback.disabled = inSession;
  if (inSession) els.btnResume.hidden = true;
}

// ---------- 启动 ----------
async function init() {
  await db.initDB();
  els.chkLog.addEventListener('change', () => db.setLoggingEnabled(els.chkLog.checked));

  support = await detectSupport();
  renderBadges(support, els.badges);
  for (const err of support.errors) log('support-warning', { err }, 'warn');

  if (!support.xrApi || (!support.immersiveVr && !support.immersiveAr)) {
    setMessage('未检测到可用的 WebXR 会话支持，可使用鼠标模拟模式体验');
    log('webxr-unavailable', { vr: support.immersiveVr, ar: support.immersiveAr }, 'warn');
  }

  els.btnVr.addEventListener('click', () => startSession('immersive-vr'));
  els.btnAr.addEventListener('click', () => startSession('immersive-ar'));
  els.btnEnd.addEventListener('click', endSession);
  els.btnResume.addEventListener('click', resumeSession);
  els.btnFallback.addEventListener('click', () => fallbackMode ? exitFallback() : enterFallback());
  els.btnClearLog.addEventListener('click', async () => {
    await db.clearEvents();
    els.eventLog.innerHTML = '';
  });

  // 页面可见性变化: XR 会话可能被系统中断
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && session) log('page-hidden-during-session', {}, 'warn');
  });

  updateButtons();
  startFlatLoop();

  // 回放历史事件
  const history = await db.getEvents(50);
  for (const e of history.reverse()) appendLogDOM(e);
}

init();
