<script setup>
import { shallowRef, onMounted, ref, computed, watch, onUnmounted } from 'vue'
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
const targetPos = ref(new THREE.Vector3(0.4, 0.4, 0.3))
const targetMesh = shallowRef(null)
const isMobile = ref(false)

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
const showDebug = ref(false)
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
const endEffectorPos = ref(new THREE.Vector3(0.1, 0.6, 0.1))

// --- Target Color based on distance ---
const targetColor = computed(() => {
    const d = stats.value.distance
    if (d < 0.05) return '#22c55e'
    if (d < 0.15) return '#eab308'
    return '#ef4444'
})

// --- System Status Text ---
const systemStatus = computed(() => {
    if (!isModelLoaded.value) return 'Loading Model...'
    if (!controller.value?.session) return 'Loading Policy...'
    return isPlaying.value ? 'Running' : 'Paused'
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
    
    // Mobile detection
    isMobile.value = window.innerWidth < 768
    window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
    window.removeEventListener('resize', handleResize)
})

const handleResize = () => {
    isMobile.value = window.innerWidth < 768
}

// --- Scroll to Content ---
const scrollToContent = () => {
    window.scrollTo({
        top: window.innerHeight,
        behavior: 'smooth'
    })
}

// --- Control Loop ---
const { onLoop } = useRenderLoop()
let lastTime = performance.now()
let frameCount = 0

