import express, { Request, Response, RequestHandler } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { 
  downloadFromUrl, 
  getDownloadProgress, 
  getAllDownloads, 
  getDownloadFilePath,
  listFormats
} from "./download";

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// Handle download request
const downloadHandler: RequestHandler = async (req, res) => {
  const { url, quality = "1080p", playlist = false } = req.body;

  if (!url) {
    res.status(400).json({ error: "YouTube URL is required" });
    return;
  }

  // Set headers to prevent timeout
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Type', 'application/json');

  try {
    // Start the download process
    const downloadId = await downloadFromUrl(url, quality, playlist === true);
    
    // Send immediate response with download ID
    res.json({ 
      message: "Download started", 
      downloadId,
      status: "processing"
    });
    return;
  } catch (error: any) {
    console.error('Download error:', error);
    res.status(500).json({ 
      error: error.message || "Download failed",
      details: error.toString()
    });
    return;
  }
};

// Get download progress
const progressHandler = async (req, res) => {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({ error: "Download ID is required" });
  }
  
  const progress = getDownloadProgress(id);
  
  if (!progress) {
    return res.status(404).json({ error: "Download not found" });
  }
  
  res.json(progress);
};

// List all downloads
const listDownloadsHandler = async (req, res) => {
  const downloads = getAllDownloads();
  res.json(downloads);
};

// Endpoint to get playlist files
const playlistFilesHandler = async (req, res) => {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({ error: "Download ID is required" });
  }
  
  try {
    // Get the download progress
    const download = getDownloadProgress(id);
    
    if (!download) {
      return res.status(404).json({ error: "Playlist not found" });
    }
    
    // Check if this is a playlist
    const isPlaylist = download.videoId.startsWith('playlist_') || 
                      (download.title && download.title.includes('Playlist')) ||
                      (download.message && download.message.includes('Playlist'));
    
    if (!isPlaylist) {
      return res.status(400).json({ error: "This download is not a playlist" });
    }
    
    // Get the playlist directory
    const playlistDir = download.filePath;
    
    if (!playlistDir || !fs.existsSync(playlistDir) || !fs.lstatSync(playlistDir).isDirectory()) {
      return res.status(404).json({ error: "Playlist directory not found" });
    }
    
    // Read the directory contents
    const files = fs.readdirSync(playlistDir)
      .filter(file => file.endsWith('.mp4')) // Only include video files
      .map(file => ({
        name: file,
        path: path.join(playlistDir, file),
        size: fs.statSync(path.join(playlistDir, file)).size
      }));
    
    res.json({ playlistId: id, title: download.title, files });
  } catch (error: any) {
    console.error(`Error getting playlist files:`, error);
    res.status(500).json({ error: error.message || "Error getting playlist files" });
  }
};

// Get a specific playlist file
const playlistFileHandler = async (req, res) => {
  const { id, fileIndex } = req.params;
  
  if (!id) {
    return res.status(400).json({ error: "Download ID is required" });
  }
  
  if (!fileIndex) {
    return res.status(400).json({ error: "File index is required" });
  }
  
  try {
    // Get the download progress
    const download = getDownloadProgress(id);
    
    if (!download) {
      return res.status(404).json({ error: "Playlist not found" });
    }
    
    // Check if this is a playlist
    const isPlaylist = download.videoId.startsWith('playlist_') || 
                      (download.title && download.title.includes('Playlist')) ||
                      (download.message && download.message.includes('Playlist'));
    
    if (!isPlaylist) {
      return res.status(400).json({ error: "This download is not a playlist" });
    }
    
    // Get the playlist directory
    const playlistDir = download.filePath;
    
    if (!playlistDir || !fs.existsSync(playlistDir) || !fs.lstatSync(playlistDir).isDirectory()) {
      return res.status(404).json({ error: "Playlist directory not found" });
    }
    
    // Read the directory contents
    const files = fs.readdirSync(playlistDir)
      .filter(file => file.endsWith('.mp4')); // Only include video files
    
    const idx = parseInt(fileIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= files.length) {
      return res.status(400).json({ error: "Invalid file index" });
    }
    
    const filePath = path.join(playlistDir, files[idx]);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }
    
    // Send the file
    return res.sendFile(filePath, (err) => {
      if (err) {
        console.error(`Error serving playlist file: ${err}`);
        // Only attempt to send error response if the request hasn't finished and is writable
        if (!res.headersSent && res.writable) {
          res.status(500).json({ error: `Failed to serve file: ${err.message}` });
        }
      } else {
        console.log(`Playlist file served successfully: ${filePath}`);
      }
    });
  } catch (error: any) {
    console.error(`Error getting playlist file:`, error);
    // Make sure we can still send a response
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "Error getting playlist file" });
    }
  }
};

// Check if file exists
const checkFileHandler = async (req, res) => {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({ error: "Download ID is required", exists: false });
  }
  
  try {
    console.log(`Checking file existence for download ID: ${id}`);
    
    // First check if download exists and is completed
    const download = getDownloadProgress(id);
    if (!download) {
      console.log(`Download not found: ${id}`);
      return res.json({ exists: false, reason: "Download not found" });
    }
    
    if (download.status !== 'completed') {
      console.log(`Download not completed: ${id}, status: ${download.status}`);
      return res.json({ exists: false, reason: `Download status is ${download.status}` });
    }
    
    // Get file path - using the found download's filePath directly
    const filePath = download.filePath;
    
    if (!filePath) {
      console.log(`File path not found for download ID: ${id}`);
      return res.json({ exists: false, reason: "File path not available" });
    }
    
    // Check if the file actually exists on disk
    const exists = fs.existsSync(filePath);
    console.log(`File exists check for ${filePath}: ${exists}`);
    
    if (!exists) {
      // Instead of creating a dummy file, mark it for re-download
      console.log(`File doesn't exist, marking for re-download: ${filePath}`);
      download.status = 'queued';
      download.progress = 0;
      return res.json({ exists: false, reason: "File needs to be re-downloaded" });
    }
    
    // Return if file exists
    res.json({ exists });
  } catch (error: any) {
    console.error("Error checking file:", error);
    res.status(500).json({ error: error.message || "Failed to check file", exists: false });
  }
};

