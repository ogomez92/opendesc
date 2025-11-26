import { app, BrowserWindow, ipcMain, protocol, net } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, exec } from 'child_process';
import * as http from 'http';
import * as url from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;
let server: http.Server | null = null;
let serverPort = 0;

const CONFIG_PATH = path.join(app.getPath('userData'), 'tts-config.json');
const CONVERT_CACHE_DIR = path.join(app.getPath('userData'), 'subtitle-convert-cache');
const DEFAULT_LANGUAGE = 'en';
const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  transcriptionPrompt:
    'Transcribe the audio. You can also translate by specifying the desired output language and format in this prompt.',
  normalizeForTranscription: true,
  useConvertCache: true,
};
const ALIGN_VIDEO_EXTENSIONS = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'm4v', 'flv', 'vob'];
const ALIGN_AUDIO_EXTENSIONS = ['mp3', 'm4a', 'opus', 'wav', 'aac', 'flac', 'ac3', 'mka'];
const ALIGN_MAX_OFFSET_MS = 15 * 60 * 1000; // search window of +/- 15 minutes

interface TTSConfig {
  services: TTSService[];
  defaultServiceId: string | null;
  subtitleSettings: SubtitleSettings;
  language?: string;
}

interface TTSService {
  id: string;
  name: string;
  type: 'sapi5' | 'webspeech' | 'azure' | 'elevenlabs' | 'google' | 'gemini';
  apiKey?: string;
  region?: string;
  voiceId: string;
  voiceName: string;
  voices?: Voice[];
  modelId?: string; // For ElevenLabs model selection
  style?: string;
  speedFactor?: number;
}

interface Voice {
  id: string;
  name: string;
  language?: string;
}

interface SubtitleSettings {
  transcriptionPrompt: string;
  normalizeForTranscription?: boolean;
  useConvertCache?: boolean;
}

interface AlignmentRunOptions {
  videoPaths: string[];
  audioPaths: string[];
  prepend?: string;
  outputPath?: string | null;
  runId?: string;
}

interface AlignmentRunResult {
  success?: boolean;
  error?: string;
  logs?: string[];
  outputPath?: string;
  reportData?: AlignmentReportEntry[];
  outputs?: AlignmentReportEntry[];
}

interface AlignmentReportEntry {
  title: string;
  video: string;
  audio: string;
  offsetMs: number;
  score: number;
  output: string;
}

function loadConfig(): TTSConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(data) as Partial<TTSConfig>;
      const parsedSubtitleSettings = parsed.subtitleSettings || {};
      const transcriptionPrompt =
        (parsedSubtitleSettings as any).transcriptionPrompt ||
        (parsedSubtitleSettings as any).translationPrompt ||
        DEFAULT_SUBTITLE_SETTINGS.transcriptionPrompt;
      const subtitleSettings: SubtitleSettings = {
        ...DEFAULT_SUBTITLE_SETTINGS,
        ...parsedSubtitleSettings,
        transcriptionPrompt,
      };
      return {
        services: parsed.services || [],
        defaultServiceId: parsed.defaultServiceId ?? null,
        subtitleSettings,
        language: parsed.language || DEFAULT_LANGUAGE,
      };
    }
  } catch (error) {
    console.error('Error loading config:', error);
  }
  return { services: [], defaultServiceId: null, subtitleSettings: DEFAULT_SUBTITLE_SETTINGS, language: DEFAULT_LANGUAGE };
}

function saveConfig(config: TTSConfig): void {
  try {
    const parsedSubtitleSettings = config.subtitleSettings || {};
    const subtitleSettings: SubtitleSettings = {
      ...DEFAULT_SUBTITLE_SETTINGS,
      ...parsedSubtitleSettings,
      transcriptionPrompt:
        parsedSubtitleSettings.transcriptionPrompt ||
        (parsedSubtitleSettings as any).translationPrompt ||
        DEFAULT_SUBTITLE_SETTINGS.transcriptionPrompt,
    };
    const normalized: TTSConfig = {
      services: config.services || [],
      defaultServiceId: config.defaultServiceId ?? null,
      subtitleSettings,
      language: config.language || DEFAULT_LANGUAGE,
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(normalized, null, 2));
  } catch (error) {
    console.error('Error saving config:', error);
  }
}

function buildAtempoFilter(speed: number): string {
  if (speed === 1) return '';
  const filters: string[] = [];
  let currentSpeed = speed;

  while (currentSpeed > 2.0) {
    filters.push('atempo=2.0');
    currentSpeed /= 2.0;
  }
  while (currentSpeed < 0.5) {
    filters.push('atempo=0.5');
    currentSpeed /= 0.5;
  }
  filters.push(`atempo=${currentSpeed}`);
  return filters.join(',');
}

async function adjustAudioSpeed(inputPath: string, outputPath: string, speed: number): Promise<{ success: boolean; error?: string; path?: string }> {
  console.log(`[System] Adjusting audio speed: ${speed}x for ${inputPath}`);
  if (speed === 1) {
    if (inputPath !== outputPath) {
      try {
        fs.copyFileSync(inputPath, outputPath);
        return { success: true, path: outputPath };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    }
    return { success: true, path: inputPath };
  }

  if (!(await checkFfmpeg())) {
    return { success: false, error: 'FFmpeg is required to adjust audio speed.' };
  }

  const filter = buildAtempoFilter(speed);
  // Use a temp file for output if input and output are the same to avoid conflicts
  const tempOutput = inputPath === outputPath 
    ? path.join(path.dirname(inputPath), `speed_temp_${Date.now()}_${path.basename(inputPath)}`)
    : outputPath;

  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', ['-y', '-i', inputPath, '-filter:a', filter, '-vn', tempOutput]);
    let errorOutput = '';
    ffmpeg.stderr.on('data', (d) => (errorOutput += d.toString()));
    
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        if (inputPath === outputPath) {
            try {
                fs.renameSync(tempOutput, outputPath);
                resolve({ success: true, path: outputPath });
            } catch (e) {
                 resolve({ success: false, error: `Failed to overwrite original file: ${(e as Error).message}` });
            }
        } else {
            resolve({ success: true, path: outputPath });
        }
      } else {
        resolve({ success: false, error: `FFmpeg speed adjustment failed: ${errorOutput}` });
      }
    });
  });
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};

