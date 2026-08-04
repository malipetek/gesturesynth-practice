import puppeteer from 'puppeteer-core';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE=process.env.BASE_URL ?? 'http://localhost:4322';
const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:[
  '--no-sandbox',
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
]});
const p=await b.newPage();
const logs=[];
p.on('pageerror',e=>logs.push('PAGEERROR: '+e.message));
p.on('console',m=>{if(m.type()==='error')logs.push('[err] '+m.text());});
await p.goto(`${BASE}/song/ode-to-joy`,{waitUntil:'networkidle2'});
await p.waitForSelector('.start-btn',{timeout:15000});
// wait for camera/model to come up; status text is in .status
let finalStatus='timeout';
try{
  await p.waitForFunction(()=>{
    const el=document.querySelector('.status');
    return el && (el.textContent.includes('Camera ready')||el.textContent.includes('No camera'));
  },{timeout:20000});
  finalStatus=await p.$eval('.status',el=>el.textContent.trim());
}catch{}
const ready=finalStatus.includes('Camera ready');
console.log(JSON.stringify({status:finalStatus, mediaPipeReachedReady:ready}));
console.log('console errors:', logs.length?logs.slice(0,10).join('\n'):'(none)');
await b.close();
