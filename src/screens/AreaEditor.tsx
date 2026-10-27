import { useState } from "react";
import type { Boundary, LatLng } from "../../shared/protocol";
import { LIMITS } from "../../shared/settings";
import Icon from "../components/Icon";
import MapView from "../components/MapView";
import { Segmented } from "../components/ui";
import { DEFAULT_CENTER, useGps } from "../lib/location";
import { deleteArea, describeBoundary, loadAreas, saveArea, type SavedArea } from "../lib/savedAreas";

function Slider({ label, value, min, max, step = 5, unit, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void;
}) {
  return (
    <label className="slider">
      <span>
        {label} <b>{value} {unit}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

/** Host-only full-screen editor for the play area. Tap the map to move the center. */
export default function AreaEditor({ initial, onSave, onCancel }: {
  initial: Boundary | null;
  onSave: (b: Boundary) => void;
  onCancel: () => void;
}) {
  const gps = useGps();
  const [draft, setDraft] = useState<Boundary>(() => initial ?? { shape: "circle", center: gps.pos ?? DEFAULT_CENTER, radius: 150 });
  const [fitKey, setFitKey] = useState(0);
  const [areas, setAreas] = useState<SavedArea[]>(loadAreas);
  const [saveName, setSaveName] = useState("");

  const setCenter = (center: LatLng) => setDraft((d) => ({ ...d, center }));
  const refit = () => setFitKey((k) => k + 1);

  const setShape = (shape: Boundary["shape"]) => {
    setDraft((d) =>
      shape === "circle"
        ? { shape, center: d.center, radius: d.shape === "circle" ? d.radius : Math.round(Math.min(d.width, d.height) / 2) }
        : { shape, center: d.center, width: d.shape === "rect" ? d.width : d.radius * 2, height: d.shape === "rect" ? d.height : d.radius * 2, rotation: 0 },
    );
    refit();
  };

  return (
    <div className="area-editor">
      <div className="area-top">
        <button className="icon-btn" onClick={onCancel} aria-label="Cancel">
          <Icon name="x" />
        </button>
        <div className="area-hint">Tap the map to move the center</div>
        <button className="icon-btn" disabled={!gps.pos} onClick={() => gps.pos && (setCenter(gps.pos), refit())} aria-label="Center on me">
          <Icon name="crosshair" />
        </button>
      </div>
      <MapView
        boundary={draft}
        me={gps.pos ? { pos: gps.pos, accuracy: gps.accuracy, role: null } : null}
        onMapClick={setCenter}
        fitKey={`area-${fitKey}`}
        className="area-map"
      />

      <div className="area-panel">
        <Segmented
          value={draft.shape}
          onChange={setShape}
          options={[
            { value: "circle", label: "Circle" },
            { value: "rect", label: "Rectangle" },
          ]}
        />
        {draft.shape === "circle" ? (
          <Slider label="Radius" value={draft.radius} min={LIMITS.radius[0]} max={1000} unit="m" onChange={(radius) => setDraft({ ...draft, radius })} />
        ) : (
          <>
            <Slider label="Width" value={draft.width} min={LIMITS.rectSide[0]} max={1500} unit="m" onChange={(width) => setDraft({ ...draft, width })} />
            <Slider label="Height" value={draft.height} min={LIMITS.rectSide[0]} max={1500} unit="m" onChange={(height) => setDraft({ ...draft, height })} />
            <Slider label="Rotation" value={draft.rotation} min={0} max={179} step={1} unit="°" onChange={(rotation) => setDraft({ ...draft, rotation })} />
          </>
        )}

        <details className="saved-areas">
          <summary>
            <Icon name="pin" size={16} />
            Saved areas ({areas.length})
          </summary>
          {areas.map((a) => (
            <div key={a.name} className="saved-area">
              <div>
                <b>{a.name}</b>
                <small>{describeBoundary(a.boundary)}</small>
              </div>
              <button className="btn btn--sm" onClick={() => (setDraft(a.boundary), refit())}>
                Load
              </button>
              <button className="icon-btn" aria-label={`Delete ${a.name}`} onClick={() => setAreas(deleteArea(a.name))}>
                <Icon name="x" size={18} />
              </button>
            </div>
          ))}
          <div className="row">
            <input placeholder="Name this area" value={saveName} maxLength={30} onChange={(e) => setSaveName(e.target.value)} />
            <button
              className="btn flex-none"
              disabled={!saveName.trim()}
              onClick={() => {
                setAreas(saveArea(saveName.trim(), draft));
                setSaveName("");
              }}
            >
              Save
            </button>
          </div>
        </details>

        <div className="row">
          <button className="btn" onClick={refit}>
            <Icon name="target" size={18} />
            Fit
          </button>
          <button className="btn btn--primary" style={{ flex: 2 }} onClick={() => onSave(draft)}>
            <Icon name="check" />
            Use this area
          </button>
        </div>
      </div>
    </div>
  );
}
