import { createContext, useContext, useState, ReactNode } from 'react';

interface HeaderContextType {
  customContent: ReactNode | null;
  setCustomContent: (content: ReactNode | null) => void;
}

const HeaderContext = createContext<HeaderContextType | undefined>(undefined);

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [customContent, setCustomContent] = useState<ReactNode | null>(null);

  return (
    <HeaderContext.Provider value={{ customContent, setCustomContent }}>
      {children}
    </HeaderContext.Provider>
  );
}

export function useHeader() {
  const context = useContext(HeaderContext);
  if (!context) {
    throw new Error('useHeader must be used within a HeaderProvider');
  }
  return context;
}
