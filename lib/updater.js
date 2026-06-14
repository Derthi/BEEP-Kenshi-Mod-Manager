const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const REPO = 'Derthi/BEEP-Kenshi-Mod-Manager';
const CURRENT_VERSION = require('../package.json').version;

/**
 * Check GitHub releases for a newer version.
 * Returns { hasUpdate, currentVersion, latestVersion, downloadUrl, releaseUrl } or null on error.
 */
function checkForUpdate() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${REPO}/releases/latest`,
      method: 'GET',
      headers: { 'User-Agent': 'kenshi-mod-manager' },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          const latestTag = (release.tag_name || '').replace(/^v/, '');
          const hasUpdate = compareVersions(latestTag, CURRENT_VERSION) > 0;

          // Pick the asset for THIS OS. The old code took the first .zip, but GitHub lists the
          // Linux zip before the Windows one, so every Windows in-app update pulled the Linux build
          // and the auto-extract overwrote the install with Linux binaries (bricking the app).
          const assets = (release.assets || []).filter((a) => a.browser_download_url);
          let asset = null;
          if (process.platform === 'win32') {
            asset = assets.find((a) => /win/i.test(a.name) && a.name.toLowerCase().endsWith('.zip'));
          } else if (process.platform === 'linux') {
            asset = assets.find((a) => /linux/i.test(a.name));
          }

          resolve({
            hasUpdate,
            currentVersion: CURRENT_VERSION,
            latestVersion: latestTag,
            downloadUrl: asset ? asset.browser_download_url : null,
            releaseUrl: release.html_url || `https://github.com/${REPO}/releases/latest`,
            releaseName: release.name || `v${latestTag}`,
            body: release.body || '',
          });
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

/**
 * Download the update zip and extract it, replacing the current app files.
 * Returns { success, error? }
 */
function downloadAndApplyUpdate(downloadUrl, appPath) {
  return new Promise((resolve) => {
    // Safety net: the in-app apply is Windows-only (it shells out to PowerShell Expand-Archive) and
    // must NEVER extract a non-Windows archive over the install. Refuse anything but the Windows zip.
    const fileName = (downloadUrl || '').split('?')[0].split('/').pop().toLowerCase();
    if (process.platform !== 'win32' || !/win/.test(fileName) || !fileName.endsWith('.zip')) {
      resolve({ success: false, error: 'Automatic install is only supported on Windows. Please download the update manually.' });
      return;
    }

    const zipPath = path.join(appPath, '..', 'update.zip');
    const extractDir = appPath;

    // Follow redirects manually (GitHub redirects to S3)
    function download(url) {
      const proto = url.startsWith('https') ? https : require('http');
      proto.get(url, { headers: { 'User-Agent': 'kenshi-mod-manager' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          download(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          resolve({ success: false, error: `Download failed: HTTP ${res.statusCode}` });
          return;
        }

        const file = fs.createWriteStream(zipPath);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          // Extract using PowerShell
          const cmd = `powershell.exe -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`;
          exec(cmd, { timeout: 60000 }, (err) => {
            // Clean up zip
            try { fs.unlinkSync(zipPath); } catch {}
            if (err) {
              resolve({ success: false, error: 'Extraction failed: ' + err.message });
            } else {
              resolve({ success: true });
            }
          });
        });
        file.on('error', (err) => {
          resolve({ success: false, error: err.message });
        });
      }).on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    }

    download(downloadUrl);
  });
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

module.exports = { checkForUpdate, downloadAndApplyUpdate };
