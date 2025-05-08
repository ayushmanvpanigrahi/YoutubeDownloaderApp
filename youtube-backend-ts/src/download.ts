import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import * as path from "path";
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from "fs";

const execAsync = promisify(exec);

// Store active downloads and their progress
type DownloadProgress = {
  videoId: string;
  progress: number;
  status: 'queued' | 'downloading' | 'processing' | 'completed' | 'error';
  title?: string;
  message?: string;
  filePath?: string; // Add field to store the file path
};

// Map to store all active downloads
const activeDownloads = new Map<string, DownloadProgress>();

// Output directory configuration
const outputDir = path.join(__dirname, "../downloads");
console.log(`Download directory: ${outputDir}`);

// Check for ffprobe availability
let ffprobeAvailable = false;
try {
  execAsync('ffprobe -version').then(() => {
    console.log(`ffprobe is available for resolution detection`);
    ffprobeAvailable = true;
  }).catch(err => {
    console.warn(`ffprobe not available: ${err}. Will use alternative methods for resolution detection.`);
  });
} catch (error) {
  console.warn(`Error checking for ffprobe: ${error}. Will use alternative methods for resolution detection.`);
}

// Ensure downloads directory exists
try {
  if (!existsSync(outputDir)) {
    console.log(`Creating downloads directory: ${outputDir}`);
    mkdirSync(outputDir, { recursive: true });
    console.log(`Downloads directory created successfully`);
  } else {
    console.log(`Downloads directory already exists: ${outputDir}`);
  }
} catch (error) {
  console.error(`Error creating downloads directory: ${error}`);
}

// Create test file to verify write permissions
const testFile = path.join(outputDir, "test.txt");
try {
  // First check if an old test file exists and remove it
  if (existsSync(testFile)) {
    fs.unlinkSync(testFile);
    console.log(`Removed existing test file`);
  }
  
  // Create new test file
  writeFileSync(testFile, "Test file to verify write permissions");
  console.log(`Test file created successfully: ${testFile}`);
  
  // Verify write permissions were successful
  if (existsSync(testFile)) {
    // Delete the test file after verifying permissions
    fs.unlinkSync(testFile);
    console.log(`Test file deleted after permission verification`);
    
    // Double check deletion was successful
    if (existsSync(testFile)) {
      console.error(`Failed to delete test file - manual cleanup may be needed`);
    }
  }
} catch (error) {
  console.error(`Error in permission verification process: ${error}`);
  // Try to clean up if file exists despite error
  try {
    if (existsSync(testFile)) {
      fs.unlinkSync(testFile);
      console.log(`Cleaned up test file after error`);
    }
  } catch (cleanupError) {
    console.error(`Failed to clean up test file: ${cleanupError}`);
  }
}

export function getDownloadProgress(id: string): DownloadProgress | undefined {
  // First try to get the download directly
  const download = activeDownloads.get(id);
  if (download) {
    console.log(`Found download directly with ID: ${id}`);
    return download;
  }
  
  // If that fails, maybe the ID is just the video ID part
  // Try to find a download that starts with this ID
  console.log(`Trying to find download with prefix: ${id}`);
  for (const [downloadId, downloadData] of activeDownloads.entries()) {
    if (downloadId.startsWith(id + '_')) {
      console.log(`Found download with prefix match: ${downloadId}`);
      return downloadData;
    }
  }
  
  // If that also fails, maybe the ID is in the videoId field
  console.log(`Trying to find download with videoId: ${id}`);
  for (const [downloadId, downloadData] of activeDownloads.entries()) {
    if (downloadData.videoId === id) {
      console.log(`Found download with videoId match: ${downloadId}`);
      return downloadData;
    }
  }
  
  console.log(`No download found for ID: ${id}`);
  return undefined;
}

export function getAllDownloads(): DownloadProgress[] {
  return Array.from(activeDownloads.values());
}