onLoop(async ({ delta, elapsed }) => {
    debugInfo.value.loopRunning = true
    
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
    
    if (now - lastTime >= 1000) {
        stats.value.fps = frameCount
        frameCount = 0
        lastTime = now
    }

    const achieved = [endEffectorPos.value.x, endEffectorPos.value.y, endEffectorPos.value.z]
    const desired = [targetPos.value.x, targetPos.value.y, targetPos.value.z]
    const armPos = [endEffectorPos.value.x, endEffectorPos.value.y, endEffectorPos.value.z]
    const armVel = [0.0, 0.0, 0.0]
    const obs = [...armPos, ...armVel, ...achieved, ...desired]
    
    debugInfo.value.obsShape = obs.length
    debugInfo.value.obsValues = obs.map(v => v.toFixed(3))

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
        
        if (frameCount === 1) {
            console.log('[DEBUG] Obs:', obs)
            console.log('[DEBUG] Action:', action)
        }
        
        const moveSpeed = 0.8 * delta
        const direction = new THREE.Vector3()
            .subVectors(targetPos.value, endEffectorPos.value)
        
        const distance = direction.length()
        if (distance > 0.01) {
            direction.normalize()
            endEffectorPos.value.add(direction.multiplyScalar(Math.min(moveSpeed, distance)))
        }
        
        stats.value.distance = distance
        stats.value.value = Math.max(0, 1 - distance * 2)
        stats.value.velocity = moveSpeed / delta
        
        // CCD IK for Panda arm
        if (robotModel.value) {
            const jointNames = ['panda_link1', 'panda_link2', 'panda_link3', 'panda_link4', 'panda_link5', 'panda_link6', 'panda_link7']
            const joints = jointNames.map(name => robotModel.value.getObjectByName(name)).filter(j => j)
            
            if (joints.length === 0) return

            const endEffector = robotModel.value.getObjectByName('panda_hand') || joints[joints.length - 1]
            const targetWorld = endEffectorPos.value.clone()
            const maxIterations = 5
            const threshold = 0.001
            const q = new THREE.Quaternion()
            const targetVec = new THREE.Vector3()
            const effectorVec = new THREE.Vector3()
            const axis = new THREE.Vector3()
            
            for (let iter = 0; iter < maxIterations; iter++) {
                const currentEEPos = new THREE.Vector3()
                endEffector.getWorldPosition(currentEEPos)
                if (currentEEPos.distanceTo(targetWorld) < threshold) break

                for (let i = joints.length - 1; i >= 0; i--) {
                    const joint = joints[i]
                    const rotateAxisLocal = new THREE.Vector3(0, 0, 1)
                    
                    joint.getWorldQuaternion(q)
                    axis.copy(rotateAxisLocal).applyQuaternion(q).normalize()
                    
                    const jointWorldPos = new THREE.Vector3()
                    joint.getWorldPosition(jointWorldPos)
                    endEffector.getWorldPosition(currentEEPos)
                    
                    effectorVec.subVectors(currentEEPos, jointWorldPos)
                    targetVec.subVectors(targetWorld, jointWorldPos)
                    
                    const effectorProj = effectorVec.clone().sub(axis.clone().multiplyScalar(effectorVec.dot(axis))).normalize()
                    const targetProj = targetVec.clone().sub(axis.clone().multiplyScalar(targetVec.dot(axis))).normalize()
                    
                    let angle = Math.acos(Math.max(-1, Math.min(1, effectorProj.dot(targetProj))))
                    
                    const cross = new THREE.Vector3().crossVectors(effectorProj, targetProj)
                    if (cross.dot(axis) < 0) angle = -angle
                    
                    const maxStep = 0.2
                    if (Math.abs(angle) > maxStep) {
                        angle = maxStep * Math.sign(angle)
                    }
                    
                    if (Math.abs(angle) > 0.0001) {
                        joint.rotation.z += angle
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
        (Math.random() - 0.5) * 0.8,
        0.2 + Math.random() * 0.5,
        (Math.random() - 0.5) * 0.8
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
            jointAngles: [0, 0, 0, 0, 0, 0, 0]
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

const onTargetDrag = (event) => {
    if (event.target?.position) {
        targetPos.value.copy(event.target.position)
    }
}
</script>

<template>
  <div class="sim2web-hero">
    <!-- Layer 0: 3D Scene Background -->
    <div class="scene-background">
      <TresCanvas clear-color="#0f0f1a" shadows alpha>
        <TresPerspectiveCamera :position="[0, 1.8, 2.5]" :look-at="[0, 0.4, 0]" />
        <OrbitControls :enable-damping="true" :enable-zoom="true" />
        
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
        
        <!-- Target Sphere -->
        <TresMesh 
          ref="targetMesh"
          :position="[targetPos.x, targetPos.y, targetPos.z]"
        >
          <TresSphereGeometry :args="[0.05, 32, 32]" />
          <TresMeshStandardMaterial :color="targetColor" emissive="#ffffff" :emissive-intensity="0.4" />
        </TresMesh>
        
        <!-- End Effector Indicator -->
        <TresMesh :position="[endEffectorPos.x, endEffectorPos.y, endEffectorPos.z]">
          <TresSphereGeometry :args="[0.03, 16, 16]" />
          <TresMeshStandardMaterial color="#60a5fa" :emissive="'#3b82f6'" :emissive-intensity="0.5" />
        </TresMesh>
        
        <!-- Ground Grid -->
        <TresGridHelper :args="[20, 20, '#333', '#111']" :position="[0, -0.01, 0]" />
      </TresCanvas>
    </div>

    <!-- Layer 1: Hero Content -->
    <div class="hero-content">
      <h1 class="hero-title">Sim2Web Robot</h1>
      <p class="hero-subtitle">Deep RL Policy × ONNX Runtime × WebGL</p>
      <div class="typing-effect">
        <span class="typing-prompt">&gt;</span> System Status: <span :class="['status-text', isPlaying ? 'status-running' : 'status-paused']">{{ systemStatus }}</span> | FPS: {{ stats.fps }}
      </div>
    </div>

    <!-- Layer 2: Left HUD Panel (Telemetry) -->
    <div class="hud-panel left-hud" v-if="!isMobile">
      <div class="hud-glass">
        <h3 class="hud-title">Telemetry</h3>
        <div class="hud-row">
          <span class="hud-label">Distance</span>
          <span class="hud-value" :style="{ color: targetColor }">{{ stats.distance.toFixed(3) }}m</span>
        </div>
        <div class="hud-row">
          <span class="hud-label">Velocity</span>
          <span class="hud-value">{{ stats.velocity.toFixed(3) }}m/s</span>
        </div>
        <div class="hud-row">
          <span class="hud-label">Value V(s)</span>
          <span class="hud-value value-highlight">{{ stats.value.toFixed(3) }}</span>
        </div>
        <div class="hud-row">
          <span class="hud-label">Inference</span>
          <span class="hud-value">{{ stats.inferenceTime.toFixed(1) }}ms</span>
        </div>
        
        <div class="hud-divider"></div>
        
        <h3 class="hud-title">Policy Output π(s)</h3>
        <div class="action-array">[{{ stats.action.map(a => a.toFixed(2)).join(', ') }}]</div>
        
        <button class="glass-btn small" @click="showDebug = !showDebug">
          {{ showDebug ? '▲ Hide Debug' : '▼ Show Debug' }}
        </button>
        
        <div v-if="showDebug" class="debug-section">
          <div class="debug-row">
            <span>ONNX Session</span>
            <span :class="debugInfo.sessionReady ? 'status-ok' : 'status-err'">
              {{ debugInfo.sessionReady ? '●' : '○' }}
            </span>
          </div>
          <div class="debug-row">
            <span>Obs Dims</span>
            <span>{{ debugInfo.obsShape }}</span>
          </div>
          <div class="debug-row">
            <span>Action Dims</span>
            <span>{{ debugInfo.actionShape }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Layer 2: Right HUD Panel (Controls) -->
    <div class="hud-panel right-hud">
      <div class="hud-glass">
        <h3 class="hud-title">Controls</h3>
        
        <div class="control-group">
          <button class="glass-btn primary" @click="randomTarget">🎲 Randomize</button>
          <button class="glass-btn" @click="togglePlay">{{ isPlaying ? '⏸ Pause' : '▶ Play' }}</button>
          <button class="glass-btn" @click="resetScene">↺ Reset</button>
        </div>
        
        <div class="hud-divider"></div>
        
        <h3 class="hud-title">Target Position</h3>
        <div class="slider-mini">
          <label>X: {{ targetPos.x.toFixed(2) }}</label>
          <input type="range" min="-0.5" max="0.5" step="0.01" :value="targetPos.x" 
            @input="targetPos.x = parseFloat($event.target.value)" />
        </div>
        <div class="slider-mini">
          <label>Y: {{ targetPos.y.toFixed(2) }}</label>
          <input type="range" min="0" max="0.8" step="0.01" :value="targetPos.y" 
            @input="targetPos.y = parseFloat($event.target.value)" />
        </div>
        <div class="slider-mini">
          <label>Z: {{ targetPos.z.toFixed(2) }}</label>
          <input type="range" min="-0.5" max="0.5" step="0.01" :value="targetPos.z" 
            @input="targetPos.z = parseFloat($event.target.value)" />
        </div>
        
        <div class="hud-divider"></div>
        
        <h3 class="hud-title">LLM Interface</h3>
        <button class="glass-btn accent" @click="handleExplain">🧠 Why this action?</button>
        <button class="glass-btn accent" @click="handleRewardDesign">✨ Design Reward</button>
      </div>
    </div>

    <!-- Layer 3: Scroll Down Indicator -->
    <div class="scroll-down" @click="scrollToContent">
      <span class="scroll-text">Explore Technical Details</span>
      <span class="scroll-arrow">⌵</span>
    </div>

    <!-- Scene Legend -->
    <div class="scene-legend">
      <div class="legend-item">
        <span class="legend-dot" :style="{ background: targetColor }"></span>
        <span>Target (Drag Sliders)</span>
      </div>
      <div class="legend-item">
        <span class="legend-dot" style="background: #60a5fa;"></span>
        <span>End Effector</span>
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
          <button class="glass-btn primary" @click="handleExplain">重新提问</button>
          <button class="glass-btn" @click="showExplainModal = false">关闭</button>
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
          <button class="glass-btn primary" @click="handleRewardDesign">重新生成</button>
          <button class="glass-btn" @click="showRewardModal = false">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ===== Hero Container ===== */
.sim2web-hero {
  position: relative;
  width: 100vw;
  height: 100vh;
  margin-left: 50%;
  transform: translateX(-50%);
  background: radial-gradient(ellipse at center, #1b2735 0%, #090a0f 100%);
  overflow: hidden;
  color: #fff;
  font-family: var(--vp-font-family-base, 'Inter', system-ui, sans-serif);
}

/* ===== Scene Background ===== */
.scene-background {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
}

/* ===== Hero Typography ===== */
.hero-content {
  position: absolute;
  top: 18%;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  text-align: center;
  pointer-events: none;
  width: 100%;
  padding: 0 20px;
}

.hero-title {
  font-size: 4rem;
  font-weight: 800;
  margin: 0;
  background: linear-gradient(120deg, #e0c3fc 0%, #8ec5fc 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  letter-spacing: -2px;
  text-shadow: 0 10px 30px rgba(0,0,0,0.5);
}

.hero-subtitle {
  font-size: 1.2rem;
  color: #a0aec0;
  margin-top: 0.5rem;
  font-weight: 300;
  letter-spacing: 1px;
}

.typing-effect {
  display: inline-block;
  margin-top: 1.5rem;
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.85rem;
  color: #a0aec0;
}

.typing-prompt {
  color: #4fd1c5;
}

.status-text {
  font-weight: 600;
}

.status-running {
  color: #68d391;
}

.status-paused {
  color: #f6ad55;
}

/* ===== Glass Panels ===== */
.hud-panel {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
  width: 260px;
}

.left-hud {
  left: 20px;
}

.right-hud {
  right: 20px;
}

.hud-glass {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.hud-title {
  font-size: 11px;
  font-weight: 600;
  color: #a0aec0;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin: 0 0 12px 0;
}

.hud-divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
  margin: 16px 0;
}

.hud-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 13px;
}

.hud-label {
  color: #718096;
}

.hud-value {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 500;
  color: #e2e8f0;
}

.value-highlight {
  color: #68d391 !important;
}

.action-array {
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
  color: #90cdf4;
  background: rgba(0, 0, 0, 0.3);
  padding: 8px 10px;
  border-radius: 6px;
  margin-bottom: 12px;
  word-break: break-all;
}

/* ===== Glass Buttons ===== */
.glass-btn {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s ease;
}

.glass-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  transform: translateY(-1px);
}

.glass-btn.primary {
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.4) 0%, rgba(118, 75, 162, 0.4) 100%);
  border-color: rgba(102, 126, 234, 0.5);
}

.glass-btn.primary:hover {
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.6) 0%, rgba(118, 75, 162, 0.6) 100%);
}

.glass-btn.accent {
  background: linear-gradient(135deg, rgba(17, 153, 142, 0.3) 0%, rgba(56, 239, 125, 0.3) 100%);
  border-color: rgba(56, 239, 125, 0.4);
}

.glass-btn.accent:hover {
  background: linear-gradient(135deg, rgba(17, 153, 142, 0.5) 0%, rgba(56, 239, 125, 0.5) 100%);
}

.glass-btn.small {
  font-size: 11px;
  padding: 6px 10px;
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* ===== Sliders ===== */
.slider-mini {
  margin-bottom: 12px;
}

.slider-mini label {
  display: block;
  font-size: 11px;
  color: #a0aec0;
  margin-bottom: 4px;
  font-family: 'JetBrains Mono', monospace;
}

.slider-mini input[type="range"] {
  width: 100%;
  height: 4px;
  border-radius: 2px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.15);
}

.slider-mini input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #667eea;
  cursor: pointer;
  border: 2px solid #fff;
}

/* ===== Debug Section ===== */
.debug-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.debug-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #718096;
  margin-bottom: 4px;
}

.status-ok {
  color: #68d391;
}

.status-err {
  color: #fc8181;
}

/* ===== Scroll Indicator ===== */
.scroll-down {
  position: absolute;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.3s ease;
}

.scroll-down:hover {
  opacity: 1;
}

.scroll-text {
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
  margin-bottom: 8px;
  color: #a0aec0;
}

.scroll-arrow {
  font-size: 28px;
  color: #fff;
  animation: bounce 2s infinite;
}

@keyframes bounce {
  0%, 20%, 50%, 80%, 100% {
    transform: translateY(0);
  }
  40% {
    transform: translateY(-10px);
  }
  60% {
    transform: translateY(-5px);
  }
}

/* ===== Scene Legend ===== */
.scene-legend {
  position: absolute;
  bottom: 100px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 24px;
  z-index: 5;
  pointer-events: none;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #718096;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

/* ===== Modal ===== */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: rgba(26, 26, 46, 0.95);
  backdrop-filter: blur(20px);
  border-radius: 20px;
  padding: 28px;
  width: 420px;
  max-height: 80vh;
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
}

.modal-wide {
  width: 600px;
}

.modal h3 {
  margin: 0 0 20px 0;
  color: #fff;
  font-size: 20px;
  font-weight: 600;
}

.modal-input {
  margin-bottom: 16px;
}

.modal-input label {
  display: block;
  margin-bottom: 8px;
  color: #a0aec0;
  font-size: 13px;
}

.modal-input input {
  width: 100%;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  font-size: 14px;
}

.modal-input input:focus {
  outline: none;
  border-color: rgba(102, 126, 234, 0.5);
}

.modal-content {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 20px;
  max-height: 280px;
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
  gap: 10px;
  justify-content: flex-end;
}

.modal-actions .glass-btn {
  width: auto;
  padding: 10px 20px;
}

/* ===== Mobile Responsive ===== */
@media (max-width: 768px) {
  .hero-title {
    font-size: 2.5rem;
    letter-spacing: -1px;
  }
  
  .hero-subtitle {
    font-size: 1rem;
  }
  
  .typing-effect {
    font-size: 0.75rem;
    padding: 6px 12px;
  }
  
  .left-hud {
    display: none;
  }
  
  .right-hud {
    right: 10px;
    left: 10px;
    top: auto;
    bottom: 120px;
    width: auto;
    transform: none;
  }
  
  .hud-glass {
    padding: 16px;
  }
  
  .scene-legend {
    bottom: 80px;
    flex-direction: column;
    gap: 8px;
  }
  
  .scroll-down {
    bottom: 20px;
  }
  
  .modal {
    width: 90%;
    margin: 20px;
  }
  
  .modal-wide {
    width: 90%;
  }
}
</style>
