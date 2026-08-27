/**
 * PlanLog 轮询脚本
 * 
 * 放在你电脑上，每分钟自动运行：
 * 1. 读金山文档「明细」子表
 * 2. POST 到 Cloudflare Worker（Worker 自动做变更对比）
 * 
 * 依赖：Node.js（已内置在你电脑上）
 * 使用方法：
 *   node poll-kdocs.js
 * 
 * 定时运行（Windows 任务计划程序）：
 *   schtasks /create /tn "PlanLog同步" /tr "node poll-kdocs.js" /sc minute /mo 1 /f
 */

const { execSync } = require('child_process')
const https = require('https')
const http = require('http')

// ====== 配置（部署 Worker 后填入） ======
const WORKER_URL = 'https://planlog-worker.你的账号.workers.dev/api/sync'
const KDOCS_URL = 'https://www.kdocs.cn/l/cbIGJiuJmt0O'
// ========================================

const DAY_MS = 86400000

// Excel 序列号 → YYYY-MM-DD
function excelSerialToDate(serial) {
  if (!serial || isNaN(Number(serial))) return ''
  const n = Number(serial)
  if (n < 100) return '' // 小数字不是日期
  // Excel 日期从 1900-01-01 开始（但 Excel 有一个 bug：把 1900 当闰年，多算1天）
  const d = new Date(Math.round((n - 25569) * DAY_MS))
  if (isNaN(d)) return ''
  return d.toISOString().slice(0, 10)
}

// 列名映射（金山文档表头 → 统一字段名）
const COLUMN_MAP = {
  '序号': 'seq',
  '项目负责人': 'manager',
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
  '板块类别': 'plateCategory',
  '合同月份': 'contractMonth',
  '合同年份': 'contractYear',
  '完成': 'completed',
  '按合同期完成': 'completedByContract',
  '按计划期完成': 'completedByPlan',
  '按计划期销售': 'soldByPlan',
}

// 日期类型列（需要从 Excel 序列号转换）
const DATE_FIELDS = new Set([
  'productionDate', 'preInvestDate', 'designDate', 'processDate',
  'roughcastDate', 'machinedDate', 'machiningDate', 'transferDate',
  'assemblyDate', 'contractDate', 'planSaleDate',
  'actualCompleteDate', 'actualSaleDate'
])

// ========== mcporter 调用 ==========
function mcporterCall(tool, params) {
  const args = Object.entries(params)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ')
  const cmd = `mcporter call kdocs-qclaw ${tool} ${args}`
  try {
    const r = execSync(cmd, {
      encoding: 'utf8', timeout: 120000,
      shell: 'cmd.exe', maxBuffer: 100 * 1024 * 1024
    })
    return JSON.parse(r)
  } catch(e) {
    const out = e.stdout || ''
    if (out) {
      try { return JSON.parse(out) } catch {}
    }
    throw new Error(`mcporter 调用失败: ${e.message}\n${out.slice(0, 500)}`)
  }
}

// ========== HTTP POST JSON ==========
function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const lib = urlObj.protocol === 'https:' ? https : http
    const body = JSON.stringify(data)
    const req = lib.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 30000
    }, (res) => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => {
        try { resolve(JSON.parse(d)) }
        catch { reject(new Error('Worker 返回非 JSON: ' + d.slice(0, 200))) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Worker 请求超时')) })
    req.write(body)
    req.end()
  })
}

// ========== 解析金山文档数据 ==========
function parseKdocsData(raw) {
  // raw.data.content 是对象：{ range_data: { detail: { rangeData: [...] } } }
  const rangeData = raw.data?.content?.range_data?.detail?.rangeData || []
  if (!rangeData.length) throw new Error('rangeData 为空')

  // 建立 (row, col) → value 映射
  const cellMap = new Map()
  for (const cell of rangeData) {
    const key = `${cell.rowFrom}-${cell.colFrom}`
    const rawVal = cell.originalCellValue ?? cell.cellText ?? ''
    cellMap.set(key, typeof rawVal === 'string' ? rawVal.trim() : rawVal)
  }

  // 找最大行列
  let maxRow = 0, maxCol = 0
  for (const key of cellMap.keys()) {
    const [r, c] = key.split('-').map(Number)
    if (r > maxRow) maxRow = r
    if (c > maxCol) maxCol = c
  }

  // 第0行 = 表头
  const headers = []
  for (let c = 0; c <= maxCol; c++) headers.push(cellMap.get(`0-${c}`) || '')

  // 数据行
  const rows = []
  for (let r = 1; r <= maxRow; r++) {
    const item = {}
    let hasData = false
    for (let c = 0; c <= maxCol; c++) {
      const colName = headers[c]
      if (!colName) continue
      const fieldName = COLUMN_MAP[colName]
      if (!fieldName) continue
      let val = cellMap.get(`${r}-${c}`) || ''
      // 日期列：Excel 序列号转 YYYY-MM-DD
      if (DATE_FIELDS.has(fieldName) && val !== '') {
        val = excelSerialToDate(val)
        if (!val) continue
      }
      item[fieldName] = val
      if (val !== '') hasData = true
    }
    if (hasData && item.workId) rows.push(item)
  }
  return rows
}

// ========== 主流程 ==========
async function main() {
  const start = Date.now()
  const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  console.log(`[${ts}] 开始同步金山文档...`)

  // 第1步：读取金山文档
  console.log('  → 调用金山文档 API...')
  let raw
  try {
    raw = mcporterCall('read_file', {
      url: KDOCS_URL,
      sheet_name: '明细'
    })
  } catch(e) {
    console.error(`  ✗ 读取金山文档失败: ${e.message}`)
    process.exit(1)
  }

  // 第2步：解析数据
  let rows
  try {
    rows = parseKdocsData(raw)
    console.log(`  ✓ 解析成功：${rows.length} 条有效记录`)
  } catch(e) {
    console.error(`  ✗ 解析数据失败: ${e.message}`)
    process.exit(1)
  }

  // 第3步：发送到 Worker
  console.log('  → 发送到 Cloudflare Worker...')
  try {
    const result = await postJson(WORKER_URL, { rows })
    const ms = Date.now() - start
    const added = result.addedCount || 0
    const updated = result.newCount || 0
    console.log(`  ✓ 同步完成（${ms}ms）`)
    if (added > 0) console.log(`    🆕 新增: ${added} 条`)
    if (updated > 0) console.log(`    📝 变更: ${updated} 条`)
    if (added === 0 && updated === 0) console.log('    （无新增/变更）')
  } catch(e) {
    console.error(`  ✗ Worker 请求失败: ${e.message}`)
    process.exit(1)
  }
}

main().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})
