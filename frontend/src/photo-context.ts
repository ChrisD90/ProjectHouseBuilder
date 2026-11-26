import { createContext, useContext } from 'react';
export const PhotoOverlayContext = createContext(false);
export const usePhotoOverlay = () => useContext(PhotoOverlayContext);
