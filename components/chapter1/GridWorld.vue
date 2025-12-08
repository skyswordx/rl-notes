<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'

// --- Constants & Config ---
const GRID_SIZE = 5
const CELL_TYPES = {
  EMPTY: 0,
  FORBIDDEN: 1, 
  TARGET: 2,
  START: 3 
}

// Default Rewards
const rewards = reactive({
  step: -1,
  target: 10,
  wall: -5,
  forbidden: -5
})

const gamma = ref(0.9)
const animationSpeed = ref(300)

// --- State ---
const grid = reactive(Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(0)))
const startPos = reactive({ r: 0, c: 0 })
const agentPos = reactive({ r: 0, c: 0 })
const targetPos = reactive({ r: 4, c: 4 }) 

// Visual Feedback State
const feedback = ref(null) // { r, c, text, type }

// Editing Mode
const tools = [
  { id: 'start', label: '📍 起点', icon: '📍' },
  { id: 'target', label: '💎 终点', icon: '💎' },
  { id: 'forbidden', label: '🚫 禁止', icon: '🟧' },
  { id: 'empty', label: '⬜ 空地', icon: '⬜' }
]
const currentTool = ref('forbidden')

// Simulation State
const isRunning = ref(false)
const strategies = [
  { id: 'random', label: '随机乱走 (Random)' },
  { id: 'greedy', label: '贪婪策略 (Greedy)' },
  { id: 'optimal', label: '最优策略 (Optimal)' }
]
const currentStrategy = ref('random')
const message = ref('准备就绪')
const stepCount = ref(0)
const totalReward = ref(0)
let timer = null

// Value Table
const values = ref(Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(0)))


// --- Initialization ---
onMounted(() => {
  grid[targetPos.r][targetPos.c] = CELL_TYPES.TARGET
  resetAgent()
  solveMDP()
})

// --- Core Logic ---

function resetAgent() {
  stop()
  agentPos.r = startPos.r
  agentPos.c = startPos.c
  stepCount.value = 0
  totalReward.value = 0
  message.value = 'Agent 已重置'
  feedback.value = null
}

function handleCellClick(r, c) {
  if (isRunning.value) return 

  if (currentTool.value === 'start') {
    startPos.r = r
    startPos.c = c
    if (grid[r][c] === CELL_TYPES.TARGET) grid[r][c] = CELL_TYPES.EMPTY
    if (grid[r][c] === CELL_TYPES.FORBIDDEN) grid[r][c] = CELL_TYPES.EMPTY
    resetAgent()
  } else if (currentTool.value === 'target') {
    for(let i=0; i<GRID_SIZE; i++)
      for(let j=0; j<GRID_SIZE; j++)
        if (grid[i][j] === CELL_TYPES.TARGET) grid[i][j] = CELL_TYPES.EMPTY
    
    grid[r][c] = CELL_TYPES.TARGET
  } else if (currentTool.value === 'forbidden') {
    grid[r][c] = CELL_TYPES.FORBIDDEN
  } else if (currentTool.value === 'empty') {
    grid[r][c] = CELL_TYPES.EMPTY
  }
  
  solveMDP()
}

function isValid(r, c) {
  return r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE && grid[r][c] !== CELL_TYPES.FORBIDDEN
}

// Show visual feedback
function showFeedback(text, type='neutral') {
  feedback.value = {
    r: agentPos.r,
    c: agentPos.c,
    text,
    type,
    id: Date.now() // force re-render
  }
  // Auto clear is handled by Vue key or simple timeout logic if needed, 
  // but usually simple replacement is enough.
  setTimeout(() => {
    // Only clear if it's the same feedback (basic check)
    // Actually relying on v-if transition is cleaner but let's just clear
    if (feedback.value && feedback.value.text === text) feedback.value = null
  }, 800)
}

// --- Strategies ---

// Now returns a direction {dr, dc} instead of target pos
// to allow failing (bumping)
function getAction_Random() {
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]]
  // Random strategy blindly picks a direction
  return dirs[Math.floor(Math.random() * dirs.length)]
}