function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const clientPath = path.join(__dirname, '../build/client');

    server = http.createServer((req, res) => {
      let pathname = url.parse(req.url || '/').pathname || '/';

      // Handle SPA routing - serve index.html for all routes
      let filePath = path.join(clientPath, pathname);

      // If path doesn't exist or is a directory, serve index.html
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(clientPath, 'index.html');
      }

      const ext = path.extname(filePath).toLowerCase();
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

      try {
        const content = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': mimeType });
        res.end(content);
      } catch (err) {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      if (typeof address === 'object' && address) {
        serverPort = address.port;
        console.log(`Server running at http://127.0.0.1:${serverPort}`);
        resolve(serverPort);
      } else {
        reject(new Error('Failed to get server port'));
      }
    });

    server.on('error', reject);
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Allow loading local resources (file://)
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    // Start local server and load from it
    const port = await startServer();
    mainWindow.loadURL(`http://127.0.0.1:${port}`);
  }

  if (isDev && process.env.OPEN_DEVTOOLS === 'true') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (server) {
    server.close();
    server = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// IPC Handlers
ipcMain.handle('config:load', async () => {
  return loadConfig();
});

ipcMain.handle('config:save', async (_, config: TTSConfig) => {
  saveConfig(config);
  return true;
});

// Azure TTS
ipcMain.handle('azure:getVoices', async (_, apiKey: string, region: string) => {
  try {
    const response = await fetch(
      `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`,
      {
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey,
        },
      }
    );

    if (!response.ok) {
      return { error: `Azure API error: ${response.status}` };
    }

    const voices = await response.json();
    return {
      voices: voices.map((v: Record<string, string>) => ({
        id: v.ShortName,
        name: v.DisplayName,
        language: v.Locale,
      })),
    };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('azure:speak', async (_, text: string, voiceId: string, apiKey: string, region: string, speed?: number) => {
  try {
    const ssml = `
      <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
        <voice name="${voiceId}">${text}</voice>
      </speak>
    `;

    const response = await fetch(
      `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey,
          'Content-Type': 'application/ssml+xml',
          // Higher quality output
          'X-Microsoft-OutputFormat': 'audio-48khz-192kbitrate-mono-mp3',
        },
        body: ssml,
      }
    );

    if (!response.ok) {
      return { error: `Azure API error: ${response.status}` };
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const tempPath = path.join(app.getPath('temp'), `azure-tts-${Date.now()}.mp3`);
    fs.writeFileSync(tempPath, audioBuffer);

    if (speed && speed !== 1) {
        const result = await adjustAudioSpeed(tempPath, tempPath, speed);
        if (!result.success) {
            return { error: result.error };
        }
    }

    return { success: true, audioPath: tempPath };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('azure:saveToFile', async (_, text: string, voiceId: string, apiKey: string, region: string, outputPath: string, speed?: number) => {
  try {
    const ssml = `
      <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
        <voice name="${voiceId}">${text}</voice>
      </speak>
    `;

    const response = await fetch(
      `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey,
          'Content-Type': 'application/ssml+xml',
          // Higher quality output
          'X-Microsoft-OutputFormat': 'audio-48khz-192kbitrate-mono-mp3',
        },
        body: ssml,
      }
    );

    if (!response.ok) {
      return { error: `Azure API error: ${response.status}` };
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    
    if (speed && speed !== 1) {
        const tempPath = path.join(app.getPath('temp'), `azure-temp-save-${Date.now()}.mp3`);
        fs.writeFileSync(tempPath, audioBuffer);
        const result = await adjustAudioSpeed(tempPath, outputPath, speed);
        try { fs.unlinkSync(tempPath); } catch (e) {} // Clean up temp
        
        if (!result.success) return { error: result.error };
        return { success: true, path: outputPath };
    } else {
        fs.writeFileSync(outputPath, audioBuffer);
        return { success: true, path: outputPath };
    }
  } catch (error) {
    return { error: (error as Error).message };
  }
});

// ElevenLabs TTS
ipcMain.handle('elevenlabs:getVoices', async (_, apiKey: string) => {
  try {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `ElevenLabs API error: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.detail?.message) {
          errorMessage = errorJson.detail.message;
        } else if (errorJson.detail) {
          errorMessage = typeof errorJson.detail === 'string' ? errorJson.detail : JSON.stringify(errorJson.detail);
        }
      } catch {
        // Use default error message
      }
      return { error: errorMessage };
    }

    const data = await response.json();
    return {
      voices: data.voices.map((v: { voice_id: string; name: string; labels?: { language?: string } }) => ({
        id: v.voice_id,
        name: v.name,
        language: v.labels?.language || 'en',
      })),
    };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('elevenlabs:speak', async (_, text: string, voiceId: string, apiKey: string, modelId?: string, speed?: number) => {
  try {
    console.log(`[ElevenLabs] Speaking with voice: ${voiceId}, model: ${modelId || 'eleven_multilingual_v2'}`);
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: modelId || 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ElevenLabs] API Error (${response.status}):`, errorText);
      let errorMessage = `ElevenLabs API error: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.detail?.message) {
          errorMessage = errorJson.detail.message;
        } else if (errorJson.detail) {
          errorMessage = typeof errorJson.detail === 'string' ? errorJson.detail : JSON.stringify(errorJson.detail);
        }
      } catch {
        // Use default error message
      }
      return { error: errorMessage };
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const tempPath = path.join(app.getPath('temp'), `elevenlabs-tts-${Date.now()}.mp3`);
    fs.writeFileSync(tempPath, audioBuffer);

    if (speed && speed !== 1) {
        const result = await adjustAudioSpeed(tempPath, tempPath, speed);
        if (!result.success) {
            return { error: result.error };
        }
    }

    return { success: true, audioPath: tempPath };
  } catch (error) {
    console.error('[ElevenLabs] Handler Error:', error);
    return { error: (error as Error).message };
  }
});

ipcMain.handle('elevenlabs:saveToFile', async (_, text: string, voiceId: string, apiKey: string, outputPath: string, modelId?: string, speed?: number) => {
  try {
    console.log(`[ElevenLabs] Saving to file with voice: ${voiceId}, model: ${modelId || 'eleven_multilingual_v2'}`);
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: modelId || 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ElevenLabs] API Error (${response.status}):`, errorText);
      let errorMessage = `ElevenLabs API error: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.detail?.message) {
          errorMessage = errorJson.detail.message;
        } else if (errorJson.detail) {
          errorMessage = typeof errorJson.detail === 'string' ? errorJson.detail : JSON.stringify(errorJson.detail);
        }
      } catch {
        // Use default error message
      }
      return { error: errorMessage };
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    
    if (speed && speed !== 1) {
        const tempPath = path.join(app.getPath('temp'), `elevenlabs-temp-save-${Date.now()}.mp3`);
        fs.writeFileSync(tempPath, audioBuffer);
        const result = await adjustAudioSpeed(tempPath, outputPath, speed);
        try { fs.unlinkSync(tempPath); } catch (e) {} // Clean up temp
        
        if (!result.success) return { error: result.error };
        return { success: true, path: outputPath };
    } else {
        fs.writeFileSync(outputPath, audioBuffer);
        return { success: true, path: outputPath };
    }
  } catch (error) {
    return { error: (error as Error).message };
  }
});

// Google Cloud TTS
ipcMain.handle('google:getVoices', async (_, apiKey: string) => {
  try {
    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/voices?key=${apiKey}`
    );

    if (!response.ok) {
      return { error: `Google API error: ${response.status}` };
    }

    const data = await response.json();
    return {
      voices: data.voices.map((v: Record<string, unknown>) => ({
        id: v.name,
        name: `${v.name} (${(v.ssmlGender as string).toLowerCase()})`,
        language: (v.languageCodes as string[])[0],
      })),
    };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('google:speak', async (_, text: string, voiceId: string, apiKey: string, speed?: number) => {
  try {
    const languageCode = voiceId.split('-').slice(0, 2).join('-');

    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode, name: voiceId },
          audioConfig: { audioEncoding: 'MP3' },
        }),
      }
    );

    if (!response.ok) {
      return { error: `Google API error: ${response.status}` };
    }

    const data = await response.json();
    const audioBuffer = Buffer.from(data.audioContent, 'base64');
    const tempPath = path.join(app.getPath('temp'), `google-tts-${Date.now()}.mp3`);
    fs.writeFileSync(tempPath, audioBuffer);

    if (speed && speed !== 1) {
        const result = await adjustAudioSpeed(tempPath, tempPath, speed);
        if (!result.success) {
            return { error: result.error };
        }
    }

    return { success: true, audioPath: tempPath };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('google:saveToFile', async (_, text: string, voiceId: string, apiKey: string, outputPath: string, speed?: number) => {
  try {
    const languageCode = voiceId.split('-').slice(0, 2).join('-');

    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode, name: voiceId },
          audioConfig: { audioEncoding: 'MP3' },
        }),
      }
    );

    if (!response.ok) {
      return { error: `Google API error: ${response.status}` };
    }

    const data = await response.json();
    const audioBuffer = Buffer.from(data.audioContent, 'base64');

    if (speed && speed !== 1) {
        const tempPath = path.join(app.getPath('temp'), `google-temp-save-${Date.now()}.mp3`);
        fs.writeFileSync(tempPath, audioBuffer);
        const result = await adjustAudioSpeed(tempPath, outputPath, speed);
        try { fs.unlinkSync(tempPath); } catch (e) {} // Clean up temp
        
        if (!result.success) return { error: result.error };
        return { success: true, path: outputPath };
    } else {
        fs.writeFileSync(outputPath, audioBuffer);
        return { success: true, path: outputPath };
    }
  } catch (error) {
    return { error: (error as Error).message };
  }
});

