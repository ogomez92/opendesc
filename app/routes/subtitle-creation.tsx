import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { Textarea } from '~/components/ui/textarea';
import { useTTS } from '~/contexts/TTSContext';
import { languages } from '~/i18n';
import { Subtitle, formatTimestamp, parseSrt, serializeSrt } from '~/lib/srt';
import { ensureClipFitsSubtitleSlot } from '~/lib/tts';
import {
  AlertCircle,
  Bookmark,
  Clock,
  Loader2,
  Download,
  FileAudio2,
  FileUp,
  Flag,
  Keyboard,
  Pause,
  Play,
  Radio,
  Save,
  Scissors,
  SkipBack,
  SkipForward,
  Sparkles,
} from 'lucide-react';

const SEEK_STEP_MS = [1000, 5000, 10000, 30000, 60000, 300000, 600000, 900000, 1800000, 3600000];
const NAVIGATION_SEEKS = [
  { label: '-100ms', delta: -100 },
  { label: '-5s', delta: -5000 },
  { label: '-10s', delta: -10000 },
  { label: '-30s', delta: -30000 },
  { label: '-1m', delta: -60000 },
  { label: '-5m', delta: -300000 },
  { label: '-10m', delta: -600000 },
  { label: '-15m', delta: -900000 },
  { label: '-30m', delta: -1800000 },
  { label: '-60m', delta: -3600000 },
  { label: '+100ms', delta: 100 },
  { label: '+5s', delta: 5000 },
  { label: '+10s', delta: 10000 },
  { label: '+30s', delta: 30000 },
  { label: '+1m', delta: 60000 },
  { label: '+5m', delta: 300000 },
  { label: '+10m', delta: 600000 },
  { label: '+15m', delta: 900000 },
  { label: '+30m', delta: 1800000 },
  { label: '+60m', delta: 3600000 },
];

type ModalMode = 'insert' | 'transcribe';