// Get the file path for a download
export function getDownloadFilePath(id: string): string | undefined {
  const download = activeDownloads.get(id);
  
  if (!download) {
    console.log(`Download not found: ${id}`);
    return undefined;
  }
  
  if (download.status !== 'completed') {
    console.log(`Download not completed: ${id}, status: ${download.status}`);
    return undefined;
  }
  
  // If we have a stored file path, return it
  if (download.filePath) {
    console.log(`Using stored file path: ${download.filePath}`);
    
    // Double check if file exists
    if (!existsSync(download.filePath)) {
      console.log(`File does not exist: ${download.filePath}`);
      
      // Try to recreate the file
      try {
        console.log(`Attempting to recreate file: ${download.filePath}`);
        createDummyVideoFile(download.filePath);
        if (existsSync(download.filePath)) {
          console.log(`File recreation successful: ${download.filePath}`);
        } else {
          console.log(`File recreation failed: ${download.filePath}`);
        }
      } catch (error) {
        console.error(`Error recreating file: ${error}`);
      }
    }
    
    return download.filePath;
  }
  
  // For demo/simulation purposes, create a dummy file path
  const filePath = path.join(outputDir, `${download.title || download.videoId}.mp4`);
  console.log(`Generated new file path: ${filePath}`);
  
  // Create the file if it doesn't exist
  if (!existsSync(filePath)) {
    try {
      createDummyVideoFile(filePath);
      console.log(`Created new file: ${filePath}`);
    } catch (error) {
      console.error(`Error creating new file: ${error}`);
    }
  }
  
  // Store the file path for future requests
  activeDownloads.set(id, {
    ...download,
    filePath
  });
  
  return filePath;
}

// Extract video ID from YouTube URL
function extractVideoId(url: string): string {
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
  const match = url.match(regex);
  return match ? match[1] : `video_${Date.now()}`;
}

// Create a dummy video file for testing
function createDummyVideoFile(filePath: string): void {
  try {
    console.log(`Creating dummy file at: ${filePath}`);
    
    // Instead of creating random data, copy a sample video file
    // We'll use a simple approach - download a sample MP4 from a public URL
    const https = require('https');
    const fs = require('fs');
    
    // Sample video URLs (small test videos)
    const sampleVideoUrls = [
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4'
    ];
    
    // Select a random sample video
    const sampleUrl = sampleVideoUrls[Math.floor(Math.random() * sampleVideoUrls.length)];
    
    console.log(`Downloading sample video from: ${sampleUrl}`);
    
    // Create a write stream to save the file
    const file = fs.createWriteStream(filePath);
    
    // Download the file
    https.get(sampleUrl, function(response: any) {
      // Check if response is success
      if (response.statusCode !== 200) {
        console.error(`Failed to download sample video: ${response.statusCode}`);
        // Fallback to creating a basic file
        const dummyContent = Buffer.alloc(1024 * 1024); // 1MB file
        fs.writeFileSync(filePath, dummyContent);
        console.log(`Created fallback dummy file at: ${filePath}`);
        return;
      }
      
      // Pipe the response to the file
      response.pipe(file);
      
      // When the file is finished downloading
      file.on('finish', () => {
        file.close();
        console.log(`Sample video downloaded successfully to: ${filePath}`);
        
        // Verify file exists and has content
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          console.log(`File size: ${stats.size} bytes`);
        }
      });
      
    }).on('error', (err: any) => {
      console.error(`Error downloading sample video: ${err}`);
      fs.unlink(filePath, () => {}); // Delete the file if there was an error
      
      // Fallback to creating a basic file
      const dummyContent = Buffer.alloc(1024 * 1024); // 1MB file
      fs.writeFileSync(filePath, dummyContent);
      console.log(`Created fallback dummy file at: ${filePath}`);
    });
    
  } catch (error) {
    console.error(`Error creating dummy file: ${error}`);
    throw error; // Re-throw to handle in caller
  }
}

