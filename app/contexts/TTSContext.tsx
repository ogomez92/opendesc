import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import i18n from '~/i18n';
import type { TTSConfig, TTSService, Voice, VoicesResult, SpeakResult, SaveResult, SubtitleSettings } from '~/types/electron';

interface TTSContextValue {
  config: TTSConfig;
  loading: boolean;
  error: string | null;
  defaultService: TTSService | null;
  subtitleSettings: SubtitleSettings;
  addService: (service: Omit<TTSService, 'id'>) => Promise<void>;
  updateService: (id: string, service: Partial<TTSService>) => Promise<void>;
  deleteService: (id: string) => Promise<void>;
  setDefaultService: (id: string) => Promise<void>;
  getVoices: (service: Partial<TTSService>) => Promise<VoicesResult>;
  speak: (text: string, service?: TTSService) => Promise<SpeakResult>;
  stopSpeaking: () => void;
  saveToFile: (text: string, outputPath: string, service?: TTSService) => Promise<SaveResult>;
  reloadConfig: () => Promise<void>;
  updateSubtitleSettings: (settings: SubtitleSettings) => Promise<void>;
}

const TTSContext = createContext<TTSContextValue | null>(null);
const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  transcriptionPrompt:
    'Transcribe the audio. You can also translate by specifying the desired output language and format in this prompt.',
  normalizeForTranscription: true,
  useConvertCache: true,
};
const DEFAULT_LANGUAGE = 'en';
const DEFAULT_SPEED = 1;

// Web Speech API helpers
function getWebSpeechVoices(): Promise<Voice[]> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;

    const getVoices = () => {
      const voices = synth.getVoices();
      resolve(
        voices.map((v) => ({
          id: v.voiceURI,
          name: v.name,
          language: v.lang,
        }))
      );
    };

    // Voices may not be loaded immediately
    if (synth.getVoices().length > 0) {
      getVoices();
    } else {
      synth.onvoiceschanged = getVoices;
      // Fallback timeout
      setTimeout(() => {
        if (synth.getVoices().length > 0) {
          getVoices();
        } else {
          resolve([]);
        }
      }, 1000);
    }
  });
}

function webSpeechSpeak(text: string, voiceId: string): Promise<SpeakResult> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);

    const voices = synth.getVoices();
    const voice = voices.find((v) => v.voiceURI === voiceId);
    if (voice) {
      utterance.voice = voice;
    }

    utterance.onend = () => resolve({ success: true });
    utterance.onerror = (e) => resolve({ error: e.error });

    synth.speak(utterance);
  });
}

