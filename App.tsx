import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  SafeAreaView,
  TextInput,
  Button,
  StyleSheet,
  Alert,
  View,
  Text,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
  PermissionsAndroid,
  Linking,
  ToastAndroid,
  Modal,
} from 'react-native';
import RNFS from 'react-native-fs';
import FileViewer from 'react-native-file-viewer';

// Define possible server addresses
const SERVER_ADDRESSES = [
  'http://192.168.221.158:5000', // Your actual network IP      // Direct localhost
];

// Start with the most likely address
let API_URL = SERVER_ADDRESSES[0];

type Download = {
  videoId: string;
  progress: number;
  status: 'queued' | 'downloading' | 'processing' | 'completed' | 'error';
  title?: string;
  message?: string;
  filePath?: string;
  url?: string;
};

const App = () => {
  const [youtubeUrl, setYoutubeUrl] = useState<string>('');
  const [quality, setQuality] = useState<string>('1080p');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [downloading, setDownloading] = useState<{[key: string]: boolean}>({});
  const [connected, setConnected] = useState<boolean>(false);
  const [previousConnected, setPreviousConnected] = useState<boolean | null>(null);
  const [lastToastTime, setLastToastTime] = useState<number>(0);
  const [permissionModalVisible, setPermissionModalVisible] = useState<boolean>(false);
  const [isPlaylist, setIsPlaylist] = useState<boolean>(false);
  const [showFormats, setShowFormats] = useState(false);
  const [formats, setFormats] = useState<string[]>([]);
  const [formatLoading, setFormatLoading] = useState(false);
  const [serverUrl, setServerUrl] = useState<string>(API_URL);
  const [showDownloadProgress, setShowDownloadProgress] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);

  // Helper function to show toast with debounce
  const showToast = useCallback((message: string, duration: number = ToastAndroid.SHORT) => {
    const now = Date.now();
    // Only show toast if 3 seconds have passed since the last one
    if (now - lastToastTime > 3000) {
      if (Platform.OS === 'android') {
        ToastAndroid.show(message, duration);
      }
      setLastToastTime(now);
    }
  }, [lastToastTime]);

  // Open app settings directly
  const openSettings = () => {
    try {
      if (Platform.OS === 'android') {
        // Open app-specific settings
        Linking.openSettings();
        console.log('Opening app settings');
      }
    } catch (error) {
      console.error('Failed to open settings:', error);
    }
  };

  // Show custom permission modal
  const showPermissionModal = () => {
    setPermissionModalVisible(true);
  };

  // Request storage permissions (Android only)
  const requestStoragePermission = async () => {
    if (Platform.OS !== 'android') return true;
    
    try {
      // For Android 10 (API level 29) and above
      if (Platform.Version >= 33) { // Android 13+
        // For Android 13+, request new READ_MEDIA_VIDEO permission
        const permissions = [
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
        ];
        
        const results = await PermissionsAndroid.requestMultiple(permissions);
        
        // Check if all permissions are granted
        const allGranted = Object.values(results).every(
          result => result === PermissionsAndroid.RESULTS.GRANTED
        );
        
        if (allGranted) {
          return true;
        } else {
          // Show custom dialog instead of Alert
          showPermissionModal();
          return false;
        }
      } 
      else if (Platform.Version >= 29) { // Android 10-12
        // On Android 10-12, permissions handled differently but we still need to request them
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
          {
            title: "Storage Permission",
            message: "App needs access to your storage to download and play videos",
            buttonNeutral: "Ask Me Later",
            buttonNegative: "Cancel",
            buttonPositive: "OK"
          }
        );
        
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          return true;
        } else {
          // Show custom dialog instead of Alert
          showPermissionModal();
          return false;
        }
      } 
      else { // Android 9 and below
        // For older Android versions, request both read and write permissions
        const results = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE
        ]);
        
        if (
          results[PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE] === PermissionsAndroid.RESULTS.GRANTED &&
          results[PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE] === PermissionsAndroid.RESULTS.GRANTED
        ) {
          return true;
        } else {
          // Show custom dialog instead of Alert
          showPermissionModal();
          return false;
        }
      }
    } catch (err) {
      console.error(err);
      return false;
    }
  };

  // Function to check connection to a specific server address
  const checkServerConnection = async (url: string): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
      
      const response = await fetch(`${url}/api/downloads`, {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      console.error(`Connection error to ${url}:`, error);
      return false;
    }
  };

  // Function to find working server
  const findWorkingServer = async () => {
    for (const address of SERVER_ADDRESSES) {
      console.log(`Trying connection to: ${address}`);
      if (await checkServerConnection(address)) {
        if (address !== API_URL) {
          console.log(`Switching to working server: ${address}`);
          API_URL = address;
          setServerUrl(address);
        }
        
        // Only show toast and update state if connection status actually changed
        if (!connected) {
          setConnected(true);
          if (previousConnected === false) {
            showToast(`Connected to server at ${address}`);
          }
          setPreviousConnected(true);
        }
        return true;
      }
    }
    
    // Only show toast and update state if connection status actually changed
    if (connected) {
      setConnected(false);
      if (previousConnected === true) {
        showToast('Lost connection to server', ToastAndroid.LONG);
      }
      setPreviousConnected(false);
    }
    return false;
  };

  // Test backend connection and show toast
  useEffect(() => {
    findWorkingServer();
    
    // Set up periodic connection checks
    const connectionTimer = setInterval(() => {
      if (!connected) {
        findWorkingServer();
      } else {
        // Verify current connection still works
        checkServerConnection(API_URL).then(isConnected => {
          if (!isConnected) {
            console.log('Lost connection, searching for available server...');
            findWorkingServer();
          }
        });
      }
    }, 10000); // Check every 10 seconds
    
    return () => clearInterval(connectionTimer);
  }, [connected, previousConnected]);

  // Fetch all downloads
  const fetchDownloads = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const response = await fetch(`${API_URL}/api/downloads`, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        setDownloads(data);
        // If we weren't connected before, now we are
        if (!connected) {
          setConnected(true);
          if (previousConnected === false) {
            showToast(`Connected to server at ${API_URL}`);
          }
          setPreviousConnected(true);
        }
      } else {
        throw new Error(`Server responded with status: ${response.status}`);
      }
    } catch (error) {
      console.error('Error fetching downloads:', error);
      // If we were connected before, now we're not
      if (connected) {
        setConnected(false);
        if (previousConnected === true) {
          showToast('Lost connection to server. Attempting to reconnect...', ToastAndroid.LONG);
        }
        setPreviousConnected(false);
        
        // Try to find a working server
        findWorkingServer();
      }
    }
  };

  // Poll for downloads status updates
  useEffect(() => {
    const interval = setInterval(() => {
      fetchDownloads();
    }, 2000);
    
    return () => clearInterval(interval);
  }, []);

  const handleDownload = async () => {
    if (!youtubeUrl.trim()) {
      Alert.alert('Error', 'Please enter a YouTube URL');
      return;
    }

    if (!connected) {
      Alert.alert('Not Connected', 'Not connected to server. Please check your connection.');
      const found = await findWorkingServer();
      if (!found) return;
    }

    setIsLoading(true);

    // Show initial processing message
    const processingAlert = Alert.alert(
      'Processing',
      'Please wait while we fetch the video information...',
      [{ text: 'Cancel', onPress: () => setIsLoading(false) }],
      { cancelable: false }
    );

    try {
      // Initial request to start download
      const response = await fetch(`${API_URL}/api/download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: youtubeUrl,
          quality: quality,
          playlist: isPlaylist
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to start download');
      }

      const data = await response.json();
      
      if (data.downloadId) {
        // Clear the URL input
        setYoutubeUrl('');
        
        // Show processing message
        if (Platform.OS === 'android') {
          ToastAndroid.show('Download started - Processing video...', ToastAndroid.LONG);
        }

        // Start polling for status
        let attempts = 0;
        const maxAttempts = 60; // 2 minutes maximum
        const pollInterval = 2000; // 2 seconds

        const checkStatus = async () => {
          try {
            const statusResponse = await fetch(`${API_URL}/api/status/${data.downloadId}`);
            if (!statusResponse.ok) {
              throw new Error('Failed to check download status');
            }

            const statusData = await statusResponse.json();
            
            if (statusData.status === 'completed') {
              setIsLoading(false);
              if (Platform.OS === 'android') {
                ToastAndroid.show('Download completed successfully!', ToastAndroid.LONG);
              } else {
                Alert.alert('Success', 'Download completed successfully!');
              }
              return;
            } else if (statusData.status === 'error') {
              throw new Error(statusData.message || 'Download failed');
            }

            // Update progress in UI
            if (statusData.progress) {
              // Update your progress UI here
              setDownloadProgress(statusData.progress);
            }

            // Continue polling if still processing
            attempts++;
            if (attempts < maxAttempts) {
              setTimeout(checkStatus, pollInterval);
            } else {
              throw new Error('Download is taking too long. Please try again.');
            }
          } catch (error) {
            setIsLoading(false);
            Alert.alert(
              'Download Error',
              error instanceof Error ? error.message : 'An unknown error occurred',
              [{ text: 'OK' }]
            );
          }
        };

        // Start the status polling
        checkStatus();
      }

    } catch (error) {
      console.error('Download error:', error);
      setIsLoading(false);
      Alert.alert(
        'Download Error',
        error instanceof Error ? error.message : 'An unknown error occurred. Please try again.',
        [{ text: 'OK' }]
      );
    }
  };

  // Check if file actually exists on the server
  const checkFileExists = async (downloadId: string): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await fetch(`${API_URL}/api/download/${downloadId}/check`, {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const { exists } = await response.json();
        return exists;
      }
      return false;
    } catch (error) {
      console.error('Error checking file existence:', error);
      // Try to find a working server
      await findWorkingServer();
      return false;
    }
  };

  // Save file to public downloads directory
  const saveToPublicDownloads = async (fileData: string, fileName: string): Promise<string> => {
    if (Platform.OS === 'android') {
      try {
        // First try to save directly to Downloads directory
        const publicDownloadPath = `${RNFS.DownloadDirectoryPath}/${fileName}`;
        console.log(`Attempting to save directly to Downloads: ${publicDownloadPath}`);
        
        try {
          await RNFS.writeFile(publicDownloadPath, fileData, 'base64');
          console.log(`File saved directly to Downloads: ${publicDownloadPath}`);
          
          // Make the file visible in media store
          try {
            await RNFS.scanFile(publicDownloadPath);
            console.log(`File scanned successfully: ${publicDownloadPath}`);
          } catch (scanError) {
            console.warn(`File scan warning (file should still be accessible): ${scanError}`);
          }
          
          return publicDownloadPath;
        } catch (downloadDirError) {
          console.warn(`Could not save to Downloads directory: ${downloadDirError}`);
          
          // Fallback to app's external directory
          const appDownloadPath = `${RNFS.ExternalDirectoryPath}/${fileName}`;
          console.log(`Falling back to app's external directory: ${appDownloadPath}`);
          
          await RNFS.writeFile(appDownloadPath, fileData, 'base64');
          console.log(`File saved to app directory: ${appDownloadPath}`);
          
          // Try to copy to Download directory
          try {
            await RNFS.copyFile(appDownloadPath, publicDownloadPath);
            await RNFS.unlink(appDownloadPath); // Clean up the temporary file
            console.log(`File copied to Downloads: ${publicDownloadPath}`);
            
            // Scan the copied file
            await RNFS.scanFile(publicDownloadPath);
            return publicDownloadPath;
          } catch (copyError) {
            console.warn(`Could not copy to Downloads, using app directory: ${copyError}`);
            return appDownloadPath;
          }
        }
      } catch (error: any) {
        console.error('Error in file saving process:', error);
        throw new Error(`Failed to save file: ${error.message}`);
      }
    } else {
      // For iOS
      const downloadPath = `${RNFS.DocumentDirectoryPath}/${fileName}`;
      await RNFS.writeFile(downloadPath, fileData, 'base64');
      return downloadPath;
    }
  };

  // Helper function to fetch download info
  const fetchDownloadInfo = async (downloadId: string): Promise<Download | null> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const response = await fetch(`${API_URL}/api/download/${downloadId}`, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Server responded with status: ${response.status}`);
      }

      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (e) {
        console.error('JSON parse error:', e, 'Response text:', text);
        throw new Error('Invalid JSON response from server');
      }
    } catch (error) {
      console.error('Error fetching download info:', error);
      if (error instanceof Error && error.name !== 'AbortError') {
        await findWorkingServer();
      }
      return null;
    }
  };

  // Download file from server to local device
  const downloadToDevice = async (downloadId: string, videoTitle: string) => {
    // Get the video ID from downloadId (remove timestamp)
    const baseVideoId = downloadId.split('_')[0];
    
    try {
      // Check current download status
      const downloadInfo = await fetchDownloadInfo(downloadId);
      
      // If status is queued, we need to start a fresh download
      if (downloadInfo?.status === 'queued') {
        if (!downloadInfo.url) {
          throw new Error('Missing video URL for re-download');
        }

        // Show re-download alert
        Alert.alert(
          'Starting New Download',
          'Starting a fresh download of the video. Please wait...',
          [{ text: 'OK' }]
        );

        // Start a new download
        const response = await fetch(`${API_URL}/api/download`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: downloadInfo.url,
            quality: quality,
            playlist: false
          })
        });

        if (!response.ok) {
          throw new Error('Failed to start new download');
        }

        const data = await response.json();
        if (!data.downloadId) {
          throw new Error('No download ID received from server');
        }

        // Update the downloadId to the new one
        downloadId = data.downloadId;
      }

      // Continue with rest of existing downloadToDevice logic
      setDownloading(prev => ({ ...prev, [downloadId]: true }));
      setShowDownloadProgress(true);

      // Define local path for the downloaded file
      const sanitizedTitle = videoTitle.replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `${sanitizedTitle}_${baseVideoId}_${quality}.mp4`;
      let localFilePath = '';
      
      if (Platform.OS === 'android') {
        try {
          // First try to get the external storage directory
          const externalDir = RNFS.ExternalStorageDirectoryPath;
          const downloadsDir = `${externalDir}/Download`;
          
          // Create Downloads directory if it doesn't exist
          const dirExists = await RNFS.exists(downloadsDir);
          if (!dirExists) {
            await RNFS.mkdir(downloadsDir);
          }
          
          localFilePath = `${downloadsDir}/${fileName}`;
          console.log('Using downloads directory:', localFilePath);
        } catch (error) {
          console.error('Error accessing Downloads directory:', error);
          // Fallback to app's external directory
          localFilePath = `${RNFS.ExternalDirectoryPath}/${fileName}`;
          console.log('Falling back to app directory:', localFilePath);
        }
      } else {
        // For iOS
        localFilePath = `${RNFS.DocumentDirectoryPath}/${fileName}`;
      }

      console.log(`Starting download of video ID: ${downloadId} to ${localFilePath}`);

      // Show download progress alert
      Alert.alert(
        'Downloading...',
        `Downloading video in ${quality}. Please wait...`,
        [
          {
            text: 'Hide',
            onPress: () => setShowDownloadProgress(false),
            style: 'cancel',
          }
        ],
        { cancelable: true }
      );

      // First check if the file exists on the server
      const checkResponse = await fetch(`${API_URL}/api/download/${downloadId}/check`);
      if (!checkResponse.ok) {
        throw new Error('Failed to verify file on server');
      }

      const checkData = await checkResponse.json();
      if (!checkData.exists) {
        throw new Error(checkData.reason || 'File not found on server');
      }

      // Download using RNFS.downloadFile for better progress tracking and reliability
      const downloadOptions = {
        fromUrl: `${API_URL}/api/download/${downloadId}`,
        toFile: localFilePath,
        background: true,
        discretionary: true,
        progress: (res: { bytesWritten: number; contentLength: number }) => {
          const progressPercent = ((res.bytesWritten / res.contentLength) * 100).toFixed(0);
          console.log(`Download progress: ${progressPercent}%`);
          setDownloadProgress(parseInt(progressPercent));
        },
        headers: {
          'Accept': 'video/mp4,application/octet-stream',
          'Content-Type': 'application/octet-stream'
        }
      };

      try {
        const download = await RNFS.downloadFile(downloadOptions).promise;
        
        if (download.statusCode !== 200) {
          throw new Error(`Download failed with status: ${download.statusCode}`);
        }

        // Verify the downloaded file
        const fileExists = await RNFS.exists(localFilePath);
        if (!fileExists) {
          throw new Error('File was not downloaded correctly');
        }

        const fileStats = await RNFS.stat(localFilePath);
        if (fileStats.size < 1000) { // Less than 1KB is probably an error
          await RNFS.unlink(localFilePath); // Delete the corrupted file
          throw new Error('Downloaded file appears to be corrupted (too small)');
        }

        // Clear states after successful download
        setDownloading(prev => ({ ...prev, [downloadId]: false }));
        setShowDownloadProgress(false);
        setDownloadProgress(0);
        
        if (Platform.OS === 'android') {
          // Scan the file to make it visible in the media store
          try {
            await RNFS.scanFile(localFilePath);
          } catch (scanError) {
            console.warn('Error scanning file (file should still be accessible):', scanError);
          }
          
          // Show success toast
          ToastAndroid.show(`Video downloaded successfully in ${quality}!`, ToastAndroid.LONG);
        }

        // Show success alert with options to open
        Alert.alert(
          'Download Complete',
          `Video downloaded successfully in ${quality}!`,
          [
            { text: 'OK' },
            { 
              text: 'Open',
              onPress: async () => {
                try {
                  await FileViewer.open(localFilePath, {
                    showOpenWithDialog: true,
                    onDismiss: () => console.log('FileViewer dismissed')
                  });
                } catch (error) {
                  console.error('Error opening file:', error);
                  openWithAlternative(localFilePath, fileName);
                }
              }
            }
          ]
        );
      } catch (downloadError) {
        console.error('Download error:', downloadError);
        // Clean up any partially downloaded file
        if (await RNFS.exists(localFilePath)) {
          await RNFS.unlink(localFilePath);
        }
        throw new Error(`Download failed: ${(downloadError as Error).message}`);
      }

    } catch (error: any) {
      console.error('Error in downloadToDevice:', error);
      
      // Clear states on error
      setDownloading(prev => ({ ...prev, [downloadId]: false }));
      setShowDownloadProgress(false);
      setDownloadProgress(0);
      
      let errorMessage = 'Failed to download video. Please try again.';
      
      if (error.message.includes('storage')) {
        errorMessage = 'Not enough storage space. Please free up some space and try again.';
      } else if (error.message.includes('permission')) {
        errorMessage = 'Storage permission is required. Please grant permission and try again.';
      } else if (error.message.includes('network')) {
        errorMessage = 'Network error. Please check your internet connection and try again.';
      } else if (error.message.includes('corrupted')) {
        errorMessage = 'The downloaded file was corrupted. Please try downloading again.';
      }
      
      Alert.alert(
        'Download Error',
        errorMessage,
        [
          { 
            text: 'Retry',
            onPress: () => downloadToDevice(downloadId, videoTitle)
          },
          {
            text: 'Cancel',
            style: 'cancel'
          }
        ]
      );
    }
  };

  // Helper function to open file with alternative method
  const openWithAlternative = (filePath: string, fileName: string) => {
    if (Platform.OS === 'android') {
      // Try to open the Downloads folder
      Linking.openURL('content://media/external/downloads')
        .catch(error => {
          console.error('Error opening Downloads folder:', error);
          Alert.alert(
            'File Saved', 
            `The video has been saved to your device as "${fileName}".\n\nYou can find it in your Downloads folder.`
          );
        });
    } else {
      Alert.alert('File Saved', `The video has been saved to your device as "${fileName}"`);
    }
  };

  // Handle playlist downloads
  const handlePlaylistDownload = async (downloadId: string, playlistTitle: string) => {
    setDownloading(prev => ({ ...prev, [downloadId]: true }));
    
    try {
      // For playlists, we just show information for now
      Alert.alert(
        'Playlist Download',
        `The playlist "${playlistTitle}" is available on the server. Individual videos will need to be downloaded separately.`,
        [
          { 
            text: 'OK', 
            onPress: () => setDownloading(prev => ({ ...prev, [downloadId]: false }))
          }
        ]
      );
    } catch (error: any) {
      console.error('Playlist download error:', error);
      Alert.alert('Download Error', `Failed to process playlist: ${error.message || 'Unknown error'}`);
      setDownloading(prev => ({ ...prev, [downloadId]: false }));
    }
  };

  // Extract the correct download ID from the videoId
  const getDownloadId = (item: Download): string => {
    return item.videoId;  // This actually contains the full download ID
  };

  // Check if download is really complete with file available
  const isDownloadComplete = (item: Download): boolean => {
    return item.status === 'completed' && 
           item.progress === 100 && 
           item.filePath !== undefined;
  };

  // Check if the download is a playlist
  const isPlaylistDownload = (item: Download): boolean => {
    return (
      (typeof item.videoId === 'string' && item.videoId.startsWith('playlist_')) || 
      (typeof item.message === 'string' && item.message.includes('Playlist')) ||
      (typeof item.title === 'string' && item.title.includes('Playlist'))
    );
  };

  // Deduplicate downloads to show unique videos only (by actual videoId)
  const uniqueDownloads = useMemo(() => {
    // Group downloads by video ID (before the timestamp)
    const videoGroups = new Map();
    
    downloads.forEach(download => {
      // Extract base video ID (without timestamp)
      const baseId = download.videoId.split('_')[0];
      
      // If we already have this video in our map
      if (videoGroups.has(baseId)) {
        const existing = videoGroups.get(baseId);
        
        // Only replace if this one is completed and the existing one isn't
        // or if this one is newer (higher timestamp)
        if (
          (download.status === 'completed' && existing.status !== 'completed') ||
          (download.videoId.split('_')[1] > existing.videoId.split('_')[1])
        ) {
          videoGroups.set(baseId, download);
        }
      } else {
        // If it's a new video, add it to the map
        videoGroups.set(baseId, download);
      }
    });
    
    // Convert map values back to array
    return Array.from(videoGroups.values());
  }, [downloads]);

  // Check if any download with this videoId is in progress
  const isDownloadingAny = (item: Download): boolean => {
    const baseVideoId = item.videoId.split('_')[0];
    return Object.entries(downloading).some(([id, inProgress]) => 
      inProgress && (id.startsWith(baseVideoId + '_') || id === baseVideoId)
    );
  };

  // Extract video resolution from message if available
  const getVideoResolution = (item: Download): string | null => {
    if (item.message) {
      // Check for resolution pattern like (1920x1080)
      const resolutionMatch = item.message.match(/\((\d+x\d+)\)/);
      if (resolutionMatch && resolutionMatch[1]) {
        return resolutionMatch[1];
      }
      
      // Check for quality pattern like (quality: 1080p)
      const qualityMatch = item.message.match(/\(quality: (\d+p)\)/);
      if (qualityMatch && qualityMatch[1]) {
        return qualityMatch[1].toUpperCase();
      }
    }
    return null;
  };

  // Get a color for the resolution badge based on quality
  const getResolutionBadgeColor = (resolution: string | null): string => {
    if (!resolution) return '#4CAF50'; // Default green
    
    if (resolution.includes('1080') || resolution.includes('1920')) {
      return '#E91E63'; // Pink for 1080p
    } else if (resolution.includes('720') || resolution.includes('1280')) {
      return '#2196F3'; // Blue for 720p 
    } else if (resolution.includes('480') || resolution.includes('854')) {
      return '#FF9800'; // Orange for 480p
    }
    
    return '#4CAF50'; // Default green
  };

  // New function to check available formats
  const checkFormats = async () => {
    if (!youtubeUrl.trim()) {
      Alert.alert('Invalid URL', 'Please enter a YouTube link.');
      return;
    }

    if (!connected) {
      Alert.alert('Not Connected', 'Not connected to server. Please check your connection.');
      // Try to find a working server
      const found = await findWorkingServer();
      if (!found) return;
    }

    setFormatLoading(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await fetch(`${API_URL}/api/formats`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: youtubeUrl }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      const data = await response.json();
      
      if (response.ok) {
        setFormats(data.formats);
        setShowFormats(true);
      } else {
        Alert.alert('Error', data.error || 'Failed to retrieve formats');
      }
    } catch (error: any) {
      console.error('Format check error:', error);
      
      if (error.name === 'AbortError') {
        Alert.alert('Network Error', 'Connection timed out. Please check your network connection.');
      } else {
        Alert.alert('Network Error', 'Could not connect to download server. Please check your network connection.');
      }
      
      // Try to find a working server
      findWorkingServer();
    } finally {
      setFormatLoading(false);
    }
  };

  // Add this new function before the renderDownloadItem
  const handleDeleteDownload = async (downloadId: string, filePath?: string) => {
    try {
      // Get base video ID (without timestamp)
      const baseVideoId = downloadId.split('_')[0];
      console.log(`Attempting to delete video with base ID: ${baseVideoId}`);

      // First try to delete from server
      const response = await fetch(`${API_URL}/api/download/${baseVideoId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const responseData = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(responseData.error || `Server responded with status: ${response.status}`);
      }

      // If server delete was successful, try to delete local file
      if (filePath) {
        try {
          const exists = await RNFS.exists(filePath);
          if (exists) {
            await RNFS.unlink(filePath);
            console.log(`Local file deleted: ${filePath}`);
          }
        } catch (error) {
          console.warn(`Error deleting local file: ${error}`);
        }
      }

      // Remove all downloads with this base ID from state and reset status
      setDownloads(prevDownloads => 
        prevDownloads.filter(download => !download.videoId.startsWith(baseVideoId))
      );
      
      // Remove from downloading state
      setDownloading(prev => {
        const updated = { ...prev };
        Object.keys(updated).forEach(key => {
          if (key.startsWith(baseVideoId)) {
            delete updated[key];
          }
        });
        return updated;
      });

      // Reset download progress
      setDownloadProgress(0);
      setShowDownloadProgress(false);
      
      if (Platform.OS === 'android') {
        ToastAndroid.show('Download deleted successfully', ToastAndroid.SHORT);
      }
    } catch (error) {
      console.error('Error deleting download:', error);
      let errorMessage = 'Failed to delete download. Please try again.';
      if (error instanceof Error) {
        if (error.message.includes('Network') || error.message.includes('Failed to fetch')) {
          errorMessage = 'Network error. Please check your connection and try again.';
        } else if (error.message.includes('not found') || error.message.includes('404')) {
          errorMessage = 'Download not found on server. It may have been already deleted.';
          // Remove from local state even if server delete failed
          const baseVideoId = downloadId.split('_')[0];
          setDownloads(prevDownloads => 
            prevDownloads.filter(download => !download.videoId.startsWith(baseVideoId))
          );
        } else {
          errorMessage = error.message;
        }
      }
      Alert.alert('Error', errorMessage);
    }
  };

  // Add polling function for download status
  const pollDownloadStatus = useCallback((downloadId: string) => {
    const poll = async () => {
      try {
        const response = await fetch(`${API_URL}/api/status/${downloadId}`);
        if (!response.ok) {
          console.error('Error polling status:', response.statusText);
          return;
        }

        const data = await response.json();
        if (data.status === 'completed' || data.status === 'error') {
          // Stop polling on completion or error
          return;
        }

        // Continue polling every 2 seconds if download is still in progress
        setTimeout(poll, 2000);
      } catch (error) {
        console.error('Polling error:', error);
      }
    };

    // Start polling
    poll();
  }, [API_URL]);

  const renderDownloadItem = ({ item }: { item: Download }) => {
    const isPlaylist = isPlaylistDownload(item);
    const isAnyDownloading = isDownloadingAny(item);
    const resolution = getVideoResolution(item);
    
    return (
      <View style={styles.downloadItem}>
        <View style={styles.downloadHeader}>
          <View style={styles.titleContainer}>
            <Text style={styles.downloadTitle}>{item.title || item.videoId}</Text>
            <TouchableOpacity 
              style={styles.deleteButton}
              onPress={() => {
                Alert.alert(
                  'Delete Download',
                  'Are you sure you want to delete this download? You can redownload it later.',
                  [
                    {
                      text: 'Cancel',
                      style: 'cancel'
                    },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => handleDeleteDownload(item.videoId, item.filePath)
                    }
                  ]
                );
              }}
            >
              <Text style={styles.deleteButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.badgeContainer}>
            {resolution && (
              <View style={[styles.resolutionBadge, { backgroundColor: getResolutionBadgeColor(resolution) }]}>
                <Text style={styles.badgeText}>{resolution}</Text>
              </View>
            )}
            {isPlaylist && (
              <View style={styles.playlistBadge}>
                <Text style={styles.playlistBadgeText}>Playlist</Text>
              </View>
            )}
          </View>
        </View>
        
        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { width: `${item.progress}%` }]} />
        </View>
        <Text style={styles.statusText}>
          {item.status} - {item.progress.toFixed(0)}%
        </Text>
        <Text style={styles.messageText}>{item.message}</Text>
        
        {isDownloadComplete(item) && (
          <TouchableOpacity 
            style={[
              styles.saveButton,
              isAnyDownloading && styles.saveButtonDisabled
            ]}
            onPress={() => downloadToDevice(getDownloadId(item), item.title || item.videoId)}
            disabled={isAnyDownloading}
          >
            <Text style={styles.saveButtonText}>
              {isAnyDownloading 
                ? 'Downloading...' 
                : isPlaylist 
                  ? 'Open Playlist Folder' 
                  : 'Save to Device'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.connectionStatus}>
        {connected ? (
          <Text style={styles.connectedText}>Connected to server ✓</Text>
        ) : (
          <View style={styles.disconnectedContainer}>
            <View style={styles.disconnectedInfo}>
              <Text style={styles.disconnectedText}>Not connected to server ✗</Text>
              <Text style={styles.serverInfo}>Trying: {API_URL}</Text>
            </View>
            <TouchableOpacity 
              style={styles.reconnectButton}
              onPress={findWorkingServer}
            >
              <Text style={styles.reconnectText}>Reconnect</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      
      <TextInput
        placeholder="Paste YouTube video or playlist URL here"
        style={styles.input}
        value={youtubeUrl}
        onChangeText={setYoutubeUrl}
        placeholderTextColor="#9CA3AF"
        textAlignVertical="center"
      />
      <View style={styles.qualitySelector}>
        <Text style={styles.label}>Quality:</Text>
        <View style={styles.qualityOptions}>
          {['480p', '720p', '1080p'].map((q) => (
            <Button
              key={q}
              title={q}
              onPress={() => setQuality(q)}
              color={quality === q ? '#2196F3' : '#cccccc'}
            />
          ))}
        </View>
      </View>
      
      <View style={styles.playlistOption}>
        <TouchableOpacity 
          style={styles.checkbox}
          onPress={() => setIsPlaylist(!isPlaylist)}
        >
          <View style={[styles.checkboxInner, isPlaylist && styles.checkboxChecked]} />
        </TouchableOpacity>
        <Text style={styles.checkboxLabel}>Download as playlist</Text>
      </View>
      
      <View style={styles.buttonContainer}>
        {isLoading ? (
          <ActivityIndicator size="large" color="#2196F3" />
        ) : (
          <>
            <TouchableOpacity
              style={[styles.button, styles.formatButton]}
              onPress={checkFormats}
              disabled={formatLoading}
            >
              {formatLoading ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.buttonText}>Check Formats</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.downloadButton]}
              onPress={handleDownload}
            >
              <Text style={styles.buttonText}>{isPlaylist ? "Download Playlist" : "Download Video"}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
      
      {/* Formats Modal */}
      <Modal
        visible={showFormats}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowFormats(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Available Formats</Text>
            {formats.length > 0 ? (
              <FlatList
                data={formats}
                renderItem={({ item }) => (
                  <Text style={styles.formatText}>{item}</Text>
                )}
                keyExtractor={(item, index) => index.toString()}
                style={styles.formatsList}
              />
            ) : (
              <Text style={styles.noFormatsText}>No formats available</Text>
            )}
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowFormats(false)}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      
      <Text style={styles.downloadsTitle}>Downloads</Text>
      <FlatList
        data={uniqueDownloads}
        renderItem={renderDownloadItem}
        keyExtractor={(item, index) => `${item.videoId}-${index}`}
        style={styles.downloadsList}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No downloads yet</Text>
        }
      />
      
      {/* Custom Permission Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={permissionModalVisible}
        onRequestClose={() => setPermissionModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Permission Required</Text>
            <Text style={styles.modalText}>
              Media access permissions are required to download and view videos.
            </Text>
            <Text style={styles.modalInstructions}>
              1. Tap 'Open Settings' below{'\n'}
              2. Select 'Permissions'{'\n'}
              3. Enable 'Storage' or 'Files and Media'{'\n'}
              4. Return to the app
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setPermissionModalVisible(false)}
              >
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalButton, styles.settingsButton]}
                onPress={() => {
                  setPermissionModalVisible(false);
                  openSettings();
                }}
              >
                <Text style={styles.modalButtonText}>Open Settings</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    backgroundColor: '#F5F7FA',
  },
  connectionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    backgroundColor: 'white',
    padding: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  connectedText: {
    color: '#10B981',
    marginRight: 10,
    fontWeight: '600',
    fontSize: 14,
  },
  disconnectedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  disconnectedInfo: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  disconnectedText: {
    color: '#EF4444',
    marginRight: 10,
    fontWeight: '600',
    fontSize: 14,
  },
  serverInfo: {
    color: '#6B7280',
    fontSize: 12,
    marginTop: 4,
  },
  reconnectButton: {
    backgroundColor: '#3B82F6',
    padding: 8,
    borderRadius: 8,
    marginLeft: 5,
  },
  reconnectText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 15,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginBottom: 15,
    backgroundColor: 'white',
    fontSize: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
    color: '#1F2937',
    minHeight: 50,
  },
  qualitySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 15,
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  label: {
    marginRight: 15,
    fontSize: 16,
    color: '#374151',
    fontWeight: '500',
  },
  qualityOptions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 200,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 15,
    marginBottom: 25,
  },
  button: {
    flex: 1,
    padding: 15,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  formatButton: {
    backgroundColor: '#10B981',
    marginRight: 8,
  },
  downloadButton: {
    backgroundColor: '#3B82F6',
    marginLeft: 8,
  },
  buttonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
  downloadsTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginVertical: 15,
    color: '#1F2937',
  },
  downloadsList: {
    flex: 1,
  },
  downloadItem: {
    padding: 15,
    backgroundColor: 'white',
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  downloadHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  downloadTitle: {
    fontWeight: '600',
    fontSize: 16,
    color: '#1F2937',
    flex: 1,
    marginRight: 10,
  },
  progressContainer: {
    height: 8,
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
    overflow: 'hidden',
    marginVertical: 8,
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#3B82F6',
  },
  statusText: {
    fontSize: 14,
    marginVertical: 4,
    color: '#6B7280',
  },
  messageText: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 4,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 30,
    color: '#9CA3AF',
    fontSize: 16,
  },
  saveButton: {
    backgroundColor: '#3B82F6',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
    alignItems: 'center',
  },
  saveButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    width: '90%',
    maxHeight: '80%',
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 20,
    textAlign: 'center',
    color: '#1F2937',
  },
  modalText: {
    marginBottom: 20,
    textAlign: 'center',
    color: '#4B5563',
    fontSize: 16,
    lineHeight: 24,
  },
  modalInstructions: {
    marginBottom: 24,
    lineHeight: 24,
    color: '#4B5563',
    fontSize: 15,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalButton: {
    padding: 12,
    borderRadius: 8,
    flex: 1,
    margin: 6,
    alignItems: 'center',
  },
  settingsButton: {
    backgroundColor: '#3B82F6',
  },
  cancelButton: {
    backgroundColor: '#E5E7EB',
  },
  modalButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 15,
  },
  playlistOption: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 15,
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: '#3B82F6',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  checkboxInner: {
    width: 16,
    height: 16,
    borderRadius: 3,
  },
  checkboxChecked: {
    backgroundColor: '#3B82F6',
  },
  checkboxLabel: {
    fontSize: 16,
    color: '#374151',
    fontWeight: '500',
  },
  playlistBadge: {
    backgroundColor: '#F43F5E',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  playlistBadgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  saveButtonDisabled: {
    backgroundColor: '#9CA3AF',
  },
  resolutionBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 6,
  },
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  formatsList: {
    maxHeight: 400,
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    padding: 8,
  },
  formatText: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    color: '#374151',
    fontSize: 14,
  },
  noFormatsText: {
    textAlign: 'center',
    margin: 20,
    color: '#9CA3AF',
    fontSize: 16,
  },
  closeButton: {
    backgroundColor: '#EF4444',
    padding: 14,
    borderRadius: 8,
    marginTop: 20,
    alignItems: 'center',
  },
  closeButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
  titleContainer: {
    // flex: 1,
    flexDirection: 'row',
    // alignItems: 'center',
    // justifyContent: 'space-between',
    // marginRight: 10,
  },
  deleteButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    // marginLeft: 8,
  },
  deleteButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
  errorText: {
    color: '#ff3b30'
  },
  successText: {
    color: '#34c759'
  },
  retryButton: {
    backgroundColor: '#ff9500'
  }
});

export default App;
