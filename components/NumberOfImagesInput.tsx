
import React from 'react';

interface NumberOfImagesInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const NumberOfImagesInput: React.FC<NumberOfImagesInputProps> = ({ value, onChange, disabled }) => {
  return (
    <div className="w-full">
      <label htmlFor="num-images-input" className="block text-sm font-medium text-gray-300 mb-1">
        Number of Scenes
      </label>
      <input
        type="number"
        id="num-images-input"
        min="1"
        className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-colors placeholder-gray-500"
        placeholder="e.g., 50"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-describedby="num-images-description"
      />
      <p id="num-images-description" className="mt-1 text-xs text-gray-500">
        Required. Specify exactly how many scenes to divide the script into.
      </p>
    </div>
  );
};

export default NumberOfImagesInput;