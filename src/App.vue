<template>
  <div id="app">
    <el-config-provider :locale="zhCn">
      <router-view />
    </el-config-provider>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import zhCn from 'element-plus/dist/locale/zh-cn.mjs'
import { usePlanStore } from './stores/planlog.js'

const store = usePlanStore()

onMounted(() => {
  // 启动时从 data.json 加载（GitHub Pages 静态托管）
  store.loadFromDataJson()
  // 每 60 秒自动刷新
  setInterval(() => store.loadFromDataJson(), 60_000)
})
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Helvetica Neue', Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif; background: #f0f2f5; }
#app { min-height: 100vh; }
</style>