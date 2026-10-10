// Test timestamp generation
const fs = require('fs');
const content = fs.readFileSync('src/clipboard-store.js', 'utf8');

// Extract the nextTimestamp function
const funcStart = content.indexOf('function nextTimestamp()');
const funcEnd = content.indexOf('}', content.indexOf('}', content.indexOf('function nextTimestamp()'))) + 1;
const funcCode = content.substring(funcStart, funcEnd);

eval(funcCode);

console.log('Testing nextTimestamp...');
for (let i = 0; i < 10; i++) {
  console.log(nextTimestamp());
}