// Gemini TTS & Transcription
ipcMain.handle('gemini:getVoices', async () => {
  // Gemini 2.0 Flash prebuilt voices
  const voices = [
    { id: 'Puck', name: 'Puck', language: 'en-US' },
    { id: 'Charon', name: 'Charon', language: 'en-US' },
    { id: 'Kore', name: 'Kore', language: 'en-US' },
    { id: 'Fenrir', name: 'Fenrir', language: 'en-US' },
    { id: 'Aoede', name: 'Aoede', language: 'en-US' },
  ];
  return { voices };
});

ipcMain.handle('gemini:speak', async (_, text: string, voiceId: string, apiKey: string, stylePrompt?: string, speed?: number) => {
  try {
    const finalText = stylePrompt ? `[${stylePrompt}] ${text}` : text;

    // Using REST API to bypass potential SDK issues with experimental features
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: finalText }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voiceId, // e.g. 'Puck', 'Charon'
                },
              },
            },
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Gemini] API Error (${response.status}):`, errorText);
      return { error: `Gemini API error: ${response.status} - ${errorText}` };
    }

    const data = await response.json();
    const part = data.candidates?.[0]?.content?.parts?.[0];
    
    if (!part?.inlineData?.data) {
       // Log full response for debugging if structure is different
       console.error('[Gemini] Unexpected response structure:', JSON.stringify(data, null, 2));
       throw new Error('No audio data received from Gemini.');
    }

    const audioBuffer = Buffer.from(part.inlineData.data, 'base64');
    const tempPath = path.join(app.getPath('temp'), `gemini-tts-${Date.now()}.mp3`);
    fs.writeFileSync(tempPath, audioBuffer);

    if (speed && speed !== 1) {
        const result = await adjustAudioSpeed(tempPath, tempPath, speed);
        if (!result.success) {
            return { error: result.error };
        }
    }

    return { success: true, audioPath: tempPath };
  } catch (error) {
    console.error('[Gemini] Speak Error:', error);
    return { error: (error as Error).message };
  }
});

ipcMain.handle('gemini:saveToFile', async (_, text: string, voiceId: string, apiKey: string, outputPath: string, stylePrompt?: string, speed?: number) => {

  try {

    const finalText = stylePrompt ? `[${stylePrompt}] ${text}` : text;



    const response = await fetch(

      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,

      {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({

          contents: [{ parts: [{ text: finalText }] }],

          generationConfig: {

            responseModalities: ['AUDIO'],

            speechConfig: {

              voiceConfig: {

                prebuiltVoiceConfig: {

                  voiceName: voiceId,

                },

              },

            },

          },

        }),

      }

    );



    if (!response.ok) {

      const errorText = await response.text();

      console.error(`[Gemini] API Error (${response.status}):`, errorText);

      return { error: `Gemini API error: ${response.status} - ${errorText}` };

    }



    const data = await response.json();

    const part = data.candidates?.[0]?.content?.parts?.[0];

    

    if (!part?.inlineData?.data) {

       throw new Error('No audio data received from Gemini.');

    }



    const audioData = Buffer.from(part.inlineData.data, 'base64');

    if (speed && speed !== 1) {
        const tempPath = path.join(app.getPath('temp'), `gemini-temp-save-${Date.now()}.mp3`);
        fs.writeFileSync(tempPath, audioData);
        const result = await adjustAudioSpeed(tempPath, outputPath, speed);
        try { fs.unlinkSync(tempPath); } catch (e) {} // Clean up temp
        
        if (!result.success) return { error: result.error };
        return { success: true, path: outputPath };
    } else {
        fs.writeFileSync(outputPath, audioData);
        return { success: true, path: outputPath };
    }

  } catch (error) {

    console.error('[Gemini] SaveToFile Error:', error);

    return { error: (error as Error).message };

  }

});

async function extractAudioSegment(
  inputPath: string,
  startMs: number,
  endMs: number
): Promise<{ segmentPath?: string; error?: string; tempDir?: string }> {
  const durationMs = endMs - startMs;
  if (durationMs <= 0) {
    return { error: 'Invalid segment range' };
  }

  if (!(await checkFfmpeg())) {
    return { error: 'FFmpeg is required to cut audio segments.' };
  }

  const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'tts-segment-'));
  const targetPath = path.join(tempDir, 'segment.mp3');

  const runFfmpeg = (args: string[]) =>
    new Promise<{ success: boolean; error?: string }>((resolve) => {
      const ffmpeg = spawn('ffmpeg', args);
      let errorOutput = '';
      ffmpeg.stderr.on('data', (d) => (errorOutput += d.toString()));
      ffmpeg.on('close', (code) => resolve({ success: code === 0, error: errorOutput }));
    });

  const startSec = startMs / 1000;
  const durationSec = (endMs - startMs) / 1000;

  // Re-encode to MP3 for accuracy. Stream copy (-c copy) is fast but inaccurate (keyframe snapping).
  const result = await runFfmpeg([
    '-y',
    '-ss',
    `${startSec}`,
    '-t',
    `${durationSec}`,
    '-i',
    inputPath,
    '-acodec',
    'libmp3lame',
    '-ac',
    '2',
    '-ar',
    '44100',
    '-b:a',
    '128k',
    targetPath,
  ]);

  if (result.success && fs.existsSync(targetPath)) {
    return { segmentPath: targetPath, tempDir };
  }

  return { error: result.error || 'Failed to extract audio segment.', tempDir };
}

ipcMain.handle(
  'gemini:transcribe',
  async (
    _,
    audioPath: string,
    apiKey: string,
    prompt?: string,
    startMs?: number,
    endMs?: number,
    normalizeAudio: boolean = true
  ) => {
  let tempDir: string | undefined;
  let sourcePath = audioPath;
  try {
    if (typeof startMs === 'number' && typeof endMs === 'number') {
      const segment = await extractAudioSegment(audioPath, startMs, endMs);
      if (segment.error || !segment.segmentPath) {
        return { error: segment.error || 'Could not extract audio segment.' };
      }
      sourcePath = segment.segmentPath;
      tempDir = segment.tempDir;
    } else if (startMs !== undefined || endMs !== undefined) {
      return { error: 'Both start and end times are required for segmented transcription.' };
    } else if (normalizeAudio !== false) {
      const prepared = await prepareAudioForGemini(audioPath);
      if (prepared.error || !prepared.path) {
        return { error: prepared.error || 'Could not prepare audio for transcription.' };
      }
      sourcePath = prepared.path;
      tempDir = prepared.tempDir;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    // Use the latest available Gemini 2.5 Flash model for transcription
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const audioData = fs.readFileSync(sourcePath);
    const base64Audio = audioData.toString('base64');

    const parts: any[] = [
      {
        inlineData: {
          mimeType: 'audio/mp3', // Assuming MP3 or broad compatibility. Gemini is good at detecting.
          data: base64Audio
        }
      }
    ];

    if (prompt) {
      parts.push({ text: prompt });
    } else {
      parts.push({
        text: 'Transcribe this audio. You can also translate by specifying the desired output language and format.',
      });
    }

    const result = await model.generateContent({
      contents: [{ role: 'user', parts }]
    });

    const response = await result.response;
    const text = response.text();

    return { text };
  } catch (error) {
    console.error('[Gemini] Transcribe Error:', error);
    return { error: (error as Error).message };
  } finally {
    // Clean up temporary segment directory if created
    // Delayed cleanup happens here after reading the segment
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (err) {
        console.warn('[Gemini] Failed to clean temp segment dir:', err);
      }
    }
  }
  }
);

// --- Alignment helpers (JS implementation, no Python) ---
function parseWavPcm16(filePath: string): { samples: Float32Array; sampleRate: number } {
  const buf = fs.readFileSync(filePath);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Unsupported WAV format');
  }
  // Basic WAV parser for PCM 16-bit
  let offset = 12;
  let sampleRate = 16000;
  let dataOffset = -1;
  let dataLength = -1;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ') {
      const audioFormat = buf.readUInt16LE(offset + 8);
      const numChannels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
      const bitsPerSample = buf.readUInt16LE(offset + 22);
      if (audioFormat !== 1 || numChannels !== 1 || bitsPerSample !== 16) {
        throw new Error('Expected PCM 16-bit mono WAV');
      }
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataLength = chunkSize;
      break;
    }
    offset += 8 + chunkSize;
  }
  if (dataOffset === -1 || dataLength === -1) {
    throw new Error('Invalid WAV data chunk');
  }
  const data = buf.slice(dataOffset, dataOffset + dataLength);
  const int16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  const samples = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    samples[i] = int16[i] / 32768;
  }
  return { samples, sampleRate };
}

async function extractAudioToWav(inputPath: string): Promise<{ wavPath?: string; error?: string }> {
  if (!(await checkFfmpeg())) {
    return { error: 'FFmpeg is required for alignment.' };
  }
  const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'align-audio-'));
  const wavPath = path.join(tempDir, 'audio.wav');
  const args = [
    '-y',
    '-i',
    inputPath,
    '-map',
    '0:a:0',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-sample_fmt',
    's16',
    '-vn',
    wavPath,
  ];
  const ff = spawn('ffmpeg', args, { windowsHide: true });
  let errorOutput = '';
  ff.stderr.on('data', (d) => (errorOutput += d.toString()));
  return new Promise((resolve) => {
    ff.on('close', (code) => {
      if (code === 0 && fs.existsSync(wavPath)) {
        resolve({ wavPath });
      } else {
        resolve({ error: `Failed to extract audio: ${errorOutput}` });
      }
    });
  });
}

function computeEnergyProfile(wavPath: string) {
  const { samples, sampleRate } = parseWavPcm16(wavPath);
  const hopMs = 100;
  const winMs = 200;
  const hop = Math.max(1, Math.round((sampleRate * hopMs) / 1000));
  const win = Math.max(hop, Math.round((sampleRate * winMs) / 1000));
  const energies: number[] = [];
  let idx = 0;
  const hann: number[] = [];
  for (let i = 0; i < win; i++) {
    hann.push(0.5 * (1 - Math.cos((2 * Math.PI * i) / (win - 1))));
  }
  const hannNorm = hann.reduce((a, b) => a + b, 0) || 1;
  while (idx + win <= samples.length) {
    let acc = 0;
    for (let i = 0; i < win; i++) {
      const v = samples[idx + i] * hann[i];
      acc += v * v;
    }
    energies.push(Math.log10(1 + acc / hannNorm));
    idx += hop;
  }
  return { energies, hopMs };
}

function normalizeSeries(values: number[]): { data: Float32Array; mean: number; std: number } {
  const n = values.length || 1;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const varSum = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const std = Math.max(Math.sqrt(varSum), 1e-6);
  const data = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) data[i] = (values[i] - mean) / std;
  return { data, mean, std };
}

function findBestOffset(a: number[], b: number[], hopMs: number) {
  const { data: aNorm } = normalizeSeries(a);
  const { data: bNorm } = normalizeSeries(b);
  const maxSteps = Math.floor(ALIGN_MAX_OFFSET_MS / hopMs);
  let best = { offsetMs: 0, score: -Infinity };
  for (let step = -maxSteps; step <= maxSteps; step++) {
    let sum = 0;
    let count = 0;
    const aStart = Math.max(0, -step);
    const bStart = Math.max(0, step);
    const len = Math.min(aNorm.length - aStart, bNorm.length - bStart);
    for (let i = 0; i < len; i++) {
      sum += aNorm[aStart + i] * bNorm[bStart + i];
    }
    count = len;
    const score = count > 0 ? sum / count : -Infinity;
    if (score > best.score) {
      best = { offsetMs: step * hopMs, score };
    }
  }
  return best;
}

async function muxAligned(videoPath: string, audioPath: string, offsetMs: number, outputPath: string) {
  const filters: string[] = [];
  if (offsetMs >= 0) {
    filters.push(`[1:a]adelay=${Math.round(offsetMs)}|${Math.round(offsetMs)},apad[outa]`);
  } else {
    const start = Math.max(0, (-offsetMs) / 1000);
    filters.push(`[1:a]atrim=start=${start},asetpts=PTS-STARTPTS[outa]`);
  }

  return await new Promise<{ success?: boolean; error?: string }>((resolve) => {
    const args = [
      '-y',
      '-i',
      videoPath,
      '-i',
      audioPath,
      '-filter_complex',
      filters.join(';'),
      '-map',
      '0:v:0',
      '-map',
      '[outa]',
      '-c:v',
      'copy',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '320k',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-shortest',
      outputPath,
    ];
    const ff = spawn('ffmpeg', args, { windowsHide: true });
    let errorOutput = '';
    ff.stderr.on('data', (d) => (errorOutput += d.toString()));
    ff.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ error: errorOutput || `FFmpeg exited with code ${code}` });
      }
    });
  });
}

ipcMain.handle('alignment:checkEnv', async () => {
  const ffmpegAvailable = await checkFfmpeg();
  return { ffmpegAvailable };
});

ipcMain.handle('alignment:run', async (_, options: AlignmentRunOptions): Promise<AlignmentRunResult> => {
  const logs: string[] = [];
  const sendLog = (message: string) => {
    logs.push(message);
    if (mainWindow && options.runId) {
      mainWindow.webContents.send('alignment:log', { runId: options.runId, message });
    }
  };

  if (!(await checkFfmpeg())) {
    return { error: 'FFmpeg is required for alignment.', logs };
  }

  if (!options.videoPaths?.length || !options.audioPaths?.length) {
    return { error: 'Video and audio inputs are required.', logs };
  }

  // Use lexicographic order pairing similar to original tool
  const videos = [...options.videoPaths].sort();
  const audios = [...options.audioPaths].sort();
  const pairs = Math.min(videos.length, audios.length);

  const providedOutput = options.outputPath && options.outputPath.trim().length ? path.resolve(options.outputPath) : null;
  const baseDir =
    providedOutput !== null
      ? path.dirname(providedOutput)
      : fs.mkdtempSync(path.join(app.getPath('temp'), 'align-output-'));

  let lastOutput: string | undefined;
  const reportData: AlignmentReportEntry[] = [];
  const allOutputs: AlignmentReportEntry[] = [];
  for (let i = 0; i < pairs; i++) {
    const video = path.resolve(videos[i]);
    const audio = path.resolve(audios[i]);
    const baseName = options.prepend || 'ad_';

    const deriveOutputPath = () => {
      if (providedOutput) {
        if (pairs === 1) return providedOutput;
        const ext = path.extname(providedOutput) || path.extname(video) || '.mp4';
        const name = path.basename(providedOutput, path.extname(providedOutput) || ext);
        return path.join(baseDir, `${name}_${i + 1}${ext}`);
      }
      return path.join(baseDir, `${baseName}${path.basename(video)}`);
    };

    const outputPath = deriveOutputPath();
    sendLog(`Aligning: ${path.basename(video)} with ${path.basename(audio)}`);

    const videoExtract = await extractAudioToWav(video);
    if (videoExtract.error || !videoExtract.wavPath) {
      return { error: videoExtract.error || 'Failed to extract video audio', logs };
    }
    const audioExtract = await extractAudioToWav(audio);
    if (audioExtract.error || !audioExtract.wavPath) {
      return { error: audioExtract.error || 'Failed to extract audio', logs };
    }

    const videoProfile = computeEnergyProfile(videoExtract.wavPath);
    const audioProfile = computeEnergyProfile(audioExtract.wavPath);
    if (videoProfile.energies.length < 5 || audioProfile.energies.length < 5) {
      return { error: 'Could not analyze audio energy (files too short or empty).', logs };
    }
    const best = findBestOffset(videoProfile.energies, audioProfile.energies, videoProfile.hopMs);
    sendLog(`Best offset: ${best.offsetMs.toFixed(0)} ms (score ${best.score.toFixed(3)})`);

    const mux = await muxAligned(video, audio, best.offsetMs, outputPath);
    if (mux.error) {
      return { error: mux.error, logs };
    }
    lastOutput = outputPath;

    reportData.push({
      title: path.basename(outputPath),
      video,
      audio,
      offsetMs: Math.round(best.offsetMs),
      score: best.score,
      output: outputPath,
    });
    allOutputs.push(reportData[reportData.length - 1]);

    try {
      fs.rmSync(path.dirname(videoExtract.wavPath), { recursive: true, force: true });
      fs.rmSync(path.dirname(audioExtract.wavPath), { recursive: true, force: true });
    } catch (err) {
      // ignore cleanup failures
    }
  }

  return { success: true, logs, outputPath: lastOutput, reportData, outputs: allOutputs };
});

// File dialog
ipcMain.handle('dialog:saveFile', async () => {
  const { dialog } = await import('electron');
  const result = await dialog.showSaveDialog(mainWindow!, {
    filters: [
      { name: 'MP3 Audio', extensions: ['mp3'] },
      { name: 'WAV Audio', extensions: ['wav'] },
    ],
  });
  return result.filePath;
});

ipcMain.handle('dialog:saveAlignOutput', async () => {
  const { dialog } = await import('electron');
  const result = await dialog.showSaveDialog(mainWindow!, {
    filters: [
      { name: 'Video', extensions: ['mp4', 'mkv', 'mov'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }
  return { path: result.filePath, canceled: false };
});

ipcMain.handle('alignment:saveOutput', async (_, sourcePath: string, suggestedName?: string) => {
  try {
    if (!fs.existsSync(sourcePath)) {
      return { error: 'Output file not found.' };
    }
    const { dialog } = await import('electron');
    const ext = path.extname(suggestedName || sourcePath) || 'mp4';
    const baseName = path.basename(suggestedName || sourcePath);
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: baseName,
      filters: [
        { name: 'Video', extensions: [ext.replace('.', '') || 'mp4'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.copyFileSync(sourcePath, result.filePath);
    return { success: true, path: result.filePath };
  } catch (err) {
    return { error: (err as Error).message };
  }
});

ipcMain.handle('dialog:pickAlignPaths', async (_, kind: 'video' | 'audio') => {
  const { dialog } = await import('electron');
  const filters =
    kind === 'video'
      ? [{ name: 'Video', extensions: ALIGN_VIDEO_EXTENSIONS }]
      : [{ name: 'Audio', extensions: ALIGN_AUDIO_EXTENSIONS }];

  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile', 'multiSelections', 'openDirectory'],
    filters,
  });

  if (result.canceled) {
    return { canceled: true, paths: [] };
  }

  return { paths: result.filePaths, canceled: false };
});

ipcMain.handle('dialog:chooseFolder', async () => {
  const { dialog } = await import('electron');
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  return { path: result.filePaths[0], canceled: false };
});

ipcMain.handle('dialog:openMediaFile', async () => {
  const { dialog } = await import('electron');
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: 'Audio & Video', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'mp4', 'mkv', 'mov', 'avi'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { path: undefined, kind: undefined };
  }

  const selectedPath = result.filePaths[0];
  const ext = path.extname(selectedPath).toLowerCase();
  const videoExts = ['.mp4', '.mkv', '.mov', '.avi'];

  return {
    path: selectedPath,
    kind: videoExts.includes(ext) ? 'video' : 'audio',
  };
});

ipcMain.handle('dialog:openSrtFile', async () => {
  const { dialog } = await import('electron');
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [{ name: 'SubRip Subtitle', extensions: ['srt'] }],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { path: undefined, content: undefined };
  }

  try {
    const filePath = result.filePaths[0];
    const content = fs.readFileSync(filePath, 'utf-8');
    return { path: filePath, content };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

// Play audio file
ipcMain.handle('audio:play', async (_, filePath: string) => {
  if (mainWindow) {
    mainWindow.webContents.send('audio:playFile', filePath);
  }
  return { success: true };
});

// Helper to check for ffmpeg
async function checkFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const process = spawn('ffmpeg', ['-version']);
    process.on('error', () => resolve(false));
    process.on('close', (code) => resolve(code === 0));
  });
}

// Helper to get audio duration in seconds
async function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    // Use ffmpeg to get duration if ffprobe is not separately available or just use ffmpeg -i
    // ffmpeg -i file.mp3 2>&1 | grep "Duration"
    const process = spawn('ffmpeg', ['-i', filePath]);
    let output = '';
    
    process.stderr.on('data', (data) => output += data.toString());
    
    process.on('close', () => {
      const match = output.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d+)/);
      if (match) {
        const hours = parseFloat(match[1]);
        const minutes = parseFloat(match[2]);
        const seconds = parseFloat(match[3]);
        resolve(hours * 3600 + minutes * 60 + seconds);
      } else {
        resolve(0);
      }
    });
  });
}

// Helper to generate silence file
async function generateSilence(duration: number, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // ffmpeg -f lavfi -i anullsrc=r=24000:cl=mono -t <seconds> -q:a 9 output.mp3
  const args = [
    '-f', 'lavfi',
    '-i', 'anullsrc=r=24000:cl=mono',
    '-t', duration.toString(),
    '-ar', '48000',
    '-ac', '2',
    '-c:a', 'libmp3lame',
    '-b:a', '320k',
    '-y',
    outputPath
  ];
    
    const process = spawn('ffmpeg', args);
    process.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg silence generation failed with code ${code}`));
    });
  });
}

