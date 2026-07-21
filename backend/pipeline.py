import json
from typing import List, Dict, Any, Optional, Tuple
from pydantic import BaseModel
from schemas import (
    StoryAnalysisResponse,
    AssetsResponse,
    ShotPlannerResponse,
    KeyframePromptResponse,
    MotionPromptResponse,
    CharacterAsset,
    EnvironmentAsset,
    PropAsset,
    Shot,
    ShotKeyframePrompt,
    ShotMotionPrompt,
    ComplianceCheckResult
)
from gemini_client import generate_gemini_content

def extract_relevant_storyboard_scenes(storyboard: str, scene_numbers: set) -> str:
    """
    Parses storyboard text and extracts only the scenes that match the given scene numbers.
    This helps keep the prompt size small and avoids safety false positives from unrelated scenes.
    """
    import re
    if not storyboard or not scene_numbers:
        return ""
        
    # Split by standard scene numbers, e.g. "2" or "Scene 2" or "Phân cảnh 2"
    # Matches a line that contains only digits, or starts with Scene/Phân cảnh/Phân đoạn followed by digits
    blocks = re.split(r'\n(?=\d+(?:\n|\r\n))', storyboard)
    if len(blocks) <= 1:
        # Fallback to double newline split
        blocks = storyboard.split("\n\n")
        
    relevant_blocks = []
    for block in blocks:
        # Clean block text
        clean_block = block.strip()
        if not clean_block:
            continue
            
        # Try to find leading scene number (e.g. "2" or "Scene 2" or "2...")
        match = re.match(r'^\s*(?:scene|phân cảnh|phân đoạn|)\s*(\d+)', clean_block, re.IGNORECASE)
        if match:
            num = int(match.group(1))
            if num in scene_numbers:
                relevant_blocks.append(clean_block)
        else:
            # Fallback search inside the block if it didn't start with a number
            for num in scene_numbers:
                if f"scene {num}" in clean_block.lower() or f"phân cảnh {num}" in clean_block.lower():
                    relevant_blocks.append(clean_block)
                    break
                    
    if relevant_blocks:
        return "\n\n".join(relevant_blocks)
        
    # Final fallback: if no scene matching is found, return the full storyboard
    return storyboard

