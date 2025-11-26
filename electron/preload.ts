import { contextBridge, ipcRenderer } from 'electron';

export interface TTSConfig {
  services: TTSService[];
  defaultServiceId: string | null;
  subtitleSettings: SubtitleSettings;
  language?: string;
}

export interface TTSService {
  id: string;
  name: string;
  type: 'webspeech' | 'azure' | 'elevenlabs' | 'google' | 'gemini';
  apiKey?: string;
  region?: string;
  voiceId: string;
  voiceName: string;
  voices?: Voice[];
  modelId?: string; // For ElevenLabs model selection
  style?: string;
   speedFactor?: number;
}

export interface SubtitleSettings {
  transcriptionPrompt: string;
  normalizeForTranscription?: boolean;
  useConvertCache?: boolean;
}

export interface AlignmentRunOptions {
  videoPaths: string[];
  audioPaths: string[];
  prepend?: string;
  outputPath?: string | null;
  runId?: string;
}

export interface AlignmentRunResult {
  success?: boolean;
  error?: string;
  logs?: string[];
  outputPath?: string;
  reportData?: AlignmentReportEntry[];
}

export interface AlignmentLogEvent {
  runId: string;
  message: string;
}

export interface AlignmentEnvCheck {
  ffmpegAvailable: boolean;
}

export interface AlignmentReportEntry {
  title: string;
  video: string;
  audio: string;
  offsetMs: number;
  score: number;
  output: string;
}

export interface Voice {
  id: string;
  name: string;
  language?: string;
}

export interface VoicesResult {
  voices?: Voice[];
  error?: string;
  useWebSpeech?: boolean;
}

export interface SpeakResult {
  success?: boolean;
  audioPath?: string;
  error?: string;
  useWebSpeech?: boolean;
}

export interface SaveResult {
  success?: boolean;
  path?: string;
  error?: string;
}

