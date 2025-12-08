<script setup>
import { ref, computed } from 'vue'

const pLeft = ref(0.25)
const pRight = ref(0.25)
const pUp = ref(0.25)
const pDown = ref(0.25)

function normalize() {
  const sum = pLeft.value + pRight.value + pUp.value + pDown.value
  if(sum === 0) return
  pLeft.value = parseFloat((pLeft.value/sum).toFixed(2))
  pRight.value = parseFloat((pRight.value/sum).toFixed(2))
  pUp.value = parseFloat((pUp.value/sum).toFixed(2))
  pDown.value = parseFloat((pDown.value/sum).toFixed(2))
}

function setDeterministic() {
  pLeft.value = 0; pRight.value = 1; pUp.value = 0; pDown.value = 0;
}
function setRandom() {
  pLeft.value = 0.25; pRight.value = 0.25; pUp.value = 0.25; pDown.value = 0.25;
}

</script>

<template>
  <div class="comp-box">
    <div class="header">
      <h3>策略分布 (Policy Distribution) &pi;(a|s)</h3>
      <div class="presets">
         <button class="sm" @click="setRandom">Equiprobable</button>
         <button class="sm" @click="setDeterministic">Deterministic</button>
      </div>
    </div>

    <div class="stage">
       <!-- Single Cell Visualization -->
       <div class="cell-zoom">
          <div class="cell-bg"></div>
          
          <!-- Arrows -->
          <div class="arrow up" :style="{ opacity: pUp * 2 + 0.1, transform: `scale(${0.5 + pUp}) translateY(-20px)` }">⬆</div>
          <div class="arrow down" :style="{ opacity: pDown * 2 + 0.1, transform: `scale(${0.5 + pDown}) translateY(20px)` }">⬇</div>
          <div class="arrow left" :style="{ opacity: pLeft * 2 + 0.1, transform: `scale(${0.5 + pLeft}) translateX(-20px)` }">⬅</div>
          <div class="arrow right" :style="{ opacity: pRight * 2 + 0.1, transform: `scale(${0.5 + pRight}) translateX(20px)` }">⮕</div>
          
          <div class="center-dot">s</div>
       </div>

       <div class="controls">
          <div class="c-row"><label>P(Up)</label><input type="range" v-model.number="pUp" step="0.05" max="1" @change="normalize"> {{pUp}}</div>
          <div class="c-row"><label>P(Down)</label><input type="range" v-model.number="pDown" step="0.05" max="1" @change="normalize">{{pDown}}</div>
          <div class="c-row"><label>P(Left)</label><input type="range" v-model.number="pLeft" step="0.05" max="1" @change="normalize">{{pLeft}}</div>
          <div class="c-row"><label>P(Right)</label><input type="range" v-model.number="pRight" step="0.05" max="1" @change="normalize">{{pRight}}</div>
       </div>
    </div>
  </div>
</template>

<style scoped>
.comp-box { font-family: 'Inter', sans-serif; background: #f8f9fa; padding: 20px; border-radius: 8px; border: 1px solid #e9ecef; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 2px solid #e9ecef; padding-bottom: 10px; }
h3 { margin: 0; font-size: 1rem; color: #495057; }

.stage { display: flex; gap: 40px; justify-content: center; align-items: center; }

.cell-zoom {
  width: 120px; height: 120px;
  background: white; border: 2px solid #339af0;
  border-radius: 8px;
  position: relative;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.arrow { 
  position: absolute; font-weight: bold; color: #339af0; font-size: 24px; pointer-events: none; transition: all 0.3s;
}
.up { top: 10px; }
.down { bottom: 10px; }
.left { left: 10px; }
.right { right: 10px; }

.center-dot { font-weight: bold; color: #868e96; }

.controls { width: 200px; font-size: 0.9rem; }
.c-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; }
input { width: 80px; }

.presets button.sm { padding: 4px 8px; font-size: 0.8rem; background: #e9ecef; border: none; border-radius: 4px; margin-left: 5px; cursor: pointer; }
.presets button.sm:hover { background: #dee2e6; }
</style>