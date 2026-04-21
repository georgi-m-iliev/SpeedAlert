import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_WARNINGS = [
  { id: crypto.randomUUID(), speedKmh: 20, sound: "chirp", enabled: true },
  { id: crypto.randomUUID(), speedKmh: 30, sound: "double", enabled: true },
  { id: crypto.randomUUID(), speedKmh: 40, sound: "triple", enabled: true },
];

const REARM_DELTA_KMH = 5;
const LOCAL_STORAGE_KEY = "speed-alert-pwa-settings-v1";
const MAX_WARNINGS = 12;
const ACTIVE_NOTIFICATION_TAG = "speed-alert-monitoring";

const SOUND_OPTIONS = [
  { value: "chirp", label: "Chirp" },
  { value: "double", label: "Double" },
  { value: "triple", label: "Triple" },
  { value: "rise", label: "Rise" },
  { value: "fall", label: "Fall" },
  { value: "warble", label: "Warble" },
  { value: "long", label: "Long beep" },
  { value: "pulse", label: "Pulse" },
];

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function kmhFromMps(mps) {
  return mps == null ? null : mps * 3.6;
}

function formatSpeed(value) {
  return value == null || Number.isNaN(value) ? "--" : String(Math.round(value));
}

function getStoredSettings() {
  if (typeof window === "undefined") return DEFAULT_WARNINGS;
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return DEFAULT_WARNINGS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_WARNINGS;
    return parsed
      .map((item) => ({
        id: item.id || crypto.randomUUID(),
        speedKmh: clamp(Number(item.speedKmh) || 0, 1, 200),
        sound: SOUND_OPTIONS.some((opt) => opt.value === item.sound) ? item.sound : "chirp",
        enabled: item.enabled !== false,
      }))
      .sort((a, b) => a.speedKmh - b.speedKmh);
  } catch {
    return DEFAULT_WARNINGS;
  }
}

function AppBadge({ label, value, tone = "neutral" }) {
  const toneMap = {
    neutral: "bg-slate-800/70 text-slate-200 border-slate-700",
    good: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    warn: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    bad: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  };

  return (
    <div className={`rounded-2xl border px-3 py-2.5 ${toneMap[tone]}`}>
      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-medium leading-tight">{value}</div>
    </div>
  );
}

