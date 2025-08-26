import React, { useRef, useState, useEffect, useCallback } from 'react';
import { StitchedPageAnalysis, Panel, ActionKeybindings } from '../types';

interface PanelEditorProps {
    page: StitchedPageAnalysis;
    panel: Panel;
    onSplit: (pageId: string, panelId: string, splitY_norm: number) => void;
    onCrop: (pageId: string, panelId: string, cropY_norm: number, direction: 'top' | 'bottom') => void;
    keybindings: Pick<ActionKeybindings, 'splitPanel' | 'cropTop' | 'cropBottom'>;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

const PanelEditor: React.FC<PanelEditorProps> = ({ page, panel, onSplit, onCrop, keybindings }) => {
    const viewportRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const lastCoordsRef = useRef({ x_norm: 0, y_norm: 0 });
    
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [isAutoFocusing, setIsAutoFocusing] = useState(true);
    const [panStart, setPanStart] = useState({ x: 0, y: 0 });
    const [mousePosition, setMousePosition] = useState<{x: number, y: number} | null>(null);

    const autoFocusOnPanel = useCallback(() => {
        if (!panel || !viewportRef.current) return;
        setIsAutoFocusing(true);
        const viewport = viewportRef.current;
        
        const [px, py, pw, ph] = panel.coordinates; // Panel coords in %
        const [pWidth, pHeight] = [pw * page.image_width, ph * page.image_height];
        const [vWidth, vHeight] = [viewport.clientWidth, viewport.clientHeight];

        if (pWidth === 0 || pHeight === 0) return;

        // Add padding to the auto-focus zoom
        const zoomX = vWidth / (pWidth * 1.2);
        const zoomY = vHeight / (pHeight * 1.2);
        const newZoom = Math.max(MIN_ZOOM, Math.min(zoomX, zoomY, MAX_ZOOM));
        
        const newPanX = (vWidth / 2) - (px * page.image_width + pWidth / 2) * newZoom;
        const newPanY = (vHeight / 2) - (py * page.image_height + pHeight / 2) * newZoom;

        setZoom(newZoom);
        setPan({ x: newPanX, y: newPanY });

        // Disable the focusing transition after it completes to allow instant panning
        const timer = setTimeout(() => setIsAutoFocusing(false), 300); // Duration matches CSS transition
        return () => clearTimeout(timer);
    }, [panel, page]);

    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;

        const lockScroll = () => { document.body.style.overflow = 'hidden'; };
        const unlockScroll = () => { document.body.style.overflow = ''; };

        viewport.addEventListener('mouseenter', lockScroll);
        viewport.addEventListener('mouseleave', unlockScroll);
        
        return () => {
            viewport.removeEventListener('mouseenter', lockScroll);
            viewport.removeEventListener('mouseleave', unlockScroll);
            unlockScroll(); // Ensure scroll is unlocked on unmount
        };
    }, []);

    // Auto-focus on the selected panel with a smooth transition
    useEffect(() => {
        autoFocusOnPanel();
    }, [panel, page, autoFocusOnPanel]);

    const getRelativeCoords = useCallback((e: React.MouseEvent | MouseEvent) => {
        if (!viewportRef.current) return { y_norm: 0, clientX: e.clientX, clientY: e.clientY };
        const rect = viewportRef.current.getBoundingClientRect();
        
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const imageX = (mouseX - pan.x) / zoom;
        const imageY = (mouseY - pan.y) / zoom;
        
        const y_norm = imageY / page.image_height;
        return { y_norm, clientX: e.clientX, clientY: e.clientY };
    }, [pan, zoom, page.image_height]);

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        const { clientY, y_norm } = getRelativeCoords(e);
        setMousePosition({ x: e.clientX, y: clientY });
        lastCoordsRef.current = { x_norm: 0, y_norm: y_norm };

        if (isPanning) {
            const dx = e.clientX - panStart.x;
            const dy = e.clientY - panStart.y;
            setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
            setPanStart({ x: e.clientX, y: e.clientY });
        }
    };

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (mousePosition === null) return;
        const { y_norm } = lastCoordsRef.current;
        const isEditingText = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
        if (isEditingText) return;

        const checkBinding = (action: keyof typeof keybindings) => {
          return keybindings[action].some(b => 
              b.key.toLowerCase() === e.key.toLowerCase() &&
              b.ctrlKey === e.ctrlKey &&
              b.shiftKey === e.shiftKey &&
              b.altKey === e.altKey
          );
        };

        if (checkBinding('splitPanel')) {
            e.preventDefault();
            onSplit(page.stitch_id, panel.panel_id, y_norm);
        } else if (checkBinding('cropTop')) {
            e.preventDefault();
            onCrop(page.stitch_id, panel.panel_id, y_norm, 'top');
        } else if (checkBinding('cropBottom')) {
            e.preventDefault();
            onCrop(page.stitch_id, panel.panel_id, y_norm, 'bottom');
        }
    }, [mousePosition, page.stitch_id, panel.panel_id, onSplit, onCrop, keybindings]);
    
    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.ctrlKey) {
            const rect = viewportRef.current!.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const zoomFactor = 1.1;
            const newZoom = e.deltaY < 0 ? zoom * zoomFactor : zoom / zoomFactor;
            const clampedZoom = Math.max(MIN_ZOOM, Math.min(newZoom, MAX_ZOOM));

            const panX = mouseX - (mouseX - pan.x) * (clampedZoom / zoom);
            const panY = mouseY - (mouseY - pan.y) * (clampedZoom / zoom);
            
            setZoom(clampedZoom);
            setPan({ x: panX, y: panY });
        } else {
            // If Ctrl is not pressed, pan vertically with the scroll wheel
            setPan(prev => ({ ...prev, y: prev.y - e.deltaY }));
        }
    };

    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        // Only start panning if the click is directly on the background, not the image or other elements
        if (e.target === e.currentTarget) {
            e.preventDefault();
            setIsPanning(true);
            setPanStart({ x: e.clientX, y: e.clientY });
        }
    };
    
    const handleMouseUp = () => setIsPanning(false);

    const [x, y, w, h] = panel.coordinates;

    return (
        <div className="w-full h-full bg-gray-900 rounded-lg border-2 border-gray-700 flex flex-col focus:outline-none focus:ring-2 focus:ring-fuchsia-500">
            <header className="p-3 border-b border-gray-700 bg-gray-800 rounded-t-md flex-shrink-0">
                <div className="flex justify-between items-center">
                    <h4 className="text-lg font-bold text-white">Panel Editor</h4>
                    <button onClick={autoFocusOnPanel} className="text-xs text-fuchsia-400 hover:text-fuchsia-300 transition-colors bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded-md flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.05 3.636a1 1 0 011.414 0L10 7.172l3.536-3.536a1 1 0 111.414 1.414L11.414 8.586l3.536 3.536a1 1 0 11-1.414 1.414L10 10.028l-3.536 3.536a1 1 0 11-1.414-1.414L8.586 8.586 5.05 5.05a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                        Reset View
                    </button>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-300 mt-2 text-center">
                    <span><kbd className="kb-key">Ctrl</kbd>+<kbd className="kb-key">Scroll</kbd> Zoom</span>
                    <span><kbd className="kb-key">Scroll</kbd> to Pan Up/Down</span>
                    <span><kbd className="kb-key">Q</kbd> to set Top Edge</span>
                    <span><kbd className="kb-key">W</kbd> to set Bottom Edge</span>
                </div>
                <style>{`
                    .kb-key { display: inline-block; padding: 2px 6px; font-family: monospace; font-weight: 600; color: #1f2937; background-color: #d1d5db; border-radius: 4px; border: 1px solid #9ca3af; }
                `}</style>
            </header>
            
            <div 
                ref={viewportRef}
                className={`flex-grow relative overflow-hidden ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => { setMousePosition(null); handleMouseUp(); }}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
            >
                {/* Transform container for pan and zoom */}
                <div 
                    style={{ 
                        transformOrigin: '0 0', 
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        transition: isPanning ? 'none' : isAutoFocusing ? 'transform 0.3s ease-out' : 'none'
                    }}
                    className="absolute top-0 left-0"
                >
                    <img 
                        ref={imageRef} 
                        src={page.stitchedImageBase64} 
                        style={{ width: page.image_width, height: page.image_height, pointerEvents: 'none' }} 
                        alt="Full page" 
                    />
                    
                    {/* Spotlight effect */}
                    <div 
                        className="absolute border-y-2 border-fuchsia-500/80"
                        style={{
                            left: `${x * 100}%`,
                            top: `${y * 100}%`,
                            width: `${w * 100}%`,
                            height: `${h * 100}%`,
                            boxShadow: `0 0 0 9999px rgba(0,0,0,0.7)`,
                            pointerEvents: 'none',
                        }}
                    />
                </div>
           
                {/* Guide line (relative to viewport) */}
                {mousePosition !== null && viewportRef.current && (
                    <div 
                        className="absolute left-0 right-0 h-0.5 bg-fuchsia-400 pointer-events-none z-10"
                        style={{ top: `${mousePosition.y - viewportRef.current.getBoundingClientRect().top}px` }}
                    />
                )}

                {/* Zoom Controls */}
                <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-1">
                    <button onClick={() => handleWheel({ ctrlKey: true, deltaY: -100, preventDefault: ()=>{}, stopPropagation: ()=>{}, clientX: viewportRef.current!.clientWidth/2, clientY: viewportRef.current!.clientHeight/2 } as any)} className="zoom-btn">+</button>
                    <button onClick={() => handleWheel({ ctrlKey: true, deltaY: 100, preventDefault: ()=>{}, stopPropagation: ()=>{}, clientX: viewportRef.current!.clientWidth/2, clientY: viewportRef.current!.clientHeight/2 } as any)} className="zoom-btn">-</button>
                </div>
                 <style>{`
                    .zoom-btn { width: 32px; height: 32px; background-color: rgba(31, 41, 55, 0.8); color: white; border: 1px solid #4b5563; border-radius: 50%; font-size: 20px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background-color 0.2s; }
                    .zoom-btn:hover { background-color: rgba(55, 65, 81, 0.9); }
                `}</style>
            </div>
        </div>
    );
};
export default PanelEditor;