import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Scene } from '../types';
import ActionButton from './ActionButton';
import LoadingSpinner from './LoadingSpinner';

interface VideoPreviewerProps {
  scenes: Scene[];
}

const VideoPreviewer: React.FC<VideoPreviewerProps> = ({ scenes }) => {
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const playableScenes = scenes.filter(s => s.imageInfo && !s.imageInfo.error && s.audioInfo && !s.audioInfo.error);

  const currentScene = playableScenes[currentSceneIndex];

  // Effect to handle scene transitions and audio loading
  useEffect(() => {
    if (currentScene && audioRef.current) {
      audioRef.current.src = currentScene.audioInfo!.src;
      if (isPlaying) {
        audioRef.current.play().catch(e => console.error("Autoplay failed:", e));
      }
    }
  }, [currentScene, isPlaying]);

  // Audio event listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleEnded = () => {
      if (currentSceneIndex < playableScenes.length - 1) {
        setCurrentSceneIndex(prev => prev + 1);
      } else {
        setIsPlaying(false);
        setCurrentSceneIndex(0);
        setProgress(0);
      }
    };
    
    const handleTimeUpdate = () => {
        const currentProgress = (audio.currentTime / audio.duration) * 100;
        const totalProgress = ((currentSceneIndex * 100) + currentProgress) / playableScenes.length;
        setProgress(totalProgress);
    };

    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    return () => {
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [currentSceneIndex, playableScenes.length]);

  const handlePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(e => console.error("Play failed:", e));
    }
    setIsPlaying(!isPlaying);
  };
  
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTotalProgress = Number(e.target.value);
    const sceneIndex = Math.floor(newTotalProgress * playableScenes.length / 100);
    
    if(sceneIndex < playableScenes.length) {
        const sceneProgress = (newTotalProgress * playableScenes.length / 100) - sceneIndex;
        const newTime = sceneProgress * (playableScenes[sceneIndex].audioInfo?.duration || 0);

        setCurrentSceneIndex(sceneIndex);
        if(audioRef.current) {
            audioRef.current.currentTime = newTime;
        }
        setProgress(newTotalProgress);
    }
  };

  if (playableScenes.length === 0) {
    return null;
  }

  return (
    <div className="bg-gray-900/70 p-4 md:p-6 rounded-xl border border-gray-700 shadow-2xl space-y-4">
      <h3 className="text-2xl font-semibold text-fuchsia-300 text-center">Storyboard Video Preview</h3>
      
      <div className="aspect-video bg-black rounded-lg flex items-center justify-center overflow-hidden relative">
        {currentScene?.imageInfo?.src ? (
          <img src={currentScene.imageInfo.src} alt={`Scene ${currentScene.scene_id}`} className="w-full h-full object-contain" />
        ) : (
          <div className="text-gray-500">Image not available</div>
        )}
         <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-2 md:p-4 text-center">
            <p className="text-sm md:text-base text-white italic">
                "{currentScene?.script_text || 'Loading script...'}"
            </p>
        </div>
      </div>
      
      <div className="space-y-3">
        <div className="w-full">
          <input
            type="range"
            min="0"
            max="100"
            value={progress}
            onChange={handleSeek}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-lg [&::-webkit-slider-thumb]:bg-fuchsia-500"
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <ActionButton onClick={handlePlayPause} variant="primary" className="px-4 py-2">
            {isPlaying ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 00-1 1v2a1 1 0 102 0V9a1 1 0 00-1-1zm5 0a1 1 0 00-1 1v2a1 1 0 102 0V9a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
            )}
            <span className="ml-2">{isPlaying ? 'Pause' : 'Play'}</span>
          </ActionButton>
          <div className="text-sm font-medium text-gray-300">
            Scene: <span className="font-bold text-fuchsia-400">{currentSceneIndex + 1}</span> / {playableScenes.length}
          </div>
          <audio ref={audioRef} />
        </div>
      </div>
    </div>
  );
};

export default VideoPreviewer;