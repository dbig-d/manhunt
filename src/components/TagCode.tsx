import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";

const PREFIX = "MH1:";

/** The hider's side: a QR code (and digits as backup) that changes every 20 s. */
export function TagCodeCard({ code }: { code: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(PREFIX + code, { margin: 1, width: 260, color: { dark: "#07090d", light: "#e9fff3" } })
      .then(setSrc)
      .catch(() => setSrc(null));
  }, [code]);
  return (
    <div className="tagcode">
      {src && <img src={src} alt="Your tag QR code" width={220} height={220} />}
      <div className="tagcode-digits">{code}</div>
      <p className="setting-hint">Caught? Show this to the seeker. It changes every 20 seconds, so screenshots won't work.</p>
    </div>
  );
}

/** The seeker's side: scan with the camera, or type the 4 digits. */
export function TagScanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const done = useRef(false);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        const v = video.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();
        timer = setInterval(() => {
          if (done.current || !ctx || !v.videoWidth) return;
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          ctx.drawImage(v, 0, 0);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const found = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
          if (found?.data.startsWith(PREFIX)) {
            done.current = true;
            onCodeRef.current(found.data.slice(PREFIX.length));
          }
        }, 200);
      } catch {
        setCamError("Camera not available. Type the code instead.");
      }
    })();

    return () => {
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="scanner">
      {!camError ? <video ref={video} playsInline muted className="scanner-video" /> : <p className="setting-hint">{camError}</p>}
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