function getAction_Greedy() {
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]]
  
  // Find target
  let tr = -1, tc = -1
  for(let i=0; i<GRID_SIZE; i++) for(let j=0; j<GRID_SIZE; j++) if(grid[i][j] === CELL_TYPES.TARGET) { tr=i; tc=j; }
  
  if (tr === -1) return getAction_Random()

  let bestDir = null
  let minDist = Infinity
  
  // Greedy will only look at VALID moves to avoid stupidity, 
  // but if it gets stuck in a cup, it might have no choice but to go back or stay?
  // Let's say Greedy considers all Valid moves and picks best.
  
  for (const d of dirs) {
    const nr = agentPos.r + d[0]
    const nc = agentPos.c + d[1]
    
    if (isValid(nr, nc)) {
       const dist = Math.abs(nr - tr) + Math.abs(nc - tc)
       if (dist < minDist) {
         minDist = dist
         bestDir = d
       }
    }
  }
  
  // If no valid move (trapped), pick random (and bump)
  if (!bestDir) return getAction_Random()
  
  return bestDir
}

function getAction_Optimal() {
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]]
  
  let bestDir = null
  let maxV = -Infinity
  
  for (const d of dirs) {
    const nr = agentPos.r + d[0]
    const nc = agentPos.c + d[1]
    
    // Helper to get value of a state
    // If invalid, the result is bumping wall -> staying in current state with Penalty.
    // So Value of doing 'd' is:
    //   If valid: R_step + gamma * V(nr, nc)
    //   If invalid: R_wall + gamma * V(r, c)
    
    let expectedV = -Infinity
    if (isValid(nr, nc)) {
       let r = rewards.step
       if (grid[nr][nc] === CELL_TYPES.TARGET) r += rewards.target
       expectedV = r + gamma.value * values.value[nr][nc]
    } else {
       expectedV = rewards.wall + gamma.value * values.value[agentPos.r][agentPos.c]
    }

    if (expectedV > maxV) {
      maxV = expectedV
      bestDir = d
    }
  }
  return bestDir || getAction_Random()
}

// --- Simulation Loop ---

function step() {
  if (grid[agentPos.r][agentPos.c] === CELL_TYPES.TARGET) {
    message.value = '🏆 到达目标！'
    totalReward.value += rewards.target
    showFeedback(`+${rewards.target}`, 'good')
    stop()
    return
  }
  
  let action = null
  if (currentStrategy.value === 'random') action = getAction_Random()
  else if (currentStrategy.value === 'greedy') action = getAction_Greedy()
  else if (currentStrategy.value === 'optimal') action = getAction_Optimal()
  
  if (action) {
    const nr = agentPos.r + action[0]
    const nc = agentPos.c + action[1]
    
    if (isValid(nr, nc)) {
        // Successful Move
        agentPos.r = nr
        agentPos.c = nc
        
        // Reward Logic
        let r = 0
        if (grid[nr][nc] === CELL_TYPES.TARGET) {
           // We add target reward later when loop checks state? 
           // Better to add step cost now, target reward when 'arrived' check hits.
           // Actually usually 'step' cost is for the transition.
           r = rewards.step
           message.value = 'Moving...'
           showFeedback(`${r}`, 'neutral')
        } else {
           r = rewards.step
           showFeedback(`${r}`, 'neutral')
        }
        totalReward.value += r
        
    } else {
       // BUMP!
       totalReward.value += rewards.wall
       message.value = '💥 撞墙了!'
       showFeedback(`${rewards.wall}`, 'bad')
       
       // Shake effect could be added here
    }
    stepCount.value++
    
    if (grid[agentPos.r][agentPos.c] === CELL_TYPES.TARGET) {
       message.value = '🏆 到达目标！'
       // We already gave step reward. The Target Reward is for "Entering" or "Being" in target?
       // Let's add it now.
       totalReward.value += rewards.target
       showFeedback(`+${rewards.target}`, 'good')
       stop()
    }
  }
}

function toggleRun() {
  if (isRunning.value) stop()
  else start()
}

function start() {
  if (grid[agentPos.r][agentPos.c] === CELL_TYPES.TARGET) resetAgent()
  isRunning.value = true
  message.value = '运行中...'
  timer = setInterval(step, animationSpeed.value)
}

function stop() {
  isRunning.value = false
  if (timer) clearInterval(timer)
}

