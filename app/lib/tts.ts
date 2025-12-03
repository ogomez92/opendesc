import type { Subtitle } from './srt';
import type { SaveResult, TTSService } from '~/types/electron';

type SaveToFile = (text: string, outputPath: string, service?: TTSService) => Promise<SaveResult>;

interface EnsureClipFitsSubtitleSlotOptions {
  baseClipPath: string;
  subtitle: Subtitle;
  baseSpeed: number;
  cacheKey: string;
  cacheDir: string;
  textForTts: string;
  hashKey: (input: string) => string;
  defaultService: TTSService;
  saveToFile: SaveToFile;
  onAdjustingSpeed?: () => void;
  onInvalidDuration?: () => Promise<string>;
}

/**
 * Ensure an audio clip fits inside a subtitle's time slot, regenerating with a higher speed if needed.
 */
export async function ensureClipFitsSubtitleSlot({
  baseClipPath,
  subtitle,
  baseSpeed,
  cacheKey,
  cacheDir,
  textForTts,
  hashKey,
  defaultService,
  saveToFile,
  onAdjustingSpeed,
  onInvalidDuration,
}: EnsureClipFitsSubtitleSlotOptions): Promise<string> {
  let finalPath = baseClipPath;

  let durationResult = await window.electronAPI.system.getAudioDuration(finalPath);
  if (durationResult.error && onInvalidDuration) {
    const refreshedPath = await onInvalidDuration();
    if (refreshedPath) {
      finalPath = refreshedPath;
      durationResult = await window.electronAPI.system.getAudioDuration(finalPath);
    }
  }

  const durationMs = durationResult.duration ? durationResult.duration * 1000 : null;
  if (!durationMs) {
    return finalPath;
  }

  const slotMs = Math.max(1, subtitle.endTime - subtitle.startTime);
  const ratio = durationMs / slotMs;
  if (ratio <= 1.02) {
    return finalPath;
  }

  const neededSpeed = Math.min(baseSpeed * ratio, 4);
  if (neededSpeed <= baseSpeed + 0.01) {
    return finalPath;
  }

  onAdjustingSpeed?.();

  const hash = hashKey(`${cacheKey}|speed|${neededSpeed}`);
  const targetPath = `${cacheDir}/${hash}.mp3`;
  const fasterResult = await saveToFile(textForTts, targetPath, { ...defaultService, speedFactor: neededSpeed });
  if (!fasterResult.error && fasterResult.path) {
    return fasterResult.path;
  }

  return finalPath;
}
