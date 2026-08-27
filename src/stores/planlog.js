import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import dayjs from 'dayjs'

// 金山文档「明细」列名 → 统一字段名映射
export const COLUMN_MAP = {
  '工号': 'workId',
  '合同号': 'contractNo',
  '商品类别': 'category',
  '项目负责人': 'manager',
  '商品名称': 'productName',
  '型号': 'model',
  '台数': 'quantity',
  '计量单位': 'unit',
  '客户名称': 'customer',
  '投产切线日期': 'productionDate',   // 投料线日期
  '零件名称': 'partName',
  '图件号': 'drawingNo',
  '装配入库': 'assemblyDate',
  '合同日期': 'contractDate',
  '计划销售日期': 'planSaleDate',
  'AL': 'warehouseDate',              // 入库日期（AL列）
  '合同额': 'contractAmount',
  '收入': 'revenue',
  '备注': 'remark',
  '预投下发': 'preInvestDate',
  '设计下发': 'designDate',
  '工艺下发': 'processDate',
  '毛坯到货': 'roughcastDate',
  '配切成品到货': 'machinedDate',
  '机加完成': 'machiningDate',
  '转序': 'transferDate',
  '生产实际完成': 'actualCompleteDate',
  '实际销售': 'actualSaleDate',
}

// 日期列（用于变更对比）
export const DATE_COLUMNS = [
  'productionDate', 'preInvestDate', 'designDate', 'processDate',
  'roughcastDate', 'machinedDate', 'machiningDate', 'transferDate',
  'assemblyDate', 'contractDate', 'planSaleDate',
  'warehouseDate', 'actualCompleteDate', 'actualSaleDate'
]

// 工序依赖链（影响分析用）
export const PROCESS_CHAIN = [
  { name: 'preInvestDate', label: '预投下发' },
  { name: 'designDate', label: '设计下发' },
  { name: 'processDate', label: '工艺下发' },
  { name: 'roughcastDate', label: '毛坯到货' },
  { name: 'machinedDate', label: '配切成品到货' },
  { name: 'machiningDate', label: '机加完成' },
  { name: 'transferDate', label: '转序' },
  { name: 'assemblyDate', label: '装配入库' },
]

