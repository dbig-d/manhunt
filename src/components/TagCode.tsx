import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { buzz } from "../lib/hooks";

const PREFIX = "MH1:";
const ROTATE_MS = 20_000;

/**
 * The hider's side: a QR code (with the digits as backup) that changes every 20 s.
 * Pure black on white with the highest error correction, so it still reads from
 * a distance, at an angle, or on a scratched screen.
 */
export function TagCodeCard({ code, refreshAt, now }: { code: string; refreshAt: number | null; now: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [big, setBig] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(PREFIX + code, {
      errorCorrectionLevel: "H",
      margin: 2,
      width: 720,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then(setSrc)
      .catch(() => setSrc(null));
  }, [code]);

  const left = refreshAt ? Math.max(0, refreshAt - now) : null;

  return (
    <div className="tagcode">
      {src && (
        <button className="tagcode-qr" onClick={() => setBig(true)} aria-label="Show the code full screen">
          <img src={src} alt="Your tag QR code" />
        </button>
      )}
      <div className="tagcode-digits">{code}</div>
      {left !== null && (
        <div className="tagcode-timer">
          <div className="tagcode-bar" style={{ width: `${(left / ROTATE_MS) * 100}%` }} />
          <span>New code in {Math.ceil(left / 1000)}s</span>
        </div>
      )}
      <p className="setting-hint">
        Caught? Show this to the seeker. Tap the code to make it fill the screen, and turn your brightness up. It changes every 20
        seconds, so screenshots won't work.
      </p>
      {big &&
        src &&
        createPortal(
          <button className="tagcode-full" onClick={() => setBig(false)} aria-label="Close full screen code">
            <img src={src} alt="Your tag QR code" />
            <span className="tagcode-full-digits">{code}</span>
            <small>Tap to close</small>
          </button>,
          document.body,
        )}
    </div>
  );
}

// Camera extras some phones support (mostly Android). Not in TypeScript's built-in types yet.
type CameraCaps = MediaTrackCapabilities & {
  zoom?: { min: number; max: number; step?: number };
  torch?: boolean;
  focusMode?: string[];
};
type CameraConstraint = MediaTrackConstraintSet & { zoom?: number; torch?: boolean; focusMode?: string };
type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };

const MAX_DIGITAL_ZOOM = 4;
const DECODE_SIZE = 640;

/**
 * The seeker's side: scan with the camera, or type the 4 digits.
 * Zoom uses the camera's real zoom when the phone allows it, otherwise it crops and
 * enlarges the middle of the picture, which also helps read small or distant codes.
 */
