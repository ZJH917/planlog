<template>
  <div class="home">
    <!-- 顶部标题栏 -->
    <div class="header">
      <div class="header-left">
        <h1 class="title">📋 计划日志 <span class="subtitle">PlanLog</span></h1>
        <div class="sync-info">
          <span v-if="store.lastSyncTime">最后同步：{{ formatTime(store.lastSyncTime) }}</span>
          <span v-else>尚未同步数据</span>
        </div>
      </div>
      <div class="header-right">
        <el-button type="primary" @click="doSync" :loading="store.syncStatus === 'syncing'">
          <el-icon><Refresh /></el-icon>
          手动刷新
        </el-button>
        <el-tag :type="statusType" size="small">{{ statusText }}</el-tag>
      </div>
    </div>

    <!-- 三个统计卡片 -->
    <div class="cards">
      <!-- 今日新增 -->
      <div class="card card-new" @click="openList('new')">
        <div class="card-icon">🆕</div>
        <div class="card-body">
          <div class="card-num">{{ store.todayNewItems.length }}</div>
          <div class="card-label">今日新增</div>
        </div>
        <div class="card-desc">点击查看详情 →</div>
      </div>

      <!-- 今日入库 -->
      <div class="card card-warehouse" @click="openList('warehouse')">
        <div class="card-icon">📦</div>
        <div class="card-body">
          <div class="card-num">{{ store.todayWarehouseItems.length }}</div>
          <div class="card-label">今日入库</div>
        </div>
        <div class="card-desc">点击查看详情 →</div>
      </div>

      <!-- 今日修改 -->
      <div class="card card-change" @click="openList('change')">
        <div class="card-icon">✏️</div>
        <div class="card-body">
          <div class="card-num">{{ store.todayChanges.length }}</div>
          <div class="card-label">今日修改</div>
        </div>
        <div class="card-desc">点击查看详情 →</div>
      </div>
    </div>

    <!-- 快捷入口 -->
    <div class="quick-actions">
      <el-button @click="router.push('/timeline/' + searchWorkId)">
        <el-icon><Search /></el-icon>
        工号历史查询
      </el-button>
      <el-input
        v-model="searchWorkId"
        placeholder="输入工号（如 XJ26110060）"
        style="width: 260px; margin-left: 12px"
        @keyup.enter="router.push('/timeline/' + searchWorkId)"
      />
      <el-button style="margin-left: 12px" @click="showFreqDialog = true">
        <el-icon><TrendCharts /></el-icon>
        变更频次榜
      </el-button>
      <el-button style="margin-left: 12px" @click="showExpiryDialog = true">
        <el-icon><Warning /></el-icon>
        到期提醒
      </el-button>
    </div>

    <!-- 最近7天变更趋势（简单数字） -->
    <div class="trend-row">
      <div class="trend-title">近7天变更趋势</div>
      <div class="trend-bars">
        <div v-for="(item, i) in last7days" :key="i" class="trend-bar-wrap">
          <div class="trend-bar" :style="{ height: item.h + 'px', background: i === 0 ? '#409eff' : '#c0d4f0' }"></div>
          <div class="trend-label">{{ item.label }}</div>
          <div class="trend-count">{{ item.count }}</div>
        </div>
      </div>
    </div>

    <!-- 三个列表弹窗 -->
    <el-dialog v-model="listDialog.visible" :title="listDialog.title" width="90%" :fullscreen="false">
      <!-- 通用表格 -->
      <el-table :data="listDialog.items" stripe border size="small" max-height="60vh">
        <el-table-column prop="workId" label="工号" width="140" fixed />
        <el-table-column prop="contractNo" label="合同号" width="130" />
        <el-table-column prop="category" label="商品类别" width="100" />
        <el-table-column prop="manager" label="项目负责人" width="90" />
        <el-table-column prop="productName" label="商品名称" min-width="150" />
        <el-table-column prop="model" label="型号" width="100" />
        <el-table-column prop="quantity" label="台数" width="60" align="center" />
        <el-table-column prop="unit" label="计量单位" width="80" />
        <el-table-column prop="customer" label="客户名称" min-width="140" />
        <el-table-column prop="productionDate" label="投产切线日期" width="120" />
        <el-table-column prop="partName" label="零件名称" min-width="120" />
        <el-table-column prop="assemblyDate" label="装配入库" width="120" />
        <el-table-column prop="contractDate" label="合同日期" width="120" />
        <el-table-column prop="planSaleDate" label="计划销售日期" width="120" />
        <el-table-column prop="contractAmount" label="合同额" width="100" align="right" />
        <el-table-column prop="revenue" label="收入" width="100" align="right" />
        <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip />
        <!-- 变更列表额外列 -->
        <el-table-column v-if="listDialog.type === 'change'" label="变更内容" width="200">
          <template #default="{ row }">
            <span class="change-field">{{ row.field }}</span>
            <span class="change-arrow">{{ row.oldValue }} → {{ row.newValue }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="listDialog.type === 'change'" label="影响" width="160">
          <template #default="{ row }">
            <span v-if="row.impacts && row.impacts.length">
              <el-tag v-for="imp in row.impacts" :key="imp.field" size="small" type="warning" style="margin-right:4px">
                {{ imp.label }} +{{ imp.impactDays }}天
              </el-tag>
            </span>
            <span v-else style="color:#999">—</span>
          </template>
        </el-table-column>
        <el-table-column v-if="listDialog.type === 'change'" label="原因" width="180">
          <template #default="{ row }">
            <span v-if="store.changeReasons[row.id]" style="color:#67c23a">{{ store.changeReasons[row.id] }}</span>
            <el-button v-else size="small" link type="primary" @click="openReasonDialog(row)">填写原因</el-button>
          </template>
        </el-table-column>
        <el-table-column v-if="listDialog.type === 'change'" label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="router.push('/detail/' + row.workId)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <!-- 变更频次榜弹窗 -->
    <el-dialog v-model="showFreqDialog" title="变更频次榜（被改次数最多的项目）" width="600px">
      <el-table :data="store.changeFrequency.slice(0, 20)" stripe border size="small">
        <el-table-column type="index" label="排名" width="60" />
        <el-table-column prop="workId" label="工号" width="150" />
        <el-table-column prop="count" label="变更次数" width="100" align="center">
          <template #default="{ row }">
            <el-tag type="danger">{{ row.count }}次</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="fields" label="被改字段">
          <template #default="{ row }">
            <el-tag v-for="f in row.fields" :key="f" size="small" style="margin-right:4px">{{ f }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <!-- 到期提醒弹窗 -->
    <el-dialog v-model="showExpiryDialog" title="装配入库到期提醒" width="700px">
      <el-alert v-if="overdueItems.length" title="已超期项目" type="error" :description="overdueItems.length + ' 个项目已超期'" style="margin-bottom:12px" />
      <el-table :data="allExpiryItems" stripe border size="small">
        <el-table-column prop="workId" label="工号" width="140" />
        <el-table-column prop="productName" label="商品名称" min-width="160" />
        <el-table-column prop="assemblyDate" label="装配入库日期" width="120" />
        <el-table-column prop="alertDays" label="剩余天数" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.alertStatus === 'overdue' ? 'danger' : 'warning'">
              {{ row.alertStatus === 'overdue' ? '超期' : '' }}{{ row.alertDays }}天
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="customer" label="客户" min-width="120" />
      </el-table>
    </el-dialog>

    <!-- 填写原因弹窗 -->
    <el-dialog v-model="reasonDialog.visible" title="填写变更原因" width="480px">
      <p style="margin-bottom:12px">
        工号 <strong>{{ reasonDialog.row?.workId }}</strong> 的
        <strong>{{ reasonDialog.row?.field }}</strong> 从
        <span style="color:#f56c6c">{{ reasonDialog.row?.oldValue }}</span> 改为
        <span style="color:#67c23a">{{ reasonDialog.row?.newValue }}</span>
      </p>
      <el-input v-model="reasonDialog.text" type="textarea" :rows="3" placeholder="请输入变更原因，如：客户要求延期、材料未到货、内部调整等" />
      <template #footer>
        <el-button @click="reasonDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveReason">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { usePlanStore } from '../stores/planlog.js'
import dayjs from 'dayjs'

const router = useRouter()
const store = usePlanStore()

const searchWorkId = ref('')
const showFreqDialog = ref(false)
const showExpiryDialog = ref(false)

const reasonDialog = reactive({ visible: false, row: null, text: '' })

const listDialog = reactive({ visible: false, title: '', type: '', items: [] })

const statusText = computed(() => {
  if (store.syncStatus === 'syncing') return '同步中...'
  if (store.syncStatus === 'error') return '同步失败'
  return '正常'
})
const statusType = computed(() => {
  if (store.syncStatus === 'error') return 'danger'
  if (store.syncStatus === 'syncing') return 'warning'
  return 'success'
})

function formatTime(iso) {
  return dayjs(iso).format('MM-DD HH:mm:ss')
}

function openList(type) {
  if (type === 'new') {
    listDialog.title = `今日新增（${store.todayNewItems.length} 项）`
    listDialog.items = store.todayNewItems
    listDialog.type = 'new'
  } else if (type === 'warehouse') {
    listDialog.title = `今日入库（${store.todayWarehouseItems.length} 项）`
    listDialog.items = store.todayWarehouseItems
    listDialog.type = 'warehouse'
  } else if (type === 'change') {
    listDialog.title = `今日修改（${store.todayChanges.length} 项）`
    listDialog.items = store.todayChanges.map((c, i) => ({ ...c, id: i }))
    listDialog.type = 'change'
  }
  listDialog.visible = true
}

function openReasonDialog(row) {
  reasonDialog.row = row
  reasonDialog.text = store.changeReasons[row.id] || ''
  reasonDialog.visible = true
}

function saveReason() {
  if (reasonDialog.row && reasonDialog.text.trim()) {
    store.setChangeReason(reasonDialog.row.id, reasonDialog.text.trim())
  }
  reasonDialog.visible = false
}

// 近7天变更趋势
const last7days = computed(() => {
  const days = []
  const today = dayjs()
  for (let i = 6; i >= 0; i--) {
    const d = today.subtract(i, 'day')
    const label = d.format('MM-DD')
    const count = store.changes.filter(c => dayjs(c.detectedAt).format('YYYY-MM-DD') === d.format('YYYY-MM-DD')).length
    days.push({ label, count, h: Math.max(10, count * 12) })
  }
  return days
})

// 到期提醒
const overdueItems = computed(() => store.expiryAlerts.filter(i => i.alertStatus === 'overdue'))
const allExpiryItems = computed(() => store.expiryAlerts)

// 手动刷新
async function doSync() {
  store.syncStatus = 'syncing'
  try {
    const res = await fetch('/api/sync')
    const data = await res.json()
    if (data.success) {
      store.syncProjects(data.rows, data.syncedAt)
    } else {
      store.syncStatus = 'error'
    }
  } catch(e) {
    store.syncStatus = 'error'
  }
}

// 页面加载时尝试同步
doSync()
</script>

<style scoped>
.home { padding: 24px; max-width: 1400px; margin: 0 auto; }

.header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 24px; background: white; border-radius: 12px; padding: 20px 28px;
  box-shadow: 0 2px 12px rgba(0,0,0,.06);
}
.title { font-size: 22px; font-weight: 700; color: #1d2129; }
.subtitle { font-size: 14px; color: #86909c; font-weight: 400; margin-left: 8px; }
.sync-info { font-size: 13px; color: #86909c; margin-top: 4px; }
.header-right { display: flex; align-items: center; gap: 12px; }

.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 24px; }
.card {
  background: white; border-radius: 16px; padding: 28px 24px;
  cursor: pointer; transition: all .2s;
  box-shadow: 0 2px 12px rgba(0,0,0,.06);
  display: flex; align-items: center; gap: 20px;
}
.card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0,0,0,.12); }
.card-icon { font-size: 40px; }
.card-num { font-size: 42px; font-weight: 800; line-height: 1; }
.card-label { font-size: 16px; color: #4e5969; font-weight: 500; margin-top: 4px; }
.card-desc { font-size: 12px; color: #86909c; margin-top: 8px; }

.card-new .card-num { color: #165dff; }
.card-warehouse .card-num { color: #722ed1; }
.card-change .card-num { color: #fa541c; }

.quick-actions {
  display: flex; align-items: center; margin-bottom: 24px;
  background: white; border-radius: 12px; padding: 16px 20px;
  box-shadow: 0 2px 12px rgba(0,0,0,.06);
}

.trend-row {
  background: white; border-radius: 12px; padding: 20px 24px;
  box-shadow: 0 2px 12px rgba(0,0,0,.06);
}
.trend-title { font-size: 15px; font-weight: 600; color: #1d2129; margin-bottom: 16px; }
.trend-bars { display: flex; align-items: flex-end; gap: 16px; justify-content: center; }
.trend-bar-wrap { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.trend-bar { width: 36px; border-radius: 6px 6px 0 0; min-height: 10px; transition: height .3s; }
.trend-label { font-size: 11px; color: #86909c; }
.trend-count { font-size: 12px; font-weight: 600; color: #4e5969; }

.change-field { font-weight: 600; color: #165dff; margin-right: 6px; }
.change-arrow { color: #4e5969; font-size: 13px; }
</style>
