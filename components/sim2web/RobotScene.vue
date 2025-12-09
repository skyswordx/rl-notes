<script setup>
import { shallowRef, onMounted, ref, computed, watch } from 'vue'
import { TresCanvas, useRenderLoop } from '@tresjs/core'
import { OrbitControls, TransformControls } from '@tresjs/cientos'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RobotController } from './Controller.js'
import { explainAction, designReward, POLICY_VARIANTS } from './LLMInterface.js'
import { withBase } from 'vitepress'

// --- State ---
const robotModel = shallowRef(null)
const controller = shallowRef(null)
const isModelLoaded = ref(false)
const isPlaying = ref(true)
const targetPos = ref(new THREE.Vector3(0.4, 0.4, 0.3)) // Target position - RED sphere
const targetMesh = shallowRef(null)

// --- Stats for Display ---
const stats = ref({
    distance: 0,
    velocity: 0,
    action: [0, 0, 0, 0],
    value: 0,
    fps: 0,
    inferenceTime: 0
})

// --- Debug State ---
const showDebug = ref(true)
const debugInfo = ref({
    obsShape: 0,
    obsValues: [],
    actionShape: 0,
    actionValues: [],
    sessionReady: false,
    lastError: null,
    loopRunning: false,
    jointNames: []
})

// --- Config ---
const MODEL_PATH = withBase('/models/panda_arm.glb')
const POLICY_PATH = withBase('/models/robot_policy.onnx')

// --- Modal State for LLM ---
const showExplainModal = ref(false)
const showRewardModal = ref(false)
const llmResponse = ref('')
const userQuestion = ref('为什么机械臂在这一刻选择了这个动作？')
const userFeedback = ref('动作太僵硬了，我希望它更顺滑一点')

// --- End Effector Position (simulated) ---
const endEffectorPos = ref(new THREE.Vector3(0.1, 0.6, 0.1)) // Start position - BLUE sphere

// --- Target Color based on distance ---
const targetColor = computed(() => {
    const d = stats.value.distance
    if (d < 0.05) return '#22c55e' // Green - close
    if (d < 0.15) return '#eab308' // Yellow - medium
    return '#ef4444' // Red - far
})

// --- Load Robot ---
const loadRobot = async () => {
    try {
        const loader = new GLTFLoader()
        const gltf = await loader.loadAsync(MODEL_PATH)
        robotModel.value = gltf.scene
        
        robotModel.value.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true
                child.receiveShadow = true
            }
        })
        
        // Log all object names in the GLB for debugging
        const allNames = []
        robotModel.value.traverse((child) => {
            if (child.name) {
                allNames.push({ name: child.name, type: child.type })
            }
        })
        console.log('[DEBUG] GLB Object Names:', allNames)
        debugInfo.value.jointNames = allNames.filter(n => n.type === 'Bone' || n.name.includes('link') || n.name.includes('joint')).map(n => n.name)
        
        isModelLoaded.value = true
    } catch (err) {
        console.error("Failed to load robot GLB", err)
    }
}

// --- Initialize ---
onMounted(async () => {
    await loadRobot()
    controller.value = new RobotController(POLICY_PATH)
    await controller.value.init()
})

// --- Control Loop ---
const { onLoop } = useRenderLoop()
let lastTime = performance.now()
let frameCount = 0

