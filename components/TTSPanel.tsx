import React from 'react';
import ActionButton from './ActionButton';
import AudioPlayer from './AudioPlayer';
import { TTS_VOICES } from '../services/ttsConstants';
import SpeechParameterSlider from './SpeechParameterSlider';

interface TTSPanelProps {
  script: string;
  onScriptChange: (value: string) => void;
  singleSpeakerVoice: string;
  onSingleSpeakerVoiceChange: (voice: string) => void;
  speakingRate: number;
  onSpeakingRateChange: (rate: number) => void;
  pitch: number;
  onPitchChange: (pitch: number) => void;
  volumeGain: number;
  onVolumeGainChange: (gain: number) => void;
  generatedAudio: string;
  onGenerate: () => void;
  isLoading: boolean;
  disabled: boolean;
  isGlobal?: boolean;
}

const TTSPanel: React.FC<TTSPanelProps> = ({
  script, onScriptChange, singleSpeakerVoice, onSingleSpeakerVoiceChange,
  speakingRate, onSpeakingRateChange, pitch, onPitchChange, volumeGain, onVolumeGainChange,
  generatedAudio, onGenerate, isLoading, disabled, isGlobal = true
}) => {
  const isGenerateDisabled = disabled || isLoading || !script.trim();

  return (
    <div className="space-y-6">
      <div className={`grid grid-cols-1 ${isGlobal ? 'md:grid-cols-2' : ''} gap-8 items-start`}>
        <div className="space-y-6">
          {isGlobal && (
            <div>
              <label htmlFor="tts-script" className="block text-sm font-medium text-gray-300 mb-1">
                Script for TTS
              </label>
              <textarea
                id="tts-script"
                rows={12}
                className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-gray-200 focus:ring-2 focus:ring-fuchsia-500"
                placeholder="Enter the script to be converted to speech..."
                value={script}
                onChange={(e) => onScriptChange(e.target.value)}
                disabled={disabled || isLoading}
              />
               <p className="mt-1 text-xs text-gray-500">The AI will generate audio based on this script. Use **bold** or *italic* markdown for emphasis.</p>
            </div>
          )}

          <div className="bg-gray-900/70 p-4 rounded-lg space-y-4">
              <div>
                <label htmlFor="tts-voice" className="block text-sm font-medium text-gray-300 mb-1">
                  {isGlobal ? 'Voice' : 'Narration Voice for Pipeline'}
                </label>
                <select
                  id="tts-voice"
                  className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-gray-200 focus:ring-2 focus:ring-fuchsia-500"
                  value={singleSpeakerVoice}
                  onChange={(e) => onSingleSpeakerVoiceChange(e.target.value)}
                  disabled={disabled || isLoading}
                >
                  {TTS_VOICES.map(voice => (
                    <option key={voice.name} value={voice.name}>
                      {voice.name} ({voice.description})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  {isGlobal 
                      ? "Select a voice for the simple TTS generator." 
                      : "This voice will be used for the 'Generate Narration' step in the pipeline."}
                 </p>
              </div>

              <SpeechParameterSlider label="Speaking Rate" value={speakingRate} onChange={onSpeakingRateChange} min={0.25} max={4.0} step={0.01} disabled={disabled || isLoading} />
              <SpeechParameterSlider label="Pitch" value={pitch} onChange={onPitchChange} min={-20.0} max={20.0} step={0.1} disabled={disabled || isLoading} />
              <SpeechParameterSlider label="Volume Gain (dB)" value={volumeGain} onChange={onVolumeGainChange} min={-96.0} max={16.0} step={0.5} disabled={disabled || isLoading} />
            </div>
        </div>

        {isGlobal && (
            <div className="space-y-4">
              <label className="block text-sm font-medium text-gray-300">Generated Audio</label>
              <AudioPlayer base64Audio={generatedAudio} isLoading={isLoading} />
            </div>
        )}
      </div>

      {isGlobal && (
          <div className="flex justify-center mt-6">
            <ActionButton onClick={onGenerate} isLoading={isLoading} disabled={isGenerateDisabled} className="min-w-[200px]">
              Generate Audio
            </ActionButton>
          </div>
      )}
    </div>
  );
};

export default TTSPanel;