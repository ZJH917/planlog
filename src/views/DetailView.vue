<template>
  <div class="detail">
    <div class="topbar">
      <el-button @click="router.push('/')">
        <el-icon><ArrowLeft /></el-icon> 返回首页
      </el-button>
      <h2 class="page-title">{{ workId }} — 项目详情</h2>
      <el-button type="primary" plain @click="router.push('/timeline/' + workId)">
        查看变更历史 →
      </el-button>
    </div>

    <div v-if="project" class="detail-grid">
      <!-- 基本信息 -->
      <div class="section">
        <div class="section-title">📋 基本信息</div>
        <div class="info-row">
          <span class="info-label">工号</span><span class="info-value bold">{{ project.workId }}</span>
          <span class="info-label">合同号</span><span class="info-value">{{ project.contractNo }}</span>
          <span class="info-label">商品类别</span><span class="info-value">{{ project.category }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">项目负责人</span><span class="info-value">{{ project.manager }}</span>
          <span class="info-label">商品名称</span><span class="info-value">{{ project.productName }}</span>
          <span class="info-label">型号</span><span class="info-value">{{ project.model }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">台数</span><span class="info-value">{{ project.quantity }}</span>
          <span class="info-label">计量单位</span><span class="info-value">{{ project.unit }}</span>
          <span class="info-label">客户名称</span><span class="info-value">{{ project.customer }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">零件名称</span><span class="info-value">{{ project.partName }}</span>
          <span class="info-label">图件号</span><span class="info-value">{{ project.drawingNo }}</span>
          <span class="info-label">合同额</span><span class="info-value">{{ project.contractAmount }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">收入</span><span class="info-value">{{ project.revenue }}</span>
          <span class="info-label">备注</span><span class="info-value full">{{ project.remark }}</span>
        </div>
      </div>

      <!-- 工序进度 -->
      <div class="section">
        <div class="section-title">📅 工序计划日期</div>
        <div class="process-chain">
          <div
            v-for="(step, i) in PROCESS_CHAIN"
            :key="step.name"
            class="process-step"
            :class="getStepClass(step.name)"
          >
            <div class="step-name">{{ step.label }}</div>
            <div class="step-date">{{ project[step.name] || '—' }}</div>
            <div class="step-arrow" v-if="i < PROCESS_CHAIN.length - 1">→</div>
          </div>
        </div>
      </div>

      <!-- 关键日期 -->
      <div class="section">
        <div class="section-title">🔑 关键日期</div>
        <div class="info-row">
          <span class="info-label">投产切线日期</span><span class="info-value">{{ project.productionDate }}</span>
          <span class="info-label">装配入库</span><span class="info-value highlight">{{ project.assemblyDate }}</span>
          <span class="info-label">合同日期</span><span class="info-value">{{ project.contractDate }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">计划销售日期</span><span class="info-value">{{ project.planSaleDate }}</span>
          <span class="info-label">生产实际完成</span><span class="info-value">{{ project.actualCompleteDate }}</span>
          <span class="info-label">实际销售</span><span class="info-value">{{ project.actualSaleDate }}</span>
        </div>
      </div>
    </div>

    <div v-else class="no-data">未找到工号 {{ workId }} 的数据</div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { usePlanStore, PROCESS_CHAIN } from '../stores/planlog.js'

const router = useRouter()
const route = useRoute()
const store = usePlanStore()

const workId = computed(() => route.params.workId)
const project = computed(() => store.projects.find(p => p.workId === workId.value))

function getStepClass(fieldName) {
  const val = project.value?.[fieldName]
  if (!val) return 'empty'
  const d = store.normalizeDate(val)
  const today = new Date().toISOString().slice(0, 10)
  if (d < today) return 'overdue'
  if (d <= today) return 'today'
  return 'future'
}
</script>

<style scoped>
.detail { padding: 24px; max-width: 1200px; margin: 0 auto; }
.topbar { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
.page-title { flex: 1; font-size: 20px; font-weight: 700; }

.section {
  background: white; border-radius: 12px; padding: 20px 24px; margin-bottom: 16px;
  box-shadow: 0 2px 12px rgba(0,0,0,.06);
}
.section-title { font-size: 15px; font-weight: 700; color: #1d2129; margin-bottom: 16px; }

.info-row {
  display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px 12px; margin-bottom: 10px;
}
.info-label { font-size: 12px; color: #86909c; }
.info-value { font-size: 14px; color: #1d2129; }
.info-value.bold { font-weight: 700; color: #165dff; }
.info-value.highlight { font-weight: 700; color: #d4380d; }
.info-value.full { grid-column: span 2; }

.process-chain {
  display: flex; align-items: center; gap: 0; flex-wrap: wrap;
}
.process-step {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 14px; border-radius: 8px; min-width: 90px;
}
.process-step.overdue { background: #fff2e8; }
.process-step.today { background: #fff1f0; }
.process-step.future { background: #f6ffed; }
.process-step.empty { background: #f5f5f5; }
.step-name { font-size: 12px; color: #86909c; }
.step-date { font-size: 14px; font-weight: 600; color: #1d2129; }
.step-arrow { font-size: 18px; color: #d9d9d9; margin: 0 4px; }

.no-data { text-align: center; padding: 60px; color: #86909c; font-size: 16px; }
</style>
