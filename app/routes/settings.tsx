import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useTTS } from '~/contexts/TTSContext';
import type { TTSService, Voice } from '~/types/electron';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Plus, Pencil, Trash2, Star, RefreshCw, Play } from 'lucide-react';
import { languages } from '~/i18n';

const SERVICE_TYPES = ['webspeech', 'azure', 'elevenlabs', 'google', 'gemini'] as const;

const ELEVENLABS_MODELS = [
  { id: 'eleven_multilingual_v2', name: 'Multilingual v2 (Best Quality)' },
  { id: 'eleven_turbo_v2_5', name: 'Turbo v2.5 (Fast)' },
  { id: 'eleven_turbo_v2', name: 'Turbo v2' },
  { id: 'eleven_monolingual_v1', name: 'English v1' },
  { id: 'eleven_multilingual_v1', name: 'Multilingual v1' },
] as const;

const AZURE_REGIONS = [
  'eastus', 'eastus2', 'westus', 'westus2', 'westus3',
  'centralus', 'northcentralus', 'southcentralus', 'westcentralus',
  'canadacentral', 'brazilsouth',
  'northeurope', 'westeurope', 'uksouth', 'ukwest',
  'francecentral', 'germanywestcentral', 'norwayeast', 'swedencentral',
  'switzerlandnorth', 'switzerlandwest',
  'eastasia', 'southeastasia', 'japaneast', 'japanwest',
  'koreacentral', 'koreasouth',
  'australiaeast', 'australiasoutheast',
  'centralindia', 'southindia', 'westindia',
  'uaenorth', 'southafricanorth',
] as const;

interface ServiceFormData {
  name: string;
  type: TTSService['type'];
  apiKey: string;
  region: string;
  voiceId: string;
  voiceName: string;
  modelId: string;
  style: string;
}

const initialFormData: ServiceFormData = {
  name: '',
  type: 'webspeech',
  apiKey: '',
  region: 'eastus',
  voiceId: '',
  voiceName: '',
  modelId: 'eleven_multilingual_v2',
  style: '',
  speedFactor: 1,
};

