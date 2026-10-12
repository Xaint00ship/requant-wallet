import type { Platform } from "../platform";
import type { TelegramApp } from "./types";
import { deviceDisk } from "./disk";
import { fileBridge } from "./download";
export function connectTelegram(tg: TelegramApp): Platform {
  const id = tg.initDataUnsafe.user?.id;
  if (!tg.initData || !id || !Number.isSafeInteger(id) || id < 1)
    throw new Error("Open this wallet from @requant_wallet_bot in Telegram.");
  const disk = deviceDisk(id),
    files = fileBridge(tg);
  document.documentElement.classList.add("telegram-wallet");
  const viewport = () => {
    const safe = tg.safeAreaInset,
      content = tg.contentSafeAreaInset;
    for (const edge of ["top", "right", "bottom", "left"] as const) {
      const value =
        Math.max(0, safe?.[edge] ?? 0) + Math.max(0, content?.[edge] ?? 0);
      document.documentElement.style.setProperty(
        `--wallet-safe-${edge}`,
        `${value}px`,
      );
    }
  };
  tg.ready();
  tg.expand();
  if (tg.isVersionAtLeast("6.1")) {
    tg.setHeaderColor("#f4f1e9");
    tg.setBackgroundColor("#f4f1e9");
  }
  if (tg.isVersionAtLeast("7.10")) tg.setBottomBarColor("#ffffff");
  if (tg.isVersionAtLeast("7.7")) tg.disableVerticalSwipes();
  viewport();
  for (const event of [
    "safeAreaChanged",
    "contentSafeAreaChanged",
    "viewportChanged",
  ])
    tg.onEvent(event, viewport);
  document.addEventListener("click", (event) => {
    const target = (event.target as Element).closest?.(
      "a[href]",
    ) as HTMLAnchorElement | null;
    if (!target || event.defaultPrevented || target.download) return;
    const url = new URL(target.href);
    if (
      url.protocol !== "https:" ||
      (url.origin === location.origin &&
        target.target !== "_blank" &&
        url.pathname.startsWith("/wallet/"))
    )
      return;
    event.preventDefault();
    if (url.hostname === "t.me") tg.openTelegramLink(url.href);
    else tg.openLink(url.href);
  });
  return {
    kind: "telegram",
    ...disk,
    lock: () => {},
    download: files.download,
    fileDialogOpen: files.active,
    updates: () => null,
    copy: async (text) => {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {}
      const input = document.createElement("textarea");
      input.value = text;
      input.readOnly = true;
      input.className = "telegram-copy";
      document.body.append(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      if (!copied)
        throw new Error(
          "Clipboard unavailable. Select and copy the full address.",
        );
    },
    share: async (address) => {
      tg.openTelegramLink(
        `https://t.me/share/url?url=${encodeURIComponent(`https://requant.network/explorer/address/${address}`)}&text=${encodeURIComponent(`My Requant testnet address: ${address}`)}`,
      );
    },
    navigation: ({ back, canGoBack, blocked, lock }) => {
      canGoBack ? tg.BackButton.show() : tg.BackButton.hide();
      if (tg.isVersionAtLeast("6.2"))
        blocked
          ? tg.enableClosingConfirmation()
          : tg.disableClosingConfirmation();
      const inactive = () => {
        if (!files.active()) lock();
      };
      tg.BackButton.onClick(back);
      tg.onEvent("deactivated", inactive);
      return () => {
        tg.BackButton.offClick(back);
        tg.offEvent("deactivated", inactive);
      };
    },
  };
}
