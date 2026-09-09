// Loaded by Jest before application modules so JwtModule/AuthService can be
// initialized normally. External services are explicitly mocked in e2e tests.
process.env.JWT_SECRET = 'e2e-access-token-secret';
process.env.JWT_REFRESH_SECRET = 'e2e-refresh-token-secret';