export default function Settings() {
  const { t, i18n } = useTranslation();
  const {
    config,
    addService,
    updateService,
    deleteService,
    setDefaultService,
    getVoices,
    speak,
    subtitleSettings,
    updateSubtitleSettings,
    reloadConfig,
  } = useTTS();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingService, setEditingService] = useState<TTSService | null>(null);
  const [formData, setFormData] = useState<ServiceFormData>(initialFormData);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [testText, setTestText] = useState('');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const voiceSelectRef = useRef<HTMLButtonElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const testTextInputRef = useRef<HTMLInputElement>(null);
  const [subtitlePrefs, setSubtitlePrefs] = useState(subtitleSettings);

  useEffect(() => {
    setSubtitlePrefs(subtitleSettings);
  }, [subtitleSettings]);

  const filePathToUrl = (filePath: string) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    if (/^[a-zA-Z]:/.test(normalizedPath)) {
      return `file:///${normalizedPath}`;
    }
    return `file://${normalizedPath}`;
  };

  const maskApiKey = (key: string) => {
    if (!key) return '';
    if (key.length <= 8) return '****';
    return key.substring(0, 4) + '****' + key.substring(key.length - 4);
  };

  const openAddDialog = () => {
    setEditingService(null);
    setFormData(initialFormData);
    setVoices([]);
    setError(null);
    setIsDialogOpen(true);
  };

  const openEditDialog = (service: TTSService) => {
    setEditingService(service);
    setFormData({
      name: service.name,
      type: service.type,
      apiKey: service.apiKey || '',
      region: service.region || 'eastus',
      voiceId: service.voiceId,
      voiceName: service.voiceName,
      modelId: service.modelId || 'eleven_multilingual_v2',
      style: service.style || '',
      speedFactor: service.speedFactor ?? 1,
    });
    setVoices(service.voices || []);
    setError(null);
    setIsDialogOpen(true);
  };

  const handleRefreshVoices = async () => {
    setLoadingVoices(true);
    setError(null);
    try {
      const result = await getVoices({
        type: formData.type,
        apiKey: formData.apiKey,
        region: formData.region,
      });
      if (result.error) {
        setError(result.error);
      } else if (result.voices) {
        setVoices(result.voices);
        // Focus the voice select after voices are loaded
        setTimeout(() => {
          voiceSelectRef.current?.focus();
        }, 100);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingVoices(false);
    }
  };

  const handleTest = async () => {
    if (!testText.trim() || !formData.voiceId) return;
    setTesting(true);
    setError(null);
    try {
      const result = await speak(testText, {
        id: 'test',
        name: formData.name,
        type: formData.type,
        apiKey: formData.apiKey,
        region: formData.region,
        voiceId: formData.voiceId,
        voiceName: formData.voiceName,
        modelId: formData.modelId,
        style: formData.style,
        speedFactor: formData.speedFactor,
      });
      if (result.error) {
        setError(result.error);
      } else if (result.audioPath) {
        if (audioRef.current) {
          audioRef.current.src = filePathToUrl(result.audioPath);
          await audioRef.current.play();
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTesting(false);
      testTextInputRef.current?.focus();
    }
  };

  const handleSave = async () => {
    if (!formData.name || !formData.voiceId) {
      setError('Name and voice are required');
      return;
    }

    setError(null);
    try {
      const serviceData: Omit<TTSService, 'id'> = {
        name: formData.name,
        type: formData.type,
        voiceId: formData.voiceId,
        voiceName: formData.voiceName,
        voices,
        ...(formData.type !== 'webspeech' && { apiKey: formData.apiKey }),
        ...(formData.type === 'azure' && { region: formData.region }),
        ...(formData.type === 'elevenlabs' && { modelId: formData.modelId }),
        ...(formData.type === 'gemini' && { style: formData.style }),
        speedFactor: formData.speedFactor,
      };

      if (editingService) {
        await updateService(editingService.id, serviceData);
      } else {
        await addService(serviceData);
      }

      setSuccess(t('settings.success.saved'));
      setIsDialogOpen(false);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('settings.confirmDelete'))) return;
    try {
      await deleteService(id);
      setSuccess(t('settings.success.deleted'));
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await setDefaultService(id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleSaveSubtitleSettings = async () => {
    try {
      await updateSubtitleSettings(subtitlePrefs);
      setSuccess(t('settings.subtitleDefaults.saved'));
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const needsApiKey = formData.type !== 'webspeech';
  const needsRegion = formData.type === 'azure';
  const isElevenLabs = formData.type === 'elevenlabs';
  const isGemini = formData.type === 'gemini';

  const handleLanguageChange = async (lang: string) => {
    i18n.changeLanguage(lang);
    try {
      await window.electronAPI.config.save({
        ...config,
        language: lang,
      } as any);
      await reloadConfig();
    } catch (err) {
      console.error('Failed to persist language', err);
    }
  };

  return (
    <main className="container mx-auto p-6 max-w-5xl" role="main">
      <h1 className="text-3xl font-bold mb-6">{t('settings.title')}</h1>

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
          <CardTitle>{t('settings.language')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Select
            value={i18n.language}
            onValueChange={handleLanguageChange}
          >
            <SelectTrigger className="w-[200px]" aria-label={t('settings.language')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {languages.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  {lang.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
      </CardContent>
    </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t('settings.subtitleDefaults.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <fieldset className="space-y-4 border rounded-md p-4">
            <legend className="px-1 text-sm text-muted-foreground">
              {t('settings.subtitleDefaults.legend')}
            </legend>
            <div className="space-y-2">
              <Label htmlFor="subtitleTranscriptionPrompt">
                {t('settings.subtitleDefaults.transcriptionPrompt')}
              </Label>
              <Input
                id="subtitleTranscriptionPrompt"
                value={subtitlePrefs.transcriptionPrompt}
                onChange={(e) =>
                  setSubtitlePrefs({ ...subtitlePrefs, transcriptionPrompt: e.target.value })
                }
                placeholder={t('settings.subtitleDefaults.promptPlaceholder')}
                aria-describedby="subtitleTranscriptionPromptHint"
              />
              <p
                id="subtitleTranscriptionPromptHint"
                className="text-xs text-muted-foreground"
              >
                {t('settings.subtitleDefaults.transcriptionHint', {
                  language: languages.find((lang) => lang.code === i18n.language)?.name || i18n.language,
                })}
              </p>
            </div>

            <div className="flex items-start gap-3">
              <input
                id="subtitleUseCache"
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={subtitlePrefs.useConvertCache !== false}
                onChange={(e) =>
                  setSubtitlePrefs({
                    ...subtitlePrefs,
                    useConvertCache: e.target.checked,
                  })
                }
                aria-describedby="subtitleUseCacheHint"
              />
              <div className="space-y-1">
                <Label htmlFor="subtitleUseCache" className="cursor-pointer">
                  {t('settings.subtitleDefaults.useCache')}
                </Label>
                <p
                  id="subtitleUseCacheHint"
                  className="text-xs text-muted-foreground"
                >
                  {t('settings.subtitleDefaults.useCacheHint')}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <input
                id="subtitleNormalizeTranscription"
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={subtitlePrefs.normalizeForTranscription !== false}
                onChange={(e) =>
                  setSubtitlePrefs({
                    ...subtitlePrefs,
                    normalizeForTranscription: e.target.checked,
                  })
                }
                aria-describedby="subtitleNormalizeTranscriptionHint"
              />
              <div className="space-y-1">
                <Label htmlFor="subtitleNormalizeTranscription" className="cursor-pointer">
                  {t('settings.subtitleDefaults.normalizeTranscription')}
                </Label>
                <p
                  id="subtitleNormalizeTranscriptionHint"
                  className="text-xs text-muted-foreground"
                >
                  {t('settings.subtitleDefaults.normalizeTranscriptionHint')}
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSaveSubtitleSettings}>
                {t('settings.subtitleDefaults.save')}
              </Button>
            </div>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('settings.title')}</CardTitle>
          <Button onClick={openAddDialog} aria-label={t('settings.addService')}>
            <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
            {t('settings.addService')}
          </Button>
        </CardHeader>
        <CardContent>
          {config.services.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {t('settings.noServices')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.table.name')}</TableHead>
                  <TableHead>{t('settings.table.type')}</TableHead>
                  <TableHead>{t('settings.table.voice')}</TableHead>
                  <TableHead>{t('settings.table.apiKey')}</TableHead>
                  <TableHead>{t('settings.table.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {config.services.map((service) => (
                  <TableRow key={service.id}>
                    <TableCell className="font-medium">
                      {service.name}
                      {service.id === config.defaultServiceId && (
                        <span
                          className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary text-primary-foreground"
                          aria-label={t('settings.default')}
                        >
                          {t('settings.default')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {t(`settings.serviceTypes.${service.type}`)}
                    </TableCell>
                    <TableCell>{service.voiceName}</TableCell>
                    <TableCell>
                      {service.apiKey ? maskApiKey(service.apiKey) : '-'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditDialog(service)}
                          aria-label={`${t('settings.edit')} ${service.name}`}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                          <span className="sr-only">{t('settings.edit')}</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelete(service.id)}
                          aria-label={`${t('settings.delete')} ${service.name}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                          <span className="sr-only">{t('settings.delete')}</span>
                        </Button>
                        {service.id !== config.defaultServiceId && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSetDefault(service.id)}
                            aria-label={t('settings.setDefault', { name: service.name })}
                          >
                            <Star className="h-4 w-4" aria-hidden="true" />
                            <span className="sr-only">{t('settings.setDefault', { name: service.name })}</span>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg" aria-describedby="dialog-description">
          <DialogHeader>
            <DialogTitle>
              {editingService ? t('settings.edit') : t('settings.addService')}
            </DialogTitle>
          </DialogHeader>
          <p id="dialog-description" className="sr-only">
            {editingService
              ? 'Edit the selected TTS service configuration'
              : 'Add a new TTS service configuration'}
          </p>

          <div className="space-y-4">
            {error && (
              <Alert className="border-red-500 bg-red-50 dark:bg-red-950">
                <AlertDescription className="text-red-700 dark:text-red-300">
                  {error}
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="serviceName">{t('settings.serviceName')}</Label>
              <Input
                id="serviceName"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                required
                aria-required="true"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="serviceType">{t('settings.serviceType')}</Label>
              <Select
                value={formData.type}
                onValueChange={(value: TTSService['type']) => {
                  setFormData({ ...formData, type: value, voiceId: '', voiceName: '' });
                  setVoices([]);
                }}
              >
                <SelectTrigger id="serviceType" aria-label={t('settings.serviceType')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`settings.serviceTypes.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {needsApiKey && (
              <div className="space-y-2">
                <Label htmlFor="apiKey">{t('settings.apiKey')}</Label>
                <Input
                  id="apiKey"
                  type="password"
                  value={formData.apiKey}
                  onChange={(e) =>
                    setFormData({ ...formData, apiKey: e.target.value })
                  }
                  required={needsApiKey}
                  aria-required={needsApiKey}
                />
              </div>
            )}

            {needsRegion && (
              <div className="space-y-2">
                <Label htmlFor="region">{t('settings.region')}</Label>
                <Select
                  value={formData.region}
                  onValueChange={(value) =>
                    setFormData({ ...formData, region: value })
                  }
                >
                  <SelectTrigger id="region" aria-label={t('settings.region')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AZURE_REGIONS.map((region) => (
                      <SelectItem key={region} value={region}>
                        {t(`settings.azureRegions.${region}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {isElevenLabs && (
              <div className="space-y-2">
                <Label htmlFor="modelId">{t('settings.model')}</Label>
                <Select
                  value={formData.modelId}
                  onValueChange={(value) =>
                    setFormData({ ...formData, modelId: value })
                  }
                >
                  <SelectTrigger id="modelId" aria-label={t('settings.model')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ELEVENLABS_MODELS.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {isGemini && (
              <div className="space-y-2">
                <Label htmlFor="style">Default Style / Instruction (Optional)</Label>
                <Input
                  id="style"
                  value={formData.style}
                  onChange={(e) =>
                    setFormData({ ...formData, style: e.target.value })
                  }
                  placeholder="e.g., Speak slowly and with excitement"
                />
                <p className="text-xs text-muted-foreground">
                  Gemini uses prompt engineering for voice characteristics. Enter instructions here.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="speedFactor">{t('settings.speedFactor')}</Label>
              <input
                id="speedFactor"
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={formData.speedFactor}
                onChange={(e) =>
                  setFormData({ ...formData, speedFactor: Number(e.target.value) })
                }
              />
              <p className="text-xs text-muted-foreground">
                {t('settings.speedValue', { value: formData.speedFactor.toFixed(2) })}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="voice">{t('settings.voice')}</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRefreshVoices}
                  disabled={loadingVoices || (needsApiKey && !formData.apiKey)}
                  aria-label={t('settings.refreshVoices')}
                >
                  <RefreshCw
                    className={`h-4 w-4 mr-2 ${loadingVoices ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  {t('settings.refreshVoices')}
                </Button>
              </div>
              <Select
                value={formData.voiceId}
                onValueChange={(value) => {
                  const voice = voices.find((v) => v.id === value);
                  setFormData({
                    ...formData,
                    voiceId: value,
                    voiceName: voice?.name || value,
                  });
                }}
                disabled={voices.length === 0}
              >
                <SelectTrigger id="voice" ref={voiceSelectRef} aria-label={t('settings.voice')}>
                  <SelectValue placeholder={t('settings.selectVoice')} />
                </SelectTrigger>
                <SelectContent>
                  {voices.map((voice) => (
                    <SelectItem key={voice.id} value={voice.id}>
                      {voice.name}
                      {voice.language && ` (${voice.language})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="testText">{t('settings.testText')}</Label>
              <div className="flex gap-2">
                <Input
                  id="testText"
                  ref={testTextInputRef}
                  value={testText}
                  onChange={(e) => setTestText(e.target.value)}
                  placeholder={t('settings.testTextPlaceholder')}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTest}
                  disabled={testing || !formData.voiceId || !testText.trim()}
                  aria-label={t('settings.test')}
                >
                  <Play
                    className={`h-4 w-4 mr-2 ${testing ? 'animate-pulse' : ''}`}
                    aria-hidden="true"
                  />
                  {t('settings.test')}
                </Button>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
              >
                {t('settings.cancel')}
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={!formData.name || !formData.voiceId}
              >
                {t('settings.save')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <audio ref={audioRef} className="hidden" />
    </main>
  );
}
