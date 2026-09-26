// XR 会话管理：支持检测、建立、中断与恢复
import { saveSession, logEvent } from './db.js';

export class SessionManager {
  constructor(callbacks) {
    this.cb = callbacks; // { onStatus, onSessionStart, onSessionEnd, onFrame }
    this.session = null;
    this.refSpace = null;
    this.support = { vr: false, ar: false, handTracking: false };
    this.sessionRecord = null;
    this.wasInterrupted = false;

    // 页面可见性变化（头显摘下 / 系统中断）时记录
    document.addEventListener('visibilitychange', () => {
      if (this.session && document.hidden) {
        this.wasInterrupted = true;
        this.cb.onStatus('warn', '会话被系统中断（如摘下头显），返回后可恢复');
        logEvent('session-interrupted', { reason: 'visibilitychange' }, 'warn');
      }
    });
  }

  async detectSupport() {
    if (!('xr' in navigator)) {
      this.cb.onStatus('error', '当前浏览器不支持 WebXR，已切换到鼠标模拟模式');
      logEvent('unsupported', { reason: 'navigator.xr missing' }, 'error');
      return this.support;
    }
    try {
      this.support.vr = await navigator.xr.isSessionSupported('immersive-vr');
    } catch { this.support.vr = false; }
    try {
      this.support.ar = await navigator.xr.isSessionSupported('immersive-ar');
    } catch { this.support.ar = false; }
    // 手部追踪能力在会话建立后通过 enabledFeatures 与 inputSource.hand 运行时判定
    logEvent('support-detected', this.support);
    return this.support;
  }

  async start(mode) {
    if (this.session) return;
    if (!('xr' in navigator)) {
      this.cb.onStatus('error', 'WebXR 不可用，无法建立会话');
      return;
    }
    const optionalFeatures = ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'];
    try {
      this.session = await navigator.xr.requestSession(mode, { optionalFeatures });
    } catch (err) {
      this.cb.onStatus('error', `无法建立 ${mode} 会话：${err.message}（设备未连接或被拒绝）`);
      logEvent('session-failed', { mode, error: err.message }, 'error');
      return;
    }
    this.refSpace = await this._initRefSpace(this.session);
    this.sessionRecord = {
      mode,
      startedAt: Date.now(),
      userAgent: navigator.userAgent,
      interrupted: this.wasInterrupted,
    };
    await saveSession(this.sessionRecord);
    await logEvent('session-start', { mode, resumed: this.wasInterrupted });

    this.session.addEventListener('end', () => this._onEnd());
    this.session.addEventListener('inputsourceschange', (e) => {
      logEvent('inputsourceschange', {
        added: e.added.length, removed: e.removed.length,
      }, e.removed.length ? 'warn' : 'info');
      this.cb.onSourcesChange?.();
    });
    this.session.addEventListener('select', (e) => logEvent('select', { handedness: e.inputSource.handedness }));
    this.session.addEventListener('squeeze', (e) => logEvent('squeeze', { handedness: e.inputSource.handedness }));

    if (this.wasInterrupted) {
      this.cb.onStatus('info', '会话已恢复');
      this.wasInterrupted = false;
    } else {
      this.cb.onStatus('info', `${mode === 'immersive-ar' ? 'AR' : 'VR'} 会话已建立`);
    }
    this.cb.onSessionStart(this.session, this.refSpace);
  }

  async _initRefSpace(session) {
    for (const type of ['local-floor', 'local', 'viewer']) {
      try {
        return await session.requestReferenceSpace(type);
      } catch { /* 尝试下一种 */ }
    }
    throw new Error('无法获取参考空间');
  }

  async end() {
    if (!this.session) return;
    try {
      await this.session.end();
    } catch (err) {
      this.cb.onStatus('warn', `结束会话异常：${err.message}`);
    }
  }

  async _onEnd() {
    if (this.sessionRecord) {
      this.sessionRecord.endedAt = Date.now();
      this.sessionRecord.durationMs = this.sessionRecord.endedAt - this.sessionRecord.startedAt;
      await saveSession(this.sessionRecord);
      this.sessionRecord = null;
    }
    await logEvent('session-end', {});
    this.session = null;
    this.refSpace = null;
    this.cb.onSessionEnd();
  }
}
