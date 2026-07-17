from pydantic import BaseModel, Field
from typing import List, Optional

# --- Shared & Base Schemas ---

class DialogueItem(BaseModel):
    character: str = Field(description="The name of the character speaking.")
    speech: str = Field(description="The dialogue text spoken by the character.")

# --- Step 1: Story Analyzer ---

class SceneAnalysis(BaseModel):
    scene_number: int = Field(description="The sequential number of the scene.")
    duration_seconds: int = Field(description="Estimated duration of the scene in seconds.")
    characters: List[str] = Field(description="List of characters appearing in this scene.")
    location: str = Field(description="The location or background environment where this scene takes place.")
    props: List[str] = Field(description="List of physical objects/props used in this scene.")
    action: str = Field(description="Description of the visual actions and events in this scene.")
    dialogue: List[DialogueItem] = Field(description="Chronological dialogue exchange in this scene.")

class StoryAnalysisResponse(BaseModel):
    scenes: List[SceneAnalysis] = Field(description="List of analyzed scenes in chronological order.")

# --- Steps 3, 4, 5: Asset Extractors ---

class CharacterAsset(BaseModel):
    id: str = Field(description="Unique character ID (e.g. char_lisa)")
    canonical_name: str = Field(description="The formal, consistent name of the character.")
    name: str = Field(description="Duplicate of canonical_name for backwards compatibility.")
    age: str = Field(description="Age or age range of the character.")
    gender: str = Field(description="Gender of the character.")
    appearance: str = Field(description="Physical appearance details (face, eyes, height, build, etc.).")
    outfit: str = Field(description="Clothing details for this character.")
    hairstyle: str = Field(description="Hair style and color.")
    accessories: str = Field(description="Any accessories like glasses, hats, backpack, etc.")
    voice_style: str = Field(description="Voice style description (e.g. cheerful young boy, gentle female tone).")
    personality: str = Field(description="Personality traits (e.g. energetic, shy, friendly).")
    turnaround_prompt: str = Field(description="Turnaround prompt for reference image generation.")
    prompt: str = Field(description="Duplicate of turnaround_prompt for backwards compatibility.")

class CharacterExtractorResponse(BaseModel):
    characters: List[CharacterAsset] = Field(description="List of all unique characters extracted from the storyboard with reference prompts.")

class EnvironmentAsset(BaseModel):
    id: str = Field(description="Unique environment ID (e.g. env_school_gate)")
    name: str = Field(description="The name of the location.")
    reference_prompt: str = Field(description="A highly detailed reference image prompt for the environment.")
    prompt: str = Field(description="Duplicate of reference_prompt for backwards compatibility.")

class EnvironmentExtractorResponse(BaseModel):
    environments: List[EnvironmentAsset] = Field(description="List of all unique environment environments extracted from the storyboard with reference prompts.")

class PropAsset(BaseModel):
    id: str = Field(description="Unique prop ID (e.g. prop_lunch_box)")
    name: str = Field(description="The name of the prop object.")
    reference_prompt: str = Field(description="A highly detailed reference image prompt for the prop.")
    prompt: str = Field(description="Duplicate of reference_prompt for backwards compatibility.")

class PropExtractorResponse(BaseModel):
    props: List[PropAsset] = Field(description="List of all unique props extracted from the storyboard with reference prompts.")

# --- Step 6: Shot Planner ---

class TimelineItem(BaseModel):
    time: str = Field(description="Time range, e.g., '0-2', '2-6', '6-8' in seconds.")
    action: str = Field(description="Action description in English, e.g., 'Lisa walks', 'Lisa speaks', 'Lisa smiles'.")

class MotionDetails(BaseModel):
    primary_motion: str = Field(description="Primary character action in English, e.g., 'Walk'.")
    secondary_motion: List[str] = Field(default=["Blink", "Breathing"], description="Secondary/idle animation details, e.g., ['Blink', 'Breathing'].")
    motion_level: str = Field(default="Low", description="Motion level, e.g., 'Low', 'Medium', 'High'.")

