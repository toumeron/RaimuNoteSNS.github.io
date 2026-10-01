import { createContext, useContext } from 'react';

// Desktop uses the existing mobile presentation without changing viewport-based interactions.
export const DesktopLayoutContext = createContext(false);
export const useDesktopLayout = () => useContext(DesktopLayoutContext);
