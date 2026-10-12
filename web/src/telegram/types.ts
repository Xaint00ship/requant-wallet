export type TelegramApp = {
  initData: string;
  initDataUnsafe: { user?: { id: number } };
  platform: string;
  viewportStableHeight: number;
  safeAreaInset?: { top: number; right: number; bottom: number; left: number };
  contentSafeAreaInset?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  ready: () => void;
  expand: () => void;
  isVersionAtLeast: (version: string) => boolean;
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  setBottomBarColor: (color: string) => void;
  enableClosingConfirmation: () => void;
  disableClosingConfirmation: () => void;
  disableVerticalSwipes: () => void;
  onEvent: (name: string, handler: () => void) => void;
  offEvent: (name: string, handler: () => void) => void;
  openLink: (url: string) => void;
  openTelegramLink: (url: string) => void;
  BackButton: {
    show: () => void;
    hide: () => void;
    onClick: (fn: () => void) => void;
    offClick: (fn: () => void) => void;
  };
};
declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramApp };
  }
}
