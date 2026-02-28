const https = require('https');
const http = require('http');

const apis = [
  { name: 'Yujn Video', url: 'http://api.yujn.cn/api/xjj.php?type=video' },
  { name: 'BTStu SJBZ', url: 'http://api.btstu.cn/sjbz/api.php?format=json' },
  { name: 'AA1 DY Girl', url: 'https://v.api.aa1.cn/api/api-dy-girl/index.php?aa1=json' },
  { name: 'Aixiaowai', url: 'https://api.aixiaowai.cn/api/api.php' },
  { name: 'Kuaishou Video', url: 'https://api.uomg.com/api/rand.video' },
  { name: 'LinHun Video', url: 'https://api.linhun.vip/api/littlesistervideo' },
  { name: '52vmy Loli', url: 'https://api.52vmy.cn/api/wl/t/video' }
];

function check(api) {
  return new Promise((resolve) => {
    const lib = api.url.startsWith('https') ? https : http;
    const req = lib.get(api.url, (res) => {
      console.log(`[${api.name}] Status: ${res.statusCode}`);
      console.log(`[${api.name}] Type: ${res.headers['content-type']}`);
      console.log(`[${api.name}] Location: ${res.headers['location']}`);
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (data.length < 200) console.log(`[${api.name}] Body: ${data}`);
        resolve();
      });
    });
    req.on('error', (e) => {
      console.log(`[${api.name}] Error: ${e.message}`);
      resolve();
    });
    req.setTimeout(5000, () => {
      req.abort();
      console.log(`[${api.name}] Timeout`);
      resolve();
    });
  });
}

async function run() {
  for (const api of apis) {
    await check(api);
  }
}

run();
