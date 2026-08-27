/**
 * PlanLog Cloudflare Worker
 * 
 * 数据流：
 * 1. 本地轮询脚本（你电脑上）→ 每分钟调用 mcporter 拉金山文档数据
 * 2. 轮询脚本 POST 到本 Worker → Worker 存入 KV 并做变更对比
 * 3. 前端 GET /api/sync → Worker 返回最新数据 + 今日变更
 *
 * 接口：
 * POST /api/sync  → 接收金山文档数据（body: { rows: [...] }），返回今日变更
 * GET  /api/sync  → 返回最新数据和今日变更（前端轮询用）
 */

const DAY_MS = 86400000

// 列名映射（金山文档列名 → 统一字段名）
const COLUMN_MAP = {
  '工号': 'workId',
  '合同号': 'contractNo',
  '商品名称': 'productName',
  '型号': 'model',
  '台数': 'quantity',
  '计量单位': 'unit',
  '客户名称': 'customer',
  '投产切线日期': 'productionDate',
  '零件名称': 'partName',
  '图件号': 'drawingNo',
  '数量': 'count',
  '预投下发': 'preInvestDate',
  '设计下发': 'designDate',
  '工艺下发': 'processDate',
  '毛坯到货': 'roughcastDate',
  '配套/铆成品到货': 'machinedDate',
  '机加成套': 'machiningDate',
  '转序时间': 'transferDate',
  '装配入库': 'assemblyDate',
  '合同日期': 'contractDate',
  '计划销售日期': 'planSaleDate',
  '合同额': 'contractAmount',
  '收入': 'revenue',
  '商品类别': 'category',
  '备注': 'remark',
  '生产实际完成': 'actualCompleteDate',
  '实际销售': 'actualSaleDate',
  '出产厂区': 'warehouseDate',
  '项目负责人': 'manager',
  '序号': 'seq',
  '板块类别': 'plateCategory',
  '完成': 'completed',
  '按合同期完成': 'completedByContract',
  '按计划期完成': 'completedByPlan',
  '按计划期销售': 'soldByPlan',
}

// 日期列（用于变更检测）
const DATE_COLUMNS = [
  'productionDate', 'preInvestDate', 'designDate', 'processDate',
  'roughcastDate', 'machinedDate', 'machiningDate', 'transferDate',
  'assemblyDate', 'contractDate', 'planSaleDate',
  'warehouseDate', 'actualCompleteDate', 'actualSaleDate'
]

// 工序依赖链（影响分析用，简化版）
const PROCESS_CHAIN = [
  { name: 'preInvestDate', label: '预投下发' },
  { name: 'designDate', label: '设计下发' },
  { name: 'processDate', label: '工艺下发' },
  { name: 'roughcastDate', label: '毛坯到货' },
  { name: 'machinedDate', label: '配切成品到货' },
  { name: 'machiningDate', label: '机加完成' },
  { name: 'transferDate', label: '转序' },
  { name: 'assemblyDate', label: '装配入库' },
]

// ========== 工具函数 ==========

function normalizeDate(val) {
  if (!val || val === '') return ''
  if (typeof val === 'number') {
    // Excel 日期序列号 (Windows 1900 base)
    const d = new Date(Math.round((val - 25569) * 86400 * 1000))
    return d.toISOString().slice(0, 10)
  }
  // 字符串日期
  const s = String(val).trim()
  // 处理 26-10-13 这种格式
  if (/^\d{2}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-')
    return `20${y}-${m}-${d}`
  }
  // 标准 ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return s
}

function parseRow(rawRow) {
  const item = {}
  for (const [colName, fieldName] of Object.entries(COLUMN_MAP)) {
    if (rawRow[colName] !== undefined && rawRow[colName] !== null && rawRow[colName] !== '') {
      item[fieldName] = rawRow[colName]
    }
  }
  return item
}

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

function dateDiff(d1, d2) {
  if (!d1 || !d2) return 0
  const a = new Date(d1)
  const b = new Date(d2)
  if (isNaN(a) || isNaN(b)) return 0
  return Math.round((b - a) / DAY_MS)
}

// ========== KV 操作 ==========

async function getKV(key) {
  const val = await PLANLOG.get(key)
  if (!val) return null
  try { return JSON.parse(val) } catch { return val }
}

async function setKV(key, value) {
  await PLANLOG.put(key, JSON.stringify(value), { expirationTtl: parseInt(KVDATA_TTL) || 604800 })
}

// ========== 主逻辑 ==========

