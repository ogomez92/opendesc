import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useTTS } from '~/contexts/TTSContext';
import { Button } from '~/components/ui/button';
import { Textarea } from '~/components/ui/textarea';
import { Label } from '~/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Play, Square, Download, Loader2 } from 'lucide-react';

export default function ReadConvert() {
  const { t } = useTranslation();
  const { defaultService, speak, saveToFile } = useTTS();

  const [text, setText] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Convert file path to proper file:// URL (handles Windows paths)
  const filePathToUrl = (filePath: string) => {
    // On Windows, convert backslashes to forward slashes and add proper prefix
    const normalizedPath = filePath.replace(/\\/g, '/');
    // If it's an absolute Windows path (e.g., C:/...), add file:///
    if (/^[a-zA-Z]:/.test(normalizedPath)) {
      return `file:///${normalizedPath}`;
    }
    // For Unix paths or already normalized paths
    return `file://${normalizedPath}`;
  };

  useEffect(() => {
    // Listen for audio file playback from main process
    if (window.electronAPI?.audio?.onPlayFile) {
      window.electronAPI.audio.onPlayFile((filePath: string) => {
        if (audioRef.current) {
          audioRef.current.src = filePathToUrl(filePath);
          audioRef.current.play();
        }
      });
    }
  }, []);

  const handlePlay = async () => {
    if (!text.trim()) {
      setError(t('readConvert.errors.noText'));
      return;
    }

    if (!defaultService) {
      setError(t('readConvert.noDefaultService'));
      return;
    }

    console.log('[ReadConvert] Playing with service:', defaultService.name, 'Speed:', defaultService.speedFactor);

    setError(null);
    setIsPlaying(true);

    try {
      const result = await speak(text, defaultService);
      if (result.error) {
        setError(result.error);
      } else if (result.audioPath) {
        // For cloud services, play the returned audio file
        if (audioRef.current) {
          audioRef.current.src = filePathToUrl(result.audioPath);
          await audioRef.current.play();
        }
      }
      // For SAPI5, the audio plays directly through Windows
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsPlaying(false);
      textareaRef.current?.focus();
    }
  };

  const handleStop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
  };

  const handleConvert = async () => {
    if (!text.trim()) {
      setError(t('readConvert.errors.noText'));
      return;
    }

    if (!defaultService) {
      setError(t('readConvert.noDefaultService'));
      return;
    }

    setError(null);
    setIsConverting(true);

    try {
      const outputPath = await window.electronAPI.dialog.saveFile();
      if (!outputPath) {
        setIsConverting(false);
        return;
      }

      const result = await saveToFile(text, outputPath, defaultService);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(t('readConvert.success.converted'));
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsConverting(false);
      textareaRef.current?.focus();
    }
  };

  const serviceName = defaultService?.name || 'N/A';

  return (
    <main className="container mx-auto p-6 max-w-4xl" role="main">
      <h1 className="text-3xl font-bold mb-6">{t('readConvert.title')}</h1>

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

      {!defaultService && (
        <Alert className="mb-4 border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
          <AlertDescription className="text-yellow-700 dark:text-yellow-300">
            {t('readConvert.noDefaultService')}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('readConvert.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="ttsText" className="sr-only">
              {t('readConvert.textPlaceholder')}
            </Label>
            <Textarea
              id="ttsText"
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('readConvert.textPlaceholder')}
              className="min-h-[300px] resize-y"
              aria-label={t('readConvert.textPlaceholder')}
            />
            <p className="text-sm text-muted-foreground">
              {text.length.toLocaleString()} characters
            </p>
          </div>

          <div className="flex flex-wrap gap-4">
            {isPlaying ? (
              <Button
                onClick={handleStop}
                variant="destructive"
                size="lg"
                aria-label={t('readConvert.stop')}
              >
                <Square className="h-5 w-5 mr-2" aria-hidden="true" />
                {t('readConvert.stop')}
              </Button>
            ) : (
              <Button
                onClick={handlePlay}
                disabled={!defaultService || !text.trim() || isConverting}
                size="lg"
                aria-label={t('readConvert.play', { service: serviceName })}
              >
                {isPlaying ? (
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" aria-hidden="true" />
                ) : (
                  <Play className="h-5 w-5 mr-2" aria-hidden="true" />
                )}
                {t('readConvert.play', { service: serviceName })}
              </Button>
            )}

            <Button
              onClick={handleConvert}
              disabled={!defaultService || !text.trim() || isPlaying || isConverting}
              variant="secondary"
              size="lg"
              aria-label={t('readConvert.convert', { service: serviceName })}
            >
              {isConverting ? (
                <Loader2 className="h-5 w-5 mr-2 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="h-5 w-5 mr-2" aria-hidden="true" />
              )}
              {isConverting
                ? t('readConvert.converting')
                : t('readConvert.convert', { service: serviceName })}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Hidden audio element for playback */}
      <audio
        ref={audioRef}
        onEnded={() => setIsPlaying(false)}
        onError={() => {
          setIsPlaying(false);
          setError(t('readConvert.errors.playFailed'));
        }}
        aria-hidden="true"
      />
    </main>
  );
}
