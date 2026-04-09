/**
 * Simple toast notification utility
 * Shows user-friendly error messages for common database constraint violations
 */

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastOptions {
  duration?: number;
  type?: ToastType;
}

/**
 * Show a toast notification
 */
export function showToast(message: string, options: ToastOptions = {}) {
  const { duration = 5000, type = 'info' } = options;
  
  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  
  // Style the toast
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    padding: '12px 20px',
    borderRadius: '8px',
    backgroundColor: getBackgroundColor(type),
    color: 'white',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    zIndex: '10000',
    maxWidth: '400px',
    fontSize: '14px',
    lineHeight: '1.5',
    animation: 'slideIn 0.3s ease-out',
  });
  
  // Add to document
  document.body.appendChild(toast);
  
  // Remove after duration
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => {
      document.body.removeChild(toast);
    }, 300);
  }, duration);
}

function getBackgroundColor(type: ToastType): string {
  switch (type) {
    case 'success':
      return '#10b981'; // green-500
    case 'error':
      return '#ef4444'; // red-500
    case 'warning':
      return '#f59e0b'; // amber-500
    case 'info':
    default:
      return '#3b82f6'; // blue-500
  }
}

/**
 * Handle API errors and show appropriate toast
 */
export function handleApiError(error: any, defaultMessage: string = 'An error occurred') {
  const message = error.code === 'DUPLICATE_RESOURCE' 
    ? error.message 
    : (error.message || defaultMessage);
  
  showToast(message, { type: 'error', duration: 6000 });
}

// Add CSS animations
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    
    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(400px);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
}
