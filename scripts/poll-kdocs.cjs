// 拉金山文档 → 精简保存 data.json（保留关键字段，减小体积）
const fs = require('fs');
const path = require('path');

const FILE_ID = process.env.FILE_ID || 'AymZ2hn1orMaddxj7Xavrxi2GR6LipTS8';
const DRIVE_ID = process.env.DRIVE_ID || '524789436';
const TOKEN = process.env.KDOCS_TOKEN || '';

if (!TOKEN) { console.error('缺少 KDOCS_TOKEN'); process.exit(1); }

const MCP_URL = 'https://mcp-center.wps.cn/skill_hub/mcp';

const headers = {
  'Authorization': 'Bearer ' + TOKEN,
  'X-Skill-Version': 'unknown',
  'X-Request-Source': 'qclaw',
  'X-Client-Id': '12fec48c8ea0a2d9',
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream'
};

let _id = 0;
async function rpc(method, params, sessionId, withId = true) {
  const h = { ...headers };
  if (sessionId) h['mcp-session-id'] = sessionId;
  const body = withId
    ? { jsonrpc: '2.0', id: ++_id, method, params: params || {} }
    : { jsonrpc: '2.0', method, params: params || {} };
  const res = await fetch(MCP_URL, { method: 'POST', headers: h, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  if (!withId) return null;
  return await res.json();
}

// 精简字段：只保留需要的属性
const KEEP_KEYS = new Set([
  'originRow', 'originCol', 'cellText', 'cellValueType',
  'understandableType', 'originalCellValue', 'numFormat'
]);
function slimCell(cell) {
  if (!cell) return cell;
  const out = {};
  for (const k of KEEP_KEYS) if (k in cell) out[k] = cell[k];
  return out;
}

async function main() {
  console.log('[1/4] initialize...');
  const r1 = await fetch(MCP_URL, {
    method: 'POST', headers,
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'planlog-bot', version: '1.0' } }
    })
  });
  const sessionId = r1.headers.get('mcp-session-id');
  if (!sessionId) throw new Error('no session id');
  console.log('  session:', sessionId);

  console.log('[2/4] notifications/initialized');
  await rpc('notifications/initialized', null, sessionId, false);

  console.log('[3/4] tools/call read_file...');
  const r2 = await rpc('tools/call', {
    name: 'read_file',
    arguments: { file_id: FILE_ID, drive_id: DRIVE_ID, sheet_name: '明细', content_format: 'sheet_range' }
  }, sessionId, true);

  console.log('[4/4] parse + slim + save');
  let rawRows = [];
  let sheetName = '';
  try {
    const text = r2.result.content[0].text;
    const parsed = JSON.parse(text);
    const rd = parsed.data?.content?.range_data?.detail;
    if (rd) {
      sheetName = rd.sheet_name || '明细';
      rawRows = rd.rangeData || [];
    }
  } catch(e) { console.log('  parse err:', e.message); }

  const slimRows = rawRows.map(slimCell);
  console.log('  rows:', slimRows.length);

  const out = { fetchedAt: new Date().toISOString(), fileId: FILE_ID, driveId: DRIVE_ID, sheetName, rowCount: slimRows.length, rows: slimRows };
  const outPath = path.join(__dirname, '..', 'docs', 'data.json');
  fs.writeFileSync(outPath, JSON.stringify(out));
  console.log('saved:', outPath, fs.statSync(outPath).size, 'bytes');
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });