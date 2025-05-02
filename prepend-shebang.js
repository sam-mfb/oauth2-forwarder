const fs = require('fs');
const path = require('path');

const nodeShebang = '#!/usr/bin/env node\n';
const shFiles = '#!/usr/bin/env sh\n';

// Node.js files
const jsFiles = ['o2f-server.js', 'o2f-client.js'];
const distPath = path.join(__dirname, 'dist');

// Handle JS files
jsFiles.forEach(file => {
  const filePath = path.join(distPath, file);
  
  if (fs.existsSync(filePath)) {
    // Read the file content
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check if shebang is already there
    if (!content.startsWith('#!')) {
      console.log(`Adding node shebang to ${file}`);
      // Write the file with shebang prepended
      fs.writeFileSync(filePath, nodeShebang + content);
      // Make the file executable
      fs.chmodSync(filePath, '755');
    } else {
      console.log(`Shebang already exists in ${file}`);
    }
  } else {
    console.error(`File not found: ${filePath}`);
  }
});

// Handle browser script
const browserFile = path.join(__dirname, 'browser-global.sh');
if (fs.existsSync(browserFile)) {
  // Read the file content
  const content = fs.readFileSync(browserFile, 'utf8');
  
  // Check if shebang is already there and set executable flag regardless
  fs.chmodSync(browserFile, '755');
  
  if (!content.startsWith('#!')) {
    console.log(`Adding sh shebang to browser-global.sh`);
    // Write the file with shebang prepended
    fs.writeFileSync(browserFile, shFiles + content);
  } else {
    console.log(`Shebang already exists in browser-global.sh`);
  }
} else {
  console.error(`File not found: ${browserFile}`);
}