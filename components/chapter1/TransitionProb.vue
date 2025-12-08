<script setup>
import { ref, reactive } from 'vue'

const noise = ref(0.2)
// 3x3 Grid. Center is Start (1,1).
const agentPos = reactive({ r: 1, c: 1 })
const targetPos = { r: 1, c: 2 } // Right
const log = ref([])

// Grid Visualization for 3x3
const grid = [
  [{t:0},{t:0},{t:0}],
  [{t:0},{t:3},{t:2}], // Start, Target(Direction)
  [{t:0},{t:0},{t:0}]
]

function reset() {
  agentPos.r = 1
  agentPos.c = 1
  log.value = []
}

function move() {
  // Intended: Right (East) -> (1, 2)
  const r = Math.random()
  
  let actualMove = ''
  let dr=0, dc=0
  
  if (r < 1 - noise.value) {
    // Success: Right
    dr = 0; dc = 1;
    actualMove = 'Right (Intended) ✅'
  } else if (r < 1 - noise.value/2) {
    // Drift: Up? or Down? Let's say we drift orthogonal
    // Up
    dr = -1; dc = 0;
    actualMove = 'Up (Drift) ⚠️'
  } else {
    // Down
    dr = 1; dc = 0;
    actualMove = 'Down (Drift) ⚠️'
  }
  
  // Update pos (clamped)
  const nr = Math.max(0, Math.min(2, agentPos.r + dr))
  const nc = Math.max(0, Math.min(2, agentPos.c + dc))
  
  agentPos.r = nr
  agentPos.c = nc
  
  log.value.unshift(actualMove)
  if(log.value.length > 5) log.value.pop()
}
</script>

<template>
  <div class="comp-box">
    <div class="header">
      <h3>随机性转移 (Stochastic Transition)</h3>
      <div class="controls">
         <label>噪声概率: {{ noise }}</label>
         <input type="range" v-model.number="noise" min="0" max="0.8" step="0.1">
      </div>
    </div>

    <div class="stage">
      <!-- 3x3 Grid -->
      <div class="grid-board">
        <div v-for="(row, r) in grid" :key="r" class="row">
           <div 
             v-for="(cell, c) in row" 
             :key="c" 
             class="cell"
             :class="{ target: r===1 && c===2 }"
           >
              <span v-if="agentPos.r === r && agentPos.c === c" class="agent">🤖</span>
              <!-- Ghost Arrows for visualization -->
              <span v-if="r===1 && c===1 && agentPos.r===1 && agentPos.c===1" class="arrow main-arrow">⮕</span>
              <span v-if="r===0 && c===1 && agentPos.r===1 && agentPos.c===1" class="arrow drift-arrow" :style="{opacity: noise}">⬆</span>
              <span v-if="r===2 && c===1 && agentPos.r===1 && agentPos.c===1" class="arrow drift-arrow" :style="{opacity: noise}">⬇</span>
           </div>
        </div>
      </div>
      
      <div class="info-panel">
         <p class="intent">动作: <strong>向右 (Right)</strong></p>
         <div class="probs">
           <div class="p-item success">P(Right) = {{ (1-noise).toFixed(1) }}</div>
           <div class="p-item fail">P(Up) = {{ (noise/2).toFixed(2) }}</div>
           <div class="p-item fail">P(Down) = {{ (noise/2).toFixed(2) }}</div>
         </div>
         <button @click="move" :disabled="agentPos.c !== 1 || agentPos.r !== 1">执行动作</button>
         <button class="btn-sec" @click="reset">重置</button>
         
         <div class="log">
           <div v-for="(l,i) in log" :key="i">{{ l }}</div>
         </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.comp-box { font-family: 'Inter', sans-serif; background: #f8f9fa; padding: 20px; border-radius: 8px; border: 1px solid #e9ecef; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 2px solid #e9ecef; padding-bottom: 10px; }
h3 { margin: 0; font-size: 1rem; color: #495057; }

.stage { display: flex; gap: 30px; justify-content: center; }
.grid-board { background: #343a40; padding: 4px; border-radius: 4px; }
.row { display: flex; }
.cell { width: 60px; height: 60px; background: white; margin: 1px; display: flex; align-items: center; justify-content: center; position: relative; }
.cell.target { background: rgba(51, 154, 240, 0.1); border: 2px solid #339af0; }

.agent { font-size: 1.5rem; z-index: 2; transition: all 0.2s; }
.arrow { position: absolute; font-weight: bold; pointer-events: none; }
.main-arrow { right: 2px; color: #339af0; font-size: 20px; }
.drift-arrow { color: #ff922b; font-size: 14px; }

.info-panel { width: 200px; }
.probs { margin: 10px 0; font-size: 0.9rem; font-family: monospace; }
.p-item.success { color: #20c997; }
.p-item.fail { color: #ff922b; }

button { width: 100%; padding: 8px; background: #339af0; color: white; border: none; border-radius: 4px; cursor: pointer; margin-bottom: 5px; }
button:disabled { opacity: 0.5; }
.btn-sec { background: #e9ecef; color: #495057; }
.log { font-size: 0.8rem; color: #666; margin-top: 10px; height: 100px; overflow-y: auto; background: white; padding: 5px; border-radius: 4px; border: 1px solid #eee; }
</style>