export const usePlanStore = defineStore('planlog', () => {
  // 所有项目列表
  const projects = ref([])
  // 历史快照列表 { date: 'YYYY-MM-DD', items: [...] }
  const snapshots = ref([])
  // 所有变更记录
  const changes = ref([])
  // 原因备注 { [changeId]: '原因文字' }
  const changeReasons = ref({})
  // 最后同步时间
  const lastSyncTime = ref(null)
  // 同步状态
  const syncStatus = ref('idle') // idle | syncing | error

  // 今日新增
  const todayNewItems = computed(() => {
    if (!lastSyncTime.value) return []
    const today = dayjs(lastSyncTime.value).format('YYYY-MM-DD')
    // 新增 = 本次快照中有，但上次快照中没有的工号
    const prevWorkIds = new Set(snapshots.value.length > 1
      ? snapshots.value[snapshots.value.length - 2].items.map(i => i.workId)
      : [])
    return projects.value.filter(p => !prevWorkIds.has(p.workId) && p._created)
      .map(p => ({ ...p, _created: p._created }))
  })

  // 今日入库
  const todayWarehouseItems = computed(() => {
    if (!lastSyncTime.value) return []
    const today = dayjs(lastSyncTime.value).format('YYYY-MM-DD')
    return projects.value.filter(p => {
      if (!p.warehouseDate) return false
      const d = normalizeDate(p.warehouseDate)
      return d === today
    })
  })

  // 今日修改
  const todayChanges = computed(() => {
    if (!lastSyncTime.value) return []
    const today = dayjs(lastSyncTime.value).format('YYYY-MM-DD')
    return changes.value.filter(c => {
      const d = dayjs(c.detectedAt).format('YYYY-MM-DD')
      return d === today
    })
  })

  // 影响分析：某工序变更后对后续工序的影响天数
  function calcImpact(fieldName, daysDiff) {
    if (daysDiff === 0) return []
    const idx = PROCESS_CHAIN.findIndex(p => p.name === fieldName)
    if (idx === -1) return []
    return PROCESS_CHAIN.slice(idx + 1).map(p => ({
      field: p.name,
      label: p.label,
      impactDays: daysDiff
    }))
  }

  // 格式化日期
  function normalizeDate(val) {
    if (!val) return ''
    if (typeof val === 'number') {
      // Excel 日期序列号
      const d = new Date((val - 25569) * 86400 * 1000)
      return dayjs(d).format('YYYY-MM-DD')
    }
    // 字符串日期
    const parsed = dayjs(val)
    if (parsed.isValid()) return parsed.format('YYYY-MM-DD')
    return String(val)
  }

  // 解析金山文档原始行为项目对象
  function parseRow(row) {
    const item = {}
    for (const [colName, fieldName] of Object.entries(COLUMN_MAP)) {
      if (row[colName] !== undefined) {
        item[fieldName] = row[colName]
      }
    }
    return item
  }

  // 同步最新数据
  function syncProjects(rawRows, createdAt = null) {
    const now = createdAt || new Date().toISOString()
    const today = dayjs(now).format('YYYY-MM-DD')

    const prevSnapshot = snapshots.value[snapshots.value.length - 1]
    const prevMap = new Map(prevSnapshot ? prevSnapshot.items.map(i => [i.workId, i]) : [])
    const prevWorkIds = new Set(prevMap.keys())

    const newProjects = rawRows.map(parseRow).filter(p => p.workId)
    const newWorkIds = new Set(newProjects.map(p => p.workId))

    const newChanges = []
    const updatedProjects = newProjects.map(p => {
      const prev = prevMap.get(p.workId)
      if (!prev) {
        // 新增项目
        p._created = today
        p._updated = today
        newChanges.push({ workId: p.workId, type: 'new', detectedAt: now, fields: {} })
        return p
      }
      // 检查字段变更
      const changedFields = {}
      const allFields = new Set([...Object.keys(prev), ...Object.keys(p)])
      for (const key of allFields) {
        const oldVal = normalizeDate(prev[key] ?? '')
        const newVal = normalizeDate(p[key] ?? '')
        if (oldVal !== newVal) {
          changedFields[key] = { old: oldVal, new: newVal }
          newChanges.push({
            workId: p.workId,
            type: 'update',
            field: key,
            oldValue: oldVal,
            newValue: newVal,
            detectedAt: now,
            impacts: calcImpact(key, dateDiff(oldVal, newVal))
          })
        }
      }
      if (Object.keys(changedFields).length > 0) {
        p._updated = today
      } else {
        p._updated = prev._updated
      }
      return p
    })

    // 保存快照
    snapshots.value.push({ date: today, items: updatedProjects, syncedAt: now })
    // 追加变更记录
    changes.value.push(...newChanges)
    projects.value = updatedProjects
    lastSyncTime.value = now
    syncStatus.value = 'idle'

    return { newProjects: updatedProjects, changes: newChanges }
  }

  function dateDiff(d1, d2) {
    if (!d1 || !d2) return 0
    const a = dayjs(d1)
    const b = dayjs(d2)
    if (!a.isValid() || !b.isValid()) return 0
    return b.diff(a, 'day')
  }

  // 加载变更原因
  function setChangeReason(changeId, reason) {
    changeReasons.value[changeId] = reason
  }

  // 按工号查变更历史
  function getChangesByWorkId(workId) {
    return changes.value.filter(c => c.workId === workId)
  }

  // 变更频次
  const changeFrequency = computed(() => {
    const map = {}
    for (const c of changes.value) {
      if (!map[c.workId]) map[c.workId] = { workId: c.workId, count: 0, fields: new Set() }
      map[c.workId].count++
      if (c.field) map[c.workId].fields.add(c.field)
    }
    return Object.values(map).map(v => ({ ...v, fields: [...v.fields] })).sort((a, b) => b.count - a.count)
  })

  // 到期提醒
  const expiryAlerts = computed(() => {
    const today = dayjs().format('YYYY-MM-DD')
    const soon = dayjs().add(7, 'day').format('YYYY-MM-DD')
    return projects.value
      .filter(p => {
        const d = normalizeDate(p.assemblyDate)
        if (!d) return false
        if (d < today) return { status: 'overdue', days: dayjs().diff(dayjs(d), 'day') }
        if (d <= soon) return { status: 'soon', days: dayjs(d).diff(dayjs(), 'day') }
        return false
      })
      .map(p => {
        const d = normalizeDate(p.assemblyDate)
        const diff = dayjs(d).diff(dayjs(), 'day')
        return {
          ...p,
          alertStatus: diff < 0 ? 'overdue' : 'soon',
          alertDays: Math.abs(diff)
        }
      })
  })

  return {
    projects, snapshots, changes, changeReasons, lastSyncTime, syncStatus,
    todayNewItems, todayWarehouseItems, todayChanges, changeFrequency, expiryAlerts,
    syncProjects, setChangeReason, getChangesByWorkId, normalizeDate, calcImpact, DATE_COLUMNS, PROCESS_CHAIN
  }
})
