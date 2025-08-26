
import React from 'react';

interface AspectRatioSelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const aspectRatios = [
  { value: "16:9", label: "Landscape (16:9)" },
  { value: "9:16", label: "Portrait (9:16)" },
  { value: "4:3", label: "Standard (4:3)" },
  { value: "1:1", label: "Square (1:1)" },
  { value: "3:4", label: "Portrait (3:4)" },
];

const AspectRatioSelect: React.FC<AspectRatioSelectProps> = ({ value, onChange, disabled }) => {
  return (
    <div className="w-full">
      <label htmlFor="aspect-ratio-select" className="block text-sm font-medium text-gray-300 mb-1">
        Image Aspect Ratio
      </label>
      <div className="relative">
        <select
          id="aspect-ratio-select"
          className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-colors appearance-none pr-8"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-describedby="aspect-ratio-description"
        >
          {aspectRatios.map(ar => (
            <option key={ar.value} value={ar.value}>{ar.label}</option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
          <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
            <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
          </svg>
        </div>
      </div>
      <p id="aspect-ratio-description" className="mt-1 text-xs text-gray-500">
        Select a supported aspect ratio for the generated images.
      </p>
    </div>
  );
};

export default AspectRatioSelect;