ipcMain.handle('system:checkFfmpeg', async () => {
  return checkFfmpeg();
});

ipcMain.handle('system:createTempDir', async () => {
  const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'tts-srt-'));
  return tempDir;
});

ipcMain.handle('system:removeDir', async (_, dirPath: string) => {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    console.error('Error removing directory:', error);
    return false;
  }
});

ipcMain.handle('system:getPlatform', () => process.platform);
ipcMain.handle('system:getAudioDuration', async (_, targetPath: string) => {
  try {
    const duration = await getAudioDuration(targetPath);
    return { duration };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

async function extractAudioFromVideo(inputPath: string): Promise<{ audioPath?: string; error?: string }> {
  if (!(await checkFfmpeg())) {
    return { error: 'FFmpeg is required to convert video to audio.' };
  }

  const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'tts-audio-'));
  const targetPath = path.join(tempDir, 'extracted.mp3');

  const runFfmpeg = (args: string[]) =>
    new Promise<{ success: boolean; error?: string }>((resolve) => {
      const ffmpeg = spawn('ffmpeg', args);
      let errorOutput = '';
      ffmpeg.stderr.on('data', (data) => (errorOutput += data.toString()));
      ffmpeg.on('close', (code) => resolve({ success: code === 0, error: errorOutput }));
    });

  // Re-encode to a stable CBR MP3 to avoid timestamp drift when seeking in the renderer
  const args = [
    '-y',
    '-fflags',
    '+genpts',
    '-i',
    inputPath,
    '-vn',
    '-map',
    '0:a:0?',
    '-ac',
    '2',
    '-ar',
    '48000',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '320k',
    '-avoid_negative_ts',
    'make_zero',
    targetPath,
  ];
  const result = await runFfmpeg(args);

  if (result.success && fs.existsSync(targetPath)) {
    return { audioPath: targetPath };
  }

  return { error: result.error || 'Unable to extract audio from video.' };
}

ipcMain.handle('subtitle:convertVideoToAudio', async (_, inputPath: string) => {
  try {
    return await extractAudioFromVideo(inputPath);
  } catch (error) {
    return { error: (error as Error).message };
  }
});

async function prepareAudioForGemini(inputPath: string): Promise<{ path?: string; tempDir?: string; error?: string }> {
  if (!(await checkFfmpeg())) {
    return { path: inputPath };
  }

  const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'tts-gemini-'));
  const targetPath = path.join(tempDir, 'gemini_input.mp3');

  const runFfmpeg = (args: string[]) =>
    new Promise<{ success: boolean; error?: string }>((resolve) => {
      const ffmpeg = spawn('ffmpeg', args);
      let errorOutput = '';
      ffmpeg.stderr.on('data', (data) => (errorOutput += data.toString()));
      ffmpeg.on('close', (code) => resolve({ success: code === 0, error: errorOutput }));
    });

  // Keep stereo (helpful for mixed SFX/music), moderate bitrate/sample rate to stay lean
  const args = [
    '-y',
    '-fflags',
    '+genpts',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '2',
    '-ar',
    '44100',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    '-avoid_negative_ts',
    'make_zero',
    targetPath,
  ];

  const result = await runFfmpeg(args);
  if (result.success && fs.existsSync(targetPath)) {
    return { path: targetPath, tempDir };
  }

  return { error: result.error || 'Unable to prepare audio for transcription.' };
}

