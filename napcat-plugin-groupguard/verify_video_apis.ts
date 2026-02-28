import fetch from 'node-fetch';

const apis = [
  { name: 'Yujn XJJ', url: 'http://api.yujn.cn/api/xjj.php?type=video' },
  { name: 'BTStu SJBZ', url: 'http://api.btstu.cn/sjbz/api.php?format=json' },
  { name: 'AA1 DY Girl', url: 'https://v.api.aa1.cn/api/api-dy-girl/index.php?aa1=json' },
  { name: 'Aixiaowai', url: 'https://api.aixiaowai.cn/api/api.php' }, // Usually images, check docs
  { name: 'Kuaishou Video', url: 'https://api.uomg.com/api/rand.video' } // Check docs
];

async function checkApi(api) {
  try {
    console.log(`Checking ${api.name}...`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const res = await fetch(api.url, { 
      method: 'GET',
      redirect: 'manual', // Don't follow yet, want to see where it goes
      signal: controller.signal
    });
    clearTimeout(timeout);

    console.log(`[${api.name}] Status: ${res.status}`);
    console.log(`[${api.name}] Type: ${res.headers.get('content-type')}`);
    console.log(`[${api.name}] Location: ${res.headers.get('location')}`);
    
    if (res.status === 200) {
        const text = await res.text();
        console.log(`[${api.name}] Body preview: ${text.substring(0, 100)}`);
    }
  } catch (e) {
    console.log(`[${api.name}] Error: ${e.message}`);
  }
}

async function run() {
  for (const api of apis) {
    await checkApi(api);
  }
}

run();
