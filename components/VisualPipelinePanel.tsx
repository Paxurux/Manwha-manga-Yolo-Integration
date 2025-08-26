import React, { useState } from 'react';
import { Scene } from '../types';
import ActionButton from './ActionButton';
import SceneCard from './SceneCard';
import VideoPromptsModal from './VideoPromptsModal';
import VideoPreviewer from './VideoPreviewer';

interface VisualPipelinePanelProps {
  scenes: Scene[];
  onUpdateScene: (sceneId: number, updatedFields: Partial<Scene>) => void;
  onGeneratePrompts: () => void;
  onGenerateImages: () => void;
  onGenerateNarration: () => void;
  onDownloadAll: () => void;
  isGeneratingPrompts: boolean;
  isGeneratingImages: boolean;
  isGeneratingNarration: boolean;
  disabled?: boolean;
  isPaused: boolean;
  setIsPaused: (paused: boolean) => void;
  onRetryAllFailed: () => void;
  onRetrySingleImage: (sceneId: number) => void;
  onRegeneratePrompt: (sceneId: number) => void;
  isGeneratingSinglePrompt: number | null;
}

const VisualPipelinePanel: React.FC<VisualPipelinePanelProps> = ({
  scenes, onUpdateScene, onGeneratePrompts, onGenerateImages, onGenerateNarration, onDownloadAll,
  isGeneratingPrompts, isGeneratingImages, isGeneratingNarration, disabled,
  isPaused, setIsPaused, onRetryAllFailed, onRetrySingleImage, onRegeneratePrompt, isGeneratingSinglePrompt,
}) => {
  const [isPromptsModalOpen, setIsPromptsModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState({ title: '', text: '' });
  
  if (!scenes || scenes.length === 0) return null;

  const successfulImages = scenes.filter(s => s.imageInfo && !s.imageInfo.error);
  const successfulAudio = scenes.filter(s => s.audioInfo && !s.audioInfo.error);
  
  const promptsAreGenerated = scenes.every(s => s.image_prompt || s.error);
  const imagesAreGenerated = scenes.every(s => (s.imageInfo && !s.imageInfo.error) || s.error);
  const narrationIsGenerated = scenes.every(s => (s.audioInfo && !s.audioInfo.error) || s.error);

  const isGenerating = isGeneratingPrompts || isGeneratingImages || isGeneratingNarration;
  const failedImagesCount = scenes.filter(s => s.imageInfo?.error).length;
  const pendingImagesCount = scenes.filter(s => s.image_prompt && (!s.imageInfo || s.imageInfo.error)).length;
  const pendingNarrationCount = scenes.filter(s => s.script_text && (!s.audioInfo || s.audioInfo.error)).length;
  
  const canPreview = successfulImages.length > 0 && successfulAudio.length > 0 && successfulImages.length === successfulAudio.length;

  const handleExportVideoPrompts = () => {
    const formattedPrompts = scenes.map(s => `SCENE ${s.scene_id} (${s.timestamp})\n${s.video_prompt || '(Not generated)'}`).join('\n\n---\n\n');
    setModalContent({ title: 'All Video Motion Prompts', text: formattedPrompts });
    setIsPromptsModalOpen(true);
  };
  
  const handleExportImagePrompts = () => {
    const formattedPrompts = scenes.map(s => `SCENE ${s.scene_id} (${s.timestamp})\n${s.image_prompt || '(Not generated)'}`).join('\n\n---\n\n');
    setModalContent({ title: 'All Image Prompts', text: formattedPrompts });
    setIsPromptsModalOpen(true);
  };

  const renderActionButtons = () => {
    if (isGenerating) {
      return (
        <>
          <ActionButton onClick={() => setIsPaused(false)} variant="primary" disabled={!isPaused}>Resume</ActionButton>
          <ActionButton onClick={() => setIsPaused(true)} variant="secondary" disabled={isPaused}>Pause</ActionButton>
        </>
      );
    }

    if (!promptsAreGenerated) {
      return <ActionButton onClick={onGeneratePrompts} disabled={disabled}>Generate All Prompts</ActionButton>;
    }
    if (!imagesAreGenerated) {
      return <ActionButton onClick={onGenerateImages} disabled={disabled || pendingImagesCount === 0}>
        {pendingImagesCount > 0 ? `Generate ${pendingImagesCount} Image(s)` : 'All Images Generated'}
      </ActionButton>;
    }
    if (!narrationIsGenerated) {
      return <ActionButton onClick={onGenerateNarration} disabled={disabled || pendingNarrationCount === 0}>
        {pendingNarrationCount > 0 ? `Generate ${pendingNarrationCount} Narration(s)` : 'All Narration Generated'}
      </ActionButton>;
    }
    
    return <p className="text-green-400 font-semibold">✅ Pipeline Complete!</p>
  };

  return (
    <div className="mt-8 space-y-8">
      {canPreview && <VideoPreviewer scenes={scenes} />}

      <div className="p-4 bg-gray-900/70 rounded-lg border border-gray-700">
        <h3 className="text-xl font-semibold text-gray-100 mb-2">Visual & Audio Pipeline</h3>
        <p className="text-sm text-gray-400 mb-4">
          Follow the steps to generate prompts, images, and narration for your storyboard. You can edit prompts before generating images.
        </p>
        <div className="flex flex-col sm:flex-row justify-center items-center flex-wrap gap-4 bg-gray-800/50 p-4 rounded-lg">
          {renderActionButtons()}
           {failedImagesCount > 0 && !isGenerating && (
              <ActionButton onClick={onRetryAllFailed} variant="danger">Retry {failedImagesCount} Failed Image(s)</ActionButton>
           )}
        </div>
      </div>
      
      <div className="flex justify-between items-center mt-6 border-b border-gray-700 pb-2">
        <h3 className="text-2xl font-semibold">Scene Details</h3>
        <div className="flex flex-wrap gap-2">
            <ActionButton onClick={onDownloadAll} disabled={disabled || successfulImages.length === 0} variant="secondary" className="text-sm py-2 px-3">
              Download Images ({successfulImages.length})
            </ActionButton>
             <ActionButton onClick={handleExportImagePrompts} disabled={disabled || scenes.length === 0} variant="secondary" className="text-sm py-2 px-3">
              Export Image Prompts
            </ActionButton>
            <ActionButton onClick={handleExportVideoPrompts} disabled={disabled || scenes.length === 0} variant="secondary" className="text-sm py-2 px-3">
              Export Video Prompts
            </ActionButton>
        </div>
      </div>


      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {scenes.map(scene => (
          <SceneCard
            key={scene.scene_id}
            scene={scene}
            onUpdate={onUpdateScene}
            onRetry={onRetrySingleImage}
            onRegeneratePrompt={onRegeneratePrompt}
            isGeneratingSinglePrompt={isGeneratingSinglePrompt}
            disabled={disabled}
          />
        ))}
      </div>
      
      <VideoPromptsModal
        isOpen={isPromptsModalOpen}
        onClose={() => setIsPromptsModalOpen(false)}
        title={modalContent.title}
        promptsText={modalContent.text}
      />
    </div>
  );
};

export default VisualPipelinePanel;