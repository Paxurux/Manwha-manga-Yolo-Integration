
import React, { useState, useEffect } from 'react';

interface StyleInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const predefinedStyles = [
  "Default (Cinematic & Realistic)",
  "Vintage Comic Book Art",
  "Dark Fantasy Oil Painting",
  "Ghibli-Inspired Anime",
  "Pixar-Style 3D Render",
  "Cyberpunk Neon Noir",
  "Watercolor Sketch",
  "Line Art Drawing",
  "Other (Specify below)"
];

const StyleInput: React.FC<StyleInputProps> = ({ value, onChange, disabled }) => {
  const isPredefined = predefinedStyles.includes(value);
  const [showCustom, setShowCustom] = useState(!isPredefined && value !== '');
  const [selectValue, setSelectValue] = useState(isPredefined ? value : "Other (Specify below)");

  // Sync component with external state changes (e.g., from workflow import)
  useEffect(() => {
    const isPredefined = predefinedStyles.includes(value) || value === "Cinematic, realistic, 8k resolution, film grain";
    const customValueExists = !isPredefined && value !== '';
    
    setShowCustom(customValueExists);
    
    if (customValueExists) {
        setSelectValue("Other (Specify below)");
    } else if (value === "Cinematic, realistic, 8k resolution, film grain") {
        setSelectValue("Default (Cinematic & Realistic)");
    }
     else {
        setSelectValue(value || "Default (Cinematic & Realistic)");
    }
  }, [value]);

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = e.target.value;
    setSelectValue(selected);
    if (selected === "Other (Specify below)") {
      setShowCustom(true);
      onChange(''); // Clear the value so user must type something
    } else {
      setShowCustom(false);
      // Map "Default" to a more descriptive prompt for the AI
      const valueToSet = selected === "Default (Cinematic & Realistic)" 
        ? "Cinematic, realistic, 8k resolution, film grain" 
        : selected;
      onChange(valueToSet);
    }
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  return (
    <div className="w-full space-y-2">
      <div>
        <label htmlFor="style-select" className="block text-sm font-medium text-gray-300 mb-1">
          Image Style
        </label>
        <div className="relative">
            <select
              id="style-select"
              value={selectValue}
              onChange={handleSelectChange}
              disabled={disabled}
              className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-colors appearance-none pr-8"
            >
              {predefinedStyles.map(style => (
                <option key={style} value={style}>{style}</option>
              ))}
            </select>
             <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
                <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                    <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                </svg>
            </div>
        </div>
      </div>

      {showCustom && (
        <div>
          <label htmlFor="style-input-custom" className="block text-sm font-medium text-gray-400 mb-1">
            Custom Style
          </label>
          <input
            type="text"
            id="style-input-custom"
            className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-gray-200 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-colors"
            placeholder="e.g., 2D paint, cinematic lighting, ink illusion"
            value={showCustom ? value : ''}
            onChange={handleCustomChange}
            disabled={disabled}
          />
        </div>
      )}
      <p className="mt-1 text-xs text-gray-500">Defines the artistic style for the generated images.</p>
    </div>
  );
};

export default StyleInput;
