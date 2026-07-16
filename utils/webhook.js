const https = require('https');
require('dotenv').config();

const WEBHOOK_URL = process.env.WEBHOOK_URL;

function sendWebhook(data) {
  if (!WEBHOOK_URL) return;
  try {
    const url = new URL(WEBHOOK_URL);
    const body = JSON.stringify({
      embeds: [{
        title: data.title || 'DexAuth Event',
        color: data.color || 0x00ff00,
        fields: Object.entries(data.fields || {}).map(([name, value]) => ({
          name, value: `\`\`\`${String(value)}\`\`\``, inline: true
        })),
        timestamp: new Date().toISOString(),
        footer: { text: 'DexAuth Security' }
      }]
    });
    const req = https.request({
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    });
    req.write(body);
    req.end();
  } catch (e) { /* silent */ }
}

module.exports = { sendWebhook };