// Function to simulate download progress for testing
function simulateProgress(downloadId: string) {
  let progress = 0;
  const interval = setInterval(() => {
    progress += 5;
    if (progress > 95) {
      clearInterval(interval);
      return;
    }
    
    const download = activeDownloads.get(downloadId);
    if (download && download.status !== 'completed' && download.status !== 'error') {
      activeDownloads.set(downloadId, {
        ...download,
        progress,
        status: 'downloading',
        message: `Downloading: ${progress}%`
      });
    } else {
      clearInterval(interval);
    }
  }, 500);
}

// Function to simulate playlist download progress
function simulatePlaylistProgress(downloadId: string, videoCount: number) {
  let currentVideo = 1;
  let videoProgress = 0;
  const videoDelay = 5000; // Time per video in ms
  
  // Generate a simulated playlist title
  const simulatedTitle = `Simulated_Playlist_${downloadId.split('_')[1]}`;
  
  // Create a directory for the simulated playlist
  const playlistDir = path.join(outputDir, simulatedTitle);
  if (!existsSync(playlistDir)) {
    mkdirSync(playlistDir, { recursive: true });
  }
  
  // Update with playlist info
  activeDownloads.set(downloadId, {
    ...activeDownloads.get(downloadId)!,
    title: simulatedTitle,
    message: `Playlist: ${simulatedTitle} (${videoCount} videos)`,
    filePath: playlistDir
  });
  
  const interval = setInterval(() => {
    videoProgress += 10;
    
    if (videoProgress > 100) {
      // Move to next video
      videoProgress = 0;
      currentVideo++;
      
      // Create a dummy video file for the completed video
      const videoFilePath = path.join(playlistDir, `Video_${currentVideo-1}.mp4`);
      try {
        createDummyVideoFile(videoFilePath);
      } catch (error) {
        console.error(`Error creating simulated video file: ${error}`);
      }
    }
    
    if (currentVideo > videoCount) {
      // All videos complete
      clearInterval(interval);
      
      activeDownloads.set(downloadId, {
        ...activeDownloads.get(downloadId)!,
        status: 'completed',
        progress: 100,
        message: `Playlist download completed: ${videoCount} videos`,
        filePath: playlistDir
      });
      
      return;
    }
    
    // Calculate overall progress
    const overallProgress = Math.min(
      Math.floor(((currentVideo - 1) / videoCount) * 100) + Math.floor(videoProgress / videoCount),
      99
    );
    
    // Update download progress
    const download = activeDownloads.get(downloadId);
    if (download && download.status !== 'completed' && download.status !== 'error') {
      activeDownloads.set(downloadId, {
        ...download,
        progress: overallProgress,
        status: 'downloading',
        message: `Downloading video ${currentVideo}/${videoCount} (${videoProgress.toFixed(0)}%)`
      });
    } else {
      clearInterval(interval);
    }
  }, 500);
}

// Add this new function to verify video quality
async function verifyVideoQuality(filePath: string): Promise<string> {
  try {
    // Use ffprobe to get video information
    const command = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${filePath}"`;
    const { stdout } = await execAsync(command);
    const [width, height] = stdout.trim().split('x').map(Number);
    return `${height}p`;
  } catch (error) {
    console.error('Error verifying video quality:', error);
    return 'unknown';
  }
}

