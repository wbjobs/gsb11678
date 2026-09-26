# WebXR 输入可视化

基于 **WebXR + WebGL + Canvas + IndexedDB** 的输入调试与可视化工具。
纯静态页面，无构建步骤、无外部依赖。

## 运行

```bash
python3 -m http.server 8080
# 打开 http://localhost:8080 （XR 会话需要 HTTPS 或 localhost）
```

## 功能

- **支持检测**：`navigator.xr` 存在性 + `isSessionSupported('immersive-vr'/'immersive-ar')`，按结果启停按钮
- **会话管理**：建立 / 结束 AR、VR 会话；`visibilitychange` 检测系统中断，重新进入时提示“会话已恢复”；会话记录（模式、时长、UA）写入 IndexedDB
- **控制器输入**：目标射线姿态、握持姿态、Gamepad 按键（pressed/touched/value）与摇杆轴实时展示
- **手部追踪**：25 个关节点 + 骨骼连线渲染；手势识别（捏合 / 指向 / 握拳 / 张开手掌）
- **射线可视化**：每个输入源一条射线，与场景方块做 AABB 求交，命中点显示光标、方块高亮
- **降级方案**：浏览器不支持 WebXR 时自动进入鼠标模拟（鼠标移动 = 射线，左键 = 按压，Shift/右键拖拽旋转视角）
- **异常处理**：设备未连接（requestSession 失败）、输入源丢失（inputsourceschange / 逐帧比对）、手部追踪不可用（enabledFeatures 检测 + 运行时超时提示）
- **日志**：所有事件写入 IndexedDB，面板实时显示，可导出 JSON

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `js/main.js` | 装配各模块、XR/桌面双帧循环、UI 绑定 |
| `js/session.js` | 支持检测、会话生命周期、中断恢复 |
| `js/input.js` | 输入源同步、手部关节、手势识别、鼠标模拟 |
| `js/renderer.js` | WebGL 渲染：网格、射线、手部骨架、可交互方块 |
| `js/hud.js` | Canvas 2D 叠加层：姿态 / 按键 / 射线数值 |
| `js/db.js` | IndexedDB 封装：会话记录与事件日志 |
| `js/math.js` | vec3 / mat4 / 姿态转射线 |
