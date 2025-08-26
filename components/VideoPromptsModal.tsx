
import React, { useState, useEffect } from 'react';
import ActionButton from './ActionButton';

interface VideoPromptsModalProps {
  isOpen: boolean;
  onClose: () => void;
  promptsText: string;
  title: string;
}

const VideoPromptsModal: React.FC<VideoPromptsModalProps> = ({ isOpen, onClose, promptsText, title }) => {
  const [copyStatus, setCopyStatus] = useState('Copy to Clipboard');

  // Reset copy button text when modal is opened with new content
  useEffect(() => {
    if (isOpen) {
      setCopyStatus('Copy to Clipboard');
    }
  }, [isOpen, promptsText]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(promptsText).then(() => {
      setCopyStatus('Copied!');
      setTimeout(() => setCopyStatus('Copy to Clipboard'), 2000);
    }).catch(() => {
      setCopyStatus('Failed to copy');
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4 transition-opacity duration-300"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-gray-600"
        onClick={e => e.stopPropagation()} // Prevent clicks inside from closing the modal
      >
        <header className="p-4 border-b border-gray-700 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-sky-300">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </header>
        <div className="p-4 overflow-y-auto flex-grow">
          <textarea
            readOnly
            className="w-full h-full min-h-[400px] p-3 bg-gray-900 border border-gray-600 rounded-lg text-gray-200 whitespace-pre-wrap focus:outline-none"
            value={promptsText}
            aria-label="Exported text content"
          />
        </div>
        <footer className="p-4 border-t border-gray-700 flex justify-end">
          <ActionButton onClick={handleCopy} variant="primary">
            {copyStatus}
          </ActionButton>
        </footer>
      </div>
    </div>
  );
};

export default VideoPromptsModal;
