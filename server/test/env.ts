// Tests never read server/.env: they get a separate database and dummy secrets.
export const testEnv = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://sonicvote:sonicvote@127.0.0.1:5433/sonicvote_test',
  CLIENT_URL: 'http://127.0.0.1:5173',
  JWT_SECRET: 'test-secret-test-secret-test-secret',
  TOKEN_ENCRYPTION_KEY: '0'.repeat(64),
  SPOTIFY_CLIENT_ID: 'test',
  SPOTIFY_CLIENT_SECRET: 'test',
  SPOTIFY_REDIRECT_URI: 'http://127.0.0.1:4000/api/auth/spotify/callback',
  RAZORPAY_KEY_ID: 'rzp_test_key',
  RAZORPAY_KEY_SECRET: 'rzp_test_secret',
  RAZORPAY_PLAN_ID: 'plan_test',
  RAZORPAY_HOST_PLAN_ID: 'plan_host_test',
  RAZORPAY_WEBHOOK_SECRET: 'webhook_test_secret',
  ADMIN_SPOTIFY_IDS: 'admin-spotify-id',
}
