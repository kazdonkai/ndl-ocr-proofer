// Resizable split pane — maps to WorkspaceLeaf resize in Obsidian
import { useState, useEffect, useRef } from 'react';

export function useSplitPane(initialRatio = 50) {
  const [splitRatio, setSplitRatio] = useState(initialRatio);
  const [isDragging, setIsDragging] = useState(false);
  const workspaceRef = useRef(null);

  const handleMouseDown = (e) => {
    setIsDragging(true);
    e.preventDefault();
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging || !workspaceRef.current) return;
      const workspaceRect = workspaceRef.current.getBoundingClientRect();
      const newRatio = ((e.clientX - workspaceRect.left) / workspaceRect.width) * 100;
      if (newRatio >= 20 && newRatio <= 80) setSplitRatio(newRatio);
    };
    const handleMouseUp = () => setIsDragging(false);
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  return { splitRatio, isDragging, workspaceRef, handleMouseDown };
}
