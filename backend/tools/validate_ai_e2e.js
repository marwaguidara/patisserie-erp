#!/usr/bin/env node
/**
 * End-to-end validation for Phase 4 Sprint 0 AI walking skeleton
 * Tests: health → ETL export → forecast call
 */

const http = require('http');

const AI_HOST = 'http://127.0.0.1:8000';

async function fetch_json(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          reject(`Failed to parse JSON from ${url}: ${e.message}`);
        }
      });
    });
    req.on('error', reject);
  });
}

async function post_json(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
      },
    };
    const req = http.request(options, (res) => {
      let respData = '';
      res.on('data', (chunk) => (respData += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(respData) });
        } catch (e) {
          reject(`Failed to parse JSON response: ${e.message}`);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run_tests() {
  console.log('Phase 4 Sprint 0 AI Service E2E Validation');
  console.log('============================================\n');

  // Test 1: Health check
  console.log('[1/4] Health check...');
  try {
    const health = await fetch_json(`${AI_HOST}/health`);
    if (health.status === 200 && health.body.status === 'ok') {
      console.log('✓ Health check passed');
      console.log(`  Service: ${health.body.service}\n`);
    } else {
      throw new Error(`Unexpected health response: ${JSON.stringify(health)}`);
    }
  } catch (e) {
    console.error(`✗ Health check failed: ${e.message}\n`);
    return false;
  }

  // Test 2: ETL export
  console.log('[2/4] ETL export...');
  try {
    const etl = await post_json(`${AI_HOST}/etl/run`, {});
    if (etl.status === 200 && etl.body.status === 'ok') {
      console.log('✓ ETL export succeeded');
      const meta = etl.body.value;
      console.log(`  Rows exported: ${meta.rows}`);
      console.log(`  Products: ${meta.product_count}`);
      console.log(`  Period: ${meta.period_start} to ${meta.period_end}`);
      console.log(`  Model version: ${meta.model_version}\n`);
    } else {
      throw new Error(`ETL failed: ${JSON.stringify(etl)}`);
    }
  } catch (e) {
    console.error(`✗ ETL export failed: ${e.message}\n`);
    return false;
  }

  // Test 3: Forecast (insufficient data scenario)
  console.log('[3/4] Forecast call (product_id=999 - no data)...');
  try {
    const forecast = await fetch_json(`${AI_HOST}/forecast?product_id=999`);
    if (forecast.status === 200) {
      console.log('✓ Forecast endpoint responded');
      console.log(`  Value: ${forecast.body.value}`);
      console.log(`  Status: ${forecast.body.status}`);
      console.log(`  Confidence level: ${forecast.body.confidence.level}`);
      console.log(`  Confidence interval: [${forecast.body.confidence.interval[0]}, ${forecast.body.confidence.interval[1]}]\n`);
      if (forecast.body.status !== 'insufficient_data') {
        console.warn('  ⚠ Expected status=insufficient_data for product_id=999');
      }
    } else {
      throw new Error(`Forecast failed: ${forecast.status}`);
    }
  } catch (e) {
    console.error(`✗ Forecast call failed: ${e.message}\n`);
    return false;
  }

  // Test 4: Unimplemented endpoints return 501
  console.log('[4/4] Contract validation (501 Not Implemented)...');
  try {
    const endpoints = [
      '/production-recommendations',
      '/anomalies',
      '/segmentation',
      '/insights',
    ];
    let all_ok = true;
    for (const ep of endpoints) {
      const resp = await fetch_json(`${AI_HOST}${ep}`);
      if (resp.status === 501) {
        console.log(`  ✓ ${ep} → 501`);
      } else {
        console.log(`  ✗ ${ep} → ${resp.status} (expected 501)`);
        all_ok = false;
      }
    }
    if (all_ok) {
      console.log('\n✓ Contract validation passed\n');
    } else {
      throw new Error('Some endpoints returned unexpected status codes');
    }
  } catch (e) {
    console.error(`✗ Contract validation failed: ${e.message}\n`);
    return false;
  }

  console.log('============================================');
  console.log('✓ All E2E validation tests passed');
  return true;
}

run_tests().then((ok) => {
  process.exit(ok ? 0 : 1);
});