const electronAPI = {
  config: {
    load: (): Promise<TTSConfig> => ipcRenderer.invoke('config:load'),
    save: (config: TTSConfig): Promise<boolean> => ipcRenderer.invoke('config:save', config),
  },
  alignment: {
    checkEnv: (): Promise<AlignmentEnvCheck> => ipcRenderer.invoke('alignment:checkEnv'),
    run: (options: AlignmentRunOptions): Promise<AlignmentRunResult> =>
      ipcRenderer.invoke('alignment:run', options),
    saveOutput: (sourcePath: string, suggestedName?: string): Promise<{ success?: boolean; error?: string; path?: string; canceled?: boolean }> =>
      ipcRenderer.invoke('alignment:saveOutput', sourcePath, suggestedName),
    onLog: (callback: (payload: AlignmentLogEvent) => void) => {
      const listener = (_: unknown, payload: AlignmentLogEvent) => callback(payload);
      ipcRenderer.on('alignment:log', listener);
      return () => ipcRenderer.removeListener('alignment:log', listener);
    },
  },
  azure: {
    getVoices: (apiKey: string, region: string): Promise<VoicesResult> =>
      ipcRenderer.invoke('azure:getVoices', apiKey, region),
    speak: (text: string, voiceId: string, apiKey: string, region: string, speed?: number): Promise<SpeakResult> =>
      ipcRenderer.invoke('azure:speak', text, voiceId, apiKey, region, speed),
    saveToFile: (text: string, voiceId: string, apiKey: string, region: string, outputPath: string, speed?: number): Promise<SaveResult> =>
      ipcRenderer.invoke('azure:saveToFile', text, voiceId, apiKey, region, outputPath, speed),
  },
  elevenlabs: {
    getVoices: (apiKey: string): Promise<VoicesResult> =>
      ipcRenderer.invoke('elevenlabs:getVoices', apiKey),
    speak: (text: string, voiceId: string, apiKey: string, modelId?: string, speed?: number): Promise<SpeakResult> =>
      ipcRenderer.invoke('elevenlabs:speak', text, voiceId, apiKey, modelId, speed),
    saveToFile: (text: string, voiceId: string, apiKey: string, outputPath: string, modelId?: string, speed?: number): Promise<SaveResult> =>
      ipcRenderer.invoke('elevenlabs:saveToFile', text, voiceId, apiKey, outputPath, modelId, speed),
  },
  google: {
    getVoices: (apiKey: string): Promise<VoicesResult> =>
      ipcRenderer.invoke('google:getVoices', apiKey),
    speak: (text: string, voiceId: string, apiKey: string, speed?: number): Promise<SpeakResult> =>
      ipcRenderer.invoke('google:speak', text, voiceId, apiKey, speed),
    saveToFile: (text: string, voiceId: string, apiKey: string, outputPath: string, speed?: number): Promise<SaveResult> =>
      ipcRenderer.invoke('google:saveToFile', text, voiceId, apiKey, outputPath, speed),
  },
  gemini: {
    getVoices: (): Promise<VoicesResult> => ipcRenderer.invoke('gemini:getVoices'),
    speak: (text: string, voiceId: string, apiKey: string, stylePrompt?: string, speed?: number): Promise<SpeakResult> =>
      ipcRenderer.invoke('gemini:speak', text, voiceId, apiKey, stylePrompt, speed),
    saveToFile: (text: string, voiceId: string, apiKey: string, outputPath: string, stylePrompt?: string, speed?: number): Promise<SaveResult> =>
      ipcRenderer.invoke('gemini:saveToFile', text, voiceId, apiKey, outputPath, stylePrompt, speed),
    transcribe: (
      audioPath: string,
      apiKey: string,
      prompt?: string,
      startMs?: number,
      endMs?: number,
      normalizeAudio?: boolean
    ): Promise<{ text?: string; error?: string }> =>
      ipcRenderer.invoke('gemini:transcribe', audioPath, apiKey, prompt, startMs, endMs, normalizeAudio),
  },
  system: {
    saveToFile: (text: string, voiceName: string, outputPath: string, speed?: number): Promise<SaveResult> =>
      ipcRenderer.invoke('system:saveToFile', text, voiceName, outputPath, speed),
    checkFfmpeg: (): Promise<boolean> => ipcRenderer.invoke('system:checkFfmpeg'),
    createTempDir: (): Promise<string> => ipcRenderer.invoke('system:createTempDir'),
    removeDir: (dirPath: string): Promise<boolean> => ipcRenderer.invoke('system:removeDir', dirPath),
    getPlatform: (): Promise<string> => ipcRenderer.invoke('system:getPlatform'),
    mixAudio: (clips: { path: string; startTime: number }[], outputPath: string, backgroundPath?: string): Promise<SaveResult> =>
      ipcRenderer.invoke('system:mixAudio', clips, outputPath, backgroundPath),
    getAudioDuration: (path: string): Promise<{ duration?: number; error?: string }> =>
      ipcRenderer.invoke('system:getAudioDuration', path),
  },
  dialog: {
    saveFile: (): Promise<string | undefined> => ipcRenderer.invoke('dialog:saveFile'),
    saveAlignOutput: (): Promise<{ path?: string; canceled?: boolean }> =>
      ipcRenderer.invoke('dialog:saveAlignOutput'),
    pickAlignPaths: (
      kind: 'video' | 'audio'
    ): Promise<{ paths?: string[]; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke('dialog:pickAlignPaths', kind),
    chooseFolder: (): Promise<{ path?: string; canceled?: boolean }> =>
      ipcRenderer.invoke('dialog:chooseFolder'),
    openMediaFile: (): Promise<{ path?: string; error?: string; kind?: 'audio' | 'video' }> =>
      ipcRenderer.invoke('dialog:openMediaFile'),
    openSrtFile: (): Promise<{ path?: string; content?: string; error?: string }> =>
      ipcRenderer.invoke('dialog:openSrtFile'),
  },
  audio: {
    play: (filePath: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('audio:play', filePath),
    onPlayFile: (callback: (filePath: string) => void) => {
      ipcRenderer.on('audio:playFile', (_, filePath) => callback(filePath));
    },
  },
  subtitle: {
    convertVideoToAudio: (inputPath: string): Promise<{ audioPath?: string; error?: string }> =>
      ipcRenderer.invoke('subtitle:convertVideoToAudio', inputPath),
    prepareAudioForPlayback: (inputPath: string): Promise<{ audioPath?: string; error?: string }> =>
      ipcRenderer.invoke('subtitle:prepareAudioForPlayback', inputPath),
    ensureTempSrt: (suggestedName?: string): Promise<string> =>
      ipcRenderer.invoke('subtitle:ensureTempSrt', suggestedName),
    writeSrt: (path: string, content: string): Promise<{ path: string; success: boolean; error?: string }> =>
      ipcRenderer.invoke('subtitle:writeSrt', path, content),
    saveSrt: (content: string, suggestedName?: string): Promise<{ path?: string; error?: string }> =>
      ipcRenderer.invoke('subtitle:saveSrt', content, suggestedName),
    getConvertCacheDir: (): Promise<{ path?: string; error?: string }> =>
      ipcRenderer.invoke('subtitle:getConvertCacheDir'),
    readConvertCache: (): Promise<{ entries: Record<string, unknown>; error?: string }> =>
      ipcRenderer.invoke('subtitle:readConvertCache'),
    writeConvertCache: (entries: Record<string, unknown>): Promise<{ success?: boolean; error?: string }> =>
      ipcRenderer.invoke('subtitle:writeConvertCache', entries),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
