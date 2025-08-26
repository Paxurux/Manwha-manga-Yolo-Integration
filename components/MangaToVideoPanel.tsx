import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { StitchedPageAnalysis, Panel, AudioInfo, CoordinatesArray, ActionKeybindings } from '../types';
import { geminiService, StoryGenerationResult } from '../services/geminiService';
import { generateAudioForSegment } from '../services/geminiTtsService';
import { createAudioProcessor } from '../services/audioProcessingService';
import { TRANSLATION_STYLE_GUIDES } from '../services/translationStyleGuides';
import ActionButton from './ActionButton';
import LoadingSpinner from './LoadingSpinner';
import ErrorDisplay from './ErrorDisplay';
import { panelDetectorService } from '../services/panelDetectorService';
import PanelEditor from './PanelEditor';
import KeybindingManager from './KeybindingManager';


const languages = Object.values(TRANSLATION_STYLE_GUIDES).map(guide => ({
    name: guide.target_language_name,
    code: guide.language_code
}));

interface Chapter {
    id: string;
    name: string;
    files: File[];
    stitchedPages: StitchedPageAnalysis[]; // Note: Name kept for consistency, but now represents single pages
    status: 'pending' | 'stitching' | 'stitched' | 'processing' | 'processed' | 'error';
    error?: string;
}

interface History<T> {
    past: T[];
    present: T;
    future: T[];
}

interface MangaToVideoPanelProps {
    ttsVoice: string;
    onTtsVoiceChange: (voice: string) => void;
    speakingRate: number;
    onSpeakingRateChange: (rate: number) => void;
    pitch: number;
    onPitchChange: (pitch: number) => void;
    volumeGain: number;
    onVolumeGainChange: (gain: number) => void;
    setIsProcessing: (isProcessing: boolean) => void;
    isParentProcessing: boolean;
}

const DEFAULT_KEYBINDINGS: ActionKeybindings = {
  splitPanel: [{ key: 'b', ctrlKey: true, shiftKey: false, altKey: false }],
  cropTop: [{ key: 'q', ctrlKey: false, shiftKey: false, altKey: false }],
  cropBottom: [{ key: 'w', ctrlKey: false, shiftKey: false, altKey: false }],
  deletePanel: [{ key: 'Delete', ctrlKey: false, shiftKey: false, altKey: false }],
  undo: [{ key: 'z', ctrlKey: true, shiftKey: false, altKey: false }],
  redo: [
    { key: 'y', ctrlKey: true, shiftKey: false, altKey: false },
    { key: 'z', ctrlKey: true, shiftKey: true, altKey: false }
  ],
  nextPanel: [{ key: 'Enter', ctrlKey: false, shiftKey: false, altKey: false }],
  previousPanel: [{ key: 'Enter', ctrlKey: false, shiftKey: true, altKey: false }],
};

const cropPanelImage = async (pageImageSrc: string, pageImageMime: string, pageImageWidth: number, pageImageHeight: number, panelCoords: CoordinatesArray): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const [x, y, w, h] = panelCoords;
            const canvas = document.createElement('canvas');
            const cropWidth = w * pageImageWidth;
            const cropHeight = h * pageImageHeight;
            if (cropWidth <= 0 || cropHeight <= 0) {
                return resolve('');
            }
            canvas.width = cropWidth;
            canvas.height = cropHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error("Could not get canvas context for cropping."));
            
            ctx.drawImage(img, x * pageImageWidth, y * pageImageHeight, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL(pageImageMime));
        };
        img.onerror = (err) => reject(new Error("Failed to load page image for cropping."));
        img.src = pageImageSrc;
    });
};