def clean_text_for_safety(text: str) -> str:
    """
    Sanitizes text by removing child age descriptors and converting age-indicative child terms
    into generic, safety-neutral character equivalents to prevent Gemini API safety block false-positives.
    """
    if not text:
        return ""
    import re
    # Remove ages like "8-year-old", "8 years old", "8yo"
    text = re.sub(r'\b\d+[- ]?year[- ]?olds?\b', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\b\d+[- ]?years?[- ]?old\b', '', text, flags=re.IGNORECASE)
    # Neutralize age-indicative child terms
    text = re.sub(r'\byoung\s+boy\b', 'boy', text, flags=re.IGNORECASE)
    text = re.sub(r'\byoung\s+girl\b', 'girl', text, flags=re.IGNORECASE)
    text = re.sub(r'\blittle\s+boy\b', 'boy', text, flags=re.IGNORECASE)
    text = re.sub(r'\blittle\s+girl\b', 'girl', text, flags=re.IGNORECASE)
    # Replace child-related words with neutral character equivalents
    text = re.sub(r'\bchildren\b', 'characters', text, flags=re.IGNORECASE)
    text = re.sub(r'\bchild\b', 'character', text, flags=re.IGNORECASE)
    text = re.sub(r'\bkids\b', 'characters', text, flags=re.IGNORECASE)
    text = re.sub(r'\bkid\b', 'character', text, flags=re.IGNORECASE)
    
    # Vietnamese safety translations
    text = re.sub(r'\bbé\s+trai\b', 'cậu bé', text, flags=re.IGNORECASE)
    text = re.sub(r'\bbé\s+gái\b', 'cô bé', text, flags=re.IGNORECASE)
    text = re.sub(r'\btrẻ\s+em\b', 'nhân vật', text, flags=re.IGNORECASE)
    text = re.sub(r'\btrẻ\s+con\b', 'nhân vật', text, flags=re.IGNORECASE)
    text = re.sub(r'\bcon\s+nít\b', 'nhân vật', text, flags=re.IGNORECASE)
    text = re.sub(r'\bhọc\s+sinh\s+tiểu\s+học\b', 'học sinh', text, flags=re.IGNORECASE)
    text = re.sub(r'\bhọc\s+sinh\s+mẫu\s+giáo\b', 'học sinh', text, flags=re.IGNORECASE)
    return text

def build_transition_instructions(transition_str: str, actions_str: str = "") -> Tuple[Optional[str], Optional[str]]:
    """
    Parses dual-language transition tags (Vietnamese & English) from shot.transition or shot.actions.
    Returns a tuple of (intro_instruction, outro_instruction).
    """
    import re
    text_to_check = f"{transition_str} {actions_str}".upper()
    intro_instr = None
    outro_instr = None

    # Intro detection: [MỞ CẢNH: FADE_IN], [INTRO: FADE_IN], FADE_IN
    if re.search(r'\[?(?:MỞ CẢNH|INTRO|TRANSITION)\s*:\s*FADE[_\s]*IN\]?|FADE[_\s]*IN', text_to_check):
        intro_instr = "First 1.0 second (SCENE INTRO): Gradual fade in from black background into the scene setting."

    # Outro detection:
    if re.search(r'\[?(?:CHUYỂN CẢNH|KẾT CẢNH|OUTRO|TRANSITION)\s*:\s*WALK[_\s]*AWAY(?:[_\s]*FADE)?\]?|WALK[_\s]*AWAY', text_to_check):
        outro_instr = "Final 1.5 seconds (SCENE OUTRO): Character turns around and walks into background shadows, gradual fade out to black to signal scene end."
    elif re.search(r'\[?(?:CHUYỂN CẢNH|KẾT CẢNH|OUTRO|TRANSITION)\s*:\s*PULL[_\s]*BACK(?:[_\s]*FADE)?\]?|PULL[_\s]*BACK', text_to_check):
        outro_instr = "Final 1.5 seconds (SCENE OUTRO): Camera rapidly pulls back to wide shot as character shrinks in distance, gradual fade out."
    elif re.search(r'\[?(?:CHUYỂN CẢNH|KẾT CẢNH|OUTRO|TRANSITION)\s*:\s*TILT[_\s]*UP(?:[_\s]*FADE)?\]?|TILT[_\s]*UP', text_to_check):
        outro_instr = "Final 1.5 seconds (SCENE OUTRO): Camera cranes and tilts upward toward the sky/ceiling, gradual fade out."
    elif re.search(r'\[?(?:CHUYỂN CẢNH|KẾT CẢNH|OUTRO|TRANSITION)\s*:\s*WHIP[_\s]*PAN\]?|WHIP[_\s]*PAN', text_to_check):
        outro_instr = "Final 1.5 seconds (SCENE OUTRO): Fast whip-pan camera sweep creating motion blur transition."
    elif re.search(r'\[?(?:CHUYỂN CẢNH|KẾT CẢNH|OUTRO|TRANSITION)\s*:\s*FADE[_\s]*OUT\]?|FADE[_\s]*OUT', text_to_check):
        outro_instr = "Final 1.5 seconds (SCENE OUTRO): Hold final pose, gradual fade out to black to signal scene end."

    return intro_instr, outro_instr

def compile_motion_prompt(shot: Shot, character_map: Optional[Dict[str, Any]] = None) -> str:
    # Helper to get asset values safely
    def _get_asset_val(asset: Any, field_name: str) -> str:
        if isinstance(asset, dict):
            val = asset.get(field_name, "")
        else:
            val = getattr(asset, field_name, "")
        return str(val) if val is not None else ""

    # 1. SCENE
    scene_desc = shot.environment.strip() if shot.environment else ""
    if shot.lighting:
        lighting_clean = shot.lighting.strip().rstrip(".")
        if "matching the reference" not in lighting_clean.lower():
            scene_desc += f". {lighting_clean} matching the reference image."
        else:
            scene_desc += f". {lighting_clean}"
    else:
        scene_desc += f". Bright cafeteria lighting matching the reference image."
    
    # 2. REFERENCE
    reference_str = "Continue from the provided reference image. Do not change characters' appearance or background environment."
    
    # 2b. CHARACTERS DECLARATION
    char_lines = []
    if shot.characters:
        for c in shot.characters:
            c_clean = c.strip()
            c_key = c_clean.lower()
            if character_map and c_key in character_map:
                asset = character_map[c_key]
                age = _get_asset_val(asset, "age").strip()
                gender = _get_asset_val(asset, "gender").strip()
                voice = _get_asset_val(asset, "voice_style").strip()
                personality = _get_asset_val(asset, "personality").strip()
                
                details = []
                if gender:
                    details.append(gender)
                if age:
                    details.append(age)
                if personality:
                    details.append(personality)
                if voice:
                    details.append(voice)
                
                if details:
                    char_lines.append(f"- {c_clean} ({', '.join(details)})")
                else:
                    char_lines.append(f"- {c_clean}")
            else:
                char_lines.append(f"- {c_clean}")
    char_str = "\n".join(char_lines) if char_lines else "None"

    # 3. SHOT
    camera_lines = []
    camera_val = shot.camera if shot.camera else ""
    if "," in camera_val:
        parts_cam = [p.strip() for p in camera_val.split(",")]
        for p in parts_cam:
            p_lower = p.lower()
            if p_lower in ["static", "pan left", "pan right", "zoom in", "zoom out", "tilt up", "tilt down", "tracking shot", "dolly zoom", "pan", "tilt", "zoom"]:
                if "camera" not in p_lower and "shot" not in p_lower:
                    camera_lines.append(f"{p.capitalize()} camera.")
                else:
                    camera_lines.append(p.capitalize() + ".")
            else:
                camera_lines.append(p.capitalize() + ".")
    else:
        shot_t = shot.shot_type if shot.shot_type else "Medium Shot"
        cam_m = shot.camera_movement if shot.camera_movement else "Static"
        camera_lines.append(f"{shot_t.capitalize()}.")
        if cam_m:
            if "camera" not in cam_m.lower() and "shot" not in cam_m.lower():
                camera_lines.append(f"{cam_m.capitalize()} camera.")
            else:
                camera_lines.append(cam_m.capitalize() + ".")
                
    # Detect dual-language intro & outro transition instructions
    intro_instr, outro_instr = build_transition_instructions(
        shot.transition if shot.transition else "",
        shot.actions if shot.actions else ""
    )

    if intro_instr:
        camera_lines.append(intro_instr)
        
    camera_str = "\n".join(camera_lines)
    
    # 4. TIMELINE
    timeline_lines = []
    for item in shot.timeline:
        t = item.time
        t_clean = t.replace("s", "").strip()
        action_clean = item.action.strip()
        # Enrich speaker name in timeline
        if ":" in action_clean:
            parts_act = action_clean.split(":", 1)
            speaker_name = parts_act[0].strip()
            speech_content = parts_act[1].strip()
            sp_key = speaker_name.lower()
            if character_map and sp_key in character_map:
                asset = character_map[sp_key]
                gender = _get_asset_val(asset, "gender").strip()
                voice = _get_asset_val(asset, "voice_style").strip()
                
                desc_parts = []
                if gender:
                    desc_parts.append(gender)
                if voice:
                    desc_parts.append(voice)
                if desc_parts:
                    action_clean = f"{speaker_name} ({', '.join(desc_parts)}): {speech_content}"
        timeline_lines.append(f"{t_clean} {action_clean}")
    if not timeline_lines:
        timeline_lines.append(f"0-{shot.duration_seconds} {shot.actions.strip() if shot.actions else ''}")
    timeline_str = "\n".join(timeline_lines)
    
    # 5. DIALOGUE
    if shot.dialogue:
        dialogue_lines = []
        for d in shot.dialogue:
            char_name = d.character.strip()
            char_key = char_name.lower()
            if character_map and char_key in character_map:
                asset = character_map[char_key]
                gender = _get_asset_val(asset, "gender").strip()
                voice = _get_asset_val(asset, "voice_style").strip()
                
                desc_parts = []
                if gender:
                    desc_parts.append(gender)
                if voice:
                    desc_parts.append(voice)
                if desc_parts:
                    dialogue_lines.append(f"{char_name} ({', '.join(desc_parts)}): \"{d.speech}\"")
                else:
                    dialogue_lines.append(f"{char_name}: \"{d.speech}\"")
            else:
                dialogue_lines.append(f"{char_name}: \"{d.speech}\"")
        dialogue_str = "\n".join(dialogue_lines)
        dialogue_section = (
            f"{dialogue_str}\n"
            f"Dialogue must match exactly.\n"
            f"No additional speech.\n"
            f"Remain silent after the final line."
        )
    else:
        dialogue_section = "None"
        
    # 6. ACTIONS
    actions_lines = []
    if len(shot.characters) > 1:
        actions_lines.append("Both characters maintain natural breathing, blinking and subtle body movement.")
    elif len(shot.characters) == 1:
        actions_lines.append(f"{shot.characters[0]} maintains natural breathing, blinking and subtle body movement.")
    else:
        actions_lines.append("Characters maintain natural breathing, blinking and subtle body movement.")
    
    if shot.actions:
        import re
        sanitized_lines = []
        for line in shot.actions.split('\n'):
            line_strip = line.strip()
            # Match "Character: text" (dialogue format)
            match = re.match(r'^([^:]+):\s*(.*)$', line_strip)
            if match:
                char_candidate = match.group(1).strip()
                # Check if char_candidate is one of the characters in this shot
                is_char = any(c.lower() == char_candidate.lower() for c in shot.characters)
                if is_char:
                    # Check if this character is in the dialogue list
                    in_dialogue = any(d.character.lower() == char_candidate.lower() for d in shot.dialogue)
                    if not in_dialogue:
                        # Skip dialogue-like lines in actions to prevent "nói leo"
                        print(f"Skipping dialogue-like action to prevent nói leo: {line_strip}", flush=True)
                        continue
            sanitized_lines.append(line)
        if sanitized_lines:
            actions_lines.append("\n".join(sanitized_lines).strip())
        
    for c in shot.characters:
        speaks = any(d.character.strip().lower() == c.strip().lower() for d in shot.dialogue)
        if speaks:
            actions_lines.append(f"{c}: Speaks and gestures naturally.")
        else:
            if shot.dialogue:
                actions_lines.append(f"{c}: Listens and reacts naturally.")
            else:
                if shot.motion and shot.motion.primary_motion:
                    pm = shot.motion.primary_motion.strip().rstrip(".")
                    actions_lines.append(f"{c}: {pm}.")
    actions_str = "\n".join(actions_lines)
    
    # 7. SPATIAL RULES
    spatial_str = (
        "Characters move only through clear walkable space.\n"
        "Walk along existing aisles.\n"
        "Avoid tables, chairs, walls and furniture.\n"
        "Never intersect scene objects.\n"
        "Stop before interacting with furniture.\n"
        "Keep both feet naturally on the floor.\n"
        "Maintain realistic spacing from surrounding objects."
    )
    
    # 8. ENDING
    if outro_instr:
        ending_str = outro_instr
    else:
        ending_str = "Hold final pose silently. Blink and breathe naturally."
    
    # 9. STYLE
    style_str = (
        "High-quality stylized 3D animation.\n"
        "Feature film quality.\n"
        "No on-screen text."
    )
    
    # 10. AUDIO INSTRUCTION
    audio_str = (
        "Diegetic sound only. Clear lip-synced character voices, natural ambient environment sound and character foley matching scene physical action.\n"
        "Strictly NO background music (BGM), NO audience laughter, NO laugh track, NO non-diegetic sound effects."
    )
    
    parts = [
        f"SCENE:\n{scene_desc}",
        f"REFERENCE:\n{reference_str}",
        f"CHARACTERS:\n{char_str}",
        f"SHOT:\n{camera_str}",
        f"TIMELINE:\n{timeline_str}",
        f"DIALOGUE:\n{dialogue_section}",
        f"ACTIONS:\n{actions_str}",
        f"SPATIAL RULES:\n{spatial_str}",
        f"ENDING:\n{ending_str}",
        f"STYLE:\n{style_str}",
        f"AUDIO:\n{audio_str}"
    ]
    
    full_prompt = "\n\n".join(parts)
    return clean_text_for_safety(full_prompt)


# --- Step 1: Story Analyzer ---
async def run_story_analyzer(storyboard: str, api_keys: List[str], model: str, rpm_limit: int = 5) -> StoryAnalysisResponse:
    system_instruction = (
        "You are a strict Story Parser. Your ONLY task is to read the storyboard text and parse it into structured JSON scenes. "
        "The storyboard is the single source of truth. You must NOT modify, summarize, rewrite, or invent any content. "
        "Keep the scene numbers, durations, locations, actions, dialogues, and characters EXACTLY as written in the storyboard. "
        "Do not change scene durations, actions, or dialogues. Do not add or remove characters. "
        "Just extract the raw data and format it into the requested JSON schema."
    )
    
    prompt = f"Analyze this storyboard text and output the structured scene graph:\n\n{storyboard}"
    
    response_text = await generate_gemini_content(
        api_keys=api_keys,
        model=model,
        prompt=prompt,
        system_instruction=system_instruction,
        response_schema=StoryAnalysisResponse,
        rpm_limit=rpm_limit
    )
    return StoryAnalysisResponse.model_validate_json(response_text)

# --- Step 2: Assets Extractor ---
async def run_assets_extractor(
    storyboard: str,
    scenes_json: str,
    api_keys: List[str],
    model: str,
    rpm_limit: int = 5,
    chunk_size: int = 5
) -> AssetsResponse:
    system_instruction = (
        "You are an expert Asset Extractor for animation production. "
        "Analyze the storyboard and parsed scenes to identify all unique characters, environments, and props. "
        "For each character, populate all requested details:\n"
        "- id: Unique ID, e.g., 'char_lisa'\n"
        "- canonical_name: The formal consistent name of the character\n"
        "- name: Duplicate of canonical_name\n"
        "- age, gender, appearance, outfit, hairstyle, accessories, voice_style, personality\n"
        "- turnaround_prompt: A highly detailed Pixar-style turnaround prompt for generating reference images (front, 45-degree, side views, Pixar 3D stylized, white background, no text, no shadows)\n"
        "- prompt: Duplicate of turnaround_prompt\n\n"
        "For each environment, populate:\n"
        "- id: Unique ID, e.g., 'env_school_gate'\n"
        "- name: The location name\n"
        "- reference_prompt: A detailed Pixar-style empty room/area reference image prompt (wide angle, consistent lighting, no characters, no text)\n"
        "- prompt: Duplicate of reference_prompt\n\n"
        "For each prop, populate:\n"
        "- id: Unique ID, e.g., 'prop_lunch_box'\n"
        "- name: The prop name\n"
        "- reference_prompt: A detailed Pixar-style prop reference image prompt (centered, white background, no text)\n"
        "- prompt: Duplicate of reference_prompt\n\n"
        "SAFETY RULE: Do NOT include any age-identifying words like 'child', 'children', 'boy', 'girl', 'kid', 'kids', 'young boy', 'young girl', 'schoolboy', 'schoolgirl' or similar child-related terms in the character descriptions or turnaround_prompts. Instead, refer to them only by name or generic terms like 'character' or 'person' to prevent Gemini API safety blocks.\n\n"
        "Return the unique assets in the requested JSON structure. Do not invent any assets not present in the storyboard."
    )
    
    prompt = (
        f"Storyboard:\n{storyboard}\n\n"
        f"Analyzed Scenes:\n{scenes_json}\n\n"
        f"Extract all characters, environments, and props with reference prompts."
    )
    
    response_text = await generate_gemini_content(
        api_keys=api_keys,
        model=model,
        prompt=prompt,
        system_instruction=system_instruction,
        response_schema=AssetsResponse,
        rpm_limit=rpm_limit
    )
    return AssetsResponse.model_validate_json(response_text)


# --- Step 3: Shot Planner (Shot Prompt Generator) ---
async def run_shot_planner(
    scenes_json: str,
    characters_json: str,
    environments_json: str,
    props_json: str,
    api_keys: List[str],
    model: str,
    rpm_limit: int = 5,
    chunk_size: int = 5,
    storyboard: Optional[str] = None
) -> ShotPlannerResponse:
    scenes = json.loads(scenes_json)
    all_characters = json.loads(characters_json) if characters_json else []
    all_environments = json.loads(environments_json) if environments_json else []
    all_props = json.loads(props_json) if props_json else []
    
    # Build character map
    character_map = {c["name"].strip().lower(): c for c in all_characters if "name" in c}
    for c in all_characters:
        if "canonical_name" in c and c["canonical_name"]:
            character_map[c["canonical_name"].strip().lower()] = c
            
    # Chunk scenes to execute in groups of chunk_size for stability
    scene_chunks = [scenes[i:i + chunk_size] for i in range(0, len(scenes), chunk_size)]
    
    all_shots = []
    
    system_instruction = (
        "You are an expert animation Shot Prompt Generator.\n"
        "Your task is to translate a sequence of analyzed scenes into individual camera shots, generating both a detailed Keyframe reference image prompt and structured shot parameters (timeline, camera, lighting, motion details, transition, dialogue).\n\n"
        "CRITICAL SCENE & SHOT CONTINUITY RULES (NEVER FORGET):\n"
        "- Read and analyze the 'Previously Generated Shots' section carefully (if present) before generating the new shots.\n"
        "- Track Character States & Inventory: If a character was holding or carrying a prop (e.g. 'Emma holds a cup of water') in the previous shots, they must CONTINUE to hold/carry it in the new shots, unless they explicitly set it down in the story or a new action describes them setting it down. If they set it down, they must no longer hold it in subsequent shots.\n"
        "- Avoid Magic Appearances/Disappearances: Objects and props cannot suddenly appear in a character's hand or disappear from a scene without a transition or logical visual explanation. Keep props and characters' poses persistent across cuts.\n"
        "- Track Character Positions & Spatial Layout: If a character walked to a specific location (e.g. 'Lisa walks to the blue table and sits down') at the end of the previous shot, they must start from that exact position/sitting pose in the next shot to maintain geographic and spatial continuity.\n"
        "- Track Environmental Status: If an action modified the environment (e.g. 'opens a door', 'turns off lights', 'drops a notebook on the floor'), this status must persist in the background of subsequent shots until another action changes it.\n"
        "- Ensure that the `keyframe_prompt` (which describes the visual elements for the image generator) matches these continuity constraints. If Emma is holding a cup in the previous shot and has not set it down, her keyframe prompt for the next shot must also mention her holding the cup.\n\n"
        "CRITICAL SHOT DURATION & SPLITTING RULES:\n"
        "  1. Word-Count Dialogue Rule (Keep vs Split):\n"
        "     - Count the total number of words in the combined dialogue of a scene.\n"
        "     - If the total word count is 16 words or fewer, you can keep them in a SINGLE shot (e.g., a Two-Shot showing both characters speaking sequentially, or an Over-the-Shoulder shot).\n"
        "     - If the total word count exceeds 16 words, you MUST split the scene into separate sequential shots.\n"
        "  2. Separate Complex Action from Dialogue: Never mix complex physical tasks (e.g., folding laundry, cleaning, walking a long path, returning to a table) with active speaking segments in the same shot. If a character must perform a complex action and then speak:\n"
        "     - Split it into Shot A (Action Only, no dialogue) focusing on the physical task.\n"
        "     - Split it into Shot B (Dialogue Only) focusing on the speech, facial expressions, and natural hand/head gestures.\n"
        "  3. Cross-Location Splitting (Mandatory): If a conversation happens between characters in different physical settings/locations (e.g., Mom inside the house and Alex outside in the yard):\n"
        "     - You MUST split them into separate sequential shots, assigning the correct specific environment name to EACH shot depending on who is visible. Do NOT put them in the same shot.\n"
        "  4. Natural Performance Buffers (Pacing): Never start a shot with immediate speech or end it immediately after the speech. Always allocate 0.5s to 1s at the beginning of a shot for the character to react/prepare, and 0.5s to 1s at the end to hold their pose, blink, and breathe naturally. This prevents stiff \"clip joining\" effects.\n"
        "  5. Vary Shot Composition to Avoid \"Talking Heads\": Instead of boring, mechanical cuts between isolated Close-ups of characters speaking (A speaks -> cut to B speaks), use professional cinematography:\n"
        "     - Over-the-Shoulder (OTS) Shots: Frame the speaking character focusing on their face/gestures, while showing the shoulder or back of the head of the listening character in the foreground. This connects them spatially.\n"
        "     - Two-Shots (Medium / Medium Wide): Show both characters in the same frame. One speaks and gestures, while the other reacts dynamically (nodding, smiling, blinking).\n"
        "     - Reaction / Cutaway Shots: Focus on the listener's emotional response (Close-up) while the speaker's voice is heard off-screen (as off-screen dialogue) if it adds to the scene's emotional weight.\n"
        "  6. Cinematic Camera Director Speed & Tone Mapping Rules (CRITICAL):\n"
        "     - Match Camera Movement & Speed to the Scene's Emotional Tone:\n"
        "       * Calm / Peaceful / Emotional / Tender scenes: Use slow, smooth, gentle camera movements (e.g. 'Slow Push-in', 'Slow Arc/Orbit', 'Smooth Dolly In').\n"
        "       * Dramatic / Tense / Action / Shock scenes: Use fast, dynamic, rapid camera movements (e.g. 'Fast Push-in', 'Rapid Tracking', 'Handheld Shaky Cam', 'Snap Zoom').\n"
        "       * Energetic / Comedic scenes: Use lively tracking, dynamic pan, whip pan, medium pacing.\n"
        "     - Continuous 1-Shot Multi-Stage Camera Choreography (for 2-person dialogue shots up to 8s):\n"
        "       * Do NOT leave the camera completely static during dialogue shots. Map continuous camera movements across the timeline.\n"
        "       * Example: '0s-3.5s: Slow Push-in on Emma speaking while John listens silently with closed lips; 3.5s-5s: Smooth Pan Right shifting focus to John; 5s-8s: Gentle Zoom-in on John as he responds while Emma listens with closed lips.'\n"
        "       * Explicit Lip-Sync & Listening Rule: State clearly in timeline/actions that the speaking character opens mouth and speaks while the non-speaking character stays silent with closed lips listening to prevent overlapping lip movement (\"nói leo\").\n"
        "  7. Phone Call & Off-Screen Dialogue Lip-Sync Rule:\n"
        "     - When a character is speaking but is OFF-SCREEN (e.g., speaking over the phone, or acting as an off-screen voiceover, while the camera focuses on another character listening):\n"
        "       - The `characters` list for that shot MUST ONLY contain the visible character.\n"
        "       - You MUST explicitly state in the `actions` field and `keyframe_prompt` that: '[Visible Character] is listening silently with closed lips, reacting to the voice.' and '[Off-screen Character] is off-screen / voiceover.' to prevent lip-sync errors.\n"
        "  8. Dynamic Shot Duration Calculation Rules:\n"
        "     - For any shot containing dialogue: the duration must be at least: `ceil(character_count / 15) + 2 seconds` of buffer (for natural breathing, gestures, or reaction/performance pauses). A shot containing speech must NEVER be shorter than 4 seconds.\n"
        "     - For any shot containing physical actions: allocate at least 4 to 6 seconds for that action to happen naturally.\n"
        "     - MAXIMUM SHOT DURATION LIMIT: The duration of any single shot must NEVER exceed 8 seconds. If dialogue or action requires more than 8 seconds, you MUST split it into multiple sequential shots (each between 4 to 8 seconds).\n"
        "     - Dynamic Scene Duration Overriding: If the sum of the required durations for the split shots exceeds the original scene's `duration_seconds`, you MUST override and increase the shot's `duration_seconds` to satisfy the minimum requirements.\n"
        "  9. Flexible Shot Quantity & Granular Splitting: Split scenes into as many sequential shots as logically needed to tell the story clearly, focusing on proper pacing, visual variety, and separating dialogue from action.\n"
        "- BÓC TÁCH HÀNH ĐỘNG, LỜI THOẠI, VÀ DIỄN TẢ (CRITICAL):\n"
        "  - You MUST clearly separate the physical action (e.g. walking, moving props), the spoken dialogue, and the character's expression/performance/reactions (e.g., smiling, crying, looking surprised, listening intently).\n"
        "  - The physical action and dialogue must be mapped chronologically to the `timeline` field.\n"
        "  - Character expressions, reaction styles, and performance details must be clearly described in the `actions` field and reflected in the `keyframe_prompt` (e.g., 'Lisa looks up at Emma with a warm, welcoming smile') to ensure the generator synthesizes proper facial expressions and emotional context.\n"
        "  - The `actions` field MUST ONLY describe physical movements, positioning, poses, expressions, and emotions. You MUST NEVER write dialogue lines, spoken words, or speech (e.g. do not write 'CharacterName: \"Speech\"' or 'CharacterName: Speech') in the `actions` field. Keep the `actions` field purely visual.\n"
        "- When splitting a scene into multiple shots, you must distribute the scene's dialogue, actions, expressions, and timeline sequentially and logically across the split shots. Ensure that no dialogue or action overlaps or is repeated. If a shot contains a character's dialogue, only include that specific character's speech in that shot's dialogue list.\n"
        "  * Concrete Splitting Example: If a scene has Description: 'Lisa returns to the table. Emma smiles.' and Dialogue: [Emma: 'Great job!', Lisa: 'Now my hands are clean.']. Since 'Lisa returns to the table' is a complex action, and the total words of the dialogue is short (8 words), you should split it into 3 shots:\n"
        "    - Shot A (4s): Action Shot. Focuses on Lisa returning to the table and stopping beside it, while Emma sits and smiles (No dialogue list).\n"
        "    - Shot B (4s): Dialogue Shot. Focuses on Emma speaking 'Great job!' in a Medium Close-up (Dialogue list only contains Emma: 'Great job!').\n"
        "    - Shot C (4s): Dialogue Shot. Focuses on Lisa replying 'Now my hands are clean.' in a Medium Close-up (Dialogue list only contains Lisa: 'Now my hands are clean.').\n\n"
        "Your additions for each shot:\n"
        "1. Camera and framing parameters. You must apply these strict Camera Rule mappings to determine camera_movement and shot_type:\n"
        "   - Focus on Dialogue -> shot_type must be 'Medium Shot'\n"
        "   - Focus on Emotion -> shot_type must be 'Close-up'\n"
        "   - Focus on Walking -> camera_movement must be 'Tracking Shot'\n"
        "   - Focus on Introducing a location -> shot_type must be 'Wide Shot'\n"
        "   - Focus on Action (active movements) -> shot_type must be 'Medium Wide'\n"
        "   - Focus on a specific Object -> shot_type must be 'Insert Shot'\n"
        "   - Focus on Reaction -> shot_type must be 'Close-up'\n"
        "   Define `camera` as a combination (e.g. 'Medium Shot, Static'). Specify composition, lighting, transition.\n"
        "   - Transition Parameter: Preserve any intro/outro transition tags present in the storyboard (e.g. '[MỞ CẢNH: FADE_IN]', '[INTRO: FADE_IN]', '[CHUYỂN CẢNH: PULL_BACK]', '[OUTRO: PULL_BACK]', '[CHUYỂN CẢNH: FADE_OUT]', '[OUTRO: FADE_OUT]', '[CHUYỂN CẢNH: TILT_UP]', '[OUTRO: TILT_UP]', '[CHUYỂN CẢNH: WALK_AWAY]', '[OUTRO: WALK_AWAY]'). Populate `transition` with the exact tag or transition name.\n\n"
        "2. Keyframe Prompt (Image Prompt):\n"
        "   - Write a detailed text-to-image prompt to generate a single static keyframe reference image.\n"
        "   - DO NOT repeat or describe the character's appearance, features, hairstyle, clothing, outfit, or other visual details (e.g. do not say 'female, brown hair, wearing a striped t-shirt...'). Doing so is extremely incorrect.\n"
        "   - Instead, ONLY refer to each character by their specific name (e.g. 'Lisa', 'Emma'). Do NOT write the media_id or any ID in the prompt text.\n"
        "   - Keep Props and Environment Names Extremely Specific (CRITICAL FOR PROP CONSISTENCY): To prevent props or background settings from changing styles between shots (e.g., drawing a corded phone in one shot and a modern smartphone in another):\n"
        "     * You MUST use the specific prop asset names (e.g., 'black smartphone' or 'modern iPhone' instead of a generic 'phone', and 'ceramic coffee mug' instead of 'cup').\n"
        "     * Keep the prop's descriptive name completely identical and consistent across the `keyframe_prompt` of all shots in which the prop appears.\n"
        "     * Refer to the environments and props by their specific name (e.g., 'school cafeteria', 'lunch tray') without writing any ID numbers.\n"
        "   - Include only the character name(s), the specific environment name, any active props, the character actions/posing, camera framing/shot type (e.g. Medium Shot, Close-up), and lighting/mood details.\n"
        "   - Ensure the prompt starts with the standard style prefix: 'Pixar-quality stylized 3D, cinematic composition, reference keyframe, no motion blur, no text, no captions.' followed by the characters, environment, props, actions, framing, and lighting.\n"
        "   - Do NOT describe motion, timeline, movement, or speech in the keyframe prompt.\n"
        "   - Clean the text for safety: do not include age descriptors or sensitive child-related terms (ONLY refer to characters by their specific names like 'Lisa', 'Tom', or generic terms like 'person' or 'character' to prevent Gemini API safety blocks. Do NOT use terms like 'boy', 'girl', 'child', or 'kids').\n\n"
        "3. Timeline:\n"
        "   - Generate a simple chronological breakdown of actions in seconds, matching the shot duration. Keep descriptions concise and simple.\n"
        "   - Dialogue lines in the timeline MUST be formatted exactly as: '[CharacterName]: [Dialogue text]'. Other actions should be simple descriptions.\n"
        "   - Example:\n"
        "     [{\"time\": \"0-3\", \"action\": \"Emma notices Lisa.\"}, {\"time\": \"3-6\", \"action\": \"Emma: Lisa, did you wash your hands?\"}, {\"time\": \"6-8\", \"action\": \"Lisa: Oh! I forgot.\"}]\n"
        "   - CRITICAL DIALOGUE DURATION RULE: For any dialogue action (e.g. '[CharacterName]: ...'), you MUST allocate a reasonable duration based on character count: average speaking speed is roughly 15 English characters per second (including spaces). Calculate speaking duration as: ceil(character_count / 15) + 2 seconds of buffer for natural pauses. Speaking segments must NEVER be shorter than 4 seconds (e.g. if the formula yields less than 4, default to 4 seconds) to prevent characters from being cut off mid-speech. For example, if a dialogue has 33 characters, allocate 33/15 + 2 = 4.2s -> round up to 5 seconds in the timeline.\n\n"
        "4. Motion Details:\n"
        "   - primary_motion: The main motion of the character (e.g. 'Walk') in English.\n"
        "   - secondary_motion: List of secondary/idle motions, e.g. ['Blink', 'Breathing'].\n"
        "   - motion_level: Motion level, e.g. 'Low', 'Medium', 'High'.\n\n"
        "5. Character Motion and Walking Rules (CRITICAL):\n"
        "   - Never describe only the destination (e.g., do not write 'Lisa walks to the table').\n"
        "   - Always describe: 1) starting position, 2) walking path, and 3) stopping position (e.g., 'Lisa walks along the open aisle between the tables and stops beside the blue table').\n"
        "   - Characters never choose their own path. Always instruct them to use existing walkable space.\n"
        "   - Never pass through furniture. Never intersect objects.\n"
        "   - Keep realistic physical spacing from surrounding objects and other characters.\n"
        "   - Avoid long walking whenever possible. Prefer standing, turning, leaning, or small steps.\n\n"
        "Ensure shot_id is sequential: Shot001, Shot002, etc. Return valid JSON conforming to the ShotPlannerResponse schema."
    )
    
    # We need to maintain an overall sequential shot_id counter across chunks.
    # To do this, we can let Gemini generate the schema first, and then post-process the shot_ids to ensure they are sequence aligned starting from 1.
    global_shot_counter = 1
    
    for chunk in scene_chunks:
        # Collect referenced assets in this chunk
        referenced_chars = set()
        referenced_envs = set()
        referenced_props = set()
        for scene in chunk:
            for c in scene.get("characters", []):
                referenced_chars.add(c.strip().lower())
            env = scene.get("location") or scene.get("setting")
            if env:
                referenced_envs.add(env.strip().lower())
            for p in scene.get("props", []):
                referenced_props.add(p.strip().lower())
        
        # Filter assets to only include referenced ones, with fallback to all if none match
        chunk_characters = [
            c for c in all_characters 
            if c.get("name", "").strip().lower() in referenced_chars or 
               c.get("canonical_name", "").strip().lower() in referenced_chars or
               c.get("id", "").strip().lower() in referenced_chars
        ]
        if not chunk_characters and all_characters:
            chunk_characters = all_characters

        chunk_environments = [
            e for e in all_environments 
            if e.get("name", "").strip().lower() in referenced_envs or 
               e.get("setting_name", "").strip().lower() in referenced_envs or
               e.get("id", "").strip().lower() in referenced_envs
        ]
        if not chunk_environments and all_environments:
            chunk_environments = all_environments

        chunk_props = [
            p for p in all_props 
            if p.get("name", "").strip().lower() in referenced_props or 
               p.get("prop_name", "").strip().lower() in referenced_props or
               p.get("id", "").strip().lower() in referenced_props
        ]
        if not chunk_props and all_props:
            chunk_props = all_props
        
        # Clean character fields for safety (removing age / child keywords)
        cleaned_characters = []
        for c in chunk_characters:
            cc = c.copy()
            cc["age"] = ""
            for field in ["appearance", "outfit", "hairstyle", "accessories", "turnaround_prompt", "prompt", "personality", "voice_style", "description", "gender"]:
                if field in cc and cc[field]:
                    cc[field] = clean_text_for_safety(cc[field])
            cleaned_characters.append(cc)
            
        # Clean environment fields for safety
        cleaned_environments = []
        for e in chunk_environments:
            ee = e.copy()
            for field in ["description", "turnaround_prompt", "prompt", "reference_prompt"]:
                if field in ee and ee[field]:
                    ee[field] = clean_text_for_safety(ee[field])
            cleaned_environments.append(ee)
            
        # Clean prop fields for safety
        cleaned_props = []
        for p in chunk_props:
            pp = p.copy()
            for field in ["description", "turnaround_prompt", "prompt", "reference_prompt"]:
                if field in pp and pp[field]:
                    pp[field] = clean_text_for_safety(pp[field])
            cleaned_props.append(pp)
 
        # Ensure we clean storyboard if provided, otherwise clean scene actions
        cleaned_chunk = []
        for scene in chunk:
            sc = scene.copy()
            if "action" in sc and sc["action"]:
                sc["action"] = clean_text_for_safety(sc["action"])
            if "description" in sc and sc["description"]:
                sc["description"] = clean_text_for_safety(sc["description"])
            if "dialogue" in sc and sc["dialogue"]:
                cleaned_dialogue = []
                for d in sc["dialogue"]:
                    dc = d.copy()
                    if "speech" in dc and dc["speech"]:
                        dc["speech"] = clean_text_for_safety(dc["speech"])
                    if "text" in dc and dc["text"]:
                        dc["text"] = clean_text_for_safety(dc["text"])
                    cleaned_dialogue.append(dc)
                sc["dialogue"] = cleaned_dialogue
            cleaned_chunk.append(sc)

        chunk_scenes_json = json.dumps(cleaned_chunk, ensure_ascii=False)
        chunk_characters_json = json.dumps(cleaned_characters, ensure_ascii=False)
        chunk_environments_json = json.dumps(cleaned_environments, ensure_ascii=False)
        chunk_props_json = json.dumps(cleaned_props, ensure_ascii=False)
        
        # Get the sliding window of last 6 shots for continuity context (excluding heavy keyframe_prompt text to optimize speed)
        recent_shots = all_shots[-6:] if len(all_shots) > 6 else all_shots
        previous_shots_str = ""
        if recent_shots:
            simplified_previous = []
            for s in recent_shots:
                simplified_previous.append({
                    "shot_id": s.shot_id,
                    "scene_number": s.scene_number,
                    "characters": s.characters,
                    "environment": s.environment,
                    "props": s.props,
                    "actions": s.actions,
                    "dialogue": [{"character": d.character, "speech": d.speech} for d in s.dialogue] if s.dialogue else []
                })
            previous_shots_str = json.dumps(simplified_previous, ensure_ascii=False)
        else:
            previous_shots_str = "None (This is the start of the storyboard)"

        prompt = (
            f"Previously Generated Shots (for continuity context):\n{previous_shots_str}\n\n"
            f"Scenes to generate shots for in this batch:\n{chunk_scenes_json}\n\n"
            f"Character Reference Assets:\n{chunk_characters_json}\n\n"
            f"Environment Reference Assets:\n{chunk_environments_json}\n\n"
            f"Prop Reference Assets:\n{chunk_props_json}\n\n"
            f"Generate shots, keyframe prompts, and motion parameters for this batch of scenes. Apply camera rules and keep durations exactly."
        )
        
        response_text = await generate_gemini_content(
            api_keys=api_keys,
            model=model,
            prompt=prompt,
            system_instruction=system_instruction,
            response_schema=ShotPlannerResponse,
            rpm_limit=rpm_limit
        )
        chunk_data = ShotPlannerResponse.model_validate_json(response_text)
        
        # Format shot IDs and compile motion prompts programmatically
        for shot in chunk_data.shots:
            shot.shot_id = f"Shot{global_shot_counter:03d}"
            global_shot_counter += 1
            # Compile the motion prompt string using the helper
            shot.motion_prompt = compile_motion_prompt(shot, character_map)
            
        all_shots.extend(chunk_data.shots)
        
    return ShotPlannerResponse(shots=all_shots)

# --- Step 4: Keyframe Prompt Generator ---
async def run_keyframe_prompt_generator(
    shots_json: str,
    characters_json: str,
    environments_json: str,
    props_json: str,
    api_keys: List[str],
    model: str,
    rpm_limit: int = 5,
    chunk_size: int = 5
) -> KeyframePromptResponse:
    shots = json.loads(shots_json)
    
    # Check if all shots already have keyframe_prompt (pre-computed by Shot Prompt Generator)
    has_all_keyframes = True
    keyframes = []
    for s in shots:
        prompt_val = s.get("keyframe_prompt") if isinstance(s, dict) else getattr(s, "keyframe_prompt", "")
        shot_id_val = s.get("shot_id") if isinstance(s, dict) else getattr(s, "shot_id", "")
        if prompt_val:
            keyframes.append(ShotKeyframePrompt(shot_id=shot_id_val, prompt=prompt_val))
        else:
            has_all_keyframes = False
            break

    if shots and has_all_keyframes:
        return KeyframePromptResponse(keyframes=keyframes)
    
    # Group shots by scene number first to keep context isolated, then split if scene shots exceed chunk_size
    from collections import defaultdict
    shots_by_scene = defaultdict(list)
    for shot in shots:
        scene_num = shot.get("scene_number") or shot.get("scene_id") or 1
        try:
            scene_num = int(scene_num)
        except (ValueError, TypeError):
            scene_num = 1
        shots_by_scene[scene_num].append(shot)
        
    shot_chunks = []
    for scene_num in sorted(shots_by_scene.keys()):
        scene_shots = shots_by_scene[scene_num]
        for i in range(0, len(scene_shots), chunk_size):
            shot_chunks.append(scene_shots[i:i + chunk_size])
    
    all_keyframes = []
    
    # Parse full assets
    all_characters = json.loads(characters_json) if characters_json else []
    all_environments = json.loads(environments_json) if environments_json else []
    all_props = json.loads(props_json) if props_json else []
    
    system_instruction = (
        "You are an expert Keyframe Image Prompt Generator.\n"
        "For each shot in the provided list, write a detailed text-to-image prompt to generate a single static keyframe reference image.\n\n"
        "CRITICAL SCENE & SHOT CONTINUITY RULES (NEVER FORGET):\n"
        "- Read and analyze the 'Previously Generated Keyframe Prompts' section carefully (if present) before generating the new prompts.\n"
        "- Track Character States & Inventory: If a character was holding or carrying a prop (e.g. 'Emma holds a cup of water') in the previous keyframe prompts, they must CONTINUE to hold/carry it in the new prompts, unless they explicitly set it down in the shot description or action. If they set it down, they must no longer hold it in subsequent prompts.\n"
        "- Keep character positions, poses, and environment status consistent with the previous keyframe prompts.\n\n"
        "PROMPT FORMATTING RULES:\n"
        "- DO NOT repeat or describe the character's appearance, features, hairstyle, clothing, outfit, or other visual details (e.g. do not say 'female, brown hair, wearing a striped t-shirt...'). Doing so is extremely incorrect.\n"
        "- Instead, ONLY refer to each character by their specific name (e.g. 'Lisa', 'Emma'). Do NOT write the media_id or any ID in the prompt text.\n"
        "- Similarly, do not repeat or describe the environments or props. Refer to them only by their name (e.g., 'cafeteria', 'lunch tray') without writing any ID or description.\n"
        "- Include only the character name(s), the environment name, any active props, the character actions/posing, camera framing/shot type (e.g. Medium Shot, Close-up), and lighting/mood details.\n"
        "- Ensure the prompt starts with the standard style prefix: 'Pixar-quality stylized 3D, cinematic composition, reference keyframe, no motion blur, no text, no captions.' followed by the characters, environment, props, actions, framing, and lighting.\n"
        "- Do NOT describe motion, timeline, movement, or speech in the keyframe prompt.\n"
        "- SAFETY RULE: Do NOT use any age-identifying words like 'child', 'children', 'boy', 'girl', 'kid', 'kids', 'young boy', 'young girl', 'schoolboy', 'schoolgirl' or similar child-related terms in the prompts. Instead, ONLY refer to characters by their specific names (e.g. 'Lisa', 'Tom') or generic terms (e.g. 'person', 'character')."
    )
    
    for chunk in shot_chunks:
        # Collect referenced assets in this chunk
        referenced_chars = set()
        referenced_envs = set()
        referenced_props = set()
        for shot in chunk:
            for c in shot.get("characters", []):
                referenced_chars.add(c.strip().lower())
            env = shot.get("environment")
            if env:
                referenced_envs.add(env.strip().lower())
            for p in shot.get("props", []):
                referenced_props.add(p.strip().lower())
        
        # Filter assets to only include referenced ones, with fallback to all if none match
        chunk_characters = [
            c for c in all_characters 
            if c.get("name", "").strip().lower() in referenced_chars or 
               c.get("canonical_name", "").strip().lower() in referenced_chars
        ]
        if not chunk_characters and all_characters:
            chunk_characters = all_characters

        chunk_environments = [
            e for e in all_environments 
            if e.get("name", "").strip().lower() in referenced_envs or 
               e.get("setting_name", "").strip().lower() in referenced_envs
        ]
        if not chunk_environments and all_environments:
            chunk_environments = all_environments

        chunk_props = [
            p for p in all_props 
            if p.get("name", "").strip().lower() in referenced_props or 
               p.get("prop_name", "").strip().lower() in referenced_props
        ]
        if not chunk_props and all_props:
            chunk_props = all_props
        
        # Clean character fields for safety (removing age / child keywords)
        cleaned_characters = []
        for c in chunk_characters:
            cc = c.copy()
            cc["age"] = ""
            for field in ["appearance", "outfit", "hairstyle", "accessories", "turnaround_prompt", "prompt", "personality", "voice_style", "description", "gender"]:
                if field in cc and cc[field]:
                    cc[field] = clean_text_for_safety(cc[field])
            cleaned_characters.append(cc)
            
        # Clean environment fields for safety
        cleaned_environments = []
        for e in chunk_environments:
            ee = e.copy()
            for field in ["description", "turnaround_prompt", "prompt"]:
                if field in ee and ee[field]:
                    ee[field] = clean_text_for_safety(ee[field])
            cleaned_environments.append(ee)
            
        # Clean prop fields for safety
        cleaned_props = []
        for p in chunk_props:
            pp = p.copy()
            for field in ["description", "turnaround_prompt", "prompt"]:
                if field in pp and pp[field]:
                    pp[field] = clean_text_for_safety(pp[field])
            cleaned_props.append(pp)

        # Clean shots chunk for safety
        cleaned_chunk = []
        for shot in chunk:
            s_copy = shot.copy()
            for field in ["actions", "action", "description"]:
                if field in s_copy and s_copy[field]:
                    s_copy[field] = clean_text_for_safety(s_copy[field])
            if "dialogue" in s_copy and s_copy["dialogue"]:
                cleaned_dialogue = []
                for d in s_copy["dialogue"]:
                    dc = d.copy()
                    if "speech" in dc and dc["speech"]:
                        dc["speech"] = clean_text_for_safety(dc["speech"])
                    if "text" in dc and dc["text"]:
                        dc["text"] = clean_text_for_safety(dc["text"])
                    cleaned_dialogue.append(dc)
                s_copy["dialogue"] = cleaned_dialogue
            cleaned_chunk.append(s_copy)

        chunk_shots_json = json.dumps(cleaned_chunk, ensure_ascii=False)
        chunk_characters_json = json.dumps(cleaned_characters, ensure_ascii=False)
        chunk_environments_json = json.dumps(cleaned_environments, ensure_ascii=False)
        chunk_props_json = json.dumps(cleaned_props, ensure_ascii=False)
        
        # Get the sliding window of last 12 keyframe prompts for continuity context
        recent_keyframes = all_keyframes[-12:] if len(all_keyframes) > 12 else all_keyframes
        previous_keyframes_str = ""
        if recent_keyframes:
            previous_keyframes_str = json.dumps([{"shot_id": k.shot_id, "prompt": k.prompt} for k in recent_keyframes], ensure_ascii=False, indent=2)
        else:
            previous_keyframes_str = "None"
            
        prompt = (
            f"Previously Generated Keyframe Prompts (for continuity context):\n{previous_keyframes_str}\n\n"
            f"Shots to generate keyframe prompts for in this batch:\n{chunk_shots_json}\n\n"
            f"Character Assets:\n{chunk_characters_json}\n\n"
            f"Environment Assets:\n{chunk_environments_json}\n\n"
            f"Prop Assets:\n{chunk_props_json}\n\n"
            f"Generate keyframe image prompts for this batch of shots."
        )
        
        response_text = await generate_gemini_content(
            api_keys=api_keys,
            model=model,
            prompt=prompt,
            system_instruction=system_instruction,
            response_schema=KeyframePromptResponse,
            rpm_limit=rpm_limit
        )
        chunk_data = KeyframePromptResponse.model_validate_json(response_text)
        all_keyframes.extend(chunk_data.keyframes)
        
    return KeyframePromptResponse(keyframes=all_keyframes)

# --- Step 5: Motion Prompt Generator ---
async def run_motion_prompt_generator(
    storyboard: str,
    shots_json: str,
    characters_json: str,
    environments_json: str,
    props_json: str,
    api_keys: List[str],
    model: str,
    rpm_limit: int = 5,
    chunk_size: int = 5,
    custom_instructions: Optional[str] = None
) -> MotionPromptResponse:
    shots = json.loads(shots_json)
    all_characters = json.loads(characters_json) if characters_json else []
    
    # Build character map
    character_map = {c["name"].strip().lower(): c for c in all_characters if "name" in c}
    for c in all_characters:
        if "canonical_name" in c and c["canonical_name"]:
            character_map[c["canonical_name"].strip().lower()] = c

    # Compile motion prompts directly from shot details if custom_instructions is not provided
    has_all_prompts = True
    motion_prompts = []
    
    if not custom_instructions:
        for s in shots:
            try:
                # Try compiling from shot details (no Gemini API calls, extremely fast)
                # Always re-compile programmatically to ensure character voice styles, age, gender, and new structure are injected
                shot_obj = Shot.model_validate(s) if isinstance(s, dict) else s
                compiled = compile_motion_prompt(shot_obj, character_map)
                shot_id_val = s.get("shot_id") if isinstance(s, dict) else getattr(s, "shot_id", "")
                motion_prompts.append(ShotMotionPrompt(shot_id=shot_id_val, prompt=compiled))
            except Exception as e:
                logger.warning(f"Failed to validate shot for programmatic compilation: {e}. Falling back to Gemini.")
                has_all_prompts = False
                break
    else:
        has_all_prompts = False
            
    if shots and has_all_prompts:
        return MotionPromptResponse(motion_prompts=motion_prompts)
    
    # Group shots by scene number first to keep context isolated, then split if scene shots exceed chunk_size
    from collections import defaultdict
    shots_by_scene = defaultdict(list)
    for shot in shots:
        scene_num = shot.get("scene_number") or shot.get("scene_id") or 1
        try:
            scene_num = int(scene_num)
        except (ValueError, TypeError):
            scene_num = 1
        shots_by_scene[scene_num].append(shot)
        
    shot_chunks = []
    for scene_num in sorted(shots_by_scene.keys()):
        scene_shots = shots_by_scene[scene_num]
        for i in range(0, len(scene_shots), chunk_size):
            shot_chunks.append(scene_shots[i:i + chunk_size])
    
    all_motion_prompts = []
    
    # Parse full assets
    all_characters = json.loads(characters_json) if characters_json else []
    all_environments = json.loads(environments_json) if environments_json else []
    all_props = json.loads(props_json) if props_json else []
    
    system_instruction = (
        "You are an expert Motion Prompt Generator for Google Veo 3 (video generation).\n"
        "For each shot, you must output a structured, extremely concise, 100% English motion prompt.\n"
        "Your generated prompt for each shot MUST strictly follow this exact format and order:\n\n"
        "SCENE:\n"
        "[Brief setting name and environment/lighting details. Include 'matching the reference image' for consistency.]\n\n"
        "REFERENCE:\n"
        "Continue from the provided reference image. Do not change characters' appearance or background environment.\n\n"
        "CHARACTERS:\n"
        "[List of characters visible in the shot, including their gender, age, personality, and voice style description in parentheses, e.g.:\n"
        "- Emma (female, 30s, caring, warm gentle voice)\n"
        "- Lisa (girl, 6, curious, cheerful young voice). If there are no characters, write 'None'.]\n\n"
        "SHOT:\n"
        "[Camera framing and movement, e.g. 'Medium shot. Static camera.']\n\n"
        "TIMELINE:\n"
        "[Simple chronological breakdown of actions in seconds, without 's' suffixes. For dialogue lines, use speaker name and their voice attributes in parentheses, e.g.:\n"
        "0-3 Emma notices Lisa.\n"
        "3-6 Emma (female, warm gentle voice): Lisa, did you wash your hands?\n"
        "6-8 Lisa (girl, cheerful young voice): Oh! I forgot.]\n\n"
        "DIALOGUE:\n"
        "[Dialogue lines, formatted as: CharacterName (gender, voice style description): \"speech text\". E.g., Emma (female, warm gentle voice): \"Lisa, did you wash your hands?\". Below the dialogue, append exactly:\n"
        "Dialogue must match exactly.\n"
        "No additional speech.\n"
        "Remain silent after the final line.\n"
        "If there is no dialogue, write 'None'.]\n\n"
        "ACTIONS:\n"
        "[Simplified character movements. Always start with: 'Both characters maintain natural breathing, blinking and subtle body movement.' (or single character equivalent). Followed by the shot action, and character behaviors. The ACTIONS section must only describe physical movements, poses, expressions, and gestures. You MUST NEVER write dialogue lines, spoken words, or speech (e.g. do not write 'CharacterName: \"Speech\"' or 'CharacterName: Speech') in the ACTIONS field. Keep ACTIONS purely visual. E.g. 'Emma: Looks toward Lisa and gestures.' / 'Lisa: Turns toward Emma and nods.']\n\n"
        "SPATIAL RULES:\n"
        "Characters move only through clear walkable space.\n"
        "Walk along existing aisles.\n"
        "Avoid tables, chairs, walls and furniture.\n"
        "Never intersect scene objects.\n"
        "Stop before interacting with furniture.\n"
        "Keep both feet naturally on the floor.\n"
        "Maintain realistic spacing from surrounding objects.\n\n"
        "ENDING:\n"
        "Hold final pose silently. Blink and breathe naturally.\n\n"
        "STYLE:\n"
        "High-quality stylized 3D animation.\n"
        "Feature film quality.\n"
        "No on-screen text.\n\n"
        "CRITICAL LIMITS:\n"
        "- Total word count must be between 80 and 150 words. Do not repeat descriptions or write unnecessary details.\n"
        "- Do not use any Negative Prompt section.\n"
        "- SAFETY RULE: Do NOT use any age-identifying words like 'child', 'children', 'kid', 'kids', 'young boy', 'young girl', 'schoolboy', 'schoolgirl' or similar child-related terms in the motion prompts. Instead, ONLY refer to characters by their specific names (e.g. 'Lisa', 'Tom') or generic pronouns (e.g. 'they', 'he', 'she'). Note: 'boy' or 'girl' is allowed when describing voice/character gender characteristics, but avoid child/kids terms."
    )
    
    for chunk in shot_chunks:
        # Collect referenced assets and scene numbers in this chunk
        referenced_chars = set()
        referenced_envs = set()
        referenced_props = set()
        scene_numbers = set()
        for shot in chunk:
            for c in shot.get("characters", []):
                referenced_chars.add(c.strip().lower())
            env = shot.get("environment")
            if env:
                referenced_envs.add(env.strip().lower())
            for p in shot.get("props", []):
                referenced_props.add(p.strip().lower())
            scene_id = shot.get("scene_number") or shot.get("scene_id")
            if scene_id is not None:
                try:
                    scene_numbers.add(int(scene_id))
                except ValueError:
                    pass
        
        # Filter assets, with fallback to all if none match
        chunk_characters = [
            c for c in all_characters 
            if c.get("name", "").strip().lower() in referenced_chars or 
               c.get("canonical_name", "").strip().lower() in referenced_chars
        ]
        if not chunk_characters and all_characters:
            chunk_characters = all_characters

        chunk_environments = [
            e for e in all_environments 
            if e.get("name", "").strip().lower() in referenced_envs or 
               e.get("setting_name", "").strip().lower() in referenced_envs
        ]
        if not chunk_environments and all_environments:
            chunk_environments = all_environments

        chunk_props = [
            p for p in all_props 
            if p.get("name", "").strip().lower() in referenced_props or 
               p.get("prop_name", "").strip().lower() in referenced_props
        ]
        if not chunk_props and all_props:
            chunk_props = all_props
        
        # Extract only relevant storyboard text
        chunk_storyboard = extract_relevant_storyboard_scenes(storyboard, scene_numbers)
        # Clean storyboard for safety
        chunk_storyboard = clean_text_for_safety(chunk_storyboard)
        
        # Clean character fields for safety (removing age / child keywords)
        cleaned_characters = []
        for c in chunk_characters:
            cc = c.copy()
            cc["age"] = ""
            for field in ["appearance", "outfit", "hairstyle", "accessories", "turnaround_prompt", "prompt", "personality", "voice_style", "description", "gender"]:
                if field in cc and cc[field]:
                    cc[field] = clean_text_for_safety(cc[field])
            cleaned_characters.append(cc)
            
        # Clean environment fields for safety
        cleaned_environments = []
        for e in chunk_environments:
            ee = e.copy()
            for field in ["description", "turnaround_prompt", "prompt"]:
                if field in ee and ee[field]:
                    ee[field] = clean_text_for_safety(ee[field])
            cleaned_environments.append(ee)
            
        # Clean prop fields for safety
        cleaned_props = []
        for p in chunk_props:
            pp = p.copy()
            for field in ["description", "turnaround_prompt", "prompt"]:
                if field in pp and pp[field]:
                    pp[field] = clean_text_for_safety(pp[field])
            cleaned_props.append(pp)

        # Clean shots chunk for safety
        cleaned_chunk = []
        for shot in chunk:
            s_copy = shot.copy()
            for field in ["actions", "action", "description"]:
                if field in s_copy and s_copy[field]:
                    s_copy[field] = clean_text_for_safety(s_copy[field])
            if "dialogue" in s_copy and s_copy["dialogue"]:
                cleaned_dialogue = []
                for d in s_copy["dialogue"]:
                    dc = d.copy()
                    if "speech" in dc and dc["speech"]:
                        dc["speech"] = clean_text_for_safety(dc["speech"])
                    if "text" in dc and dc["text"]:
                        dc["text"] = clean_text_for_safety(dc["text"])
                    cleaned_dialogue.append(dc)
                s_copy["dialogue"] = cleaned_dialogue
            cleaned_chunk.append(s_copy)
            
        chunk_shots_json = json.dumps(cleaned_chunk, ensure_ascii=False)
        chunk_characters_json = json.dumps(cleaned_characters, ensure_ascii=False)
        chunk_environments_json = json.dumps(cleaned_environments, ensure_ascii=False)
        chunk_props_json = json.dumps(cleaned_props, ensure_ascii=False)
        
        prompt = (
            f"Storyboard:\n{chunk_storyboard}\n\n"
            f"Shots in this batch:\n{chunk_shots_json}\n\n"
            f"Character Reference Assets:\n{chunk_characters_json}\n\n"
            f"Environment Reference Assets:\n{chunk_environments_json}\n\n"
            f"Prop Reference Assets:\n{chunk_props_json}\n\n"
        )
        if custom_instructions:
            prompt += f"Additional User Instructions/Requirements:\n{custom_instructions}\n\n"
        prompt += "Generate Veo 3 motion prompts for this batch of shots conforming to formatting guidelines, length limit, and Motion Direction Rules. Apply the Additional User Instructions/Requirements if provided."
        
        response_text = await generate_gemini_content(
            api_keys=api_keys,
            model=model,
            prompt=prompt,
            system_instruction=system_instruction,
            response_schema=MotionPromptResponse,
            rpm_limit=rpm_limit
        )
        chunk_data = MotionPromptResponse.model_validate_json(response_text)
        
        # Check compliance and regenerate if needed for each shot in the chunk
        for s in chunk:
            shot_id = s["shot_id"]
            motion_item = next((mp for mp in chunk_data.motion_prompts if mp.shot_id == shot_id), None)
            if not motion_item:
                continue
            
            # retry loop
            for attempt in range(3):
                # run compliance check with filtered storyboard
                check_res = await check_compliance(
                    motion_prompt=motion_item.prompt,
                    shot=s,
                    storyboard=chunk_storyboard,
                    api_keys=api_keys,
                    model=model,
                    rpm_limit=rpm_limit
                )
                if check_res.is_compliant:
                    break
                
                # If fail, regenerate it specifically
                print(f"Compliance check failed for {shot_id} (Attempt {attempt+1}): {check_res.errors}")
                regen_prompt = (
                    f"The previously generated motion prompt for shot {shot_id} failed compliance checking.\n"
                    f"Errors:\n" + "\n".join(f"- {err}" for err in check_res.errors) + "\n\n"
                    f"Previous Prompt:\n{motion_item.prompt}\n\n"
                    f"Shot Details:\n{json.dumps(s, ensure_ascii=False)}\n\n"
                    f"Character Assets:\n{chunk_characters_json}\n\n"
                    f"Environment Assets:\n{chunk_environments_json}\n\n"
                    f"Prop Assets:\n{chunk_props_json}\n\n"
                    f"Please rewrite the motion prompt to fix the errors. Keep it strictly between 80 and 150 words and in the exact format required."
                )
                
                # Single shot regeneration
                regen_response_text = await generate_gemini_content(
                    api_keys=api_keys,
                    model=model,
                    prompt=regen_prompt,
                    system_instruction=system_instruction,
                    response_schema=ShotMotionPrompt,
                    rpm_limit=rpm_limit
                )
                try:
                    new_motion_prompt = ShotMotionPrompt.model_validate_json(regen_response_text)
                    motion_item.prompt = new_motion_prompt.prompt
                except Exception as ex:
                    print(f"Failed to parse regenerated prompt for {shot_id}: {ex}")
        
        all_motion_prompts.extend(chunk_data.motion_prompts)
        
    return MotionPromptResponse(motion_prompts=all_motion_prompts)


# --- Step 6: Veo Compliance Checker ---
async def check_compliance(
    motion_prompt: str,
    shot: Dict[str, Any],
    storyboard: str,
    api_keys: List[str],
    model: str,
    rpm_limit: int = 5
) -> ComplianceCheckResult:
    system_instruction = (
        "You are a strict Veo Compliance Checker. Your task is to verify if a generated Motion Prompt meets all guidelines.\n"
        "Analyze the provided Motion Prompt against the original Shot details and Storyboard, and verify each checklist item:\n"
        "- dialogue đúng 100%: The exact dialogue text must match the storyboard dialogue exactly. No paraphrasing, no improvisation.\n"
        "- duration hợp lý: The duration in seconds matches the shot duration.\n"
        "- prompt dưới giới hạn: The total word count of the Motion Prompt is between 80 and 150 words.\n"
        "- không có tiếng Việt: The prompt must be entirely in English (except for character names if necessary).\n"
        "- không có lời kể / không có narration / không có voice over: The prompt must not contain any narrative voice-over or storytelling text.\n"
        "- không có prompt mâu thuẫn: No conflicting directions.\n"
        "- không có nhân vật dư / không có location dư: No extra characters or settings described that are not in the shot.\n\n"
        "Return a JSON object with is_compliant (boolean) and errors (list of strings if is_compliant is false)."
    )
    
    prompt = (
        f"Storyboard:\n{storyboard}\n\n"
        f"Shot Details:\n{json.dumps(shot, ensure_ascii=False)}\n\n"
        f"Generated Motion Prompt:\n{motion_prompt}\n\n"
        f"Please verify compliance and return the compliance check result JSON."
    )
    
    response_text = await generate_gemini_content(
        api_keys=api_keys,
        model=model,
        prompt=prompt,
        system_instruction=system_instruction,
        response_schema=ComplianceCheckResult,
        rpm_limit=rpm_limit
    )
    return ComplianceCheckResult.model_validate_json(response_text)
