from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

# --- Shared & Base Schemas ---

class StateItem(BaseModel):
    key: str = Field(description="Name of state variable, e.g. alex_location, map, explorer_badge")
    value: str = Field(description="Current status or value, e.g. maze center, held in hand, missing")

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
    state_before: List[StateItem] = Field(default_factory=list, description="State items before scene starts.")
    state_after: List[StateItem] = Field(default_factory=list, description="State items after scene finishes.")

class StoryAnalysisResponse(BaseModel):
    scenes: List[SceneAnalysis] = Field(description="List of analyzed scenes in chronological order.")
    input_tokens: Optional[int] = 0
    output_tokens: Optional[int] = 0

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
    media_id: Optional[str] = Field(default="", description="The media ID of the character reference image.")
    account_id: Optional[str] = Field(default="", description="The account ID associated with the character reference image.")
    url: Optional[str] = Field(default="", description="The URL of the character reference image.")

class CharacterExtractorResponse(BaseModel):
    characters: List[CharacterAsset] = Field(description="List of all unique characters extracted from the storyboard with reference prompts.")

class EnvironmentAsset(BaseModel):
    id: str = Field(description="Unique environment ID (e.g. env_school_gate)")
    name: str = Field(description="The name of the location.")
    reference_prompt: str = Field(description="A highly detailed reference image prompt for the environment.")
    prompt: str = Field(description="Duplicate of reference_prompt for backwards compatibility.")
    media_id: Optional[str] = Field(default="", description="The media ID of the environment reference image.")
    account_id: Optional[str] = Field(default="", description="The account ID associated with the environment reference image.")
    url: Optional[str] = Field(default="", description="The URL of the environment reference image.")

class EnvironmentExtractorResponse(BaseModel):
    environments: List[EnvironmentAsset] = Field(description="List of all unique environment environments extracted from the storyboard with reference prompts.")

class PropAsset(BaseModel):
    id: str = Field(description="Unique prop ID (e.g. prop_lunch_box)")
    name: str = Field(description="The name of the prop object.")
    reference_prompt: str = Field(description="A highly detailed reference image prompt for the prop.")
    prompt: str = Field(description="Duplicate of reference_prompt for backwards compatibility.")
    media_id: Optional[str] = Field(default="", description="The media ID of the prop reference image.")
    account_id: Optional[str] = Field(default="", description="The account ID associated with the prop reference image.")
    url: Optional[str] = Field(default="", description="The URL of the prop reference image.")

class PropExtractorResponse(BaseModel):
    props: List[PropAsset] = Field(description="List of all unique props extracted from the storyboard with reference prompts.")

class AssetsResponse(BaseModel):
    characters: List[CharacterAsset] = Field(description="Unique list of characters with details and turnaround prompts.")
    environments: List[EnvironmentAsset] = Field(description="Unique list of locations with reference prompts.")
    props: List[PropAsset] = Field(description="Unique list of prop objects with reference prompts.")
    input_tokens: Optional[int] = 0
    output_tokens: Optional[int] = 0

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
    keyframe_prompt: str = Field(description="Detailed image prompt for text-to-image reference image. IMPORTANT: DO NOT re-describe character visual appearance, outfits, hair, age, or child terms. ONLY refer to characters by their exact names (e.g. 'Emma', 'Stranger'). Focus prompt on character action/pose, specific environment name, active props, framing, and lighting. Pixar-quality stylized 3D, no motion blur, no text.")
    motion_prompt: str = Field(default="", description="Detailed video motion prompt constructed directly from shot data. Under CHARACTERS section, list ONLY character names without any descriptions.")

class ShotPlannerResponse(BaseModel):
    shots: List[Shot] = Field(description="List of planned shots for the episode.")
    input_tokens: Optional[int] = 0
    output_tokens: Optional[int] = 0

# --- Step 7: Keyframe Prompt Generator ---

class ShotKeyframePrompt(BaseModel):
    shot_id: str = Field(description="The ID of the shot (e.g. Shot001).")
    prompt: str = Field(description="A detailed image-to-video keyframe reference prompt combining characters, environments, props, cameras, and actions. Pixar-quality stylized 3D, cinematic composition, reference keyframe, no motion blur, no text.")

class KeyframePromptResponse(BaseModel):
    keyframes: List[ShotKeyframePrompt] = Field(description="Keyframe reference image generation prompts for all shots.")
    input_tokens: Optional[int] = 0
    output_tokens: Optional[int] = 0

# --- Step 8: Motion Prompt Generator ---

class ShotMotionPrompt(BaseModel):
    shot_id: str = Field(description="The ID of the shot (e.g. Shot001).")
    prompt: str = Field(description="Veo 3 motion prompt. Incorporate shot action, dialog, natural facial expression, English lip-sync, blinking, breathing, body language, camera description, lighting and style, no subtitles, no text.")

class MotionPromptResponse(BaseModel):
    motion_prompts: List[ShotMotionPrompt] = Field(description="Veo 3 motion and video prompts for all shots.")
    input_tokens: Optional[int] = 0
    output_tokens: Optional[int] = 0

# --- Step 9: Veo Compliance Checker ---

class ComplianceCheckResult(BaseModel):
    is_compliant: bool = Field(description="True if the prompt passes all checklist items, False otherwise.")
    errors: List[str] = Field(description="List of specific checklist items that failed.")

# --- API Profile & Quota Schemas ---