onLoop(async ({ delta, elapsed }) => {
    debugInfo.value.loopRunning = true
    
    // Check prerequisites
    if (!isModelLoaded.value) {
        debugInfo.value.lastError = 'Model not loaded'
        return
    }
    if (!controller.value?.session) {
        debugInfo.value.lastError = 'Session not ready'
        debugInfo.value.sessionReady = false
        return
    }
    if (!isPlaying.value) {
        debugInfo.value.lastError = 'Paused'
        return
    }
    
    debugInfo.value.sessionReady = true
    debugInfo.value.lastError = null

    const now = performance.now()
    frameCount++
    
    // Calculate FPS every second
    if (now - lastTime >= 1000) {
        stats.value.fps = frameCount
        frameCount = 0
        lastTime = now
    }

    // 1. Build Observation
    // ONNX model expects 12 dimensions:
    // arm_pos(3) + arm_vel(3) + achieved_goal(3) + desired_goal(3) = 12
    const achieved = [endEffectorPos.value.x, endEffectorPos.value.y, endEffectorPos.value.z]
    const desired = [targetPos.value.x, targetPos.value.y, targetPos.value.z]
    
    // Simulated arm position and velocity (end effector state)
    const armPos = [endEffectorPos.value.x, endEffectorPos.value.y, endEffectorPos.value.z]
    const armVel = [0.0, 0.0, 0.0] // Simulated zero velocity for simplicity
    
    // Build 12-dim observation
    const obs = [...armPos, ...armVel, ...achieved, ...desired]
    
    debugInfo.value.obsShape = obs.length
    debugInfo.value.obsValues = obs.map(v => v.toFixed(3))

    // 2. Run Inference
    const inferStart = performance.now()
    let action = null
    try {
        action = await controller.value.predict(obs)
        debugInfo.value.lastError = null
    } catch (e) {
        debugInfo.value.lastError = `Inference error: ${e.message}`
        console.error('[DEBUG] Inference error:', e)
        return
    }
    stats.value.inferenceTime = performance.now() - inferStart

    if (action) {
        debugInfo.value.actionShape = action.length
        debugInfo.value.actionValues = action.map(v => v.toFixed(3))
        stats.value.action = action.slice(0, 4)
        
        // Log every 60 frames (about once per second)
        if (frameCount === 1) {
            console.log('[DEBUG] Obs:', obs)
            console.log('[DEBUG] Action:', action)
        }
        
        // 3. Move end effector TOWARD TARGET (original working logic)
        // The blue ball follows the red ball using simple direction-based movement
        const moveSpeed = 0.8 * delta
        const direction = new THREE.Vector3()
            .subVectors(targetPos.value, endEffectorPos.value)
        
        const distance = direction.length()
        if (distance > 0.01) {
            direction.normalize()
            endEffectorPos.value.add(direction.multiplyScalar(Math.min(moveSpeed, distance)))
        }
        
        // Update stats
        // Update stats
        stats.value.distance = distance
        stats.value.value = Math.max(0, 1 - distance * 2)
        stats.value.velocity = moveSpeed / delta
        
        // 4. Animate Panda arm using CCD (Cyclic Coordinate Descent) IK
        if (robotModel.value) {
            const jointNames = ['panda_link1', 'panda_link2', 'panda_link3', 'panda_link4', 'panda_link5', 'panda_link6', 'panda_link7']
            // 注意：移除 panda_hand，因为它通常是固定的末端，不参与旋转求解，或者视具体模型结构而定。
            // 如果你的模型 panda_hand 是最后一个可旋转关节，则保留。但在 Franka 中 link7 是最后一个旋转关节。
            
            const joints = jointNames.map(name => robotModel.value.getObjectByName(name)).filter(j => j)
            
            // 如果找不到关节，直接返回
            if (joints.length === 0) return

            // 获取末端执行器（通常是最后一个 Link 的子级或者就是最后一个 Link）
            // 为了更精确，建议获取 panda_hand 作为末端追踪点
            const endEffector = robotModel.value.getObjectByName('panda_hand') || joints[joints.length - 1]
            
            const targetWorld = endEffectorPos.value.clone()
            const maxIterations = 5 // 增加迭代次数可以提高精度，但消耗性能
            const threshold = 0.001 // 提高精度阈值
            const q = new THREE.Quaternion()
            const targetVec = new THREE.Vector3()
            const effectorVec = new THREE.Vector3()
            const axis = new THREE.Vector3()
            
            // CCD 核心循环
            for (let iter = 0; iter < maxIterations; iter++) {
                // 检查是否已经到达目标
                const currentEEPos = new THREE.Vector3()
                endEffector.getWorldPosition(currentEEPos)
                if (currentEEPos.distanceTo(targetWorld) < threshold) break

                // 从末端往基座反向遍历关节
                for (let i = joints.length - 1; i >= 0; i--) {
                    const joint = joints[i]
                    
                    // 关键修正 1：URDF 导出的关节，旋转轴通常永远是局部的 Z 轴 (0, 0, 1)
                    // 不需要手动猜测它是 X 还是 Y，yourdfpy 已经处理了父子变换，使得 Z 轴成为旋转轴
                    const rotateAxisLocal = new THREE.Vector3(0, 0, 1)
                    
                    // 关键修正 2：将局部的 Z 轴转换为世界坐标系的轴向量
                    // 这样无论父级怎么旋转，我们都能得到当前关节在世界空间中真实的旋转轴指向
                    joint.getWorldQuaternion(q)
                    axis.copy(rotateAxisLocal).applyQuaternion(q).normalize()
                    
                    // 获取关节和末端的世界位置
                    const jointWorldPos = new THREE.Vector3()
                    joint.getWorldPosition(jointWorldPos)
                    endEffector.getWorldPosition(currentEEPos)
                    
                    // 构建向量：关节->末端，关节->目标
                    effectorVec.subVectors(currentEEPos, jointWorldPos)
                    targetVec.subVectors(targetWorld, jointWorldPos)
                    
                    // 投影到旋转平面（去掉轴向分量）
                    // 这一步是为了计算"绕着轴需要转多少度"
                    // 投影公式: v_proj = v - (v . axis) * axis
                    const effectorProj = effectorVec.clone().sub(axis.clone().multiplyScalar(effectorVec.dot(axis))).normalize()
                    const targetProj = targetVec.clone().sub(axis.clone().multiplyScalar(targetVec.dot(axis))).normalize()
                    
                    // 计算旋转角度
                    let angle = Math.acos(Math.max(-1, Math.min(1, effectorProj.dot(targetProj))))
                    
                    // 判断旋转方向 (叉乘)
                    // 如果 (effector x target) 的方向与旋转轴方向一致，则为正，否则为负
                    const cross = new THREE.Vector3().crossVectors(effectorProj, targetProj)
                    if (cross.dot(axis) < 0) angle = -angle
                    
                    // 限制单步旋转幅度，防止鬼畜（Damping）
                    const maxStep = 0.2 // 弧度
                    if (Math.abs(angle) > maxStep) {
                        angle = maxStep * Math.sign(angle)
                    }
                    
                    // 关键修正 3：只更新 rotation.z
                    // 因为我们定义了局部旋转轴是 Z，所以只动 Z 分量
                    if (Math.abs(angle) > 0.0001) {
                        joint.rotation.z += angle
                        
                        // 可选：在这里添加关节角度限制 (Joint Limits)
                        // 例如 Franka 的某些关节限制是 -2.89 到 2.89
                        // joint.rotation.z = Math.max(-2.89, Math.min(2.89, joint.rotation.z))
                        
                        // 立即更新矩阵，以便下一次循环（或同一个循环的下一个关节）能拿到最新的世界坐标
                        joint.updateMatrixWorld(true)
                    }
                }
            }
        }
    }
})

