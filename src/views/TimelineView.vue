<template>
  <div class="timeline-view">
    <div class="topbar">
      <el-button @click="router.push('/')">
        <el-icon><ArrowLeft /></el-icon> 返回首页
      </el-button>
      <h2 class="page-title">{{ workId }} — 变更历史</h2>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-num">{{ historyChanges.length }}</div>
        <div class="stat-label">变更总次数</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">{{ uniqueFields.size }}</div>
        <div class="stat-label">涉及字段数</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">{{ historyChanges.filter(c => c.type === 'new').length }}</div>
        <div class="stat-label">新增记录</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">{{ historyChanges.filter(c => c.type === 'update').length }}</div>
        <div class="stat-label">修改记录</div>
      </div>
    </div>

    <!-- 变更时间线 -->
    <div class="timeline-section">
      <div class="section-title">变更记录时间线</div>
      <div class="timeline">
        <div v-for="(change, i) in historyChanges" :key="i" class="timeline-item">
          <div class="timeline-dot" :class="change.type === 'new' ? 'dot-new' : 'dot-update'"></div>
          <div class="timeline-content">
            <div class="timeline-date">{{ formatDate(change.detectedAt) }}</div>
            <div class="timeline-body">
              <template v-if="change.type === 'new'">
                <el-tag type="success" size="small">🆕 新增项目</el-tag>
                <span class="change-desc">工号 <strong>{{ change.workId }}</strong> 首次出现</span>
              </template>
              <template v-else>
                <el-tag size="small" type="warning">{{ getFieldLabel(change.field) }}</el-tag>
                <span class="change-arrow">
                  <span class="old-val">{{ change.oldValue || '(空)' }}</span>
                  <el-icon class="arrow-icon"><Right /></el-icon>
                  <span class="new-val">{{ change.newValue || '(空)' }}</span>
                </span>
                <span class="change-days" v-if="changeDays(change.oldValue, change.newValue) !== 0">
                  {{ changeDays(change.oldValue, change.newValue) > 0 ? '+' : '' }}{{ changeDays(change.oldValue, change.newValue) }}天
                </span>
              </template>
            </div>
            <!-- 影响分析 -->
            <div class="impact-row" v-if="change.impacts && change.impacts.length">
              <span class="impact-label">→ 影响后续：</span>
              <el-tag v-for="imp in change.impacts" :key="imp.field" size="small" type="info" style="margin-right:6px">
                {{ imp.label }} {{ imp.impactDays > 0 ? '+' : '' }}{{ imp.impactDays }}天
              </el-tag>
            </div>
            <!-- 原因 -->
            <div class="reason-row" v-if="store.changeReasons[i]">
              <span class="reason-label">📝 原因：</span>
              <span class="reason-text">{{ store.changeReasons[i] }}</span>
            </div>
            <div v-else class="reason-row">
              <el-button size="small" link type="primary" @click="openReason(i)">填写原因</el-button>
            </div>
          </div>
        </div>
        <div v-if="!historyChanges.length" class="no-changes">
          暂无变更记录
        </div>
      </div>
    </div>

    <!-- 字段变更频次 -->
    <div class="section" v-if="fieldFreq.length">
      <div class="section-title">各字段变更次数</div>
      <div class="field-freq">
        <div v-for="f in fieldFreq" :key="f.field" class="field-freq-item">
          <span class="field-freq-label">{{ f.label }}</span>
          <div class="field-freq-bar-wrap">
            <div class="field-freq-bar" :style="{ width: (f.count / maxFreq * 100) + '%' }"></div>
          </div>
          <span class="field-freq-count">{{ f.count }}</span>
        </div>
      </div>
    </div>

    <!-- 填写原因弹窗 -->
    <el-dialog v-model="reasonDialog.visible" title="填写变更原因" width="480px">
      <p v-if="reasonDialog.idx !== null && historyChanges[reasonDialog.idx]">
        工号 <strong>{{ historyChanges[reasonDialog.idx].workId }}</strong> 的
        <strong>{{ getFieldLabel(historyChanges[reasonDialog.idx].field) }}</strong> 从
        <span style="color:#f56c6c">{{ historyChanges[reasonDialog.idx].oldValue || '(空)' }}</span> 改为
        <span style="color:#67c23a">{{ historyChanges[reasonDialog.idx].newValue || '(空)' }}</span>
      </p>
      <el-input v-model="reasonDialog.text" type="textarea" :rows="3" placeholder="请输入变更原因" style="margin-top:12px" />
      <template #footer>
        <el-button @click="reasonDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveReason">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { usePlanStore, PROCESS_CHAIN, DATE_COLUMNS } from '../stores/planlog.js'
import dayjs from 'dayjs'