class ApiKeyProfilePayload(BaseModel):
    id: str = Field(description="Unique profile identifier, e.g., 'proj_a_key_1'")
    label: str = Field(description="Human readable label, e.g., 'Project A - Key 1'")
    apiKey: str = Field(description="Raw Gemini API key")
    quotaGroupId: str = Field(default="default", description="Shared ID for keys belonging to the same project/quota")
    enabledModels: List[str] = Field(default_factory=lambda: ["gemini-2.5-flash", "gemini-3.5-flash"], description="Supported models")
    enabled: bool = Field(default=True, description="Whether this key profile is enabled")
    rpm: int = Field(default=5, description="Requests per minute limit")
    tpm: int = Field(default=250000, description="Tokens per minute limit")
    rpd: int = Field(default=20, description="Requests per day limit")
    maxInFlight: int = Field(default=1, description="Max concurrent in-flight requests")

class QuotaStateResponse(BaseModel):
    groupId: str
    model: str
    requestsLastMinute: int
    inputTokensLastMinute: int
    requestsToday: int
    cooldownSeconds: float
    inFlight: int
    invalidKeys: List[str]
    lastError: Optional[str] = None

# --- Pipeline & Job API Request/Response Schemas ---

class StandardizedShotData(BaseModel):
    scene_number: int = Field(description="The sequential number of the scene/shot.")
    duration_seconds: int = Field(default=5, description="Duration in seconds.")
    setting: str = Field(default="", description="Location or background environment.")
    characters: List[str] = Field(default_factory=list, description="Characters appearing in this shot.")
    props: List[str] = Field(default_factory=list, description="Props used in this shot.")
    shot_type: str = Field(default="", description="Shot type & angle (e.g. Medium Close-up, Low Angle).")
    lighting: str = Field(default="", description="Lighting style (e.g. Cinematic Rim Light, Night).")
    visual: str = Field(default="", description="Visual description of the static frame.")
    character_motion: str = Field(default="", description="Action & movement of characters.")
    camera_motion: str = Field(default="", description="Movement of camera lens (Pan, Zoom, Tilt).")
    dialogue: List[DialogueItem] = Field(default_factory=list, description="Dialogue spoken in this shot.")
    sound_fx: str = Field(default="", description="Sound effects.")
    opening_transition: str = Field(default="", description="Transition entering scene.")
    closing_transition: str = Field(default="", description="Transition exiting scene.")
    assembled_image_prompt: str = Field(default="", description="Final assembled prompt for image generation.")
    assembled_video_prompt: str = Field(default="", description="Final assembled prompt for video motion.")

class ArtStylePreset(BaseModel):
    id: str = Field(description="Preset identifier, e.g. '3d_pixar'")
    name: str = Field(description="Human readable name, e.g. '3D Pixar Animation'")
    prompt_prefix: str = Field(description="Style prefix appended to prompts.")
    prompt_suffix: str = Field(default="", description="Quality/style suffix appended to prompts.")

class PipelineRequest(BaseModel):
    storyboard: str = Field(description="The raw text storyboard input.")
    style_preset_id: str = Field(default="3d_pixar", description="Selected art style preset ID.")
    api_keys: List[str] = Field(default_factory=list, description="List of Gemini API keys.")
    profiles: Optional[List[ApiKeyProfilePayload]] = Field(default=None, description="Structured API profiles")
    scenes: Optional[List[SceneAnalysis]] = Field(default=None, description="Previously analyzed scenes supplied by the legacy frontend.")
    characters: Optional[List[CharacterAsset]] = Field(default=None, description="Previously extracted character assets.")
    environments: Optional[List[EnvironmentAsset]] = Field(default=None, description="Previously extracted environment assets.")
    props: Optional[List[PropAsset]] = Field(default=None, description="Previously extracted prop assets.")
    shots: Optional[List[Shot]] = Field(default=None, description="Previously planned shots.")
    keyframes: Optional[List[ShotKeyframePrompt]] = Field(default=None, description="Existing keyframe prompts.")
    custom_instructions: Optional[str] = Field(default=None, description="Optional instructions for prompt refinement.")
    model: str = Field(default="gemini-2.5-flash", description="The Gemini model to use.")
    rpm_limit: int = Field(default=5, description="Requests per minute rate limit.")
    chunk_size: int = Field(default=3, description="Chunk size for list splitting.")
    quality_preset: str = Field(default="balanced", description="Dynamic token chunking preset: quality, balanced, fast")

class JobCreateRequest(BaseModel):
    storyboard: str = Field(description="The raw text storyboard input.")
    style_preset_id: str = Field(default="3d_pixar", description="Selected art style preset ID.")
    profile_ids: Optional[List[str]] = Field(default=None, description="Profile IDs to use for this job. If omitted, uses all enabled profiles.")
    profiles: Optional[List[ApiKeyProfilePayload]] = Field(default=None, description="Inline profile configurations.")
    mode: str = Field(default="fast", description="Workflow mode: 'fast' or 'quality'")
    quality_preset: str = Field(default="balanced", description="Chunking preset: 'quality' (18K-22K tokens), 'balanced' (22K-28K), 'fast' (28K-35K)")

class JobStatusResponse(BaseModel):
    id: str
    status: str
    mode: str
    quality_preset: str
    progress: float
    total_steps: int
    completed_steps: int
    eta_seconds: float
    created_at: str
    updated_at: str
    error: Optional[str] = None
    checkpoint: Optional[Dict[str, Any]] = None