export function TagScanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [typed, setTyped] = useState("");
  const [zoom, setZoom] = useState(1);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; hardware: boolean }>({ min: 1, max: MAX_DIGITAL_ZOOM, hardware: false });
  const [torch, setTorch] = useState<boolean | null>(null); // null = phone has no torch control
  const [found, setFound] = useState(false);
  const zoomRef = useRef({ value: 1, hardware: false });
  zoomRef.current = { value: zoom, hardware: zoomRange.hardware };
  const done = useRef(false);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  // Start the camera and keep scanning frames.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const BarcodeDetectorCtor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    const detector = BarcodeDetectorCtor ? new BarcodeDetectorCtor({ formats: ["qr_code"] }) : null;

    const accept = (data: string | undefined) => {
      if (done.current || !data?.startsWith(PREFIX)) return false;
      done.current = true;
      setFound(true);
      buzz(80);
      setTimeout(() => onCodeRef.current(data.slice(PREFIX.length)), 250);
      return true;
    };

    const scan = async () => {
      const v = video.current;
      if (stopped || done.current) return;
      if (v && ctx && v.videoWidth) {
        // What's inside the square viewfinder, shrunk further by digital zoom.
        const digital = zoomRef.current.hardware ? 1 : zoomRef.current.value;
        const side = Math.min(v.videoWidth, v.videoHeight) / digital;
        const sx = (v.videoWidth - side) / 2;
        const sy = (v.videoHeight - side) / 2;
        const size = Math.min(DECODE_SIZE, Math.round(side * 2));
        canvas.width = canvas.height = size;
        ctx.drawImage(v, sx, sy, side, side, 0, 0, size, size);
        let hit = false;
        if (detector) {
          try {
            hit = accept((await detector.detect(canvas))[0]?.rawValue);
          } catch {
            // fall through to jsQR
          }
        }
        if (!hit) {
          const img = ctx.getImageData(0, 0, size, size);
          accept(jsQR(img.data, size, size, { inversionAttempts: "attemptBoth" })?.data);
        }
      }
      timer = setTimeout(scan, 120);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        const caps = (track.getCapabilities?.() ?? {}) as CameraCaps;
        if (caps.focusMode?.includes("continuous")) {
          track.applyConstraints({ advanced: [{ focusMode: "continuous" } as CameraConstraint] }).catch(() => {});
        }
        if (caps.zoom && caps.zoom.max > caps.zoom.min) {
          setZoomRange({ min: caps.zoom.min, max: Math.min(caps.zoom.max, 10), hardware: true });
          setZoom(caps.zoom.min);
        }
        if (caps.torch) setTorch(false);
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        setReady(true);
        scan();
      } catch {
        setCamError("Camera not available. Type the code instead.");
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
    };
  }, []);

  const applyZoom = (z: number) => {
    const clamped = Math.min(zoomRange.max, Math.max(zoomRange.min, z));
    setZoom(clamped);
    if (zoomRange.hardware) {
      trackRef.current?.applyConstraints({ advanced: [{ zoom: clamped } as CameraConstraint] }).catch(() => {});
    }
  };

  const toggleTorch = () => {
    if (torch === null) return;
    trackRef.current
      ?.applyConstraints({ advanced: [{ torch: !torch } as CameraConstraint] })
      .then(() => setTorch(!torch))
      .catch(() => setTorch(null));
  };

  // Pinch to zoom on the camera picture.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; zoom: number } | null>(null);
  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const onPointerDown = (e: ReactPointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) pinchStart.current = { dist: spread(), zoom };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinchStart.current) {
      applyZoom(pinchStart.current.zoom * (spread() / pinchStart.current.dist));
    }
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
  };

  const presets = [1, 2, 3, 5].filter((z) => z >= zoomRange.min && z <= zoomRange.max);

  return (
    <div className="scanner">
      {!camError ? (
        <div
          className={`scanner-view ${found ? "scanner-view--found" : ""}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <video
            ref={video}
            playsInline
            muted
            className="scanner-video"
            style={zoomRange.hardware ? undefined : { transform: `scale(${zoom})` }}
          />
          <div className="scanner-frame" aria-hidden="true" />
          {!ready && <div className="scanner-status">Starting camera…</div>}
          {found && <div className="scanner-status scanner-status--found">Got it!</div>}
          {torch !== null && (
            <button className={`scanner-torch ${torch ? "on" : ""}`} onClick={toggleTorch} aria-label="Toggle flashlight">
              ☀
            </button>
          )}
        </div>
      ) : (
        <p className="setting-hint">{camError}</p>
      )}

      {!camError && (
        <div className="scanner-zoom">
          <div className="scanner-zoom-presets">
            {presets.map((z) => (
              <button key={z} className={Math.abs(zoom - z) < 0.05 ? "on" : ""} onClick={() => applyZoom(z)}>
                {z}×
              </button>
            ))}
          </div>
          <input
            type="range"
            aria-label="Zoom"
            min={zoomRange.min}
            max={zoomRange.max}
            step={0.1}
            value={zoom}
            onChange={(e) => applyZoom(Number(e.target.value))}
          />
          <p className="setting-hint">Pinch the picture or use the slider to zoom in on far-away codes.</p>
        </div>
      )}

      <div className="join-row">
        <input
          className="code-input"
          inputMode="numeric"
          placeholder="0000"
          maxLength={4}
          value={typed}
          onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && typed.length === 4 && onCode(typed)}
        />
        <button className="btn btn-primary" disabled={typed.length !== 4} onClick={() => onCode(typed)}>
          Tag
        </button>
      </div>
    </div>
  );
}
