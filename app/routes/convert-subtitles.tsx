import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useTTS } from '~/contexts/TTSContext';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { FileText, Upload, Loader2, Music, Waves, X } from 'lucide-react';
import { parseSrt, type Subtitle } from '~/lib/srt';
import { ensureClipFitsSubtitleSlot } from '~/lib/tts';

export default function ConvertSubtitles() {
  const { t } = useTranslation();
  const { defaultService, saveToFile, subtitleSettings } = useTTS();
  const cacheRef = useRef<Record<string, { file: string; text: string; serviceId: string; voiceId: string }>>({});
  const cacheDirRef = useRef<string | null>(null);
  const useCache = subtitleSettings.useConvertCache !== false;

  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState<string>('');
  const [originalAudioPath, setOriginalAudioPath] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getCache = useCallback(async () => {
    if (!cacheDirRef.current) {
      const dirResult = await window.electronAPI.subtitle.getConvertCacheDir();
      if (dirResult.error || !dirResult.path) {
        throw new Error(dirResult.error || 'Unable to prepare cache directory.');
      }
      cacheDirRef.current = dirResult.path;
    }

    const cacheDir = cacheDirRef.current as string;

    if (!useCache) {
      cacheRef.current = {};
      return { cacheDir, cache: cacheRef.current };
    }

    if (Object.keys(cacheRef.current).length > 0) {
      return { cacheDir, cache: cacheRef.current };
    }

    const cacheResult = await window.electronAPI.subtitle.readConvertCache();
    if (cacheResult.error) {
      // Proceed with empty cache if read fails
      console.warn('Subtitle cache read error:', cacheResult.error);
    }
    cacheRef.current = (cacheResult.entries as Record<string, { file: string; text: string; serviceId: string; voiceId: string }>) || {};
    return { cacheDir, cache: cacheRef.current };
  }, [useCache]);

  const persistCache = useCallback(async () => {
    if (!useCache) return;
    await window.electronAPI.subtitle.writeConvertCache(cacheRef.current);
  }, [useCache]);

  const hashKey = (input: string) => {
    // Simple DJB2 hash for deterministic file names
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
      hash = (hash * 33) ^ input.charCodeAt(i);
    }
    return `h${(hash >>> 0).toString(16)}`;
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      try {
        const parsed = parseSrt(content);
        setSubtitles(parsed);
        setError(null);
        setSuccess(null);
      } catch (err) {
        setError('Failed to parse SRT file');
      }
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && (file.name.endsWith('.srt') || file.type === 'application/x-subrip')) {
      processFile(file);
    } else {
      setError('Please select a valid .srt file');
    }
  };

  const handleConvert = async () => {
    if (!defaultService) {
      setError(t('readConvert.noDefaultService'));
      return;
    }
    
    if (subtitles.length === 0) {
      return;
    }

    setIsProcessing(true);
    setError(null);
    setSuccess(null);
    setProgress({ current: 0, total: subtitles.length, status: 'init' });

    let finalTtsOnlyPath: string | null = null;
    let finalDuckedPath: string | null = null;

    try {
      // 1. Get Output Path(s)
      const finalPath = await window.electronAPI.dialog.saveFile();
      if (!finalPath) {
        setIsProcessing(false);
        setProgress(null);
        return;
      }
      finalTtsOnlyPath = finalPath;

      if (originalAudioPath) {
        const secondPath = await window.electronAPI.dialog.saveFile();
        if (!secondPath) {
          setIsProcessing(false);
          setProgress(null);
          return;
        }
        finalDuckedPath = secondPath;
      }

      // 2. Prepare cache dir and cache map
      const { cacheDir, cache } = await getCache();
      
      const clips: { path: string; startTime: number }[] = [];
      
      // 3. Loop and Generate
      for (let i = 0; i < subtitles.length; i++) {
        const sub = subtitles[i];
        setProgress({ 
          current: i + 1, 
          total: subtitles.length, 
          status: t('convertSubtitles.generatingAudio', { current: i + 1, total: subtitles.length })
        });
        setLiveMessage(t('convertSubtitles.generatingAudio', { current: i + 1, total: subtitles.length }));

        const textForTts = sub.text.replace(/\n/g, ' ');
        if (!textForTts.trim()) continue;

        const baseSpeed = defaultService.speedFactor ?? 1;
        const serviceKey = defaultService.id || defaultService.name || 'service';

        const cacheKey = `${serviceKey}|${textForTts}`;
        const ensureBaseClip = async () => {
          const entry = useCache ? cache[cacheKey] : null;
          if (useCache && entry?.file) {
            return { path: entry.file, fromCache: true };
          }
          const hash = hashKey(cacheKey);
          const targetPath = `${cacheDir}/${hash}.mp3`;
          const result = await saveToFile(textForTts, targetPath, { ...defaultService, speedFactor: baseSpeed });
          if (result.error || !result.path) {
            throw new Error(`Failed on subtitle ${i + 1}: ${result.error || 'unknown error'}`);
          }
          if (useCache) {
            cache[cacheKey] = {
              file: result.path,
              text: textForTts,
              serviceId: defaultService.id || '',
              voiceId: defaultService.voiceId,
            };
          }
          return { path: result.path, fromCache: false };
        };

        const baseClip = await ensureBaseClip();
        const finalPath = await ensureClipFitsSubtitleSlot({
          baseClipPath: baseClip.path,
          subtitle: sub,
          baseSpeed,
          cacheDir,
          cacheKey,
          textForTts,
          hashKey,
          defaultService,
          saveToFile,
          onAdjustingSpeed: () => {
            const statusLabel = t('convertSubtitles.adjustingSpeed', { current: i + 1, total: subtitles.length });
            setProgress({
              current: i + 1,
              total: subtitles.length,
              status: statusLabel,
            });
            setLiveMessage(statusLabel);
          },
          onInvalidDuration: async () => {
            delete cache[cacheKey];
            const refreshed = await ensureBaseClip();
            return refreshed.path;
          },
        });

        clips.push({ path: finalPath, startTime: sub.startTime });
      }

      // 4. Mix
      setProgress({ current: subtitles.length, total: subtitles.length, status: t('convertSubtitles.mixingAudio') });
      setLiveMessage(t('convertSubtitles.mixingAudio'));
      // Always render the TTS-only mix to finalTtsOnlyPath
      const mixResult = await window.electronAPI.system.mixAudio(clips, finalTtsOnlyPath, undefined);
      
      if (mixResult.error) {
        throw new Error(mixResult.error);
      }

      if (originalAudioPath && finalDuckedPath) {
        const duckedResult = await window.electronAPI.system.mixAudio(clips, finalDuckedPath, originalAudioPath || undefined);
        if (duckedResult.error) {
          throw new Error(duckedResult.error);
        }
      }

      setSuccess(
        originalAudioPath && finalDuckedPath
          ? `${t('convertSubtitles.success')} (TTS-only and ducked tracks saved)`
          : t('convertSubtitles.success')
      );

    } catch (err) {
      setError((err as Error).message);
    } finally {
      await persistCache();
      setIsProcessing(false);
      setProgress(null);
      setLiveMessage('');
    }
  };

  const handleOriginalAudioSelect = async () => {
    setError(null);
    const result = await window.electronAPI.dialog.openMediaFile();
    if (result?.error) {
      setError(result.error);
      return;
    }
    if (result?.path) {
      setOriginalAudioPath(result.path);
      setSuccess(t('convertSubtitles.originalSelected', { name: result.path.split(/[\\/]/).pop() }));
      setTimeout(() => setSuccess(null), 2000);
    }
  };

  return (
    <main className="container mx-auto p-6 max-w-4xl" role="main">
      <h1 className="text-3xl font-bold mb-6">{t('convertSubtitles.title')}</h1>

      {success && (
        <Alert className="mb-4 border-green-500 bg-green-50 dark:bg-green-950">
          <AlertDescription className="text-green-700 dark:text-green-300">
            {success}
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert className="mb-4 border-red-500 bg-red-50 dark:bg-red-950">
          <AlertDescription className="text-red-700 dark:text-red-300">
            {error}
          </AlertDescription>
        </Alert>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t('convertSubtitles.selectFile')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div 
            className="border-2 border-dashed rounded-lg p-12 text-center hover:bg-muted/50 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-lg font-medium text-muted-foreground">
              {fileName ? t('convertSubtitles.fileName', { name: fileName }) : t('convertSubtitles.dragDrop')}
            </p>
            <Button variant="outline" className="mt-4">
              <Upload className="h-4 w-4 mr-2" />
              {t('convertSubtitles.selectFile')}
            </Button>
            <input 
              type="file" 
              ref={fileInputRef}
              className="hidden" 
              accept=".srt"
              onChange={handleFileSelect} 
            />
          </div>
        </CardContent>
      </Card>

      {subtitles.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="font-medium">{subtitles.length} subtitles found</p>
                <p className="text-sm text-muted-foreground">
                  Duration: {((subtitles[subtitles.length - 1].endTime) / 1000 / 60).toFixed(2)} mins
                </p>
                <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                  <Waves className="h-4 w-4" />
                  {originalAudioPath ? (
                    <>
                      <span className="break-all">{t('convertSubtitles.originalAudio', { name: originalAudioPath.split(/[\\/]/).pop() })}</span>
                      <Button variant="ghost" size="sm" onClick={() => setOriginalAudioPath(null)}>
                        <X className="h-4 w-4 mr-1" />
                        {t('convertSubtitles.clearOriginal')}
                      </Button>
                    </>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={handleOriginalAudioSelect}>
                      <Upload className="h-4 w-4 mr-2" />
                      {t('convertSubtitles.addOriginal')}
                    </Button>
                  )}
                </div>
              </div>
              <Button 
                onClick={handleConvert} 
                disabled={isProcessing || !defaultService}
                size="lg"
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Music className="h-4 w-4 mr-2" />
                )}
                {t('readConvert.convert', { service: defaultService?.name || 'Service' })}
              </Button>
            </div>

            {progress && (
              <div className="space-y-2">
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
                <p className="text-sm text-muted-foreground text-center animate-pulse">
                  {progress.status}
                </p>
              </div>
            )}

            <div className="mt-6 max-h-[360px] overflow-y-auto border rounded-md">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium w-14">#</th>
                    <th className="text-left px-3 py-2 font-medium w-40">Time</th>
                    <th className="text-left px-3 py-2 font-medium">Text</th>
                  </tr>
                </thead>
                <tbody>
                  {subtitles.slice(0, 100).map((sub) => (
                    <tr key={sub.id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-mono text-muted-foreground align-top">#{sub.id}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground align-top">
                        {(sub.startTime / 1000).toFixed(1)}s → {(sub.endTime / 1000).toFixed(1)}s
                      </td>
                      <td className="px-3 py-2 align-top">{sub.text}</td>
                    </tr>
                  ))}
                  {subtitles.length > 100 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-2 text-xs text-muted-foreground">
                        ... and {subtitles.length - 100} more
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="sr-only" aria-live="polite">
        {liveMessage}
      </div>
    </main>
  );
}
