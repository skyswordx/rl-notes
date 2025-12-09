---
layout: page
title: Sim2Web 机械臂操控
---

<script setup>
import RobotScene from '../components/sim2web/RobotScene.vue'
</script>

<style scoped>
.vp-doc {
  max-width: 100% !important;
  padding: 0 !important;
}
</style>

# Sim2Web: 机械臂操控实战

本项目展示了从 **深度强化学习 (Deep RL)** 模型训练到基于 **ONNX** 和 **Three.js** 的 Web 端实时推理的全流程。

## 交互演示

<div style="width: 100%; min-height: 700px;">
  <ClientOnly>
    <RobotScene />
  </ClientOnly>
</div>

> **注意**: 此演示需要加载 `/public/models/` 目录下的 `panda_arm.glb` 模型文件以及训练好的 `robot_policy.onnx` 策略模型。如果您是在本地查看且尚未运行训练脚本，场景可能无法加载或保持静止。

## 工作原理

1.  **训练 (Training)**: 使用 Python 中的 Stable-Baselines3 库训练智能体 (Agent)。
2.  **导出 (Export)**: 将训练好的策略网络导出为通用的 ONNX 格式。
3.  **部署 (Deployment)**: 在浏览器中加载 ONNX 模型，实时接收环境观测状态 (Observation) 并输出关节动作 (Action)。

```python
# 推理逻辑伪代码
obs = get_robot_state()       # 获取当前机械臂状态
action = session.run(obs)     # 运行 ONNX 模型进行推理
robot.apply_action(action)    # 将动作应用到机械臂关节
```