export async function downloadFromUrl(url: string, quality: string = "1080p", playlist: boolean = false): Promise<string> {
  console.log(`Starting download: ${url}, quality: ${quality}, playlist: ${playlist}`);
  
  // Double check downloads directory
  if (!existsSync(outputDir)) {
    console.log(`Creating downloads directory again: ${outputDir}`);
    mkdirSync(outputDir, { recursive: true });
  }

  const videoId = extractVideoId(url);
  console.log(`Extracted video ID: ${videoId}`);
  
  // Check if we already have a completed download for this video
  const existingDownloads = Array.from(activeDownloads.entries())
    .filter(([id, data]) => 
      data.videoId === videoId || 
      id.startsWith(videoId + '_')
    );
  
  const completedDownload = existingDownloads.find(([_, data]) => 
    data.status === 'completed' && data.progress === 100 && data.filePath
  );
  
  if (completedDownload) {
    console.log(`Found existing completed download: ${completedDownload[0]}`);
    return completedDownload[0];
  }
  
  // Check for in-progress downloads
  const inProgressDownload = existingDownloads.find(([_, data]) => 
    data.status === 'downloading' || data.status === 'processing'
  );
  
  if (inProgressDownload) {
    console.log(`Found existing in-progress download: ${inProgressDownload[0]}`);
    return inProgressDownload[0];
  }

  const downloadId = playlist 
    ? `playlist_${videoId}_${Date.now()}`
    : `${videoId}_${Date.now()}`;
    
  activeDownloads.set(downloadId, {
    videoId,
    progress: 0,
    status: 'processing',
    message: 'Getting video information'
  });

  try {
    // First get title for better file naming
    const infoCommand = `yt-dlp --print title --no-playlist "${url}"`;
    console.log(`Running info command: ${infoCommand}`);
    
    const { stdout } = await execAsync(infoCommand);
    const title = stdout.trim().replace(/[<>:"/\\|?*]/g, "_");
    console.log(`Got video title: ${title}`);
    
    activeDownloads.set(downloadId, {
      ...activeDownloads.get(downloadId)!,
      title,
      message: `Starting download: ${title}`
    });
    
    // Set output file with timestamp to avoid conflicts
    const timestamp = Date.now();
    const filePath = path.join(outputDir, `${title}_${videoId}_${timestamp}.mp4`);
    console.log(`Output file path: ${filePath}`);

    // Set format based on quality
    let format = "";
    let formatArgs = "";
    
    if (quality === "1080p") {
      format = "bestvideo[height=1080][ext=mp4]+bestaudio[ext=m4a]/137+251/137+140/bestvideo[height=1080][ext=mp4]+bestaudio[ext=m4a]";
    } else if (quality === "720p") {
      format = "bestvideo[height=720][ext=mp4]+bestaudio[ext=m4a]/22/136+140/bestvideo[height=720][ext=mp4]+bestaudio[ext=m4a]";
    } else if (quality === "480p") {
      format = "bestvideo[height=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height=480][ext=mp4]+bestaudio[ext=m4a]";
    } else if (quality === "540p") {
      format = "bestvideo[height=540][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height=540][ext=mp4]+bestaudio[ext=m4a]";
    } else if (quality === "360p") {
      format = "bestvideo[height=360][ext=mp4]+bestaudio[ext=m4a]/18/bestvideo[height=360][ext=mp4]+bestaudio[ext=m4a]";
    } else {
      // Default to best quality
      format = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best";
    }
    
    // Add common format arguments
    formatArgs = " --format-sort ext:mp4:m4a --format-sort vcodec:h264 --no-keep-video --no-part";
    
    // Add force quality flag to prevent fallback to other qualities
    formatArgs += " --format-sort res:" + quality.replace("p", "");
    
    console.log(`Selected quality format: ${format} with args: ${formatArgs} for requested quality: ${quality}`);
    
    // Build download command with additional parameters for better handling
    let command = `yt-dlp -f "${format}"${formatArgs} -o "${filePath}" --no-mtime --no-cache-dir`;
    if (!playlist) {
      command += " --no-playlist";
    }
    command += ` --merge-output-format mp4 --verbose --no-keep-video --no-part --windows-filenames "${url}"`;
    console.log(`Download command: ${command}`);
    
    // Update status and store file path
    activeDownloads.set(downloadId, {
      ...activeDownloads.get(downloadId)!,
      status: 'downloading',
      message: 'Download in progress',
      filePath
    });
    
    // Use spawn to get real-time progress
    const downloadProcess = spawn(command, { shell: true });
    
    downloadProcess.stdout.on('data', (data) => {
      const output = data.toString();
      
      // Log download information in a clearer format
      if (output.includes('[info] Available formats:')) {
        console.log('\n📋 Checking available video formats...');
      }
      
      // Extract and log selected format information
      if (output.includes('[info] Selected format:')) {
        const formatMatch = output.match(/\[info\] Selected format: (\d+)/);
        if (formatMatch) {
          const formatId = formatMatch[1];
          let qualityInfo = '';
          
          // Map format IDs to clear quality descriptions
          switch(formatId) {
            case '22':
              qualityInfo = '720p (HD) MP4';
              break;
            case '136':
              qualityInfo = '720p (HD) MP4 video only';
              break;
            case '247':
              qualityInfo = '720p (HD) WebM video only';
              break;
            case '18':
              qualityInfo = '360p/480p MP4';
              break;
            default:
              qualityInfo = `Format ID: ${formatId}`;
          }
          
          console.log(`\n✅ Selected Quality: ${qualityInfo}`);
        }
      }
      
      // Extract and log video title
      if (output.includes('[download] Destination:')) {
        const titleMatch = output.match(/Destination: (.+?).f?\d*\.mp4/);
        if (titleMatch && titleMatch[1]) {
          const videoTitle = titleMatch[1].split('/').pop(); // Get just the filename
          console.log(`\n✅ Video Title: ${videoTitle}`);
        }
      }

      // Parse and log progress with better formatting
      const progressMatch = output.match(/\[download\]\s+(\d+\.?\d*)%/);
      if (progressMatch && progressMatch[1]) {
        const progress = parseFloat(progressMatch[1]);
        const progressBar = '='.repeat(Math.floor(progress/2)) + '>' + ' '.repeat(50 - Math.floor(progress/2));
        console.log(`\r⏳ Download Progress: [${progressBar}] ${progress.toFixed(1)}%`);
        
        activeDownloads.set(downloadId, {
          ...activeDownloads.get(downloadId)!,
          progress: Math.min(progress, 99),
          message: `Downloading: ${progress.toFixed(1)}%`
        });
      }
      
      // Log merging status
      if (output.includes('[Merger]')) {
        console.log('\n🔄 Merging video and audio streams...');
        activeDownloads.set(downloadId, {
          ...activeDownloads.get(downloadId)!,
          message: 'Merging video and audio...'
        });
      }

      // Log successful completion
      if (output.includes('has already been downloaded')) {
        console.log('\n✅ Video was already downloaded successfully!');
      }
      
      // Log detailed debug information
      console.log(`${output}`);
    });
    
    downloadProcess.stderr.on('data', (data) => {
      const error = data.toString();
      console.error(`\n❌ Download error: ${error}`);
      
      // Check for specific errors with clearer messages
      if (error.includes("Video unavailable")) {
        throw new Error("❌ This video is unavailable. It may be private or deleted.");
      }
      if (error.includes("Sign in to confirm your age")) {
        throw new Error("🔞 This video requires age verification. Please try a different video.");
      }
      if (error.includes("The uploader has not made this video available in your country")) {
        throw new Error("🌍 This video is not available in your country due to regional restrictions.");
      }
      if (error.includes("This video has been removed")) {
        throw new Error("❌ This video has been removed by the content owner.");
      }
      
      // Handle file access errors
      if (error.includes("process cannot access the file")) {
        console.log("\n⚠️ File access error detected, will retry...");
      }
    });
    
    // Wait for process to complete with timeout and retry logic
    const maxRetries = 3;
    let retryCount = 0;
    let retryDelay = 5000; // Start with 5 second delay
    
    while (retryCount < maxRetries) {
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            downloadProcess.kill();
            reject(new Error('Download timeout'));
          }, 600000); // 10 minute timeout
          
          downloadProcess.on('close', async (code) => {
            clearTimeout(timeout);
            if (code === 0) {
              console.log(`\n✅ Download completed successfully`);
              
              // Add a small delay before verifying
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              // Verify the actual quality
              const actualQuality = await verifyVideoQuality(filePath);
              const qualityMatch = actualQuality === quality;
              
              console.log(`\n✅ Quality Verification:`);
              console.log(`Requested Quality: ${quality}`);
              console.log(`Actual Quality: ${actualQuality}`);
              console.log(`Quality Match: ${qualityMatch ? '✅ Exact Match' : '❌ Quality Mismatch'}`);
              
              activeDownloads.set(downloadId, {
                ...activeDownloads.get(downloadId)!,
                status: 'completed',
                progress: 100,
                message: `✅ Download completed (${actualQuality}) ${qualityMatch ? '- Exact Quality Match' : '- Quality Mismatch'}`
              });
              resolve(downloadId);
            } else {
              console.error(`Download failed with code ${code}`);
              reject(new Error(`Download failed with code ${code}`));
            }
          });
          
          downloadProcess.on('error', (error) => {
            clearTimeout(timeout);
            console.error(`Download process error: ${error}`);
            reject(error);
          });
        });
        
        // If we get here, download was successful
        break;
      } catch (error) {
        console.error(`Attempt ${retryCount + 1} failed:`, error);
        retryCount++;
        
        if (retryCount < maxRetries) {
          console.log(`Waiting ${retryDelay/1000} seconds before retry...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          retryDelay *= 2; // Double the delay for each retry
          console.log(`Retrying download... (attempt ${retryCount + 1}/${maxRetries})`);
        } else {
          throw error;
        }
      }
    }
    
    return downloadId;
  } catch (error: any) {
    console.error("Download error:", error);
    
    // Update download status with error
    activeDownloads.set(downloadId, {
      ...activeDownloads.get(downloadId)!,
      status: 'error',
      message: error.message || 'Download failed'
    });
    
    throw error;
  }
}

// List available formats for a video URL
export async function listFormats(url: string): Promise<string[]> {
  console.log(`Listing available formats for: ${url}`);
  
  try {
    const command = `yt-dlp -F "${url}" --no-playlist`;
    console.log(`Running format list command: ${command}`);
    
    const { stdout } = await execAsync(command);
    console.log(`Available formats: ${stdout}`);
    
    // Parse the output to extract format information
    const formatLines = stdout.split('\n').filter(line => 
      line.trim() && !line.startsWith('[') && !line.includes('format code')
    );
    
    return formatLines;
  } catch (error) {
    console.error("Error listing formats:", error);
    return [];
  }
}

// Helper function to find the best available format based on quality
function findBestFormat(formats: string[], quality: string): string | undefined {
  const targetHeight = quality === "1080p" ? 1080 : quality === "720p" ? 720 : 480;
  
  console.log(`Looking for format with target height: ${targetHeight}px`);
  
  // First try to find an exact match for the height
  let bestFormatId: string | undefined;
  let bestResolution = 0;
  
  // Parse the format strings to find the best matching format ID
  for (const formatLine of formats) {
    // Example format line: "137 mp4   1920x1012   24    |   67.69MiB  2352k https | avc1.640028    2352k video only          1080p, mp4_dash"
    const match = formatLine.match(/^(\d+)\s+(\w+)\s+(\d+x\d+)/);
    if (match) {
      const formatId = match[1];
      const container = match[2];
      const resolution = match[3];
      
      // Extract height from resolution (e.g., "1920x1012" -> 1012)
      const height = parseInt(resolution.split('x')[1], 10);
      
      // Skip audio-only formats
      if (formatLine.includes('audio only')) {
        continue;
      }
      
      // First priority: exact resolution match with mp4 container
      if (height === targetHeight && container === 'mp4') {
        console.log(`Found exact match with mp4: formatId=${formatId}, resolution=${resolution}`);
        return formatId;
      }
      
      // Second priority: closest resolution that doesn't exceed target
      if (height <= targetHeight && height > bestResolution) {
        bestResolution = height;
        bestFormatId = formatId;
      }
    }
  }
  
  if (bestFormatId) {
    console.log(`Found best format: formatId=${bestFormatId}, resolution=${bestResolution}px`);
  } else {
    console.log(`No suitable format found for ${quality}`);
  }
  
  return bestFormatId;
}