import {chromium} from './chronoscope-transitions-local/frontend/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const browser=await chromium.connectOverCDP('http://127.0.0.1:50212');
const page=browser.contexts().flatMap(c=>c.pages())[0],session=await page.context().newCDPSession(page);
const row={unix_ms:Date.now(),heap:await session.send('Runtime.getHeapUsage'),state:await page.evaluate(()=>{const c=window.__chronoscope,v=c.view;return {memory:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null,scenePrimitives:v.scene.primitives.length,diag:v.diagnostics()};})};
fs.appendFileSync('chronoscope-transitions-local/.qa/transitions/native-soak/100k-map/heap-observations.jsonl',JSON.stringify(row)+'\n');
console.log(JSON.stringify({heap:row.heap,primitives:row.state.scenePrimitives}));await session.detach();await browser.close();
