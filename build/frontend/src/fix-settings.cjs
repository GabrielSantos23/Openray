const fs = require('fs');
let content = fs.readFileSync('src/Settings.tsx', 'utf8');

const oldBlock = `  // Migrate localStorage usage data to backend on first run
  useEffect(() => {
    const migrationDone = localStorage.getItem("raycast-mini:usage-migrated");
    if (migrationDone) return;
    
    const usageData = {};
    const fileUsageData = {};
    const argumentHistoryData = {};
    
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith("raycast-mini:usage:")) {
          usageData[key.slice("raycast-mini:usage:".length)] = localStorage.getItem(key);
        } else if (key?.startsWith("raycast-mini:file-usage:")) {
          fileUsageData[key.slice("raycast-mini:file-usage:".length)] = localStorage.getItem(key);
        } else if (key?.startsWith("raycast-mini:argument-history:")) {
          argumentHistoryData[key.slice("raycast-mini:argument-history:".length)] = localStorage.getItem(key);
        }
      } catch {
        // Ignore errors
      }
      
      if (Object.keys(usageData).length > 0 || Object.keys(fileUsageData).length > 0 || Object.keys(argumentHistoryData).length > 0) {
        void ipc.backend("usage.migrateFromLocalStorage", { data: { usageData, fileUsageData, argumentHistoryData } }, { module: "backend" })
          .then(() => {
            localStorage.setItem("raycast-mini:usage-migrated", "true");
          })
          .catch(() => {
            // Ignore migration errors
          });
      }
  }, []);`;

const newBlock = `// Migrate localStorage usage data to backend on first run
  useEffect(() => {
    const migrationDone = localStorage.getItem("raycast-mini:usage-migrated");
    if (migrationDone) return;
    
    const usageData = {};
    const fileUsageData = {};
    const argumentHistoryData = {};
    
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith("raycast-mini:usage:")) {
          usageData[key.slice("raycast-mini:usage:".length)] = localStorage.getItem(key);
        } else if (key?.startsWith("raycast-mini:file-usage:")) {
          fileUsageData[key.slice("raycast-mini:file-usage:".length)] = localStorage.getItem(key);
        } else if (key?.startsWith("raycast-mini:argument-history:")) {
          argumentHistoryData[key.slice("raycast-mini:argument-history:".length)] = localStorage.getItem(key);
        }
      }
    } catch {
      // Ignore errors
    }
    
    if (Object.keys(usageData).length > 0 || Object.keys(fileUsageData).length > 0 || Object.keys(argumentHistoryData).length > 0) {
      void ipc.backend("usage.migrateFromLocalStorage", { data: { usageData, fileUsageData, argumentHistoryData } }, { module: "backend" })
        .then(() => {
          localStorage.setItem("raycast-mini:usage-migrated", "true");
        })
        .catch(() => {
          // Ignore migration errors
        });
    }
  }, []);`;

content = content.replace(oldBlock, newBlock);
fs.writeFileSync('src/Settings.tsx', content);
console.log('Fixed');