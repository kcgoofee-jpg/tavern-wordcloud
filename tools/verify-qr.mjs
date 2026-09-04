#!/usr/bin/env node
/**
 * QR verification with a real browser: load a corpus, export, wait for the morph,
 * decode the canvas with BarcodeDetector. Exits non-zero when decoding fails.
 *
 * Usage: SHOT_URL=http://localhost:8790/ node tools/verify-qr.mjs
 */
// Render the QR in a real browser and decode it with BarcodeDetector
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const c=spawn(CHROME,['--headless=new','--disable-gpu','--remote-debugging-port=9336',
  `--user-data-dir=/tmp/qr-${Date.now()}`],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let url; for(let i=0;i<60;i++){try{const l=await(await fetch('http://127.0.0.1:9336/json/list')).json();
  const p=l.find(t=>t.type==='page'); if(p?.webSocketDebuggerUrl){url=p.webSocketDebuggerUrl;break;}}catch{} await sleep(250);}
const ws=new WebSocket(url); await new Promise(r=>{ws.onopen=r;});
let id=0; const w=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&w.has(m.id)){w.get(m.id)(m); w.delete(m.id);}};
const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;
  w.set(i,x=>x.error?rej(new Error(x.error.message)):res(x.result)); ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async(expr)=>{const r=await send('Runtime.evaluate',{expression:`(async()=>{${expr}})()`,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
  return r.result.value;};
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate',{url: process.env.SHOT_URL || 'http://localhost:8790/'}); await sleep(2500);
/** Corpus from disk (SHOT_FILE or the synthetic fixture); injected as window.__FX. */
const fx = readFileSync(process.env.SHOT_FILE || path.join(process.cwd(), 'fixtures', 'ceo-zh.jsonl'), 'utf8');
await send('Runtime.evaluate',{expression:`window.__FX=${JSON.stringify(fx)};`});
await ev(`
  const inp=document.querySelector('input[type=file]');
  const dt=new DataTransfer(); dt.items.add(new File([window.__FX],'x.jsonl'));
  Object.defineProperty(inp,'files',{value:dt.files,configurable:true});
  inp.dispatchEvent(new Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,6000));
`);
const verdict = await ev(`
  const btn=[...document.querySelectorAll('.rail .tool')].find(b=>/导出|Export/.test(b.title));
  if(!btn) return '❌ 找不到导出按钮';
  btn.click();
  await new Promise(r=>setTimeout(r,4000));   // 等变形动画跑完
  const c=document.querySelector('canvas');
  const det=new BarcodeDetector({formats:['qr_code']});
  const found=await det.detect(c);
  if(!found.length) return '❌ 扫不出来（画布上没有可识别的二维码）';
  return '✅ 扫出来了: ' + found[0].rawValue.slice(0,90);
`);
console.log(verdict);
if (!verdict.startsWith('✅')) { ws.close(); c.kill(); process.exit(1); }
ws.close(); c.kill();
process.exit(0);
