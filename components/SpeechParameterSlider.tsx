import React from 'react';

interface SpeechParameterSliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
}

const SpeechParameterSlider: React.FC<SpeechParameterSliderProps> = ({
  label, value, onChange, min, max, step, disabled
}) => {
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <label htmlFor={`${label}-slider`} className="block text-sm font-medium text-gray-300">
            {label}
        </label>
        <span className="font-mono text-fuchsia-400 bg-gray-900 px-1.5 py-0.5 rounded text-xs">{value.toFixed(2)}</span>
      </div>
      <input
        id={`${label}-slider`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer range-lg [&::-webkit-slider-thumb]:bg-fuchsia-500 disabled:opacity-50"
      />
    </div>
  );
};

export default SpeechParameterSlider;