export function TTSProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<TTSConfig>({
    services: [],
    defaultServiceId: null,
    subtitleSettings: DEFAULT_SUBTITLE_SETTINGS,
    language: DEFAULT_LANGUAGE,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentUtterance = useRef<SpeechSynthesisUtterance | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const loadedConfig = await window.electronAPI.config.load();
      if (loadedConfig.language && loadedConfig.language !== i18n.language) {
        i18n.changeLanguage(loadedConfig.language);
      }
      const rawSubtitleSettings = loadedConfig.subtitleSettings || {};
      const transcriptionPrompt =
        (rawSubtitleSettings as any).transcriptionPrompt ||
        (rawSubtitleSettings as any).translationPrompt ||
        DEFAULT_SUBTITLE_SETTINGS.transcriptionPrompt;
      const subtitleSettings: SubtitleSettings = {
        ...DEFAULT_SUBTITLE_SETTINGS,
        ...rawSubtitleSettings,
        transcriptionPrompt,
      };
      const services = (loadedConfig.services || []).map((s) => ({
        ...s,
        speedFactor: s.speedFactor ?? DEFAULT_SPEED,
      }));
      setConfig({
        services,
        defaultServiceId: loadedConfig.defaultServiceId ?? null,
        subtitleSettings,
        language: loadedConfig.language || DEFAULT_LANGUAGE,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const saveConfig = async (newConfig: TTSConfig) => {
    const normalizedConfig: TTSConfig = {
      services: (newConfig.services || []).map((s) => ({
        ...s,
        speedFactor: s.speedFactor ?? DEFAULT_SPEED,
      })),
      defaultServiceId: newConfig.defaultServiceId ?? null,
      subtitleSettings: { ...DEFAULT_SUBTITLE_SETTINGS, ...(newConfig.subtitleSettings || {}) },
      language: newConfig.language || config.language || DEFAULT_LANGUAGE,
    };
    await window.electronAPI.config.save(normalizedConfig);
    setConfig(normalizedConfig);
  };

  const addService = async (service: Omit<TTSService, 'id'>) => {
    const id = crypto.randomUUID();
    const newService: TTSService = { ...service, id };
    const newConfig: TTSConfig = {
      ...config,
      services: [...config.services, newService],
      defaultServiceId: config.defaultServiceId || id,
    };
    await saveConfig(newConfig);
  };

  const updateService = async (id: string, updates: Partial<TTSService>) => {
    const newConfig: TTSConfig = {
      ...config,
      services: config.services.map((s) =>
        s.id === id ? { ...s, ...updates } : s
      ),
    };
    await saveConfig(newConfig);
  };

  const deleteService = async (id: string) => {
    const newConfig: TTSConfig = {
      ...config,
      services: config.services.filter((s) => s.id !== id),
      defaultServiceId:
        config.defaultServiceId === id
          ? config.services.find((s) => s.id !== id)?.id || null
          : config.defaultServiceId,
    };
    await saveConfig(newConfig);
  };

  const setDefaultService = async (id: string) => {
    const newConfig: TTSConfig = {
      ...config,
      defaultServiceId: id,
    };
    await saveConfig(newConfig);
  };

  const updateSubtitleSettings = async (settings: SubtitleSettings) => {
    const normalizedSubtitleSettings: SubtitleSettings = {
      ...DEFAULT_SUBTITLE_SETTINGS,
      ...settings,
      transcriptionPrompt: settings.transcriptionPrompt || DEFAULT_SUBTITLE_SETTINGS.transcriptionPrompt,
    };
    const newConfig: TTSConfig = {
      ...config,
      subtitleSettings: normalizedSubtitleSettings,
    };
    await saveConfig(newConfig);
  };

  const getVoices = async (service: Partial<TTSService>): Promise<VoicesResult> => {
    switch (service.type) {
      case 'webspeech':
        try {
          const voices = await getWebSpeechVoices();
          return { voices };
        } catch (err) {
          return { error: (err as Error).message };
        }
      case 'azure':
        if (!service.apiKey || !service.region) {
          return { error: 'API key and region are required for Azure' };
        }
        return window.electronAPI.azure.getVoices(service.apiKey, service.region);
      case 'elevenlabs':
        if (!service.apiKey) {
          return { error: 'API key is required for ElevenLabs' };
        }
        return window.electronAPI.elevenlabs.getVoices(service.apiKey);
      case 'google':
        if (!service.apiKey) {
          return { error: 'API key is required for Google Cloud TTS' };
        }
        return window.electronAPI.google.getVoices(service.apiKey);
      case 'gemini':
        return window.electronAPI.gemini.getVoices();
      default:
        return { error: 'Unknown service type' };
    }
  };

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
  };

  const speak = async (text: string, service?: TTSService): Promise<SpeakResult> => {
    const targetService = service || config.services.find((s) => s.id === config.defaultServiceId);
    if (!targetService) {
      return { error: 'No service available' };
    }

    const speed = targetService.speedFactor ?? DEFAULT_SPEED;

    switch (targetService.type) {
      case 'webspeech':
        // WebSpeech API handles speed directly on the utterance
        return new Promise((resolve) => {
          const synth = window.speechSynthesis;
          const utterance = new SpeechSynthesisUtterance(text);

          const voices = synth.getVoices();
          const voice = voices.find((v) => v.voiceURI === targetService.voiceId);
          if (voice) {
            utterance.voice = voice;
          }
          utterance.rate = speed;

          utterance.onend = () => resolve({ success: true });
          utterance.onerror = (e) => resolve({ error: e.error });

          synth.speak(utterance);
        });
      case 'azure':
        if (!targetService.apiKey || !targetService.region) {
          return { error: 'API key and region are required for Azure' };
        }
        return window.electronAPI.azure.speak(
          text,
          targetService.voiceId,
          targetService.apiKey,
          targetService.region,
          speed
        );
      case 'elevenlabs':
        if (!targetService.apiKey) {
          return { error: 'API key is required for ElevenLabs' };
        }
        return window.electronAPI.elevenlabs.speak(
          text,
          targetService.voiceId,
          targetService.apiKey,
          targetService.modelId,
          speed
        );
      case 'google':
        if (!targetService.apiKey) {
          return { error: 'API key is required for Google Cloud TTS' };
        }
        return window.electronAPI.google.speak(
          text,
          targetService.voiceId,
          targetService.apiKey,
          speed
        );
      case 'gemini':
        if (!targetService.apiKey) {
          return { error: 'API key is required for Gemini' };
        }
        return window.electronAPI.gemini.speak(
          text,
          targetService.voiceId,
          targetService.apiKey,
          targetService.style, // Pass optional style prompt
          speed
        );
      default:
        return { error: 'Unknown service type' };
    }
  };

  const saveToFile = async (
    text: string,
    outputPath: string,
    service?: TTSService
  ): Promise<SaveResult> => {
    const targetService = service || config.services.find((s) => s.id === config.defaultServiceId);
    if (!targetService) {
      return { error: 'No service available' };
    }

    const speed = targetService.speedFactor ?? DEFAULT_SPEED;

    switch (targetService.type) {
      case 'webspeech':
        // Use the voice name as the ID for SAPI5 (Windows) or say (macOS) lookup
        return window.electronAPI.system.saveToFile(
          text,
          targetService.voiceName, // Use voiceName, not ID (URI)
          outputPath,
          speed
        );
      case 'azure':
        if (!targetService.apiKey || !targetService.region) {
          return { error: 'API key and region are required for Azure' };
        }
        return window.electronAPI.azure.saveToFile(
          text,
          targetService.voiceId,
          targetService.apiKey,
          targetService.region,
          outputPath,
          speed
        );
      case 'elevenlabs':
        if (!targetService.apiKey) {
          return { error: 'API key is required for ElevenLabs' };
        }
        return window.electronAPI.elevenlabs.saveToFile(
          text,
          targetService.voiceId,
          targetService.apiKey,
          outputPath,
          targetService.modelId,
          speed
        );
      case 'google':
        if (!targetService.apiKey) {
          return { error: 'API key is required for Google Cloud TTS' };
        }
        return window.electronAPI.google.saveToFile(
          text,
          targetService.voiceId,
          targetService.apiKey,
          outputPath,
          speed
        );
      case 'gemini':
        if (!targetService.apiKey) {
          return { error: 'API key is required for Gemini' };
        }
        return window.electronAPI.gemini.saveToFile(
          text,
          targetService.voiceId,
          targetService.apiKey,
          outputPath,
          targetService.style, // Pass optional style prompt
          speed
        );
      default:
        return { error: 'Unknown service type' };
    }
  };

  const defaultService = config.services.find((s) => s.id === config.defaultServiceId) || null;

  return (
    <TTSContext.Provider
      value={{
        config,
        loading,
        error,
        defaultService,
        subtitleSettings: config.subtitleSettings || DEFAULT_SUBTITLE_SETTINGS,
        addService,
        updateService,
        deleteService,
        setDefaultService,
        getVoices,
        speak,
        stopSpeaking,
        saveToFile,
        reloadConfig: loadConfig,
        updateSubtitleSettings,
      }}
    >
      {children}
    </TTSContext.Provider>
  );
}

export function useTTS() {
  const context = useContext(TTSContext);
  if (!context) {
    throw new Error('useTTS must be used within a TTSProvider');
  }
  return context;
}
