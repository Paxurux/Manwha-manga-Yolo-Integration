import React, { useState, useEffect, useCallback } from 'react';
import { ActionKeybindings, Keybinding, ActionName } from '../types';

const ACTION_LABELS: Record<ActionName, string> = {
  splitPanel: 'Split Panel at Cursor',
  cropTop: 'Crop Top Edge to Cursor',
  cropBottom: 'Crop Bottom Edge to Cursor',
  deletePanel: 'Delete Selected Panel',
  undo: 'Undo Last Action',
  redo: 'Redo Last Action',
  nextPanel: 'Select Next Panel',
  previousPanel: 'Select Previous Panel',
};

const formatKeybinding = (binding: Keybinding): string => {
  const parts = [];
  if (binding.ctrlKey) parts.push('Ctrl');
  if (binding.altKey) parts.push('Alt');
  if (binding.shiftKey) parts.push('Shift');
  // Handle special keys
  if (binding.key === ' ') {
    parts.push('Space');
  } else {
    parts.push(binding.key.length === 1 ? binding.key.toUpperCase() : binding.key);
  }
  return parts.join(' + ');
};

interface KeybindingManagerProps {
  keybindings: ActionKeybindings;
  onKeybindingsChange: (newKeybindings: ActionKeybindings) => void;
}

const KeybindingManager: React.FC<KeybindingManagerProps> = ({ keybindings, onKeybindingsChange }) => {
  const [listeningAction, setListeningAction] = useState<ActionName | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);

  const handleRemoveKeybinding = (action: ActionName, index: number) => {
    const newKeybindings = { ...keybindings };
    newKeybindings[action].splice(index, 1);
    onKeybindingsChange(newKeybindings);
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!listeningAction) return;
    e.preventDefault();
    e.stopPropagation();

    // Ignore modifier-only key presses
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

    setConflictError(null); // Clear previous errors

    const newBinding: Keybinding = {
      key: e.key,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
    };
    
    // --- NEW: Conflict Check ---
    for (const action in keybindings) {
      if (action !== listeningAction) {
        const actionName = action as ActionName;
        const isDuplicate = keybindings[actionName].some(b => 
          b.key.toLowerCase() === newBinding.key.toLowerCase() &&
          b.ctrlKey === newBinding.ctrlKey &&
          b.shiftKey === newBinding.shiftKey &&
          b.altKey === newBinding.altKey
        );
        if (isDuplicate) {
          setConflictError(`Error: "${formatKeybinding(newBinding)}" is already assigned to "${ACTION_LABELS[actionName]}".`);
          setListeningAction(null);
          return; // Stop execution
        }
      }
    }
    // --- End of Conflict Check ---
    
    const newKeybindings = { ...keybindings };
    // Avoid adding duplicates for the same action
    if (!newKeybindings[listeningAction].some(b => JSON.stringify(b) === JSON.stringify(newBinding))) {
       newKeybindings[listeningAction].push(newBinding);
       onKeybindingsChange(newKeybindings);
    }
    setListeningAction(null);
  }, [listeningAction, keybindings, onKeybindingsChange]);

  useEffect(() => {
    if (listeningAction) {
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [listeningAction, handleKeyDown]);

  return (
    <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700 space-y-4">
      <h3 className="text-lg font-semibold text-white">Keybinding Settings</h3>
      {conflictError && <div className="bg-red-900/50 border border-red-700 text-red-200 text-sm px-3 py-2 rounded-md">{conflictError}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        {Object.entries(ACTION_LABELS).map(([action, label]) => (
          <div key={action}>
            <label className="block text-sm font-medium text-gray-300">{label}</label>
            <div className="mt-1 flex flex-wrap gap-2 items-center">
              {keybindings[action as ActionName].map((binding, index) => (
                <div key={index} className="flex items-center gap-1 bg-gray-700 text-gray-200 text-xs font-mono px-2 py-1 rounded-md">
                  <span>{formatKeybinding(binding)}</span>
                  <button onClick={() => handleRemoveKeybinding(action as ActionName, index)} className="text-red-400 hover:text-red-300">&times;</button>
                </div>
              ))}
              {listeningAction === action ? (
                 <div className="bg-fuchsia-600 text-white text-xs font-semibold px-3 py-1 rounded-md animate-pulse">Press any key...</div>
              ) : (
                <button onClick={() => { setListeningAction(action as ActionName); setConflictError(null); }} className="text-sm text-fuchsia-400 hover:text-fuchsia-300">+</button>
              )}
            </div>
          </div>
        ))}
      </div>
      {listeningAction && (
         <div className="text-center">
            <button onClick={() => setListeningAction(null)} className="text-xs text-gray-400 hover:text-white">Cancel</button>
         </div>
      )}
    </div>
  );
};

export default KeybindingManager;