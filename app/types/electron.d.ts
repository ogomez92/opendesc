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
  style?: string; // For Gemini style instructions
  speedFactor?: number; // Audio speed multiplier (1 = no change)
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
}

export interface SpeakResult {
  success?: boolean;
  audioPath?: string;
  error?: string;
}

export interface SaveResult {
  success?: boolean;
  path?: string;
  error?: string;
}

export interface TranscribeResult {
  text?: string;
  error?: string;
}

export interface ElectronAPI {
  config: {
    load: () => Promise<TTSConfig>;
    save: (config: TTSConfig) => Promise<boolean>;
  };
  alignment: {
    checkEnv: () => Promise<AlignmentEnvCheck>;
    run: (options: AlignmentRunOptions) => Promise<AlignmentRunResult>;
    saveOutput: (sourcePath: string, suggestedName?: string) => Promise<{ success?: boolean; error?: string; path?: string; canceled?: boolean }>;
    onLog: (callback: (payload: AlignmentLogEvent) => void) => () => void;
  };
  azure: {
    getVoices: (apiKey: string, region: string) => Promise<VoicesResult>;
    speak: (text: string, voiceId: string, apiKey: string, region: string, speed?: number) => Promise<SpeakResult>;
    saveToFile: (text: string, voiceId: string, apiKey: string, region: string, outputPath: string, speed?: number) => Promise<SaveResult>;
  };
  elevenlabs: {
    getVoices: (apiKey: string) => Promise<VoicesResult>;
    speak: (text: string, voiceId: string, apiKey: string, modelId?: string, speed?: number) => Promise<SpeakResult>;
    saveToFile: (text: string, voiceId: string, apiKey: string, outputPath: string, modelId?: string, speed?: number) => Promise<SaveResult>;
  };
  google: {
    getVoices: (apiKey: string) => Promise<VoicesResult>;
    speak: (text: string, voiceId: string, apiKey: string, speed?: number) => Promise<SpeakResult>;
    saveToFile: (text: string, voiceId: string, apiKey: string, outputPath: string, speed?: number) => Promise<SaveResult>;
  };
  gemini: {
    getVoices: () => Promise<VoicesResult>;
    speak: (text: string, voiceId: string, apiKey: string, stylePrompt?: string, speed?: number) => Promise<SpeakResult>;
    saveToFile: (text: string, voiceId: string, apiKey: string, outputPath: string, stylePrompt?: string, speed?: number) => Promise<SaveResult>;
    transcribe: (audioPath: string, apiKey: string, prompt?: string, startMs?: number, endMs?: number, normalizeAudio?: boolean) => Promise<TranscribeResult>;
  };
  system: {
    saveToFile: (text: string, voiceName: string, outputPath: string, speed?: number) => Promise<SaveResult>;
    checkFfmpeg: () => Promise<boolean>;
    createTempDir: () => Promise<string>;
    removeDir: (dirPath: string) => Promise<boolean>;
    getPlatform: () => Promise<string>;
    mixAudio: (clips: { path: string; startTime: number }[], outputPath: string, backgroundPath?: string) => Promise<SaveResult>;
    getAudioDuration: (path: string) => Promise<{ duration?: number; error?: string }>;
  };
  dialog: {
    saveFile: () => Promise<string | undefined>;
    saveAlignOutput: () => Promise<{ path?: string; canceled?: boolean }>;
    pickAlignPaths: (kind: 'video' | 'audio') => Promise<{ paths?: string[]; canceled?: boolean; error?: string }>;
    chooseFolder: () => Promise<{ path?: string; canceled?: boolean }>;
    openMediaFile: () => Promise<{ path?: string; error?: string; kind?: 'audio' | 'video' }>;
    openSrtFile: () => Promise<{ path?: string; content?: string; error?: string }>;
  };
  audio: {
    play: (filePath: string) => Promise<{ success: boolean }>;
    onPlayFile: (callback: (filePath: string) => void) => void;
  };
  subtitle: {
    convertVideoToAudio: (inputPath: string) => Promise<{ audioPath?: string; error?: string }>;
    prepareAudioForPlayback: (inputPath: string) => Promise<{ audioPath?: string; error?: string }>;
    ensureTempSrt: (suggestedName?: string) => Promise<string>;
    writeSrt: (path: string, content: string) => Promise<{ path: string; success: boolean; error?: string }>;
    saveSrt: (content: string, suggestedName?: string) => Promise<{ path?: string; error?: string }>;
    getConvertCacheDir: () => Promise<{ path?: string; error?: string }>;
    readConvertCache: () => Promise<{ entries: Record<string, unknown>; error?: string }>;
    writeConvertCache: (entries: Record<string, unknown>) => Promise<{ success?: boolean; error?: string }>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
