export interface ImageInfo {
  id: string;
  src: string;
  prompt: string; // The final prompt text used for generation
  error?: string;
}

export interface AudioInfo {
  src: string; // Blob URL
  duration: number;
  error?: string | 'generating';
}

export interface EditablePromptItem {
  id:string;
  text: string;
  individualStyle: string;
}

export interface Scene {
  scene_id: number;
  timestamp: string;
  script_text: string;
  image_prompt?: string;
  video_prompt?: string;
  imageInfo?: ImageInfo;
  audioInfo?: AudioInfo;
  error?: string; // To hold any error specific to this scene during batch processing
}


export interface MultilingualState {
  originalScript: string;
  stylePrompt: string;
  voice: string;
  speakingRate: number;
  pitch: number;
  volumeGainDb: number;
  selectedLanguages: string[];
  // Store translated scripts to avoid re-translating
  translatedScripts: { [langCode: string]: string }; // langCode -> jsonString of translated segments
  // Store final combined dubbed audio as base64 strings
  finalDubbedAudio: { [langCode:string]: string }; // langCode -> base64 WAV data
  // Store any errors that occurred during processing
  errors: { [langCode: string]: string };
}


// New type for import/export
export interface WorkflowState {
  version: number;
  scriptForStoryboard: string;
  imageStyle: string;
  characterDescriptions: string;
  aspectRatio: string;
  numberOfImages: string;
  scenes: Scene[] | null;
  multilingual?: MultilingualState;
  narrationVoice?: string;
  ttsSpeakingRate?: number;
  ttsPitch?: number;
  ttsVolumeGain?: number;
}


// --- NEW Manga Production Schema Types ---

export type CoordinatesArray = [number, number, number, number]; // [x, y, w, h]

export interface TextBubble {
  text: string;
  bbox_norm: CoordinatesArray;
}

export interface PanelFlags {
  is_promotional?: boolean;
  text_heavy?: boolean;
  face_cut_risk?: boolean;
}

export interface Panel {
  panel_id: string;
  index: number;
  coordinates: CoordinatesArray; // Normalized [x, y, w, h]
  coords_px?: [number, number, number, number]; // Absolute pixels, filled client-side
  recap_texts?: { [langCode: string]: string };
  narration?: string; // The primary, most refined narrative text.
  confidence: number;
  
  // Optional fields from the schema
  narration_tone?: string;
  recommended_duration_s?: number;
  character_anchors?: string[];
  text_bubbles?: TextBubble[];
  flags?: PanelFlags;
  warnings?: string[];
  key_action_description?: string;
  dialogue_summary?: string;

  // Client-side additions for UI state
  croppedImageBase64?: string;
  audioInfos: { [langCode: string]: AudioInfo };
  status: 'pending' | 'summarizing' | 'narrating' | 'complete' | 'error' | 'skipped';
  error?: string;
}

export interface FaceSummary {
    face_anchor: string;
    bbox_norm: CoordinatesArray;
    face_description?: string;
    confidence?: number;
}

export interface StitchedPageAnalysis {
    // Top-level properties from schema, returned by AI
    chapter_id: string; 
    stitch_hash: string;
    pages_in_stitch: number;
    image_width: number;
    image_height: number;
    reading_direction: 'vertical' | 'ltr' | 'rtl';
    panels: Panel[];
    face_summary?: FaceSummary[];
    
    // Client-side properties for management
    stitch_id: string; // Unique ID for client-side state
    stitchedImageBase64: string;
    stitchedImageMimeType: string;
    stitchedFileName: string;
}


// --- Dubbing Studio Types ---

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface DubbingSegment extends Segment {
  id: string; // e.g., `${langCode}-${segmentIndex}`
  status: 'pending' | 'processing' | 'adjusting' | 'completed' | 'failed';
  error?: string;
  speedAdjustment?: number;
}

export interface DubbingJob {
  id: string; // langCode
  langCode: string;
  langName: string;
  status: 'pending' | 'translating' | 'translated' | 'dubbing' | 'combining' | 'completed' | 'failed';
  segments: DubbingSegment[];
  translatedScript?: string;
  finalAudioUrl?: string;
  error?: string;
  progress: { current: number; total: number };
}

// --- NEW: Keybinding Types ---
export interface Keybinding {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export type ActionName = 'splitPanel' | 'cropTop' | 'cropBottom' | 'deletePanel' | 'undo' | 'redo' | 'nextPanel' | 'previousPanel';

export type ActionKeybindings = {
  [key in ActionName]: Keybinding[];
};


// Declaration for CDN libraries
declare global {
  const JSZip: any; // Or more specific type if known: typeof import('jszip')
  const saveAs: any; // Or more specific type if known: typeof import('file-saver').saveAs

  namespace React {
    interface InputHTMLAttributes<T> {
      directory?: string;
      webkitdirectory?: string;
    }
  }
}

// This ensures the file is treated as a module.
export {};