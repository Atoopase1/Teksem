const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const localtunnel = require('localtunnel');

const app = express();
app.use(cors());

// Proxy all requests to Supabase
app.use('/', createProxyMiddleware({ 
  target: 'https://etlagrvacikinnihpyss.supabase.co', 
  changeOrigin: true,
  onProxyRes: function (proxyRes, req, res) {
    proxyRes.headers['Access-Control-Allow-Origin'] = '*';
  }
}));

app.listen(3000, async () => {
  console.log('✅ Local proxy running on port 3000');
  
  try {
    const tunnel = await localtunnel({ port: 3000 });
    console.log('\n=======================================================');
    console.log('🚀 SUCCESS! Your Private Cloudflare Bypass URL is:');
    console.log(tunnel.url);
    console.log('=======================================================\n');
    console.log('👉 Copy that URL and paste it into SUPABASE_URL in Wokwi!');
    console.log('Keep this terminal open while simulating.');
    
    tunnel.on('close', () => {
      console.log('Tunnel closed');
    });
  } catch (err) {
    console.error('Tunnel error:', err);
  }
});
