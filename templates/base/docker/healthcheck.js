/**
 * Health check script for OpenClaw client containers.
 * Performs an HTTP GET to the local gateway and exits with 0 (healthy) or 1 (unhealthy).
 */
'use strict';

const http = require('node:http');

const port = process.env.HEALTH_CHECK_PORT || '8080';
const url = `http://127.0.0.1:${port}/health`;

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
