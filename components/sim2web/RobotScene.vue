<script setup>
import { shallowRef, onMounted, ref } from 'vue'
import { TresCanvas, useRenderLoop } from '@tresjs/core'
import { OrbitControls } from '@tresjs/cientos'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { RobotController } from './Controller.js'

// --- State ---
const robotModel = shallowRef(null)
const controller = shallowRef(null)
const isModelLoaded = ref(false)
const targetPos = ref([0.5, 0, 0.5]) // Target position for the robot
const debugMsg = ref("Initializing...")

// --- Config ---
const MODEL_PATH = '/models/panda_arm.glb'
const POLICY_PATH = '/models/robot_policy.onnx'

// --- Load Robot (Manual Loader) ---
const loadRobot = async () => {
    try {
        const loader = new GLTFLoader()
        const gltf = await loader.loadAsync(MODEL_PATH)
        robotModel.value = gltf.scene
        
        // Enable shadows
        robotModel.value.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true
                child.receiveShadow = true
            }
        })
        isModelLoaded.value = true
        debugMsg.value = "Robot loaded."
    } catch (err) {
        console.error("Failed to load robot GLB", err)
        debugMsg.value = "Error: panda_arm.glb missing!"
    }
}

// --- Initialize Controller ---
onMounted(async () => {
    // Load Model
    await loadRobot()

    // Load Controller
    controller.value = new RobotController(POLICY_PATH)
    await controller.value.init()
    if (!controller.value.error) {
        debugMsg.value = "Controller ready."
    } else {
        debugMsg.value = "Controller failed."
    }
})

// --- Control Loop ---
const { onLoop } = useRenderLoop()

onLoop(async ({ delta, elapsed }) => {
    if (!isModelLoaded.value || !controller.value || !controller.value.session) return

    // 1. Get Environment State (Mocking this part for now)
    // We need: [joint_pos(7), joint_vel(7), achieved_goal(3), desired_goal(3)]
    // In a real Sim2Web, we would need to read current joint angles from the 3D model.
    // For this demo, let's create a dummy observation.
    const obs = new Array(18).fill(0).map(() => Math.random() * 0.1) // Random noise
    
    // 2. Run Inference
    const action = await controller.value.predict(obs)

    // 3. Apply Action to Robot Joints
    // This requires mapping 'action' values to specific nodes in the GLB
    // Usually panda_link1, panda_link2, etc.
    if (action && robotModel.value) {
        // Example: simple rotation update
        // const link1 = robotModel.value.getObjectByName('panda_link1')
        // if (link1) link1.rotation.y += action[0] * delta
        
        // XAI / Debug info
        // debugMsg.value = `Action: ${action.slice(0, 3).map(n => n.toFixed(2))}`
    }
})

</script>

<template>
  <div class="scene-container">
    <div class="overlay">
        <h3>Sim2Web: Panda Reach</h3>
        <p>Status: {{ debugMsg }}</p>
    </div>
    
    <TresCanvas clear-color="#82DBC5" shadows alpha>
      <TresPerspectiveCamera :position="[2, 2, 2]" :look-at="[0, 0, 0]" />
      <OrbitControls />
      
      <TresAmbientLight :intensity="0.5" />
      <TresDirectionalLight :position="[1, 2, 3]" :intensity="1" cast-shadow />
      
      <primitive :object="robotModel" v-if="robotModel" :position="[0, -0.5, 0]" />
      
      <!-- Fallback Box if Missing -->
      <TresMesh v-if="!robotModel && debugMsg.includes('missing')" :position="[0, 0.5, 0]">
          <TresBoxGeometry :args="[0.5, 0.5, 0.5]" />
          <TresMeshStandardMaterial color="gray" />
      </TresMesh>
      
      <TresMesh :position="targetPos">
        <TresSphereGeometry :args="[0.05, 32, 32]" />
        <TresMeshStandardMaterial color="red" />
      </TresMesh>
      
      <TresGridHelper :args="[4, 10]" />
    </TresCanvas>
  </div>
</template>

<style scoped>
.scene-container {
  width: 100%;
  height: 500px;
  position: relative;
  background: #f0f0f0;
  border-radius: 8px;
  overflow: hidden;
}
.overlay {
  position: absolute;
  top: 10px;
  left: 10px;
  background: rgba(255, 255, 255, 0.8);
  padding: 10px;
  border-radius: 4px;
  z-index: 100;
  pointer-events: none;
}
</style>
