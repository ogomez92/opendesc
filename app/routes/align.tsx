import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Textarea } from '~/components/ui/textarea';
import { FolderOpen, Info, Link2, Loader2, PlayCircle, Settings as SettingsIcon, Trash2, Wand2, Download } from 'lucide-react';
import type { AlignmentReportEntry } from '~/types/electron';

type AlignListType = 'video' | 'audio';

export default function AlignPage() {
  const { t } = useTranslation();
  const [videoPaths, setVideoPaths] = useState<string[]>([]);
  const [audioPaths, setAudioPaths] = useState<string[]>([]);
  const [prepend, setPrepend] = useState('ad_');
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [reportData, setReportData] = useState<AlignmentReportEntry[] | null>(null);
  const runIdRef = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = window.electronAPI.alignment.onLog((payload) => {
      if (runIdRef.current && payload.runId === runIdRef.current) {
        setLogs((prev) => [...prev, payload.message]);
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const handlePickPaths = async (kind: AlignListType) => {
    setError(null);
    const result = await window.electronAPI.dialog.pickAlignPaths(kind);
    if (result?.error) {
      setError(result.error);
      return;
    }
    if (result?.paths?.length) {
      if (kind === 'video') {
        setVideoPaths(result.paths);
      } else {
        setAudioPaths(result.paths);
      }
    }
  };

  const clearList = (kind: AlignListType) => {
    if (kind === 'video') {
      setVideoPaths([]);
    } else {
      setAudioPaths([]);
    }
  };

  const handleRun = async () => {
    if (!videoPaths.length || !audioPaths.length) {
      setError(t('align.errors.missingInputs'));
      return;
    }

    setError(null);
    setSuccess(null);
    setLogs([]);
    setReportData(null);
    setIsRunning(true);

    const runId = crypto.randomUUID();
    runIdRef.current = runId;

    const result = await window.electronAPI.alignment.run({
      runId,
      videoPaths,
      audioPaths,
      prepend: prepend || 'ad_',
    });

    if (result.error) {
      setError(result.error);
    } else if (result.success) {
      setSuccess(t('align.success.completed'));
      if (result.reportData) {
        setReportData(result.reportData);
      }
    }

    setIsRunning(false);
    runIdRef.current = null;
  };

  const handleSaveEntry = async (entry: AlignmentReportEntry) => {
    const res = await window.electronAPI.alignment.saveOutput(entry.output, entry.title);
    if (res?.error) {
      setError(res.error);
    } else if (res?.path) {
      setSuccess(t('align.success.completedPath', { path: res.path }));
      setTimeout(() => setSuccess(null), 2500);
    }
  };

  const renderPathList = (items: string[], label: string, type: AlignListType) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        {items.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => clearList(type)}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            {t('align.clear')}
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('align.lists.empty')}</p>
      ) : (
        <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm font-mono">
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={item} className="break-all">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  return (
    <main className="container mx-auto p-6 max-w-6xl space-y-6" role="main">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Link2 className="h-6 w-6" aria-hidden="true" />
          {t('align.title')}
        </h1>
        <p className="text-muted-foreground">{t('align.description')}</p>
      </header>

      {error && (
        <Alert className="border-red-500 bg-red-50 dark:bg-red-950">
          <AlertDescription className="text-red-700 dark:text-red-300">
            {error}
          </AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
          <AlertDescription className="text-green-700 dark:text-green-300">
            {success}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" aria-hidden="true" />
            {t('align.inputs.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handlePickPaths('video')}>
                  {t('align.selectVideos')}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => clearList('video')}
                  aria-label={t('align.clear')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {renderPathList(videoPaths, t('align.lists.videos'), 'video')}
            </div>
            <div className="space-y-3">
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handlePickPaths('audio')}>
                  {t('align.selectAudios')}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => clearList('audio')}
                  aria-label={t('align.clear')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {renderPathList(audioPaths, t('align.lists.audios'), 'audio')}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5" aria-hidden="true" />
            {t('align.options.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 max-w-md">
            <Label htmlFor="prepend">{t('align.options.prepend')}</Label>
            <Input
              id="prepend"
              value={prepend}
              onChange={(e) => setPrepend(e.target.value)}
              placeholder="ad_"
            />
          </div>

          <p className="text-sm text-muted-foreground">{t('align.options.hint')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlayCircle className="h-5 w-5" aria-hidden="true" />
            {t('align.actions.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            size="lg"
            onClick={handleRun}
            disabled={isRunning || !videoPaths.length || !audioPaths.length}
          >
            {isRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
            {isRunning ? t('align.running') : t('align.run')}
          </Button>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm text-muted-foreground">{t('align.logs')}</span>
            </div>
            <Textarea
              value={logs.join('\n')}
              readOnly
              className="min-h-[240px] font-mono"
              placeholder={t('align.logsPlaceholder')}
            />
          </div>
          {reportData && reportData.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm text-muted-foreground">{t('align.report')}</span>
              </div>
              <div className="space-y-3">
                {reportData.map((entry) => (
                  <div key={entry.output} className="border rounded-md p-3 bg-muted/30 text-sm space-y-1">
                    <p className="font-semibold break-all">{entry.title}</p>
                    <p className="break-all">
                      <strong>{t('align.reportVideo')}:</strong> {entry.video}
                    </p>
                    <p className="break-all">
                      <strong>{t('align.reportAudio')}:</strong> {entry.audio}
                    </p>
                    <p>
                      <strong>{t('align.reportOffset')}:</strong> {entry.offsetMs} ms
                    </p>
                    <p>
                      <strong>{t('align.reportScore')}:</strong> {entry.score.toFixed(6)}
                    </p>
                    <p className="break-all">
                      <strong>{t('align.reportOutput')}:</strong> {entry.output}
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      onClick={() => handleSaveEntry(entry)}
                      aria-label={t('align.saveOutput')}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      {t('align.saveOutput')}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
