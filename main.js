const https = require("https");
const fs = require("fs");

const APIs = [
  {
    name: "Basic API",
    url: "https://catalog.roproxy.com/v1/search/items/details?Category=12&Subcategory=39&Limit=30",
    outputFile: "emotedata.json"
  },
  {
    name: "Latest API",
    url: "https://catalog.roproxy.com/v1/search/items/details?Category=12&Subcategory=39&Limit=30&salesTypeFilter=1&SortType=3",
    outputFile: "emotedata.json"
  },
  {
    name: "Animation API",
    url: "https://catalog.roproxy.com/v1/search/items/details?Category=12&Subcategory=38&salesTypeFilter=1&Limit=30",
    outputFile: "animationdata.json"
  }
];

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function loadData(file) {
  try {
    if (fs.existsSync(file)) {
      const content = JSON.parse(fs.readFileSync(file, "utf8"));
      const items = content.data || [];
      const ids = new Set(items.map(i => i.id));
      return { items, ids };
    }
  } catch {
    log(`Error reading ${file}, starting fresh`);
  }
  return { items: [], ids: new Set() };
}

function saveData(items, file) {
  try {
    const output = {
      keyword: null,
      totalItems: items.length,
      lastUpdate: new Date().toISOString(),
      data: items
    };
    fs.writeFileSync(file, JSON.stringify(output, null, 2), "utf8");
    return true;
  } catch (e) {
    log(`Save error for ${file}: ${e.message}`);
    return false;
  }
}

function fetchJSON(url, retries = 3) {
  return new Promise((resolve, reject) => {
    const tryFetch = (attempt) => {
      const timeout = setTimeout(() => reject(new Error("Request timeout")), 30000);

      https.get(url, res => {
        clearTimeout(timeout);
        let data = "";

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("JSON parse error"));
          }
        });
      }).on("error", e => {
        clearTimeout(timeout);
        if (attempt < retries) setTimeout(() => tryFetch(attempt + 1), 2000 * attempt);
        else reject(e);
      });
    };

    tryFetch(1);
  });
}

async function fetchAPI(api, existingData) {
  const allItems = [];
  let cursor = "";
  let page = 0;
  let newCount = 0;
  let duplicateCount = 0;

  try {
    do {
      page++;
      log(`${api.name} - Page ${page}`);

      const url = cursor ? `${api.url}&Cursor=${cursor}` : api.url;
      const res = await fetchJSON(url);

      if (res.data && Array.isArray(res.data)) {
        res.data.forEach(item => {
          if (existingData.ids.has(item.id)) duplicateCount++;
          else {
            const record = { id: item.id, name: item.name };

            if (item.bundledItems?.length) {
              const bundled = {};
              let counter = 1;
              item.bundledItems.forEach(b => {
                if (b.type !== "UserOutfit" && b.id) {
                  const key = (counter++).toString();
                  bundled[key] = bundled[key] || [];
                  bundled[key].push(b.id);
                }
              });
              if (Object.keys(bundled).length) record.bundledItems = bundled;
            }

            allItems.push(record);
            existingData.ids.add(item.id);
            newCount++;
          }
        });
      }

      cursor = res.nextPageCursor;
      await new Promise(r => setTimeout(r, 1000));
    } while (cursor && cursor.trim() !== "");
  } catch (e) {
    log(`Error in ${api.name}: ${e.message}`);
  }

  return { items: allItems, newCount, duplicateCount };
}

async function processAPIs() {
  const start = Date.now();
  log("Starting combined update...");

  const grouped = APIs.reduce((acc, api) => {
    acc[api.outputFile] = acc[api.outputFile] || [];
    acc[api.outputFile].push(api);
    return acc;
  }, {});

  const results = {};

  for (const [file, apis] of Object.entries(grouped)) {
    log(`Processing ${file}...`);

    const existingData = loadData(file);
    const allItems = [...existingData.items];
    let newTotal = 0;
    let dupTotal = 0;

    for (const api of apis) {
      const result = await fetchAPI(api, existingData);
      allItems.push(...result.items);
      newTotal += result.newCount;
      dupTotal += result.duplicateCount;
      log(`${api.name} - New: ${result.newCount}, Duplicates: ${result.duplicateCount}`);
    }

    const saved = saveData(allItems, file);
    results[file] = { success: saved, total: allItems.length, newTotal, dupTotal };
    log(`${file} - Total: ${allItems.length}, New: ${newTotal}`);
  }

  log(`All updates complete - Duration: ${((Date.now() - start)/1000).toFixed(2)}s`);
  return results;
}

async function main() {
  log("Starting catalog-sniper update...");

  try {
    const results = await processAPIs();
    let allOk = true;

    for (const [file, r] of Object.entries(results)) {
      if (!r.success) {
        allOk = false;
        log(`Failed to save ${file}`);
      } else {
        log(`✓ ${file}: ${r.total} items (${r.newTotal} new)`);
      }
    }

    allOk ? log("catalog-sniper completed successfully") : log("catalog-sniper completed with some errors");
    process.exit(allOk ? 0 : 1);

  } catch (e) {
    log(`catalog-sniper error: ${e.message}`);
    process.exit(1);
  }
}

process.on("unhandledRejection", reason => {
  log(`Unhandled error: ${reason}`);
  process.exit(1);
});

process.on("uncaughtException", e => {
  log(`Uncaught exception: ${e.message}`);
  process.exit(1);
});

main();