// Serve downloaded file
const serveFileHandler = async (req, res) => {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({ error: "Download ID is required" });
  }
  
  try {
    console.log(`Serving file for download ID: ${id}`);
    
    // First find the download
    const download = getDownloadProgress(id);
    if (!download) {
      console.log(`Download not found for ID: ${id}`);
      return res.status(404).json({ error: "Download not found" });
    }
    
    // Get the file path directly from the download
    const filePath = download.filePath;
    
    if (!filePath) {
      console.log(`File path not found for download ID: ${id}`);
      return res.status(404).json({ error: "File not found" });
    }
    
    // Check if the file actually exists on disk
    if (!fs.existsSync(filePath)) {
      console.log(`File exists in database but not on disk: ${filePath}`);
      // Instead of creating a dummy file, mark for re-download
      download.status = 'queued';
      download.progress = 0;
      return res.status(404).json({ 
        error: "File needs to be re-downloaded",
        shouldRedownload: true 
      });
    }
    
    // For testing: Directly serve the file instead of URL
    console.log(`Serving file directly: ${filePath}`);
    
    // Fix: Send file using absolute path instead of resolving with root
    return res.sendFile(filePath, (err) => {
      if (err) {
        console.error(`Error serving file: ${err}`);
        // Only attempt to send error response if the request hasn't finished and is writable
        if (!res.headersSent && res.writable) {
          res.status(500).json({ error: `Failed to serve file: ${err.message}` });
        }
      } else {
        console.log(`File served successfully: ${filePath}`);
      }
    });
  } catch (error: any) {
    console.error(`Error serving file: ${error}`);
    // Make sure we can still send a response
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "Failed to get file" });
    }
  }
};

// List available formats for a video
const listFormatsHandler = async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "YouTube URL is required" });
  }

  try {
    const formats = await listFormats(url);
    res.json({ 
      message: "Formats retrieved successfully", 
      formats,
      url
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to retrieve formats" });
  }
};

// Delete a download
const deleteDownloadHandler = async (req, res) => {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({ error: "Download ID is required" });
  }
  
  try {
    console.log(`Deleting download with ID: ${id}`);
    
    // Get base video ID (without timestamp)
    const baseVideoId = id.split('_')[0];
    console.log(`Base video ID: ${baseVideoId}`);
    
    // Find all downloads with this base ID
    const downloads = getAllDownloads();
    const matchingDownloads = downloads.filter(d => d.videoId.startsWith(baseVideoId));
    
    if (matchingDownloads.length === 0) {
      console.log(`No downloads found with base ID: ${baseVideoId}`);
      return res.status(404).json({ error: "Download not found" });
    }
    
    // Get the most recent download (highest timestamp)
    const download = matchingDownloads.reduce((latest, current) => {
      const latestTime = parseInt(latest.videoId.split('_')[1] || '0');
      const currentTime = parseInt(current.videoId.split('_')[1] || '0');
      return currentTime > latestTime ? current : latest;
    });
    
    console.log(`Found download to delete:`, download);
    
    // If there's a file path and the file exists, delete it
    if (download.filePath && fs.existsSync(download.filePath)) {
      try {
        if (fs.lstatSync(download.filePath).isDirectory()) {
          // For playlists, delete the directory and its contents
          fs.rmdirSync(download.filePath, { recursive: true });
        } else {
          // For single files, delete the file
          fs.unlinkSync(download.filePath);
        }
        console.log(`Deleted file: ${download.filePath}`);
      } catch (error) {
        console.error(`Error deleting file: ${error}`);
        // Continue even if file deletion fails
      }
    }
    
    // Remove all downloads with this base ID from the progress tracking
    global.downloads = downloads.filter(d => !d.videoId.startsWith(baseVideoId));
    
    console.log(`Download(s) deleted successfully for base ID: ${baseVideoId}`);
    res.json({ message: "Download deleted successfully" });
  } catch (error: any) {
    console.error(`Error deleting download:`, error);
    res.status(500).json({ error: error.message || "Error deleting download" });
  }
};

// Add status endpoint
const statusHandler: RequestHandler = (req, res) => {
  const { downloadId } = req.params;
  const download = getDownloadProgress(downloadId);

  if (!download) {
    res.status(404).json({ error: 'Download not found' });
    return;
  }

  res.json({
    status: download.status,
    progress: download.progress,
    message: download.message,
    title: download.title
  });
  return;
};

// Serve static files from the downloads directory
app.use('/files', express.static(path.join(__dirname, '../downloads')));

// Set up API routes
app.post('/api/download', downloadHandler);
app.get('/api/progress/:id', progressHandler);
app.get('/api/downloads', listDownloadsHandler);
app.get('/api/download/:id', serveFileHandler);
app.post('/api/formats', listFormatsHandler);
app.get('/api/download/:id/check', checkFileHandler);
app.get('/api/download/:id/playlist', playlistFilesHandler);
app.get('/api/download/:id/playlist-file/:fileIndex', playlistFileHandler);
app.delete('/api/download/:id', deleteDownloadHandler);
app.get('/api/status/:downloadId', statusHandler);

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
