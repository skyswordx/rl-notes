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
            // Get all joints in the kinematic chain (from base to end effector)
            const jointNames = ['panda_link1', 'panda_link2', 'panda_link3', 'panda_link4', 'panda_link5', 'panda_link6', 'panda_link7', 'panda_hand']
            const joints = jointNames.map(name => robotModel.value.getObjectByName(name)).filter(j => j)
            
            debugInfo.value.jointNames = joints.map(j => j.name)
            
            if (joints.length === 0) return
            
            // Get the end effector (last joint or hand)
            const endEffector = joints[joints.length - 1]
            
            // Target position in world space
            const targetWorld = endEffectorPos.value.clone()
            
            // CCD IK parameters
            const maxIterations = 10
            const threshold = 0.01 // Stop when close enough
            
            // Panda joint rotation axes (from URDF)
            // Joint 1,3,5,7: rotate around local Z
            // Joint 2,4,6: rotate around local Y
            const jointAxes = [
                new THREE.Vector3(0, 0, 1), // link1 - Z
                new THREE.Vector3(0, 1, 0), // link2 - Y
                new THREE.Vector3(0, 0, 1), // link3 - Z
                new THREE.Vector3(0, 1, 0), // link4 - Y
                new THREE.Vector3(0, 0, 1), // link5 - Z
                new THREE.Vector3(0, 1, 0), // link6 - Y
                new THREE.Vector3(0, 0, 1), // link7 - Z
                new THREE.Vector3(0, 0, 1), // hand - Z (optional)
            ]
            
            // CCD Iteration
            for (let iter = 0; iter < maxIterations; iter++) {
                // Get current end effector world position
                const eeWorldPos = new THREE.Vector3()
                endEffector.getWorldPosition(eeWorldPos)
                
                // Check if we're close enough
                const distToTarget = eeWorldPos.distanceTo(targetWorld)
                if (distToTarget < threshold) break
                
                // Iterate through joints from end to base (CCD order)
                for (let i = joints.length - 2; i >= 0; i--) {
                    const joint = joints[i]
                    const axis = jointAxes[i] || new THREE.Vector3(0, 0, 1)
                    
                    // Get joint world position
                    const jointWorldPos = new THREE.Vector3()
                    joint.getWorldPosition(jointWorldPos)
                    
                    // Get current end effector position
                    endEffector.getWorldPosition(eeWorldPos)
                    
                    // Vector from joint to end effector (current)
                    const toEE = new THREE.Vector3().subVectors(eeWorldPos, jointWorldPos)
                    
                    // Vector from joint to target
                    const toTarget = new THREE.Vector3().subVectors(targetWorld, jointWorldPos)
                    
                    // Skip if vectors are too small
                    if (toEE.length() < 0.001 || toTarget.length() < 0.001) continue
                    
                    // Project vectors onto plane perpendicular to rotation axis
                    // Transform axis to world space
                    const worldAxis = axis.clone().applyQuaternion(joint.getWorldQuaternion(new THREE.Quaternion()))
                    
                    // Project toEE and toTarget onto the rotation plane
                    const toEEProj = toEE.clone().sub(worldAxis.clone().multiplyScalar(toEE.dot(worldAxis)))
                    const toTargetProj = toTarget.clone().sub(worldAxis.clone().multiplyScalar(toTarget.dot(worldAxis)))
                    
                    if (toEEProj.length() < 0.001 || toTargetProj.length() < 0.001) continue
                    
                    // Calculate rotation angle
                    toEEProj.normalize()
                    toTargetProj.normalize()
                    
                    let angle = Math.acos(Math.max(-1, Math.min(1, toEEProj.dot(toTargetProj))))
                    
                    // Determine rotation direction using cross product
                    const cross = new THREE.Vector3().crossVectors(toEEProj, toTargetProj)
                    if (cross.dot(worldAxis) < 0) angle = -angle
                    
                    // Limit rotation per step for smooth movement
                    const maxRotation = 0.1 // radians per iteration
                    angle = Math.max(-maxRotation, Math.min(maxRotation, angle))
                    
                    // Apply rotation based on joint axis
                    if (axis.z === 1) {
                        joint.rotation.z += angle
                    } else if (axis.y === 1) {
                        joint.rotation.y += angle
                    } else if (axis.x === 1) {
                        joint.rotation.x += angle
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
    <!-- Left Panel: Stats -->
    <div class="panel stats-panel">
      <h4>📊 状态监控</h4>
      <div class="stat-row">
        <span class="stat-label">🎯 距离</span>
        <span class="stat-value" :style="{ color: targetColor }">{{ stats.distance.toFixed(3) }} m</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">⚡ 速度</span>
        <span class="stat-value">{{ stats.velocity.toFixed(3) }} rad/s</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">🎮 动作</span>
        <span class="stat-value mono">[{{ stats.action.map(a => a.toFixed(2)).join(', ') }}]</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">💎 Value</span>
        <span class="stat-value">{{ stats.value.toFixed(3) }}</span>
      </div>
      <hr />
      <div class="stat-row">
        <span class="stat-label">🖥 FPS</span>
        <span class="stat-value">{{ stats.fps }}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">⏱ 推理</span>
        <span class="stat-value">{{ stats.inferenceTime.toFixed(1) }} ms</span>
      </div>
      
      <!-- Debug Toggle -->
      <hr />
      <button class="btn btn-small" @click="showDebug = !showDebug">
        {{ showDebug ? '🔽 隐藏调试' : '🔼 显示调试' }}
      </button>
      
      <!-- Debug Panel -->
      <div v-if="showDebug" class="debug-section">
        <div class="debug-row">
          <span class="debug-label">Session:</span>
          <span :class="['debug-value', debugInfo.sessionReady ? 'ok' : 'err']">
            {{ debugInfo.sessionReady ? '✅ Ready' : '❌ Not Ready' }}
          </span>
        </div>
        <div class="debug-row">
          <span class="debug-label">Error:</span>
          <span class="debug-value err">{{ debugInfo.lastError || 'None' }}</span>
        </div>
        <div class="debug-row">
          <span class="debug-label">Obs Shape:</span>
          <span class="debug-value">{{ debugInfo.obsShape }}</span>
        </div>
        <div class="debug-row">
          <span class="debug-label">Action Shape:</span>
          <span class="debug-value">{{ debugInfo.actionShape }}</span>
        </div>
        <div class="debug-row">
          <span class="debug-label">Joints Found:</span>
          <span class="debug-value">{{ debugInfo.jointNames.length }}</span>
        </div>
        <div class="debug-row">
          <span class="debug-label">Obs:</span>
          <span class="debug-value mono small">{{ debugInfo.obsValues.join(', ') }}</span>
        </div>
        <div class="debug-row">
          <span class="debug-label">Action:</span>
          <span class="debug-value mono small">{{ debugInfo.actionValues.join(', ') }}</span>
        </div>
      </div>
    </div>

    <!-- Target Control Panel (for X/Y/Z sliders) -->
    <div class="panel target-panel" v-if="showDebug">
      <h4>🎯 目标位置</h4>
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
      
      <!-- Drag Hint -->
      <div class="drag-hint">
        💡 拖拽红色目标球，观察机械臂追踪
      </div>
    </div>

    <!-- Right Panel: Controls -->
    <div class="panel control-panel">
      <h4>🎛 控制</h4>
      
      <button class="btn btn-primary" @click="togglePlay">
        {{ isPlaying ? '⏸ 暂停' : '▶ 播放' }}
      </button>
      <button class="btn btn-secondary" @click="resetScene">
        🔄 重置
      </button>
      <button class="btn btn-secondary" @click="randomTarget">
        🎲 随机目标
      </button>
      
      <hr />
      <h4>🤖 LLM 接口</h4>
      
      <button class="btn btn-llm" @click="handleExplain">
        💬 问：为什么？
      </button>
      <button class="btn btn-llm" @click="handleRewardDesign">
        🛠 设计奖励
      </button>
    </div>

    <!-- LLM Explain Modal -->
    <div class="modal-overlay" v-if="showExplainModal" @click.self="showExplainModal = false">
      <div class="modal">
        <h3>💬 策略解释 (XAI)</h3>
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
        <h3>🛠 奖励函数设计</h3>
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
.sim2web-container {
  display: flex;
  width: 100%;
  height: calc(100vh - 100px); /* Full viewport minus header */
  min-height: 600px;
  background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%);
  border-radius: 12px;
  overflow: hidden;
  font-family: 'Inter', system-ui, sans-serif;
  color: #e0e0e0;
}

.panel {
  width: 200px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.panel h4 {
  margin: 0 0 8px 0;
  font-size: 14px;
  color: #a0a0a0;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.panel hr {
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  margin: 8px 0;
}

.stats-panel {
  border-right: none;
  border-radius: 12px 0 0 12px;
}

.control-panel {
  border-left: none;
  border-radius: 0 12px 12px 0;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.stat-label {
  color: #888;
}

.stat-value {
  font-weight: 600;
  color: #fff;
}

.stat-value.mono {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
}

.scene-wrapper {
  flex: 1;
  position: relative;
}

.drag-hint {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.6);
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 13px;
  color: #a0a0a0;
  pointer-events: none;
}

.btn {
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
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

/* Modal */
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
}

.modal-input {
  margin-bottom: 16px;
}

.modal-input label {
  display: block;
  margin-bottom: 6px;
  color: #a0a0a0;
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
  color: #e0e0e0;
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

/* Debug Panel */
.btn-small {
  padding: 6px 10px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 6px;
  color: #a0a0a0;
  cursor: pointer;
  width: 100%;
}

.btn-small:hover {
  background: rgba(255, 255, 255, 0.15);
}

.debug-section {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
}

.debug-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  margin-bottom: 4px;
}

.debug-label {
  color: #666;
}

.debug-value {
  color: #888;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.debug-value.ok {
  color: #22c55e;
}

.debug-value.err {
  color: #ef4444;
}

.debug-value.mono {
  font-family: 'JetBrains Mono', monospace;
}

.debug-value.small {
  font-size: 9px;
}

/* Target Panel */
.target-panel {
  position: absolute;
  top: 10px;
  left: 220px;
  width: 180px;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(10px);
  border-radius: 8px;
  z-index: 200;
}

.slider-row {
  margin-bottom: 8px;
}

.slider-row label {
  display: block;
  font-size: 12px;
  color: #888;
  margin-bottom: 4px;
}

.slider-row input[type="range"] {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.1);
}

.slider-row input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #667eea;
  cursor: pointer;
}
</style>
