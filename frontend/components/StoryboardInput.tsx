"use client";

import React from "react";

interface StoryboardInputProps {
  storyboard: string;
  onChangeStoryboard: (text: string) => void;
  onClear: () => void;
  disabled?: boolean;
}

const SAMPLE_STORYBOARD = `[MỞ CẢNH: Dissolve in]
Scene 1
Duration: 5s
Setting: Deep dark forest at night, glowing mushrooms
Characters: Goku, Vegeta
Props: Dragon Ball 4-star

[IMAGE DATA]
Shot Type: Medium Close-up, Low Angle
Lighting: Bioluminescent green rim light, dark moody night
Visual: Goku standing with arms crossed looking intensely at Vegeta, dragon ball glowing on the ground.

[MOTION DATA]
Character Motion: Goku turns his head slowly to the left with a confident smirk.
Camera Motion: Camera slow pan right and subtle dolly zoom in.

[AUDIO DATA]
Dialogue: Goku: "Chúng ta không thể dừng lại ở đây được!"
Sound FX: Wind blowing through trees, crystal hum.
[KẾT CẢNH: Cut to next scene]

------------------------------------------------

Scene 2
Duration: 4s
Setting: Deep dark forest at night
Characters: Vegeta
Props: None

[IMAGE DATA]
Shot Type: Close-up, High Angle
Lighting: Dramatic side lighting
Visual: Vegeta clenching his fist, energy aura beginning to flicker.

[MOTION DATA]
Character Motion: Vegeta powers up with golden energy aura surrounding his body.
Camera Motion: Camera quick zoom in.

[AUDIO DATA]
Dialogue: Vegeta: "Hãy xem sức mạnh thực sự của ta đây!"
Sound FX: Energy charging up sound.`;

export default function StoryboardInput({
  storyboard,
  onChangeStoryboard,
  onClear,
  disabled = false,
}: StoryboardInputProps) {
  
  const handleLoadSample = () => {
    onChangeStoryboard(SAMPLE_STORYBOARD);
  };

  return (
    <div className="glass-panel" style={{ height: "100%", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h3 style={{ fontSize: "1.2rem", marginBottom: "4px", display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: "var(--accent-cyan)" }}></span>
            Storyboard Text
          </h3>
          <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            Write or paste your story sequence below.
          </p>
        </div>
        
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleLoadSample}
            disabled={disabled}
            style={{
              padding: "6px 12px",
              fontSize: "0.8rem",
              borderRadius: "var(--border-radius-sm)",
            }}
          >
            Load Sample
          </button>
          
          <button
            type="button"
            className="btn-secondary"
            onClick={onClear}
            disabled={disabled}
            style={{
              padding: "6px 12px",
              fontSize: "0.8rem",
              borderRadius: "var(--border-radius-sm)",
              color: "var(--danger)",
              borderColor: "rgba(239, 68, 68, 0.2)",
            }}
          >
            Clear
          </button>
        </div>
      </div>

      <div style={{ flexGrow: 1, position: "relative" }}>
        <textarea
          value={storyboard}
          onChange={(e) => onChangeStoryboard(e.target.value)}
          disabled={disabled}
          placeholder="Write your story here...
Example:
Scene 1 (6s)
Lisa is waving..."
          style={{
            width: "100%",
            height: "100%",
            minHeight: "300px",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--border-radius-md)",
            padding: "16px",
            color: "var(--text-primary)",
            fontFamily: "var(--font-sans)",
            fontSize: "0.95rem",
            lineHeight: "1.6",
            resize: "none",
            outline: "none",
            transition: "var(--transition-smooth)",
          }}
          onFocus={(e) => (e.target.style.borderColor = "var(--accent-cyan)")}
          onBlur={(e) => (e.target.style.borderColor = "var(--border-color)")}
        />
      </div>
    </div>
  );
}
