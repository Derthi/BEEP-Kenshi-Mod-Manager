const https = require('https');

/**
 * Fetch full workshop item details from the Steam Web API.
 * Uses the public GetPublishedFileDetails endpoint (no API key needed).
 * Takes an array of workshop IDs (strings), returns a map of id -> { title, description }.
 */
function fetchWorkshopDetails(workshopIds) {
  return new Promise((resolve) => {
    if (!workshopIds || workshopIds.length === 0) {
      resolve({});
      return;
    }

    // Build form data
    const params = [`itemcount=${workshopIds.length}`];
    workshopIds.forEach((id, i) => {
      params.push(`publishedfileids[${i}]=${id}`);
    });
    const postData = params.join('&');

    const options = {
      hostname: 'api.steampowered.com',
      path: '/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const result = {};
          const items = json?.response?.publishedfiledetails || [];
          for (const item of items) {
            if (item.result === 1) {
              const tags = (item.tags || []).map((t) => t.tag).filter(Boolean);
              result[item.publishedfileid] = {
                title: item.title || '',
                description: item.description || '',
                tags,
              };
            }
          }
          resolve(result);
        } catch {
          resolve({});
        }
      });
    });

    req.on('error', () => resolve({}));
    req.setTimeout(15000, () => { req.destroy(); resolve({}); });
    req.write(postData);
    req.end();
  });
}

module.exports = { fetchWorkshopDetails };
