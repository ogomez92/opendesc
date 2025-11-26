"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const electronAPI = {
    config: {
        load: () => electron_1.ipcRenderer.invoke('config:load'),
        save: (config) => electron_1.ipcRenderer.invoke('config:save', config),
    },
    alignment: {
        checkEnv: () => electron_1.ipcRenderer.invoke('alignment:checkEnv'),
        run: (options) => electron_1.ipcRenderer.invoke('alignment:run', options),
        saveOutput: (sourcePath, suggestedName) => electron_1.ipcRenderer.invoke('alignment:saveOutput', sourcePath, suggestedName),
        onLog: (callback) => {
            const listener = (_, payload) => callback(payload);
            electron_1.ipcRenderer.on('alignment:log', listener);
            return () => electron_1.ipcRenderer.removeListener('alignment:log', listener);
        },
    },
    azure: {
        getVoices: (apiKey, region) => electron_1.ipcRenderer.invoke('azure:getVoices', apiKey, region),
        speak: (text, voiceId, apiKey, region, speed) => electron_1.ipcRenderer.invoke('azure:speak', text, voiceId, apiKey, region, speed),
        saveToFile: (text, voiceId, apiKey, region, outputPath, speed) => electron_1.ipcRenderer.invoke('azure:saveToFile', text, voiceId, apiKey, region, outputPath, speed),
    },
    elevenlabs: {
        getVoices: (apiKey) => electron_1.ipcRenderer.invoke('elevenlabs:getVoices', apiKey),
        speak: (text, voiceId, apiKey, modelId, speed) => electron_1.ipcRenderer.invoke('elevenlabs:speak', text, voiceId, apiKey, modelId, speed),
        saveToFile: (text, voiceId, apiKey, outputPath, modelId, speed) => electron_1.ipcRenderer.invoke('elevenlabs:saveToFile', text, voiceId, apiKey, outputPath, modelId, speed),
    },
    google: {
        getVoices: (apiKey) => electron_1.ipcRenderer.invoke('google:getVoices', apiKey),
        speak: (text, voiceId, apiKey, speed) => electron_1.ipcRenderer.invoke('google:speak', text, voiceId, apiKey, speed),
        saveToFile: (text, voiceId, apiKey, outputPath, speed) => electron_1.ipcRenderer.invoke('google:saveToFile', text, voiceId, apiKey, outputPath, speed),
    },
    gemini: {
        getVoices: () => electron_1.ipcRenderer.invoke('gemini:getVoices'),
        speak: (text, voiceId, apiKey, stylePrompt, speed) => electron_1.ipcRenderer.invoke('gemini:speak', text, voiceId, apiKey, stylePrompt, speed),
        saveToFile: (text, voiceId, apiKey, outputPath, stylePrompt, speed) => electron_1.ipcRenderer.invoke('gemini:saveToFile', text, voiceId, apiKey, outputPath, stylePrompt, speed),
        transcribe: (audioPath, apiKey, prompt, startMs, endMs, normalizeAudio) => electron_1.ipcRenderer.invoke('gemini:transcribe', audioPath, apiKey, prompt, startMs, endMs, normalizeAudio),
    },
    system: {
        saveToFile: (text, voiceName, outputPath, speed) => electron_1.ipcRenderer.invoke('system:saveToFile', text, voiceName, outputPath, speed),
        checkFfmpeg: () => electron_1.ipcRenderer.invoke('system:checkFfmpeg'),
        createTempDir: () => electron_1.ipcRenderer.invoke('system:createTempDir'),
        removeDir: (dirPath) => electron_1.ipcRenderer.invoke('system:removeDir', dirPath),
        getPlatform: () => electron_1.ipcRenderer.invoke('system:getPlatform'),
        mixAudio: (clips, outputPath, backgroundPath) => electron_1.ipcRenderer.invoke('system:mixAudio', clips, outputPath, backgroundPath),
        getAudioDuration: (path) => electron_1.ipcRenderer.invoke('system:getAudioDuration', path),
    },
    dialog: {
        saveFile: () => electron_1.ipcRenderer.invoke('dialog:saveFile'),
        saveAlignOutput: () => electron_1.ipcRenderer.invoke('dialog:saveAlignOutput'),
        pickAlignPaths: (kind) => electron_1.ipcRenderer.invoke('dialog:pickAlignPaths', kind),
        chooseFolder: () => electron_1.ipcRenderer.invoke('dialog:chooseFolder'),
        openMediaFile: () => electron_1.ipcRenderer.invoke('dialog:openMediaFile'),
        openSrtFile: () => electron_1.ipcRenderer.invoke('dialog:openSrtFile'),
    },
    audio: {
        play: (filePath) => electron_1.ipcRenderer.invoke('audio:play', filePath),
        onPlayFile: (callback) => {
            electron_1.ipcRenderer.on('audio:playFile', (_, filePath) => callback(filePath));
        },
    },
    subtitle: {
        convertVideoToAudio: (inputPath) => electron_1.ipcRenderer.invoke('subtitle:convertVideoToAudio', inputPath),
        prepareAudioForPlayback: (inputPath) => electron_1.ipcRenderer.invoke('subtitle:prepareAudioForPlayback', inputPath),
        ensureTempSrt: (suggestedName) => electron_1.ipcRenderer.invoke('subtitle:ensureTempSrt', suggestedName),
        writeSrt: (path, content) => electron_1.ipcRenderer.invoke('subtitle:writeSrt', path, content),
        saveSrt: (content, suggestedName) => electron_1.ipcRenderer.invoke('subtitle:saveSrt', content, suggestedName),
        getConvertCacheDir: () => electron_1.ipcRenderer.invoke('subtitle:getConvertCacheDir'),
        readConvertCache: () => electron_1.ipcRenderer.invoke('subtitle:readConvertCache'),
        writeConvertCache: (entries) => electron_1.ipcRenderer.invoke('subtitle:writeConvertCache', entries),
    },
};
electron_1.contextBridge.exposeInMainWorld('electronAPI', electronAPI);