class Shot(BaseModel):
    shot_id: str = Field(description="Identifier for the shot, formatted like Shot001, Shot002, etc.")
    scene_number: int = Field(description="The scene number this shot belongs to.")
    duration_seconds: int = Field(description="Duration of this shot in seconds.")
    actions: str = Field(description="The specific character actions, movements, or visual events happening in this shot.")
    characters: List[str] = Field(description="Characters visible in this shot.")
    environment: str = Field(description="The environment/location for this shot.")
    props: List[str] = Field(description="Props present in this shot.")
    dialogue: List[DialogueItem] = Field(description="Dialogue spoken during this shot.")
    camera_movement: str = Field(description="Camera movement description (e.g., Static, Pan Left, Zoom In, Tilt Up).")
    shot_type: str = Field(description="Shot type composition (e.g., Close Up, Medium Shot, Wide Shot, Extreme Close Up).")
    transition: str = Field(description="Transition type (e.g. Cut, Dissolve, Fade In, Fade Out).")
    composition: str = Field(description="Cinematic composition (e.g. Rule of Thirds, Centered, Leading Lines).")
    lighting: str = Field(description="Lighting style (e.g. Warm afternoon sunlight, Soft studio lighting).")
    camera: str = Field(description="Camera framing and movement description combined, e.g. 'Medium Shot, Static'.")
    timeline: List[TimelineItem] = Field(description="Action timeline breakdown in seconds.")
    motion: MotionDetails = Field(description="Motion details containing primary, secondary, and motion level.")
    keyframe_prompt: str = Field(description="Detailed image prompt for text-to-image reference. Only describe characters, outfit, environment, props, framing, lighting. No motion, no speech, no timeline.")
    motion_prompt: str = Field(default="", description="Detailed video motion prompt constructed directly from keyframe prompt and shot data.")

class ShotPlannerResponse(BaseModel):
    shots: List[Shot] = Field(description="List of planned shots for the episode.")

# --- Step 7: Keyframe Prompt Generator ---

class ShotKeyframePrompt(BaseModel):
    shot_id: str = Field(description="The ID of the shot (e.g. Shot001).")
    prompt: str = Field(description="A detailed image-to-video keyframe reference prompt combining characters, environments, props, cameras, and actions. Pixar-quality stylized 3D, cinematic composition, reference keyframe, no motion blur, no text.")

class KeyframePromptResponse(BaseModel):
    keyframes: List[ShotKeyframePrompt] = Field(description="Keyframe reference image generation prompts for all shots.")

# --- Step 8: Motion Prompt Generator ---

class ShotMotionPrompt(BaseModel):
    shot_id: str = Field(description="The ID of the shot (e.g. Shot001).")
    prompt: str = Field(description="Veo 3 motion prompt. Incorporate shot action, dialog, natural facial expression, English lip-sync, blinking, breathing, body language, camera description, lighting and style, no subtitles, no text.")

class MotionPromptResponse(BaseModel):
    motion_prompts: List[ShotMotionPrompt] = Field(description="Veo 3 motion and video prompts for all shots.")

class AssetsResponse(BaseModel):
    characters: List[CharacterAsset] = Field(description="Unique list of characters with details and turnaround prompts.")
    environments: List[EnvironmentAsset] = Field(description="Unique list of locations with reference prompts.")
    props: List[PropAsset] = Field(description="Unique list of prop objects with reference prompts.")

# --- Step 9: Veo Compliance Checker ---

class ComplianceCheckResult(BaseModel):
    is_compliant: bool = Field(description="True if the prompt passes all checklist items, False otherwise.")
    errors: List[str] = Field(description="List of specific checklist items that failed.")

# --- API Request/Response schemas ---

class PipelineRequest(BaseModel):
    storyboard: str = Field(description="The raw text storyboard input.")
    api_keys: List[str] = Field(description="List of Gemini API keys for processing.")
    model: str = Field(default="gemini-2.5-flash", description="The Gemini model to use.")
    rpm_limit: int = Field(default=5, description="Requests per minute rate limit.")
    chunk_size: int = Field(default=3, description="Chunk size for list splitting.")