async function handleSync(request, env) {
  const PLANLOG = env.PLANLOG
  const KVDATA_TTL = env.KVDATA_TTL || '604800'

  let rows = null

  // POST 时：本地脚本推送数据
  if (request.method === 'POST') {
    try {
      const body = await request.json()
      rows = body.rows
    } catch(e) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid JSON' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      })
    }
  }

  // GET 时：前端拉数据，直接从 KV 取
  if (request.method === 'GET') {
    const data = await getKV('latest')
    const changes = await getKV('changes') || []
    const reasons = await getKV('reasons') || {}
    const today = new Date().toISOString().slice(0, 10)
    const todayChanges = changes.filter(c => c.detectedAt.slice(0, 10) === today)
      .map((c, i) => ({ ...c, id: i }))

    return new Response(JSON.stringify({
      success: true,
      rows: data || [],
      changes: todayChanges,
      reasons,
      syncedAt: await getKV('lastSync') || null
    }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
  }

  // POST 时：处理新数据
  if (!rows || !Array.isArray(rows)) {
    return new Response(JSON.stringify({ success: false, error: 'rows required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    })
  }

  const parsed = rows.map(parseRow).filter(r => r && r.workId)
  const now = new Date().toISOString()
  const today = now.slice(0, 10)

  // 读取上次快照
  const prevData = await getKV('latest') || []
  const prevMap = new Map(prevData.map(p => [p.workId, p]))
  const prevWorkIds = new Set(prevMap.keys())
  const newWorkIds = new Set(parsed.map(p => p.workId))

  const newChanges = []
  const updated = parsed.map(p => {
    const prev = prevMap.get(p.workId)
    if (!prev) {
      p._created = today
      p._updated = today
      newChanges.push({ workId: p.workId, type: 'new', detectedAt: now, fields: {} })
      return p
    }
    const changedFields = {}
    const allKeys = new Set([...Object.keys(prev), ...Object.keys(p)])
    for (const key of allKeys) {
      const oldVal = normalizeDate(prev[key])
      const newVal = normalizeDate(p[key])
      if (oldVal !== newVal && newVal !== '') {
        changedFields[key] = { old: oldVal, new: newVal }
        const diff = dateDiff(oldVal, newVal)
        newChanges.push({
          workId: p.workId,
          type: 'update',
          field: key,
          oldValue: oldVal || '(空)',
          newValue: newVal,
          detectedAt: now,
          impacts: calcImpact(key, diff)
        })
      }
    }
    p._created = prev._created || today
    p._updated = Object.keys(changedFields).length > 0 ? today : (prev._updated || today)
    return p
  })

  // 新增的工号（上次快照里没有）
  const addedWorkIds = [...newWorkIds].filter(id => !prevWorkIds.has(id))
  // 删除了的工号（本次快照里没有）
  const removedWorkIds = [...prevWorkIds].filter(id => !newWorkIds.has(id))
  for (const workId of removedWorkIds) {
    const prev = prevMap.get(workId)
    if (prev) {
      newChanges.push({ workId, type: 'delete', detectedAt: now, fields: {} })
    }
  }

  // 追加变更记录
  const allChanges = await getKV('changes') || []
  allChanges.push(...newChanges)
  // 只保留最近 30 天
  const cutoff = new Date(Date.now() - 30 * DAY_MS).toISOString()
  const filteredChanges = allChanges.filter(c => c.detectedAt > cutoff)
  await setKV('changes', filteredChanges)

  // 更新快照
  await setKV('latest', updated)
  await setKV('lastSync', now)

  const todayChanges = filteredChanges
    .filter(c => c.detectedAt.slice(0, 10) === today)
    .map((c, i) => ({ ...c, id: i }))

  return new Response(JSON.stringify({
    success: true,
    newCount: newChanges.length,
    addedCount: addedWorkIds.length,
    changes: newChanges
  }), { headers: { 'Content-Type': 'application/json' } })
}

// ========== 原因记录 ==========

async function handleReason(request, env) {
  const PLANLOG = env.PLANLOG
  if (request.method === 'OPTIONS') {
    return new Response('', {
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
    })
  }
  if (request.method === 'GET') {
    const reasons = await getKV('reasons') || {}
    return new Response(JSON.stringify(reasons), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
  }
  if (request.method === 'POST') {
    const { id, reason } = await request.json()
    const reasons = await getKV('reasons') || {}
    reasons[String(id)] = reason
    await setKV('reasons', reasons)
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } })
  }
}

// ========== 路由 ==========

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response('', {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      })
    }

    if (url.pathname === '/api/sync') {
      return handleSync(request, env)
    }
    if (url.pathname === '/api/reason') {
      return handleReason(request, env)
    }

    // 健康检查
    if (url.pathname === '/health') {
      return new Response('OK', { headers: { 'Content-Type': 'text/plain' } })
    }

    return new Response('PlanLog Worker OK', { status: 200 })
  }
}
