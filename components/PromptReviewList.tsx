
import React from 'react';
import { EditablePromptItem } from '../types';
import ActionButton from './ActionButton';

interface PromptReviewItemCardProps {
  item: EditablePromptItem;
  onUpdate: (id: string, newText: string, newStyle: string) => void;
  disabled?: boolean;
}

const PromptReviewItemCard: React.FC<PromptReviewItemCardProps> = ({ item, onUpdate, disabled }) => {
  const [text, setText] = React.useState(item.text);
  const [style, setStyle] = React.useState(item.individualStyle);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    onUpdate(item.id, e.target.value, style);
  };

  const handleStyleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setStyle(e.target.value);
    onUpdate(item.id, text, e.target.value);
  };
  
  // Update local state if prop changes (e.g. from an external reset)
  React.useEffect(() => {
    setText(item.text);
    setStyle(item.individualStyle);
  }, [item.text, item.individualStyle]);


  return (
    <div className="bg-gray-750 p-4 rounded-lg shadow space-y-3 border border-gray-700">
      <div>
        <label htmlFor={`prompt-text-${item.id}`} className="block text-xs font-medium text-gray-400 mb-1">
          Visual Prompt (Editable)
        </label>
        <textarea
          id={`prompt-text-${item.id}`}
          rows={3}
          value={text}
          onChange={handleTextChange}
          className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md text-gray-200 text-sm focus:ring-1 focus:ring-sky-500 focus:border-sky-500"
          disabled={disabled}
        />
      </div>
      <div>
        <label htmlFor={`prompt-style-${item.id}`} className="block text-xs font-medium text-gray-400 mb-1">
          Additional Style for THIS Image (Optional)
        </label>
        <input
          type="text"
          id={`prompt-style-${item.id}`}
          value={style}
          onChange={handleStyleChange}
          className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md text-gray-200 text-sm focus:ring-1 focus:ring-sky-500 focus:border-sky-500"
          placeholder="e.g., close-up, cinematic lighting, line art"
          disabled={disabled}
        />
      </div>
    </div>
  );
};


interface PromptReviewListProps {
  prompts: EditablePromptItem[];
  onUpdatePrompt: (id: string, newText: string, newStyle: string) => void;
  onGenerateImages: () => void;
  isGeneratingImages: boolean;
  disabled?: boolean; // Disables all interactions on cards and button
}

const PromptReviewList: React.FC<PromptReviewListProps> = ({
  prompts,
  onUpdatePrompt,
  onGenerateImages,
  isGeneratingImages,
  disabled
}) => {
  if (!prompts || prompts.length === 0) {
    return <p className="text-center text-gray-500 mt-6">No prompts to review.</p>;
  }

  return (
    <div className="mt-8 space-y-6">
      <div>
        <h3 className="text-xl font-semibold text-gray-100 mb-1">Review & Refine Visual Prompts</h3>
        <p className="text-sm text-gray-400 mb-4">Edit the AI-generated prompts below and add specific styles for each image before final generation. Global style (if set above) will also apply.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {prompts.map(item => (
          <PromptReviewItemCard 
            key={item.id} 
            item={item} 
            onUpdate={onUpdatePrompt}
            disabled={disabled || isGeneratingImages}
          />
        ))}
      </div>
      <div className="mt-6 flex justify-center">
        <ActionButton
          onClick={onGenerateImages}
          isLoading={isGeneratingImages}
          disabled={disabled || isGeneratingImages || prompts.length === 0}
          className="min-w-[200px]"
        >
          {isGeneratingImages ? 'Generating Images...' : `Generate ${prompts.length} Image(s)`}
        </ActionButton>
      </div>
    </div>
  );
};

export default PromptReviewList;
