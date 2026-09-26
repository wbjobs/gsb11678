// WebXR 能力检测
export async function detectSupport() {
  const result = {
    xrApi: typeof navigator !== 'undefined' && 'xr' in navigator,
    immersiveVr: false,
    immersiveAr: false,
    handTracking: false,
    secureContext: window.isSecureContext === true,
    errors: [],
  };
  if (!result.xrApi) {
    result.errors.push('浏览器不支持 WebXR API (navigator.xr 不存在)');
    return result;
  }
  if (!result.secureContext) {
    result.errors.push('非安全上下文 (需要 HTTPS 或 localhost)，WebXR 不可用');
  }
  const checks = [['immersive-vr', 'immersiveVr'], ['immersive-ar', 'immersiveAr']];
  for (const [mode, key] of checks) {
    try {
      result[key] = await navigator.xr.isSessionSupported(mode);
    } catch (e) {
      result.errors.push(`检测 ${mode} 失败: ${e.message}`);
    }
  }
  // 手部追踪能力: 通过请求会话描述探测（不真正启动会话时只能间接判断）
  try {
    if (navigator.xr.isSessionSupported) {
      // 部分浏览器支持 isSessionSupported 带 optionalFeatures 的探测不可行，
      // 使用 XRSystem 的会话请求在真正进入时检测，这里先标记为“待会话确认”
      result.handTracking = null; // null = 未知，会话建立后确认
    }
  } catch { /* ignore */ }
  return result;
}

export function renderBadges(support, container) {
  container.innerHTML = '';
  const mk = (label, state) => {
    const el = document.createElement('span');
    el.className = `badge ${state}`;
    el.textContent = label;
    container.appendChild(el);
  };
  mk(`WebXR API ${support.xrApi ? '✓' : '✗'}`, support.xrApi ? 'ok' : 'no');
  mk(`VR ${support.immersiveVr ? '✓' : '✗'}`, support.immersiveVr ? 'ok' : 'no');
  mk(`AR ${support.immersiveAr ? '✓' : '✗'}`, support.immersiveAr ? 'ok' : 'no');
  if (support.handTracking === true) mk('手部追踪 ✓', 'ok');
  else if (support.handTracking === false) mk('手部追踪 ✗', 'no');
  else mk('手部追踪 ?', 'warn');
  if (!support.secureContext) mk('非安全上下文', 'no');
}
