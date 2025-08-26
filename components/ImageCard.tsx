

import React from 'react';
import { ImageInfo } from '../types'; // Ensure correct path

interface ImageCardProps {
  imageInfo: ImageInfo;
}

const ImageCard: React.FC<ImageCardProps> = ({ imageInfo }) => {
  const handleDownload = () => {
    if (imageInfo.error || !imageInfo.src.startsWith('data:image')) return; 
    const link = document.createElement('a');
    link.href = imageInfo.src;
    const baseFilename = imageInfo.prompt;
    link.download = `generated_image_${baseFilename.substring(0,25).replace(/\s+/g, '_') || imageInfo.id}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const displayPrompt = imageInfo.prompt;
  const fullGeneratedPrompt = null;


  return (
    <div className="bg-gray-800 rounded-lg shadow-xl overflow-hidden flex flex-col">
      <div className="w-full overflow-hidden"> 
        {imageInfo.error ? (
           <div className="w-full min-h-[200px] h-48 flex flex-col items-center justify-center bg-gray-700 p-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-red-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-red-300 text-sm text-center">Generation Failed</p>
            {/* Detailed error and retry button are now handled by SceneCard */}
          </div>
        ) : (
          <img 
            src={imageInfo.src} 
            alt={displayPrompt} 
            className="w-full h-auto object-contain max-h-[400px]" 
            style={{ backgroundColor: '#374151' }} 
          />
        )}
      </div>
      <div className="p-4 flex flex-col flex-grow">
        <p className="text-xs text-gray-400 mb-1 break-words">
          <span className="font-semibold text-gray-300">Visual:</span> {displayPrompt}
        </p>
        {fullGeneratedPrompt && (
             <p className="text-xs text-gray-500 mb-2 break-words">
                <span className="font-semibold text-gray-400">Full Prompt:</span> {fullGeneratedPrompt.length > 150 ? fullGeneratedPrompt.substring(0,150) + "..." : fullGeneratedPrompt}
            </p>
        )}

        {!imageInfo.error && imageInfo.src.startsWith('data:image') && (
           <button
            onClick={handleDownload}
            className="mt-auto w-full bg-sky-600 hover:bg-sky-700 text-white text-sm py-2 px-3 rounded-md transition-colors flex items-center justify-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download
          </button>
        )}
      </div>
    </div>
  );
};

export default ImageCard;