const router = useRouter()
const route = useRoute()
const store = usePlanStore()

const workId = computed(() => route.params.workId)

const historyChanges = computed(() =>
  store.getChangesByWorkId(workId.value).slice().reverse()
)

const uniqueFields = computed(() => {
  const s = new Set()
  historyChanges.value.forEach(c => { if (c.field) s.add(c.field) })
  return s
})

const fieldFreq = computed(() => {
  const map = {}
  historyChanges.value.forEach(c => {
    if (!c.field) return
    if (!map[c.field]) map[c.field] = { field: c.field, label: getFieldLabel(c.field), count: 0 }
    map[c.field].count++
  })
  return Object.values(map).sort((a, b) => b.count - a.count)
})

const maxFreq = computed(() => Math.max(...fieldFreq.value.map(f => f.count), 1))

function getFieldLabel(field) {
  const step = PROCESS_CHAIN.find(p => p.name === field)
  return step ? step.label : (field || '')
}

function formatDate(iso) {
  return dayjs(iso).format('YYYY-MM-DD HH:mm')
}

function changeDays(oldVal, newVal) {
  if (!oldVal || !newVal) return 0
  const a = dayjs(oldVal)
  const b = dayjs(newVal)
  if (!a.isValid() || !b.isValid()) return 0
  return b.diff(a, 'day')
}

const reasonDialog = reactive({ visible: false, idx: null, text: '' })

function openReason(idx) {
  reasonDialog.idx = idx
  reasonDialog.text = store.changeReasons[idx] || ''
  reasonDialog.visible = true
}

function saveReason() {
  if (reasonDialog.idx !== null) {
    store.setChangeReason(reasonDialog.idx, reasonDialog.text.trim())
  }
  reasonDialog.visible = false
}
</script>

<style scoped>
.timeline-view { padding: 24px; max-width: 900px; margin: 0 auto; }
.topbar { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
.page-title { font-size: 20px; font-weight: 700; }

.stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
.stat-card {
  background: white; border-radius: 12px; padding: 20px; text-align: center;
  box-shadow: 0 2px 12px rgba(0,0,0,.06);
}
.stat-num { font-size: 36px; font-weight: 800; color: #165dff; }
.stat-label { font-size: 13px; color: #86909c; margin-top: 4px; }

.section {
  background: white; border-radius: 12px; padding: 20px 24px; margin-bottom: 16px;
  box-shadow: 0 2px 12px rgba(0,0,0,.06);
}
.section-title { font-size: 15px; font-weight: 700; color: #1d2129; margin-bottom: 16px; }

.timeline { position: relative; padding-left: 24px; }
.timeline::before {
  content: ''; position: absolute; left: 8px; top: 0; bottom: 0; width: 2px; background: #e8e8e8;
}

.timeline-item { position: relative; margin-bottom: 24px; }
.timeline-dot {
  position: absolute; left: -20px; top: 4px; width: 12px; height: 12px; border-radius: 50%;
}
.dot-new { background: #52c41a; }
.dot-update { background: #fa8c16; }

.timeline-content {
  background: white; border-radius: 10px; padding: 14px 18px;
  box-shadow: 0 2px 8px rgba(0,0,0,.06); border-left: 3px solid #e8e8e8;
}
.timeline-date { font-size: 12px; color: #86909c; margin-bottom: 6px; }
.timeline-body { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.change-desc { font-size: 14px; color: #1d2129; }
.change-arrow { display: flex; align-items: center; gap: 6px; font-size: 14px; }
.old-val { color: #f56c6c; text-decoration: line-through; }
.new-val { color: #67c23a; font-weight: 600; }
.arrow-icon { color: #86909c; }
.change-days {
  font-size: 12px; font-weight: 600; color: #fa8c16;
  background: #fff7e6; border-radius: 4px; padding: 2px 6px;
}

.impact-row, .reason-row { margin-top: 8px; font-size: 13px; display: flex; align-items: center; gap: 6px; }
.impact-label, .reason-label { color: #86909c; }
.reason-text { color: #67c23a; }

.no-changes { text-align: center; padding: 40px; color: #86909c; }

.field-freq { display: flex; flex-direction: column; gap: 10px; }
.field-freq-item { display: flex; align-items: center; gap: 12px; }
.field-freq-label { width: 100px; font-size: 13px; color: #4e5969; }
.field-freq-bar-wrap { flex: 1; height: 12px; background: #f0f0f0; border-radius: 6px; overflow: hidden; }
.field-freq-bar { height: 100%; background: #409eff; border-radius: 6px; transition: width .3s; }
.field-freq-count { width: 30px; text-align: right; font-size: 13px; font-weight: 600; color: #409eff; }
</style>
