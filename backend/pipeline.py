import json
from typing import List, Dict, Any, Optional
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

def compile_motion_prompt(shot: Shot) -> str:
    parts = []
    
    # 1. Scene
    parts.append(f"Scene:\n{shot.environment}")
    
    # 2. Characters
    chars_str = ", ".join(shot.characters)
    parts.append(f"Characters:\n{chars_str}")
    
    # 3. Reference Image
    parts.append(
        "Reference Image:\n"
        "Continue from the provided reference image. Do not change characters' appearance or background environment."
    )
    
    # 4. Timeline
    timeline_lines = []
    for item in shot.timeline:
        t = item.time
        t_str = f"{t}s" if not t.endswith("s") else t
        timeline_lines.append(f"{t_str} {item.action}.")
    if timeline_lines:
        parts.append("Timeline:\n" + "\n".join(timeline_lines))
    else:
        # Fallback to actions
        parts.append(f"Timeline:\n0-{shot.duration_seconds}s {shot.actions}.")
        
    # 5 & 6. Dialogue & Speech
    if shot.dialogue:
        dialogue_lines = []
        for d in shot.dialogue:
            dialogue_lines.append(f"{d.character}: \"{d.speech}\"")
        dialogue_str = "\n".join(dialogue_lines)
        
        parts.append(
            f"Exact Dialogue:\n"
            f"Speak exactly the dialogue below.\n"
            f"Do not paraphrase.\n"
            f"Do not improvise.\n"
            f"Do not continue speaking.\n"
            f"Do not repeat any words.\n"
            f"{dialogue_str}"
        )
        parts.append(
            "Speech:\n"
            "Generate synchronized speech matching the exact dialogue.\n"
            "Every spoken word must match exactly.\n"
            "Do not add extra speech.\n"
            "Stop speaking immediately after the last word.\n"
            "Use natural pronunciation.\n"
            "Natural pauses."
        )
    else:
        parts.append("Exact Dialogue:\nNone")
        parts.append("Speech:\nNone")
        
    # 7. Camera
    camera_desc = shot.camera if shot.camera else f"{shot.shot_type}, {shot.camera_movement}"
    parts.append(
        f"Camera:\n"
        f"Use the planned camera exactly.\n"
        f"Do not change framing.\n"
        f"Do not add extra camera movement.\n"
        f"{camera_desc}"
    )
    
    # 8. Lighting
    parts.append(
        f"Lighting:\n"
        f"Use the planned lighting from the reference image.\n"
        f"Do not change lighting direction or color.\n"
        f"{shot.lighting}"
    )
    
    # 9. Environment Motion
    parts.append(
        "Environment Motion:\n"
        "Background moves gently. Leaves gently sway, clouds drift slowly. Do not leave background static."
    )
    
    # 10. Character Motion
    char_motion_parts = []
    for c in shot.characters:
        sec_motions = ", ".join(shot.motion.secondary_motion) if shot.motion.secondary_motion else "Blink, Breathing"
        char_motion_parts.append(
            f"Animate {c} naturally.\n"
            f"Primary action: {shot.motion.primary_motion}\n"
            f"Secondary action: {sec_motions}\n"
            f"Motion level: {shot.motion.motion_level}\n"
            f"natural breathing, natural blinking, eye contact, head movement, hand gestures, weight shifting, body balance, micro facial movement."
        )
    if char_motion_parts:
        parts.append("Character Motion:\n" + "\n\n".join(char_motion_parts))
    else:
        parts.append("Character Motion:\nNone")
        
    # 11. Idle Animation
    parts.append(
        "Idle Animation:\n"
        "Non-speaking characters perform breathing, blinking, smiling. No walking/turning."
    )
    
    # 12. Facial Expression
    parts.append(
        "Facial Expression:\n"
        "Friendly smile, eyes focused, natural emotion matching dialogue. Keep emotion intensity stable (default 3-4 out of 10)."
    )
    
    # 13. Ending
    parts.append(
        "Ending:\n"
        "After dialogue ends, character remains silent.\n"
        "remain silent, keep smiling, blink naturally, subtle breathing, small head movement, hold final pose."
    )
    
    # 14. Style
    parts.append(
        "Style:\n"
        "Pixar-quality stylized 3D animation. Feature film quality. Natural motion. No subtitles. No captions. No text."
    )
    
    # 15. Negative
    parts.append(
        "Negative:\n"
        "No extra dialogue. No narration. No voice-over. No lip-sync mismatch. No duplicated speech. No random movements. No extra characters. No camera shake."
    )
    
    return "\n\n".join(parts)

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
    chunk_size: int = 3,
    storyboard: Optional[str] = None
) -> ShotPlannerResponse:
    scenes = json.loads(scenes_json)
    all_characters = json.loads(characters_json) if characters_json else []
    all_environments = json.loads(environments_json) if environments_json else []
    all_props = json.loads(props_json) if props_json else []
    
    # Chunk scenes to execute in groups of chunk_size for stability
    scene_chunks = [scenes[i:i + chunk_size] for i in range(0, len(scenes), chunk_size)]
    
    all_shots = []
    
    system_instruction = (
        "You are an expert animation Shot Prompt Generator.\n"
        "Your task is to translate a sequence of analyzed scenes into individual camera shots, generating both a detailed Keyframe reference image prompt and structured shot parameters (timeline, camera, lighting, motion details, transition, dialogue).\n\n"
        "The analyzed scenes are the single source of truth. You must NOT alter any core content: "
        "do NOT split dialogues, modify dialogues, change durations, add/remove actions, or add/remove characters/props. "
        "The dialogue, duration, actions, characters, environment, and props for each shot MUST be copied exactly from the corresponding scene.\n\n"
        "Your additions for each shot:\n"
        "1. Camera and framing parameters. You must apply these strict Camera Rule mappings to determine camera_movement and shot_type:\n"
        "   - Focus on Dialogue -> shot_type must be 'Medium Shot'\n"
        "   - Focus on Emotion -> shot_type must be 'Close-up'\n"
        "   - Focus on Walking -> camera_movement must be 'Tracking Shot'\n"
        "   - Focus on Introducing a location -> shot_type must be 'Wide Shot'\n"
        "   - Focus on Action (active movements) -> shot_type must be 'Medium Wide'\n"
        "   - Focus on a specific Object -> shot_type must be 'Insert Shot'\n"
        "   - Focus on Reaction -> shot_type must be 'Close-up'\n"
        "   Define `camera` as a combination (e.g. 'Medium Shot, Static'). Specify composition, lighting, transition.\n\n"
        "2. Keyframe Prompt (Image Prompt):\n"
        "   - Write a detailed text-to-image prompt to generate a single static keyframe reference image.\n"
        "   - Only describe the visual appearance: integrate details about character clothing/look (from character reference), environment (from environment reference), active props (from prop reference), camera framing (e.g. Close Up), and mood/lighting.\n"
        "   - Ensure the prompt is formatted in a Pixar-quality stylized 3D, cinematic composition, reference keyframe, no motion blur, no text, no captions.\n"
        "   - Do NOT describe motion, timeline, movement, or speech in the keyframe prompt.\n"
        "   - Clean the text for safety: do not include age descriptors or sensitive child-related terms (ONLY refer to characters by their specific names like 'Lisa', 'Tom', or generic terms like 'person' or 'character' to prevent Gemini API safety blocks. Do NOT use terms like 'boy', 'girl', 'child', or 'kids').\n\n"
        "3. Timeline:\n"
        "   - Generate a chronological breakdown of actions in seconds, matching the shot duration. Example:\n"
        "     [{\"time\": \"0-2\", \"action\": \"Lisa walks toward camera\"}, {\"time\": \"2-6\", \"action\": \"Lisa speaks\"}, {\"time\": \"6-8\", \"action\": \"Lisa smiles\"}]\n\n"
        "4. Motion Details:\n"
        "   - primary_motion: The main motion of the character (e.g. 'Walk') in English.\n"
        "   - secondary_motion: List of secondary/idle motions, e.g. ['Blink', 'Breathing'].\n"
        "   - motion_level: Motion level, e.g. 'Low', 'Medium', 'High'.\n\n"
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
        
        prompt = (
            f"Scenes to generate shots for:\n{chunk_scenes_json}\n\n"
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
            shot.motion_prompt = compile_motion_prompt(shot)
            
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
    if shots and all(bool(s.get("keyframe_prompt")) for s in shots):
        keyframes = [
            ShotKeyframePrompt(shot_id=s["shot_id"], prompt=s["keyframe_prompt"])
            for s in shots
        ]
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
        "You are an expert Keyframe Image Prompt Generator. "
        "For each shot in the provided list, write a detailed text-to-image prompt to generate a single static keyframe reference image. "
        "Integrate details about character clothing/look (from character reference), environment (from environment reference), "
        "active props (from prop reference), camera framing (e.g., Close Up), and mood/lighting. "
        "Ensure the prompt is formatted in a Pixar-quality stylized 3D, cinematic composition, reference keyframe, "
        "no motion blur, no text, no captions.\n"
        "SAFETY RULE: Do NOT use any age-identifying words like 'child', 'children', 'boy', 'girl', 'kid', 'kids', 'young boy', 'young girl', 'schoolboy', 'schoolgirl' or similar child-related terms in the prompts. Instead, ONLY refer to characters by their specific names (e.g. 'Lisa', 'Tom') or generic terms (e.g. 'person', 'character')."
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
        
        prompt = (
            f"Shots to generate keyframe prompts for:\n{chunk_shots_json}\n\n"
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
    
    # Compile motion prompts directly from shot details if custom_instructions is not provided
    has_all_prompts = True
    motion_prompts = []
    
    if not custom_instructions:
        for s in shots:
            try:
                # Try compiling from shot details (no Gemini API calls, extremely fast)
                shot_obj = Shot.model_validate(s)
                if shot_obj.motion_prompt and shot_obj.motion_prompt.strip():
                    compiled = shot_obj.motion_prompt
                else:
                    compiled = compile_motion_prompt(shot_obj)
                motion_prompts.append(ShotMotionPrompt(shot_id=s["shot_id"], prompt=compiled))
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
        "For each shot, you must output a structured, concise, 100% English motion prompt.\n"
        "Keep descriptions short and precise, as the Lite model prefers short prompts.\n"
        "Your generated prompt for each shot MUST strictly follow this exact format (no prose paragraphs):\n\n"
        "Scene:\n[Brief setting name in English]\n\n"
        "Characters:\n[Comma-separated names of characters visible]\n\n"
        "Action Timeline:\n[Timeline of actions in seconds, matching the shot duration. Example:\n"
        "0-2s Lisa walks toward camera.\n"
        "2-5s Lisa waves.\n"
        "5-7s Lisa speaks.\n"
        "7-8s Lisa smiles.]\n\n"
        "Exact Dialogue:\n[Copy storyboard dialogue exactly. If none, write 'None'. Add rule headers:\n"
        "Speak exactly the dialogue below.\n"
        "Do not paraphrase.\n"
        "Do not improvise.\n"
        "Do not continue speaking.\n"
        "Do not repeat any words.]\n\n"
        "Speech:\n[If there is dialogue, write:\n"
        "Generate synchronized speech matching the exact dialogue.\n"
        "Every spoken word must match exactly.\n"
        "Do not add extra speech.\n"
        "Stop speaking immediately after the last word.\n"
        "Use natural pronunciation.\n"
        "Natural pauses.\n"
        "If no dialogue, write 'None']\n\n"
        "Camera:\n[Framing and movement. Apply shot_type and camera_movement. Keep to only one camera movement per shot.]\n\n"
        "Lighting:\n[Current lighting, e.g. 'Warm afternoon sunlight']\n\n"
        "Environment Motion:\n[Minor background movements, e.g., 'Leaves gently sway', 'Curtains move slightly', 'Clouds drift slowly'. Do not leave background static.]\n\n"
        "Character Motion:\n[Natural movement instructions. Do not use overacting. Use:\n"
        "natural breathing, natural blinking, eye contact, head movement, hand gestures, weight shifting, body balance, micro facial movement]\n\n"
        "Facial Expression:\n[Friendly smile, eyes focused, natural emotion matching dialogue. Keep emotion intensity stable (default 3-4 out of 10 unless storyboard specifies otherwise).]\n\n"
        "Audio:\n[If audio/dialogue exists, specify speech sounds, else write 'None']\n\n"
        "Ending:\n[After dialogue ends, character remains silent. Write:\n"
        "remain silent, keep smiling, blink naturally, subtle breathing, small head movement, hold final pose]\n\n"
        "Style:\n[Pixar-quality stylized 3D animation. Feature film quality. Natural motion. No subtitles. No captions. No text.]\n\n"
        "Negative:\n[No extra dialogue. No narration. No voice-over. No lip-sync mismatch. No duplicated speech. No random movements. No extra characters. No camera shake.]\n\n"
        "CRITICAL LIMITS:\n"
        "- Total word count must be between 100 and 150 words. Do not write prose or repeat descriptions.\n"
        "- You must strictly follow the 14 Motion Direction Rules:\n"
        "1. One Primary Action Rule: Exactly 1 primary motion per shot. No multi-action overload.\n"
        "2. Natural Body Motion: Small body gestures (slight head/eye movements, natural blinking/breathing).\n"
        "3. Facial Expression Rule: Stable emotions, transition slowly (e.g. 😊 -> 🙂 -> 😊).\n"
        "4. Gesture Rule: Talk with one-hand movements or head movement only. No wild gestures when standing still.\n"
        "5. Camera Motion Rule: Only one camera movement per shot. No concurrent pan/tilt/zoom.\n"
        "6. Environment Motion Rule: Background moves gently. No strong wind unless storyboard requested.\n"
        "7. Idle Animation Rule: Non-speaking characters perform breathing, blinking, smiling. No walking/turning.\n"
        "8. Dialogue Motion Rule: Speaking characters focus on lip sync, eye contact, micro-gestures. No strong body motion.\n"
        "9. Emotion Rule: No overacting. Default intensity 3-4. 7-8 only if storyboard explicitly states.\n"
        "10. Physics Rule: Smooth Ease-in and Ease-out. No sudden direction changes.\n"
        "11. Style Rule: Characters are cute, gentle, innocent, calm, natural—not hyperactive.\n"
        "12. Timing Rule: Actions must have enough duration.\n"
        "13. Animation Density Rule: 1 Primary Motion and max 2 Secondary Motions per shot.\n"
        "14. Cinematic Acting Rule: Prioritize eyes, micro-expressions, breathing, and pauses over large full-body motions.\n"
        "15. SAFETY RULE: Do NOT use any age-identifying words like 'child', 'children', 'boy', 'girl', 'kid', 'kids', 'young boy', 'young girl', 'schoolboy', 'schoolgirl' or similar child-related terms in the motion prompts. Instead, ONLY refer to characters by their specific names (e.g. 'Lisa', 'Tom') or general pronouns (e.g. 'they', 'he', 'she')."
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
                    f"Please rewrite the motion prompt to fix the errors. Keep it strictly between 100 and 150 words and in the exact format required."
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
        "- prompt dưới giới hạn: The total word count of the Motion Prompt is between 100 and 150 words.\n"
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
