import { useEffect, useRef } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  type?: 'alert' | 'confirm' | 'danger';
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
}

export function Modal({
  isOpen,
  onClose,
  title,
  message,
  type = 'alert',
  confirmText = 'OK',
  cancelText = 'Cancel',
  onConfirm,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      // Focus the modal for accessibility
      modalRef.current?.focus();
      // Prevent body scroll
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm?.();
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-6 w-full max-w-md mx-4 shadow-xl animate-in fade-in zoom-in-95 duration-200"
      >
        <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-2">{title}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">{message}</p>
        
        <div className="flex justify-end gap-3">
          {type !== 'alert' && (
            <button
              onClick={onClose}
              className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 rounded text-sm hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              {cancelText}
            </button>
          )}
          <button
            onClick={handleConfirm}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              type === 'danger'
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-slate-800 dark:bg-blue-500 text-white hover:bg-slate-900 dark:hover:bg-blue-600'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

// Hook for easier modal usage
import { useState, useCallback } from 'react';

interface ModalState {
  isOpen: boolean;
  title: string;
  message: string;
  type: 'alert' | 'confirm' | 'danger';
  confirmText: string;
  cancelText: string;
  onConfirm?: () => void;
}

export function useModal() {
  const [modalState, setModalState] = useState<ModalState>({
    isOpen: false,
    title: '',
    message: '',
    type: 'alert',
    confirmText: 'OK',
    cancelText: 'Cancel',
  });

  const showAlert = useCallback((title: string, message: string) => {
    return new Promise<void>((resolve) => {
      setModalState({
        isOpen: true,
        title,
        message,
        type: 'alert',
        confirmText: 'OK',
        cancelText: 'Cancel',
        onConfirm: resolve,
      });
    });
  }, []);

  const showConfirm = useCallback((title: string, message: string, options?: { 
    confirmText?: string; 
    cancelText?: string;
    danger?: boolean;
  }) => {
    return new Promise<boolean>((resolve) => {
      setModalState({
        isOpen: true,
        title,
        message,
        type: options?.danger ? 'danger' : 'confirm',
        confirmText: options?.confirmText || 'Confirm',
        cancelText: options?.cancelText || 'Cancel',
        onConfirm: () => resolve(true),
      });
      // If modal is closed without confirming, resolve false
      // We'll handle this in the close function
    });
  }, []);

  const closeModal = useCallback(() => {
    setModalState(prev => ({ ...prev, isOpen: false }));
  }, []);

  const ModalComponent = (
    <Modal
      isOpen={modalState.isOpen}
      onClose={closeModal}
      title={modalState.title}
      message={modalState.message}
      type={modalState.type}
      confirmText={modalState.confirmText}
      cancelText={modalState.cancelText}
      onConfirm={modalState.onConfirm}
    />
  );

  return {
    showAlert,
    showConfirm,
    closeModal,
    ModalComponent,
  };
}
