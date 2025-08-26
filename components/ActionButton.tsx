
import React from 'react';

interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  isLoading?: boolean;
  isLoadingText?: string;
}

const ActionButton: React.FC<ActionButtonProps> = ({
  children,
  variant = 'primary',
  isLoading = false,
  isLoadingText,
  className,
  ...props
}) => {
  const baseStyle = "px-6 py-3 font-semibold rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-opacity-75 transition-all duration-150 ease-in-out flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed";
  
  let variantStyle = '';
  switch (variant) {
    case 'primary':
      variantStyle = 'bg-fuchsia-600 hover:bg-fuchsia-700 text-white focus:ring-fuchsia-500';
      break;
    case 'secondary':
      variantStyle = 'bg-gray-600 hover:bg-gray-700 text-gray-100 focus:ring-gray-500';
      break;
    case 'danger':
      variantStyle = 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500';
      break;
  }

  return (
    <button
      className={`${baseStyle} ${variantStyle} ${className || ''}`}
      disabled={isLoading || props.disabled}
      {...props}
    >
      {isLoading ? (
        <>
          <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          {isLoadingText || 'Processing...'}
        </>
      ) : (
        children
      )}
    </button>
  );
};

export default ActionButton;