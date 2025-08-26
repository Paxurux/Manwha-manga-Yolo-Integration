import React, { useState, useEffect, useRef } from 'react';
import { Scene } from '../types';
import ImageCard from './ImageCard';
import ActionButton from './ActionButton';
import LoadingSpinner from './LoadingSpinner';

interface SceneCardProps {
  scene: Scene;
  onUpdate: (sceneId: number, updatedFields: Partial<Scene>) => void;
  onRetry: (sceneId: number) => void;
  onRegeneratePrompt: (sceneId: number) => void;
  isGeneratingSinglePrompt: number | null;
  disabled?: boolean;
}

const SceneCard: React.FC<SceneCardProps> = ({ scene, onUpdate, disabled, onRetry, onRegeneratePrompt, isGeneratingSinglePrompt }) => {
  const [imagePrompt, setImagePrompt] = useState(scene.image_prompt || '');
  const [videoPrompt, setVideoPrompt] = useState(scene.video_prompt || '');
  const [copySuccess, setCopySuccess] = useState('');
  
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    setImagePrompt(scene.image_prompt || '');
    setVideoPrompt(scene.video_prompt || '');
  }, [scene.image_prompt, scene.video_prompt]);

  const handleImagePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newImagePrompt = e.target.value;
    setImagePrompt(newImagePrompt);
    onUpdate(scene.scene_id, { image_prompt: newImagePrompt });
  };
  
  const handleVideoPromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVideoPrompt = e.target.value;
    setVideoPrompt(newVideoPrompt);
    onUpdate(scene.scene_id, { video_prompt: newVideoPrompt });
  };
  
  const handleCopyVideoPrompt = () => {
    navigator.clipboard.writeText(videoPrompt).then(() => {
      setCopySuccess('Copied!');
      setTimeout(() => setCopySuccess(''), 2000);
    });
  };
  
  const playSceneAudio = () => {
      if(audioRef.current) {
          audioRef.current.play().catch(e => console.error("Audio playback error:", e));
      }
  };

  const isThisPromptLoading = isGeneratingSinglePrompt === scene.scene_id;
  const isThisAudioLoading = scene.audioInfo?.error === 'generating';
  const isThisLoading = isThisPromptLoading || isThisAudioLoading;

  const hasError = !!scene.error || !!scene.imageInfo?.error || (!!scene.audioInfo?.error && !isThisAudioLoading);
  const isComplete = scene.imageInfo && !scene.imageInfo.error && scene.audioInfo && !scene.audioInfo.error;

  const cardBorderColor = 
      isThisLoading ? 'border-yellow-500/80' :
      hasError ? 'border-red-600/80' :
      isComplete ? 'border-green-500/80' :
      'border-gray-700';
      
  const cardPulseAnimation = isThisLoading ? 'animate-pulse' : '';


  const renderAudioStatus = () => {
    if (!scene.audioInfo) {
      return <p className="text-xs text-gray-500">Audio: Pending</p>;
    }
    switch (scene.audioInfo.error) {
      case 'generating':
        return <p className="text-xs text-yellow-400 flex items-center gap-1"><LoadingSpinner size="w-3 h-3"/> Generating Audio...</p>;
      case undefined:
        return (
          <div className="flex items-center gap-2">
            <button onClick={playSceneAudio} className="text-green-400 hover:text-green-300 disabled:opacity-50" disabled={disabled}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
            </button>
            <p className="text-xs text-green-400">Audio Ready ({scene.audioInfo.duration.toFixed(1)}s)</p>
            <audio ref={audioRef} src={scene.audioInfo.src} preload="auto" />
          </div>
        );
      default:
        return <p className="text-xs text-red-400">Audio Failed: {scene.audioInfo.error}</p>;
    }
  };

  return (
    <div className={`bg-gray-800 rounded-lg shadow-xl overflow-hidden flex flex-col border-2 transition-colors duration-500 ${cardBorderColor} ${cardPulseAnimation}`}>
      <header className="p-4 bg-gray-900/50">
        <h4 className="font-bold text-fuchsia-300">
          Scene {scene.scene_id} <span className="font-normal text-gray-400">({scene.timestamp})</span>
        </h4>
        <p className="text-sm text-gray-300 italic mt-1">"{scene.script_text}"</p>
      </header>
      
      <div className="p-4 space-y-4">
        {scene.imageInfo && <ImageCard imageInfo={scene.imageInfo} />}

        {scene.imageInfo?.error && (
            <div className="bg-red-900/50 border border-red-700 text-red-200 px-3 py-2 rounded-md mt-2 space-y-2">
                <p className="font-bold text-sm">Image Generation Failed</p>
                <p className="text-xs break-words">{String(scene.imageInfo.error)}</p>
                <ActionButton onClick={() => onRetry(scene.scene_id)} variant='danger' disabled={disabled} className="w-full py-2 text-sm">
                    Retry Generation
                </ActionButton>
            </div>
        )}
        
        {scene.error && !scene.imageInfo && (
            <div className="bg-red-900 border border-red-700 text-red-100 px-3 py-2 rounded-md">
                <p className="font-bold text-sm">Prompt Generation Failed</p>
                <p className="text-xs">{scene.error}</p>
            </div>
        )}

        <div>
          <div className="flex justify-between items-center mb-1">
            <label htmlFor={`image-prompt-${scene.scene_id}`} className="block text-xs font-medium text-gray-400">
              Image Prompt (Editable)
            </label>
            <button
                onClick={() => onRegeneratePrompt(scene.scene_id)}
                className="text-fuchsia-400 hover:text-fuchsia-300 disabled:opacity-50 disabled:cursor-not-allowed p-1 rounded-full hover:bg-gray-700 transition-colors"
                title="Regenerate this prompt"
                disabled={disabled || isThisPromptLoading}
            >
              {isThisPromptLoading ? (
                  <LoadingSpinner size="w-4 h-4" />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M15.312 11.224a5.5 5.5 0 01-7.85-7.85l.078-.078a.75.75 0 011.06 1.06l-.077.078a4 4 0 005.658 5.657l.078-.078a.75.75 0 111.06 1.06l-.078.078zM9.53 4.155a.75.75 0 00-1.48.51l.043.435a6.002 6.002 0 00-.862 4.11L4.9 11.585a.75.75 0 00-1.061 1.06l2.33 2.33a.75.75 0 001.06 0l2.435-2.435a6 6 0 004.11-.862l.435.043a.75.75 0 00.51-1.48L12.502 9.53a4.5 4.5 0 01-3.178-3.178l1.19-1.19zM10 2a.75.75 0 01.75.75v.5a.75.75 0 01-1.5 0v-.5A.75.75 0 0110 2zM17.25 9.25a.75.75 0 01.75-.75h.5a.75.75 0 010 1.5h-.5a.75.75 0 01-.75-.75zM10 17a.75.75 0 01.75.75v.5a.75.75 0 01-1.5 0v-.5A.75.75 0 0110 17zM2.75 9.25a.75.75 0 01.75-.75h.5a.75.75 0 010 1.5h-.5a.75.75 0 01-.75-.75z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          </div>
          <textarea
            id={`image-prompt-${scene.scene_id}`}
            rows={3}
            value={imagePrompt}
            onChange={handleImagePromptChange}
            className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md text-gray-200 text-sm focus:ring-1 focus:ring-fuchsia-500"
            disabled={disabled || isThisPromptLoading}
            placeholder={!imagePrompt ? "Waiting for generation..." : ""}
          />
        </div>
        
        <div className="flex justify-between items-center bg-gray-700/50 p-2 rounded-md">
            {renderAudioStatus()}
        </div>

        <div>
          <div className="flex justify-between items-center mb-1">
            <label htmlFor={`video-prompt-${scene.scene_id}`} className="block text-xs font-medium text-gray-400">
              Video Motion Prompt (Editable)
            </label>
            <button
                onClick={handleCopyVideoPrompt}
                className="text-xs text-fuchsia-400 hover:text-fuchsia-300 disabled:opacity-50"
                disabled={disabled || !videoPrompt}
            >
                {copySuccess || 'Copy'}
            </button>
          </div>
          <textarea
            id={`video-prompt-${scene.scene_id}`}
            rows={2}
            value={videoPrompt}
            onChange={handleVideoPromptChange}
            className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md text-gray-200 text-sm focus:ring-1 focus:ring-fuchsia-500"
            disabled={disabled}
            placeholder={!videoPrompt ? "Waiting for generation..." : "e.g., Camera slowly zooms in..."}
          />
        </div>
      </div>
    </div>
  );
};

export default React.memo(SceneCard);