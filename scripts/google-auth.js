/**
 * One-time script: Get Google OAuth2 credentials for Sheets API
 * Run: node scripts/google-auth.js
 *
 * Uses Google Cloud SDK's known public OAuth2 client (Application Default Credentials flow)
 */
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { exec } = require('child_process');

// OAuth2 client — ดูได้จาก Google Cloud Console > APIs & Services > Credentials
// ใส่ค่าจริงใน .env หรือ pass ผ่าน environment variable
const CLIENT_ID     = process.env.GOOGLE_OAUTH_CLIENT_ID     || 'YOUR_CLIENT_ID_HERE';
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || 'YOUR_CLIENT_SECRET_HERE';
const REDIRECT_URI  = 'http://localhost:3001/oauth2callback';
const SCOPE         = 'https://www.googleapis.com/auth/spreadsheets';

const authUrl =
  'https://accounts.google.com/o/oauth2/auth' +
  '?client_id='    + encodeURIComponent(CLIENT_ID) +
  '&redirect_uri=' + encodeURIComponent(REDIRECT_URI) +
  '&response_type=code' +
  '&scope='        + encodeURIComponent(SCOPE) +
  '&access_type=offline' +
  '&prompt=consent';

console.log('\n=== Google OAuth2 Setup ===');
console.log('Opening browser...');
console.log('If nothing opens, paste this URL in Chrome:\n');
console.log(authUrl + '\n');

// Open browser (Windows)
exec('start "" "' + authUrl + '"', err => {
  if (err) console.log('Could not auto-open browser — paste URL manually');
});

// Local server to catch callback
const server = http.createServer((req, res) => {
  const url   = new URL(req.url, 'http://localhost:3001');
  const code  = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    console.error('Auth error:', error);
    res.end('<h2>Authorization failed: ' + error + '</h2>');
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.end('<h2>Waiting...</h2>');
    return;
  }

  console.log('Authorization code received. Exchanging for tokens...');

  const body = new URLSearchParams({
    code,
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri:  REDIRECT_URI,
    grant_type:    'authorization_code',
  }).toString();

  const tokenReq = https.request({
    hostname: 'oauth2.googleapis.com',
    path:     '/token',
    method:   'POST',
    headers:  {
      'Content-Type':   'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  }, tokenRes => {
    let data = '';
    tokenRes.on('data', chunk => (data += chunk));
    tokenRes.on('end', () => {
      const tokens = JSON.parse(data);

      if (tokens.error) {
        console.error('Token exchange failed:', tokens.error, tokens.error_description);
        res.end('<h2>Token error: ' + tokens.error_description + '</h2>');
        server.close();
        process.exit(1);
        return;
      }

      // Save as authorized_user format (compatible with Application Default Credentials)
      const creds = {
        type:          'authorized_user',
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: tokens.refresh_token,
      };

      const credDir  = path.join(__dirname, '..', 'credentials');
      const credFile = path.join(credDir, 'google-oauth2.json');

      if (!fs.existsSync(credDir)) fs.mkdirSync(credDir, { recursive: true });
      fs.writeFileSync(credFile, JSON.stringify(creds, null, 2));

      console.log('\n✅ สำเร็จ! บันทึกไฟล์ที่:', credFile);
      console.log('\nเพิ่มบรรทัดนี้ใน .env:');
      console.log('GOOGLE_APPLICATION_CREDENTIALS=./credentials/google-oauth2.json\n');

      res.end('<h2 style="color:green">✅ สำเร็จ! ปิด Tab นี้ได้เลย</h2>');
      server.close();
      process.exit(0);
    });
  });

  tokenReq.on('error', err => {
    console.error('Request error:', err);
    server.close();
    process.exit(1);
  });

  tokenReq.write(body);
  tokenReq.end();
});

server.listen(3001, () => {
  console.log('Waiting for callback on http://localhost:3001 ...\n');
});
