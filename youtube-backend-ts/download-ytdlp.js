// Simple script to download yt-dlp
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const isWindows = process.platform === 'win32';
const ytDlpUrl = isWindows 
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

const outputFile = path.join(__dirname, isWindows ? 'yt-dlp.exe' : 'yt-dlp');

console.log(`Downloading yt-dlp from ${ytDlpUrl} to ${outputFile}`);

const file = fs.createWriteStream(outputFile);
https.get(ytDlpUrl, (response) => {
  response.pipe(file);
  
  file.on('finish', () => {
    file.close();
    console.log('Download completed');
    
    // Make the file executable on non-Windows platforms
    if (!isWindows) {
      try {
        execSync(`chmod +x ${outputFile}`);
        console.log('Made file executable');
      } catch (error) {
        console.error('Failed to make file executable:', error);
      }
    }
    
    // Test yt-dlp
    try {
      const version = execSync(`"${outputFile}" --version`).toString().trim();
      console.log(`yt-dlp version: ${version}`);
      console.log('yt-dlp is working correctly');
    } catch (error) {
      console.error('Failed to run yt-dlp:', error);
    }
  });
}).on('error', (err) => {
  fs.unlink(outputFile, () => {});
  console.error('Error downloading yt-dlp:', err);
}); 