export default function SpeedAlertPwa() {
  const [warnings, setWarnings] = useState(getStoredSettings);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [currentSpeedKmh, setCurrentSpeedKmh] = useState(null);
  const [gpsAccuracy, setGpsAccuracy] = useState(null);
  const [gpsStatus, setGpsStatus] = useState("idle");
  const [permissionState, setPermissionState] = useState("unknown");
  const [lastAlert, setLastAlert] = useState(null);
  const [wakeLockState, setWakeLockState] = useState("idle");
  const [debugLog, setDebugLog] = useState([]);
  const [installState, setInstallState] = useState("unavailable");
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null);

  const watchIdRef = useRef(null);
  const wakeLockRef = useRef(null);
  const audioContextRef = useRef(null);
  const rearmStateRef = useRef(new Map());
  const previousPositionRef = useRef(null);
  const startedAtRef = useRef(null);

  const sortedWarnings = useMemo(
    () => [...warnings].sort((a, b) => a.speedKmh - b.speedKmh),
    [warnings]
  );

  const appendLog = useCallback((message) => {
    setDebugLog((prev) => {
      const next = [`${new Date().toLocaleTimeString()}: ${message}`, ...prev];
      return next.slice(0, 8);
    });
  }, []);

  const isAppInstalled = useCallback(() => {
    if (typeof window === "undefined") return false;
    const standaloneMedia = window.matchMedia?.("(display-mode: standalone)")?.matches;
    const iosStandalone = window.navigator.standalone === true;
    const twaStandalone = document.referrer?.startsWith("android-app://");
    return Boolean(standaloneMedia || iosStandalone || twaStandalone);
  }, []);

  const showMonitoringNotification = useCallback(async (speedKmh, gpsState) => {
    if (!("serviceWorker" in navigator) || !("Notification" in window)) {
      return;
    }

    if (Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        return;
      }
    }

    if (Notification.permission !== "granted") {
      return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification("Speed Alert active", {
        body: `Speed ${formatSpeed(speedKmh)} km/h • GPS ${gpsState}`,
        tag: ACTIVE_NOTIFICATION_TAG,
        renotify: false,
        requireInteraction: true,
        icon: "/icons/icon.svg",
        badge: "/icons/icon.svg",
      });
    } catch (error) {
      appendLog(`Notification failed: ${error.message}`);
    }
  }, [appendLog]);

  const clearMonitoringNotification = useCallback(async () => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const notifications = await registration.getNotifications({
        tag: ACTIVE_NOTIFICATION_TAG,
      });
      notifications.forEach((entry) => entry.close());
    } catch {
      // no-op
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sortedWarnings));
  }, [sortedWarnings]);

  useEffect(() => {
    if (isAppInstalled()) {
      setInstallState("installed");
      setDeferredInstallPrompt(null);
      return;
    }

    const onBeforeInstall = (event) => {
      if (isAppInstalled()) {
        setInstallState("installed");
        setDeferredInstallPrompt(null);
        return;
      }
      event.preventDefault();
      setDeferredInstallPrompt(event);
      setInstallState("available");
      appendLog("Install prompt is available");
    };

    const onInstalled = () => {
      setDeferredInstallPrompt(null);
      setInstallState("installed");
      appendLog("App installed");
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    const standaloneQuery = window.matchMedia?.("(display-mode: standalone)");
    const onStandaloneChange = () => {
      if (isAppInstalled()) {
        setInstallState("installed");
        setDeferredInstallPrompt(null);
      }
    };
    standaloneQuery?.addEventListener?.("change", onStandaloneChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      standaloneQuery?.removeEventListener?.("change", onStandaloneChange);
    };
  }, [appendLog, isAppInstalled]);

  useEffect(() => {
    if (!isMonitoring) {
      clearMonitoringNotification();
      return;
    }

    showMonitoringNotification(currentSpeedKmh, gpsStatus);

    const timer = window.setInterval(() => {
      showMonitoringNotification(currentSpeedKmh, gpsStatus);
    }, 15000);

    return () => window.clearInterval(timer);
  }, [clearMonitoringNotification, currentSpeedKmh, gpsStatus, isMonitoring, showMonitoringNotification]);

  useEffect(() => {
    let cancelled = false;

    async function checkPermission() {
      if (!navigator.permissions?.query) {
        setPermissionState("unsupported");
        return;
      }
      try {
        const status = await navigator.permissions.query({ name: "geolocation" });
        if (cancelled) return;
        setPermissionState(status.state);
        status.onchange = () => setPermissionState(status.state);
      } catch {
        setPermissionState("unknown");
      }
    }

    checkPermission();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onVisibilityChange = async () => {
      if (document.visibilityState === "visible" && isMonitoring) {
        await requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [isMonitoring]);

  const ensureAudioContext = useCallback(async () => {
    if (!audioContextRef.current) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioContextRef.current = new AudioCtx();
    }
    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  const playTone = useCallback(async (sound) => {
    const ctx = await ensureAudioContext();
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);

    const now = ctx.currentTime;
    const scheduleBeep = (start, duration, frequency, type = "sine", gain = 0.28) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, start);
      gainNode.gain.setValueAtTime(0.0001, start);
      gainNode.gain.exponentialRampToValueAtTime(gain, start + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gainNode);
      gainNode.connect(master);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    };

    master.gain.exponentialRampToValueAtTime(0.85, now + 0.01);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);

    switch (sound) {
      case "chirp":
        scheduleBeep(now, 0.18, 1180, "triangle");
        break;
      case "double":
        scheduleBeep(now, 0.12, 920, "square");
        scheduleBeep(now + 0.18, 0.12, 920, "square");
        break;
      case "triple":
        scheduleBeep(now, 0.1, 820, "square");
        scheduleBeep(now + 0.14, 0.1, 1020, "square");
        scheduleBeep(now + 0.28, 0.1, 1220, "square");
        break;
      case "rise": {
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(500, now);
        osc.frequency.exponentialRampToValueAtTime(1400, now + 0.35);
        gainNode.gain.setValueAtTime(0.0001, now);
        gainNode.gain.exponentialRampToValueAtTime(0.22, now + 0.03);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
        osc.connect(gainNode);
        gainNode.connect(master);
        osc.start(now);
        osc.stop(now + 0.4);
        break;
      }
      case "fall": {
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(1400, now);
        osc.frequency.exponentialRampToValueAtTime(520, now + 0.35);
        gainNode.gain.setValueAtTime(0.0001, now);
        gainNode.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
        osc.connect(gainNode);
        gainNode.connect(master);
        osc.start(now);
        osc.stop(now + 0.4);
        break;
      }
      case "warble":
        for (let i = 0; i < 5; i += 1) {
          scheduleBeep(now + i * 0.08, 0.06, i % 2 === 0 ? 1100 : 780, "square", 0.18);
        }
        break;
      case "long":
        scheduleBeep(now, 0.55, 880, "sine", 0.2);
        break;
      case "pulse":
        scheduleBeep(now, 0.08, 680, "triangle", 0.18);
        scheduleBeep(now + 0.11, 0.08, 680, "triangle", 0.18);
        scheduleBeep(now + 0.22, 0.18, 520, "triangle", 0.2);
        break;
      default:
        scheduleBeep(now, 0.18, 1000, "triangle");
    }
  }, [ensureAudioContext]);

  const requestWakeLock = useCallback(async () => {
    if (!navigator.wakeLock?.request) {
      setWakeLockState("unsupported");
      return;
    }
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      setWakeLockState("active");
      wakeLockRef.current.addEventListener("release", () => {
        setWakeLockState("released");
      });
    } catch (error) {
      setWakeLockState("failed");
      appendLog(`Wake lock failed: ${error.message}`);
    }
  }, [appendLog]);

  const releaseWakeLock = useCallback(async () => {
    try {
      await wakeLockRef.current?.release?.();
    } catch {
      // no-op
    } finally {
      wakeLockRef.current = null;
      setWakeLockState("idle");
    }
  }, []);

  const computeFallbackSpeed = useCallback((position) => {
    const prev = previousPositionRef.current;
    previousPositionRef.current = {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      ts: position.timestamp,
    };

    if (!prev) return null;

    const dtSeconds = (position.timestamp - prev.ts) / 1000;
    if (dtSeconds <= 0.25) return null;

    const toRad = (deg) => (deg * Math.PI) / 180;
    const earthRadiusM = 6371000;
    const dLat = toRad(position.coords.latitude - prev.lat);
    const dLon = toRad(position.coords.longitude - prev.lon);
    const lat1 = toRad(prev.lat);
    const lat2 = toRad(position.coords.latitude);

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceM = earthRadiusM * c;

    return distanceM / dtSeconds;
  }, []);

  const evaluateWarnings = useCallback(async (speedKmh) => {
    for (const warning of sortedWarnings) {
      if (!warning.enabled) continue;

      const state = rearmStateRef.current.get(warning.id) ?? { armed: true };

      if (!state.armed && speedKmh <= warning.speedKmh - REARM_DELTA_KMH) {
        rearmStateRef.current.set(warning.id, { armed: true });
        continue;
      }

      if (state.armed && speedKmh >= warning.speedKmh) {
        rearmStateRef.current.set(warning.id, { armed: false });
        setLastAlert({
          speedKmh: warning.speedKmh,
          sound: warning.sound,
          at: new Date().toLocaleTimeString(),
        });
        appendLog(`Alert fired at ${warning.speedKmh} km/h (${warning.sound})`);
        await playTone(warning.sound);
      }
    }
  }, [appendLog, playTone, sortedWarnings]);

  const stopMonitoring = useCallback(async () => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    await releaseWakeLock();
    rearmStateRef.current = new Map();
    previousPositionRef.current = null;
    startedAtRef.current = null;
    setIsMonitoring(false);
    setGpsStatus("idle");
    await clearMonitoringNotification();
    appendLog("Monitoring stopped");
  }, [appendLog, clearMonitoringNotification, releaseWakeLock]);

  const startMonitoring = useCallback(async () => {
    if (!navigator.geolocation?.watchPosition) {
      setGpsStatus("unsupported");
      appendLog("Geolocation not supported in this browser");
      return;
    }

    try {
      await ensureAudioContext();
      await requestWakeLock();
    } catch (error) {
      appendLog(`Startup issue: ${error.message}`);
    }

    rearmStateRef.current = new Map(sortedWarnings.map((w) => [w.id, { armed: true }]));
    previousPositionRef.current = null;
    startedAtRef.current = Date.now();
    setGpsStatus("acquiring");
    setIsMonitoring(true);
    await showMonitoringNotification(null, "acquiring");
    appendLog("Monitoring started");

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (position) => {
        const directSpeedMps = position.coords.speed;
        const fallbackSpeedMps = computeFallbackSpeed(position);
        const speedKmh = kmhFromMps(directSpeedMps ?? fallbackSpeedMps);

        setCurrentSpeedKmh(speedKmh);
        setGpsAccuracy(position.coords.accuracy ?? null);
        setGpsStatus(speedKmh == null ? "tracking-no-speed" : "tracking");

        if (speedKmh != null && speedKmh >= 0) {
          await evaluateWarnings(speedKmh);
        }
      },
      (error) => {
        const map = {
          1: "permission-denied",
          2: "position-unavailable",
          3: "timeout",
        };
        setGpsStatus(map[error.code] || "error");
        appendLog(`GPS error: ${error.message}`);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 3000,
      }
    );
  }, [appendLog, computeFallbackSpeed, ensureAudioContext, evaluateWarnings, requestWakeLock, showMonitoringNotification, sortedWarnings]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      clearMonitoringNotification();
      releaseWakeLock();
    };
  }, [clearMonitoringNotification, releaseWakeLock]);

  const addWarning = () => {
    if (warnings.length >= MAX_WARNINGS) return;
    const nextSpeed = warnings.length ? Math.min(200, Math.max(...warnings.map((w) => w.speedKmh)) + 10) : 20;
    const nextSound = SOUND_OPTIONS[warnings.length % SOUND_OPTIONS.length].value;
    setWarnings((prev) => [
      ...prev,
      { id: crypto.randomUUID(), speedKmh: nextSpeed, sound: nextSound, enabled: true },
    ]);
  };

  const updateWarning = (id, patch) => {
    setWarnings((prev) =>
      prev.map((warning) =>
        warning.id === id
          ? {
              ...warning,
              ...patch,
              speedKmh: patch.speedKmh != null ? clamp(Number(patch.speedKmh) || 1, 1, 200) : warning.speedKmh,
            }
          : warning
      )
    );
  };

  const deleteWarning = (id) => {
    setWarnings((prev) => prev.filter((warning) => warning.id !== id));
  };

  const promptInstall = async () => {
    if (!deferredInstallPrompt) {
      appendLog("Install prompt is not ready yet");
      return;
    }

    setInstallState("installing");
    deferredInstallPrompt.prompt();
    const choiceResult = await deferredInstallPrompt.userChoice;

    if (choiceResult.outcome === "accepted") {
      setInstallState("installed");
      appendLog("User accepted install prompt");
    } else {
      setInstallState("dismissed");
      appendLog("User dismissed install prompt");
    }
    setDeferredInstallPrompt(null);
  };

  const gpsTone = useMemo(() => {
    switch (gpsStatus) {
      case "tracking":
        return "good";
      case "acquiring":
      case "tracking-no-speed":
        return "warn";
      case "permission-denied":
      case "position-unavailable":
      case "timeout":
      case "error":
        return "bad";
      default:
        return "neutral";
    }
  }, [gpsStatus]);

  const installTone = useMemo(() => {
    if (installState === "installed") return "good";
    if (installState === "available" || installState === "installing") return "warn";
    if (installState === "dismissed") return "bad";
    return "neutral";
  }, [installState]);

  const monitoringDuration = startedAtRef.current
    ? Math.floor((Date.now() - startedAtRef.current) / 1000)
    : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl p-3 sm:p-4 md:p-8">
        <div className="mb-4 rounded-[1.75rem] border border-slate-800 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/50 backdrop-blur sm:mb-6 sm:p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-sky-300">Speed Alert PWA</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl md:text-5xl">GPS speed tones for your course drills</h1>
              <p className="mt-3 max-w-2xl text-sm text-slate-300 sm:text-base">
                Fast threshold alerts, 5 km/h re-arm logic, screen wake lock, and install support.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <AppBadge label="GPS" value={gpsStatus} tone={gpsTone} />
              <AppBadge label="Permission" value={permissionState} tone={permissionState === "granted" ? "good" : permissionState === "denied" ? "bad" : "warn"} />
              <AppBadge label="Wake lock" value={wakeLockState} tone={wakeLockState === "active" ? "good" : wakeLockState === "failed" ? "bad" : "warn"} />
              <AppBadge label="Install" value={installState} tone={installTone} />
              <AppBadge label="Re-arm" value={`${REARM_DELTA_KMH} km/h`} tone="neutral" />
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-[1.75rem] border border-slate-800 bg-slate-900/70 p-4 shadow-xl shadow-slate-950/30 sm:p-6">
            <div className="grid grid-cols-[1fr_auto] items-start gap-3 sm:gap-4">
              <div className="min-w-0">
                <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Live speed</p>
                <div className="mt-2 flex items-end gap-2 sm:gap-3">
                  <span className="text-5xl font-semibold tabular-nums leading-none sm:text-7xl md:text-8xl">{formatSpeed(currentSpeedKmh)}</span>
                  <span className="pb-1 text-xl text-slate-400 sm:pb-3 sm:text-2xl">km/h</span>
                </div>
              </div>

              <div className="min-w-[132px] rounded-3xl border border-slate-800 bg-slate-950/50 p-3 text-right sm:min-w-[170px] sm:p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Accuracy</div>
                <div className="mt-1 text-xl font-medium tabular-nums sm:text-2xl">
                  {gpsAccuracy == null ? "--" : `${gpsAccuracy.toFixed(0)} m`}
                </div>
                <div className="mt-3 text-xs uppercase tracking-[0.2em] text-slate-500">Session</div>
                <div className="mt-1 text-base font-medium tabular-nums sm:text-lg">{isMonitoring ? `${monitoringDuration}s` : "stopped"}</div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2.5 sm:mt-6 sm:gap-3">
              {!isMonitoring ? (
                <button
                  onClick={startMonitoring}
                  className="rounded-2xl bg-emerald-400 px-4 py-3 text-base font-semibold text-slate-950 transition hover:scale-[1.01] active:scale-[0.99] sm:px-6 sm:py-4 sm:text-lg"
                >
                  Start monitoring
                </button>
              ) : (
                <button
                  onClick={stopMonitoring}
                  className="rounded-2xl bg-rose-400 px-4 py-3 text-base font-semibold text-slate-950 transition hover:scale-[1.01] active:scale-[0.99] sm:px-6 sm:py-4 sm:text-lg"
                >
                  Stop monitoring
                </button>
              )}

              <button
                onClick={() => requestWakeLock()}
                className="rounded-2xl border border-slate-700 px-4 py-3 text-base font-medium text-slate-100 transition hover:bg-slate-800 sm:px-5 sm:py-4"
              >
                Re-acquire wake lock
              </button>

              <button
                onClick={async () => {
                  try {
                    await ensureAudioContext();
                    await playTone("triple");
                    appendLog("Speaker test played");
                  } catch (error) {
                    appendLog(`Audio test failed: ${error.message}`);
                  }
                }}
                className="rounded-2xl border border-slate-700 px-4 py-3 text-base font-medium text-slate-100 transition hover:bg-slate-800 sm:px-5 sm:py-4"
              >
                Test speaker
              </button>

              {installState !== "installed" && (
                <button
                  onClick={promptInstall}
                  disabled={!deferredInstallPrompt}
                  className="rounded-2xl border border-sky-400/50 px-4 py-3 text-base font-medium text-sky-200 transition hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-50 sm:px-5 sm:py-4"
                >
                  Install app
                </button>
              )}
            </div>

            <div className="mt-6 rounded-3xl border border-slate-800 bg-slate-950/50 p-4">
              <div className="text-sm uppercase tracking-[0.2em] text-slate-500">Last alert</div>
              {lastAlert ? (
                <div className="mt-2 text-lg text-slate-200">
                  <span className="font-semibold">{lastAlert.speedKmh} km/h</span> via <span className="font-semibold">{lastAlert.sound}</span> at {lastAlert.at}
                </div>
              ) : (
                <div className="mt-2 text-slate-400">No alert fired yet.</div>
              )}
            </div>
          </section>

          <section className="rounded-[1.75rem] border border-slate-800 bg-slate-900/70 p-4 shadow-xl shadow-slate-950/30 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Warnings</p>
                <h2 className="mt-1 text-2xl font-semibold">Threshold list</h2>
              </div>
              <button
                onClick={addWarning}
                disabled={warnings.length >= MAX_WARNINGS}
                className="rounded-2xl border border-slate-700 px-4 py-3 text-sm font-medium transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Add warning
              </button>
            </div>

            <div className="mt-4 space-y-3 sm:mt-5">
              {sortedWarnings.map((warning, index) => (
                <div key={warning.id} className="grid gap-3 rounded-3xl border border-slate-800 bg-slate-950/50 p-3 sm:p-4 md:grid-cols-[80px_1fr_1fr_auto_auto] md:items-center">
                  <div className="text-sm font-medium text-slate-400">#{index + 1}</div>

                  <label className="block">
                    <span className="mb-2 block text-sm text-slate-400">Speed</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="200"
                        step="1"
                        value={warning.speedKmh}
                        onChange={(e) => updateWarning(warning.id, { speedKmh: e.target.value })}
                        className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-lg tabular-nums outline-none ring-0 transition focus:border-sky-400"
                      />
                      <span className="text-slate-400">km/h</span>
                    </div>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm text-slate-400">Sound</span>
                    <select
                      value={warning.sound}
                      onChange={(e) => updateWarning(warning.id, { sound: e.target.value })}
                      className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none transition focus:border-sky-400"
                    >
                      {SOUND_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex items-end gap-2">
                    <button
                      onClick={() => playTone(warning.sound)}
                      className="rounded-2xl border border-slate-700 px-4 py-3 text-sm font-medium transition hover:bg-slate-800"
                    >
                      Preview
                    </button>
                    <label className="flex items-center gap-2 rounded-2xl border border-slate-700 px-4 py-3 text-sm">
                      <input
                        type="checkbox"
                        checked={warning.enabled}
                        onChange={(e) => updateWarning(warning.id, { enabled: e.target.checked })}
                        className="h-4 w-4"
                      />
                      Enabled
                    </label>
                  </div>

                  <button
                    onClick={() => deleteWarning(warning.id)}
                    className="rounded-2xl border border-rose-500/30 px-4 py-3 text-sm font-medium text-rose-300 transition hover:bg-rose-500/10"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="mt-6 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[1.75rem] border border-slate-800 bg-slate-900/70 p-4 shadow-xl shadow-slate-950/30 sm:p-6">
            <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Behavior notes</p>
            <div className="mt-4 space-y-3 text-slate-300">
              <p>
                Alerts fire immediately when the current speed meets or exceeds a threshold.
              </p>
              <p>
                Each threshold re-arms only after speed drops at least <span className="font-semibold text-slate-100">{REARM_DELTA_KMH} km/h</span> below that threshold.
              </p>
              <p>
                If the browser does not provide <code className="rounded bg-slate-800 px-1 py-0.5">coords.speed</code>, the app estimates speed from GPS position deltas.
              </p>
              <p>
                Install on Android: open this site in Chrome and tap Install app (or use the three-dot menu).
              </p>
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-slate-800 bg-slate-900/70 p-4 shadow-xl shadow-slate-950/30 sm:p-6">
            <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Activity log</p>
            <div className="mt-4 space-y-2">
              {debugLog.length ? (
                debugLog.map((entry, idx) => (
                  <div key={`${entry}-${idx}`} className="rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm text-slate-300">
                    {entry}
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm text-slate-400">
                  Nothing yet. Hit Start monitoring to begin.
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
