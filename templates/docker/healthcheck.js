'use strict';

const http = require('node:http');

const port = process.env.OPENCLAW_GATEWAY_PORT || '18789';
const url = `http://localhost:${port}/health`;

const req = http.get(url, { timeout: 5000 }, (res) => {
  process.exit(res.statusCode === 200 ? 0 : 1);
});

req.on('error', () => {
  process.exit(1);
});

req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});
