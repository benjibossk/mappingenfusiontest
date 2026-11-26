// Save the open world through the Workbench NET API (no keyboard, no focus: Benji may be playing).
import { WorkbenchClient } from 'file:///C:/Users/benbo/enfusion-mcp-local/enfusion-mcp-BK-src/dist/workbench/client.js';
const c = new WorkbenchClient('127.0.0.1', Number(process.env.MAPGEN_WB_PORT ?? 5777), undefined);
// no config + skipAutoLaunch: never let the client auto-launch a Workbench or "recover" handlers by
// installing scripts into whatever Workbench answers (2026-11-26: a save without the port hit 5775, another
// project's Workbench, and the client started reinstalling handlers there).
try {
  const r = await c.call('EMCP_WB_EditorControl', { action: 'save' }, { timeout: 60000, skipAutoLaunch: true });
  console.log('saved via NET API', JSON.stringify(r).slice(0, 120));
} catch (e) { console.log('SAVE FAILED: ' + e.message); process.exit(2); }