// --- Controls ---
const togglePlay = () => { isPlaying.value = !isPlaying.value }

const resetScene = () => {
    targetPos.value = new THREE.Vector3(0.4, 0.3, 0.4)
    endEffectorPos.value = new THREE.Vector3(0, 0.5, 0)
    stats.value = { distance: 0, velocity: 0, action: [0, 0, 0, 0], value: 0, fps: 0, inferenceTime: 0 }
}

const randomTarget = () => {
    targetPos.value = new THREE.Vector3(
        (Math.random() - 0.5) * 0.8, // X: -0.4 to 0.4
        0.2 + Math.random() * 0.5,   // Y: 0.2 to 0.7
        (Math.random() - 0.5) * 0.8  // Z: -0.4 to 0.4
    )
}

// --- LLM Interface Handlers ---
const handleExplain = async () => {
    showExplainModal.value = true
    llmResponse.value = '正在分析...'
    
    const response = await explainAction({
        state: {
            distance: stats.value.distance,
            velocity: stats.value.velocity,
            jointAngles: [0, 0, 0, 0, 0, 0, 0] // Placeholder
        },
        action: stats.value.action,
        value: stats.value.value,
        question: userQuestion.value
    })
    llmResponse.value = response
}

const handleRewardDesign = async () => {
    showRewardModal.value = true
    llmResponse.value = '正在生成...'
    
    const response = await designReward({
        userFeedback: userFeedback.value
    })
    llmResponse.value = response.message + '\n\n```python\n' + response.suggestedCode + '\n```'
}

