import React, { useState, useEffect, useCallback, useRef } from 'react';
import ActionButton from './ActionButton';
import LoadingSpinner from './LoadingSpinner';

interface AudioPlayerProps {
  base64Audio: string;
  isLoading: boolean;
  filename?: string;
}

/**
 * Writes a string character by character into a DataView at a specific offset.
 * This is a utility function used for building the WAV file header.
 */
function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Converts raw 16-bit PCM audio data into a complete, playable WAV file Blob.
 * The Gemini TTS API returns raw, headerless audio data. This function constructs
 * the required 44-byte header and prepends it to the raw audio data.
 * @param pcmData The raw PCM audio data, received as a Uint8Array.
 * @returns A Blob object representing the full WAV file, ready for playback or download.
 */
function pcmToWavBlob(pcmData: Uint8Array): Blob {
  const sampleRate = 24000; // The fixed sample rate for Gemini TTS models.
  const numChannels = 1;    // The audio is always mono.
  const bitsPerSample = 16; // The audio is 16-bit Pulse Code Modulation (PCM).
  
  const dataSize = pcmData.length;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const chunkSize = 36 + dataSize;
  
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF Chunk Descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, chunkSize, true);
  writeString(view, 8, 'WAVE');

  // "fmt " Sub-Chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // 1 = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // "data" Sub-Chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Append PCM data
  new Uint8Array(buffer, 44).set(pcmData);

  return new Blob([view], { type: 'audio/wav' });
}


const AudioPlayer: React.FC<AudioPlayerProps> = ({ base64Audio, isLoading, filename = 'generated_audio.wav' }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string>('');
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    // Initialize AudioContext on mount
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContext) {
      audioContextRef.current = new AudioContext({ sampleRate: 24000 });
    }
    return () => {
      sourceNodeRef.current?.stop();
      audioContextRef.current?.close().catch(console.error);
    };
  }, []);

  useEffect(() => {
    // Process new audio data
    sourceNodeRef.current?.stop();
    setIsPlaying(false);
    setAudioBuffer(null);
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl('');

    if (!base64Audio || !audioContextRef.current) return;

    try {
      const binaryString = atob(base64Audio);
      const pcmData = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) pcmData[i] = binaryString.charCodeAt(i);
      
      const wavBlob = pcmToWavBlob(pcmData);
      setDownloadUrl(URL.createObjectURL(wavBlob));
      
      wavBlob.arrayBuffer().then(arrayBuffer => {
        audioContextRef.current?.decodeAudioData(arrayBuffer)
          .then(buffer => setAudioBuffer(buffer))
          .catch(e => console.error("Error decoding audio data:", e));
      });

    } catch (error) {
      console.error("Failed to process base64 audio string:", error);
    }
  }, [base64Audio]);

  const handlePlayStop = useCallback(async () => {
    const audioContext = audioContextRef.current;
    if (!audioContext || !audioBuffer) return;

    if (isPlaying) {
      sourceNodeRef.current?.stop();
      setIsPlaying(false);
    } else {
      if (audioContext.state === 'suspended') await audioContext.resume();
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.onended = () => {
        setIsPlaying(false);
        sourceNodeRef.current = null;
      };
      source.start();
      sourceNodeRef.current = source;
      setIsPlaying(true);
    }
  }, [isPlaying, audioBuffer]);

  if (isLoading) {
    return (
        <div className="w-full min-h-[150px] flex flex-col items-center justify-center bg-gray-800 p-4 rounded-lg">
            <LoadingSpinner />
            <p className="text-sky-300 text-sm text-center mt-3">Generating audio...</p>
        </div>
    );
  }

  if (!audioBuffer) {
    return (
      <div className="w-full min-h-[150px] flex flex-col items-center justify-center bg-gray-800 p-4 rounded-lg">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
        </svg>
        <p className="text-gray-400 text-sm text-center">Audio will appear here after generation.</p>
      </div>
    );
  }

  return (
    <div className="w-full bg-gray-800 p-4 rounded-lg space-y-4">
       <div className="flex items-center gap-4">
            <ActionButton onClick={handlePlayStop} disabled={!audioBuffer || isLoading} className="px-4 py-2 w-28">
                <div className="flex items-center justify-center">
                    {isPlaying ? (
                        <>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1zm4 0a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                            Stop
                        </>
                    ) : (
                        <>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                            Play
                        </>
                    )}
                </div>
            </ActionButton>
            <span className="text-sm text-gray-400">Ready to play generated audio.</span>
       </div>
       <a
         href={downloadUrl}
         download={filename}
         className={`w-full block text-center px-6 py-3 font-semibold rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-opacity-75 transition-all duration-150 ease-in-out flex items-center justify-center ${!downloadUrl ? 'opacity-60 cursor-not-allowed bg-gray-700 text-gray-400' : 'bg-gray-600 hover:bg-gray-700 text-gray-100 focus:ring-gray-500'}`}
         aria-disabled={!downloadUrl}
       >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
        Download .wav
      </a>
    </div>
  );
};

export default AudioPlayer;
