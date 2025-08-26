import React from 'react';

interface ScriptInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const ScriptInput: React.FC<ScriptInputProps> = ({ value, onChange, disabled }) => {
  return (
    <div className="w-full">
      <label htmlFor="script-input" className="block text-sm font-medium text-gray-300 mb-1">
        Paste Your Video Script Here
      </label>
      <textarea
        id="script-input"
        rows={10}
        className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-colors"
        placeholder="Enter your long video script..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
      <p className="mt-1 text-xs text-gray-500">The AI will analyze this script to generate image prompts.</p>
    </div>
  );
};

export default ScriptInput;
