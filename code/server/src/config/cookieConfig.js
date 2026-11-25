// In production with HTTPS (or cross-origin extension use): sameSite='none' + secure=true
// In HTTP-only deployments (initial EC2 without SSL): sameSite='lax' + secure=false
// Set USE_HTTPS=true in .env once Certbot/SSL is configured.
const useHTTPS = (process.env.USE_HTTPS || 'true').toLowerCase() === 'true';

export const getCookieOptions = () => ({
  httpOnly: true,
  sameSite: useHTTPS ? 'none' : 'lax',
  secure: useHTTPS,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
});

export const getClearCookieOptions = () => ({
  httpOnly: true,
  sameSite: useHTTPS ? 'none' : 'lax',
  secure: useHTTPS,
  path: '/',
});