const MangaToVideoPanel: React.FC<MangaToVideoPanelProps> = (props) => {
    const [chaptersHistory, setChaptersHistory] = useState<History<Chapter[]>>({
        past: [],
        present: [],
        future: []
    });
    const { present: chapters } = chaptersHistory;

    const [status, setStatus] = useState<string>('Ready.');
    const [globalError, setGlobalError] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    
    // Config states
    const [characterDescriptions, setCharacterDescriptions] = useState('');
    const [contentType, setContentType] = useState<'manhwa' | 'manga'>('manhwa');
    const [targetLanguages, setTargetLanguages] = useState<string[]>(['en-US']);
    const [selectedLanguage, setSelectedLanguage] = useState<string>('en-US');
    
    const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
    const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);

    const [keybindings, setKeybindings] = useState<ActionKeybindings>(DEFAULT_KEYBINDINGS);
    const [showKeybindings, setShowKeybindings] = useState(false);

    const stopRequestRef = useRef(false);
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioProcessorRef = useRef<ReturnType<typeof createAudioProcessor> | null>(null);

    useEffect(() => {
        try {
            const saved = localStorage.getItem('mangaKeybindings');
            if (saved) {
                setKeybindings(JSON.parse(saved));
            }
        } catch (e) {
            console.error("Failed to load keybindings from localStorage", e);
            setKeybindings(DEFAULT_KEYBINDINGS);
        }
    }, []);

    const handleKeybindingsChange = (newKeybindings: ActionKeybindings) => {
        setKeybindings(newKeybindings);
        localStorage.setItem('mangaKeybindings', JSON.stringify(newKeybindings));
    };

    const setChapters = useCallback((updater: (prev: Chapter[]) => Chapter[], recordHistory: boolean = false) => {
        setChaptersHistory(currentHistory => {
            const newPresent = updater(currentHistory.present);
            if (!recordHistory) return { ...currentHistory, present: newPresent };
            if (JSON.stringify(newPresent) === JSON.stringify(currentHistory.present)) return currentHistory;
            const newPast = [...currentHistory.past, currentHistory.present];
            if (newPast.length > 50) newPast.shift();
            return { past: newPast, present: newPresent, future: [] };
        });
    }, []);

    const handleUndo = useCallback(() => {
        setChaptersHistory(h => {
            if (h.past.length === 0) return h;
            const previous = h.past[h.past.length - 1];
            const newPast = h.past.slice(0, h.past.length - 1);
            return { past: newPast, present: previous, future: [h.present, ...h.future] };
        });
    }, []);

    const handleRedo = useCallback(() => {
        setChaptersHistory(h => {
            if (h.future.length === 0) return h;
            const next = h.future[0];
            const newFuture = h.future.slice(1);
            return { past: [...h.past, h.present], present: next, future: newFuture };
        });
    }, []);
    
    const handleDeletePanel = useCallback((chapterId: string, pageId: string, panelId: string) => {
        setChapters(prev => prev.map(ch => {
            if (ch.id !== chapterId) return ch;
            const newPages = ch.stitchedPages.map(p => {
                if (p.stitch_id !== pageId) return p;
                return { ...p, panels: p.panels.filter(panelItem => panelItem.panel_id !== panelId).map((panel, i) => ({ ...panel, index: i })) };
            });
            return { ...ch, stitchedPages: newPages };
        }), true);
    }, [setChapters]);

    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            const isEditingText = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
            if (isEditingText) return;

            const checkBinding = (action: keyof ActionKeybindings) => {
                return keybindings[action].some(b => 
                    b.key.toLowerCase() === e.key.toLowerCase() &&
                    b.ctrlKey === e.ctrlKey &&
                    b.shiftKey === e.shiftKey &&
                    b.altKey === e.altKey
                );
            };

            if (checkBinding('undo')) { e.preventDefault(); handleUndo(); return; }
            if (checkBinding('redo')) { e.preventDefault(); handleRedo(); return; }

            const allPanelsInOrder = chapters.flatMap(chapter => 
                chapter.stitchedPages.flatMap(page => 
                    page.panels.map(panel => ({ ...panel, page_id: page.stitch_id, chapter_id: chapter.id }))
                )
            );
            if (allPanelsInOrder.length === 0) return;

            const currentIndex = selectedPanelId ? allPanelsInOrder.findIndex(p => p.panel_id === selectedPanelId) : -1;

            if (checkBinding('deletePanel') && currentIndex !== -1) {
                e.preventDefault();
                const currentPanel = allPanelsInOrder[currentIndex];
                handleDeletePanel(currentPanel.chapter_id, currentPanel.page_id, currentPanel.panel_id);
                
                const newTotal = allPanelsInOrder.length - 1;
                if (newTotal > 0) {
                    const newPanelOrder = allPanelsInOrder.filter(p => p.panel_id !== selectedPanelId);
                    const nextIndex = Math.min(currentIndex, newTotal - 1);
                    const nextPanelToSelect = newPanelOrder[nextIndex];
                    if (nextPanelToSelect) {
                        setSelectedPageId(nextPanelToSelect.page_id);
                        setSelectedPanelId(nextPanelToSelect.panel_id);
                    }
                } else {
                    setSelectedPageId(null);
                    setSelectedPanelId(null);
                }
                return;
            }
            
            if ((checkBinding('nextPanel') || checkBinding('previousPanel')) && currentIndex !== -1) {
                 e.preventDefault();
                 const isNext = checkBinding('nextPanel');
                 const nextIndex = isNext ? currentIndex + 1 : currentIndex - 1;
                 if (nextIndex >= 0 && nextIndex < allPanelsInOrder.length) {
                     const nextPanel = allPanelsInOrder[nextIndex];
                     setSelectedPageId(nextPanel.page_id);
                     setSelectedPanelId(nextPanel.panel_id);
                 }
            }
        };
        
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [chapters, selectedPanelId, selectedPageId, keybindings, handleUndo, handleRedo, handleDeletePanel]);

    useEffect(() => {
        props.setIsProcessing(isProcessing);
    }, [isProcessing, props.setIsProcessing]);
    
    useEffect(() => {
        return () => {
            chapters.forEach(chapter => chapter.stitchedPages.forEach(page => page.panels.forEach(panel => 
                Object.values(panel.audioInfos).forEach(info => { if (info.src) URL.revokeObjectURL(info.src); })
            )));
        };
    }, [chapters]);

    const imageFileToData = async (file: File): Promise<{ base64: string, mimeType: string, width: number, height: number }> => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return reject(new Error("Could not get canvas context"));
                ctx.drawImage(img, 0, 0);
                URL.revokeObjectURL(img.src);
                resolve({ base64: canvas.toDataURL(file.type), mimeType: file.type, width: img.width, height: img.height });
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    };
    
    const handleFilesUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files) return;

        setStatus('Organizing files into chapters...');
        setGlobalError(null);
        setChaptersHistory({ past: [], present: [], future: [] });

        const chapterMap: { [key: string]: File[] } = {};

        for (const file of Array.from(files)) {
            const path = file.webkitRelativePath || file.name;
            const pathParts = path.split('/');
            if (pathParts.length < 2) continue;

            const chapterName = pathParts[pathParts.length - 2];
            if (!chapterMap[chapterName]) {
                chapterMap[chapterName] = [];
            }
            chapterMap[chapterName].push(file);
        }

        const sortedChapterNames = Object.keys(chapterMap).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

        const initialChapters: Chapter[] = sortedChapterNames.map((name, index) => {
            const chapterFiles = chapterMap[name].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
            return {
                id: `ch-${Date.now()}-${index}`,
                name,
                files: chapterFiles,
                stitchedPages: [],
                status: 'pending'
            };
        });
        
        setChapters(() => initialChapters, true);
        setIsProcessing(true);
        setStatus(`Found ${initialChapters.length} chapters. Loading individual pages...`);

        try {
             const updatedChapters = await Promise.all(initialChapters.map(async (chapter) => {
                setStatus(`Loading pages for Chapter: ${chapter.name}`);
                const pages: StitchedPageAnalysis[] = await Promise.all(
                    chapter.files.map(async (file, pageIndex) => {
                        const { base64, mimeType, width, height } = await imageFileToData(file);
                        return {
                            stitch_id: `page-${chapter.id}-${pageIndex}`,
                            chapter_id: chapter.id, stitch_hash: '', pages_in_stitch: 1,
                            image_width: width, image_height: height, reading_direction: 'vertical',
                            panels: [], stitchedImageBase64: base64, stitchedImageMimeType: mimeType,
                            stitchedFileName: file.name,
                        };
                    })
                );
                return { ...chapter, stitchedPages: pages, status: 'stitched' as const };
            }));

            setChapters(() => updatedChapters, true);
            setStatus(`All pages loaded. Ready to detect panels.`);

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setGlobalError(`Failed during page loading process: ${message}`);
            setStatus('Error during page loading.');
        } finally {
            setIsProcessing(false);
        }
    }, [setChapters]);

    const handleDetectPanels = useCallback(async (chapterId: string) => {
        setStatus(`Detecting panels for chapter...`);
        setGlobalError(null);
        setSelectedPanelId(null);
        setSelectedPageId(null);

        const chapter = chapters.find(c => c.id === chapterId);
        if (!chapter) {
            setGlobalError("Chapter not found.");
            return;
        }

        setChapters(prev => prev.map((ch: Chapter) => {
            if (ch.id === chapterId) return { ...ch, status: 'processing' as const };
            return ch;
        }));

        try {
            const detectionPromises = chapter.stitchedPages.map((page, i) => {
                setStatus(`Analyzing page ${i + 1}/${chapter.stitchedPages.length}: ${page.stitchedFileName}`);
                return panelDetectorService.detectPanels(page.stitchedImageBase64)
                    .then(detectedRawPanels => ({ stitch_id: page.stitch_id, detectedRawPanels }));
            });
            
            const results = await Promise.all(detectionPromises);
            
            setChapters(prev => {
                const chapterToUpdate = prev.find(c => c.id === chapterId);
                if (!chapterToUpdate) return prev;

                const newStitchedPages = chapterToUpdate.stitchedPages.map(page => {
                    const result = results.find(r => r.stitch_id === page.stitch_id);
                    if (!result) return page;

                    const newPanels: Panel[] = result.detectedRawPanels.map((p, panelIndex) => ({
                        ...p, index: panelIndex, audioInfos: {}, status: 'pending',
                        panel_id: p.panel_id || `panel-${page.stitch_id}-${panelIndex}`,
                    }));

                    return { ...page, panels: newPanels };
                });

                const updatedChapter = { ...chapterToUpdate, stitchedPages: newStitchedPages, status: 'processed' as const };
                
                updatedChapter.stitchedPages.forEach(page => {
                    page.panels.forEach(async (panel) => {
                        const croppedBase64 = await cropPanelImage(page.stitchedImageBase64, page.stitchedImageMimeType, page.image_width, page.image_height, panel.coordinates);
                        setChapters(currentChapters => currentChapters.map(c => {
                            if (c.id !== chapterId) return c;
                            return { ...c, stitchedPages: c.stitchedPages.map(p => {
                                if (p.stitch_id !== page.stitch_id) return p;
                                return { ...p, panels: p.panels.map(pnl => pnl.panel_id === panel.panel_id ? { ...pnl, croppedImageBase64: croppedBase64 } : pnl) };
                            }) };
                        }));
                    });
                });
                
                return prev.map(ch => ch.id === chapterId ? updatedChapter : ch);
            }, true);

            setStatus(`Panel detection for Chapter ${chapter.name} complete.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setGlobalError(`Error detecting panels for Chapter ${chapter.name}: ${message}`);
            setChapters(prev => prev.map((ch: Chapter) => {
                if (ch.id === chapterId) return { ...ch, status: 'error' as const, error: message };
                return ch;
            }));
        }
    }, [chapters, setChapters]);
    
    const handleGenerateStories = useCallback(async (chapterId: string, previousChapterContext?: string) => {
        setStatus('Generating stories for all panels in chapter...');
        setGlobalError(null);

        const chapter = chapters.find(c => c.id === chapterId);
        if (!chapter) {
            setGlobalError("Chapter not found.");
            return;
        }

        const allPanelsInChapter = chapter.stitchedPages.flatMap(p => p.panels);
        if (allPanelsInChapter.length === 0) {
            setGlobalError("No panels detected in this chapter to generate stories for.");
            return;
        }

        try {
            const storyData = await geminiService.generateStoriesForPanels(
                allPanelsInChapter,
                characterDescriptions,
                previousChapterContext, 
                targetLanguages,
                (msg) => setStatus(msg)
            );

            const storyMap = new Map<string, StoryGenerationResult>();
            storyData.forEach(item => storyMap.set(item.panel_id, item));

            setChapters(prev => prev.map(ch => {
                if (ch.id !== chapterId) return ch;
                return {
                    ...ch,
                    stitchedPages: ch.stitchedPages.map(page => ({
                        ...page,
                        panels: page.panels.map(panel => {
                            const storyResult = storyMap.get(panel.panel_id);
                            return storyResult 
                                ? { 
                                    ...panel, 
                                    recap_texts: storyResult.recap_texts, 
                                    narration_tone: storyResult.narration_tone,
                                    key_action_description: storyResult.key_action_description,
                                    dialogue_summary: storyResult.dialogue_summary,
                                    status: 'complete' 
                                  } 
                                : panel;
                        })
                    }))
                };
            }));

            setStatus(`Story generation for Chapter ${chapter.name} complete.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setGlobalError(`Error generating stories for Chapter ${chapter.name}: ${message}`);
            throw error; // Re-throw to be caught by batch processor
        }

    }, [chapters, characterDescriptions, targetLanguages, setChapters]);
    
    const handleGenerateNarrationForChapter = useCallback(async (chapterId: string) => {
        setStatus(`Starting narration for chapter...`);
        setGlobalError(null);
        
         if (!audioContextRef.current) {
          try {
              audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
              audioProcessorRef.current = createAudioProcessor(audioContextRef.current);
          } catch(e) {
              setGlobalError("Could not initialize audio engine. Please use a modern browser.");
              throw e;
          }
      }
        
        const chapter = chapters.find(c => c.id === chapterId);
        if (!chapter) return;
        
        const allPanels = chapter.stitchedPages.flatMap(p => p.panels);
        
        for(let i=0; i<allPanels.length; i++) {
            if (stopRequestRef.current) break;
            const panel = allPanels[i];
            const text = panel.recap_texts?.[selectedLanguage];
            if (!text) continue;
            
            const prevText = i > 0 ? allPanels[i-1].recap_texts?.[selectedLanguage] : undefined;
            
             setChapters(prev => prev.map(ch => {
                 if(ch.id !== chapterId) return ch;
                 return { ...ch, stitchedPages: ch.stitchedPages.map(p => ({
                     ...p, panels: p.panels.map(pnl => pnl.panel_id === panel.panel_id ? {...pnl, audioInfos: {...pnl.audioInfos, [selectedLanguage]: {src: '', duration: 0, error: 'generating'}}} : pnl)
                 }))};
             }));
            
            try {
                const pcmData = await generateAudioForSegment(
                    text, prevText, props.ttsVoice,
                    { speakingRate: props.speakingRate, pitch: props.pitch, volumeGainDb: props.volumeGain },
                    (msg) => setStatus(`Panel ${i+1}/${allPanels.length}: ${msg}`)
                );
                
                if(pcmData.length > 0 && audioProcessorRef.current) {
                    const audioBuffer = await audioProcessorRef.current.decodePcmToAudioBuffer(pcmData);
                    const wavBlob = audioProcessorRef.current.audioBufferToWavBlob(audioBuffer);
                    const audioUrl = URL.createObjectURL(wavBlob);
                    
                    setChapters(prev => prev.map(ch => {
                         if(ch.id !== chapterId) return ch;
                         return { ...ch, stitchedPages: ch.stitchedPages.map(p => ({
                             ...p, panels: p.panels.map(pnl => pnl.panel_id === panel.panel_id ? {...pnl, audioInfos: {...pnl.audioInfos, [selectedLanguage]: {src: audioUrl, duration: audioBuffer.duration}}} : pnl)
                         }))};
                    }));
                }
            } catch (error) {
                 const message = error instanceof Error ? error.message : String(error);
                 setChapters(prev => prev.map(ch => {
                     if(ch.id !== chapterId) return ch;
                     return { ...ch, stitchedPages: ch.stitchedPages.map(p => ({
                         ...p, panels: p.panels.map(pnl => pnl.panel_id === panel.panel_id ? {...pnl, audioInfos: {...pnl.audioInfos, [selectedLanguage]: {src:'', duration:0, error: message}}} : pnl)
                     }))};
                 }));
            }
        }
        
        setStatus(`Narration for chapter ${chapter.name} complete.`);

    }, [chapters, selectedLanguage, props.ttsVoice, props.speakingRate, props.pitch, props.volumeGain, setChapters]);

    const handleExportPanels = async (chapterId: string) => {
        const chapter = chapters.find(c => c.id === chapterId);
        if (!chapter) {
            setGlobalError("Chapter not found for export.");
            return;
        }
    
        const panelsToExport = chapter.stitchedPages.flatMap(p => p.panels).filter(p => p.croppedImageBase64);
        if (panelsToExport.length === 0) {
            setGlobalError("No cropped panels available to export for this chapter.");
            return;
        }
    
        setStatus(`Exporting ${panelsToExport.length} panels for ${chapter.name}...`);
        setIsProcessing(true);
        setGlobalError(null);
    
        try {
            const zip = new JSZip();
            
            panelsToExport.forEach((panel, chapterIndex) => {
                const base64Data = panel.croppedImageBase64!.split(',')[1];
                const fileName = `Panel_${String(chapterIndex + 1).padStart(4, '0')}.png`;
                zip.file(fileName, base64Data, { base64: true });
            });
    
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            saveAs(zipBlob, `${chapter.name.replace(/[^a-zA-Z0-9 ._-]/g, '_')}_panels.zip`);
            setStatus(`Successfully exported panels for ${chapter.name}.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setGlobalError(`Failed to export panels: ${message}`);
            setStatus('Export failed.');
        } finally {
            setIsProcessing(false);
        }
    };
    
    const handleStop = () => {
        stopRequestRef.current = true;
        setIsProcessing(false);
        setStatus('Processing stopped by user.');
    };

    // --- Global Batch Handlers ---
    const handleDetectAllPanels = async () => {
        setIsProcessing(true);
        setStatus('Starting global panel detection...');
        setGlobalError(null);
        stopRequestRef.current = false;

        for (let i = 0; i < chapters.length; i++) {
            if (stopRequestRef.current) break;
            const chapter = chapters[i];
            setStatus(`Detecting panels for Chapter ${i + 1}/${chapters.length}: ${chapter.name}`);
            try {
                await handleDetectPanels(chapter.id);
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                setGlobalError(`Failed on Chapter ${chapter.name}: ${message}`);
                break;
            }
        }
        setStatus(stopRequestRef.current ? 'Global detection stopped.' : 'Global panel detection complete.');
        setIsProcessing(false);
    };

    const handleGenerateAllStories = async () => {
        setIsProcessing(true);
        setStatus('Starting global story generation...');
        setGlobalError(null);
        stopRequestRef.current = false;

        let previousChapterContext: string | undefined = undefined;

        for (let i = 0; i < chapters.length; i++) {
            if (stopRequestRef.current) break;
            const chapter = chapters[i];
            setStatus(`Generating stories for Chapter ${i + 1}/${chapters.length}: ${chapter.name}`);
            try {
                await handleGenerateStories(chapter.id, previousChapterContext);
                
                const latestChapters = chaptersHistory.present;
                const updatedChapter = latestChapters.find(c => c.id === chapter.id);
                if (updatedChapter) {
                    const lastPage = updatedChapter.stitchedPages[updatedChapter.stitchedPages.length - 1];
                    if (lastPage && lastPage.panels.length > 0) {
                        const lastPanel = lastPage.panels[lastPage.panels.length - 1];
                        previousChapterContext = lastPanel.recap_texts?.[selectedLanguage];
                    }
                }

            } catch (e) {
                 const message = e instanceof Error ? e.message : String(e);
                setGlobalError(`Failed on Chapter ${chapter.name}: ${message}`);
                break;
            }
        }
        
        setStatus(stopRequestRef.current ? 'Global story generation stopped.' : 'Global story generation complete.');
        setIsProcessing(false);
    };

    const handleGenerateAllNarration = async () => {
        setIsProcessing(true);
        setStatus('Starting global narration generation...');
        setGlobalError(null);
        stopRequestRef.current = false;

        for (let i = 0; i < chapters.length; i++) {
            if (stopRequestRef.current) break;
            const chapter = chapters[i];
            setStatus(`Generating narration for Chapter ${i + 1}/${chapters.length}: ${chapter.name}`);
            try {
                await handleGenerateNarrationForChapter(chapter.id);
            } catch (e) {
                 const message = e instanceof Error ? e.message : String(e);
                setGlobalError(`Failed on Chapter ${chapter.name}: ${message}`);
                break;
            }
        }
        
        setStatus(stopRequestRef.current ? 'Global narration generation stopped.' : 'Global narration generation complete.');
        setIsProcessing(false);
    };

    const isAnyPanelCropped = useMemo(() => 
        chapters.some(c => 
            c.stitchedPages.some(p => 
                p.panels.some(panel => !!panel.croppedImageBase64)
            )
        ), 
    [chapters]);

    const handleExportAllPanels = async () => {
        if (!isAnyPanelCropped) {
            setGlobalError("No cropped panels available to export across any chapters.");
            return;
        }

        setStatus(`Starting global export of all panels...`);
        setIsProcessing(true);
        setGlobalError(null);

        try {
            const zip = new JSZip();

            for (const chapter of chapters) {
                const panelsInChapter = chapter.stitchedPages.flatMap(p => p.panels).filter(p => p.croppedImageBase64);
                if (panelsInChapter.length === 0) continue;

                const chapterFolder = zip.folder(chapter.name.replace(/[^a-zA-Z0-9 ._-]/g, '_'));
                if (!chapterFolder) {
                    console.error(`Could not create zip folder for chapter: ${chapter.name}`);
                    continue;
                }
                
                panelsInChapter.forEach((panel, chapterIndex) => {
                    const base64Data = panel.croppedImageBase64!.split(',')[1];
                    const fileName = `Panel_${String(chapterIndex + 1).padStart(4, '0')}.png`;
                    chapterFolder.file(fileName, base64Data, { base64: true });
                });
            }

            const zipBlob = await zip.generateAsync({ type: 'blob' });
            saveAs(zipBlob, `All_Manga_Panels.zip`);
            setStatus(`Successfully exported all panels.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setGlobalError(`Failed during global panel export: ${message}`);
            setStatus('Global export failed.');
        } finally {
            setIsProcessing(false);
        }
    };
    
    const handleSplitPanel = useCallback(async (pageId: string, panelId: string, splitY_norm: number) => {
        let pageForCropping: StitchedPageAnalysis | null = null;
        let originalPanel: Panel | null = null;

        setChapters(prev => {
            let newChapters = [...prev];
            const chIndex = newChapters.findIndex(ch => ch.stitchedPages.some(p => p.stitch_id === pageId));
            if (chIndex === -1) return prev;
            
            const pageIndex = newChapters[chIndex].stitchedPages.findIndex(p => p.stitch_id === pageId);
            if (pageIndex === -1) return prev;

            const panelIndex = newChapters[chIndex].stitchedPages[pageIndex].panels.findIndex(p => p.panel_id === panelId);
            if (panelIndex === -1) return prev;
            
            pageForCropping = newChapters[chIndex].stitchedPages[pageIndex];
            originalPanel = newChapters[chIndex].stitchedPages[pageIndex].panels[panelIndex];

            const { panel_id, coordinates, audioInfos, recap_texts, status, croppedImageBase64, ...restOfPanel } = originalPanel;
            const [x, y, w, h] = coordinates;
            if (splitY_norm <= y || splitY_norm >= y + h) return prev;

            const topPanelHeight = splitY_norm - y;
            const bottomPanelHeight = (y + h) - splitY_norm;

            const topPanel: Panel = { ...restOfPanel, panel_id: `panel-${pageId}-${Date.now()}-a`, coordinates: [x, y, w, topPanelHeight], audioInfos: {}, recap_texts: {}, status: 'pending' };
            const bottomPanel: Panel = { ...restOfPanel, panel_id: `panel-${pageId}-${Date.now()}-b`, coordinates: [x, splitY_norm, w, bottomPanelHeight], audioInfos: {}, recap_texts: {}, status: 'pending' };
            
            const newPanels = [...pageForCropping.panels];
            newPanels.splice(panelIndex, 1, topPanel, bottomPanel);
            
            newChapters[chIndex].stitchedPages[pageIndex].panels = newPanels.map((p, i) => ({ ...p, index: i }));
            setSelectedPanelId(topPanel.panel_id);
            return newChapters;
        }, true);

        if (pageForCropping && originalPanel) {
            const page = pageForCropping;
            const updatedPage = chapters.find(c => c.id === page.chapter_id)?.stitchedPages.find(p => p.stitch_id === page.stitch_id);
            if(updatedPage) {
                const topPanel = updatedPage.panels.find(p => p.coordinates[1] === originalPanel!.coordinates[1]);
                const bottomPanel = updatedPage.panels.find(p => p.coordinates[1] === splitY_norm);

                if (topPanel && bottomPanel) {
                    const [topBase64, bottomBase64] = await Promise.all([
                        cropPanelImage(page.stitchedImageBase64, page.stitchedImageMimeType, page.image_width, page.image_height, topPanel.coordinates),
                        cropPanelImage(page.stitchedImageBase64, page.stitchedImageMimeType, page.image_width, page.image_height, bottomPanel.coordinates)
                    ]);
                    setChapters(prev => prev.map(ch => ({
                        ...ch, stitchedPages: ch.stitchedPages.map(p => {
                            if (p.stitch_id !== pageId) return p;
                            return {...p, panels: p.panels.map(pnl => {
                                if (pnl.panel_id === topPanel.panel_id) return {...pnl, croppedImageBase64: topBase64};
                                if (pnl.panel_id === bottomPanel.panel_id) return {...pnl, croppedImageBase64: bottomBase64};
                                return pnl;
                            })}
                        })
                    })));
                }
            }
        }
    }, [setChapters, chapters]);

    const handleCropPanel = useCallback(async (pageId: string, panelId: string, cropY_norm: number, direction: 'top' | 'bottom') => {
        const clamped_cropY_norm = Math.max(0, Math.min(1, cropY_norm));
        let newCoords: CoordinatesArray | null = null;
        let pageForCropping: StitchedPageAnalysis | null = null;
        
        setChapters(prev => prev.map(ch => ({
            ...ch,
            stitchedPages: ch.stitchedPages.map(page => {
                if (page.stitch_id !== pageId) return page;
                pageForCropping = page;
                const newPanels = page.panels.map(panel => {
                    if (panel.panel_id !== panelId) return panel;
                    
                    const [x, y, w, h] = panel.coordinates;
                    if (direction === 'top') {
                        const originalBottom = y + h;
                        const newY = clamped_cropY_norm;
                        const newH = originalBottom - newY;
                        if (newH > 0.005) { newCoords = [x, newY, w, newH]; return { ...panel, coordinates: newCoords, croppedImageBase64: undefined }; }
                    } else { // 'bottom'
                        const newH = clamped_cropY_norm - y;
                        if (newH > 0.005) { newCoords = [x, y, w, newH]; return { ...panel, coordinates: newCoords, croppedImageBase64: undefined }; }
                    }
                    return panel;
                });
                return { ...page, panels: newPanels };
            })
        })), true);

        if (newCoords && pageForCropping) {
            const newBase64 = await cropPanelImage(pageForCropping.stitchedImageBase64, pageForCropping.stitchedImageMimeType, pageForCropping.image_width, pageForCropping.image_height, newCoords);
            setChapters(prev => prev.map(ch => ({
                ...ch, stitchedPages: ch.stitchedPages.map(p => {
                    if (p.stitch_id !== pageId) return p;
                    return {...p, panels: p.panels.map(pnl => pnl.panel_id === panelId ? {...pnl, croppedImageBase64: newBase64} : pnl)};
                })
            })));
        }
    }, [setChapters]);

    const handleDuplicatePanel = useCallback(async (chapterId: string, pageId: string, panelId: string) => {
        let pageForCropping: StitchedPageAnalysis | null = null;
        let duplicatedPanel: Panel | null = null;

        setChapters(prev => prev.map(ch => {
            if (ch.id !== chapterId) return ch;
            return {
                ...ch,
                stitchedPages: ch.stitchedPages.map(p => {
                    if (p.stitch_id !== pageId) return p;
                    pageForCropping = p;
                    const panelIndex = p.panels.findIndex(panelItem => panelItem.panel_id === panelId);
                    if (panelIndex === -1) return p;
                    
                    const panelToDuplicate = p.panels[panelIndex];
                    const newPanel: Panel = { ...panelToDuplicate, panel_id: `panel-${pageId}-${Date.now()}`, recap_texts: {}, audioInfos: {}, status: 'pending' };
                    duplicatedPanel = newPanel;

                    const newPanels = [...p.panels];
                    newPanels.splice(panelIndex + 1, 0, newPanel);

                    return { ...p, panels: newPanels.map((panelItem, i) => ({ ...panelItem, index: i })) };
                })
            };
        }), true);

        if (pageForCropping && duplicatedPanel) {
            const newBase64 = await cropPanelImage(pageForCropping.stitchedImageBase64, pageForCropping.stitchedImageMimeType, pageForCropping.image_width, pageForCropping.image_height, duplicatedPanel.coordinates);
            setChapters(prev => prev.map(ch => ({
                ...ch, stitchedPages: ch.stitchedPages.map(p => {
                    if (p.stitch_id !== pageId) return p;
                    return {...p, panels: p.panels.map(pnl => pnl.panel_id === duplicatedPanel!.panel_id ? {...pnl, croppedImageBase64: newBase64} : pnl)};
                })
            })));
        }
    }, [setChapters]);


    const selectedEditingData = useMemo(() => {
        if (!selectedPageId || !selectedPanelId) return null;
        for (const chapter of chapters) {
            const page = chapter.stitchedPages.find(p => p.stitch_id === selectedPageId);
            if (page) {
                const panel = page.panels.find(p => p.panel_id === selectedPanelId);
                if (panel) return { page, panel };
            }
        }
        return null;
    }, [chapters, selectedPageId, selectedPanelId]);
    
    const isAnyStoryGenerated = useMemo(() => chapters.some(c => c.stitchedPages.some(p => p.panels.some(panel => panel.recap_texts && Object.keys(panel.recap_texts).length > 0))), [chapters]);

    return (
        <div className="space-y-8">
            <div className="bg-gray-800/50 p-6 rounded-xl shadow-2xl space-y-6 border border-gray-700">
                <div className="flex justify-between items-center">
                    <div className="text-center">
                        <h2 className="text-2xl font-bold text-fuchsia-300">Project Configuration</h2>
                        <p className="text-sm text-gray-400">Set up the global parameters for your manga-to-video project.</p>
                    </div>
                    <ActionButton variant="secondary" onClick={() => setShowKeybindings(s => !s)}>
                        {showKeybindings ? 'Hide' : 'Show'} Keybindings
                    </ActionButton>
                </div>

                {showKeybindings && <KeybindingManager keybindings={keybindings} onKeybindingsChange={handleKeybindingsChange} />}
                
                {globalError && <ErrorDisplay message={globalError} />}
               
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                        <label htmlFor="file-upload" className="block text-lg font-semibold text-white mb-2">1. Upload Chapters</label>
                        <p className="text-xs text-gray-400 mb-3">Select the parent folder containing your chapter sub-folders.</p>
                        <input
                            type="file" id="file-upload" directory="" webkitdirectory="" onChange={handleFilesUpload}
                            className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-fuchsia-600 file:text-white hover:file:bg-fuchsia-700"
                            disabled={isProcessing}
                        />
                    </div>
                    <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700 space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-300">Content Type</label>
                            <div className="flex gap-4 mt-1">
                                <label className="flex items-center"><input type="radio" name="contentType" value="manhwa" checked={contentType === 'manhwa'} onChange={() => setContentType('manhwa')} className="form-radio text-fuchsia-500" disabled={isProcessing} /> <span className="ml-2">Manhwa (Vertical)</span></label>
                                <label className="flex items-center"><input type="radio" name="contentType" value="manga" checked={contentType === 'manga'} onChange={() => setContentType('manga')} className="form-radio text-fuchsia-500" disabled={isProcessing}/> <span className="ml-2">Manga (R-T-L)</span></label>
                            </div>
                        </div>
                        <div>
                            <label htmlFor="character-desc" className="block text-sm font-medium text-gray-300">Character Descriptions (Optional)</label>
                            <textarea id="character-desc" rows={2} value={characterDescriptions} onChange={e => setCharacterDescriptions(e.target.value)} className="w-full mt-1 p-2 bg-gray-700 border border-gray-600 rounded-lg text-sm" placeholder="e.g., Jinwoo: Main character, black hair." disabled={isProcessing}></textarea>
                        </div>
                    </div>
                </div>

                <div className="text-center border-t border-gray-700/80 pt-6 mt-6">
                    <h3 className="text-xl font-bold text-white mb-4">Global Batch Actions</h3>
                    <p className="text-xs text-gray-400 mb-4">Run the entire pipeline for all uploaded chapters with a single click.</p>
                    <div className="flex flex-wrap gap-4 justify-center">
                        <ActionButton onClick={handleDetectAllPanels} disabled={isProcessing || chapters.length === 0} isLoading={isProcessing && status.toLowerCase().includes('detecting')}>Detect All Panels</ActionButton>
                        <ActionButton onClick={handleGenerateAllStories} disabled={isProcessing || chapters.length === 0} isLoading={isProcessing && status.toLowerCase().includes('generating stories')}>Generate All Stories</ActionButton>
                        <ActionButton onClick={handleGenerateAllNarration} disabled={isProcessing || chapters.length === 0} isLoading={isProcessing && status.toLowerCase().includes('generating narration')}>Generate All Narrations</ActionButton>
                        <ActionButton onClick={handleExportAllPanels} disabled={isProcessing || !isAnyPanelCropped} variant="secondary">Export All Panels</ActionButton>
                    </div>
                    {isProcessing && <div className="mt-4 flex justify-center"><ActionButton onClick={handleStop} variant="danger">Stop Global Process</ActionButton></div>}
                </div>
                 {status && <p className="text-sm text-fuchsia-300 mt-2 text-center">{status}</p>}


            </div>

            <div className="space-y-8">
                {chapters.map((chapter) => (
                    <div key={chapter.id} className="bg-gray-800/50 p-4 sm:p-6 rounded-xl shadow-lg border border-gray-700">
                        <div className="flex justify-between items-start mb-4">
                           <h3 className="text-xl sm:text-2xl font-bold text-white">Chapter: {chapter.name}</h3>
                           <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                              chapter.status === 'processed' ? 'bg-green-500/20 text-green-300' : 'bg-fuchsia-500/20 text-fuchsia-300'
                          }`}>{chapter.status.charAt(0).toUpperCase() + chapter.status.slice(1)}</span>
                        </div>
                        
                        <div className="flex flex-wrap gap-4 mb-4 p-4 bg-gray-900/30 rounded-lg justify-center items-center">
                             <ActionButton onClick={() => handleDetectPanels(chapter.id)} disabled={isProcessing || chapter.status !== 'stitched'} isLoading={isProcessing && chapter.status === 'processing'}>
                                 {chapter.stitchedPages.some(p => p.panels.length > 0) ? 'Re-Detect Panels' : 'Detect Panels'}
                            </ActionButton>
                            <ActionButton onClick={() => handleGenerateStories(chapter.id)} disabled={isProcessing || !chapter.stitchedPages.some(p => p.panels.length > 0)}>
                                Generate Stories
                            </ActionButton>
                            <ActionButton onClick={() => handleGenerateNarrationForChapter(chapter.id)} disabled={isProcessing || !isAnyStoryGenerated}>
                                Generate Narration
                            </ActionButton>
                             <ActionButton 
                                onClick={() => handleExportPanels(chapter.id)} 
                                disabled={isProcessing || !chapter.stitchedPages.some(p => p.panels.some(panel => !!panel.croppedImageBase64))}
                                variant="secondary"
                            >
                                Export Panels
                            </ActionButton>
                            <div className="flex gap-2">
                                <ActionButton onClick={handleUndo} disabled={chaptersHistory.past.length === 0} variant="secondary" className="px-3 py-2 text-sm" title="Undo (Ctrl+Z)">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 2a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0V4.46A8 8 0 1017.5 12a.75.75 0 011.5 0A9.5 9.5 0 118.03 3.03a.75.75 0 011.06-1.06l.12.12A.75.75 0 0110 2z" clipRule="evenodd" /></svg>
                                </ActionButton>
                                <ActionButton onClick={handleRedo} disabled={chaptersHistory.future.length === 0} variant="secondary" className="px-3 py-2 text-sm" title="Redo (Ctrl+Y)">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a.75.75 0 01-.75-.75v-3.5a.75.75 0 011.5 0V15.54A8 8 0 102.5 8a.75.75 0 01-1.5 0A9.5 9.5 0 1111.97 16.97a.75.75 0 01-1.06 1.06l-.12-.12A.75.75 0 0110 18z" clipRule="evenodd" /></svg>
                                </ActionButton>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                            <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-2">
                                {chapter.stitchedPages.flatMap(p => p.panels).length > 0 ? (
                                    chapter.stitchedPages.map(page => (
                                        page.panels.length > 0 && (
                                            <div key={page.stitch_id}>
                                                <h5 className="text-md font-semibold text-fuchsia-300 mb-2 sticky top-0 bg-gray-800/80 backdrop-blur-sm py-1 z-10">{page.stitchedFileName}</h5>
                                                <div className="space-y-3">
                                                    {page.panels.map((panel, idx) => (
                                                        <div key={panel.panel_id} 
                                                            className={`bg-gray-800 p-2 rounded-lg border flex gap-3 cursor-pointer transition-all duration-200 ${selectedPanelId === panel.panel_id ? 'border-fuchsia-500 scale-102 shadow-lg' : 'border-gray-700 hover:border-fuchsia-700'}`}
                                                            onClick={() => { setSelectedPageId(page.stitch_id); setSelectedPanelId(panel.panel_id); }}
                                                        >
                                                            <div className="flex-shrink-0 w-24 text-center">
                                                                <p className="font-bold text-lg text-fuchsia-400">{panel.index + 1}</p>
                                                                {panel.croppedImageBase64 ? (
                                                                    <img src={panel.croppedImageBase64} alt={`Panel ${panel.index+1}`} className="w-full h-auto rounded-md mt-1 border border-gray-600"/>
                                                                ) : <div className="w-full h-24 bg-gray-700 flex items-center justify-center text-xs text-gray-500 rounded-md mt-1">Cropping...</div>}
                                                            </div>
                                                            <div className="flex-grow flex flex-col justify-between">
                                                                <p className="text-sm text-gray-300 flex-grow">{panel.recap_texts?.[selectedLanguage] || 'Story not generated...'}</p>
                                                                {panel.audioInfos[selectedLanguage] && (
                                                                    <div className="mt-2">
                                                                        {panel.audioInfos[selectedLanguage].error === 'generating' ? <LoadingSpinner size="w-5 h-5" /> :
                                                                        panel.audioInfos[selectedLanguage].error ? <p className="text-xs text-red-400">Error</p> :
                                                                        <audio controls src={panel.audioInfos[selectedLanguage].src} className="w-full h-8" />}
                                                                    </div>
                                                                )}
                                                            </div>
                                                             <div className="flex flex-col gap-2 flex-shrink-0">
                                                                <button onClick={(e) => { e.stopPropagation(); handleDuplicatePanel(chapter.id, page.stitch_id, panel.panel_id); }} title="Duplicate Panel" className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-600 rounded-md transition-colors"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M7 9a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H9a2 2 0 01-2-2V9z" /><path d="M5 3a2 2 0 00-2 2v6a2 2 0 002 2V5h6a2 2 0 00-2-2H5z" /></svg></button>
                                                                <button onClick={(e) => { e.stopPropagation(); handleDeletePanel(chapter.id, page.stitch_id, panel.panel_id); }} title="Delete Panel" className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-900/50 rounded-md transition-colors"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg></button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )
                                    ))
                                ) : (
                                    <div className="text-center text-gray-500 py-4">
                                        {chapter.stitchedPages.map(page => (
                                          <img key={page.stitch_id} src={page.stitchedImageBase64} alt={page.stitchedFileName} className="max-w-full mx-auto rounded-lg shadow-md border border-gray-700 mb-4" />
                                        ))}
                                        <p className="mt-2">No panels detected for this chapter yet.</p>
                                    </div>
                                )}
                            </div>
                            
                            <div className="sticky top-4 h-[calc(100vh-8rem)]">
                                {selectedEditingData && selectedEditingData.page.chapter_id === chapter.id ? (
                                    <PanelEditor 
                                        page={selectedEditingData.page}
                                        panel={selectedEditingData.panel}
                                        onSplit={handleSplitPanel}
                                        onCrop={handleCropPanel}
                                        keybindings={keybindings}
                                    />
                                ) : (
                                    <div className="flex items-center justify-center h-full bg-gray-900/50 rounded-lg border-2 border-dashed border-gray-700">
                                        <p className="text-gray-400 text-center">Select a panel from the left to edit it.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default MangaToVideoPanel;