export default function SubtitleCreation() {
  const { t, i18n } = useTranslation();
  const { config, subtitleSettings, defaultService, saveToFile } = useTTS();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playButtonRef = useRef<HTMLButtonElement | null>(null);
  const startMarkRef = useRef<number | null>(null);
  const endMarkRef = useRef<number | null>(null);

  const [audioPath, setAudioPath] = useState<string>('');
  const [audioSrc, setAudioSrc] = useState<string>('');
  const [mediaLabel, setMediaLabel] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekStepIndex, setSeekStepIndex] = useState(0);
  const [startMark, setStartMark] = useState<number | null>(null);
  const [endMark, setEndMark] = useState<number | null>(null);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [tempSrtPath, setTempSrtPath] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [liveMessage, setLiveMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoadingMedia, setIsLoadingMedia] = useState(false);
  const [videoDialogOpen, setVideoDialogOpen] = useState(false);
  const [pendingVideoPath, setPendingVideoPath] = useState<string | null>(null);
  const [jumpDialogOpen, setJumpDialogOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState('00:00:00');
  const [textModalOpen, setTextModalOpen] = useState(false);
  const [textModalValue, setTextModalValue] = useState('');
  const [textModalMode, setTextModalMode] = useState<ModalMode>('insert');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [segmentEnd, setSegmentEnd] = useState<number | null>(null);
  const [isPreparingAudio, setIsPreparingAudio] = useState(false);
  const [prepareMessage, setPrepareMessage] = useState<string>('');
  const [loadedSrtName, setLoadedSrtName] = useState<string | null>(null);
  const [currentSubtitleId, setCurrentSubtitleId] = useState<number | null>(null);
  const [isGeneratingClip, setIsGeneratingClip] = useState(false);
  const [overlapDialogOpen, setOverlapDialogOpen] = useState(false);
  const [overlapEdits, setOverlapEdits] = useState<Record<number, { start: string; end: string }>>({});
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef<Record<string, { file: string; text: string; serviceId: string; voiceId: string }>>({});
  const cacheDirRef = useRef<string | null>(null);
  const useConvertCache = subtitleSettings.useConvertCache !== false;
  const handleJumpDialogOpenChange = useCallback((nextOpen: boolean) => {
    setJumpDialogOpen(nextOpen);
    if (!nextOpen) {
      setTimeout(() => playButtonRef.current?.focus(), 0);
    }
  }, []);

  const appLanguageCode = useMemo(() => i18n.language, [i18n.language]);

  const filePathToUrl = (filePath: string) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    if (/^[a-zA-Z]:/.test(normalizedPath)) {
      return `file:///${normalizedPath}`;
    }
    return `file://${normalizedPath}`;
  };

  const geminiApiKey = useMemo(
    () => config.services.find((service) => service.type === 'gemini' && service.apiKey)?.apiKey,
    [config.services]
  );

  const transcriptionPrompt = useMemo(() => {
    return (
      subtitleSettings.transcriptionPrompt ||
      'Transcribe the audio. You can also translate by specifying the desired output language and format.'
    );
  }, [subtitleSettings.transcriptionPrompt]);

  const hashKey = (input: string) => {
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
      hash = (hash * 33) ^ input.charCodeAt(i);
    }
    return `h${(hash >>> 0).toString(16)}`;
  };

  const getCache = useCallback(async () => {
    if (!cacheDirRef.current) {
      const dirResult = await window.electronAPI.subtitle.getConvertCacheDir();
      if (dirResult.error || !dirResult.path) {
        throw new Error(dirResult.error || t('subtitleCreation.errors.cacheUnavailable'));
      }
      cacheDirRef.current = dirResult.path;
    }

    const cacheDir = cacheDirRef.current as string;

    if (!useConvertCache) {
      cacheRef.current = {};
      return { cacheDir, cache: cacheRef.current };
    }

    if (Object.keys(cacheRef.current).length > 0) {
      return { cacheDir, cache: cacheRef.current };
    }

    const cacheResult = await window.electronAPI.subtitle.readConvertCache();
    if (cacheResult.error) {
      console.warn('Subtitle cache read error:', cacheResult.error);
    }
    cacheRef.current =
      (cacheResult.entries as Record<string, { file: string; text: string; serviceId: string; voiceId: string }>) ||
      {};
    return { cacheDir, cache: cacheRef.current };
  }, [t, useConvertCache]);

  const persistCache = useCallback(async () => {
    if (!useConvertCache) return;
    await window.electronAPI.subtitle.writeConvertCache(cacheRef.current);
  }, [useConvertCache]);

  const currentSubtitle = useMemo(
    () => subtitles.find((sub) => sub.id === currentSubtitleId) || null,
    [currentSubtitleId, subtitles]
  );

  const playGeneratedClip = useCallback(
    async (filePath: string) => {
      try {
        const mainAudio = audioRef.current;
        if (mainAudio && !mainAudio.paused) {
          mainAudio.pause();
          setIsPlaying(false);
        }

        const preview = previewAudioRef.current ?? new Audio();
        if (!previewAudioRef.current) {
          previewAudioRef.current = preview;
        }
        const src = filePath.startsWith('file://') ? filePath : filePathToUrl(filePath);
        preview.pause();
        preview.src = src;
        preview.currentTime = 0;
        await preview.play();
      } catch (err) {
        throw new Error((err as Error).message || t('subtitleCreation.errors.playbackFailed'));
      }
    },
    [t]
  );

  const findSubtitleAtPosition = useCallback(
    (positionMs: number) =>
      subtitles.find((sub) => positionMs >= sub.startTime && positionMs < sub.endTime) || null,
    [subtitles]
  );

  const syncMarksFromSubtitle = useCallback((subtitle: Subtitle) => {
    setStartMark(subtitle.startTime);
    setEndMark(subtitle.endTime);
    startMarkRef.current = subtitle.startTime;
    endMarkRef.current = subtitle.endTime;
  }, []);

  const selectSubtitleAtCurrentTime = useCallback(
    (options?: { silent?: boolean }) => {
      const sub = findSubtitleAtPosition(currentTime);
      if (sub) {
        setCurrentSubtitleId(sub.id);
        syncMarksFromSubtitle(sub);
        return sub;
      }
      if (!options?.silent) {
        const msg = t('subtitleCreation.errors.noSubtitleAtTime');
        setError(msg);
        announce(msg);
      }
      return null;
    },
    [announce, currentTime, findSubtitleAtPosition, syncMarksFromSubtitle, t]
  );

  const resolveRangeForAction = useCallback(() => {
    const contextual = selectSubtitleAtCurrentTime({ silent: true });
    if (contextual) {
      return { start: contextual.startTime, end: contextual.endTime, subtitle: contextual };
    }
    if (startMarkRef.current !== null && endMarkRef.current !== null) {
      return {
        start: startMarkRef.current,
        end: endMarkRef.current,
        subtitle: currentSubtitle,
      };
    }
    return null;
  }, [currentSubtitle, selectSubtitleAtCurrentTime]);

  const findOverlappingIds = useCallback(() => {
    const ids = new Set<number>();
    for (let i = 0; i < subtitles.length; i++) {
      for (let j = i + 1; j < subtitles.length; j++) {
        const a = subtitles[i];
        const b = subtitles[j];
        if (a.startTime < b.endTime && b.startTime < a.endTime) {
          ids.add(a.id);
          ids.add(b.id);
        }
      }
    }
    return ids;
  }, [subtitles]);

  const applyOverlapEdits = useCallback(() => {
    setSubtitles((prev) => {
      const updated = prev.map((sub) => {
        const edits = overlapEdits[sub.id];
        if (!edits) return sub;
        const start = Number(edits.start);
        const end = Number(edits.end);
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
          return { ...sub, startTime: start, endTime: end };
        }
        return sub;
      });
      const sorted = [...updated]
        .sort((a, b) => a.startTime - b.startTime)
        .map((sub, index) => ({ ...sub, id: index + 1 }));
      return sorted;
    });
    setOverlapDialogOpen(false);
  }, [overlapEdits]);

  const handleToolbarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    if ((event.target as HTMLElement)?.dataset?.playButton === 'true') return;

    const focusables = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[data-toolbar-item="true"]')
    );
    const currentIndex = focusables.findIndex((el) => el === document.activeElement);
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex =
      currentIndex === -1
        ? 0
        : (currentIndex + delta + focusables.length) % Math.max(focusables.length, 1);
    const next = focusables[nextIndex];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  const announce = useCallback((message: string) => {
    setLiveMessage(message);
    setStatusMessage(message);
  }, []);

  const handleSeek = useCallback(
    (deltaMs: number) => {
      const audio = audioRef.current;
      if (!audio || !audio.duration || Number.isNaN(audio.duration)) return;
      const nextTime = Math.min(Math.max((audio.currentTime * 1000 + deltaMs) / 1000, 0), audio.duration);
      audio.currentTime = nextTime;
      setCurrentTime(nextTime * 1000);
      const timeLabel = formatTimestamp(nextTime * 1000);
      announce(t('subtitleCreation.live.position', { time: timeLabel }));
    },
    [announce, t]
  );

  const handlePlayPause = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    try {
      await audio.play();
      setIsPlaying(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [isPlaying]);

  const cycleSeekStep = (direction: 1 | -1) => {
    setSeekStepIndex((prev) => {
      const next = Math.min(Math.max(prev + direction, 0), SEEK_STEP_MS.length - 1);
      if (next !== prev) {
        const nextMs = SEEK_STEP_MS[next];
        const seconds = nextMs / 1000;
        const humanReadable =
          seconds >= 60
            ? `${Math.round(seconds / 60)} ${t('subtitleCreation.controls.minutes')}`
            : `${Math.round(seconds)} ${t('subtitleCreation.controls.seconds')}`;
        announce(
          t('subtitleCreation.live.seekStep', {
            value: humanReadable,
          })
        );
      }
      return next;
    });
  };

  const handlePlayKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      handleSeek(event.shiftKey ? -100 : -SEEK_STEP_MS[seekStepIndex]);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      handleSeek(event.shiftKey ? 100 : SEEK_STEP_MS[seekStepIndex]);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      cycleSeekStep(1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      cycleSeekStep(-1);
    }
  };

  const resetMarkers = () => {
    setStartMark(null);
    setEndMark(null);
  };

  const loadAudioFromPath = (path: string, label?: string) => {
    const audio = audioRef.current;
    const src = filePathToUrl(path);
    setAudioPath(path);
    setAudioSrc(src);
    if (label) setMediaLabel(label);
    setIsPlaying(false);
    setDuration(0);
    setCurrentTime(0);
    resetMarkers();
    if (audio) {
      audio.src = src;

      const onLoadedMetadata = () => {
        setDuration((audio.duration || 0) * 1000);
        setCurrentTime(audio.currentTime * 1000);
        if (subtitles.length > 0) {
          const lastSub = subtitles[subtitles.length - 1];
          const target = Math.min(lastSub.endTime / 1000, audio.duration || Infinity);
          audio.currentTime = target;
          setCurrentTime(target * 1000);
        }
        // Move focus to play for quick keyboard control once media is ready
        setTimeout(() => playButtonRef.current?.focus(), 0);
        audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      };
      audio.addEventListener('loadedmetadata', onLoadedMetadata);

      audio.load();
    }
  };

  const handleMediaSelect = async () => {
    setError(null);
    setPrepareMessage('');
    const result = await window.electronAPI.dialog.openMediaFile();
    if (result.error) {
      setError(result.error);
      return;
    }
    if (!result.path) return;
    if (result.kind === 'video') {
      setPendingVideoPath(result.path);
      setVideoDialogOpen(true);
      return;
    }
    setIsPreparingAudio(true);
    announce(t('subtitleCreation.messages.preparingAudio'));
    setPrepareMessage(t('subtitleCreation.messages.preparingAudio'));
    const prepared = await window.electronAPI.subtitle.prepareAudioForPlayback(result.path);
    if (prepared.error || !prepared.audioPath) {
      const msg = prepared.error || t('subtitleCreation.errors.playbackFailed');
      setError(msg);
      announce(msg);
      setPrepareMessage('');
    } else {
      setPrepareMessage(t('subtitleCreation.messages.audioReady'));
      announce(t('subtitleCreation.messages.audioReady'));
      loadAudioFromPath(prepared.audioPath, result.path);
    }
    setIsPreparingAudio(false);
  };

  const confirmVideoConversion = async () => {
    if (!pendingVideoPath) return;
    setIsLoadingMedia(true);
    setError(null);
    try {
      const conversion = await window.electronAPI.subtitle.convertVideoToAudio(pendingVideoPath);
      if (conversion.error || !conversion.audioPath) {
        setError(conversion.error || t('subtitleCreation.errors.convertFailed'));
        setLiveMessage(conversion.error || t('subtitleCreation.errors.convertFailed'));
      } else {
        setIsPreparingAudio(true);
        setPrepareMessage(t('subtitleCreation.messages.preparingAudio'));
        announce(t('subtitleCreation.messages.preparingAudio'));
        const prepared = await window.electronAPI.subtitle.prepareAudioForPlayback(conversion.audioPath);
        if (prepared.error || !prepared.audioPath) {
          const msg = prepared.error || t('subtitleCreation.errors.convertFailed');
          setError(msg);
          setLiveMessage(msg);
          setPrepareMessage('');
        } else {
          setPrepareMessage(t('subtitleCreation.messages.audioReady'));
          announce(t('subtitleCreation.live.converted'));
          loadAudioFromPath(prepared.audioPath, pendingVideoPath);
        }
        setIsPreparingAudio(false);
      }
    } finally {
      setIsLoadingMedia(false);
      setVideoDialogOpen(false);
      setPendingVideoPath(null);
    }
  };

  const handleJumpSubmit = (event?: React.FormEvent) => {
    event?.preventDefault();
    const audio = audioRef.current;
    if (!audio) return;
    const parts = jumpValue.split(':').filter(Boolean);
    while (parts.length < 3) parts.unshift('0');
    const [h, m, s] = parts.map((part) => Number(part || 0));
    const totalSeconds = h * 3600 + m * 60 + s;
    const clamped = Math.min(Math.max(totalSeconds, 0), audio.duration || totalSeconds);
    audio.currentTime = clamped;
    setCurrentTime(clamped * 1000);
    setJumpDialogOpen(false);
    setTimeout(() => playButtonRef.current?.focus(), 0);
    announce(t('subtitleCreation.live.position', { time: formatTimestamp(clamped * 1000) }));
  };

  const handleMarkStart = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const position = audio.currentTime * 1000;
    setStartMark(position);
    startMarkRef.current = position;
    announce(t('subtitleCreation.live.startMarked', { time: formatTimestamp(position) }));
  }, [t]);

  const handleMarkEnd = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const position = audio.currentTime * 1000;
    setEndMark(position);
    endMarkRef.current = position;
    announce(t('subtitleCreation.live.endMarked', { time: formatTimestamp(position) }));
  }, [t]);

  const handlePlaySegment = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const range = resolveRangeForAction();
    if (!range) {
      const msg = t('subtitleCreation.errors.missingMarksPlaySegment');
      setError(msg);
      announce(msg);
      return;
    }
    const startMs = Math.min(range.start, range.end);
    const endMs = Math.max(range.start, range.end);
    audio.currentTime = startMs / 1000;
    setSegmentEnd(endMs);
    audio
      .play()
      .then(() => setIsPlaying(true))
      .catch((err) => {
        setError((err as Error).message);
        setSegmentEnd(null);
      });
  }, [announce, resolveRangeForAction, t]);

  const addSubtitle = (text: string) => {
    if (startMark === null || endMark === null) {
      const msg = t('subtitleCreation.errors.missingMarks');
      setError(msg);
      announce(msg);
      return;
    }
    const start = Math.min(startMark, endMark);
    const end = Math.max(startMark, endMark);
    const newSub: Subtitle = {
      id: subtitles.length + 1,
      startTime: start,
      endTime: end,
      text,
    };
    const updated = [...subtitles, newSub].sort((a, b) => a.startTime - b.startTime);
    const normalized = updated.map((sub, index) => ({ ...sub, id: index + 1 }));
    const inserted = normalized.find(
      (sub) => sub.startTime === start && sub.endTime === end && sub.text === text
    );
    setSubtitles(normalized);
    setCurrentSubtitleId(inserted?.id ?? normalized[normalized.length - 1]?.id ?? null);
    announce(t('subtitleCreation.live.subtitleInserted', { time: formatTimestamp(start) }));
    playButtonRef.current?.focus();
  };

  const handleOpenSrt = async () => {
    const result = await window.electronAPI.dialog.openSrtFile();
    if (result?.error) {
      setError(result.error);
      return;
    }
    if (result?.content) {
      const parsed = parseSrt(result.content).sort((a, b) => a.startTime - b.startTime);
      setSubtitles(parsed);
      setSuccess(t('subtitleCreation.messages.srtLoaded'));
      setTimeout(() => setSuccess(null), 2500);
      if (result.path) {
        const baseName = (result.path.split(/[\\/]/).pop() || '').replace(/\.[^.]+$/, '');
        setLoadedSrtName(baseName || null);
      }
      if (parsed.length > 0) {
        const lastEndMs = parsed[parsed.length - 1].endTime;
        const audio = audioRef.current;
        const applySeek = () => {
          if (!audio) return;
          const targetSeconds =
            audio.duration && !Number.isNaN(audio.duration)
              ? Math.min(lastEndMs / 1000, audio.duration)
              : lastEndMs / 1000;
          audio.currentTime = targetSeconds;
          setCurrentTime(targetSeconds * 1000);
        };

        if (audio) {
          if (audio.readyState >= 1) {
            applySeek();
          } else {
            const onLoadedMetadata = () => {
              applySeek();
              audio.removeEventListener('loadedmetadata', onLoadedMetadata);
            };
            audio.addEventListener('loadedmetadata', onLoadedMetadata);
          }
        } else {
          setCurrentTime(lastEndMs);
        }
      }
      const newTemp = await window.electronAPI.subtitle.ensureTempSrt(result.path);
      setTempSrtPath(newTemp);
    }
  };

  const handleSaveSrt = useCallback(async () => {
    if (subtitles.length === 0) return;
    const content = serializeSrt(subtitles);
    const deriveBaseName = (label?: string | null) => {
      if (!label) return null;
      const base = (label.split(/[\\/]/).pop() || '').replace(/\.[^.]+$/, '');
      return base || null;
    };
    const defaultName = deriveBaseName(loadedSrtName) || deriveBaseName(mediaLabel) || 'subtitles';
    const result = await window.electronAPI.subtitle.saveSrt(
      content,
      defaultName
    );
    if (result.error) {
      setError(result.error);
      announce(result.error);
      return;
    }
    if (result.path) {
      setSuccess(t('subtitleCreation.messages.srtSaved', { path: result.path }));
      setTimeout(() => setSuccess(null), 2500);
    }
  }, [announce, loadedSrtName, mediaLabel, subtitles, t]);

  const handleTranscribe = useCallback(async () => {
    if (!audioPath) {
      const msg = t('subtitleCreation.errors.noAudio');
      setError(msg);
      announce(msg);
      return;
    }
    const range = resolveRangeForAction();
    if (!range) {
      const msg = t('subtitleCreation.errors.missingMarksTranscribe');
      setError(msg);
      announce(msg);
      return;
    }
    const start = range.start;
    const end = range.end;
    if (!geminiApiKey) {
      const msg = t('subtitleCreation.errors.noGemini');
      setError(msg);
      announce(msg);
      return;
    }

    setIsTranscribing(true);
    announce(t('subtitleCreation.live.transcribing'));

    const segmentStart = Math.min(start, end);
    const segmentEnd = Math.max(start, end);

    const transcription = await window.electronAPI.gemini.transcribe(
      audioPath,
      geminiApiKey,
      transcriptionPrompt,
      segmentStart,
      segmentEnd,
      subtitleSettings.normalizeForTranscription !== false
    );

    if (transcription.error || !transcription.text) {
      const msg = transcription.error || t('subtitleCreation.errors.transcriptionFailed');
      setError(msg);
      announce(msg);
      setIsTranscribing(false);
      return;
    }

    const text = transcription.text;
    setTextModalMode('transcribe');
    setTextModalValue(text);
    setTextModalOpen(true);
    announce(t('subtitleCreation.messages.transcriptionReady'));
    playButtonRef.current?.focus();
    setIsTranscribing(false);
  }, [
    announce,
    audioPath,
    geminiApiKey,
    resolveRangeForAction,
    subtitleSettings.normalizeForTranscription,
    t,
    transcriptionPrompt,
  ]);

  const handleGenerateClip = useCallback(async () => {
    setError(null);
    if (isGeneratingClip) return;
    const contextual = selectSubtitleAtCurrentTime({ silent: true });
    const targetSubtitle = contextual ?? currentSubtitle;
    if (!targetSubtitle) {
      const msg = t('subtitleCreation.errors.noActiveSubtitle');
      setError(msg);
      announce(msg);
      return;
    }
    if (!defaultService) {
      const msg = t('subtitleCreation.errors.noDefaultService');
      setError(msg);
      announce(msg);
      return;
    }
    const textForTts = targetSubtitle.text.replace(/\n/g, ' ').trim();
    if (!textForTts) {
      const msg = t('subtitleCreation.errors.emptySubtitle');
      setError(msg);
      announce(msg);
      return;
    }

    setIsGeneratingClip(true);
    try {
      const { cacheDir, cache } = await getCache();
      const baseSpeed = defaultService.speedFactor ?? 1;
      const serviceKey = defaultService.id || defaultService.name || 'service';
      const cacheKey = `${serviceKey}|${textForTts}`;

      const ensureBaseClip = async () => {
        const cached = useConvertCache ? cache[cacheKey] : null;
        if (useConvertCache && cached?.file) {
          return { path: cached.file, fromCache: true };
        }

        const hash = hashKey(cacheKey);
        const targetPath = `${cacheDir}/${hash}.mp3`;
        const result = await saveToFile(textForTts, targetPath, { ...defaultService, speedFactor: baseSpeed });
        if (result.error || !result.path) {
          const msg = result.error || t('subtitleCreation.errors.generateFailed');
          throw new Error(msg);
        }

        if (useConvertCache) {
          cache[cacheKey] = {
            file: result.path,
            text: textForTts,
            serviceId: defaultService.id || '',
            voiceId: defaultService.voiceId,
          };
          await persistCache();
        }

        return { path: result.path, fromCache: false };
      };

      const baseClip = await ensureBaseClip();
      const finalPath = await ensureClipFitsSubtitleSlot({
        baseClipPath: baseClip.path,
        subtitle: targetSubtitle,
        baseSpeed,
        cacheDir,
        cacheKey,
        textForTts,
        hashKey,
        defaultService,
        saveToFile,
        onInvalidDuration: async () => {
          if (useConvertCache) {
            delete cache[cacheKey];
          }
          const refreshed = await ensureBaseClip();
          if (useConvertCache) {
            await persistCache();
          }
          return refreshed.path;
        },
      });

      await playGeneratedClip(finalPath);
      announce(
        baseClip.fromCache && finalPath === baseClip.path
          ? t('subtitleCreation.messages.clipFromCache')
          : t('subtitleCreation.messages.clipReady')
      );
    } catch (err) {
      const msg = (err as Error).message || t('subtitleCreation.errors.generateFailed');
      setError(msg);
      announce(msg);
    } finally {
      setIsGeneratingClip(false);
    }
  }, [
    announce,
    currentSubtitle,
    defaultService,
    getCache,
    hashKey,
    isGeneratingClip,
    persistCache,
    playGeneratedClip,
    saveToFile,
    selectSubtitleAtCurrentTime,
    t,
    useConvertCache,
  ]);

  const handleTextModalSave = () => {
    addSubtitle(textModalValue);
    setTextModalOpen(false);
    setTextModalValue('');
    setTimeout(() => {
      playButtonRef.current?.focus();
    }, 100);
  };

  const handleJumpToSubtitle = useCallback(
    (subtitle: Subtitle) => {
      const audio = audioRef.current;
      const targetSeconds = subtitle.startTime / 1000;
      if (audio) {
        audio.currentTime = targetSeconds;
      }
      setCurrentTime(targetSeconds * 1000);
      setStartMark(subtitle.startTime);
      setEndMark(subtitle.endTime);
      startMarkRef.current = subtitle.startTime;
      endMarkRef.current = subtitle.endTime;
      setCurrentSubtitleId(subtitle.id);
      announce(t('subtitleCreation.live.position', { time: formatTimestamp(subtitle.startTime) }));
    },
    [announce, t]
  );

  useEffect(() => {
    if (!subtitles.length) return;

    const saveTemp = async () => {
      try {
        const target = tempSrtPath || (await window.electronAPI.subtitle.ensureTempSrt(mediaLabel));
        setTempSrtPath(target);
        const content = serializeSrt(subtitles);
        await window.electronAPI.subtitle.writeSrt(target, content);
      } catch (err) {
        setError((err as Error).message);
      }
    };

    saveTemp();
  }, [mediaLabel, subtitles, tempSrtPath]);

  useEffect(() => {
    if (!subtitles.length) return;
    const ids = findOverlappingIds();
    if (ids.size) {
      const edits: Record<number, { start: string; end: string }> = {};
      subtitles.forEach((sub) => {
        if (ids.has(sub.id)) {
          edits[sub.id] = { start: String(sub.startTime), end: String(sub.endTime) };
        }
      });
      setOverlapEdits(edits);
      setOverlapDialogOpen(true);
    } else if (overlapDialogOpen) {
      setOverlapDialogOpen(false);
    }
  }, [findOverlappingIds, overlapDialogOpen, subtitles]);

  useEffect(() => {
    if (currentSubtitleId === null) return;
    if (!subtitles.some((sub) => sub.id === currentSubtitleId)) {
      setCurrentSubtitleId(null);
    }
  }, [currentSubtitleId, subtitles]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      const now = audio.currentTime * 1000;
      setCurrentTime(now);
      setDuration((audio.duration || 0) * 1000);

      if (segmentEnd !== null && now >= segmentEnd) {
        audio.pause();
        setIsPlaying(false);
        setSegmentEnd(null);
      }
    };

    const onLoadedMetadata = () => {
      setDuration((audio.duration || 0) * 1000);
      setCurrentTime(audio.currentTime * 1000);
    };

    const onSeeked = () => {
      setCurrentTime(audio.currentTime * 1000);
    };

    const onEnded = () => {
      setIsPlaying(false);
      setSegmentEnd(null);
    };

    const onError = () => {
      setError(t('subtitleCreation.errors.playbackFailed'));
      setIsPlaying(false);
      setSegmentEnd(null);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('seeked', onSeeked);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('seeked', onSeeked);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [audioSrc, segmentEnd, t]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTextField =
        ['INPUT', 'TEXTAREA'].includes(target.tagName) || target.getAttribute('contenteditable') === 'true';
      const playFocused = document.activeElement === playButtonRef.current;

      if ((event.key === 'o' || event.key === 'O') && event.ctrlKey && !isTextField) {
        event.preventDefault();
        handleOpenSrt();
      } else if ((event.key === 'a' || event.key === 'A') && event.ctrlKey && !isTextField) {
        event.preventDefault();
        handleMediaSelect();
      } else if ((event.key === 's' || event.key === 'S') && event.ctrlKey && !isTextField) {
        event.preventDefault();
        handleSaveSrt();
      } else if (event.key === 'F9' && !isTextField) {
        event.preventDefault();
        handleMarkStart();
      } else if (event.key === 'F10' && !isTextField) {
        event.preventDefault();
        handleMarkEnd();
      } else if (!playFocused || isTextField) {
        return;
      } else if (event.key.toLowerCase() === 'j') {
        event.preventDefault();
        setJumpDialogOpen(true);
      } else if (event.key.toLowerCase() === 'i') {
        event.preventDefault();
        handleMarkStart();
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        handleMarkEnd();
      } else if ((event.key === 'F5' || event.key.toLowerCase() === 's') && !event.ctrlKey) {
        event.preventDefault();
        setTextModalMode('insert');
        setTextModalValue('');
        setTextModalOpen(true);
      } else if (event.key.toLowerCase() === 't') {
        event.preventDefault();
        handleTranscribe();
      } else if (event.key.toLowerCase() === 'g') {
        event.preventDefault();
        handleGenerateClip();
      } else if (event.key.toLowerCase() === 'p') {
        event.preventDefault();
        handlePlaySegment();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleGenerateClip, handleMarkEnd, handleMarkStart, handlePlaySegment, handleSaveSrt, handleTranscribe]);

  const currentSeekStep = SEEK_STEP_MS[seekStepIndex];

  return (
    <main className="container mx-auto p-6 max-w-6xl space-y-6" role="main">
      <h1 className="text-3xl font-bold flex items-center gap-2">
        <Keyboard className="h-6 w-6" aria-hidden="true" />
        {t('subtitleCreation.title')}
      </h1>

      {error && (
        <Alert className="mb-2 border-red-500 bg-red-50 dark:bg-red-950">
          <AlertDescription className="text-red-700 dark:text-red-300">{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="mb-2 border-green-500 bg-green-50 dark:bg-green-950">
          <AlertDescription className="text-green-700 dark:text-green-300">{success}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileAudio2 className="h-5 w-5" aria-hidden="true" />
            {t('subtitleCreation.media.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button
            onClick={handleMediaSelect}
            variant="outline"
            aria-description={t('subtitleCreation.hotkeys.openMedia')}
            data-toolbar-item="true"
          >
            <FileUp className="h-4 w-4 mr-2" aria-hidden="true" />
            {t('subtitleCreation.media.select')}
          </Button>
          <Button
            onClick={handleOpenSrt}
            variant="outline"
            aria-description={t('subtitleCreation.hotkeys.openSrt')}
            data-toolbar-item="true"
          >
            <Radio className="h-4 w-4 mr-2" aria-hidden="true" />
            {t('subtitleCreation.media.openSrt')}
          </Button>
          <Button
            onClick={handleSaveSrt}
            variant="secondary"
            aria-description={t('subtitleCreation.hotkeys.saveSrt')}
            data-toolbar-item="true"
            disabled={subtitles.length === 0}
          >
            <Save className="h-4 w-4 mr-2" aria-hidden="true" />
            {t('subtitleCreation.media.saveSrt')}
          </Button>
          {mediaLabel && (
            <span className="text-sm text-muted-foreground truncate">
              {t('subtitleCreation.media.loaded', { name: mediaLabel })}
            </span>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" aria-hidden="true" />
            {t('subtitleCreation.controls.title')}
          </CardTitle>
          {prepareMessage && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {isPreparingAudio && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              <span aria-live="polite">{prepareMessage}</span>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Button
                onClick={handlePlayPause}
                onKeyDown={handlePlayKeyDown}
                disabled={!audioSrc || isPreparingAudio}
                ref={playButtonRef}
                aria-description={t('subtitleCreation.hotkeys.playPause')}
                aria-label={isPlaying ? t('subtitleCreation.controls.pause') : t('subtitleCreation.controls.play')}
                data-toolbar-item="true"
                data-play-button="true"
              >
                {isPlaying ? <Pause className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                {isPlaying ? t('subtitleCreation.controls.pause') : t('subtitleCreation.controls.play')}
              </Button>
              <span className="text-sm text-muted-foreground">
                {t('subtitleCreation.controls.currentTime', {
                  time: formatTimestamp(currentTime),
                  duration: duration ? formatTimestamp(duration) : '--:--:--,---',
                })}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {t('subtitleCreation.controls.seekStep', { step: formatTimestamp(currentSeekStep) })}
            </span>
          </div>

          <div
            role="toolbar"
            aria-label={t('subtitleCreation.controls.navigationToolbar')}
            className="flex flex-wrap gap-2"
            onKeyDown={handleToolbarKeyDown}
          >
            {NAVIGATION_SEEKS.map((seek, index) => (
              <Button
                key={seek.label}
                variant="outline"
                size="sm"
                onClick={() => handleSeek(seek.delta)}
                disabled={!audioSrc || isPreparingAudio}
                tabIndex={index === 0 ? 0 : -1}
                aria-label={t('subtitleCreation.controls.seekLabel', {
                  direction: seek.delta < 0 ? t('subtitleCreation.controls.back') : t('subtitleCreation.controls.forward'),
                  amount: seek.label.replace('-', '').replace('+', ''),
                })}
                aria-description={t('subtitleCreation.hotkeys.seekButtons')}
                data-toolbar-item="true"
              >
                {seek.delta < 0 ? <SkipBack className="h-3 w-3 mr-2" /> : <SkipForward className="h-3 w-3 mr-2" />}
                {seek.label}
              </Button>
            ))}
          </div>

          <div
            role="toolbar"
            aria-label={t('subtitleCreation.controls.actionToolbar')}
            className="flex flex-wrap gap-2"
            onKeyDown={handleToolbarKeyDown}
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => setJumpDialogOpen(true)}
              disabled={!audioSrc || isPreparingAudio}
              aria-description={t('subtitleCreation.hotkeys.jump')}
              tabIndex={0}
              data-toolbar-item="true"
            >
              <Clock className="h-4 w-4 mr-2" />
              {t('subtitleCreation.actions.jump')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkStart}
              disabled={!audioSrc || isPreparingAudio}
              aria-description={t('subtitleCreation.hotkeys.markStart')}
              tabIndex={-1}
              data-toolbar-item="true"
            >
              <Flag className="h-4 w-4 mr-2" />
              {t('subtitleCreation.actions.markStart')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkEnd}
              disabled={!audioSrc || isPreparingAudio}
              aria-description={t('subtitleCreation.hotkeys.markEnd')}
              tabIndex={-1}
              data-toolbar-item="true"
            >
              <Bookmark className="h-4 w-4 mr-2" />
              {t('subtitleCreation.actions.markEnd')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePlaySegment}
              disabled={!audioSrc || isPreparingAudio}
              aria-description={t('subtitleCreation.hotkeys.playSegment')}
              tabIndex={-1}
              data-toolbar-item="true"
            >
              <Play className="h-4 w-4 mr-2" />
              {t('subtitleCreation.actions.playSegment')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setTextModalMode('insert');
                setTextModalValue('');
                setTextModalOpen(true);
              }}
              disabled={!audioSrc || isPreparingAudio}
              aria-description={t('subtitleCreation.hotkeys.insert')}
              tabIndex={-1}
              data-toolbar-item="true"
            >
              <Scissors className="h-4 w-4 mr-2" />
              {t('subtitleCreation.actions.insert')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleGenerateClip}
              aria-description={t('subtitleCreation.hotkeys.generate')}
              tabIndex={-1}
              data-toolbar-item="true"
              disabled={isGeneratingClip}
            >
              {isGeneratingClip ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              {isGeneratingClip
                ? t('subtitleCreation.actions.generating')
                : t('subtitleCreation.actions.generate')}
            </Button>
            <Button
              size="sm"
              onClick={handleTranscribe}
              aria-description={t('subtitleCreation.hotkeys.transcribe')}
              tabIndex={-1}
              data-toolbar-item="true"
              disabled={isTranscribing || !audioSrc || isPreparingAudio}
            >
              <Download className="h-4 w-4 mr-2" />
              {isTranscribing ? t('subtitleCreation.actions.transcribing') : t('subtitleCreation.actions.transcribe')}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>
              {t('subtitleCreation.status.start')}:{' '}
              {startMark !== null ? formatTimestamp(startMark) : t('subtitleCreation.status.notSet')}
            </span>
            <span className="mx-2 text-muted-foreground/50">|</span>
            <span>
              {t('subtitleCreation.status.end')}:{' '}
              {endMark !== null ? formatTimestamp(endMark) : t('subtitleCreation.status.notSet')}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2">
          <CardTitle className="flex items-center gap-2">
            <Radio className="h-5 w-5" aria-hidden="true" />
            {t('subtitleCreation.table.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {subtitles.length === 0 ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              <p>{t('subtitleCreation.table.empty')}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
              <TableHead className="w-16">#</TableHead>
              <TableHead className="w-40">{t('subtitleCreation.table.start')}</TableHead>
              <TableHead className="w-40">{t('subtitleCreation.table.end')}</TableHead>
              <TableHead>{t('subtitleCreation.table.text')}</TableHead>
              <TableHead className="w-32">{t('subtitleCreation.table.actions')}</TableHead>
            </TableRow>
          </TableHeader>
            <TableBody>
              {subtitles.map((sub) => (
                <TableRow key={sub.id}>
                  <TableCell className="font-mono">{sub.id}</TableCell>
                  <TableCell className="font-mono text-sm">{formatTimestamp(sub.startTime)}</TableCell>
                  <TableCell className="font-mono text-sm">{formatTimestamp(sub.endTime)}</TableCell>
                  <TableCell>
                    <Textarea
                      value={sub.text}
                      onChange={(e) => {
                        setCurrentSubtitleId(sub.id);
                        setSubtitles((prev) =>
                          prev.map((item) => (item.id === sub.id ? { ...item, text: e.target.value } : item))
                        );
                      }}
                      aria-label={t('subtitleCreation.table.edit', { id: sub.id })}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        handleJumpToSubtitle(sub);
                        playButtonRef.current?.focus();
                      }}
                    >
                      {t('subtitleCreation.table.jumpHere')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={videoDialogOpen} onOpenChange={setVideoDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('subtitleCreation.media.convertTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-4">
            {t('subtitleCreation.media.convertBody')}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setVideoDialogOpen(false)}>
              {t('subtitleCreation.media.cancel')}
            </Button>
            <Button onClick={confirmVideoConversion} disabled={isLoadingMedia}>
              {t('subtitleCreation.media.convert')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={jumpDialogOpen} onOpenChange={handleJumpDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('subtitleCreation.actions.jump')}</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={handleJumpSubmit}>
            <Label htmlFor="jumpTime">{t('subtitleCreation.prompts.jumpFormat')}</Label>
            <Input
              id="jumpTime"
              value={jumpValue}
              onChange={(e) => setJumpValue(e.target.value)}
              placeholder="00:00:00"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => handleJumpDialogOpenChange(false)}>
                {t('subtitleCreation.media.cancel')}
              </Button>
              <Button type="submit">{t('subtitleCreation.actions.jump')}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={textModalOpen} onOpenChange={setTextModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {textModalMode === 'transcribe'
                ? t('subtitleCreation.actions.transcribe')
                : t('subtitleCreation.actions.insert')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="subtitleText">{t('subtitleCreation.table.text')}</Label>
            <Input
              id="subtitleText"
              value={textModalValue}
              onChange={(e) => setTextModalValue(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setTextModalOpen(false)}>
                {t('subtitleCreation.media.cancel')}
              </Button>
              <Button onClick={handleTextModalSave}>{t('subtitleCreation.actions.saveSubtitle')}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={overlapDialogOpen} onOpenChange={setOverlapDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('subtitleCreation.overlap.title')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-2">
            {t('subtitleCreation.overlap.description')}
          </p>
          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {Object.entries(overlapEdits).map(([id, values]) => (
              <div key={id} className="space-y-2 rounded-md border p-3">
                <div className="text-sm font-medium">
                  {t('subtitleCreation.overlap.subtitleLabel', { id })}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor={`overlap-start-${id}`}>{t('subtitleCreation.status.start')}</Label>
                    <Input
                      id={`overlap-start-${id}`}
                      type="number"
                      value={values.start}
                      onChange={(e) =>
                        setOverlapEdits((prev) => ({
                          ...prev,
                          [Number(id)]: { ...prev[Number(id)], start: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`overlap-end-${id}`}>{t('subtitleCreation.status.end')}</Label>
                    <Input
                      id={`overlap-end-${id}`}
                      type="number"
                      value={values.end}
                      onChange={(e) =>
                        setOverlapEdits((prev) => ({
                          ...prev,
                          [Number(id)]: { ...prev[Number(id)], end: e.target.value },
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOverlapDialogOpen(false)}>
              {t('subtitleCreation.media.cancel')}
            </Button>
            <Button onClick={applyOverlapEdits}>{t('subtitleCreation.overlap.apply')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="sr-only" aria-live="polite" role="alert">
        {liveMessage || statusMessage}
      </div>

      <audio ref={previewAudioRef} className="hidden" />
      <audio ref={audioRef} src={audioSrc} className="hidden" />
    </main>
  );
}
