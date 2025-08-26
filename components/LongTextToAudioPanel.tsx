import React, { useState, useEffect, useRef, useCallback } from 'react';
import ActionButton from './ActionButton';
import { geminiService } from '../services/geminiService';
import { TRANSLATION_STYLE_GUIDES } from '../services/translationStyleGuides';
import { MultilingualState, DubbingJob, DubbingSegment, Segment } from '../types';
import LoadingSpinner from './LoadingSpinner';
import ErrorDisplay from './ErrorDisplay';
import { generateAudioForSegment } from '../services/geminiTtsService';
import { createAudioProcessor } from '../services/audioProcessingService';
import SpeechParameterSlider from './SpeechParameterSlider';


type InputType = 'json' | 'youtube' | 'plain';
type WorkflowStep = 'input' | 'segmented' | 'processing' | 'finished';

// Helper function to detect the format of the input script.
const detectInputType = (script: string): InputType => {
    const trimmedScript = script.trim();
    if (!trimmedScript) return 'plain';

    // 1. Check for JSON format
    if (trimmedScript.startsWith('{') || trimmedScript.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmedScript);
            if (Array.isArray(parsed) && parsed.length > 0 && ('start' in parsed[0] && 'end' in parsed[0]) && ('text' in parsed[0] || 'text_translated' in parsed[0])) {
                return 'json';
            }
        } catch (e) { /* Not a valid JSON for our purpose, proceed to next check */ }
    }

    // 2. Check for YouTube Transcript format
    const lines = trimmedScript.split('\n').slice(0, 50); // Check first 50 lines for performance
    const timeRegex = /^\d{1,2}:\d{2}(:\d{2})?$/; // Timestamp should be the only thing on the line
    let timestampLines = 0;
    let textLines = 0;

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (timeRegex.test(trimmedLine)) {
            timestampLines++;
        } else if (trimmedLine.length > 0) {
            textLines++;
        }
    }
    
    // Heuristic: If we find at least 2 timestamp lines and some text lines, it's likely a YT transcript.
    if (timestampLines >= 2 && textLines > 0) {
        return 'youtube';
    }

    // 3. Default to plain text
    return 'plain';
};


interface LongTextToAudioPanelProps {
  aiGeneratedScript: string;
  multilingualState: MultilingualState;
  setMultilingualState: React.Dispatch<React.SetStateAction<MultilingualState>>;
  setIsProcessing: (isProcessing: boolean) => void;
}

// --- Helper functions for script parsing ---
const parseYoutubeTranscript = (text: string): Segment[] => {
    const lines = text.trim().split('\n').filter(Boolean);
    const timedLines: { time: number; text: string[] }[] = [];
    const timeRegex = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/;

    let currentTimedGroup: { time: number; text: string[] } | null = null;
    let lastTime = -1;

    for (const line of lines) {
        const trimmedLine = line.trim();
        const timeMatch = trimmedLine.match(timeRegex);

        if (timeMatch) {
            const hours = parseInt(timeMatch[1] || '0', 10);
            const minutes = parseInt(timeMatch[2], 10);
            const seconds = parseInt(timeMatch[3], 10);
            const timeInSeconds = (hours * 3600) + (minutes * 60) + seconds;

            // This is a new timestamp line
            if (currentTimedGroup) {
                timedLines.push(currentTimedGroup);
            }
            currentTimedGroup = { time: timeInSeconds, text: [] };
            lastTime = timeInSeconds;
        } else if (currentTimedGroup && trimmedLine.length > 0) {
            // This is a text line associated with the current timestamp
            currentTimedGroup.text.push(trimmedLine);
        }
    }
    // Add the last processed group
    if (currentTimedGroup) {
        timedLines.push(currentTimedGroup);
    }
    
    if (timedLines.length === 0) return [];
    
    const finalSegments: Segment[] = [];
    for (let i = 0; i < timedLines.length; i++) {
        const current = timedLines[i];
        const next = timedLines[i + 1];
        const combinedText = current.text.join(' ').trim();

        if (combinedText) {
            const startTime = current.time;
            let endTime: number;

            if (next) {
                endTime = next.time;
            } else {
                // For the very last segment, look for a final timestamp in the original text
                const allLines = text.trim().split('\n');
                const lastLine = allLines[allLines.length-1].trim();
                const lastTimeMatch = lastLine.match(timeRegex);
                 if (lastTimeMatch) {
                    const hours = parseInt(lastTimeMatch[1] || '0', 10);
                    const minutes = parseInt(lastTimeMatch[2], 10);
                    const seconds = parseInt(lastTimeMatch[3], 10);
                    endTime = (hours * 3600) + (minutes * 60) + seconds;
                 } else {
                    // Fallback to word count estimation if no final timestamp
                    const WPM = 150;
                    const wordsPerSecond = WPM / 60;
                    const wordCount = combinedText.split(/\s+/).length;
                    const estimatedDuration = Math.max(1, wordCount / wordsPerSecond);
                    endTime = startTime + estimatedDuration;
                 }
            }
            // Ensure end time is greater than start time, and a segment has text
            if (endTime > startTime && combinedText) {
                 finalSegments.push({ start: startTime, end: endTime, text: combinedText });
            }
        }
    }

    return finalSegments;
};

