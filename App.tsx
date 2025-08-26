import React, { useState, useEffect } from 'react';
import MangaToVideoPanel from './components/MangaToVideoPanel';

const App: React.FC = () => {
  // --- State for Manga Panel TTS Settings ---
  const [ttsVoice, setTtsVoice] = useState('Puck');
  const [ttsSpeakingRate, setTtsSpeakingRate] = useState(1.0);
  const [ttsPitch, setTtsPitch] = useState(0.0);
  const [ttsVolumeGain, setTtsVolumeGain] = useState(0.0);
  
  // --- Global State ---
  const [isProcessingManga, setIsProcessingManga] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);

  // API Key Check
  useEffect(() => {
    if (!process.env.API_KEY) {
      setAppError("API_KEY environment variable not found. Please ensure it is set up correctly.");
    }
  }, []);

  return (
    <div className="min-h-screen text-gray-100 p-4 md:p-8">
      <header className="text-center mb-8">
        <h1 className="text-4xl md:text-5xl font-bold text-fuchsia-400">AI Manga to Video Studio</h1>
        <p className="text-lg text-gray-400 mt-2">Upload manga/manhwa chapters and generate a narrated video recap.</p>
      </header>
      
      {appError && <div className="max-w-4xl mx-auto mb-6"><div className="bg-red-900 border border-red-700 text-red-100 px-4 py-3 rounded-md">{appError}</div></div>}

      <div className="max-w-7xl mx-auto">
        <MangaToVideoPanel
            ttsVoice={ttsVoice}
            onTtsVoiceChange={setTtsVoice}
            speakingRate={ttsSpeakingRate}
            onSpeakingRateChange={setTtsSpeakingRate}
            pitch={ttsPitch}
            onPitchChange={setTtsPitch}
            volumeGain={ttsVolumeGain}
            onVolumeGainChange={setTtsVolumeGain}
            setIsProcessing={setIsProcessingManga}
            isParentProcessing={false} // No other processes will run
        />
      </div>

      <footer className="text-center mt-12 py-6 border-t border-gray-700">
        <p className="text-sm text-gray-500">Powered by Google Gemini. Designed with Tailwind CSS.</p>
        <p className="text-xs text-gray-600 mt-1">Note: Ensure API_KEY is correctly set in your environment.</p>
      </footer>
    </div>
  );
};

export default App;
