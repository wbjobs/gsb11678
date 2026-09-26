# WebXR 输入可视化

基于 WebXR + WebGL + Canvas + IndexedDB 的输入调试/可视化工具。

## 运行

需要通过 HTTPS 或 localhost 访问（WebXR 要求安全上下文）：

```bash
python3 -m http.server 8080
# 打开 http://localhost:8080
```

## 功能

- **能力检测**: 检测 WebXR API、`immersive-vr` / `immersive-ar` 会话支持、安全上下文，以徽章展示
- **会话管理**: 进入/结束 VR、AR 会话；`local-floor` 参考空间不可用时自动降级 `local`
- **输入展示**:
  - 控制器: 射线姿态 (targetRaySpace)、握持姿态 (gripSpace)、gamepad 按键/摇杆轴
  - 手部追踪: 25 个关节位置实时渲染为点云，显示追踪关节数
  - select / squeeze / inputsourceschange 事件记录
- **可视化**: WebGL 渲染地面网格、输入射线（黄黄线）、姿态坐标轴（RGB=XYZ）、手部关节点；Canvas 2D HUD 叠加文本信息
- **异常处理**:
  - 浏览器不支持 WebXR → 提示并引导鼠标模拟
  - 设备未连接 (`NotSupportedError`) → 自动降级鼠标模拟
  - 会话意外中断 → 显示"恢复会话"按钮重连
  - 输入源丢失 (`inputsourceschange` / 姿态为 null) → 警告提示与日志
  - 手部追踪不可用 → 徽章与消息提示
- **鼠标模拟降级**: 移动鼠标控制射线方向，左键=trigger，右键=squeeze，WASD/QE 移动位置，滚轮推拉
- **持久化**: 会话与输入事件写入 IndexedDB，刷新后可回放历史日志

## 文件结构

```
index.html        页面结构
css/style.css     样式
js/main.js        主流程: 会话生命周期、渲染循环、面板更新
js/support.js     WebXR 能力检测
js/renderer.js    WebGL 渲染器(网格/射线/坐标轴/关节点) + 矩阵工具
js/input.js       输入源采集(控制器/手部/丢失检测)
js/fallback.js    鼠标模拟降级
js/hud.js         Canvas 2D HUD
js/db.js          IndexedDB 事件日志
```