const parsePlainText = (text: string, chunkDuration: number): Segment[] => {
    const segments: Segment[] = [];
    const words = text.trim().split(/\s+/);
    if (words.length === 0) return [];

    const WPM = 150; // Words per minute
    const wordsPerSecond = WPM / 60;

    let currentSegmentText: string[] = [];
    let segmentStartTime = 0;

    for (const word of words) {
        currentSegmentText.push(word);
        const estimatedDuration = currentSegmentText.length / wordsPerSecond;

        if (estimatedDuration >= chunkDuration && currentSegmentText.length > 0) {
            const segmentText = currentSegmentText.join(' ');
            const endTime = segmentStartTime + estimatedDuration;
            segments.push({ start: segmentStartTime, end: endTime, text: segmentText });
            
            segmentStartTime = endTime;
            currentSegmentText = [];
        }
    }

    if (currentSegmentText.length > 0) {
        const segmentText = currentSegmentText.join(' ');
        const estimatedDuration = Math.max(1, currentSegmentText.length / wordsPerSecond);
        const endTime = segmentStartTime + estimatedDuration;
        segments.push({ start: segmentStartTime, end: endTime, text: segmentText });
    }

    return segments;
};
const parseJsonSegments = (jsonString: string): Segment[] => {
  try {
    const segments = JSON.parse(jsonString);
    if (!Array.isArray(segments)) throw new Error("JSON is not an array.");
    return segments.map((s: any) => {
        const start = parseFloat(s.start);
        const end = parseFloat(s.end);
        const text = s.text || s.text_translated;
        if (isNaN(start) || isNaN(end) || typeof text !== 'string' || start >= end) {
            throw new Error(`Invalid segment found: ${JSON.stringify(s)}`);
        }
        return { start, end, text };
    });
  } catch (e) {
    throw new Error(`Invalid JSON format: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Merges adjacent segments together to meet a target duration.
 * This is useful for combining short, choppy segments from a transcript into
 * more natural, longer segments for TTS.
 * @param segments An array of initial segments.
 * @param targetDuration The desired minimum duration for each merged segment.
 * @returns A new array of merged segments.
 */
const mergeSegments = (segments: Segment[], targetDuration: number): Segment[] => {
  if (!segments.length || targetDuration <= 0) return segments;

  const mergedSegments: Segment[] = [];
  let accumulator: Segment | null = null;

  for (const segment of segments) {
    // If a segment is already longer than the target, push it and reset.
    if ((segment.end - segment.start) >= targetDuration) {
        if (accumulator) {
            mergedSegments.push(accumulator); // Push any pending segment
        }
        mergedSegments.push(segment); // Push the long segment
        accumulator = null; // Reset
        continue;
    }

    if (!accumulator) {
      // Start a new accumulator
      accumulator = { ...segment };
    } else {
      // Add current segment to the accumulator
      accumulator.end = segment.end;
      accumulator.text += ` ${segment.text}`;
    }
    
    // If the accumulator reaches the target duration, push it and reset
    if (accumulator.end - accumulator.start >= targetDuration) {
      mergedSegments.push(accumulator);
      accumulator = null;
    }
  }

  // Add any remaining segment in the accumulator
  if (accumulator) {
    mergedSegments.push(accumulator);
  }

  return mergedSegments;
};

/**
 * Fixes transcription errors where the end of one segment duplicates the start of the next.
 * @param segments An array of segments, potentially with overlapping text.
 * @returns A new array of segments with overlaps removed.
 */
const deduplicateSegments = (segments: Segment[]): Segment[] => {
    if (segments.length < 2) return segments;

    const newSegments = JSON.parse(JSON.stringify(segments)); // Deep copy to avoid mutation issues

    for (let i = 1; i < newSegments.length; i++) {
        const prevText = newSegments[i - 1].text.trim();
        const currText = newSegments[i].text.trim();

        if (!prevText || !currText) continue;

        const prevWords = prevText.split(/\s+/);
        const currWords = currText.split(/\s+/);

        let bestOverlap = 0;
        // Check for overlaps of 1 to 10 words
        for (let k = Math.min(10, prevWords.length, currWords.length); k > 0; k--) {
            const prevSuffix = prevWords.slice(-k).join(' ').toLowerCase();
            const currPrefix = currWords.slice(0, k).join(' ').toLowerCase();
            if (prevSuffix === currPrefix) {
                bestOverlap = k;
                break; // Found the longest overlap, no need to check shorter ones
            }
        }

        if (bestOverlap > 0) {
            const newCurrWords = currWords.slice(bestOverlap);
            newSegments[i].text = newCurrWords.join(' ');
        }
    }
    // Filter out any segments that became entirely empty after deduplication
    return newSegments.filter(s => s.text.trim().length > 0);
};


const languages: {name: string; code: string}[] = [
    { name: "Arabic (Egyptian)", code: "ar-EG" }, { name: "Bengali (Bangladesh)", code: "bn-BD" },
    { name: "Dutch (Netherlands)", code: "nl-NL" }, { name: "English (US)", code: "en-US" },
    { name: "English (India)", code: "en-IN" }, { name: "French (France)", code: "fr-FR" },
    { name: "German (Germany)", code: "de-DE" }, { name: "Hindi (India)", code: "hi-IN" },
    { name: "Indonesian (Indonesia)", code: "id-ID" }, { name: "Italian (Italy)", code: "it-IT" },
    { name: "Japanese (Japan)", code: "ja-JP" }, { name: "Korean (Korea)", code: "ko-KR" },
    { name: "Marathi (India)", code: "mr-IN" }, { name: "Polish (Poland)", code: "pl-PL" },
    { name: "Portuguese (Brazil)", code: "pt-BR" }, { name: "Romanian (Romania)", code: "ro-RO" },
    { name: "Russian (Russia)", code: "ru-RU" }, { name: "Spanish (US)", code: "es-US" },
    { name: "Tamil (India)", code: "ta-IN" }, { name: "Telugu (India)", code: "te-IN" },
    { name: "Thai (Thailand)", code: "th-TH" }, { name: "Turkish (Turkey)", code: "tr-TR" },
    { name: "Ukrainian (Ukraine)", code: "uk-UA" }, { name: "Vietnamese (Vietnam)", code: "vi-VN" },
];

const voices = [
    'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
    'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi',
    'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird',
    'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'
];


// --- Sub-Components ---

const SegmentRow: React.FC<{ segment: DubbingSegment }> = ({ segment }) => {
    const duration = (segment.end - segment.start).toFixed(1);
    const speed = segment.speedAdjustment ? `Speed x${segment.speedAdjustment.toFixed(2)}` : null;

    let statusPill;
    switch(segment.status) {
        case 'pending': statusPill = <span className="text-gray-400">Pending</span>; break;
        case 'processing': statusPill = <span className="text-yellow-400 flex items-center"><LoadingSpinner size="w-3 h-3 mr-1"/>Generating...</span>; break;
        case 'adjusting': statusPill = <span className="text-cyan-400 flex items-center"><LoadingSpinner size="w-3 h-3 mr-1"/>Adjusting...</span>; break;
        case 'completed': statusPill = <span className="text-green-400">✓ Completed</span>; break;
        case 'failed': statusPill = <span className="text-red-400">✗ Failed</span>; break;
    }

    return (
        <div className="bg-gray-800 p-2.5 rounded-lg border border-gray-700/50">
            <div className="flex justify-between items-center text-xs mb-1.5">
                 <div className="flex items-center gap-2">
                    <span className="font-mono text-fuchsia-400 bg-gray-900 px-1.5 py-0.5 rounded">Duration: {duration}s</span>
                    {speed && <span className="font-mono text-amber-400 bg-gray-900 px-1.5 py-0.5 rounded">{speed}</span>}
                </div>
                <div className="font-semibold">{statusPill}</div>
            </div>
            <p className="text-sm text-gray-300 bg-gray-900/50 p-2 rounded-md">{segment.text}</p>
            {segment.error && <p className="text-xs text-red-400 mt-1 pl-1">{segment.error}</p>}
        </div>
    );
};


const LongTextToAudioPanel: React.FC<LongTextToAudioPanelProps> = ({
  aiGeneratedScript, multilingualState, setMultilingualState, setIsProcessing
}) => {
  const { originalScript, stylePrompt, voice, speakingRate, pitch, volumeGainDb, selectedLanguages, translatedScripts, finalDubbedAudio } = multilingualState;

  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>('input');
  const [parsedSegments, setParsedSegments] = useState<Segment[] | null>(null);

  const [dubbingJobs, setDubbingJobs] = useState<DubbingJob[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [inputType, setInputType] = useState<InputType>('plain');
  const [chunkDuration, setChunkDuration] = useState<number>(15);
  const stopRequestRef = useRef(false);

  // Audio processing refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioProcessorRef = useRef<ReturnType<typeof createAudioProcessor> | null>(null);
  
  const isBatchRunning = workflowStep === 'processing';

  useEffect(() => {
    const detectedType = detectInputType(originalScript);
    setInputType(detectedType);
    if(workflowStep !== 'input') {
        setWorkflowStep('input');
        setParsedSegments(null);
        setDubbingJobs([]);
    }
  }, [originalScript]);

  useEffect(() => { setIsProcessing(isBatchRunning); }, [isBatchRunning, setIsProcessing]);

  useEffect(() => {
    // Revoke old object URLs on unmount or when jobs change
    const urlsToRevoke = dubbingJobs.map(j => j.finalAudioUrl).filter(Boolean) as string[];
    return () => {
      urlsToRevoke.forEach(url => URL.revokeObjectURL(url));
    };
  }, [dubbingJobs]);

  useEffect(() => {
     try {
        const jobsFromPersistence: DubbingJob[] = selectedLanguages.map(langCode => {
            const lang = languages.find(l => l.code === langCode);
            let finalAudioUrl: string | undefined;
            if (finalDubbedAudio[langCode]) {
                try {
                    const byteCharacters = atob(finalDubbedAudio[langCode]);
                    const byteNumbers = new Array(byteCharacters.length).fill(0).map((_, i) => byteCharacters.charCodeAt(i));
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], {type: 'audio/wav'});
                    finalAudioUrl = URL.createObjectURL(blob);
                } catch(e) { console.error("Failed to load persisted audio", e)}
            }
            return {
                id: langCode,
                langCode,
                langName: lang?.name || langCode,
                status: finalDubbedAudio[langCode] ? 'completed' : 'pending',
                segments: [], // Segments are not persisted
                progress: { current: 0, total: 0 },
                finalAudioUrl: finalAudioUrl,
            };
        });
        if (jobsFromPersistence.some(j => j.status === 'completed')) {
            setDubbingJobs(jobsFromPersistence);
            setWorkflowStep('finished');
        }
     } catch (e) {
         console.error("Failed to initialize jobs from persisted state", e);
     }
  }, [selectedLanguages, finalDubbedAudio]);
  

  const setOriginalScript = (script: string) => setMultilingualState(prev => ({ ...prev, originalScript: script }));
  const setStylePrompt = (prompt: string) => setMultilingualState(prev => ({ ...prev, stylePrompt: prompt }));
  const onVoiceChange = (newVoice: string) => setMultilingualState(prev => ({ ...prev, voice: newVoice }));
  const onSpeakingRateChange = (rate: number) => setMultilingualState(prev => ({...prev, speakingRate: rate}));
  const onPitchChange = (p: number) => setMultilingualState(prev => ({...prev, pitch: p}));
  const onVolumeGainChange = (vol: number) => setMultilingualState(prev => ({...prev, volumeGainDb: vol}));

  const handleLanguageToggle = (langCode: string) => {
    setMultilingualState(prev => ({
        ...prev,
        selectedLanguages: prev.selectedLanguages.includes(langCode)
            ? prev.selectedLanguages.filter(c => c !== langCode)
            : [...prev.selectedLanguages, langCode]
    }));
  };
  const handleSelectAll = (select: boolean) => {
    setMultilingualState(prev => ({ ...prev, selectedLanguages: select ? languages.map(l => l.code) : [] }));
  };

  const updateJob = useCallback((langCode: string, updates: Partial<DubbingJob>) => {
      setDubbingJobs(prev => prev.map(job => job.langCode === langCode ? { ...job, ...updates } : job));
  }, []);

  const updateSegment = useCallback((langCode: string, segmentId: string, updates: Partial<DubbingSegment>) => {
    setDubbingJobs(prev => prev.map(job => {
        if (job.langCode === langCode) {
            return { ...job, segments: job.segments.map(seg => seg.id === segmentId ? { ...seg, ...updates } : seg) };
        }
        return job;
    }));
  }, []);

  const handleSegmentScript = useCallback(() => {
    setGlobalError(null);
    if (!originalScript.trim()) {
        setGlobalError("Script is empty.");
        return;
    }
    try {
        let baseSegments: Segment[];
        const detectedType = detectInputType(originalScript);
        setInputType(detectedType);

        if (detectedType === 'json') {
            baseSegments = parseJsonSegments(originalScript);
        } else if (detectedType === 'youtube') {
            baseSegments = parseYoutubeTranscript(originalScript);
        } else { // plain text
            baseSegments = parsePlainText(originalScript, chunkDuration);
        }
        
        const deduplicatedBaseSegments = deduplicateSegments(baseSegments);

        let finalSegments: Segment[];
        // Only merge if the input type had pre-defined timestamps and chunkDuration is positive
        if ((detectedType === 'json' || detectedType === 'youtube') && chunkDuration > 0) {
            finalSegments = mergeSegments(deduplicatedBaseSegments, chunkDuration);
        } else {
            finalSegments = deduplicatedBaseSegments;
        }

        if (finalSegments.length === 0) {
            setGlobalError("Could not parse any segments from the script. Try adjusting the duration or checking the script format.");
            return;
        }
        setParsedSegments(finalSegments);
        setWorkflowStep('segmented');
    } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        setGlobalError(`Script Parsing Error: ${error}`);
    }
  }, [originalScript, chunkDuration]);


  const handleStartBatch = async () => {
      if (!parsedSegments) {
          setGlobalError("No script segments available. Please segment the script first.");
          return;
      }
      stopRequestRef.current = false;
      setGlobalError(null);
      setWorkflowStep('processing');

      if (!audioContextRef.current) {
          try {
              audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
              audioProcessorRef.current = createAudioProcessor(audioContextRef.current);
          } catch(e) {
              setGlobalError("Could not initialize audio engine. Please use a modern browser.");
              setWorkflowStep('finished');
              return;
          }
      }
      
      const initialJobs: DubbingJob[] = selectedLanguages.map(code => ({
          id: code, langCode: code, langName: languages.find(l => l.code === code)?.name || code,
          status: 'pending', segments: [], progress: { current: 0, total: 0 }
      }));
      setDubbingJobs(initialJobs);

      for (const job of initialJobs) {
          if (stopRequestRef.current) break;
          await processJob(job.langCode, parsedSegments);
      }
      setWorkflowStep('finished');
  };
  
  const processJob = async (langCode: string, sourceSegments: Segment[]) => {
    if (!audioProcessorRef.current) {
        updateJob(langCode, { status: 'failed', error: 'Audio processor not initialized.' });
        return;
    }
    const audioProcessor = audioProcessorRef.current;
    const scriptTitle = (sourceSegments[0]?.text || 'untitled').substring(0, 30).replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_');

    try {
        // --- 1. Translation (BATCH) ---
        updateJob(langCode, { status: 'translating', progress: { current: 0, total: sourceSegments.length } });
        
        if (stopRequestRef.current) throw new Error("Operation stopped by user.");

        const translatedTexts = await geminiService.translateBatch(sourceSegments, langCode, (msg) => {
           const isError = msg.includes('failed') || msg.includes('Failed');
           updateJob(langCode, { error: isError ? msg : undefined });
        });

        if (stopRequestRef.current) throw new Error("Operation stopped by user.");

        const translatedSegments: DubbingSegment[] = sourceSegments.map((segment, i) => ({
            ...segment,
            id: `${langCode}-${i}`,
            text: translatedTexts[i],
            status: 'pending'
        }));

        updateJob(langCode, { 
            segments: translatedSegments,
            status: 'translated',
            progress: { current: sourceSegments.length, total: sourceSegments.length }
        });

        // --- 2. Dubbing (Segment by Segment with Context) ---
        updateJob(langCode, { status: 'dubbing', progress: { current: 0, total: translatedSegments.length } });
        const adjustedAudioBuffers: AudioBuffer[] = [];

        for (let i = 0; i < translatedSegments.length; i++) {
            const segment = translatedSegments[i];
            if (stopRequestRef.current) throw new Error("Operation stopped by user.");
            
            updateSegment(langCode, segment.id, { status: 'processing' });
            
            // Provide the text of the previous segment for contextual consistency.
            const previousSegmentText = i > 0 ? translatedSegments[i - 1].text : undefined;

            const pcmData = await generateAudioForSegment(
                segment.text,
                previousSegmentText,
                voice,
                { speakingRate, pitch, volumeGainDb },
                (msg) => {
                    updateSegment(langCode, segment.id, { error: msg.includes('failed') ? msg : undefined });
                }
            );

            if (stopRequestRef.current) throw new Error("Operation stopped by user.");

            updateSegment(langCode, segment.id, { status: 'adjusting' });
            const targetDuration = segment.end - segment.start;
            const originalBuffer = await audioProcessor.decodePcmToAudioBuffer(pcmData);
            const adjustedBuffer = await audioProcessor.adjustAudioSpeed(originalBuffer, targetDuration);
            const speedAdjustment = originalBuffer.duration > 0 ? targetDuration / originalBuffer.duration : 1;
            
            adjustedAudioBuffers.push(adjustedBuffer);
            updateSegment(langCode, segment.id, { status: 'completed', error: undefined, speedAdjustment: 1/speedAdjustment });
            updateJob(langCode, { progress: { current: i + 1, total: translatedSegments.length } });
        }

        // --- 3. Combining ---
        updateJob(langCode, { status: 'combining' });
        const finalBuffer = audioProcessor.combineAudioBuffers(adjustedAudioBuffers);
        const finalBlob = audioProcessor.audioBufferToWavBlob(finalBuffer);
        const finalUrl = URL.createObjectURL(finalBlob);
        saveAs(finalBlob, `${scriptTitle}_${langCode}.wav`);
        
        const finalBase64 = await audioProcessor.blobToBase64(finalBlob);
        setMultilingualState(prev => ({
            ...prev,
            finalDubbedAudio: { ...prev.finalDubbedAudio, [langCode]: finalBase64 }
        }));
        updateJob(langCode, { status: 'completed', finalAudioUrl: finalUrl, error: undefined });

    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        updateJob(langCode, { status: 'failed', error: errorMsg });
    }
};

  const handleStop = () => { stopRequestRef.current = true; setWorkflowStep('finished'); };

  const downloadableCount = dubbingJobs.filter(r => r.status === 'completed' && r.finalAudioUrl).length;
  const handleDownloadAll = async () => {
    if (downloadableCount === 0) return;
    const zip = new JSZip();
    for (const job of dubbingJobs) {
      if (job.status === 'completed' && job.finalAudioUrl) {
         const blob = await fetch(job.finalAudioUrl).then(r => r.blob());
         const scriptTitle = (originalScript).substring(0, 30).replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_');
         zip.file(`${scriptTitle || 'script'}_${job.langName.replace(/[ /()]/g, '_')}.wav`, blob);
      }
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    saveAs(zipBlob, `multilingual_dubs.zip`);
  };
  
  const isConfigDisabled = isBatchRunning || workflowStep === 'finished';
  const isInputDisabled = isConfigDisabled || workflowStep === 'segmented';

  return (
    <section className="bg-gray-800/50 p-6 sm:p-8 rounded-xl shadow-2xl space-y-8 border border-gray-700">
      <h2 className="text-3xl font-semibold text-fuchsia-300 text-center">Multilingual Dubbing Studio</h2>
      
      {/* --- Step 1: Input & Segmentation --- */}
      <div className="bg-gray-900 p-4 rounded-xl border border-gray-700/80 space-y-4">
        <h3 className="text-xl font-semibold text-white">1. Script & Segmentation</h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
            <div className="md:col-span-3">
                <div className="flex justify-between items-center mb-1">
                    <label htmlFor="long-tts-json" className="block text-sm font-medium text-gray-300">Paste Script</label>
                    <button onClick={() => setOriginalScript(aiGeneratedScript)} disabled={!aiGeneratedScript || isInputDisabled} className="text-xs text-fuchsia-400 hover:text-fuchsia-300 transition-colors disabled:opacity-50">Use AI Generated Script</button>
                </div>
                <textarea id="long-tts-json" rows={8} className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-gray-200 focus:ring-2 focus:ring-fuchsia-500 font-mono text-sm" placeholder="Paste script here. Accepts plain text, YouTube transcripts, or timestamped JSON." value={originalScript} onChange={(e) => setOriginalScript(e.target.value)} disabled={isInputDisabled} />
                <p className="mt-1 text-xs text-gray-500">Auto-detected format: <span className="font-semibold text-fuchsia-400 capitalize">{inputType}</span></p>
            </div>
            <div className="md:col-span-2">
                {workflowStep === 'input' && (
                    <div className="space-y-4 bg-gray-800 p-4 rounded-lg h-full flex flex-col">
                        <label htmlFor="chunk-duration" className="block text-sm font-medium text-gray-300">Target Segment Duration (seconds)</label>
                        <input
                            id="chunk-duration" type="number" value={chunkDuration}
                            onChange={(e) => setChunkDuration(Math.max(1, parseInt(e.target.value, 10) || 1))}
                            className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-gray-200 focus:ring-2 focus:ring-fuchsia-500"
                            min="1" disabled={isInputDisabled}
                        />
                        <p className="text-xs text-gray-500">
                           For Plain Text, creates new segments of this length. For YouTube/JSON, merges existing timed segments to meet this target duration.
                        </p>
                        <div className="mt-auto pt-4">
                            <ActionButton onClick={handleSegmentScript} disabled={!originalScript.trim() || isInputDisabled} className="w-full">
                                Segment Script
                            </ActionButton>
                        </div>
                    </div>
                )}
                {(workflowStep === 'segmented' && parsedSegments) && (
                    <div className="space-y-3 bg-gray-800 p-4 rounded-lg border border-gray-700 h-full flex flex-col">
                        <h3 className="text-lg font-semibold text-white">Segments Ready</h3>
                        <div className="flex-grow bg-gray-900/50 p-3 rounded-md text-center flex flex-col justify-center">
                            <p className="text-4xl font-bold text-fuchsia-400">{parsedSegments.length}</p>
                            <p className="text-gray-300">segments created.</p>
                        </div>
                        <ActionButton onClick={() => setWorkflowStep('input')} variant="secondary" className="w-full text-sm py-2">Re-segment Script</ActionButton>
                    </div>
                )}
                 { (isBatchRunning || (workflowStep === 'finished' && !parsedSegments)) && dubbingJobs.length > 0 &&
                    <div className="space-y-3 bg-gray-800 p-4 rounded-lg border border-gray-700 h-full flex flex-col">
                        <h3 className="text-lg font-semibold text-white">Processing Job</h3>
                        <div className="flex-grow bg-gray-900/50 p-3 rounded-md text-center flex flex-col justify-center">
                            <p className="text-2xl font-bold text-fuchsia-400">{dubbingJobs.length}</p>
                            <p className="text-gray-300">languages being processed.</p>
                        </div>
                    </div>
                }
            </div>
        </div>
      </div>
      
      {/*--- Step 2: Configuration ---*/}
      { (workflowStep === 'segmented' || (workflowStep === 'finished' && dubbingJobs.length > 0)) && (
        <div className="bg-gray-900 p-4 rounded-xl border border-gray-700/80 space-y-4">
            <h3 className="text-xl font-semibold text-white">2. Dubbing Configuration</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                <div>
                    <label htmlFor="long-tts-style-prompt" className="block text-sm font-medium text-gray-300 mb-1">Audio Style Prompt</label>
                    <textarea id="long-tts-style-prompt" rows={2} className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-gray-200 focus:ring-2 focus:ring-fuchsia-500" placeholder="e.g., Read in a calm, documentary-style voice." value={stylePrompt} onChange={(e) => setStylePrompt(e.target.value)} disabled={isConfigDisabled}/>
                </div>
                <div>
                    <label htmlFor="long-tts-voice" className="block text-sm font-medium text-gray-300 mb-1">Select AI Voice</label>
                    <select id="long-tts-voice" value={voice} onChange={(e) => onVoiceChange(e.target.value)} className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-gray-200 focus:ring-2 focus:ring-fuchsia-500" disabled={isConfigDisabled}>
                        {voices.map((v) => (<option key={v} value={v}>{v}</option>))}
                    </select>
                </div>
                
                <div className="space-y-3">
                  <SpeechParameterSlider label="Speaking Rate" value={speakingRate} onChange={onSpeakingRateChange} min={0.25} max={4.0} step={0.01} disabled={isConfigDisabled} />
                </div>
                <div className="space-y-3">
                  <SpeechParameterSlider label="Pitch" value={pitch} onChange={onPitchChange} min={-20.0} max={20.0} step={0.1} disabled={isConfigDisabled} />
                </div>
                 <div className="space-y-3">
                  <SpeechParameterSlider label="Volume Gain (dB)" value={volumeGainDb} onChange={onVolumeGainChange} min={-96.0} max={16.0} step={0.5} disabled={isConfigDisabled} />
                </div>
                
                <div className="md:col-span-2">
                    <div className="flex justify-between items-center mb-2"><label className="block text-sm font-medium text-gray-300">Select Target Languages</label>
                    <div>
                        <button onClick={() => handleSelectAll(true)} className="text-xs text-fuchsia-400 hover:text-fuchsia-300 mr-2" disabled={isConfigDisabled}>All</button>
                        <button onClick={() => handleSelectAll(false)} className="text-xs text-fuchsia-400 hover:text-fuchsia-300" disabled={isConfigDisabled}>None</button>
                    </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-40 overflow-y-auto p-3 bg-gray-700 rounded-lg border border-gray-600">
                        {languages.map(lang => (
                            <label key={lang.code} className={`flex items-center space-x-2 text-sm text-gray-200 ${isConfigDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                                <input type="checkbox" checked={selectedLanguages.includes(lang.code)} onChange={() => handleLanguageToggle(lang.code)} disabled={isConfigDisabled} className="h-4 w-4 rounded border-gray-500 bg-gray-600 text-fuchsia-500 focus:ring-fuchsia-600" />
                                <span>{lang.name}</span>
                            </label>
                        ))}
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* --- Step 3: Action & Results --- */}
      <div className="space-y-6">
        <div className="flex flex-col items-center justify-center space-y-3 pt-4 border-t border-gray-700/50">
            {globalError && <ErrorDisplay message={globalError} />}
            { workflowStep === 'segmented' && (
                <ActionButton onClick={handleStartBatch} disabled={!originalScript.trim() || selectedLanguages.length === 0} className="w-full max-w-md">Start Dubbing Process ({selectedLanguages.length} languages)</ActionButton>
            )}
            { workflowStep === 'processing' && (
              <ActionButton onClick={handleStop} variant="danger" className="w-full max-w-md">Stop Process</ActionButton>
            )}
            { workflowStep === 'finished' && (
                <ActionButton onClick={() => { setWorkflowStep('input'); setDubbingJobs([]); setParsedSegments(null); }} variant="secondary" className="w-full max-w-md">Start New Dubbing Job</ActionButton>
            )}
        </div>

        <div className="flex justify-between items-center border-b border-gray-700 pb-2">
            <h3 className="text-2xl font-semibold text-fuchsia-300">Dubbing Tracks</h3>
            <ActionButton onClick={handleDownloadAll} disabled={isBatchRunning || downloadableCount === 0} variant="secondary" className="py-2 px-4 text-sm">Download All ({downloadableCount})</ActionButton>
        </div>
        
        {dubbingJobs.length === 0 && workflowStep !== 'input' ? (
          <p className="text-gray-500 text-center py-8">Select languages and start the process to see results.</p>
        ) : dubbingJobs.length > 0 ? (
          <div className="space-y-6">
              {dubbingJobs.map(job => (
                  <div key={job.id} className="bg-gray-800 p-4 rounded-xl border border-gray-700">
                      <div className="flex justify-between items-center mb-3">
                          <h4 className="text-xl font-bold text-white">{job.langName}</h4>
                          <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                              job.status === 'completed' ? 'bg-green-500/20 text-green-300' :
                              job.status === 'failed' ? 'bg-red-500/20 text-red-300' : 'bg-fuchsia-500/20 text-fuchsia-300'
                          }`}>{job.status.charAt(0).toUpperCase() + job.status.slice(1)}</span>
                      </div>
                      
                      {job.error && <ErrorDisplay message={job.error} />}

                      {(job.status === 'translating' || job.status === 'dubbing' || job.status === 'combining') && job.progress.total > 0 && (
                          <div className="my-2">
                              <div className="w-full bg-gray-700 rounded-full h-2.5">
                                  <div className="bg-fuchsia-500 h-2.5 rounded-full transition-all duration-300" style={{ width: `${(job.progress.current / job.progress.total) * 100}%` }}></div>
                              </div>
                              <p className="text-xs text-gray-400 text-center mt-1">
                                {job.status === 'translating' ? `Translating batch of ${job.progress.total} segments...` :
                                 job.status === 'dubbing' ? `Dubbing: ${job.progress.current} of ${job.progress.total} segments processed` :
                                 'Combining audio...'
                                }
                              </p>
                          </div>
                      )}

                      {job.status === 'completed' && job.finalAudioUrl && (
                          <div className="bg-gray-900 p-3 rounded-lg flex items-center gap-4">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                              <audio controls src={job.finalAudioUrl} className="w-full"></audio>
                          </div>
                      )}

                      {job.segments.length > 0 && (
                          <div className="mt-4 max-h-80 overflow-y-auto space-y-2 pr-2">
                              {job.segments.map(seg => <SegmentRow key={seg.id} segment={seg} />)}
                          </div>
                      )}
                  </div>
              ))}
          </div>
        ) : null}
      </div>
    </section>
  );
};

export default LongTextToAudioPanel;