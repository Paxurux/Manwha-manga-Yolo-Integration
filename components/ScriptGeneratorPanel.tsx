
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { geminiService } from '../services/geminiService';
import ActionButton from './ActionButton';

interface ScriptGeneratorPanelProps {
  onScriptGenerated: (script: string) => void;
  onUseScript: (script: string) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  currentScriptOutput: string;
  isPaused: boolean;
  setIsPaused: (paused: boolean) => void;
  onGenerateStart: () => void; // New prop
}

const ScriptGeneratorPanel: React.FC<ScriptGeneratorPanelProps> = ({
  onScriptGenerated,
  onUseScript,
  isLoading,
  setIsLoading,
  setError,
  currentScriptOutput,
  isPaused,
  setIsPaused,
  onGenerateStart,
}) => {
  const [topic, setTopic] = useState('');
  const [characterLimit, setCharacterLimit] = useState('10000');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  
  const stopRequestedRef = useRef(false);
  const isPausedRef = useRef(isPaused);
  useEffect(() => { isPausedRef.current = isPaused }, [isPaused]);

  const pauseExecution = async () => {
    while (isPausedRef.current) {
        setStatusMessage(prev => prev?.includes("(Paused)") ? prev : `${prev} (Paused)`);
        await new Promise(res => setTimeout(res, 500));
    }
  }

  const handleGenerateScript = useCallback(async () => {
    if (!topic.trim()) {
      setError("Please provide a subject for the documentary script.");
      return;
    }
    const limit = parseInt(characterLimit, 10);
    if (isNaN(limit) || limit < 100) {
      setError("Please enter a valid character limit (at least 100).");
      return;
    }
    
    setError(null);
    onGenerateStart(); // Reset parent component states
    stopRequestedRef.current = false;
    setIsLoading(true);
    setIsPaused(false);
    onScriptGenerated('');
    
    let accumulatedScript = '';
    let segmentCount = 1;

    try {
      while (!stopRequestedRef.current) {
        await pauseExecution();
        
        const chunk = await geminiService.generateScriptChunk(
          topic,
          accumulatedScript,
          limit,
          (message) => { // onStatusUpdate callback
            setStatusMessage(`Segment ${segmentCount}: ${message}`);
          }
        );

        if (stopRequestedRef.current) {
          setStatusMessage(`Generation stopped by user.`);
          break;
        }

        if (chunk.includes('[SCRIPT_COMPLETE]')) {
          const finalChunk = chunk.replace('[SCRIPT_COMPLETE]', '').trim();
          if(finalChunk) {
            accumulatedScript += (accumulatedScript ? '\n\n' : '') + finalChunk;
            onScriptGenerated(accumulatedScript);
          }
          setStatusMessage(`Script generation complete! Total length: ${accumulatedScript.length} chars.`);
          break;
        }

        accumulatedScript += (accumulatedScript ? '\n\n' : '') + chunk;
        onScriptGenerated(accumulatedScript);
        segmentCount++;
      }
    } catch (e: any) {
      console.error("Script generation error:", e);
      setError(e.message || "An error occurred while generating the script.");
      setStatusMessage("Error during generation.");
    } finally {
      setIsLoading(false);
      if (stopRequestedRef.current) {
        setStatusMessage("Generation stopped.");
      }
    }
  }, [topic, characterLimit, onScriptGenerated, setError, setIsLoading, setIsPaused, onGenerateStart]);

  const handleStop = () => {
    stopRequestedRef.current = true;
    setIsLoading(false);
    setStatusMessage("Stop requested... finishing current segment if any.");
  };

  const handleCopy = () => {
    if (!currentScriptOutput) return;
    navigator.clipboard.writeText(currentScriptOutput)
      .then(() => setStatusMessage("Script copied to clipboard!"))
      .catch(() => setStatusMessage("Failed to copy script."));
  };

  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="topic" className="block text-sm font-medium text-gray-300 mb-1">
          Documentary Subject
        </label>
        <textarea
          id="topic"
          rows={4}
          className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-gray-200 focus:ring-2 focus:ring-fuchsia-500 focus:border-fuchsia-500"
          placeholder="Enter the person, company, event, or concept for the script (e.g., 'The Rise and Fall of Enron', 'The Secret History of the CIA', 'Nikola Tesla')..."
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          disabled={isLoading}
        />
        <p className="mt-1 text-xs text-gray-500">The AI will generate a detailed script based on this subject, following the 'Magnates Media' cinematic style.</p>
      </div>
      
      <div>
        <label htmlFor="character-limit" className="block text-sm font-medium text-gray-300 mb-1">
          Length per Segment (Characters)
        </label>
        <input
          id="character-limit"
          type="number"
          min="100"
          step="100"
          value={characterLimit}
          onChange={(e) => setCharacterLimit(e.target.value)}
          className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-gray-200 focus:ring-2 focus:ring-fuchsia-500 focus:border-fuchsia-500"
          placeholder="e.g., 10000"
          disabled={isLoading}
        />
        <p className="mt-1 text-xs text-gray-500">Approximate number of characters for each generated script segment. The AI will structure its output to this length.</p>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        {!isLoading ? (
          <ActionButton onClick={handleGenerateScript} disabled={!topic.trim()}>
            {currentScriptOutput ? 'Restart Generation' : 'Generate Full Script'}
          </ActionButton>
        ) : (
          <>
            <ActionButton onClick={() => setIsPaused(false)} variant="primary" disabled={!isPaused}>
              Resume
            </ActionButton>
            <ActionButton onClick={() => setIsPaused(true)} variant="secondary" disabled={isPaused}>
              Pause
            </ActionButton>
            <ActionButton onClick={handleStop} variant="danger">
              Stop Generation
            </ActionButton>
          </>
        )}
      </div>
      
      {statusMessage && <p className="text-sm text-fuchsia-300 mt-2">{statusMessage}</p>}

      {currentScriptOutput && (
        <div className="mt-6">
          <h4 className="text-lg font-semibold text-gray-200 mb-2">Generated Script:</h4>
          <div className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-gray-200 max-h-96 overflow-y-auto whitespace-pre-wrap">
            {currentScriptOutput}
          </div>
          <div className="flex gap-3 mt-3">
            <ActionButton onClick={handleCopy} variant="secondary" disabled={isLoading || !currentScriptOutput}>
              Copy Script
            </ActionButton>
            <ActionButton onClick={() => onUseScript(currentScriptOutput)} variant="secondary" disabled={isLoading || !currentScriptOutput}>
              Use This Script for Storyboard
            </ActionButton>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScriptGeneratorPanel;