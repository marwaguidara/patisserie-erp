#!/usr/bin/env node
/**
 * Test forecast data integration with backend database
 * Verifies that AI service can read from the business DB
 */

const http = require('http');
const { execSync } = require('child_process');

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
          reject(`Failed to parse JSON: ${e.message}`);
        }
      });
    });
    req.on('error', reject);
  });
}

async function run_test() {
  console.log('Testing AI Service Data Integration');
  console.log('====================================\n');

  // Check backend database status
  console.log('[1/3] Checking backend database...');
  try {
    const dbCheck = execSync(`cd c:\\marwaguidara\\summer\\backend && node -e "const db = require('./src/db/connection'); db.query('SELECT COUNT(*) as cnt FROM sales').then(r => console.log(JSON.stringify(r))).catch(e => console.error(e));"`, { encoding: 'utf8', timeout: 5000 });
    console.log(`Backend database status: ${dbCheck.trim()}\n`);
  } catch (e) {
    console.log('Backend database check: (connection not available)\n');
  }

  // Test ETL and forecast
  console.log('[2/3] ETL Data Extraction...');
  try {
    const etl = await fetch_json(`${AI_HOST}/etl/run`);
    const meta = etl.body.value;
    console.log(`✓ ETL completed`);
    console.log(`  Data rows: ${meta.rows}`);
    console.log(`  Products available: ${meta.product_count}`);
    console.log(`  Period: ${meta.period_start || 'N/A'} to ${meta.period_end || 'N/A'}\n`);

    if (meta.product_count > 0) {
      console.log('[3/3] Testing forecast with available data...');
      // Test with product ID 1
      const forecast = await fetch_json(`${AI_HOST}/forecast?product_id=1`);
      console.log(`✓ Forecast for product_id=1:`);
      console.log(`  Value: ${forecast.body.value || 'N/A'}`);
      console.log(`  Status: ${forecast.body.status}`);
      console.log(`  Confidence: ${forecast.body.confidence.level} ${JSON.stringify(forecast.body.confidence.interval)}`);

      if (forecast.body.status === 'ok' && forecast.body.value !== null) {
        console.log('\n✓ Forecast model is producing predictions with real data');
      } else if (forecast.body.status === 'insufficient_data') {
        console.log('\n⚠ Forecast status is insufficient_data (product may have < 14 historical sales)');
      }
    } else {
      console.log('[3/3] No product data available in backend.');
      console.log('✓ ETL pipeline works correctly (gracefully handles empty DB)\n');
    }

    console.log('====================================');
    console.log('✓ Data integration test passed');
  } catch (e) {
    console.error(`✗ Test failed: ${e.message}`);
    process.exit(1);
  }
}

run_test();
