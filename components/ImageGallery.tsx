import React from 'react';
import { ImageInfo } from '../types'; // Ensure correct path
import ImageCard from './ImageCard';
import ActionButton from './ActionButton';

// For CDN libraries, ensure they are loaded in index.html
// declare var JSZip: any;
// declare var saveAs: any;

interface ImageGalleryProps {
  images: ImageInfo[];
  onDownloadAll: () => void;
  isGenerating: boolean; // To disable download all button during overall generation
}

const ImageGallery: React.FC<ImageGalleryProps> = ({ images, onDownloadAll, isGenerating }) => {
  if (images.length === 0 && !isGenerating) { // Check isGenerating to avoid message flash
    return <p className="text-center text-gray-500 mt-8">No images generated yet. Enter a script and style, then click "Generate Storyboard".</p>;
  }
  
  const successfulImages = images.filter(img => !img.error && img.src.startsWith('data:image'));

  return (
    <div className="mt-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-semibold text-gray-100">Generated Images</h2>
        {successfulImages.length > 0 && (
          <ActionButton onClick={onDownloadAll} disabled={isGenerating || successfulImages.length === 0} variant="secondary">
             <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
             </svg>
            Download All ({successfulImages.length})
          </ActionButton>
        )}
      </div>
      {images.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {images.map((imageInfo) => (
            <ImageCard key={imageInfo.id} imageInfo={imageInfo} />
          ))}
        </div>
      )}
    </div>
  );
};

export default ImageGallery;
