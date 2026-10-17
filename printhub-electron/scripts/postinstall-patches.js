const fs = require('fs');
const path = require('path');

// 1. Patch got missing types.js
const gotTypes = path.join(__dirname, '../node_modules/got/dist/source/types.js');
if (fs.existsSync(path.dirname(gotTypes)) && !fs.existsSync(gotTypes)) {
  fs.writeFileSync(gotTypes, '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\n');
  console.log('Patched got missing types.js');
}

// 2. Patch @supabase/realtime-js missing version.js
const rtVersionMain = path.join(__dirname, '../node_modules/@supabase/realtime-js/dist/main/lib/version.js');
if (fs.existsSync(path.dirname(rtVersionMain)) && !fs.existsSync(rtVersionMain)) {
  fs.writeFileSync(rtVersionMain, '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.version = "2.105.4";\n');
  console.log('Patched @supabase/realtime-js dist/main/lib/version.js');
}

const rtVersionMod = path.join(__dirname, '../node_modules/@supabase/realtime-js/dist/module/lib/version.js');
if (fs.existsSync(path.dirname(rtVersionMod)) && !fs.existsSync(rtVersionMod)) {
  fs.writeFileSync(rtVersionMod, 'export const version = "2.105.4";\n');
  console.log('Patched @supabase/realtime-js dist/module/lib/version.js');
}
