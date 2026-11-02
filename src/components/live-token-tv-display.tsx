"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Clock,
  Radio,
  Tv,
  CheckCircle2,
  AlertTriangle,
  Stethoscope,
  ChevronRight,
} from "lucide-react";
import type { Board } from "@/modules/calling/service";

// Audio chime using Web Audio API to avoid external asset dependency
function playClinicChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
      ctx.resume();
    }

    const now = ctx.currentTime;

    // First tone (E5 ~ 659.25 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.exponentialRampToValueAtTime(0.35, now + 0.05);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.6);

    // Second tone (G#5 ~ 830.61 Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(830.61, now + 0.25);
    gain2.gain.setValueAtTime(0.001, now + 0.25);
    gain2.gain.exponentialRampToValueAtTime(0.4, now + 0.3);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.95);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.25);
    osc2.stop(now + 1.0);
  } catch {
    // Audio autoplay restrictions or unsupported
  }
}

export function LiveTokenTvDisplay({
  org,
  orgName = "BBD Clinic",
}: {
  org: string;
  orgName?: string;
}) {
  const [boardData, setBoardData] = useState<Board | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [currentTime, setCurrentTime] = useState("");
  const [currentDate, setCurrentDate] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lastAnnounced, setLastAnnounced] = useState<string>("");

  // Track previous call status per doctor to trigger chime on updates
  const previousCallsRef = useRef<Map<string, { number: number; callCount: number }>>(new Map());

  // Clock tick (Asia/Kolkata - IST)
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        new Intl.DateTimeFormat("en-IN", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        }).format(now),
      );
      setCurrentDate(
        new Intl.DateTimeFormat("en-IN", {
          timeZone: "Asia/Kolkata",
          weekday: "long",
          day: "numeric",
          month: "short",
          year: "numeric",
        }).format(now),
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fullscreen listener
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleSoundToggle = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      if (next) {
        playClinicChime();
      }
      return next;
    });
  }, []);

  // SSE stream connection
  useEffect(() => {
    let lastHeartbeat = 0;
    const url = `/api/organizations/${encodeURIComponent(org)}/calling?view=display`;
    const source = new EventSource(url);

    const onUnavailable = () => {
      setIsConnected(false);
      setIsStale(true);
    };

    source.addEventListener("queue", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as Board;
        lastHeartbeat = Date.now();
        setIsConnected(true);
        setIsStale(false);
        setBoardData(data);

        // Check for new calls or recalls across doctors
        let newCallDetected = false;
        let callSummary = "";

        for (const doc of data.doctors) {
          if (doc.current) {
            const prev = previousCallsRef.current.get(doc.id);
            if (!prev || prev.number !== doc.current.number || prev.callCount !== doc.current.callCount) {
              newCallDetected = true;
              callSummary = `Token ${String(doc.current.number).padStart(3, "0")} → Room ${doc.room}`;
            }
          }
        }

        // Update ref
        const newMap = new Map<string, { number: number; callCount: number }>();
        for (const doc of data.doctors) {
          if (doc.current) {
            newMap.set(doc.id, { number: doc.current.number, callCount: doc.current.callCount });
          }
        }
        previousCallsRef.current = newMap;

        if (newCallDetected && callSummary) {
          setLastAnnounced(callSummary);
          if (soundEnabled) {
            playClinicChime();
          }
        }
      } catch {
        onUnavailable();
      }
    });

    source.addEventListener("unavailable", onUnavailable);
    source.onerror = onUnavailable;

    // Stale monitor (7-second timeout as per BBD continuity rules)
    const monitor = setInterval(() => {
      if (lastHeartbeat && Date.now() - lastHeartbeat > 7000) {
        onUnavailable();
      }
    }, 1000);

    return () => {
      clearInterval(monitor);
      source.close();
    };
  }, [org, soundEnabled]);

  return (
    <div className="flex min-h-screen flex-col bg-[#081816] font-sans text-white antialiased selection:bg-emerald-500/30">
      {/* Top Banner / TV Header */}
      <header className="border-b border-emerald-950/80 bg-[#0c2422]/90 px-6 py-4 shadow-xl backdrop-blur-md md:px-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Clinic Brand */}
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 shadow-lg shadow-emerald-900/30">
              <Tv className="h-6 w-6 text-[#081816]" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold tracking-widest text-emerald-400 uppercase">
                  Live Queue TV
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-950 px-2 py-0.5 text-[11px] font-medium text-emerald-300 border border-emerald-800/60">
                  <span className={`h-1.5 w-1.5 rounded-full ${isConnected && !isStale ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
                  {isConnected && !isStale ? "LIVE STREAM" : "RECONNECTING"}
                </span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">
                {orgName}
              </h1>
            </div>
          </div>

          {/* Controls & Live Clock */}
          <div className="flex items-center gap-4">
            {/* Audio Toggle */}
            <button
              type="button"
              onClick={handleSoundToggle}
              aria-label={soundEnabled ? "Mute chime sound" : "Enable chime sound"}
              className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold tracking-wide transition-all ${
                soundEnabled
                  ? "border-emerald-500 bg-emerald-500/15 text-emerald-300 shadow-sm shadow-emerald-500/20"
                  : "border-white/10 bg-white/5 text-gray-400 hover:bg-white/10"
              }`}
            >
              {soundEnabled ? (
                <>
                  <Volume2 className="h-4 w-4 text-emerald-400 animate-pulse" />
                  <span>CHIME ON</span>
                </>
              ) : (
                <>
                  <VolumeX className="h-4 w-4" />
                  <span>CHIME OFF</span>
                </>
              )}
            </button>

            {/* Fullscreen Button */}
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-white/10"
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              <span className="hidden sm:inline">{isFullscreen ? "Windowed" : "Fullscreen"}</span>
            </button>

            {/* Live Time Display */}
            <div className="hidden flex-col items-end border-l border-white/10 pl-4 sm:flex">
              <div className="flex items-center gap-1.5 text-xs text-emerald-300/80">
                <Clock className="h-3.5 w-3.5" />
                <span>IST (Asia/Kolkata)</span>
              </div>
              <p className="text-xl font-bold tabular-nums text-white md:text-2xl">
                {currentTime || "--:--:--"}
              </p>
              <p className="text-[11px] text-gray-400">{currentDate}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Calling Content */}
      <main className="flex-1 p-6 md:p-10">
        {/* Banner Alert for Stale or Offline Connection */}
        {(!isConnected || isStale) && (
          <div
            role="status"
            className="mb-8 flex items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-amber-200 backdrop-blur-sm"
          >
            <AlertTriangle className="h-6 w-6 shrink-0 text-amber-400 animate-bounce" />
            <div>
              <p className="font-semibold">Reconnecting to live queue stream...</p>
              <p className="text-sm text-amber-300/80">
                Token calls will resume automatically once connection is verified. Calling board is held stable.
              </p>
            </div>
          </div>
        )}

        {/* Dynamic Flash Announcement Banner */}
        {lastAnnounced && (
          <aside
            aria-live="assertive"
            className="mb-8 flex items-center justify-between rounded-xl border border-emerald-500/40 bg-gradient-to-r from-emerald-950/90 via-teal-950/80 to-emerald-950/90 px-6 py-3.5 shadow-lg shadow-emerald-950/50"
          >
            <div className="flex items-center gap-3">
              <Radio className="h-5 w-5 text-emerald-400 animate-pulse" />
              <span className="text-xs font-bold tracking-wider text-emerald-400 uppercase">
                Now Calling:
              </span>
              <span className="text-lg font-bold text-white tracking-wide">{lastAnnounced}</span>
            </div>
            <span className="text-xs text-emerald-400/80">Please proceed to your consultation room</span>
          </aside>
        )}

        {/* Doctor Calling Grid */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {boardData?.doctors.map((doctor) => {
            const isCurrentlyCalling = Boolean(doctor.current);
            const tokenFormatted = doctor.current
              ? String(doctor.current.number).padStart(3, "0")
              : "---";

            return (
              <section
                key={doctor.id}
                aria-label={`${doctor.name} - Room ${doctor.room}`}
                className={`relative flex flex-col justify-between overflow-hidden rounded-3xl border transition-all duration-300 ${
                  isCurrentlyCalling
                    ? "border-emerald-500/60 bg-gradient-to-b from-[#0e2c29] to-[#081816] shadow-2xl shadow-emerald-950/60 ring-2 ring-emerald-500/20"
                    : "border-white/10 bg-[#0d2220]/60 backdrop-blur-sm"
                }`}
              >
                {/* Doctor Room Header */}
                <div className="border-b border-white/10 bg-black/20 p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-medium text-emerald-300">
                        <Stethoscope className="h-4 w-4" />
                        <span>CONSULTATION ROOM</span>
                      </div>
                      <h2 className="mt-1 text-2xl font-bold tracking-tight text-white">
                        {doctor.name}
                      </h2>
                    </div>
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/80 px-3.5 py-1.5 text-right">
                      <p className="text-[10px] tracking-wider text-emerald-400 uppercase font-semibold">
                        Room
                      </p>
                      <p className="text-lg font-bold text-emerald-200">{doctor.room}</p>
                    </div>
                  </div>
                </div>

                {/* Hero Token Calling Section */}
                <div className="p-8 text-center" aria-live="polite" aria-atomic="true">
                  <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold tracking-widest uppercase">
                    {isCurrentlyCalling ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-300">
                        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                        NOW CALLING
                      </span>
                    ) : (
                      <span className="text-gray-400">READY FOR PATIENT</span>
                    )}
                  </div>

                  {/* Mega Token Number Display */}
                  <div className="my-4">
                    <p
                      data-testid={`calling-${doctor.id}`}
                      className={`font-black tabular-nums tracking-tighter ${
                        isCurrentlyCalling
                          ? "text-7xl md:text-8xl lg:text-9xl text-white drop-shadow-[0_4px_24px_rgba(52,211,153,0.3)]"
                          : "text-6xl md:text-7xl text-gray-600"
                      }`}
                    >
                      {tokenFormatted}
                    </p>
                  </div>

                  {/* Call counter or status */}
                  {doctor.current ? (
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-950/60 px-3.5 py-1 text-xs font-semibold text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      <span>
                        {doctor.current.callCount > 1
                          ? `RECALL #${doctor.current.callCount}`
                          : "FIRST CALL"}
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">Awaiting next patient queue</p>
                  )}
                </div>

                {/* Upcoming / Next Queue Section */}
                <div className="border-t border-white/10 bg-black/30 p-5">
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span className="font-semibold tracking-wider uppercase text-emerald-400/90">
                      Up Next
                    </span>
                    <span>
                      {doctor.next.length > 0
                        ? `${doctor.next.length} waiting`
                        : "Queue clear"}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {doctor.next.length > 0 ? (
                      doctor.next.slice(0, 5).map((num, idx) => (
                        <span
                          key={num}
                          className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm font-bold tabular-nums ${
                            idx === 0
                              ? "border-emerald-500/40 bg-emerald-950/70 text-emerald-200"
                              : "border-white/10 bg-white/5 text-gray-300"
                          }`}
                        >
                          {idx === 0 && <ChevronRight className="h-3 w-3 text-emerald-400" />}
                          Token {String(num).padStart(3, "0")}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-gray-500 italic">No waiting tokens in line</span>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>

        {/* Empty Doctors State */}
        {boardData && boardData.doctors.length === 0 && (
          <div className="rounded-3xl border border-white/10 bg-[#0d2220]/40 p-12 text-center text-gray-400">
            <Tv className="mx-auto h-12 w-12 text-gray-500 mb-4" />
            <h3 className="text-xl font-bold text-white">No Doctor Queues Active</h3>
            <p className="mt-2 text-sm max-w-md mx-auto">
              Please configure doctor rooms and queue tokens in the Clinic Reception portal to display real-time token calls.
            </p>
          </div>
        )}
      </main>

      {/* TV Bottom Footer Ticker */}
      <footer className="border-t border-emerald-950/90 bg-[#061413] px-6 py-3.5 text-xs text-gray-400">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-emerald-300 font-medium">BBD ATMA OS Waiting Room Kiosk</span>
            <span className="hidden sm:inline text-gray-600">|</span>
            <span className="hidden md:inline">Tokens are updated live via Server-Sent Events</span>
          </div>
          <p className="text-[11px] text-gray-400">
            Administrative token board · Patient names and medical data are never displayed.
          </p>
        </div>
      </footer>
    </div>
  );
}
