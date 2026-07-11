import 'dotenv/config';
import {
  S3Client,
  GetBucketCorsCommand,
  PutBucketCorsCommand,
} from '@aws-sdk/client-s3';

// Ops tool: apply the R2 CORS policy the Tour Gallery direct-to-R2 uploads
// REQUIRE (browsers preflight every cross-origin PUT; without these rules R2
// answers 403 and every upload fails as a "network error").
//
//   node scripts/setup-r2-cors.mjs           → show current + required policy
//   node scripts/setup-r2-cors.mjs --apply   → write the policy to the bucket
//
// NOTE: needs an R2 API token with bucket-settings (Admin) permission —
// object read/write tokens get AccessDenied on Get/PutBucketCors. If this
// script is denied, paste EXACTLY the policy it prints into the Cloudflare
// dashboard: R2 → <bucket> → Settings → CORS policy.

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
const APP_ORIGIN = process.env.CANONICAL_ORIGIN || 'https://app.grafitiyul.co.il';

export const REQUIRED_CORS_RULES = [
  {
    AllowedOrigins: [APP_ORIGIN, 'http://localhost:5173'],
    AllowedMethods: ['PUT', 'GET', 'HEAD'],
    AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag'],
    MaxAgeSeconds: 3600,
  },
];

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

console.log('Required CORS policy for bucket', R2_BUCKET, '\n', JSON.stringify(REQUIRED_CORS_RULES, null, 2));

try {
  const current = await client.send(new GetBucketCorsCommand({ Bucket: R2_BUCKET }));
  console.log('\nCurrent policy:', JSON.stringify(current.CORSRules, null, 2));
} catch (e) {
  console.log('\nCurrent policy: unreadable →', e.name, e.message);
}

if (process.argv.includes('--apply')) {
  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: R2_BUCKET,
        CORSConfiguration: { CORSRules: REQUIRED_CORS_RULES },
      }),
    );
    console.log('\n✓ CORS policy applied.');
  } catch (e) {
    console.error('\n✗ Could not apply policy:', e.name, e.message);
    console.error('Apply it manually in the Cloudflare dashboard (R2 → bucket → Settings → CORS).');
    process.exitCode = 1;
  }
}
