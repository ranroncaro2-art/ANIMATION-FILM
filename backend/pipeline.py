import asyncio
import json
import logging
import re
from typing import List, Dict, Any, Optional, Tuple, Set
from pydantic import BaseModel, Field

from schemas import (
    StoryAnalysisResponse,
    SceneAnalysis,
    AssetsResponse,
    CharacterAsset,
    EnvironmentAsset,
    PropAsset,
    ShotPlannerResponse,
    Shot,
    DialogueItem,
    TimelineItem,
    MotionDetails,
    KeyframePromptResponse,
    ShotKeyframePrompt,
    MotionPromptResponse,
    ShotMotionPrompt,
    StandardizedShotData,
    ArtStylePreset,
)
from gemini_client import generate_gemini_content, estimate_tokens
from database import get_checkpoint, save_checkpoint, update_job_status

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Pipeline")


def extract_relevant_storyboard_scenes(storyboard: str, scene_numbers: Set[int]) -> str:
    """Parses storyboard text and extracts only the scenes that match the given scene numbers."""
    if not storyboard or not scene_numbers:
        return ""
    blocks = re.split(r'\n(?=\d+(?:\n|\r\n))', storyboard)
    if len(blocks) <= 1:
        blocks = storyboard.split("\n\n")

    relevant_blocks = []
    for block in blocks:
        clean_block = block.strip()
        if not clean_block:
            continue
        match = re.match(r'^\s*(?:scene|phân cảnh|phân đoạn|)\s*(\d+)', clean_block, re.IGNORECASE)
        if match:
            num = int(match.group(1))
            if num in scene_numbers:
                relevant_blocks.append(clean_block)
        else:
            for num in scene_numbers:
                if f"scene {num}" in clean_block.lower() or f"phân cảnh {num}" in clean_block.lower():
                    relevant_blocks.append(clean_block)
                    break
    return "\n\n".join(relevant_blocks) if relevant_blocks else storyboard


