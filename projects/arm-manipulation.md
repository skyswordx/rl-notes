---
layout: doc
title: Sim2Web 机械臂操控
aside: false
sidebar: false
editLink: false
pageClass: immersive-page
---

<script setup>
import RobotScene from '../components/sim2web/RobotScene.vue'
</script>

<ClientOnly>
  <RobotScene />
</ClientOnly>

<div class="doc-content-wrapper">

## 技术架构详解

本项目展示了从 **深度强化学习 (Deep RL)** 模型训练到基于 **ONNX Runtime Web** 的端侧推理全流程。

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

</div>
