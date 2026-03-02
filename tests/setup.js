/**
 * Jest test setup – set required environment variables
 * so server/index.js doesn't call process.exit(1) during import
 */

// Set NODE_ENV to development so auth middleware skips signature verification
process.env.NODE_ENV                 = 'development';
process.env.SUPABASE_URL             = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.ANTHROPIC_API_KEY         = 'test-anthropic-api-key';
process.env.CALCOM_API_KEY            = 'test-calcom-api-key';
process.env.CALCOM_EVENT_TYPE_ID      = '12345';
process.env.CALCOM_USERNAME           = 'test-user';
process.env.PORT                      = '0';

// Clear webhook secret so auth middleware skips HMAC verification (dotenv won't overwrite)
process.env.VAPI_WEBHOOK_SECRET       = '';
