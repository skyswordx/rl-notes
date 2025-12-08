<script setup>
import { ref, computed } from 'vue'

const gamma = ref(0.9)
// 5 step episode
const steps = [
  { r: 10 }, { r: 10 }, { r: 10 }, { r: 10 }, { r: 10 }
]

const returnVal = computed(() => {
  let g = 0
  for(let i=0; i<steps.length; i++) {
    g += steps[i].r * Math.pow(gamma.value, i)
  }
  return g.toFixed(2)
})
</script>

<template>
  <div class="comp-box">
    <div class="header">
      <h3>回报计算 (Return Calculation) G<sub>t</sub></h3>
      <div class="controls">
         <label>折扣因子 &gamma;: {{ gamma }}</label>
         <input type="range" v-model.number="gamma" min="0" max="1" step="0.1">
      </div>
    </div>

    <div class="stage">
       <!-- 1x5 Grid Strip -->
       <div class="grid-strip">
          <div v-for="(s, i) in steps" :key="i" class="step-col">
             <div class="cell">
                <span class="coin">💰</span>
                <span class="r-val">{{s.r}}</span>
             </div>
             
             <div class="calc-details">
                <div class="term">
                   {{s.r}} × {{gamma}}^{{i}}
                </div>
                <div class="val">
                   = {{ (s.r * Math.pow(gamma, i)).toFixed(2) }}
                </div>
             </div>
          </div>
       </div>
    </div>
    
    <div class="result-area">
       <div class="formula">
          G<sub>t</sub> = &Sigma; &gamma;<sup>k</sup> R<sub>t+k+1</sub> &approx; {{ returnVal }}
       </div>
       <div class="hint" v-if="gamma < 0.5">短视 (Short-sighted)</div>
       <div class="hint" v-if="gamma > 0.8">远视 (Far-sighted)</div>
    </div>
  </div>
</template>

<style scoped>
.comp-box { font-family: 'Inter', sans-serif; background: #f8f9fa; padding: 20px; border-radius: 8px; border: 1px solid #e9ecef; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 2px solid #e9ecef; padding-bottom: 10px; }
h3 { margin: 0; font-size: 1rem; color: #495057; }

.stage { display: flex; justify-content: center; margin-bottom: 20px; overflow-x: auto; }
.grid-strip { display: flex; gap: 10px; }
.step-col { display: flex; flex-direction: column; align-items: center; gap: 10px; }

.cell { width: 60px; height: 60px; background: white; border: 1px solid #dee2e6; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
.coin { font-size: 20px; }
.r-val { font-size: 10px; color: #666; }

.calc-details { font-family: monospace; font-size: 0.8rem; text-align: center; color: #868e96; }
.val { color: #339af0; font-weight: bold; }

.result-area { text-align: center; background: #e7f5ff; padding: 15px; border-radius: 8px; }
.formula { font-size: 1.2rem; font-weight: bold; color: #1864ab; }
.hint { margin-top: 5px; font-size: 0.9rem; color: #495057; }
</style>