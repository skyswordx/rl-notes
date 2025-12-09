---
layout: doc
title: Sim2Web 机械臂操控
aside: false 
sidebar: false
editLink: false
---

<script setup>
import RobotScene from '../components/sim2web/RobotScene.vue'
</script>

# Sim2Web: 机械臂操控实战

<div class="project-badges">
  <img src="https://img.shields.io/badge/Model-Panda-blue" />
  <img src="https://img.shields.io/badge/Stack-ONNX%20%2B%20Three.js-green" />
  <img src="https://img.shields.io/badge/Physics-Simulated-orange" />
</div>

本项目展示了从 **深度强化学习 (Deep RL)** 模型训练到基于 **ONNX Runtime Web** 的端侧推理全流程。在下方演示中，你可以拖动目标球体，观察机械臂如何根据神经网络策略实时规划路径。

---

<div class="theater-stage">
  <ClientOnly>
    <RobotScene />
  </ClientOnly>
</div>

---

## 技术架构详解

### 核心工作流
1.  **训练 (Training)**: 使用 `Stable-Baselines3` (PPO) 在 Gym 环境中训练。
2.  **导出 (Export)**: 策略网络导出为 `.onnx` 格式 (Float32)。
3.  **推理 (Inference)**: 浏览器通过 WASM 加载模型，每帧推理耗时 **< 1ms**。

### 观测空间 (Observation Space)
模型接收 12 维向量作为输入：

$$s_t = [p_{ee}, v_{ee}, p_{achieved}, p_{desired}]$$

其中 $p_{ee}$ 为末端执行器位置 (x,y,z)。

::: details 点击查看推理代码片段
```javascript
// 获取当前状态
const obs = [...armPos, ...armVel, ...achieved, ...desired];
// ONNX 推理
const action = await controller.value.predict(obs);
// 应用动作
applyTorque(action);
```
:::

<style>
/* 隐藏当前页面的右侧 TOC（如果有遗漏）并调整最大宽度 */
.VPDoc .container {
  max-width: 100% !important;
}

.VPDoc .content {
  max-width: 960px;
  margin: 0 auto;
}

/* 剧场模式容器：突破父级限制 */
.theater-stage {
  width: 100vw;
  position: relative;
  left: 50%;
  right: 50%;
  margin-left: -50vw;
  margin-right: -50vw;
  padding: 2rem 1rem;
  background: #0f0f1a;
  box-shadow: inset 0 0 20px rgba(0,0,0,0.5);
  display: flex;
  justify-content: center;
}

/* 针对移动端优化 */
@media (max-width: 768px) {
  .theater-stage {
    width: 100%;
    left: 0;
    margin-left: 0;
    padding: 1rem 0;
  }
}

.project-badges {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
}
</style>