def clean_text_for_safety(text: str) -> str:
    """Sanitizes text by removing character visual descriptors (age, clothing, shoes) and child terms to prevent Gemini API safety block false-positives and comply with reference-only rules."""
    if not text:
        return ""
    # 1. Remove age patterns: ", 6-7 years old,", ", 10 years old,", "6-7 years old"
    text = re.sub(r',\s*\d+(?:-\d+)?\s*years?\s*old,?', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\b\d+(?:-\d+)?\s*years?\s*old\b', '', text, flags=re.IGNORECASE)

    # 2. Remove prefixes like "A man, ", "A woman, ", "A 6-7 year old girl, "
    text = re.sub(r'\ba\s+(?:man|woman|guy|lady|boy|girl|child|kid)\s*,\s*', '', text, flags=re.IGNORECASE)

    # 3. Remove clothing/outfit phrases: "in a bright yellow t-shirt", "in a plain grey t-shirt", "wearing jeans", "denim shorts", "blue sneakers"
    clothing_keywords = r'(?:t-shirt|shirt|shorts|jeans|pants|sneakers|dress|jacket|coat|hoodie|shoes|outfit|skirt|boots|trousers|hat|cap)'
    text = re.sub(rf',\s*in\s+(?:a|an)?\s*[^,\.]*{clothing_keywords}[^,\.]*', '', text, flags=re.IGNORECASE)
    text = re.sub(rf'\bin\s+(?:a|an)\s+[^,\.]*{clothing_keywords}[^,\.]*', '', text, flags=re.IGNORECASE)
    text = re.sub(rf',\s*wearing\s+[^,\.]*{clothing_keywords}[^,\.]*', '', text, flags=re.IGNORECASE)
    text = re.sub(rf',\s*[^,\.]*{clothing_keywords}[^,\.]*', '', text, flags=re.IGNORECASE)

    # 4. Remove child terms
    text = re.sub(r'\byoung\s+boy\b', 'character', text, flags=re.IGNORECASE)
    text = re.sub(r'\byoung\s+girl\b', 'character', text, flags=re.IGNORECASE)
    text = re.sub(r'\blittle\s+boy\b', 'character', text, flags=re.IGNORECASE)
    text = re.sub(r'\blittle\s+girl\b', 'character', text, flags=re.IGNORECASE)
    text = re.sub(r'\bchildren\b', 'characters', text, flags=re.IGNORECASE)
    text = re.sub(r'\bchild\b', 'character', text, flags=re.IGNORECASE)
    text = re.sub(r'\bkids\b', 'characters', text, flags=re.IGNORECASE)
    text = re.sub(r'\bkid\b', 'character', text, flags=re.IGNORECASE)
    text = re.sub(r'\bbé\s+trai\b', 'cậu bé', text, flags=re.IGNORECASE)
    text = re.sub(r'\bbé\s+gái\b', 'cô bé', text, flags=re.IGNORECASE)
    text = re.sub(r'\btrẻ\s+em\b', 'nhân vật', text, flags=re.IGNORECASE)
    text = re.sub(r'\btrẻ\s+con\b', 'nhân vật', text, flags=re.IGNORECASE)
    text = re.sub(r'\bcon\s+nít\b', 'nhân vật', text, flags=re.IGNORECASE)

    # 5. Clean up leftover commas and spaces
    text = re.sub(r',\s*,+', ',', text)
    text = re.sub(r'\s+,', ',', text)
    text = re.sub(r',\s*([a-zA-Z0-9_]+\s+(?:stands|walks|looks|runs|sits|swings|speaks|listens|holds|turns|moves))', r' \1', text)
    text = re.sub(r'\s\s+', ' ', text)
    return text.strip()


def build_adaptive_scene_chunks(scenes: List[Dict[str, Any]], requested_chunk_size: int) -> List[List[Dict[str, Any]]]:
    """Keep detailed scenes small enough to preserve structured-output quality.

    ``requested_chunk_size`` remains a hard upper bound. A long action, several
    dialogue turns, many characters/props, or an explicit transition consumes a
    larger complexity budget. This is deliberately deterministic: it avoids an
    additional Gemini request merely to decide how to batch Gemini work.
    """
    max_scenes = max(1, requested_chunk_size)
    max_budget = max(4, max_scenes * 3)
    chunks: List[List[Dict[str, Any]]] = []
    current: List[Dict[str, Any]] = []
    budget = 0

    for scene in scenes:
        action = str(scene.get("action") or scene.get("description") or "")
        dialogues = scene.get("dialogue") or scene.get("dialogues") or []
        characters = scene.get("characters") or []
        props = scene.get("props") or []
        transition = str(scene.get("transition") or "")
        complexity = 1
        complexity += min(2, len(action) // 500)
        complexity += 1 if len(dialogues) >= 2 else 0
        complexity += 1 if len(characters) >= 3 else 0
        complexity += 1 if len(props) >= 3 else 0
        complexity += 1 if transition else 0

        if current and (len(current) >= max_scenes or budget + complexity > max_budget):
            chunks.append(current)
            current, budget = [], 0
        current.append(scene)
        budget += complexity

    if current:
        chunks.append(current)
    return chunks


DEFAULT_MOTION_PRESET_TEMPLATE = """SCENE:
{scene}

REFERENCE:
{reference}

CHARACTERS:
{characters}

SHOT:
{shot}

TIMELINE:
{timeline}

DIALOGUE:
{dialogue}

ACTIONS:
{actions}

SPATIAL RULES:
{spatial_rules}

ENDING:
{ending}

STYLE:
{style}"""


def compile_motion_prompt(shot: Shot, character_map: Optional[Dict[str, Any]] = None, preset_template: Optional[str] = None) -> str:
    """Constructs a production-grade Veo 3 motion prompt directly from shot data by filling placeholders into preset template."""
    import re

    # 1. SCENE
    scene_desc = shot.environment.strip() if shot.environment else "General View"
    if shot.lighting:
        clean_lighting = re.sub(r'\s*\([^)]*\)', '', shot.lighting).strip().rstrip('.')
        scene_desc += f". {clean_lighting} matching the reference image."
    else:
        scene_desc += ". Warm sunlight matching the reference image."

    # 2. REFERENCE
    ref_str = "Continue from the provided reference image. Do not change characters' appearance or background environment."

    # 3. CHARACTERS (ONLY character names - NO age, gender, appearance, or outfit re-descriptions)
    char_lines = []
    chars = shot.characters or []
    for c in chars:
        if c and c.strip():
            char_lines.append(f"- {c.strip()}")
    char_str = "\n".join(char_lines) if char_lines else "None"

    # 4. SHOT
    raw_shot_type = shot.shot_type or "Medium Shot"
    clean_shot_type = re.sub(r'\s*\([^)]*\)', '', raw_shot_type)
    clean_shot_type = re.split(r',', clean_shot_type)[0].strip().rstrip('.')
    clean_camera_mov = (shot.camera_movement or "Static").strip().rstrip('.')
    camera_str = f"{clean_shot_type}. {clean_camera_mov}."

    # 5. TIMELINE & 7. ACTIONS parsing
    raw_actions = (shot.actions or "").strip()
    
    # Check if raw_actions or timeline items contain embedded sub-timecodes (e.g. "0-2s Emma swings...")
    combined_actions_text = raw_actions
    for t_item in (shot.timeline or []):
        if t_item.action and re.search(r'\d+-\d+s?\s*', t_item.action):
            combined_actions_text += " " + t_item.action

    timecode_matches = re.findall(r'(\d+-\d+s?\s*[^;\n]+)', combined_actions_text)
    
    timeline_lines = []
    actions_clean_phrases = []

    if timecode_matches:
        seen_matches = set()
        for match in timecode_matches:
            match_clean = match.strip().rstrip(';')
            if match_clean.lower() not in seen_matches:
                seen_matches.add(match_clean.lower())
                timeline_lines.append(match_clean)
                clean_phrase = re.sub(r'^\d+-\d+s?\s*', '', match_clean).strip()
                if clean_phrase and clean_phrase.lower() not in [p.lower() for p in actions_clean_phrases]:
                    actions_clean_phrases.append(clean_phrase)
    else:
        for item in (shot.timeline or []):
            t_clean = item.time.strip()
            if t_clean and not t_clean.endswith('s') and '-' in t_clean:
                t_clean += 's'
            action_text = item.action.strip()
            if re.match(r'^\d+-\d+s?\s*', action_text):
                timeline_lines.append(action_text)
            else:
                timeline_lines.append(f"{t_clean} {action_text}")
            clean_phrase = re.sub(r'^\d+-\d+s?\s*', '', action_text).strip()
            if clean_phrase:
                actions_clean_phrases.append(clean_phrase)
        if not timeline_lines and raw_actions:
            timeline_lines.append(f"0-{shot.duration_seconds}s {raw_actions}")
            actions_clean_phrases.append(raw_actions)

    timeline_str = "\n".join(timeline_lines) if timeline_lines else f"0-{shot.duration_seconds}s Action"

    # 6. DIALOGUE & SOUND FX
    spoken_dialogue_lines = []
    sound_fx_str = getattr(shot, 'sound_fx', None)

    # Build voice lookup from character_map if provided
    voice_map = {}
    if character_map and isinstance(character_map, dict):
        for k, v in character_map.items():
            v_style = getattr(v, 'voice_style', None) or (v.get('voice_style') if isinstance(v, dict) else None)
            if v_style and str(v_style).strip():
                voice_map[k.lower()] = str(v_style).strip()
    elif isinstance(character_map, list):
        for c_obj in character_map:
            c_name = getattr(c_obj, 'canonical_name', None) or getattr(c_obj, 'name', None) or (c_obj.get('canonical_name') if isinstance(c_obj, dict) else None)
            v_style = getattr(c_obj, 'voice_style', None) or (c_obj.get('voice_style') if isinstance(c_obj, dict) else None)
            if c_name and v_style and str(v_style).strip():
                voice_map[str(c_name).lower()] = str(v_style).strip()

    for d in (shot.dialogue or []):
        char_name = d.character.strip()
        speech_text = d.speech.strip()
        if char_name.lower() in ["sound fx", "sfx", "audio", "sound", "music"] or "sound fx" in char_name.lower():
            if not sound_fx_str:
                sound_fx_str = speech_text
            continue
        speech_clean = speech_text.strip('"')
        
        # Attach voice_style description if present for this character
        char_voice = voice_map.get(char_name.lower())
        if char_voice:
            spoken_dialogue_lines.append(f'{char_name} (in a {char_voice}): "{speech_clean}"')
        else:
            spoken_dialogue_lines.append(f'{char_name}: "{speech_clean}"')

    if spoken_dialogue_lines:
        dialogue_lines = list(spoken_dialogue_lines)
        if sound_fx_str and sound_fx_str.strip():
            sfx_clean = sound_fx_str.strip().strip('"')
            dialogue_lines.append(f'Sound FX: "{sfx_clean}"')
        dialogue_str = (
            "\n".join(dialogue_lines) +
            "\nDialogue must match exactly." +
            "\nNo additional speech." +
            "\nRemain silent after the final line."
        )
    elif sound_fx_str and sound_fx_str.strip():
        sfx_clean = sound_fx_str.strip().strip('"')
        dialogue_str = f'Sound FX: "{sfx_clean}"\nRemain silent.'
    else:
        dialogue_str = "None"

    # 7. ACTIONS
    actions_lines = []
    if len(chars) > 1:
        actions_lines.append("Both characters maintain natural breathing, blinking and subtle body movement.")
    elif len(chars) == 1:
        actions_lines.append(f"{chars[0]} maintains natural breathing, blinking and subtle body movement.")
    else:
        actions_lines.append("Characters maintain natural breathing, blinking and subtle body movement.")

    if actions_clean_phrases:
        joined_actions = "; ".join(actions_clean_phrases)
        if joined_actions:
            actions_lines.append(joined_actions)

    actions_str = "\n".join(actions_lines)

    # 8. SPATIAL RULES
    spatial_str = (
        "Characters move only through clear walkable space.\n"
        "Walk along existing aisles.\n"
        "Avoid tables, chairs, walls and furniture.\n"
        "Never intersect scene objects.\n"
        "Stop before interacting with furniture.\n"
        "Keep both feet naturally on the floor.\n"
        "Maintain realistic spacing from surrounding objects."
    )

    # 9. ENDING
    ending_str = "Hold final pose silently. Blink and breathe naturally."

    # 10. STYLE
    style_str = (
        "High-quality stylized 3D animation.\n"
        "Feature film quality.\n"
        "No on-screen text."
    )

    template = preset_template if preset_template and preset_template.strip() else DEFAULT_MOTION_PRESET_TEMPLATE

    return template.format(
        scene=scene_desc,
        reference=ref_str,
        characters=char_str,
        shot=camera_str,
        timeline=timeline_str,
        dialogue=dialogue_str,
        actions=actions_str,
        spatial_rules=spatial_str,
        ending=ending_str,
        style=style_str,
    )


def parse_storyboard_manual(storyboard: str) -> Optional[StoryAnalysisResponse]:
    """Parses raw storyboard text deterministically using regex matching when written in standardized format.
    Eliminates Gemini API overhead, latency, quota consumption, and safety filter false-positives.
    """
    if not storyboard or not storyboard.strip():
        return None
    
    clean_story = storyboard.strip()
    
    # Split text into scene blocks using Scene/Cảnh/Phân cảnh/Shot markers or horizontal dividers
    scene_blocks = re.split(r'(?:\r?\n)+(?=(?:\[MỞ CẢNH:[^\]]+\]\s*)?(?:Scene|Cảnh|Phân cảnh|Shot)\s*#?\s*\d+)', clean_story, flags=re.IGNORECASE)
    if len(scene_blocks) <= 1:
        scene_blocks = re.split(r'(?:\r?\n)*[-=_]{3,}(?:\r?\n)*', clean_story)
    if len(scene_blocks) <= 1:
        scene_blocks = [b.strip() for b in re.split(r'(?:\r?\n){2,}', clean_story) if b.strip()]
    
    parsed_scenes: List[SceneAnalysis] = []
    
    for idx, block in enumerate(scene_blocks, 1):
        block = block.strip()
        if not block:
            continue
        
        num_match = re.search(r'(?:Scene|Cảnh|Phân cảnh|Shot)\s*#?\s*(\d+)', block, re.IGNORECASE)
        scene_num = int(num_match.group(1)) if num_match else idx
        
        open_trans_match = re.search(r'\[MỞ CẢNH:\s*([^\]]+)\]', block, re.IGNORECASE)
        opening_trans = open_trans_match.group(1).strip() if open_trans_match else ""
        
        setting_match = re.search(r'(?:Setting|Location|Bối cảnh|Địa điểm):\s*([^\n\r]+)', block, re.IGNORECASE)
        location = setting_match.group(1).strip() if setting_match else "Unspecified"
        
        duration_match = re.search(r'(?:Duration|Thời lượng):\s*~?(\d+)\s*s?', block, re.IGNORECASE)
        duration_sec = int(duration_match.group(1)) if duration_match else 5
        
        chars_match = re.search(r'(?:Characters|Nhân vật):\s*([^\n\r]+)', block, re.IGNORECASE)
        characters = []
        if chars_match:
            raw_chars = chars_match.group(1).strip()
            if raw_chars.lower() != "none" and raw_chars.lower() != "không có":
                characters = [c.strip() for c in raw_chars.split(",") if c.strip()]
        
        props_match = re.search(r'(?:Props|Đạo cụ):\s*([^\n\r]+)', block, re.IGNORECASE)
        props = []
        if props_match:
            raw_props = props_match.group(1).strip()
            if raw_props.lower() != "none" and raw_props.lower() != "không có":
                props = [p.strip() for p in raw_props.split(",") if p.strip()]
        
        # Match visual action or character motion
        visual_match = re.search(r'(?:Visual Description|Visual|Mô tả hình ảnh|Hình ảnh):\s*([^\n\r]+)', block, re.IGNORECASE)
        char_motion_match = re.search(r'(?:Character Motion|Motion|Chuyển động|Hành động):\s*([^\n\r]+)', block, re.IGNORECASE)
        action_match = re.search(r'\[Action\]\s*[\r\n]+(.*?)(?=[\r\n]+\[|\Z)', block, re.DOTALL | re.IGNORECASE)
        
        parts = []
        if visual_match:
            parts.append(visual_match.group(1).strip())
        if char_motion_match:
            parts.append(char_motion_match.group(1).strip())
        if action_match and not parts:
            parts.append(action_match.group(1).strip())
            
        action_text = " | ".join(parts) if parts else "Scene action"
        
        if opening_trans:
            action_text = f"[Intro Transition: {opening_trans}] {action_text}"
        
        close_trans_match = re.search(r'\[KẾT CẢNH:\s*([^\]]+)\]', block, re.IGNORECASE)
        closing_trans = close_trans_match.group(1).strip() if close_trans_match else ""
        if closing_trans:
            action_text = f"{action_text} [Outro Transition: {closing_trans}]".strip()
            
        dialogue_items: List[DialogueItem] = []
        dialogue_match = re.search(r'(?:\[Dialogue\]|\[Thoại\]|\[AUDIO DATA\]|Dialogue:|Thoại:|Lời thoại:)\s*[\r\n]*(.*?)(?=[\r\n]+\[|\Z)', block, re.DOTALL | re.IGNORECASE)
        if dialogue_match:
            dialogue_block = dialogue_match.group(1).strip()
            for line in dialogue_block.splitlines():
                line = line.strip()
                if not line or line.startswith("[KẾT CẢNH") or line.startswith("Sound FX") or line.startswith("SFX") or line.startswith("Âm thanh"):
                    continue
                d_match = re.match(r'^\(?([^:\)\n]+)\)?:\s*"?([^"\n]+)"?$', line)
                if d_match:
                    speaker = d_match.group(1).strip()
                    speech = d_match.group(2).strip()
                    if speaker.lower() not in ["dialogue", "sound fx", "sfx", "thoại", "lời thoại", "âm thanh"]:
                        dialogue_items.append(DialogueItem(character=speaker, speech=speech))
        
        parsed_scenes.append(
            SceneAnalysis(
                scene_number=scene_num,
                duration_seconds=duration_sec,
                characters=characters,
                location=location,
                props=props,
                action=action_text,
                dialogue=dialogue_items
            )
        )

    if not parsed_scenes:
        return None

    return StoryAnalysisResponse(scenes=parsed_scenes, input_tokens=0, output_tokens=0)


DEFAULT_STYLE_PRESETS: Dict[str, ArtStylePreset] = {
    "3d_pixar": ArtStylePreset(
        id="3d_pixar",
        name="3D Pixar Animation",
        prompt_prefix="3D Disney Pixar animation style, 3D character design, clay render, soft studio lighting",
        prompt_suffix="cinematic lighting, ultra-detailed, 8k resolution, raytracing"
    ),
    "2d_anime": ArtStylePreset(
        id="2d_anime",
        name="2D Anime (Ghibli Style)",
        prompt_prefix="Studio Ghibli 2D anime style, vibrant watercolor background, detailed line art",
        prompt_suffix="masterpiece, best quality, lush aesthetics, 8k"
    ),
    "cinematic_realism": ArtStylePreset(
        id="cinematic_realism",
        name="Cinematic Realism",
        prompt_prefix="Cinematic live-action film still, 35mm lens, realistic depth of field",
        prompt_suffix="photorealistic, 8k resolution, film grain, dramatic lighting"
    ),
    "cyberpunk_3d": ArtStylePreset(
        id="cyberpunk_3d",
        name="3D Cyberpunk Sci-Fi",
        prompt_prefix="3D sci-fi cyberpunk style, neon reflections, futuristic tech details",
        prompt_suffix="unreal engine 5, octane render, volumetric lighting, high contrast"
    )
}

def parse_storyboard_to_standardized_shots(storyboard: str) -> List[StandardizedShotData]:
    """Parses raw storyboard into structured StandardizedShotData objects capturing Image, Motion, and Audio fields."""
    if not storyboard or not storyboard.strip():
        return []
    
    scene_blocks = re.split(r'(?:\r?\n)+(?=(?:\[MỞ CẢNH:[^\]]+\]\s*)?(?:Scene|Cảnh|Phân cảnh|Shot)\s*#?\s*\d+)', storyboard.strip(), flags=re.IGNORECASE)
    shots: List[StandardizedShotData] = []
    
    for block in scene_blocks:
        block = block.strip()
        if not block:
            continue
        
        num_match = re.search(r'(?:Scene|Cảnh|Phân cảnh|Shot)\s*#?\s*(\d+)', block, re.IGNORECASE)
        if not num_match:
            continue
        scene_num = int(num_match.group(1))
        
        open_trans_match = re.search(r'\[MỞ CẢNH:\s*([^\]]+)\]', block, re.IGNORECASE)
        opening_trans = open_trans_match.group(1).strip() if open_trans_match else ""
        
        close_trans_match = re.search(r'\[KẾT CẢNH:\s*([^\]]+)\]', block, re.IGNORECASE)
        closing_trans = close_trans_match.group(1).strip() if close_trans_match else ""
        
        setting_match = re.search(r'(?:Setting|Location|Bối cảnh|Địa điểm):\s*([^\n\r]+)', block, re.IGNORECASE)
        setting = setting_match.group(1).strip() if setting_match else ""
        
        duration_match = re.search(r'(?:Duration|Thời lượng):\s*~?(\d+)\s*s?', block, re.IGNORECASE)
        duration_sec = int(duration_match.group(1)) if duration_match else 5
        
        chars_match = re.search(r'(?:Characters|Nhân vật):\s*([^\n\r]+)', block, re.IGNORECASE)
        characters = []
        if chars_match:
            raw_chars = chars_match.group(1).strip()
            if raw_chars.lower() != "none" and raw_chars.lower() != "không có":
                characters = [c.strip() for c in raw_chars.split(",") if c.strip()]
        
        props_match = re.search(r'(?:Props|Đạo cụ):\s*([^\n\r]+)', block, re.IGNORECASE)
        props = []
        if props_match:
            raw_props = props_match.group(1).strip()
            if raw_props.lower() != "none" and raw_props.lower() != "không có":
                props = [p.strip() for p in raw_props.split(",") if p.strip()]
        
        shot_type_match = re.search(r'(?:Shot Type|Góc máy|Shot):\s*([^\n\r]+)', block, re.IGNORECASE)
        shot_type = shot_type_match.group(1).strip() if shot_type_match else ""
        
        lighting_match = re.search(r'(?:Lighting|Ánh sáng):\s*([^\n\r]+)', block, re.IGNORECASE)
        lighting = lighting_match.group(1).strip() if lighting_match else ""
        
        visual_match = re.search(r'(?:Visual Description|Visual|Mô tả hình ảnh|Hình ảnh):\s*([^\n\r]+)', block, re.IGNORECASE)
        if not visual_match:
            visual_match = re.search(r'\[Action\]\s*[\r\n]+(.*?)(?=[\r\n]+\[|[\r\n]+Setting:|[\r\n]+Bối cảnh:|\Z)', block, re.DOTALL | re.IGNORECASE)
        visual = visual_match.group(1).strip() if visual_match else ""
        
        char_motion_match = re.search(r'(?:Character Motion|Motion|Chuyển động|Hành động):\s*([^\n\r]+)', block, re.IGNORECASE)
        char_motion = char_motion_match.group(1).strip() if char_motion_match else ""
        
        cam_motion_match = re.search(r'(?:Camera Motion|Chuyển động máy quay|Hành động máy quay):\s*([^\n\r]+)', block, re.IGNORECASE)
        cam_motion = cam_motion_match.group(1).strip() if cam_motion_match else ""
        
        sfx_match = re.search(r'(?:Sound FX|SFX|Âm thanh|Hiệu ứng âm thanh):\s*([^\n\r]+)', block, re.IGNORECASE)
        sfx = sfx_match.group(1).strip() if sfx_match else ""
        
        dialogue_items: List[DialogueItem] = []
        dialogue_match = re.search(r'(?:\[Dialogue\]|\[Thoại\]|Dialogue:|Thoại:|Lời thoại:)\s*[\r\n]*(.*?)(?=[\r\n]+\[|\Z)', block, re.DOTALL | re.IGNORECASE)
        if dialogue_match:
            dialogue_block = dialogue_match.group(1).strip()
            for line in dialogue_block.splitlines():
                line = line.strip()
                if not line or line.startswith("[KẾT CẢNH"):
                    continue
                d_match = re.match(r'^\(?([^:\)\n]+)\)?:\s*"?([^"\n]+)"?$', line)
                if d_match:
                    dialogue_items.append(DialogueItem(character=d_match.group(1).strip(), speech=d_match.group(2).strip()))
        
        shot_data = StandardizedShotData(
            scene_number=scene_num,
            duration_seconds=duration_sec,
            setting=setting,
            characters=characters,
            props=props,
            shot_type=shot_type,
            lighting=lighting,
            visual=visual,
            character_motion=char_motion,
            camera_motion=cam_motion,
            dialogue=dialogue_items,
            sound_fx=sfx,
            opening_transition=opening_trans,
            closing_transition=closing_trans
        )
        shots.append(shot_data)
        
    return shots

def assemble_prompts(shots: List[StandardizedShotData], style_preset_id: str = "3d_pixar") -> List[StandardizedShotData]:
    """Assembles image and video prompts for each shot using selected Art Style Preset."""
    preset = DEFAULT_STYLE_PRESETS.get(style_preset_id, DEFAULT_STYLE_PRESETS["3d_pixar"])
    
    for shot in shots:
        # Assembling Image Prompt
        img_parts = []
        if preset.prompt_prefix:
            img_parts.append(preset.prompt_prefix)
        # Omit environment, characters, and props from shot prompt because they are provided as reference images.
        # "PROMPT Shots không cần lấy lại data của characters, bối cảnh, props, chỉ cần có các ảnh tham chiếu đúng là được rồi."
        if shot.visual:
            img_parts.append(shot.visual)
        if shot.shot_type:
            img_parts.append(f"framing: {shot.shot_type}")
        if shot.lighting:
            img_parts.append(f"lighting: {shot.lighting}")
        if preset.prompt_suffix:
            img_parts.append(preset.prompt_suffix)
        
        shot.assembled_image_prompt = ", ".join([p for p in img_parts if p])
        
        # Assembling Video Motion Prompt using 10-section preset template
        temp_shot = Shot(
            shot_id=f"Shot{shot.scene_number:03d}",
            scene_number=shot.scene_number,
            duration_seconds=shot.duration_seconds,
            actions=shot.character_motion or shot.visual or "Scene action",
            characters=shot.characters,
            environment=shot.setting or "Unspecified location",
            props=shot.props,
            dialogue=shot.dialogue,
            camera_movement=shot.camera_motion or "Static",
            shot_type=shot.shot_type or "Medium Shot",
            transition=shot.closing_transition or shot.opening_transition or "Cut",
            composition="Rule of Thirds",
            lighting=shot.lighting or "Warm sunlight",
            camera=f"{shot.shot_type or 'Medium Shot'}. {shot.camera_motion or 'Static'}.",
            timeline=[TimelineItem(time=f"0-{shot.duration_seconds}s", action=shot.character_motion or shot.visual or "Action")],
            motion=MotionDetails(primary_motion=shot.character_motion or "Action", secondary_motion=["Blink", "Breathing"], motion_level="Low"),
            keyframe_prompt=shot.assembled_image_prompt,
            motion_prompt=""
        )
        shot.assembled_video_prompt = compile_motion_prompt(temp_shot)
        
    return shots


# --- Step 1: Story Analyzer with Scene State Ledger ---

STORY_ANALYZER_SYSTEM = """You are an expert Animation Director & Script Analyst.
Analyze the raw storyboard text and break it down into chronological scenes.
For each scene, output:
1. scene_number (int)
2. duration_seconds (int, 3-10s)
3. characters (list of character names)
4. location (setting name)
5. props (list of physical items used)
6. action (detailed visual actions)
7. dialogue (list of speaking character + speech)
8. state_before (list of key-value items describing the state of key characters, locations, held objects, and item status BEFORE the scene starts, e.g. key="alex_location", value="maze center")
9. state_after (list of key-value items describing state changes AFTER the scene finishes, e.g. key="explorer_badge", value="missing")

Ensure state_before and state_after allow future scene batches to run independently without waiting for prior scene outputs."""

async def run_story_analyzer(
    storyboard: str,
    profile_ids: Optional[List[str]] = None,
    model: str = "gemini-2.5-flash",
    raw_api_keys: Optional[List[str]] = None,
) -> StoryAnalysisResponse:
    # Check deterministic manual parser first to avoid unnecessary Gemini API calls
    manual_res = parse_storyboard_manual(storyboard)
    if manual_res and len(manual_res.scenes) > 0:
        logger.info(f"Successfully parsed {len(manual_res.scenes)} scenes deterministically from standardized storyboard format without Gemini API.")
        return manual_res

    prompt = f"Analyze the following storyboard into structured scene analysis with state_before and state_after ledgers:\n\n{clean_text_for_safety(storyboard)}"
    raw_res = await generate_gemini_content(
        prompt=prompt,
        system_instruction=STORY_ANALYZER_SYSTEM,
        response_schema=StoryAnalysisResponse,
        model=model,
        profile_ids=profile_ids,
        raw_api_keys=raw_api_keys,
    )
    return StoryAnalysisResponse.model_validate_json(raw_res)


# --- Step 2: Single 1x Asset Extractor ---

ASSETS_EXTRACTOR_SYSTEM = """You are a Lead Character & Environment Art Director for 3D Feature Animation.
Analyze the input storyboard and scene descriptions carefully. Infer and expand rich details for every unique character, environment, and prop:

1. CHARACTERS:
- canonical_name: Exact character name (e.g. Emma, Stranger, Mom)
- age: Infer specific realistic age/age range from story context (e.g. "7-year-old young girl", "35-year-old adult man", "30-year-old mother")
- gender: "Female" or "Male"
- appearance: Detailed facial features, eye expression, skin tone, build, distinctive physical traits.
- outfit: Detailed clothing items, colors, fabrics, shoes.
- hairstyle: Hair color, length, style.
- accessories: Any items worn or carried (hat, backpack, glasses).
- voice_style: Specific voice tone and vocal personality (e.g. "high-pitched sweet young girl voice", "calm soft-spoken male voice").
- personality: Key personality traits.
- turnaround_prompt: Highly detailed 3D character turnaround sheet prompt specifying: "Character turnaround sheet of [canonical_name], [age] [gender], [appearance], wearing [outfit], [hairstyle], front view, side view, back view, neutral T-pose, clean studio background, studio lighting, ultra-detailed 8k render, no text."

2. ENVIRONMENTS:
- name: Clear background location name
- reference_prompt: Detailed 3D environment background reference prompt without characters, specifying architectural details, lighting, depth, 8k render.

3. PROPS:
- name: Prop item name
- reference_prompt: Detailed isolated 3D prop asset reference prompt."""

def build_deterministic_assets(scenes: List[SceneAnalysis]) -> AssetsResponse:
    """Builds Character, Environment, and Prop Bibles instantly (0.001s) from scene metadata.
    Eliminates Gemini API timeouts, latency, and safety blocks during Step 2 Asset Extraction.
    """
    unique_chars: List[CharacterAsset] = []
    seen_chars = set()
    unique_envs: List[EnvironmentAsset] = []
    seen_envs = set()
    unique_props: List[PropAsset] = []
    seen_props = set()
    
    for sc in scenes:
        # Environments
        env_name = sc.location.strip() if sc.location else "general_environment"
        if env_name.lower() not in seen_envs:
            seen_envs.add(env_name.lower())
            clean_id = f"env_{env_name.lower().replace(' ', '_')}"
            ref_p = f"Pixar 3D animation style background reference of {env_name}, warm cinematic lighting, feature film 8k render, no text."
            unique_envs.append(
                EnvironmentAsset(
                    id=clean_id,
                    name=env_name,
                    reference_prompt=ref_p,
                    prompt=ref_p
                )
            )
            
        # Characters
        for char in sc.characters:
            char_name = char.strip()
            if not char_name or char_name.lower() in ("none", "null"):
                continue
            if char_name.lower() not in seen_chars:
                seen_chars.add(char_name.lower())
                clean_id = f"char_{char_name.lower().replace(' ', '_')}"
                ref_c = f"Pixar 3D animation style character turnaround sheet of {char_name}, front view, side view, back view, neutral pose, clean studio lighting, 8k render, no text."
                unique_chars.append(
                    CharacterAsset(
                        id=clean_id,
                        canonical_name=char_name,
                        name=char_name,
                        age="character",
                        gender="character",
                        appearance="Expressive 3D character face, clean Pixar animation style",
                        outfit="Stylized 3D outfit matching character reference image",
                        hairstyle="Stylized 3D hair",
                        accessories="None",
                        voice_style="Gentle expressive tone",
                        personality="Friendly and adventurous",
                        turnaround_prompt=ref_c,
                        prompt=ref_c
                    )
                )
                
        # Props
        for prop in sc.props:
            prop_name = prop.strip()
            if not prop_name or prop_name.lower() in ("none", "null"):
                continue
            if prop_name.lower() not in seen_props:
                seen_props.add(prop_name.lower())
                clean_id = f"prop_{prop_name.lower().replace(' ', '_')}"
                ref_prop = f"Pixar 3D animation style prop reference asset of {prop_name}, clean studio lighting, isolated 3D object render, no text."
                unique_props.append(
                    PropAsset(
                        id=clean_id,
                        name=prop_name,
                        reference_prompt=ref_prop,
                        prompt=ref_prop
                    )
                )
                
    return AssetsResponse(
        characters=unique_chars,
        environments=unique_envs,
        props=unique_props,
        input_tokens=0,
        output_tokens=0
    )


async def run_assets_extractor(
    storyboard: str,
    scenes_json: str,
    profile_ids: Optional[List[str]] = None,
    model: str = "gemini-2.5-flash",
    raw_api_keys: Optional[List[str]] = None,
) -> AssetsResponse:
    """Uses Gemini API to analyze character traits, age, gender, appearance, outfit, voice style, and detailed turnaround prompts."""
    prompt = f"Analyze and extract detailed characters, environments, and props from storyboard and scene analysis:\n\nSTORYBOARD:\n{clean_text_for_safety(storyboard)}\n\nSCENES:\n{clean_text_for_safety(scenes_json)}"
    try:
        raw_res = await generate_gemini_content(
            prompt=prompt,
            system_instruction=ASSETS_EXTRACTOR_SYSTEM,
            response_schema=AssetsResponse,
            model=model,
            profile_ids=profile_ids,
            raw_api_keys=raw_api_keys,
        )
        res = AssetsResponse.model_validate_json(raw_res)
        # Ensure backward-compatible prompts
        for c in res.characters:
            if not c.turnaround_prompt:
                c.turnaround_prompt = f"Pixar 3D animation style character turnaround sheet of {c.canonical_name}, {c.age} {c.gender}, {c.appearance}, wearing {c.outfit}, front view, side view, back view, neutral pose, clean studio lighting, 8k render, no text."
            c.prompt = c.turnaround_prompt
        for e in res.environments:
            if not e.reference_prompt:
                e.reference_prompt = f"Pixar 3D animation style background reference of {e.name}, warm cinematic lighting, feature film 8k render, no text."
            e.prompt = e.reference_prompt
        for p in res.props:
            if not p.reference_prompt:
                p.reference_prompt = f"Pixar 3D animation style prop reference asset of {p.name}, clean studio lighting, isolated 3D object render, no text."
            p.prompt = p.reference_prompt
        return res
    except Exception as err:
        logger.warning("Gemini Asset Extractor failed (%s). Falling back to deterministic assets.", err)
        parsed_scenes: List[SceneAnalysis] = []
        if scenes_json:
            try:
                raw_data = json.loads(scenes_json)
                if isinstance(raw_data, list):
                    parsed_scenes = [SceneAnalysis.model_validate(item) for item in raw_data]
            except Exception:
                pass
        if not parsed_scenes:
            manual_story = parse_storyboard_manual(storyboard)
            if manual_story and manual_story.scenes:
                parsed_scenes = manual_story.scenes
        return build_deterministic_assets(parsed_scenes)


# --- Step 3: Dynamic Token Chunking ---

def chunk_scenes_by_tokens(
    scenes: List[SceneAnalysis],
    preset: str = "balanced",
) -> List[List[SceneAnalysis]]:
    """Groups scenes into dynamic batches based on estimated token weight and max shot constraints."""
    preset_limits = {
        "quality": {"target_tokens": 20000, "max_shots": 6, "max_scenes": 2},
        "balanced": {"target_tokens": 25000, "max_shots": 8, "max_scenes": 4},
        "fast": {"target_tokens": 32000, "max_shots": 10, "max_scenes": 6},
    }
    limits = preset_limits.get(preset.lower(), preset_limits["balanced"])
    batches: List[List[SceneAnalysis]] = []
    current_batch: List[SceneAnalysis] = []
    current_tokens = 0
    current_shots = 0

    for scene in scenes:
        scene_str = json.dumps(scene.model_dump(), ensure_ascii=False)
        scene_tokens = estimate_tokens(scene_str)
        # Estimate ~2 shots per scene average
        est_shots = max(1, len(scene.dialogue) + 1)

        exceeds_tokens = (current_tokens + scene_tokens > limits["target_tokens"]) and len(current_batch) > 0
        exceeds_shots = (current_shots + est_shots > limits["max_shots"]) and len(current_batch) > 0
        exceeds_scenes = len(current_batch) >= limits["max_scenes"]

        if exceeds_tokens or exceeds_shots or exceeds_scenes:
            batches.append(current_batch)
            current_batch = [scene]
            current_tokens = scene_tokens
            current_shots = est_shots
        else:
            current_batch.append(scene)
            current_tokens += scene_tokens
            current_shots += est_shots

    if current_batch:
        batches.append(current_batch)

    logger.info("Dynamic token chunking (%s): split %d scenes into %d batches", preset, len(scenes), len(batches))
    return batches


# --- Step 4: Shot Planning Batch Worker ---

SHOT_PLANNER_SYSTEM = """You are a Senior Cinematographer & Animation Technical Director.
Plan visual shots for the provided scene batch using character, environment, and prop bibles plus scene state_before/state_after ledgers.

CRITICAL DIRECT MAPPING RULES FROM STORYBOARD SCENE:
Every generated shot, keyframe_prompt, and motion_prompt MUST derive 100% of its content directly from the input Storyboard Scene:
1. Environment/Location (`SCENE:`): MUST match the Scene's `location`/`Setting` (e.g. `villa_livingroom`).
2. Duration (`TIMELINE:`): MUST match the Scene's `duration_seconds`/`Duration` (e.g. `0-6s`).
3. Characters (`CHARACTERS:`): MUST list ONLY the exact canonical character names appearing in the Scene (e.g. `- lily`, `- stranger_guy`).
4. Props: MUST match the Scene's active `props` (e.g. `red_backpack`, `folded_map`).
5. Actions (`ACTIONS:`, `TIMELINE:`): MUST be derived directly from the Scene's `action` text.
6. Dialogue (`DIALOGUE:`): MUST match the exact character speech lines from the Scene's `dialogue`.

NO RE-DESCRIPTION RULE:
DO NOT include character visual descriptions (age, clothes, hair, shoes, child terms) inside keyframe_prompt or motion_prompt. Character appearance is handled by the Character Bible. In keyframe_prompt and motion_prompt, refer to characters ONLY by their exact canonical names."""

async def run_shot_planner_batch(
    scenes_batch: List[SceneAnalysis],
    characters: List[CharacterAsset],
    environments: List[EnvironmentAsset],
    props: List[PropAsset],
    profile_ids: Optional[List[str]] = None,
    model: str = "gemini-2.5-flash",
    raw_api_keys: Optional[List[str]] = None,
) -> List[Shot]:
    scenes_json = json.dumps([s.model_dump() for s in scenes_batch], ensure_ascii=False)
    chars_json = json.dumps([c.model_dump() for c in characters], ensure_ascii=False)
    envs_json = json.dumps([e.model_dump() for e in environments], ensure_ascii=False)
    props_json = json.dumps([p.model_dump() for p in props], ensure_ascii=False)

    prompt = (
        f"CHARACTER BIBLE:\n{clean_text_for_safety(chars_json)}\n\n"
        f"ENVIRONMENT BIBLE:\n{clean_text_for_safety(envs_json)}\n\n"
        f"PROP BIBLE:\n{clean_text_for_safety(props_json)}\n\n"
        f"SCENES BATCH (with state ledgers):\n{clean_text_for_safety(scenes_json)}"
    )

    scene_nums = [s.scene_number for s in scenes_batch]
    try:
        raw_res = await generate_gemini_content(
            prompt=prompt,
            system_instruction=SHOT_PLANNER_SYSTEM,
            response_schema=ShotPlannerResponse,
            model=model,
            profile_ids=profile_ids,
            raw_api_keys=raw_api_keys,
        )
    except Exception as err:
        logger.error("Gemini Safety Filter BLOCKED Shot Planner Batch for Scenes %s. Reason: %s", scene_nums, err)
        logger.error("Blocked Prompt Content (Scenes %s):\n%s", scene_nums, prompt[:600])
        raise RuntimeError(f"Shot Planner blocked by Gemini Safety Filter at Scenes {scene_nums}. Details: {err}") from err
    res = ShotPlannerResponse.model_validate_json(raw_res)

    # Always compile motion prompt using compile_motion_prompt to guarantee 100% adherence to 10-section structured spec
    char_map = {c.canonical_name.lower(): c for c in characters}
    for s in res.shots:
        if s.keyframe_prompt:
            s.keyframe_prompt = clean_text_for_safety(s.keyframe_prompt)
        s.motion_prompt = compile_motion_prompt(s, char_map)
    return res.shots


# --- Step 5: Local Validation & Selective Repair ---

def validate_shots_locally(shots: List[Shot]) -> Tuple[List[Shot], List[Dict[str, Any]]]:
    """Validates shots locally. Returns valid shots list and repair queue items for failing shots."""
    valid_shots: List[Shot] = []
    repair_queue: List[Dict[str, Any]] = []

    for idx, shot in enumerate(shots):
        reasons = []
        if not shot.shot_id:
            shot.shot_id = f"Shot{idx+1:03d}"
        if not shot.keyframe_prompt or len(shot.keyframe_prompt) < 20:
            reasons.append("keyframe_prompt empty or too short")
        if not shot.actions:
            reasons.append("actions empty")
        if not shot.camera:
            reasons.append("camera description empty")

        if reasons:
            logger.warning("Local validation issue for %s: %s", shot.shot_id, ", ".join(reasons))
            repair_queue.append({
                "shot_id": shot.shot_id,
                "scene_number": shot.scene_number,
                "reasons": reasons,
                "shot": shot.model_dump(),
            })
        else:
            valid_shots.append(shot)

    return valid_shots, repair_queue


async def repair_single_shot(
    item: Dict[str, Any],
    characters: List[CharacterAsset],
    environments: List[EnvironmentAsset],
    props: List[PropAsset],
    profile_ids: Optional[List[str]] = None,
    model: str = "gemini-2.5-flash",
) -> Shot:
    """Repair a single failing shot via targeted repair prompt."""
    shot_data = item["shot"]
    reasons = ", ".join(item["reasons"])
    prompt = (
        f"Repair and complete this shot. Reason for repair: {reasons}\n"
        f"Existing Shot Data:\n{json.dumps(shot_data, ensure_ascii=False)}"
    )
    raw_res = await generate_gemini_content(
        prompt=prompt,
        system_instruction="You are a Shot Repair Agent. Fix missing or truncated keyframe/motion prompt fields while keeping shot consistency.",
    response_schema=ShotPlannerResponse,
        model=model,
        profile_ids=profile_ids,
    )
    res = ShotPlannerResponse.model_validate_json(raw_res)
    return res.shots[0] if res.shots else Shot.model_validate(shot_data)


def standardized_shots_to_shots(std_shots: List[StandardizedShotData], style_preset_id: str = "3d_pixar") -> List[Shot]:
    """Converts StandardizedShotData into Shot objects deterministically without calling Gemini."""
    assembled = assemble_prompts(std_shots, style_preset_id=style_preset_id)
    result_shots: List[Shot] = []
    for idx, s in enumerate(assembled, 1):
        shot_id = f"Shot{idx:03d}"
        shot = Shot(
            shot_id=shot_id,
            scene_number=s.scene_number,
            duration_seconds=s.duration_seconds,
            actions=s.visual or "Scene action",
            characters=s.characters,
            environment=s.setting or "Unspecified location",
            props=s.props,
            dialogue=s.dialogue,
            camera_movement=s.camera_motion or "Static",
            shot_type=s.shot_type or "Medium Shot",
            transition=s.closing_transition or s.opening_transition or "Cut",
            composition="Rule of Thirds",
            lighting=s.lighting or "Natural lighting",
            camera=f"{s.shot_type or 'Medium Shot'}. {s.camera_motion or 'Static'}.",
            timeline=[TimelineItem(time=f"0-{s.duration_seconds}", action=s.character_motion or s.visual or "Action")],
            motion=MotionDetails(primary_motion=s.character_motion or "Action", secondary_motion=["Blink", "Breathing"], motion_level="Low"),
            keyframe_prompt=s.assembled_image_prompt,
            motion_prompt=""
        )
        shot.motion_prompt = compile_motion_prompt(shot)
        result_shots.append(shot)
    return result_shots


# --- Main Pipeline Task ---

async def execute_pipeline_job(
    job_id: str,
    storyboard: str,
    profile_ids: Optional[List[str]] = None,
    mode: str = "fast",
    quality_preset: str = "balanced",
    style_preset_id: str = "3d_pixar",
) -> None:
    """Executes full pipeline end-to-end.
    Gemini is ONLY called for Step 2 Asset Extractor.
    Shot planning & Prompt Assembly are handled deterministically without extra AI calls when standardized storyboard format is used.
    """
    update_job_status(job_id, status="running", progress=0.05, completed_steps=0)
    ckpt = get_checkpoint(job_id)

    scenes: List[SceneAnalysis] = [SceneAnalysis.model_validate(s) for s in ckpt["scenes"]] if ckpt and ckpt["scenes"] else []
    characters: List[CharacterAsset] = [CharacterAsset.model_validate(c) for c in ckpt["characters"]] if ckpt and ckpt["characters"] else []
    environments: List[EnvironmentAsset] = [EnvironmentAsset.model_validate(e) for e in ckpt["environments"]] if ckpt and ckpt["environments"] else []
    props: List[PropAsset] = [PropAsset.model_validate(p) for p in ckpt["props"]] if ckpt and ckpt["props"] else []
    all_shots: List[Shot] = [Shot.model_validate(s) for s in ckpt["shots"]] if ckpt and ckpt["shots"] else []
    completed_batch_indices: Set[int] = set(ckpt["completed_batch_indices"]) if ckpt and ckpt["completed_batch_indices"] else set()

    # Step 1: Story Analyzer (Deterministic manual parsing preferred)
    if not scenes:
        logger.info("Executing Story Analyzer for job_id=%s", job_id)
        story_res = await run_story_analyzer(storyboard, profile_ids=profile_ids)
        scenes = story_res.scenes
        save_checkpoint(job_id, scenes=[s.model_dump() for s in scenes])
        update_job_status(job_id, progress=0.20, completed_steps=1)

    # Step 2: 1x Combined Asset Extractor (The ONLY Gemini API call)
    if not characters or not environments or not props:
        logger.info("Executing 1x Combined Asset Extractor (Gemini API) for job_id=%s", job_id)
        scenes_json = json.dumps([s.model_dump() for s in scenes], ensure_ascii=False)
        assets_res = await run_assets_extractor(storyboard, scenes_json, profile_ids=profile_ids)
        characters = assets_res.characters
        environments = assets_res.environments
        props = assets_res.props
        save_checkpoint(
            job_id,
            characters=[c.model_dump() for c in characters],
            environments=[e.model_dump() for e in environments],
            props=[p.model_dump() for p in props],
        )
        update_job_status(job_id, progress=0.40, completed_steps=2)

    # Step 3: Fast Deterministic Shot & Prompt Assembly
    std_shots = parse_storyboard_to_standardized_shots(storyboard)
    if std_shots and not all_shots:
        logger.info("Parsing %d standardized shots & assembling prompts deterministically (0 extra Gemini calls)", len(std_shots))
        all_shots = standardized_shots_to_shots(std_shots, style_preset_id=style_preset_id)
        save_checkpoint(job_id, shots=[s.model_dump() for s in all_shots], completed_batch_indices=[0])
        update_job_status(job_id, progress=0.80, completed_steps=3)
    elif not all_shots:
        # Fallback to batch shot planner if not written in standardized format
        batches = chunk_scenes_by_tokens(scenes, preset=quality_preset)
        pending_batch_indices = [idx for idx in range(len(batches)) if idx not in completed_batch_indices]

        if pending_batch_indices:
            logger.info("Executing %d parallel shot planning batches for job_id=%s", len(pending_batch_indices), job_id)

            async def worker_task(batch_idx: int) -> Tuple[int, List[Shot]]:
                b_scenes = batches[batch_idx]
                batch_shots = await run_shot_planner_batch(b_scenes, characters, environments, props, profile_ids=profile_ids)
                return batch_idx, batch_shots

            batch_shots_map: Dict[int, List[Shot]] = {}
            previous_shots = list(all_shots)
            for idx in completed_batch_indices:
                scene_numbers = {scene.scene_number for scene in batches[idx]}
                batch_shots_map[idx] = [shot for shot in previous_shots if shot.scene_number in scene_numbers]

        # Keep only a small number of scheduler tasks in memory. This permits
        # independent batches to use separate authorised quota pools while still
        # checkpointing every completed batch and pausing cleanly on RPD exhaustion.
        concurrency = 4
        pending_iter = iter(pending_batch_indices)
        in_flight: Dict[asyncio.Task, int] = {}
        quota_exhausted_error: Optional[Exception] = None

        def start_next() -> bool:
            try:
                batch_idx = next(pending_iter)
            except StopIteration:
                return False
            task = asyncio.create_task(worker_task(batch_idx))
            in_flight[task] = batch_idx
            return True

        for _ in range(min(concurrency, len(pending_batch_indices))):
            start_next()

        while in_flight:
            done, _ = await asyncio.wait(in_flight.keys(), return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                batch_idx = in_flight.pop(task)
                try:
                    result_idx, b_shots = task.result()
                except Exception as exc:
                    if "daily request limit" in str(exc).lower():
                        quota_exhausted_error = exc
                        break
                    raise
                batch_shots_map[result_idx] = b_shots
                completed_batch_indices.add(result_idx)
                start_next()
            if quota_exhausted_error:
                for task in in_flight:
                    task.cancel()
                await asyncio.gather(*in_flight.keys(), return_exceptions=True)
                break

        # Reconstruct all shots in order
        all_shots = []
        for idx in range(len(batches)):
            if idx in batch_shots_map:
                all_shots.extend(batch_shots_map[idx])

        save_checkpoint(
            job_id,
            shots=[s.model_dump() for s in all_shots],
            completed_batch_indices=list(completed_batch_indices),
        )
        update_job_status(job_id, progress=0.75, completed_steps=3)

        if quota_exhausted_error:
            completed_ratio = len(completed_batch_indices) / max(1, len(batches))
            update_job_status(
                job_id,
                status="paused",
                progress=round(0.40 + completed_ratio * 0.35, 3),
                completed_steps=2,
                error="Daily Gemini request quota reached. Resume after the quota reset.",
            )
            return {
                "job_id": job_id,
                "status": "paused",
                "completed_batches": len(completed_batch_indices),
                "total_batches": len(batches),
            }

    # Step 5: Local Validation & Selective Repair
    valid_shots, repair_queue = validate_shots_locally(all_shots)
    if repair_queue:
        logger.info("Running selective repair queue (%d shots) for job_id=%s", len(repair_queue), job_id)
        repaired_shots: List[Shot] = []
        for item in repair_queue:
            try:
                r_shot = await repair_single_shot(item, characters, environments, props, profile_ids=profile_ids)
                repaired_shots.append(r_shot)
            except Exception as r_err:
                logger.error("Repair failed for %s: %s", item["shot_id"], r_err)
                repaired_shots.append(Shot.model_validate(item["shot"]))

        # Merge repaired shots back into valid shots
        repaired_map = {s.shot_id: s for s in repaired_shots}
        final_shots = [repaired_map.get(s.shot_id, s) for s in all_shots]
        all_shots = final_shots

    # Step 6: Quality Mode (On-demand keyframe & motion regeneration)
    keyframes = [ShotKeyframePrompt(shot_id=s.shot_id, prompt=s.keyframe_prompt) for s in all_shots]
    motion_prompts = [ShotMotionPrompt(shot_id=s.shot_id, prompt=s.motion_prompt) for s in all_shots]

    save_checkpoint(
        job_id,
        shots=[s.model_dump() for s in all_shots],
        keyframes=[k.model_dump() for k in keyframes],
        motion_prompts=[m.model_dump() for m in motion_prompts],
    )
    update_job_status(job_id, status="completed", progress=1.0, completed_steps=5, eta_seconds=0.0)

    logger.info("Pipeline job job_id=%s completed successfully!", job_id)
    return {
        "job_id": job_id,
        "scenes": [s.model_dump() for s in scenes],
        "characters": [c.model_dump() for c in characters],
        "environments": [e.model_dump() for e in environments],
        "props": [p.model_dump() for p in props],
        "shots": [s.model_dump() for s in all_shots],
        "keyframes": [k.model_dump() for k in keyframes],
        "motion_prompts": [m.model_dump() for m in motion_prompts],
    }
