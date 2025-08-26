import React, { useState, useRef, useEffect, MouseEvent } from 'react';
import { Panel, CoordinatesArray } from '../types';

type ActionType = 'none' | 'drawing' | 'moving' | 'resizing';
type ResizeHandle = 'tl' | 't' | 'tr' | 'l' | 'r' | 'bl' | 'b' | 'br';

interface ActionState {
    type: ActionType;
    panelId?: string;
    handle?: ResizeHandle;
    startX: number;
    startY: number;
    originalCoords?: CoordinatesArray;
}

interface InteractiveMangaViewProps {
    imageSrc: string;
    panels: Panel[];
    onUpdatePanel: (panelId: string, newCoords: CoordinatesArray) => void;
    onAddPanel: (newCoords: CoordinatesArray) => void;
}

const InteractiveMangaView: React.FC<InteractiveMangaViewProps> = ({ imageSrc, panels, onUpdatePanel, onAddPanel }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [actionState, setActionState] = useState<ActionState>({ type: 'none', startX: 0, startY: 0 });
    const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);

    const getRelativeCoords = (e: React.MouseEvent | globalThis.MouseEvent): { x: number, y: number } => {
        const rect = containerRef.current!.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        return { x, y };
    };

    const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();

        const { x, y } = getRelativeCoords(e);
        const target = e.target as HTMLElement;
        const panelId = target.dataset.panelId;
        const handle = target.dataset.handle as ResizeHandle;

        if (panelId) {
            setSelectedPanelId(panelId);
            const panel = panels.find(p => p.panel_id === panelId);
            if (handle) {
                setActionState({ type: 'resizing', panelId, handle, startX: x, startY: y, originalCoords: panel?.coordinates });
            } else {
                setActionState({ type: 'moving', panelId, startX: x, startY: y, originalCoords: panel?.coordinates });
            }
        } else {
            setSelectedPanelId(null);
            setActionState({ type: 'drawing', startX: x, startY: y });
        }
    };

    useEffect(() => {
        const handleMouseMove = (e: globalThis.MouseEvent) => {
            if (actionState.type === 'none' || !containerRef.current) return;
            e.preventDefault();

            const { x: currentX, y: currentY } = getRelativeCoords(e);
            const { startX, startY, originalCoords, panelId, handle } = actionState;

            let newCoords: CoordinatesArray = [0, 0, 0, 0];

            if (actionState.type === 'drawing') {
                newCoords[0] = Math.min(startX, currentX);
                newCoords[1] = Math.min(startY, currentY);
                newCoords[2] = Math.abs(currentX - startX);
                newCoords[3] = Math.abs(currentY - startY);
                // Preview drawing is implicitly handled by the visual representation of the drawing box
                // No need to update state during move for drawing preview

            } else if (actionState.type === 'moving' && originalCoords && panelId) {
                const dx = currentX - startX;
                const dy = currentY - startY;
                newCoords = [...originalCoords];
                newCoords[0] += dx;
                newCoords[1] += dy;

                // Clamp to bounds
                newCoords[0] = Math.max(0, Math.min(1 - newCoords[2], newCoords[0]));
                newCoords[1] = Math.max(0, Math.min(1 - newCoords[3], newCoords[1]));
                onUpdatePanel(panelId, newCoords);

            } else if (actionState.type === 'resizing' && originalCoords && panelId && handle) {
                 let [x, y, w, h] = originalCoords;
                 const dx = currentX - startX;
                 const dy = currentY - startY;

                 if (handle.includes('l')) { x += dx; w -= dx; }
                 if (handle.includes('r')) { w += dx; }
                 if (handle.includes('t')) { y += dy; h -= dy; }
                 if (handle.includes('b')) { h += dy; }
                 
                 // Handle negative width/height by swapping origin
                 if (w < 0) { x += w; w = -w; }
                 if (h < 0) { y += h; h = -h; }
                 
                 newCoords = [x, y, w, h];
                 onUpdatePanel(panelId, newCoords);
            }
        };

        const handleMouseUp = (e: globalThis.MouseEvent) => {
             if (actionState.type === 'drawing') {
                const { x: endX, y: endY } = getRelativeCoords(e);
                const { startX, startY } = actionState;
                const newCoords: CoordinatesArray = [
                    Math.min(startX, endX),
                    Math.min(startY, endY),
                    Math.abs(endX - startX),
                    Math.abs(endY - startY),
                ];
                if (newCoords[2] > 0.01 && newCoords[3] > 0.01) { // Threshold for creating a panel
                    onAddPanel(newCoords);
                }
            }
            // For moving/resizing, the update is already happening in mouseMove, so we just reset state
            setActionState({ type: 'none', startX: 0, startY: 0 });
        };
        
        if (actionState.type !== 'none') {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp, { once: true });
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [actionState, onAddPanel, onUpdatePanel]);

    const getCursorForHandle = (handle: ResizeHandle) => {
        switch (handle) {
            case 'tl': case 'br': return 'nwse-resize';
            case 'tr': case 'bl': return 'nesw-resize';
            case 't': case 'b': return 'ns-resize';
            case 'l': case 'r': return 'ew-resize';
            default: return 'move';
        }
    };
    
    const handles: ResizeHandle[] = ['tl', 't', 'tr', 'l', 'r', 'bl', 'b', 'br'];

    return (
        <div className="w-full max-h-[80vh] overflow-y-auto border border-fuchsia-500 rounded-lg relative select-none"
             ref={containerRef}
             onMouseDown={handleMouseDown}
             style={{ cursor: actionState.type === 'drawing' ? 'crosshair' : 'default' }}
        >
            <p className="absolute top-2 left-2 bg-black/70 text-white p-2 rounded-lg text-sm z-20 pointer-events-none">
                <b>Edit Mode:</b> Click and drag to create a new panel. Click a panel to select, move, or resize it.
            </p>
            <img src={imageSrc} alt="Interactive manga page" className="w-full h-auto pointer-events-none" />
            
            {panels.map(panel => (
                <div
                    key={panel.panel_id}
                    data-panel-id={panel.panel_id}
                    className={`absolute border-2 ${selectedPanelId === panel.panel_id ? 'border-fuchsia-400 shadow-lg' : 'border-blue-500/80'} transition-colors`}
                    style={{
                        left: `${panel.coordinates[0] * 100}%`,
                        top: `${panel.coordinates[1] * 100}%`,
                        width: `${panel.coordinates[2] * 100}%`,
                        height: `${panel.coordinates[3] * 100}%`,
                        cursor: 'move'
                    }}
                >
                    {selectedPanelId === panel.panel_id && handles.map(handle => (
                        <div
                            key={handle}
                            data-panel-id={panel.panel_id}
                            data-handle={handle}
                            className="absolute bg-fuchsia-400 border border-white rounded-full w-3 h-3 -m-1.5 z-10"
                            style={{
                                top: handle.includes('t') ? '0%' : handle.includes('b') ? '100%' : '50%',
                                left: handle.includes('l') ? '0%' : handle.includes('r') ? '100%' : '50%',
                                transform: `translate(${handle.includes('l') ? '-50%' : handle.includes('r') ? '-50%' : '-50%'}, ${handle.includes('t') ? '-50%' : handle.includes('b') ? '-50%' : '-50%'})`,
                                cursor: getCursorForHandle(handle),
                            }}
                        />
                    ))}
                </div>
            ))}
        </div>
    );
};

export default InteractiveMangaView;