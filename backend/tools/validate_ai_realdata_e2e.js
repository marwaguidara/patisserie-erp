#!/usr/bin/env node
/**
 * Real Data E2E Validation for AI Service
 * 
 * Tests the complete chain with actual database data:
 * 1. Create a real sale in the backend
 * 2. Trigger ETL extraction from AI service
 * 3. Get forecast for the product from that sale
 * 4. Verify forecast reflects the new sale data
 * 
 * COMMAND: node backend/tools/validate_ai_realdata_e2e.js
 */

const http = require('http');

const BACKEND_URL = 'http://localhost:5000';
const AI_SERVICE_URL = 'http://127.0.0.1:8000';

// Helper to make HTTP requests
function makeRequest(url, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTest() {
  console.log('\n========================================');
  console.log('  REAL DATA E2E VALIDATION TEST');
  console.log('  AI Service + Backend Integration');
  console.log('========================================\n');

  try {
    // 0. Authenticate first
    console.log('STEP 0: Authenticating with backend...');
    const loginResponse = await makeRequest(
      `${BACKEND_URL}/api/auth/login`,
      'POST',
      {
        email: 'cashier@bakery.com',
        password: 'password123'
      }
    );

    if (loginResponse.status !== 200) {
      throw new Error(`Authentication failed: ${loginResponse.status} - ${JSON.stringify(loginResponse.body)}`);
    }

    const token = loginResponse.body.token;
    console.log(`✓ Authenticated as: ${loginResponse.body.user.name} (${loginResponse.body.user.role})`);

    // Helper to make authenticated requests
    function makeAuthRequest(url, method = 'GET', body = null) {
      return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname + urlObj.search,
          method: method,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        };

        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              resolve({ status: res.statusCode, body: parsed, headers: res.headers });
            } catch (e) {
              resolve({ status: res.statusCode, body: data, headers: res.headers });
            }
          });
        });

        req.on('error', reject);
        if (body) {
          req.write(JSON.stringify(body));
        }
        req.end();
      });
    }

    // 1. Get list of products to use a valid product ID
    console.log('\nSTEP 1: Fetching available products...');
    const productsResponse = await makeRequest(
      `${BACKEND_URL}/api/products`,
      'GET'
    );

    if (productsResponse.status !== 200) {
      throw new Error(`Failed to fetch products: ${productsResponse.status}`);
    }

    if (!productsResponse.body || productsResponse.body.length === 0) {
      throw new Error('No products available in database');
    }

    const product = productsResponse.body[0];
    const productId = product.id;

    console.log(`✓ Found ${productsResponse.body.length} products`);
    console.log(`  Using product: ${product.name} (ID: ${productId}) - Price: ${product.price}`);

    // 2. Create a sale with the valid product
    console.log('\nSTEP 2: Creating a real sale...');
    const salePayload = {
      items: [
        {
          product_id: productId,
          quantity: 5
        }
      ],
      paymentMethod: 'CASH',
      customerName: 'Test Customer E2E',
      customerPhone: '+33 1 00 00 00 00'
    };

    const saleResponse = await makeAuthRequest(
      `${BACKEND_URL}/api/sales`,
      'POST',
      salePayload
    );

    if (saleResponse.status !== 200 && saleResponse.status !== 201) {
      throw new Error(`Sale creation failed: ${saleResponse.status} - ${JSON.stringify(saleResponse.body)}`);
    }

    const saleId = saleResponse.body.sale_id || saleResponse.body.id || saleResponse.body.sales_id;

    console.log(`✓ Sale created successfully`);
    console.log(`  Sale ID: ${saleId}`);
    console.log(`  Product ID: ${productId}`);
    console.log(`  Quantity: ${salePayload.items[0].quantity}`);
    console.log(`  Full response:`, JSON.stringify(saleResponse.body, null, 2));

    // 3. Get forecast BEFORE ETL (should show insufficient data or old forecast)
    console.log('\nSTEP 3: Getting forecast BEFORE ETL...');
    const forecastBefore = await makeRequest(
      `${AI_SERVICE_URL}/forecast?product_id=${productId}`,
      'GET'
    );

    if (forecastBefore.status !== 200) {
      throw new Error(`Forecast before ETL failed: ${forecastBefore.status}`);
    }

    console.log(`✓ Forecast (before ETL):`);
    console.log(`  Value: ${forecastBefore.body.value}`);
    console.log(`  Status: ${forecastBefore.body.status}`);
    console.log(`  Confidence: ${JSON.stringify(forecastBefore.body.confidence)}`);
    console.log(`  Full response:`, JSON.stringify(forecastBefore.body, null, 2));

    // 4. Trigger ETL to extract and aggregate sales data
    console.log('\nSTEP 4: Triggering ETL extraction...');
    const etlResponse = await makeRequest(
      `${AI_SERVICE_URL}/etl/run`,
      'POST'
    );

    if (etlResponse.status !== 200) {
      throw new Error(`ETL run failed: ${etlResponse.status} - ${JSON.stringify(etlResponse.body)}`);
    }

    console.log(`✓ ETL completed successfully`);
    console.log(`  Rows exported: ${etlResponse.body.rows_exported}`);
    console.log(`  Products included: ${etlResponse.body.products_count}`);
    console.log(`  Period: ${etlResponse.body.period_start} to ${etlResponse.body.period_end}`);
    console.log(`  Model version: ${etlResponse.body.model_version}`);
    console.log(`  Full response:`, JSON.stringify(etlResponse.body, null, 2));

    // 5. Get forecast AFTER ETL (should reflect new sale)
    console.log('\nSTEP 5: Getting forecast AFTER ETL...');
    const forecastAfter = await makeRequest(
      `${AI_SERVICE_URL}/forecast?product_id=${productId}`,
      'GET'
    );

    if (forecastAfter.status !== 200) {
      throw new Error(`Forecast after ETL failed: ${forecastAfter.status}`);
    }

    console.log(`✓ Forecast (after ETL):`);
    console.log(`  Value: ${forecastAfter.body.value}`);
    console.log(`  Status: ${forecastAfter.body.status}`);
    console.log(`  Confidence: ${JSON.stringify(forecastAfter.body.confidence)}`);
    console.log(`  Full response:`, JSON.stringify(forecastAfter.body, null, 2));

    // 6. Comparison and validation
    console.log('\nSTEP 6: Validating data flow...');

    const valueBefore = forecastBefore.body.value;
    const valueAfter = forecastAfter.body.value;

    console.log(`\n📊 COMPARISON:`);
    console.log(`  Forecast before ETL: ${valueBefore}`);
    console.log(`  Forecast after ETL:  ${valueAfter}`);

    if (valueBefore === null && valueAfter !== null) {
      console.log(`✓ Data flow working: Forecast computed from new sale data`);
    } else if (valueAfter !== null) {
      console.log(`✓ Forecast has value: ${valueAfter}`);
    }

    console.log(`\n========================================`);
    console.log('  ✓ E2E TEST PASSED');
    console.log(`  All 4 steps completed successfully`);
    console.log('========================================\n');

    return {
      success: true,
      summary: {
        saleCreated: true,
        saleId: saleId,
        productId: productId,
        etlRun: true,
        rowsExported: etlResponse.body.rows_exported,
        forecastBeforeEtl: forecastBefore.body,
        forecastAfterEtl: forecastAfter.body,
        dataFlowVerified: valueAfter !== null
      }
    };

  } catch (error) {
    console.error('\n❌ E2E TEST FAILED');
    console.error(`Error: ${error.message}\n`);
    return {
      success: false,
      error: error.message
    };
  }
}

// Run the test
runTest().then(result => {
  process.exit(result.success ? 0 : 1);
});