async function normalizeAudioForPlayback(inputPath: string): Promise<{ audioPath?: string; error?: string }> {
  if (!(await checkFfmpeg())) {
    return { audioPath: inputPath };
  }

  const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'tts-audio-play-'));
  const targetPath = path.join(tempDir, 'normalized.mp3');

  const runFfmpeg = (args: string[]) =>
    new Promise<{ success: boolean; error?: string }>((resolve) => {
      const ffmpeg = spawn('ffmpeg', args);
      let errorOutput = '';
      ffmpeg.stderr.on('data', (data) => (errorOutput += data.toString()));
      ffmpeg.on('close', (code) => resolve({ success: code === 0, error: errorOutput }));
    });

  // Re-encode to stable CBR MP3 with generated pts to avoid seek drift on problematic inputs
  const args = [
    '-y',
    '-fflags',
    '+genpts',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '2',
    '-ar',
    '48000',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '320k',
    '-avoid_negative_ts',
    'make_zero',
    targetPath,
  ];

  const result = await runFfmpeg(args);
  if (result.success && fs.existsSync(targetPath)) {
    return { audioPath: targetPath };
  }

  return { error: result.error || 'Unable to normalize audio for playback.' };
}

ipcMain.handle('subtitle:prepareAudioForPlayback', async (_, inputPath: string) => {
  try {
    return await normalizeAudioForPlayback(inputPath);
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('subtitle:ensureTempSrt', async (_, suggestedName?: string) => {
  const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'tts-subs-'));
  const baseName = suggestedName
    ? path.basename(suggestedName, path.extname(suggestedName))
    : 'subtitles';
  const targetPath = path.join(tempDir, `${baseName}.srt`);
  if (!fs.existsSync(targetPath)) {
    fs.writeFileSync(targetPath, '');
  }
  return targetPath;
});

ipcMain.handle('subtitle:writeSrt', async (_, targetPath: string, content: string) => {
  try {
    fs.writeFileSync(targetPath, content, 'utf-8');
    return { success: true, path: targetPath };
  } catch (error) {
    return { success: false, error: (error as Error).message, path: targetPath };
  }
});

ipcMain.handle('subtitle:saveSrt', async (_, content: string, suggestedName?: string) => {
  const { dialog } = await import('electron');
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: suggestedName ? `${suggestedName}.srt` : 'subtitles.srt',
    filters: [{ name: 'SubRip Subtitle', extensions: ['srt'] }],
  });

  if (result.canceled || !result.filePath) {
    return { path: undefined };
  }

  try {
    fs.writeFileSync(result.filePath, content, 'utf-8');
    return { path: result.filePath };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('subtitle:translateWithGemini', async (_, text: string, apiKey: string, prompt: string) => {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(`${prompt}\n\n${text}`);
    const response = await result.response;
    return { text: response.text() };
  } catch (error) {
    console.error('[Gemini] Translate Error:', error);
    return { error: (error as Error).message };
  }
});

// System (Local Native) TTS - Windows (SAPI5) and macOS (say)
ipcMain.handle('system:saveToFile', async (_, text: string, voiceName: string, outputPath: string, speed?: number) => {
  const hasFfmpeg = await checkFfmpeg();
  const isMp3 = outputPath.toLowerCase().endsWith('.mp3');
  
  if (isMp3 && !hasFfmpeg) {
     return { error: 'FFmpeg is required to save as MP3. Please install FFmpeg or save as WAV.' };
  }
  if (speed && speed !== 1 && !hasFfmpeg) {
      return { error: 'FFmpeg is required to adjust audio speed.' };
  }

  // Always generate to a temp WAV file first
  const tempWavPath = path.join(app.getPath('temp'), `tts_sys_raw_${Date.now()}.wav`);

  let saveResult: { success?: boolean; error?: string; path?: string } = { error: 'Unsupported platform' };

  if (process.platform === 'win32') {
    try {
      const tempScriptPath = path.join(app.getPath('temp'), `sapi_save_${Date.now()}.ps1`);
      const psScript = `
        param($Text, $VoiceName, $OutputPath)
        Add-Type -AssemblyName System.Speech
        $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
        try {
          try { $synth.SelectVoice($VoiceName) } catch {
            $voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Name -like "*$VoiceName*" } | Select-Object -First 1
            if ($voice) { $synth.SelectVoice($voice.VoiceInfo.Name) }
          }
          $synth.SetOutputToWaveFile($OutputPath)
          $synth.Speak($Text)
        } finally { $synth.Dispose() }
      `;
      fs.writeFileSync(tempScriptPath, psScript);
      const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tempScriptPath, '-Text', text, '-VoiceName', voiceName, '-OutputPath', tempWavPath]);
      
      saveResult = await new Promise((resolve) => {
        let errorOutput = '';
        ps.stderr.on('data', d => errorOutput += d.toString());
        ps.on('close', (code) => {
          try { fs.unlinkSync(tempScriptPath); } catch (e) {}
          if (code === 0) resolve({ success: true });
          else resolve({ error: `PowerShell error: ${errorOutput}` });
        });
      });
    } catch (error) { saveResult = { error: (error as Error).message }; }
  } else if (process.platform === 'darwin') {
    try {
      const cleanVoiceName = voiceName.replace(/ \(.*\)$/, '');
      const child = spawn('say', ['-v', cleanVoiceName, '-o', tempWavPath]);
      child.stdin.write(text);
      child.stdin.end();
      
      saveResult = await new Promise((resolve) => {
        let errorOutput = '';
        child.stderr.on('data', d => errorOutput += d.toString());
        child.on('close', (code) => {
          if (code === 0) resolve({ success: true });
          else resolve({ error: `macOS 'say' error: ${errorOutput}` });
        });
        child.on('error', err => resolve({ error: err.message }));
      });
    } catch (error) { saveResult = { error: (error as Error).message }; }
  }

  if (!saveResult.success) {
      try { if (fs.existsSync(tempWavPath)) fs.unlinkSync(tempWavPath); } catch(e) {}
      return saveResult;
  }

  let currentPath = tempWavPath;

  // Apply speed adjustment if needed
  if (speed && speed !== 1) {
      const speedWavPath = path.join(app.getPath('temp'), `tts_sys_speed_${Date.now()}.wav`);
      const result = await adjustAudioSpeed(currentPath, speedWavPath, speed);
      
      // Clean up previous step
      try { fs.unlinkSync(currentPath); } catch (e) {}

      if (!result.success) {
          return { error: result.error };
      }
      currentPath = speedWavPath;
  }

  // Finalize: Convert to MP3 if requested, or move WAV to final destination
  if (isMp3) {
    return new Promise((resolve) => {
      const ffmpeg = spawn('ffmpeg', ['-y', '-i', currentPath, '-codec:a', 'libmp3lame', '-qscale:a', '2', outputPath]);
      ffmpeg.on('close', (code) => {
        try { fs.unlinkSync(currentPath); } catch (e) {}
        
        if (code === 0) {
          resolve({ success: true, path: outputPath });
        } else {
          resolve({ error: 'Failed to convert to MP3 with FFmpeg' });
        }
      });
    });
  } else {
      // Move WAV to destination
      try {
          fs.copyFileSync(currentPath, outputPath);
          fs.unlinkSync(currentPath);
          return { success: true, path: outputPath };
      } catch (e) {
          return { error: `Failed to save file: ${(e as Error).message}` };
      }
  }
});

