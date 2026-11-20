// Save the open world through the Workbench NET API (no keyboard, no focus: Benji may be playing).
import { WorkbenchClient } from 'file:///C:/Users/benbo/enfusion-mcp-local/enfusion-mcp-BK-src/dist/workbench/client.js';
const c = new WorkbenchClient('127.0.0.1', 5775, {});
try {
  const r = await c.call('EMCP_WB_EditorControl', { action: 'save' }, { timeout: 60000 });
  console.log('saved via NET API', JSON.stringify(r).slice(0, 120));
} catch (e) { console.log('SAVE FAILED: ' + e.message); process.exit(2); }