// --- Target Drag Handler ---
const onTargetDrag = (event) => {
    if (event.target?.position) {
        targetPos.value.copy(event.target.position)
    }
}
</script>

<template>
  <div class="sim2web-container">
    <!-- Left Panel: RL State Monitor -->
    <div class="panel left-panel">
      <div class="panel-section">
        <h4 class="section-title">RL 状态监控</h4>
        
        <!-- Core RL Metrics -->
        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-label">目标距离</span>
            <span class="metric-value" :style="{ color: targetColor }">{{ stats.distance.toFixed(3) }} m</span>
          </div>
          <div class="metric-hint">末端执行器到目标点的欧氏距离，是奖励函数的核心依据</div>
        </div>
        
        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-label">末端速度</span>
            <span class="metric-value">{{ stats.velocity.toFixed(3) }} m/s</span>
          </div>
          <div class="metric-hint">末端执行器的移动速度，影响动作平滑度</div>
        </div>
        
        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-label">价值估计 V(s)</span>
            <span class="metric-value highlight">{{ stats.value.toFixed(3) }}</span>
          </div>
          <div class="metric-hint">Critic 网络对当前状态的评分，越高表示距目标越近</div>
        </div>
        
        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-label">策略输出 π(s)</span>
          </div>
          <div class="metric-array">[{{ stats.action.map(a => a.toFixed(2)).join(', ') }}]</div>
          <div class="metric-hint">Actor 网络输出的关节角速度指令 (rad/s)</div>
        </div>
      </div>

      <div class="panel-divider"></div>

      <!-- Performance Metrics -->
      <div class="panel-section">
        <h4 class="section-title">性能指标</h4>
        <div class="metric-row">
          <span class="metric-label-sm">渲染帧率</span>
          <span class="metric-value-sm">{{ stats.fps }} FPS</span>
        </div>
        <div class="metric-row">
          <span class="metric-label-sm">推理耗时</span>
          <span class="metric-value-sm">{{ stats.inferenceTime.toFixed(1) }} ms</span>
        </div>
      </div>

      <div class="panel-divider"></div>

      <!-- Debug Panel (Collapsible) -->
      <div class="panel-section">
        <button class="toggle-btn" @click="showDebug = !showDebug">
          {{ showDebug ? '收起调试面板 ▲' : '展开调试面板 ▼' }}
        </button>
        
        <div v-if="showDebug" class="debug-panel">
          <div class="debug-card">
            <div class="debug-header">
              <span class="debug-label">ONNX 会话</span>
              <span :class="['debug-status', debugInfo.sessionReady ? 'status-ok' : 'status-err']">
                {{ debugInfo.sessionReady ? '就绪' : '未就绪' }}
              </span>
            </div>
            <div class="debug-hint">ONNX Runtime Web 推理引擎状态</div>
          </div>
          
          <div class="debug-card" v-if="debugInfo.lastError">
            <div class="debug-header">
              <span class="debug-label">错误信息</span>
            </div>
            <div class="debug-error">{{ debugInfo.lastError }}</div>
          </div>
          
          <div class="debug-card">
            <div class="debug-header">
              <span class="debug-label">观测向量维度</span>
              <span class="debug-value">{{ debugInfo.obsShape }}</span>
            </div>
            <div class="debug-hint">arm_pos(3) + arm_vel(3) + achieved(3) + desired(3) = 12</div>
          </div>
          
          <div class="debug-card">
            <div class="debug-header">
              <span class="debug-label">动作向量维度</span>
              <span class="debug-value">{{ debugInfo.actionShape }}</span>
            </div>
            <div class="debug-hint">Panda 机械臂 7 个旋转关节的角速度</div>
          </div>
          
          <div class="debug-card">
            <div class="debug-header">
              <span class="debug-label">识别关节数</span>
              <span class="debug-value">{{ debugInfo.jointNames.length }}</span>
            </div>
            <div class="debug-hint">从 GLB 模型中解析的可控关节</div>
          </div>
          
          <div class="debug-card">
            <div class="debug-header">
              <span class="debug-label">完整观测 s</span>
            </div>
            <div class="debug-array">{{ debugInfo.obsValues.join(', ') }}</div>
            <div class="debug-hint">当前时刻的完整状态向量</div>
          </div>
          
          <div class="debug-card">
            <div class="debug-header">
              <span class="debug-label">完整动作 a</span>
            </div>
            <div class="debug-array">{{ debugInfo.actionValues.join(', ') }}</div>
            <div class="debug-hint">策略网络输出的完整动作向量</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 3D Scene -->
    <div class="scene-wrapper">
      <TresCanvas clear-color="#1a1a2e" shadows alpha>
        <TresPerspectiveCamera :position="[1.5, 1.5, 1.5]" :look-at="[0, 0.3, 0]" />
        <OrbitControls :enable-damping="true" />
        
        <TresAmbientLight :intensity="0.4" />
        <TresDirectionalLight :position="[2, 4, 3]" :intensity="1.2" cast-shadow />
        <TresPointLight :position="[-1, 2, -1]" :intensity="0.5" color="#4fc3f7" />
        
        <!-- Robot Model -->
        <primitive 
          :object="robotModel" 
          v-if="robotModel" 
          :position="[0, 0, 0]" 
          :rotation="[-Math.PI / 2, 0, 0]" 
        />
        
        <!-- Target Sphere (Draggable) -->
        <TresMesh 
          ref="targetMesh"
          :position="[targetPos.x, targetPos.y, targetPos.z]"
        >
          <TresSphereGeometry :args="[0.04, 32, 32]" />
          <TresMeshStandardMaterial :color="targetColor" :emissive="targetColor" :emissive-intensity="0.3" />
        </TresMesh>
        
        <!-- End Effector Indicator -->
        <TresMesh :position="[endEffectorPos.x, endEffectorPos.y, endEffectorPos.z]">
          <TresSphereGeometry :args="[0.025, 16, 16]" />
          <TresMeshStandardMaterial color="#60a5fa" :emissive="'#3b82f6'" :emissive-intensity="0.5" />
        </TresMesh>
        
        <!-- Connection Line -->
        <TresLine2 v-if="false">
          <!-- TODO: Draw dashed line between end effector and target -->
        </TresLine2>
        
        <!-- Ground Grid -->
        <TresGridHelper :args="[2, 20, '#444', '#333']" />
        <TresMesh :position="[0, -0.01, 0]" :rotation="[-Math.PI / 2, 0, 0]" receive-shadow>
          <TresPlaneGeometry :args="[2, 2]" />
          <TresMeshStandardMaterial color="#1a1a2e" :opacity="0.8" transparent />
        </TresMesh>
      </TresCanvas>
      
      <!-- Scene Legend -->
      <div class="scene-legend">
        <div class="legend-item">
          <span class="legend-dot" style="background: #ef4444;"></span>
          <span>目标位置 (可拖拽)</span>
        </div>
        <div class="legend-item">
          <span class="legend-dot" style="background: #60a5fa;"></span>
          <span>末端执行器</span>
        </div>
      </div>
    </div>

    <!-- Right Panel: Controls -->
    <div class="panel right-panel">
      <!-- Playback Controls -->
      <div class="panel-section">
        <h4 class="section-title">控制</h4>
        
        <button class="btn btn-primary" @click="togglePlay">
          {{ isPlaying ? '暂停' : '播放' }}
        </button>
        <button class="btn btn-secondary" @click="resetScene">
          重置
        </button>
        <button class="btn btn-secondary" @click="randomTarget">
          随机目标
        </button>
      </div>

      <div class="panel-divider"></div>

      <!-- Target Position Control -->
      <div class="panel-section">
        <h4 class="section-title">目标位置</h4>
        <div class="slider-group">
          <div class="slider-row">
            <label>X: {{ targetPos.x.toFixed(2) }}</label>
            <input type="range" min="-0.5" max="0.5" step="0.01" :value="targetPos.x" 
              @input="targetPos.x = parseFloat($event.target.value)" />
          </div>
          <div class="slider-row">
            <label>Y: {{ targetPos.y.toFixed(2) }}</label>
            <input type="range" min="0" max="0.8" step="0.01" :value="targetPos.y" 
              @input="targetPos.y = parseFloat($event.target.value)" />
          </div>
          <div class="slider-row">
            <label>Z: {{ targetPos.z.toFixed(2) }}</label>
            <input type="range" min="-0.5" max="0.5" step="0.01" :value="targetPos.z" 
              @input="targetPos.z = parseFloat($event.target.value)" />
          </div>
        </div>
        <div class="control-hint">调整目标点在 3D 空间中的坐标</div>
      </div>

      <div class="panel-divider"></div>

      <!-- LLM Interface -->
      <div class="panel-section">
        <h4 class="section-title">LLM 接口</h4>
        
        <button class="btn btn-llm" @click="handleExplain">
          问：为什么？
        </button>
        <button class="btn btn-llm" @click="handleRewardDesign">
          设计奖励
        </button>
        <div class="control-hint">使用 LLM 解释策略行为或设计奖励函数</div>
      </div>
    </div>

    <!-- LLM Explain Modal -->
    <div class="modal-overlay" v-if="showExplainModal" @click.self="showExplainModal = false">
      <div class="modal">
        <h3>策略解释 (XAI)</h3>
        <div class="modal-input">
          <label>你的问题：</label>
          <input v-model="userQuestion" type="text" />
        </div>
        <div class="modal-content">
          <pre>{{ llmResponse }}</pre>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" @click="handleExplain">重新提问</button>
          <button class="btn btn-secondary" @click="showExplainModal = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- LLM Reward Modal -->
    <div class="modal-overlay" v-if="showRewardModal" @click.self="showRewardModal = false">
      <div class="modal modal-wide">
        <h3>奖励函数设计</h3>
        <div class="modal-input">
          <label>你的反馈：</label>
          <input v-model="userFeedback" type="text" />
        </div>
        <div class="modal-content">
          <pre>{{ llmResponse }}</pre>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" @click="handleRewardDesign">重新生成</button>
          <button class="btn btn-secondary" @click="showRewardModal = false">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ===== Base Container ===== */
.sim2web-container {
  display: flex;
  width: 100%;
  max-width: 1600px;
  height: 80vh;
  min-height: 600px;
  margin: 0 auto;
  background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%);
  border-radius: 12px;
  overflow: hidden;
  font-family: var(--vp-font-family-base, 'Inter', system-ui, sans-serif);
  color: #e0e0e0;
  box-shadow: 0 20px 50px rgba(0,0,0,0.5);
  border: 1px solid rgba(255,255,255,0.1);
}

/* ===== Panels ===== */
.panel {
  width: 280px;
  padding: 20px;
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}

.left-panel {
  border-right: none;
  border-radius: 12px 0 0 12px;
}

.right-panel {
  border-left: none;
  border-radius: 0 12px 12px 0;
  width: 240px;
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #a0aec0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.panel-divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
  margin: 12px 0;
}

/* ===== Metric Cards ===== */
.metric-card {
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.metric-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.metric-label {
  font-size: 13px;
  font-weight: 500;
  color: #cbd5e0;
}

.metric-value {
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  font-family: var(--vp-font-family-mono, 'JetBrains Mono', monospace);
}

.metric-value.highlight {
  color: #68d391;
}

.metric-array {
  font-size: 12px;
  font-family: var(--vp-font-family-mono, 'JetBrains Mono', monospace);
  color: #90cdf4;
  background: rgba(0, 0, 0, 0.3);
  padding: 6px 8px;
  border-radius: 4px;
  margin: 4px 0;
  word-break: break-all;
}

.metric-hint {
  font-size: 11px;
  color: #718096;
  line-height: 1.4;
  margin-top: 4px;
}

/* ===== Performance Metrics ===== */
.metric-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
}

