import React, { useEffect, useState } from 'react';
import { Download, WifiOff, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIOSDevice);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    install,
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
      return;
    }
    setShowGuideModal(true);
  };

  return (
    <>
      <button
        type="button"
        data-testid="pwa-install-btn"
        onClick={handleClick}
        title="Instalar J.A.R.V.I.S. Studio como Aplicação Desktop / Mobile (PWA)"
        aria-label="Instalar Aplicação J.A.R.V.I.S."
        className={
          compact
            ? 'w-9 h-9 rounded-lg bg-[#141821] border border-white/8 hover:border-[#e59a54]/45 text-slate-300 hover:text-[#e59a54] flex items-center justify-center transition-colors shrink-0'
            : 'w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#141821] border border-white/8 text-slate-300 hover:text-slate-100 hover:border-[#e59a54]/45 transition-colors whitespace-nowrap'
        }
      >
        <Download className="w-3.5 h-3.5 text-[#e59a54] shrink-0" />
        {!compact && (
          <span>{isIOS ? 'Instalar no iOS' : 'Instalar App Desktop'}</span>
        )}
      </button>

      {showGuideModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Instalar Aplicação J.A.R.V.I.S. Studio"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          onClick={() => setShowGuideModal(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-[#12161f] border border-white/10 p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-[#e59a54]">Progressive Web App (PWA)</p>
                <h3 className="text-base font-bold text-slate-100 font-display mt-0.5">
                  Instalar J.A.R.V.I.S. Studio
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                aria-label="Fechar guia de instalação"
                className="p-1 text-slate-400 hover:text-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <ol className="text-xs text-slate-300 space-y-2 list-decimal pl-4 leading-relaxed">
                <li>
                  Toca no botão <strong className="text-slate-100">Partilhar</strong> na barra do
                  Safari.
                </li>
                <li>
                  Desliza para baixo e seleciona{' '}
                  <strong className="text-slate-100">Adicionar ao Ecrã Principal</strong>.
                </li>
              </ol>
            ) : (
              <div className="text-xs text-slate-300 space-y-2 leading-relaxed">
                <p>
                  O manifesto <code className="text-[#e59a54]">JARVIS</code> e o Service Worker
                  offline estão ativos:
                </p>
                <ol className="list-decimal pl-4 space-y-1.5 text-slate-300">
                  <li>
                    Abre a aplicação num separador direto do Chrome, Edge ou Brave (fora de iframe).
                  </li>
                  <li>
                    Clica no ícone <strong className="text-slate-100">Instalar J.A.R.V.I.S.</strong>{' '}
                    na barra de endereço para fixar na barra de tarefas Windows / macOS / Linux em
                    janela dedicada (<code className="text-slate-200">standalone</code>).
                  </li>
                </ol>
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[#e59a54] text-[#0b0d11] hover:bg-[#f0ac6b] transition-colors"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      data-testid="pwa-offline-indicator"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 shadow-lg"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Modo Offline — Cache local ativa</span>
    </div>
  );
};