// --- Value Iteration ---
function solveMDP() {
  const v = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(0))
  let changed = true
  let iters = 0
  
  while(changed && iters < 200) {
    changed = false
    const newV = v.map(row => [...row])
    
    for(let r=0; r<GRID_SIZE; r++) {
      for(let c=0; c<GRID_SIZE; c++) {
        if (grid[r][c] === CELL_TYPES.TARGET) {
           newV[r][c] = 0
           continue 
        }
        if (grid[r][c] === CELL_TYPES.FORBIDDEN) {
           newV[r][c] = 0
           continue
        }
        
        let maxQ = -Infinity
        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]]

        // Q(s,a) = P(s'|s,a) [ R + gamma V(s') ]
        for(const d of dirs) {
           const nr = r + d[0]
           const nc = c + d[1]
           
           let val = 0
           if (isValid(nr, nc)) {
              let r_imm = rewards.step
              if (grid[nr][nc] === CELL_TYPES.TARGET) r_imm += rewards.target
              val = r_imm + gamma.value * v[nr][nc]
           } else {
              // Wall mechanism: Stay in place + Wall penalty
              val = rewards.wall + gamma.value * v[r][c]
           }
           
           if (val > maxQ) maxQ = val
        }
        
        if (grid[r][c] !== CELL_TYPES.TARGET && maxQ === -Infinity) maxQ = 0

        if (Math.abs(maxQ - v[r][c]) > 0.001) {
          newV[r][c] = maxQ
          changed = true
        }
      }
    }
    for(let i=0; i<GRID_SIZE; i++) v[i] = newV[i]
    iters++
  }
  
  values.value = v
}

watch([gamma, rewards], () => solveMDP(), { deep: true })

</script>

<template>
  <div class="gw-container">
    <div class="panel config-panel">
      <div class="section">
        <h3>1. 环境设置 (Environment)</h3>
        <div class="row-inputs">
           <label>折扣因子 γ: <input type="number" step="0.1" min="0" max="0.99" v-model.number="gamma"></label>
           <label>空地区域的即时奖励: <input type="number" step="1" v-model.number="rewards.step"></label>
           <label>禁止区域的即时奖励: <input type="number" step="1" v-model.number="rewards.wall"></label>
           <label>目标区域的即时奖励: <input type="number" step="1" v-model.number="rewards.target"></label>
        </div>
      </div>
      
      <div class="section">
        <h3>2. 地图编辑 (Map Editor)</h3>
        <div class="tools">
          <button 
            v-for="t in tools" 
            :key="t.id"
            :class="{ active: currentTool === t.id }"
            @click="currentTool = t.id"
          >
            {{ t.label }}
          </button>
        </div>
      </div>
    </div>

    <div class="main-stage">
      <div class="grid-board">
        <div v-for="(row, r) in grid" :key="r" class="grid-row">
          <div 
            v-for="(cell, c) in row" 
            :key="c"
            class="cell"
            :class="{
              'forbidden': cell === CELL_TYPES.FORBIDDEN,
              'target': cell === CELL_TYPES.TARGET,
              'start': startPos.r === r && startPos.c === c,
              'agent': agentPos.r === r && agentPos.c === c
            }"
            @click="handleCellClick(r, c)"
          >
             <span v-if="agentPos.r === r && agentPos.c === c" class="icon agent-icon">🤖</span>
             <span v-else-if="startPos.r === r && startPos.c === c" class="icon start-marker">📍</span>
             <span v-else-if="cell === CELL_TYPES.TARGET" class="icon">💎</span>
             
             <span v-if="currentStrategy === 'optimal' && cell !== CELL_TYPES.FORBIDDEN && cell !== CELL_TYPES.TARGET" class="val-text">
               {{ values[r][c].toFixed(1) }}
             </span>

             <!-- Visual Feedback Popper -->
             <transition name="pop">
                <span 
                   v-if="feedback && feedback.r === r && feedback.c === c" 
                   class="feedback-pop"
                   :class="feedback.type"
                >
                  {{ feedback.text }}
                </span>
             </transition>
          </div>
        </div>
      </div>
      
      <div class="panel control-panel">
         <h3>3. 智能体控制 (Agent)</h3>
         
         <div class="strategy-select">
           <label>策略选择:</label>
           <select v-model="currentStrategy">
             <option v-for="s in strategies" :key="s.id" :value="s.id">{{ s.label }}</option>
           </select>
         </div>
         
         <div class="stats">
           <p>步数: <strong>{{ stepCount }}</strong></p>
           <p>总回报: <strong>{{ totalReward.toFixed(1) }}</strong></p>
           <p>状态: <span :class="{ 'status-ok': message.includes('Target'), 'status-info': !message.includes('Target') }">{{ message }}</span></p>
         </div>

         <div class="actions">
           <button class="btn-primary" @click="toggleRun">
             {{ isRunning ? '⏸ 暂停' : '▶ 开始' }}
           </button>
           <button class="btn-secondary" @click="step" :disabled="isRunning">👣 单步</button>
           <button class="btn-danger" @click="resetAgent">↺ 重置</button>
         </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gw-container {
  font-family: 'Inter', sans-serif;
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 12px;
  padding: 20px;
  max-width: 800px;
  margin: 20px auto;
  box-shadow: 0 4px 12px rgba(0,0,0,0.05);
}

