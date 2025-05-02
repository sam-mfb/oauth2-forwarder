const fs = require('fs');
const path = require('path');

const shebang = '#!/usr/bin/env node\n';
const files = ['o2f-server.js', 'o2f-client.js'];
const distPath = path.join(__dirname, 'dist');

files.forEach(file => {
  const filePath = path.join(distPath, file);
  
  if (fs.existsSync(filePath)) {
    // Read the file content
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check if shebang is already there
    if (!content.startsWith('#!')) {
      console.log(`Adding shebang to ${file}`);
      // Write the file with shebang prepended
      fs.writeFileSync(filePath, shebang + content);
      // Make the file executable
      fs.chmodSync(filePath, '755');
    } else {
      console.log(`Shebang already exists in ${file}`);
    }
  } else {
    console.error(`File not found: ${filePath}`);
  }
});