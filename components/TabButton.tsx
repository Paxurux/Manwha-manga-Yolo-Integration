import React from 'react';

interface TabButtonProps {
  children: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
  disabled?: boolean;
}

const TabButton: React.FC<TabButtonProps> = ({ children, isActive, onClick, disabled }) => {
  const activeClasses = 'border-fuchsia-400 text-fuchsia-400';
  const inactiveClasses = 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`py-3 px-6 font-semibold text-base md:text-lg border-b-4 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed ${isActive ? activeClasses : inactiveClasses}`}
    >
      {children}
    </button>
  );
};

export default TabButton;