// Mix audio clips for subtitles
ipcMain.handle('system:mixAudio', async (_, clips: { path: string; startTime: number }[], outputPath: string, backgroundPath?: string) => {
  if (!(await checkFfmpeg())) {
    return { error: 'FFmpeg is required for mixing audio.' };
  }

  const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'tts-mix-'));
  const concatListPath = path.join(tempDir, 'concat_list.txt');
  const ttsTimelinePath = path.join(tempDir, 'tts_timeline.mp3');
  let concatFileContent = '';
  let currentTime = 0;

  try {
    // Sort clips by start time just in case
    clips.sort((a, b) => a.startTime - b.startTime);

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const gap = clip.startTime - currentTime;

      if (gap > 0) { 
        const silencePath = path.join(tempDir, `silence_${i}.mp3`);
        await generateSilence(gap / 1000, silencePath);
        concatFileContent += `file '${silencePath.replace(/\\/g, '/')}'\n`;
        currentTime += gap;
      }

      // We need to know the duration of this clip to update currentTime
      // Or we can just trust the file.
      concatFileContent += `file '${clip.path.replace(/\\/g, '/')}'\n`;
      
      const duration = await getAudioDuration(clip.path);
      currentTime += duration * 1000;
    }

    fs.writeFileSync(concatListPath, concatFileContent);

    // First build the TTS timeline
    const concatResult = await new Promise<{ ok: boolean; err?: string }>((resolve) => {
      const ffmpegConcat = spawn('ffmpeg', [
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatListPath,
        '-c:a',
        'libmp3lame',
        '-b:a',
        '320k',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-y',
        ttsTimelinePath,
      ]);
      let err = '';
      ffmpegConcat.stderr.on('data', (d) => (err += d.toString()));
      ffmpegConcat.on('close', (code) => resolve({ ok: code === 0, err }));
    });

    if (!concatResult.ok) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
      return { error: `FFmpeg mix failed: ${concatResult.err}` };
    }

    if (backgroundPath) {
      // Duck background against synthesized track and mix
      const bgDuration = await getAudioDuration(backgroundPath);
      const paddedSilenceDuration = Number.isFinite(bgDuration) && bgDuration > 0 ? bgDuration + 0.5 : 0; // pad TTS with silence so background isn't cut early
      const duckingFilter = paddedSilenceDuration
        ? `[1:a]apad=whole_dur=${paddedSilenceDuration.toFixed(3)}[paddedtts];[paddedtts]asplit[tts][detector];[0:a][detector]sidechaincompress=threshold=0.1:ratio=12:attack=50:release=400:makeup=1[ducked];[ducked][tts]amix=inputs=2:normalize=0:duration=longest[out]`
        : '[1:a]asplit[tts][detector];[0:a][detector]sidechaincompress=threshold=0.1:ratio=12:attack=50:release=400:makeup=1[ducked];[ducked][tts]amix=inputs=2:normalize=0:duration=longest[out]';

      return await new Promise((resolve) => {
        const ffmpeg = spawn('ffmpeg', [
          '-i',
          backgroundPath,
          '-i',
          ttsTimelinePath,
          '-filter_complex',
          duckingFilter,
          '-map',
          '[out]',
          '-c:a',
          'libmp3lame',
          '-b:a',
          '320k',
          '-ar',
          '48000',
          '-ac',
          '2',
          '-y',
          outputPath,
        ]);
        let errorOutput = '';
        ffmpeg.stderr.on('data', (d) => (errorOutput += d.toString()));
        
        ffmpeg.on('close', (code) => {
          try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}

          if (code === 0) {
            resolve({ success: true, path: outputPath });
          } else {
            resolve({ error: `FFmpeg ducking failed: ${errorOutput}` });
          }
        });
      });
    }

    // No background: just move timeline to destination
    try {
      fs.copyFileSync(ttsTimelinePath, outputPath);
      fs.rmSync(tempDir, { recursive: true, force: true });
      return { success: true, path: outputPath };
    } catch (err) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
      return { error: (err as Error).message };
    }
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('subtitle:getConvertCacheDir', async () => {
  try {
    if (!fs.existsSync(CONVERT_CACHE_DIR)) {
      fs.mkdirSync(CONVERT_CACHE_DIR, { recursive: true });
    }
    return { path: CONVERT_CACHE_DIR };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('subtitle:readConvertCache', async () => {
  try {
    if (!fs.existsSync(CONVERT_CACHE_DIR)) {
      return { entries: {} };
    }
    const cachePath = path.join(CONVERT_CACHE_DIR, 'cache.json');
    if (!fs.existsSync(cachePath)) {
      return { entries: {} };
    }
    const raw = fs.readFileSync(cachePath, 'utf-8');
    return { entries: JSON.parse(raw) };
  } catch (error) {
    return { error: (error as Error).message, entries: {} };
  }
});

ipcMain.handle('subtitle:writeConvertCache', async (_, entries: Record<string, any>) => {
  try {
    if (!fs.existsSync(CONVERT_CACHE_DIR)) {
      fs.mkdirSync(CONVERT_CACHE_DIR, { recursive: true });
    }
    const cachePath = path.join(CONVERT_CACHE_DIR, 'cache.json');
    fs.writeFileSync(cachePath, JSON.stringify(entries, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
});
