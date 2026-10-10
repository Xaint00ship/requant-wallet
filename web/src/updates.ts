import { platform } from "./platform";
import { useEffect, useRef, useState } from "react";
import { canAutoApply } from "../../src/update-policy.mjs";

export function useWebUpdates(
  blocked: boolean,
  beforeReload: () => void,
  prepare: () => void,
  cancel: () => void,
) {
  const [waiting, setWaiting] = useState(false);
  const [status, setStatus] = useState("");
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const policy = useRef({ blocked, beforeReload, prepare, cancel });
  policy.current = { blocked, beforeReload, prepare, cancel };
  const lastTouch = useRef(Date.now());
  const applying = useRef(false);
  function apply() {
    if (
      policy.current.blocked ||
      applying.current ||
      !registration.current?.waiting
    )
      return;
    applying.current = true;
    setStatus("Checking that all wallet tabs can update safely…");
    registration.current.waiting.postMessage({ type: "REQUEST_ACTIVATE" });
    setTimeout(() => {
      applying.current = false;
    }, 5000);
  }
  useEffect(() => {
    if (platform() || !import.meta.env.PROD || !("serviceWorker" in navigator))
      return;
    let disposed = false;
    const controlled = !!navigator.serviceWorker.controller;
    const touch = () => {
      lastTouch.current = Date.now();
    };
    const changed = () => {
      if (controlled) {
        policy.current.beforeReload();
        location.reload();
      }
    };
    const message = (event: MessageEvent) => {
      if (event.data?.type === "QUERY_SAFE_UPDATE") {
        const safe = !policy.current.blocked;
        if (safe) {
          policy.current.prepare();
          setTimeout(() => policy.current.cancel(), 5000);
        }
        event.ports[0]?.postMessage({ safe });
      }
      if (event.data?.type === "UPDATE_DEFERRED")
        setStatus(
          "Another wallet tab is busy. The update will retry when it is safe.",
        );
    };
    async function register() {
      try {
        const reg = await navigator.serviceWorker.register("/wallet/sw.js", {
          scope: "/wallet/",
          updateViaCache: "none",
        });
        if (disposed) return;
        registration.current = reg;
        const report = () => {
          if (!disposed) {
            setWaiting(!!reg.waiting);
            if (reg.waiting)
              setStatus(
                "A new version is ready. Your wallet data stays on this device.",
              );
          }
        };
        reg.addEventListener("updatefound", () => {
          reg.installing?.addEventListener("statechange", report);
        });
        report();
        await reg.update();
      } catch {
        /* Offline is supported; the next check retries. */
      }
    }
    const check = () => {
      if (!document.hidden) void registration.current?.update().catch(() => {});
    };
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    navigator.serviceWorker.addEventListener("message", message);
    document.addEventListener("pointerdown", touch);
    document.addEventListener("keydown", touch);
    document.addEventListener("visibilitychange", check);
    const timer = setInterval(check, 15 * 60_000);
    void register();
    return () => {
      disposed = true;
      clearInterval(timer);
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
      navigator.serviceWorker.removeEventListener("message", message);
      document.removeEventListener("pointerdown", touch);
      document.removeEventListener("keydown", touch);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  const action = useRef(apply);
  action.current = apply;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      if (
        canAutoApply({
          locked: true,
          blocked: policy.current.blocked,
          idleMs: Date.now() - lastTouch.current,
          visible: !document.hidden,
        })
      )
        action.current();
    }, 5000);
    return () => clearInterval(timer);
  }, [waiting]);
  return { waiting, status, apply };
}
