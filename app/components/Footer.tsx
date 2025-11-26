import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Copy, Terminal } from 'lucide-react';
import { Button } from '~/components/ui/button';

export function Footer() {
  const { t } = useTranslation();
  const [ffmpegInstalled, setFfmpegInstalled] = useState<boolean | null>(null);
  const [platform, setPlatform] = useState<string>('');

  useEffect(() => {
    // Check status and platform on mount
    window.electronAPI.system.checkFfmpeg().then(setFfmpegInstalled);
    window.electronAPI.system.getPlatform().then(setPlatform);
  }, []);

  if (ffmpegInstalled === null) return null;

  const getInstallInfo = () => {
    if (platform === 'win32') {
      return { cmd: 'winget install ffmpeg', label: 'WinGet' };
    } else if (platform === 'darwin') {
      return { cmd: 'brew install ffmpeg', label: 'Homebrew' };
    } else {
      return { cmd: null, label: 'Linux' };
    }
  };

  const installInfo = getInstallInfo();

  const copyCommand = () => {
    if (installInfo.cmd) {
      navigator.clipboard.writeText(installInfo.cmd);
    }
  };

  return (
    <footer className="w-full border-t bg-background p-4">
      <div className="container mx-auto flex items-center justify-between text-sm text-muted-foreground">
        <div className="flex items-center gap-2 flex-wrap">
          {ffmpegInstalled ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span>{t('footer.ffmpegInstalled')}</span>
            </>
          ) : (
            <>
              <AlertCircle className="h-4 w-4 text-yellow-500" />
              <span>{t('footer.ffmpegMissing')}</span>
              
              {installInfo.cmd ? (
                <>
                  <span className="mx-2">•</span>
                  <span>{t('footer.command')}</span>
                  <code className="bg-muted px-2 py-1 rounded text-xs font-mono flex items-center gap-2">
                    {installInfo.cmd}
                  </code>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-6 w-6" 
                    onClick={copyCommand}
                    title="Copy command"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </>
              ) : (
                 <>
                  <span className="mx-2">•</span>
                  <span>{t('footer.linux')}</span>
                 </>
              )}

              <span className="mx-2 text-muted-foreground/50">|</span>
              <a
                href="https://ffmpeg.org/download.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline hover:no-underline"
              >
                {t('footer.installInstructions')}
              </a>
            </>
          )}
        </div>
      </div>
    </footer>
  );
}