.metric-label-sm {
  font-size: 12px;
  color: #a0aec0;
}

.metric-value-sm {
  font-size: 13px;
  font-weight: 500;
  color: #e2e8f0;
  font-family: var(--vp-font-family-mono, 'JetBrains Mono', monospace);
}

/* ===== Debug Panel ===== */
.toggle-btn {
  width: 100%;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 500;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #a0aec0;
  cursor: pointer;
  transition: all 0.2s ease;
}

.toggle-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #e2e8f0;
}

.debug-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.debug-card {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 6px;
  padding: 10px;
  border-left: 3px solid rgba(255, 255, 255, 0.1);
}

.debug-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2px;
}

.debug-label {
  font-size: 12px;
  font-weight: 500;
  color: #e2e8f0;
}

.debug-value {
  font-size: 12px;
  font-weight: 600;
  color: #90cdf4;
  font-family: var(--vp-font-family-mono, 'JetBrains Mono', monospace);
}

.debug-status {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
}

.status-ok {
  background: rgba(72, 187, 120, 0.2);
  color: #68d391;
}

.status-err {
  background: rgba(245, 101, 101, 0.2);
  color: #fc8181;
}

.debug-error {
  font-size: 11px;
  color: #fc8181;
  font-family: var(--vp-font-family-mono, 'JetBrains Mono', monospace);
  word-break: break-all;
}

