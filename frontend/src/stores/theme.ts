import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

export const useTheme = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light', // Default to light mode
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },
      toggleTheme: () => {
        const newTheme = get().theme === 'light' ? 'dark' : 'light';
        set({ theme: newTheme });
        applyTheme(newTheme);
      },
    }),
    {
      name: 'oshu-theme',
      onRehydrateStorage: () => (state) => {
        // Apply theme after rehydration from localStorage
        if (state) {
          applyTheme(state.theme);
        } else {
          // Default to light if no stored state
          applyTheme('light');
        }
      },
    }
  )
);

// Apply theme immediately on module load to prevent flash
if (typeof window !== 'undefined') {
  // Check localStorage for stored theme
  try {
    const stored = localStorage.getItem('oshu-theme');
    if (stored) {
      const { state } = JSON.parse(stored);
      if (state?.theme) {
        applyTheme(state.theme);
      } else {
        applyTheme('light');
      }
    } else {
      // No stored preference, use light mode
      applyTheme('light');
    }
  } catch {
    applyTheme('light');
  }
}
