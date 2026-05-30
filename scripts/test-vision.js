/**
 * End-to-end test: run Gemini Vision against real bill images in Bill/
 * Ground truth comes from folder name (รายจ่าย / รายรับ).
 *
 * Run: node scripts/test-vision.js
 */
require('dotenv/config');
const fs = require('fs');
const path = require('path');
const { extractReceiptData } = require('../dist/services/vision.service');

const BILL_DIR = path.join(__dirname, '..', 'Bill');

// Gemini free tier: 15 req/min → wait 5s between calls to be safe
const DELAY_MS = 7000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function collectImages() {
  const out = [];
  for (const typeDir of fs.readdirSync(BILL_DIR)) {
    const full = path.join(BILL_DIR, typeDir);
    if (!fs.statSync(full).isDirectory()) continue;
    const expectedType = typeDir; // "รายจ่าย" or "รายรับ"
    for (const file of fs.readdirSync(full)) {
      if (/\.(jpe?g|png)$/i.test(file)) {
        out.push({ file: path.join(full, file), name: file, expectedType });
      }
    }
  }
  return out;
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY not set in .env');
    process.exit(1);
  }

  const images = collectImages();
  console.log(`\n🧪 Testing ${images.length} bill images with Gemini Vision\n`);
  console.log('═'.repeat(80));

  const results = [];
  let typeCorrect = 0;
  let extractOk = 0;
  let errors = 0;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const buf = fs.readFileSync(img.file);
    process.stdout.write(`[${i + 1}/${images.length}] ${img.name.padEnd(22)} `);

    try {
      const r = await extractReceiptData(buf);

      if (r.error) {
        console.log(`⚠️  REJECTED: ${r.error}`);
        errors++;
        results.push({ ...img, status: 'rejected', detail: r.error });
      } else {
        extractOk++;
        const typeMatch = r.transaction_type === img.expectedType;
        if (typeMatch) typeCorrect++;
        const mark = typeMatch ? '✅' : '❌';
        console.log(
          `${mark} ${r.transaction_type.padEnd(8)} | ฿${String(r.total_amount).padStart(10)} | ${r.category.padEnd(20)} | ${r.merchant_name.slice(0, 25)}`
        );
        results.push({ ...img, status: 'ok', extracted: r, typeMatch });
      }
    } catch (err) {
      console.log(`💥 ERROR: ${err.message}`);
      errors++;
      results.push({ ...img, status: 'error', detail: err.message });
    }

    if (i < images.length - 1) await sleep(DELAY_MS);
  }

  console.log('═'.repeat(80));
  console.log('\n📊 SUMMARY\n');
  console.log(`   Total images       : ${images.length}`);
  console.log(`   Extracted OK       : ${extractOk}`);
  console.log(`   Errors/rejected    : ${errors}`);
  console.log(`   Type accuracy      : ${typeCorrect}/${extractOk} (${extractOk ? Math.round((typeCorrect / extractOk) * 100) : 0}%)`);

  // Show mismatches
  const mismatches = results.filter((r) => r.status === 'ok' && !r.typeMatch);
  if (mismatches.length) {
    console.log('\n⚠️  Type mismatches:');
    for (const m of mismatches) {
      console.log(`   ${m.name}: expected ${m.expectedType}, got ${m.extracted.transaction_type}`);
    }
  }

  const failed = results.filter((r) => r.status !== 'ok');
  if (failed.length) {
    console.log('\n💥 Failed extractions:');
    for (const f of failed) {
      console.log(`   ${f.name}: ${f.detail}`);
    }
  }

  console.log('');
  process.exit(errors > 0 || typeCorrect < extractOk ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