h3 {
  margin: 0 0 10px 0;
  font-size: 1rem;
  color: #495057;
  border-bottom: 2px solid #e9ecef;
  padding-bottom: 5px;
}

.panel { margin-bottom: 20px; }

.row-inputs { display: flex; gap: 15px; flex-wrap: wrap; }
.row-inputs label { font-size: 0.9rem; color: #666; display: flex; align-items: center; gap: 5px; }
.row-inputs input { width: 60px; padding: 4px; border: 1px solid #ced4da; border-radius: 4px; }

.tools { display: flex; gap: 10px; }
.tools button {
  padding: 6px 12px; border: 1px solid #dee2e6; background: white; border-radius: 6px; cursor: pointer; transition: all 0.2s; font-size: 0.9rem; display: flex; align-items: center; gap: 4px;
}
.tools button:hover { background: #e9ecef; }
.tools button.active { background: #e7f5ff; border-color: #339af0; color: #1c7ed6; font-weight: bold; }

.main-stage { display: flex; gap: 30px; align-items: flex-start; }
.grid-board { background: #343a40; padding: 4px; border-radius: 4px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); }
.grid-row { display: flex; }
.cell {
  width: 60px; height: 60px; background: #ffffff; border: 1px solid #dee2e6; margin: 1px; display: flex; align-items: center; justify-content: center; cursor: pointer; position: relative; transition: background 0.2s;
}

.cell.forbidden { background: #ff922b; border-color: #fcc419; }
.cell.target { background-color: #dbe4ff; border: 2px solid #339af0; }

.icon { font-size: 1.5rem; z-index: 2; user-select: none; }
.agent-icon { animation: bounce 0.5s infinite alternate; }

.val-text { position: absolute; font-size: 0.7rem; color: #adb5bd; bottom: 2px; right: 2px; z-index: 1; pointer-events: none; }

/* Visual Feedback Popper */
.feedback-pop {
  position: absolute; top: 0; left: 0; right: 0; text-align: center;
  font-weight: bold; font-size: 1.2rem; pointer-events: none; z-index: 10;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}
.feedback-pop.good { color: #20c997; } /* Green */
.feedback-pop.bad { color: #ff6b6b; } /* Red */
.feedback-pop.neutral { color: #495057; }

.pop-enter-active, .pop-leave-active { transition: all 0.5s ease; }
.pop-enter-from { opacity: 0; transform: translateY(10px); }
.pop-leave-to { opacity: 0; transform: translateY(-20px); }

/* Controls */
.control-panel { flex: 1; background: white; padding: 15px; border-radius: 8px; border: 1px solid #dee2e6; min-width: 200px; }
.strategy-select select { width: 100%; padding: 8px; margin-top: 5px; margin-bottom: 15px; border-radius: 4px; border: 1px solid #ced4da; }
.stats p { margin: 8px 0; font-size: 0.9rem; display: flex; justify-content: space-between; }
.status-ok { color: #20c997; font-weight: bold; }
.status-info { color: #495057; }

.actions { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; }
button { cursor: pointer; border: none; padding: 10px; border-radius: 6px; font-weight: 600; transition: filter 0.2s; }
button:hover { filter: brightness(0.9); }
button:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-primary { background: #339af0; color: white; }
.btn-secondary { background: #e9ecef; color: #495057; }
.btn-danger { background: #ff6b6b; color: white; }

@keyframes bounce {
  from { transform: translateY(0); }
  to { transform: translateY(-5px); }
}

@media (max-width: 600px) {
  .main-stage { flex-direction: column; align-items: center; }
  .grid-board { margin-bottom: 20px; }
}
</style>