.debug-array {
  font-size: 11px;
  font-family: var(--vp-font-family-mono, 'JetBrains Mono', monospace);
  color: #b794f4;
  background: rgba(0, 0, 0, 0.2);
  padding: 6px 8px;
  border-radius: 4px;
  margin: 4px 0;
  word-break: break-all;
  line-height: 1.5;
}

.debug-hint {
  font-size: 10px;
  color: #718096;
  line-height: 1.4;
  margin-top: 4px;
}

/* ===== Scene Wrapper ===== */
.scene-wrapper {
  flex: 1;
  position: relative;
}

.scene-legend {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 20px;
  background: rgba(0, 0, 0, 0.6);
  padding: 10px 20px;
  border-radius: 20px;
  pointer-events: none;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #a0aec0;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

/* ===== Buttons ===== */
.btn {
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  width: 100%;
}

.btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.1);
  color: #e0e0e0;
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.15);
}

.btn-llm {
  background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
  color: white;
}

.btn-llm:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(56, 239, 125, 0.3);
}

/* ===== Sliders ===== */
.slider-group {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  padding: 12px;
}

.slider-row {
  margin-bottom: 10px;
}

.slider-row:last-child {
  margin-bottom: 0;
}

.slider-row label {
  display: block;
  font-size: 12px;
  color: #a0aec0;
  margin-bottom: 6px;
  font-family: var(--vp-font-family-mono, 'JetBrains Mono', monospace);
}

.slider-row input[type="range"] {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.15);
}

.slider-row input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #667eea;
  cursor: pointer;
  border: 2px solid #fff;
}

.control-hint {
  font-size: 11px;
  color: #718096;
  line-height: 1.4;
  margin-top: 8px;
}

/* ===== Modal ===== */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: #1a1a2e;
  border-radius: 16px;
  padding: 24px;
  width: 400px;
  max-height: 80vh;
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.modal-wide {
  width: 600px;
}

.modal h3 {
  margin: 0 0 16px 0;
  color: #fff;
  font-size: 18px;
  font-weight: 600;
}

.modal-input {
  margin-bottom: 16px;
}

.modal-input label {
  display: block;
  margin-bottom: 6px;
  color: #a0aec0;
  font-size: 13px;
}

.modal-input input {
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  font-size: 14px;
}

.modal-content {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
  max-height: 300px;
  overflow-y: auto;
}

.modal-content pre {
  margin: 0;
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 1.6;
  color: #e2e8f0;
  font-family: var(--vp-font-family-base, system-ui, sans-serif);
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.modal-actions .btn {
  width: auto;
  padding: 8px 16px;
}
</style>
