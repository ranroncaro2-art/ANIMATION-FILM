"use client";

import React, { useState, useEffect, useRef } from "react";
import ApiKeyInput from "../components/ApiKeyInput";
import JsonEditor from "../components/JsonEditor";
import { StepKey, PipelineStep } from "../components/PipelineProgress";
import { FloatingSystemLogs } from "../components/FloatingSystemLogs";
import {
  saveProject,
  getProject,
  deleteProject,
  listProjects,
  SavedProject,
  ProjectMetadata
} from "../utils/db";
import { queueManager } from "../utils/queue";

const getBackendUrl = () => {
  if (typeof window !== "undefined") {
    return `http://${window.location.hostname}:8000`;
  }
  return "http://127.0.0.1:8000";
};

interface ProjectData {
  scenes: any[];
  characters: any[];
  environments: any[];
  props: any[];
  shots: any[];
  keyframes: any[];
  motion_prompts: any[];
  pcDirectory?: string;
}

function mergeProjectData(uiData: any, dbData: any) {
  if (!dbData) return uiData;

  const merged = { ...uiData };

  // 0.1. Merge scenes
  if (merged.scenes && dbData.scenes) {
    merged.scenes = merged.scenes.map((uiScene: any) => {
      const dbScene = dbData.scenes.find((s: any) => s.scene_id === uiScene.scene_id);
      if (dbScene) {
        return {
          ...uiScene,
          duration_seconds: dbScene.duration_seconds || uiScene.duration_seconds || 5,
          characters: dbScene.characters || uiScene.characters || [],
          setting: dbScene.setting || uiScene.setting || "",
          props: dbScene.props || uiScene.props || [],
          description: dbScene.description || uiScene.description || "",
          dialogues: dbScene.dialogues || uiScene.dialogues || [],
        };
      }
      return uiScene;
    });
    dbData.scenes.forEach((dbScene: any) => {
      const exists = merged.scenes.some((s: any) => s.scene_id === dbScene.scene_id);
      if (!exists) {
        merged.scenes.push(dbScene);
      }
    });
  } else if (dbData.scenes) {
    merged.scenes = dbData.scenes;
  }

  // 0.2. Merge shots
  if (merged.shots && dbData.shots) {
    merged.shots = merged.shots.map((uiShot: any) => {
      const dbShot = dbData.shots.find((s: any) => s.shot_id === uiShot.shot_id);
      if (dbShot) {
        return {
          ...uiShot,
          scene_id: dbShot.scene_id || uiShot.scene_id,
          scene_number: dbShot.scene_number || uiShot.scene_number,
          duration_seconds: dbShot.duration_seconds || uiShot.duration_seconds || 5,
          actions: dbShot.actions || uiShot.actions || "",
          characters: dbShot.characters || uiShot.characters || [],
          environment: dbShot.environment || uiShot.environment || "",
          props: dbShot.props || uiShot.props || [],
          dialogue: dbShot.dialogue || uiShot.dialogue || [],
          camera_movement: dbShot.camera_movement || uiShot.camera_movement || "",
          framing: dbShot.framing || uiShot.framing || "",
          transition: dbShot.transition || uiShot.transition || "Cut",
          composition: dbShot.composition || dbShot.composition || "Rule of Thirds",
          lighting: dbShot.lighting || uiShot.lighting || "Warm lighting",
          camera: dbShot.camera || uiShot.camera || "",
          timeline: dbShot.timeline || uiShot.timeline || [],
          motion: dbShot.motion || uiShot.motion || {},
          keyframe_prompt: dbShot.keyframe_prompt || uiShot.keyframe_prompt || "",
          motion_prompt: dbShot.motion_prompt || uiShot.motion_prompt || "",
        };
      }
      return uiShot;
    });
    dbData.shots.forEach((dbShot: any) => {
      const exists = merged.shots.some((s: any) => s.shot_id === dbShot.shot_id);
      if (!exists) {
        merged.shots.push(dbShot);
      }
    });
  } else if (dbData.shots) {
    merged.shots = dbData.shots;
  }

  // 1. Merge characters
  if (merged.characters && dbData.characters) {
    merged.characters = merged.characters.map((uiChar: any) => {
      const dbChar = dbData.characters.find(
        (c: any) => c.name === uiChar.name || c.id === uiChar.id
      );
      if (dbChar) {
        return {
          ...uiChar,
          url: dbChar.url || uiChar.url || "",
          media_id: dbChar.media_id || uiChar.media_id || "",
          account_id: dbChar.account_id || uiChar.account_id || "",
        };
      }
      return uiChar;
    });
  }

  // 2. Merge environments
  if (merged.environments && dbData.environments) {
    merged.environments = merged.environments.map((uiEnv: any) => {
      const dbEnv = dbData.environments.find(
        (e: any) => e.setting_name === uiEnv.setting_name || e.id === uiEnv.id
      );
      if (dbEnv) {
        return {
          ...uiEnv,
          url: dbEnv.url || uiEnv.url || "",
          media_id: dbEnv.media_id || uiEnv.media_id || "",
          account_id: dbEnv.account_id || uiEnv.account_id || "",
        };
      }
      return uiEnv;
    });
  }

  // 3. Merge props
  if (merged.props && dbData.props) {
    merged.props = merged.props.map((uiProp: any) => {
      const dbProp = dbData.props.find(
        (p: any) => p.prop_name === uiProp.prop_name || p.id === uiProp.id
      );
      if (dbProp) {
        return {
          ...uiProp,
          url: dbProp.url || uiProp.url || "",
          media_id: dbProp.media_id || uiProp.media_id || "",
          account_id: dbProp.account_id || uiProp.account_id || "",
        };
      }
      return uiProp;
    });
  }

  // 4. Merge keyframes
  if (merged.keyframes && dbData.keyframes) {
    merged.keyframes = merged.keyframes.map((uiKf: any) => {
      const dbKf = dbData.keyframes.find((k: any) => k.shot_id === uiKf.shot_id);
      if (dbKf) {
        return {
          ...uiKf,
          url: dbKf.url || uiKf.url || "",
          media_id: dbKf.media_id || uiKf.media_id || "",
          account_id: dbKf.account_id || uiKf.account_id || "",
        };
      }
      return uiKf;
    });
    // Add any keyframes that exist in DB but not in UI
    dbData.keyframes.forEach((dbKf: any) => {
      const exists = merged.keyframes.some((k: any) => k.shot_id === dbKf.shot_id);
      if (!exists) {
        merged.keyframes.push(dbKf);
      }
    });
  } else if (dbData.keyframes) {
    merged.keyframes = dbData.keyframes;
  }

  // 5. Merge motion prompts
  if (merged.motion_prompts && dbData.motion_prompts) {
    merged.motion_prompts = merged.motion_prompts.map((uiMp: any) => {
      const dbMp = dbData.motion_prompts.find((m: any) => m.shot_id === uiMp.shot_id);
      if (dbMp) {
        return {
          ...uiMp,
          video_url: dbMp.video_url || uiMp.video_url || "",
        };
      }
      return uiMp;
    });
    // Add any motion prompts that exist in DB but not in UI
    dbData.motion_prompts.forEach((dbMp: any) => {
      const exists = merged.motion_prompts.some((m: any) => m.shot_id === dbMp.shot_id);
      if (!exists) {
        merged.motion_prompts.push(dbMp);
      }
    });
  } else if (dbData.motion_prompts) {
    merged.motion_prompts = dbData.motion_prompts;
  }

  return merged;
}

const INITIAL_PROJECT_DATA: ProjectData = {
  scenes: [],
  characters: [],
  environments: [],
  props: [],
  shots: [],
  keyframes: [],
  motion_prompts: [],
  pcDirectory: "",
};

const INITIAL_STEPS: PipelineStep[] = [
  {
    key: "story_analyzer",
    label: "1. Story Analyzer",
    description: "Analyze story text into scenes, durations, actions and dialogues",
    status: "idle",
  },
  {
    key: "character_extractor",
    label: "2. Character Extractor",
    description: "Identify unique characters and create turnaround Pixar 3D prompts",
    status: "idle",
  },
  {
    key: "environment_extractor",
    label: "3. Environment Extractor",
    description: "Identify unique settings and create Pixar 3D reference prompts",
    status: "idle",
  },
  {
    key: "prop_extractor",
    label: "4. Prop Extractor",
    description: "Identify props and create Pixar 3D reference prompts",
    status: "idle",
  },
  {
    key: "shot_planner",
    label: "5. Shot Prompt Generator",
    description: "Plan camera shots and generate Keyframe & Motion prompts simultaneously",
    status: "idle",
  },
  {
    key: "motion_generator",
    label: "6. Motion Generator",
    description: "Compile and update video motion prompts from shot details",
    status: "idle",
  },
];

const DRAWING_STYLES = [
  {
    name: "Manga Color",
    description: "Vibrant manga style with rich colors, sharp ink lines, clean gradients, expressive eyes, and classic anime screentone backgrounds."
  },
  {
    name: "Anime Sketch",
    description: "Hand-drawn sketch style with soft pencil outlines, light watercolor washes, cozy warm tones, and slightly textured paper look."
  },
  {
    name: "Watercolor Pixar",
    description: "Soft 3D animation style combining clay-like character renders with pastel watercolor textures, gentle volumetric lighting, and blurry backgrounds."
  },
  {
    name: "Cinematic Studio",
    description: "High-quality anime feature film style, dramatic lighting, detailed environments, realistic depth-of-field, epic compositions, and rich atmospheric effects."
  },
];

const SAMPLE_SCRIPT_AUTO = `Scene 1 (6s)
Lisa đang đứng trước cổng trường.
Cô bé mỉm cười và vẫy tay.

Lisa:
"Hello everyone! My name is Lisa."

------------------------------------------------

Scene 2 (8s)
Tom chạy tới.

Tom:
"Hi Lisa!"

Lisa:
"Let's go to school!"

------------------------------------------------

Scene 3 (5s)
Hai bạn cùng đi vào trường.

------------------------------------------------

Scene 4 (8s)
Lisa nhìn thấy một bạn nhỏ đánh rơi hộp cơm.

Lisa:
"You dropped your lunch box."

Boy:
"Thank you!"`;

const SAMPLE_SRT = `1
00:00:00,000 --> 00:00:06,000
Lisa đang đứng trước cổng trường. Cô bé mỉm cười và vẫy tay chào mọi người.
Lisa: "Hello everyone! My name is Lisa."

2
00:00:06,000 --> 00:00:14,000
Tom từ phía xa chạy tới, vẫy tay chào Lisa hào hứng.
Tom: "Hi Lisa!"
Lisa: "Let's go to school!"

3
00:00:14,000 --> 00:00:19,000
Hai bạn vui vẻ cùng nhau bước vào cổng trường học mới.

4
00:00:19,000 --> 00:00:27,000
Lisa nhìn thấy một bạn nhỏ đánh rơi hộp cơm trên hành lang.
Lisa: "You dropped your lunch box."
Boy: "Thank you!"`;

export default function Home() {
  // Subscribe to Media Queue from Background Queue Manager
  const [mediaQueue, setMediaQueue] = useState<any[]>([]);
  useEffect(() => {
    return queueManager.subscribeMediaQueue((q) => {
      setMediaQueue(q);
    });
  }, []);

  // Derived generating states from mediaQueue
  const generatingAssetIds = React.useMemo(() => {
    const map: Record<string, "pending" | "running" | boolean> = {};
    mediaQueue.forEach(task => {
      if (task.status === "pending" || task.status === "running") {
        if (task.type === "character" || task.type === "environment" || task.type === "prop") {
          const prefix = task.type === "character" ? "char_" : task.type === "environment" ? "env_" : "prop_";
          map[`${prefix}${task.targetId}`] = task.status;
        }
      }
    });
    return map;
  }, [mediaQueue]);

  const generatingShotKeys = React.useMemo(() => {
    const map: Record<string, "pending" | "running" | boolean> = {};
    mediaQueue.forEach(task => {
      if (task.status === "pending" || task.status === "running") {
        if (task.type === "shot_image") {
          map[task.targetId] = task.status;
        }
      }
    });
    return map;
  }, [mediaQueue]);

  const generatingSegmentVideoKeys = React.useMemo(() => {
    const map: Record<string, "pending" | "running" | boolean> = {};
    mediaQueue.forEach(task => {
      if (task.status === "pending" || task.status === "running") {
        if (task.type === "shot_video") {
          map[task.targetId] = task.status;
        }
      }
    });
    return map;
  }, [mediaQueue]);

  const [storyboard, setStoryboard] = useState("");
  const [customMotionInstructions, setCustomMotionInstructions] = useState("");
  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("gemini-2.5-flash");
  const [rpmLimit, setRpmLimit] = useState(5);
  const [chunkSize, setChunkSize] = useState(3);
  
  const [projectData, setProjectData] = useState<ProjectData>(INITIAL_PROJECT_DATA);
  const [steps, setSteps] = useState<PipelineStep[]>(INITIAL_STEPS);
  const [activeStep, setActiveStep] = useState<StepKey | null>(null);
  
  const [selectedStep, setSelectedStep] = useState<StepKey | null>(null);
  const [isRunningAll, setIsRunningAll] = useState(false);
  
  // Project list states for IndexedDB
  const [projectsList, setProjectsList] = useState<ProjectMetadata[]>([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [activeProjectId, setActiveProjectId] = useState<string>("active");
  const [activeProjectName, setActiveProjectName] = useState("Untitled Project");

  // New Redesign UI States
  const [activeTab, setActiveTab] = useState<string>("cauhinh");
  const [workflowMode, setWorkflowMode] = useState<string>("script_auto");
  const [selectedStyle, setSelectedStyle] = useState<string>(DRAWING_STYLES[0].name);
  const [styleDescription, setStyleDescription] = useState<string>(DRAWING_STYLES[0].description);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [showJsonEditor, setShowJsonEditor] = useState<boolean>(false);
  const [assetSubTab, setAssetSubTab] = useState<string>("scenes");

  // Web Directory Explorer States
  const [isExplorerOpen, setIsExplorerOpen] = useState(false);
  const [explorerCurrentPath, setExplorerCurrentPath] = useState("");
  const [explorerFolders, setExplorerFolders] = useState<{ name: string; path: string }[]>([]);
  const [explorerParentPath, setExplorerParentPath] = useState<string | null>(null);
  const [explorerError, setExplorerError] = useState<string | null>(null);
  const [explorerNewFolderName, setExplorerNewFolderName] = useState("");
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);

  // Cinema Preview & Subtitle Config States
  const [cinemaPlayhead, setCinemaPlayhead] = useState<number>(0);
  const [cinemaPlaying, setCinemaPlaying] = useState<boolean>(false);
  const [cinemaLoop, setCinemaLoop] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [subConfig, setSubConfig] = useState({
    fontFamily: "sans-serif",
    fontSize: 35,
    color: "#ffffff",
    outlineColor: "#000000",
    strokeWidth: 3,
    bgOpacity: 63,
    bgColor: "#000000",
    bgPadding: 10,
    maxLineLength: 30,
    maxWordsPerSub: 6,
    alignment: "BOTTOM",
  });


  // Project Name Custom Modal States
  const [isProjectNameModalOpen, setIsProjectNameModalOpen] = useState(false);
  const [projectNameInput, setProjectNameInput] = useState("");
  const [projectNameModalTitle, setProjectNameModalTitle] = useState("");
  const [projectNameModalCallback, setProjectNameModalCallback] = useState<((name: string) => void) | null>(null);

  const showProjectNameModal = (title: string, defaultName: string, callback: (name: string) => void) => {
    setProjectNameInput(defaultName);
    setProjectNameModalTitle(title);
    setProjectNameModalCallback(() => callback);
    setIsProjectNameModalOpen(true);
  };

  // Fullscreen image zoom state
  const [fullscreenImageUrl, setFullscreenImageUrl] = useState<string | null>(null);

  // Batch Image Generation derived state
  const isGeneratingBatch = React.useMemo(() => {
    return mediaQueue.some(task => task.status === "pending" || task.status === "running");
  }, [mediaQueue]);

  const downloadImageUrl = async (url: string, filename: string) => {
    if (!url) return;
    try {
      // If url is already a blob URL or base64 data, download directly
      if (url.startsWith("blob:") || url.startsWith("data:")) {
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }
      
      const response = await fetch(url);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      console.error("Failed to download image via blob fallback, attempting direct link download:", e);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.target = "_blank";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleStopDrawing = () => {
    queueManager.stopMediaQueue();
  };

  const handleBatchGenerateAssetImage = async (subTab: string) => {
    queueManager.addLog(`Đã xếp hàng chờ vẽ tất cả ảnh tham chiếu cho ${subTab === "environments" ? "Bối cảnh" : "Đạo cụ"}...`, "info", activeProjectId);

    const assetsToGen: { id: string; type: string; name: string }[] = [];

    if (subTab === "environments") {
      projectData.environments.forEach(e => {
        assetsToGen.push({ id: `env_${e.setting_name}`, type: "environment", name: e.setting_name });
      });
    } else if (subTab === "props") {
      projectData.props.forEach(p => {
        assetsToGen.push({ id: `prop_${p.prop_name}`, type: "prop", name: p.prop_name });
      });
    }

    if (assetsToGen.length === 0) {
      queueManager.addLog("Không tìm thấy ảnh tham chiếu nào cần vẽ.", "info", activeProjectId);
      return;
    }

    assetsToGen.forEach(asset => {
      triggerGenerateAssetImage(asset.id);
    });
  };

  const handleGenerateAllAssetImages = async (onlyUncreated: boolean = false) => {
    if (!checkPcDirectory()) return;
    queueManager.addLog(onlyUncreated ? "Đã xếp hàng chờ vẽ các ảnh tham chiếu chưa tạo..." : "Đã xếp hàng chờ vẽ tất cả ảnh tham chiếu...", "info", activeProjectId);

    const assetsToGen: { id: string; type: string; name: string }[] = [];

    // Characters
    projectData.characters.forEach(c => {
      const id = `char_${c.name}`;
      const exists = !!(c.url && !c.url.startsWith("mock_"));
      if (!onlyUncreated || !exists) {
        assetsToGen.push({ id, type: "character", name: c.name });
      }
    });

    // Environments
    projectData.environments.forEach(e => {
      const id = `env_${e.setting_name}`;
      const exists = !!(e.url && !e.url.startsWith("mock_"));
      if (!onlyUncreated || !exists) {
        assetsToGen.push({ id, type: "environment", name: e.setting_name });
      }
    });

    // Props
    projectData.props.forEach(p => {
      const id = `prop_${p.prop_name}`;
      const exists = !!(p.url && !p.url.startsWith("mock_"));
      if (!onlyUncreated || !exists) {
        assetsToGen.push({ id, type: "prop", name: p.prop_name });
      }
    });

    if (assetsToGen.length === 0) {
      queueManager.addLog("Không tìm thấy ảnh tham chiếu nào cần vẽ.", "info", activeProjectId);
      return;
    }

    assetsToGen.forEach(asset => {
      triggerGenerateAssetImage(asset.id);
    });
  };

  const handleGenerateAllShotImages = async (onlyUncreated: boolean = false) => {
    if (!checkPcDirectory()) return;
    queueManager.addLog(onlyUncreated ? "Đã xếp hàng chờ vẽ các ảnh Shots chưa tạo..." : "Đã xếp hàng chờ vẽ tất cả ảnh Shots...", "info", activeProjectId);

    const shotsToGen: string[] = [];

    projectData.shots.forEach(s => {
      const shotKey = `shot_${s.scene_number || s.scene_id || ''}_${s.shot_id}`;
      const keyframeObj = projectData.keyframes
        ? projectData.keyframes.find((k: any) => k.shot_id === s.shot_id)
        : null;
      const exists = !!(keyframeObj?.url && !keyframeObj.url.startsWith("mock_"));
      if (!onlyUncreated || !exists) {
        shotsToGen.push(shotKey);
      }
    });

    if (shotsToGen.length === 0) {
      queueManager.addLog("Không tìm thấy ảnh Shots nào cần vẽ.", "info", activeProjectId);
      return;
    }

    shotsToGen.forEach(shotKey => {
      triggerGenerateShotImage(shotKey);
    });
  };

  const handleGenerateAllSegmentVideos = async (onlyUncreated: boolean = false) => {
    if (!checkPcDirectory()) return;
    queueManager.addLog(onlyUncreated ? "Đã xếp hàng chờ render các video segment chưa tạo..." : "Đã xếp hàng chờ render tất cả video segment...", "info", activeProjectId);

    const videosToGen: string[] = [];

    projectData.shots.forEach(s => {
      const shotKey = `shot_${s.scene_number || s.scene_id || ''}_${s.shot_id}`;
      const motionIndex = projectData.motion_prompts 
        ? projectData.motion_prompts.findIndex((m: any) => m.shot_id === s.shot_id)
        : -1;
      const videoUrl = motionIndex !== -1 && projectData.motion_prompts
        ? projectData.motion_prompts[motionIndex].video_url || ""
        : "";
      
      const exists = !!videoUrl || mockGeneratedSegmentVideos[shotKey] || isVideoGenerated;
      if (!onlyUncreated || !exists) {
        videosToGen.push(shotKey);
      }
    });

    if (videosToGen.length === 0) {
      queueManager.addLog("Không tìm thấy video segment nào cần render.", "info", activeProjectId);
      return;
    }

    videosToGen.forEach(shotKey => {
      triggerGenerateSegmentVideo(shotKey);
    });
  };

  // Local API Draw & Video configurations
  const [imageCount, setImageCount] = useState<number>(1);
  const [imageAspectRatio, setImageAspectRatio] = useState<string>("IMAGE_ASPECT_RATIO_LANDSCAPE");
  const [imageModel, setImageModel] = useState<string>("GEM_PIX_2");
  
  const [videoCount, setVideoCount] = useState<number>(1);
  const [videoAspectRatio, setVideoAspectRatio] = useState<string>("VIDEO_ASPECT_RATIO_LANDSCAPE");
  const [videoModel, setVideoModel] = useState<string>("Veo 3.1 Lite - 0 credit");

  const [imageConcurrency, setImageConcurrency] = useState<number>(2);
  const [videoConcurrency, setVideoConcurrency] = useState<number>(1);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);


  // Mock Generation previews for Asset References & Shots
  const [mockGeneratedReferenceImages, setMockGeneratedReferenceImages] = useState<Record<string, boolean>>({});
  const [mockGeneratedShotImages, setMockGeneratedShotImages] = useState<Record<string, boolean>>({});

  // Video Rendering preview state
  const [isRenderingVideo, setIsRenderingVideo] = useState<boolean>(false);
  const [videoRenderPercent, setVideoRenderPercent] = useState<number>(0);
  const [videoRenderStage, setVideoRenderStage] = useState<string>("");
  const [isVideoGenerated, setIsVideoGenerated] = useState<boolean>(false);
  const [videoResolution, setVideoResolution] = useState<string>("720");
  const [renderTimestamp, setRenderTimestamp] = useState<number>(Date.now());

  // Video Player state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playheadTime, setPlayheadTime] = useState<number>(0);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Video Segment rendering states
  const [selectedShots, setSelectedShots] = useState<Record<string, boolean>>({});
  const [mockGeneratedSegmentVideos, setMockGeneratedSegmentVideos] = useState<Record<string, boolean>>({});

  // Helper to update projectData directly in IndexedDB for isolation
  const updateProjectDataInDb = async (projectId: string, updateFn: (data: ProjectData) => ProjectData) => {
    try {
      const proj = await getProject(projectId);
      if (proj) {
        proj.projectData = updateFn(proj.projectData);
        proj.updatedAt = new Date().toISOString();
        await saveProject(proj);
        // If the user is still viewing the updated project in the UI, sync the React state
        if (activeProjectId === projectId) {
          setProjectData(proj.projectData);
        }
      }
    } catch (e) {
      console.error("Failed to update project data in IndexedDB:", e);
    }
  };

  // Helper to render media generation states (pending spinner or running loader)
  const renderMediaLoader = (status: any, activeText: string) => {
    if (!status) return null;
    if (status === "running") {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
            @keyframes pulse {
              0%, 100% { opacity: 0.6; }
              50% { opacity: 1; }
            }
          `}</style>
          <div style={{
            width: "24px",
            height: "24px",
            border: "3px solid rgba(255,255,255,0.1)",
            borderTop: "3px solid var(--accent-cyan)",
            borderRadius: "50%",
            animation: "spin 1s linear infinite"
          }} />
          <span style={{ fontSize: "0.75rem", color: "var(--accent-cyan)", fontWeight: 600 }}>{activeText}</span>
        </div>
      );
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 0.6; }
            50% { opacity: 1; }
          }
        `}</style>
        <span style={{ fontSize: "1.2rem", animation: "pulse 1.5s infinite", display: "inline-block" }}>⏳</span>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 500 }}>Đang chờ...</span>
      </div>
    );
  };

  // Helper to render uniform image action overlay toolbar (using simple, easy-to-understand icons)
  const renderImageActionToolbar = (url: string, filename: string, onRecreate?: () => void) => {
    return (
      <div style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        background: "rgba(6, 9, 16, 0.85)",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        padding: "6px 12px",
        display: "flex",
        justifyContent: onRecreate ? "space-between" : "flex-end",
        alignItems: "center",
        zIndex: 10
      }}>
        {onRecreate && (
          <button
            onClick={onRecreate}
            title="Tạo lại ảnh"
            style={{
              background: "transparent",
              border: "none",
              color: "#ffffff",
              fontSize: "0.75rem",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "4px",
              borderRadius: "4px",
              transition: "background 0.2s"
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M16 3h5v5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 21H3v-5" />
            </svg>
          </button>
        )}
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => downloadImageUrl(url, filename)}
            title="Tải ảnh về máy"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "4px",
              borderRadius: "4px",
              transition: "background 0.2s"
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          <button
            onClick={() => setFullscreenImageUrl(url)}
            title="Xem ảnh phóng to"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "4px",
              borderRadius: "4px",
              transition: "background 0.2s"
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6" />
              <path d="M9 21H3v-6" />
              <path d="M21 3l-7 7" />
              <path d="M3 21l7-7" />
            </svg>
          </button>
        </div>
      </div>
    );
  };

  // System logs are handled by the FloatingSystemLogs component

  // Load configuration and active project from IndexedDB/LocalStorage on mount
  useEffect(() => {
    // LocalStorage for configuration
    const savedKeys = localStorage.getItem("gemini_api_keys");
    if (savedKeys) {
      try {
        setApiKeys(JSON.parse(savedKeys));
      } catch (e) {
        console.error(e);
      }
    }
    
    const savedModel = localStorage.getItem("gemini_selected_model");
    if (savedModel) {
      setSelectedModel(savedModel);
    }

    const savedRpmLimit = localStorage.getItem("gemini_rpm_limit");
    if (savedRpmLimit) {
      setRpmLimit(parseInt(savedRpmLimit) || 5);
    }

    const savedChunkSize = localStorage.getItem("gemini_chunk_size");
    if (savedChunkSize) {
      setChunkSize(parseInt(savedChunkSize) || 3);
    }

    const savedImgCount = localStorage.getItem("local_image_count");
    if (savedImgCount) setImageCount(parseInt(savedImgCount) || 1);

    const savedImgAspect = localStorage.getItem("local_image_aspect_ratio");
    if (savedImgAspect) setImageAspectRatio(savedImgAspect);

    const savedImgModel = localStorage.getItem("local_image_model");
    if (savedImgModel) setImageModel(savedImgModel);

    const savedVidCount = localStorage.getItem("local_video_count");
    if (savedVidCount) setVideoCount(parseInt(savedVidCount) || 1);

    const savedVidAspect = localStorage.getItem("local_video_aspect_ratio");
    if (savedVidAspect) setVideoAspectRatio(savedVidAspect);

    const savedVidModel = localStorage.getItem("local_video_model");
    if (savedVidModel) setVideoModel(savedVidModel);

    const savedImgConcurrency = localStorage.getItem("local_image_concurrency");
    if (savedImgConcurrency) setImageConcurrency(parseInt(savedImgConcurrency) || 2);

    const savedVidConcurrency = localStorage.getItem("local_video_concurrency");
    if (savedVidConcurrency) setVideoConcurrency(parseInt(savedVidConcurrency) || 1);

    // Recover last active workspace state from IndexedDB
    const lastActiveId = localStorage.getItem("last_active_project_id") || "active";
    getProject(lastActiveId)
      .then((activeProj) => {
        if (activeProj) {
          setStoryboard(activeProj.storyboard);
          setProjectData(activeProj.projectData);
          setSteps(activeProj.steps as PipelineStep[]);
          setActiveProjectId(activeProj.id);
          setActiveProjectName(activeProj.name);
          if (activeProj.model) setSelectedModel(activeProj.model);
          if (activeProj.selectedStyle) setSelectedStyle(activeProj.selectedStyle);
          if (activeProj.styleDescription) setStyleDescription(activeProj.styleDescription);
          if (activeProj.workflowMode) setWorkflowMode(activeProj.workflowMode);

          // Restore task state for active workspace on startup
          const taskState = queueManager.getTaskState(activeProj.id);
          if (taskState.status === "running") {
            setActiveStep(taskState.activeStep);
            setIsRunningAll(taskState.isRunningAll);
          }
        } else {
          // Preset sample storyboard
          setStoryboard(SAMPLE_SCRIPT_AUTO);
        }
      })
      .catch(console.error)
      .finally(() => {
        setIsLoaded(true);
      });

    // Refresh the list of saved projects
    refreshProjectsList();
  }, []);

  // Synchronize image and video concurrency limits to queueManager
  useEffect(() => {
    queueManager.setConcurrencyLimits(imageConcurrency, videoConcurrency);
  }, [imageConcurrency, videoConcurrency]);

  // Debounced auto-save to IndexedDB for the active workspace
  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(async () => {
      // Only save if there's actually some content to store
      if (storyboard.trim() || projectData.scenes.length > 0) {
        try {
          // Retrieve the existing project data from DB to merge background-generated assets
          const existing = await getProject(activeProjectId);
          const mergedData = existing ? mergeProjectData(projectData, existing.projectData) : projectData;

          const activeProject: SavedProject = {
            id: activeProjectId,
            name: activeProjectName,
            updatedAt: new Date().toISOString(),
            storyboard,
            projectData: mergedData,
            steps,
            model: selectedModel,
            selectedStyle,
            styleDescription,
            workflowMode,
          };
          await saveProject(activeProject);
        } catch (err) {
          console.error("IndexedDB Auto-save failed:", err);
        }
      }
    }, 1000); // 1 second debounce
    
    return () => clearTimeout(timer);
  }, [storyboard, projectData, steps, activeProjectName, selectedModel, selectedStyle, styleDescription, workflowMode, activeProjectId, isLoaded]);

  // Refresh saved projects list
  const refreshProjectsList = async () => {
    try {
      const list = await listProjects();
      setProjectsList(list);
    } catch (e) {
      console.error("Failed to list projects from IndexedDB:", e);
    }
  };

  // Subscribe to Background Queue Manager updates
  useEffect(() => {
    const unsubscribe = queueManager.subscribe((projId, taskState, updatedData, updatedSteps) => {
      // Only react if the event is for the CURRENT active project in the UI
      if (projId === activeProjectId) {
        if (updatedData) {
          setProjectData(updatedData);
        }
        if (updatedSteps) {
          setSteps(updatedSteps);
        }

        if (taskState.status === "running") {
          setActiveStep(taskState.activeStep);
          setIsRunningAll(taskState.isRunningAll);
        } else {
          setActiveStep(null);
          setIsRunningAll(false);
          if (taskState.status === "success") {
            if (taskState.activeStep) {
              setSelectedStep(taskState.activeStep);
            }
          } else if (taskState.status === "failed") {
            alert(`Execution failed: ${taskState.error}`);
          }
        }
      }
    });

    return () => unsubscribe();
  }, [activeProjectId]);

  const handleSaveNamedProject = async () => {
    showProjectNameModal(
      "Lưu Tên Dự Án",
      activeProjectName === "Untitled Project" ? "" : activeProjectName,
      async (name) => {
        const projectId = activeProjectId === "active" ? `project_${Date.now()}` : activeProjectId;
        const newProject: SavedProject = {
          id: projectId,
          name: name.trim(),
          updatedAt: new Date().toISOString(),
          storyboard,
          projectData,
          steps,
          model: selectedModel,
          selectedStyle,
          styleDescription,
          workflowMode,
        };

        try {
          await saveProject(newProject);
          setActiveProjectId(projectId);
          setActiveProjectName(name.trim());
          localStorage.setItem("last_active_project_id", projectId);
          await refreshProjectsList();
          queueManager.addLog(`Đã lưu dự án "${newProject.name}" thành công!`, "success", projectId);
          alert(`Project "${newProject.name}" saved successfully!`);
        } catch (err: any) {
          alert(`Save failed: ${err.message}`);
        }
      }
    );
  };

  // Load project handler
  const handleLoadProject = async (id: string) => {
    if (isRunningAll || activeStep !== null) {
      alert("Cannot load projects while the pipeline is running.");
      return;
    }

    try {
      const proj = await getProject(id);
      if (proj) {
        setStoryboard(proj.storyboard);
        setProjectData(proj.projectData);
        setSteps(proj.steps as PipelineStep[]);
        setActiveProjectId(proj.id);
        setActiveProjectName(proj.name);
        localStorage.setItem("last_active_project_id", proj.id);
        if (proj.model) setSelectedModel(proj.model);
        if (proj.selectedStyle) setSelectedStyle(proj.selectedStyle);
        if (proj.styleDescription) setStyleDescription(proj.styleDescription);
        if (proj.workflowMode) setWorkflowMode(proj.workflowMode);
        
        // Restore running task status for the loaded project
        const taskState = queueManager.getTaskState(proj.id);
        if (taskState.status === "running") {
          setActiveStep(taskState.activeStep);
          setIsRunningAll(taskState.isRunningAll);
        } else {
          setActiveStep(null);
          setIsRunningAll(false);
        }

        setSelectedStep(null);
        setActiveTab("cauhinh");
        queueManager.addLog(`Đã tải dự án: "${proj.name}"`, "info", proj.id);
      }
    } catch (err: any) {
      alert(`Failed to load project: ${err.message}`);
    }
  };

  // Create new blank workspace
  const handleNewProject = () => {
    if (isRunningAll || activeStep !== null) {
      alert("Cannot reset workspace while the pipeline is running.");
      return;
    }

    showProjectNameModal(
      "Tạo Dự Án Mới",
      "Dự án mới",
      (name) => {
        const finalName = name.trim() || "Dự án mới";
        const newId = `project_${Date.now()}`;

        const newProject: SavedProject = {
          id: newId,
          name: finalName,
          updatedAt: new Date().toISOString(),
          storyboard: workflowMode === "script_auto" ? SAMPLE_SCRIPT_AUTO : SAMPLE_SRT,
          projectData: INITIAL_PROJECT_DATA,
          steps: INITIAL_STEPS,
          model: selectedModel,
          selectedStyle,
          styleDescription,
          workflowMode,
        };

        saveProject(newProject)
          .then(() => {
            setActiveProjectId(newId);
            setActiveProjectName(finalName);
            localStorage.setItem("last_active_project_id", newId);
            setStoryboard(newProject.storyboard);
            setProjectData(INITIAL_PROJECT_DATA);
            setSteps(INITIAL_STEPS);
            setSelectedStep(null);
            setActiveTab("cauhinh");
            setMockGeneratedReferenceImages({});
            setMockGeneratedShotImages({});
            setIsVideoGenerated(false);
            refreshProjectsList();
            queueManager.addLog(`Đã khởi tạo dự án mới "${finalName}" với ID: ${newId}`, "info", newId);
          })
          .catch((err) => {
            alert("Không thể khởi tạo dự án mới: " + err.message);
          });
      }
    );
  };

  // Delete project handler
  const handleDeleteProject = async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete the project "${name}"?`)) {
      return;
    }

    try {
      await deleteProject(id);
      if (activeProjectId === id) {
        setActiveProjectId("active");
        setActiveProjectName("Untitled Project");
        setStoryboard(workflowMode === "script_auto" ? SAMPLE_SCRIPT_AUTO : SAMPLE_SRT);
        setProjectData(INITIAL_PROJECT_DATA);
        setSteps(INITIAL_STEPS);
        setSelectedStep(null);
      }
      await refreshProjectsList();
      queueManager.addLog(`Đã xóa dự án: "${name}"`, "info");
    } catch (err: any) {
      alert(`Failed to delete project: ${err.message}`);
    }
  };

  // Save configuration on change
  const handleApiKeysChange = (keys: string[]) => {
    setApiKeys(keys);
    localStorage.setItem("gemini_api_keys", JSON.stringify(keys));
  };

  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    localStorage.setItem("gemini_selected_model", model);
  };

  const handleRpmLimitChange = (val: number) => {
    setRpmLimit(val);
    localStorage.setItem("gemini_rpm_limit", val.toString());
  };

  const handleChunkSizeChange = (val: number) => {
    setChunkSize(val);
    localStorage.setItem("gemini_chunk_size", val.toString());
  };

  const handleStoryboardChange = (text: string) => {
    setStoryboard(text);
  };

  const handleClearStoryboard = () => {
    setStoryboard("");
  };

  const checkPcDirectory = (): boolean => {
    if (!projectData.pcDirectory) {
      alert("Bạn chưa chọn thư mục lưu dự án trên PC! Vui lòng cấu hình thư mục lưu ở tab 'Cấu hình dự án' trước.");
      setActiveTab("cauhinh");
      return false;
    }
    return true;
  };

  const handleSelectPcDirectory = () => {
    handleOpenExplorer();
  };

  const explorePath = async (targetPath: string) => {
    setExplorerError(null);
    try {
      const response = await fetch("/api/explore-directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPath: targetPath })
      });
      if (response.ok) {
        const data = await response.json();
        setExplorerCurrentPath(data.currentPath);
        setExplorerFolders(data.folders || []);
        setExplorerParentPath(data.parent);
        setShowNewFolderInput(false);
        setExplorerNewFolderName("");
      } else {
        const data = await response.json();
        setExplorerError(data.error || "Không thể truy cập thư mục");
      }
    } catch (err: any) {
      setExplorerError(err.message);
    }
  };

  const handleOpenExplorer = () => {
    setIsExplorerOpen(true);
    explorePath(projectData.pcDirectory || "");
  };

  const handleCreateNewFolder = async () => {
    if (!explorerNewFolderName.trim() || !explorerCurrentPath) return;
    try {
      const response = await fetch("/api/create-directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentPath: explorerCurrentPath, folderName: explorerNewFolderName })
      });
      if (response.ok) {
        explorePath(explorerCurrentPath);
      } else {
        const data = await response.json();
        alert(data.error || "Không thể tạo thư mục mới");
      }
    } catch (err: any) {
      alert(`Lỗi tạo thư mục: ${err.message}`);
    }
  };

  const handleSelectExplorerFolder = async (selectedPath: string) => {
    try {
      const response = await fetch("/api/init-directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedPath })
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.path) {
          const updatedData = { ...projectData, pcDirectory: data.path };
          setProjectData(updatedData);
          
          const project = await getProject(activeProjectId);
          if (project) {
            project.projectData = updatedData;
            project.updatedAt = new Date().toISOString();
            await saveProject(project);
          }
          
          queueManager.addLog(`[Cấu hình] Đã chọn thư mục dự án trên PC: ${data.path}`, "success", activeProjectId);
          setIsExplorerOpen(false);
        }
      } else {
        const errData = await response.json();
        alert(`Thư mục không hợp lệ: ${errData.error || "Lỗi không xác định"}`);
      }
    } catch (err: any) {
      alert(`Lỗi thiết lập thư mục: ${err.message}`);
    }
  };

  const handleManualPcDirectoryChange = (val: string) => {
    setProjectData((prev) => ({ ...prev, pcDirectory: val }));
  };

  const handleManualPcDirectoryBlur = async (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) {
      const updatedData = { ...projectData, pcDirectory: "" };
      setProjectData(updatedData);
      const project = await getProject(activeProjectId);
      if (project) {
        project.projectData = updatedData;
        project.updatedAt = new Date().toISOString();
        await saveProject(project);
      }
      return;
    }

    try {
      const response = await fetch("/api/init-directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: trimmed })
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.path) {
          const updatedData = { ...projectData, pcDirectory: data.path };
          setProjectData(updatedData);
          
          const project = await getProject(activeProjectId);
          if (project) {
            project.projectData = updatedData;
            project.updatedAt = new Date().toISOString();
            await saveProject(project);
          }
          
          queueManager.addLog(`[Cấu hình] Đã thiết lập thư mục PC: ${data.path}`, "success", activeProjectId);
        }
      } else {
        const errData = await response.json();
        alert(`Thư mục không hợp lệ: ${errData.error || "Lỗi không xác định"}`);
      }
    } catch (err: any) {
      console.error(err);
    }
  };

  const updateStepStatus = (
    key: StepKey,
    status: PipelineStep["status"],
    error?: string
  ) => {
    setSteps((prev) =>
      prev.map((step) =>
        step.key === key ? { ...step, status, error } : step
      )
    );
  };

  const getStepJsonFilename = (key: StepKey) => {
    switch (key) {
      case "story_analyzer":
        return "storyboard_scenes.json";
      case "character_extractor":
        return "character_reference.json";
      case "environment_extractor":
        return "environment_reference.json";
      case "prop_extractor":
        return "prop_reference.json";
      case "shot_planner":
        return "shots.json";
      case "keyframe_generator":
        return "keyframe_prompts.json";
      case "motion_generator":
        return "motion_prompts.json";
    }
  };

  const getStepJsonData = (key: StepKey) => {
    switch (key) {
      case "story_analyzer":
        return projectData.scenes;
      case "character_extractor":
        return projectData.characters;
      case "environment_extractor":
        return projectData.environments;
      case "prop_extractor":
        return projectData.props;
      case "shot_planner":
        return projectData.shots;
      case "keyframe_generator":
        return projectData.keyframes;
      case "motion_generator":
        return projectData.motion_prompts;
    }
  };

  const handleUpdateStepData = (key: StepKey, updatedData: any) => {
    setProjectData((prev) => {
      const copy = { ...prev };
      switch (key) {
        case "story_analyzer":
          copy.scenes = updatedData;
          break;
        case "character_extractor":
          copy.characters = updatedData;
          break;
        case "environment_extractor":
          copy.environments = updatedData;
          break;
        case "prop_extractor":
          copy.props = updatedData;
          break;
        case "shot_planner":
          copy.shots = updatedData;
          break;
        case "keyframe_generator":
          copy.keyframes = updatedData;
          break;
        case "motion_generator":
          copy.motion_prompts = updatedData;
          break;
      }
      return copy;
    });
  };

  // Delegate execution flow to queueManager
  const handleRunStep = (stepKey: StepKey) => {
    if (!checkPcDirectory()) return;
    if (apiKeys.length === 0) {
      setIsSettingsOpen(true);
      alert("Please add at least one Gemini API key in the Settings panel.");
      return;
    }
    if (!storyboard.trim()) {
      alert("Please enter storyboard script content first.");
      return;
    }

    queueManager.runStep({
      projectId: activeProjectId,
      projectName: activeProjectName,
      stepKey,
      storyboard,
      projectData,
      steps,
      apiKeys,
      selectedModel,
      rpmLimit,
      chunkSize,
      custom_instructions: stepKey === "motion_generator" ? customMotionInstructions : undefined,
    });
  };

  // Run groups of steps (Combo runs)
  const runCombo1 = () => {
    if (!checkPcDirectory()) return;
    if (apiKeys.length === 0) {
      setIsSettingsOpen(true);
      alert("Please add at least one Gemini API key in the Settings panel.");
      return;
    }
    if (!storyboard.trim()) {
      alert("Please enter storyboard script content first.");
      return;
    }

    const confirmClear = window.confirm(
      "Bạn có chắc chắn muốn xóa dữ liệu cũ để chạy lại Combo 1 từ đầu không? Hành động này sẽ reset toàn bộ kết quả đã sinh trước đó."
    );
    if (!confirmClear) return;

    // Reset local data but preserve PC directory
    const preservedData = { ...INITIAL_PROJECT_DATA, pcDirectory: projectData.pcDirectory };
    setProjectData(preservedData);

    queueManager.runCombo1({
      projectId: activeProjectId,
      projectName: activeProjectName,
      storyboard,
      apiKeys,
      selectedModel,
      rpmLimit,
      chunkSize,
      initialSteps: INITIAL_STEPS,
      projectData: preservedData,
    });
    setActiveTab("assets");
    setAssetSubTab("scenes");
  };

  const runCombo2 = () => {
    if (!checkPcDirectory()) return;
    if (apiKeys.length === 0) {
      setIsSettingsOpen(true);
      alert("Please add at least one Gemini API key in the Settings panel.");
      return;
    }
    if (!storyboard.trim()) {
      alert("Please enter storyboard script content first.");
      return;
    }

    const confirmClear = window.confirm(
      "Bạn có chắc chắn muốn xóa dữ liệu cũ để chạy lại Combo 2 từ đầu không? Hành động này sẽ reset toàn bộ kết quả đã sinh trước đó."
    );
    if (!confirmClear) return;

    // Reset local data but preserve PC directory
    const preservedData = { ...INITIAL_PROJECT_DATA, pcDirectory: projectData.pcDirectory };
    setProjectData(preservedData);

    queueManager.runCombo2({
      projectId: activeProjectId,
      projectName: activeProjectName,
      storyboard,
      apiKeys,
      selectedModel,
      rpmLimit,
      chunkSize,
      initialSteps: INITIAL_STEPS,
      projectData: preservedData,
    });
    setActiveTab("assets");
    setAssetSubTab("characters");
  };

  // Run the whole pipeline sequentially
  const handleRunAllPipeline = () => {
    if (!checkPcDirectory()) return;
    if (apiKeys.length === 0) {
      setIsSettingsOpen(true);
      alert("Please add at least one Gemini API key in the Settings panel.");
      return;
    }
    if (!storyboard.trim()) {
      alert("Please write a script storyboard first.");
      return;
    }

    const confirmClear = window.confirm(
      "Bạn có chắc chắn muốn xóa dữ liệu cũ để chạy lại toàn bộ quy trình (Combo 3) từ đầu không? Hành động này sẽ reset toàn bộ kết quả đã sinh trước đó."
    );
    if (!confirmClear) return;

    // Reset local data but preserve PC directory
    setProjectData({ ...INITIAL_PROJECT_DATA, pcDirectory: projectData.pcDirectory });

    queueManager.runAllPipeline({
      projectId: activeProjectId,
      projectName: activeProjectName,
      storyboard,
      apiKeys,
      selectedModel,
      rpmLimit,
      chunkSize,
      initialSteps: INITIAL_STEPS,
      pcDirectory: projectData.pcDirectory,
    });
  };

  // Helper to normalize reference asset filenames
  const normalizeFileName = (name: string) => {
    if (!name) return "";
    return name.toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") + ".png";
  };

  // Helper to trigger a single JSON file download
  const triggerJsonDownload = (data: any, defaultFilename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", defaultFilename);
    document.body.appendChild(link);
    link.click();
    link.parentNode?.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  // Export 3 prompt JSON files based on the specification
  const handleExportJsonPrompts = () => {
    if (projectData.shots.length === 0) {
      alert("Chưa có camera shots. Vui lòng chạy các bước tạo prompt trước.");
      return;
    }

    const safeProjName = activeProjectName.replace(/\s+/g, "_");

    // 1. References JSON
    const referencesData: any[] = [];
    
    // Add characters
    (projectData.characters || []).forEach((c: any, index: number) => {
      const origId = c.canonical_name || c.name || `char_${index + 1}`;
      const normId = normalizeFileName(origId).replace(".png", "");
      referencesData.push({
        id: normId,
        fileName: `${normId}.png`,
        prompt: c.turnaround_prompt || c.prompt || ""
      });
    });

    // Add environments
    (projectData.environments || []).forEach((e: any, index: number) => {
      const origId = e.setting_name || e.name || `env_${index + 1}`;
      const normId = normalizeFileName(origId).replace(".png", "");
      referencesData.push({
        id: normId,
        fileName: `${normId}.png`,
        prompt: e.reference_prompt || e.prompt || ""
      });
    });

    // Add props
    (projectData.props || []).forEach((p: any, index: number) => {
      const origId = p.prop_name || p.name || `prop_${index + 1}`;
      const normId = normalizeFileName(origId).replace(".png", "");
      referencesData.push({
        id: normId,
        fileName: `${normId}.png`,
        prompt: p.reference_prompt || p.prompt || ""
      });
    });

    // 2. Shots JSON
    const shotsData = (projectData.shots || []).map((shot: any, index: number) => {
      const matchedAssets = getReferencedAssetsForShot(shot) || [];
      const refFileNames = Array.from(
        new Set(matchedAssets.map((asset: any) => normalizeFileName(asset.name)).filter(Boolean))
      );

      const keyframeObj = projectData.keyframes
        ? projectData.keyframes.find((k: any) => k.shot_id === shot.shot_id)
        : null;
      const keyframePrompt = keyframeObj?.keyframe_image_prompt || keyframeObj?.prompt || shot.actions || "";

      return {
        id: `shot_${index + 1}.png`,
        references: refFileNames,
        prompt: keyframePrompt
      };
    });

    // 3. Video Prompts JSON
    const videoPromptsData = (projectData.shots || []).map((shot: any, index: number) => {
      const motionObj = projectData.motion_prompts
        ? projectData.motion_prompts.find((m: any) => m.shot_id === shot.shot_id)
        : null;
      
      const motionPrompt = motionObj?.motion_description || motionObj?.prompt || shot.camera_movement || "cinematic motion, slow pan";

      const shotFileName = `shot_${index + 1}.png`;
      return {
        id: index + 1,
        imageName: shotFileName,
        "tên ảnh shots": shotFileName,
        prompt: motionPrompt
      };
    });

    // Trigger downloads with a slight delay to prevent browser blocking
    triggerJsonDownload(referencesData, `${safeProjName}_references.json`);
    
    setTimeout(() => {
      triggerJsonDownload(shotsData, `${safeProjName}_shots.json`);
    }, 250);

    setTimeout(() => {
      triggerJsonDownload(videoPromptsData, `${safeProjName}_video_prompts.json`);
    }, 500);
  };

  // Scan assets from configured PC directory
  const handleScanPcAssets = async () => {
    if (!projectData.pcDirectory) {
      alert("Vui lòng cấu hình thư mục lưu trữ dự án trên máy tính trước.");
      return;
    }

    try {
      const response = await fetch("/api/scan-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pcDirectory: projectData.pcDirectory })
      });

      if (!response.ok) {
        throw new Error(`Quét Assets thất bại với trạng thái ${response.status}`);
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Lỗi quét thư mục Assets.");
      }

      const { references = [], images_shots = [], videos = [] } = data;

      const getBaseName = (filename: string) => {
        const parts = filename.split(".");
        if (parts.length > 1) parts.pop();
        return parts.join(".").toLowerCase().trim();
      };

      const isAssetMatch = (filename: string, assetName: string) => {
        const base = getBaseName(filename);
        const name = assetName.toLowerCase().trim();
        if (base === name) return true;
        if (base === name.replace(/[^a-z0-9]+/g, "_")) return true;
        return false;
      };

      const isShotMatch = (filename: string, shotId: string) => {
        const base = getBaseName(filename);
        const sId = shotId.toLowerCase().trim();
        if (base === sId) return true;
        if (base === `shot_${sId}`) return true;
        if (base === `shot_${sId.padStart(3, '0')}`) return true;
        
        const numOnlyBase = base.replace(/[^0-9]/g, "");
        const numOnlyId = sId.replace(/[^0-9]/g, "");
        if (numOnlyBase && numOnlyId && parseInt(numOnlyBase, 10) === parseInt(numOnlyId, 10)) {
          return true;
        }
        return false;
      };

      setProjectData((prev) => {
        const copy = { ...prev };

        // 1. Scan & Map characters
        copy.characters = (copy.characters || []).map((char: any) => {
          const match = references.find((f: any) => isAssetMatch(f.name, char.name));
          if (match) {
            return {
              ...char,
              url: `/api/media?path=${encodeURIComponent(match.path)}`
            };
          }
          return char;
        });

        // 2. Scan & Map environments
        copy.environments = (copy.environments || []).map((env: any) => {
          const name = env.setting_name || env.name || "";
          const match = references.find((f: any) => isAssetMatch(f.name, name));
          if (match) {
            return {
              ...env,
              url: `/api/media?path=${encodeURIComponent(match.path)}`
            };
          }
          return env;
        });

        // 3. Scan & Map props
        copy.props = (copy.props || []).map((prop: any) => {
          const name = prop.prop_name || prop.name || "";
          const match = references.find((f: any) => isAssetMatch(f.name, name));
          if (match) {
            return {
              ...prop,
              url: `/api/media?path=${encodeURIComponent(match.path)}`
            };
          }
          return prop;
        });

        // 4. Scan & Map shot keyframes
        const updatedKeyframes = [...(copy.keyframes || [])];
        (copy.shots || []).forEach((shot: any) => {
          const match = images_shots.find((f: any) => isShotMatch(f.name, shot.shot_id));
          if (match) {
            const mediaUrl = `/api/media?path=${encodeURIComponent(match.path)}`;
            const kIdx = updatedKeyframes.findIndex((k: any) => k.shot_id === shot.shot_id);
            if (kIdx !== -1) {
              updatedKeyframes[kIdx] = {
                ...updatedKeyframes[kIdx],
                url: mediaUrl
              };
            } else {
              updatedKeyframes.push({
                shot_id: shot.shot_id,
                url: mediaUrl,
                keyframe_image_prompt: ""
              });
            }
          }
        });
        copy.keyframes = updatedKeyframes;

        // 5. Scan & Map videos
        const updatedMotionPrompts = [...(copy.motion_prompts || [])];
        (copy.shots || []).forEach((shot: any) => {
          const match = videos.find((f: any) => isShotMatch(f.name, shot.shot_id));
          if (match) {
            const mediaUrl = `/api/media?path=${encodeURIComponent(match.path)}`;
            const mIdx = updatedMotionPrompts.findIndex((m: any) => m.shot_id === shot.shot_id);
            if (mIdx !== -1) {
              updatedMotionPrompts[mIdx] = {
                ...updatedMotionPrompts[mIdx],
                video_url: mediaUrl
              };
            } else {
              updatedMotionPrompts.push({
                shot_id: shot.shot_id,
                video_url: mediaUrl,
                motion_description: ""
              });
            }
          }
        });
        copy.motion_prompts = updatedMotionPrompts;

        return copy;
      });

      alert("Quét Assets hoàn tất! Các ảnh tham chiếu, ảnh shots và video được cập nhật.");
    } catch (err: any) {
      console.error(err);
      alert(`Quét Assets thất bại: ${err.message}`);
    }
  };

  // Send everything to ZIP exporter
  const handleExportZip = async () => {
    if (projectData.scenes.length === 0) {
      alert("Cannot export an empty project. Run the pipeline stages first.");
      return;
    }

    // Translate frontend projectData format back to Pydantic schemas format
    const payloadScenes = (projectData.scenes || []).map((scene: any) => ({
      scene_number: scene.scene_id,
      duration_seconds: scene.duration_seconds,
      characters: scene.characters,
      location: scene.setting,
      props: scene.props,
      action: scene.description,
      dialogue: scene.dialogues ? scene.dialogues.map((d: any) => ({
        character: d.character,
        speech: d.text
      })) : []
    }));

    const payloadCharacters = (projectData.characters || []).map((char: any, index: number) => {
      const cname = char.canonical_name || char.name || "";
      return {
        id: char.id || `char_${Date.now()}_${index}`,
        canonical_name: cname,
        name: cname,
        age: char.age || "",
        gender: char.gender || "",
        appearance: char.appearance || "",
        outfit: char.outfit || "",
        hairstyle: char.hairstyle || "",
        accessories: char.accessories || "",
        voice_style: char.voice_style || "",
        personality: char.personality || "",
        turnaround_prompt: char.turnaround_prompt || char.prompt || "",
        prompt: char.turnaround_prompt || char.prompt || "",
        description: char.description || ""
      };
    });

    const payloadEnvironments = (projectData.environments || []).map((env: any, index: number) => {
      const ename = env.setting_name || env.name || "";
      const eprompt = env.reference_prompt || env.prompt || "";
      return {
        id: env.id || `env_${Date.now()}_${index}`,
        name: ename,
        reference_prompt: eprompt,
        prompt: eprompt
      };
    });

    const payloadProps = (projectData.props || []).map((prop: any, index: number) => {
      const pname = prop.prop_name || prop.name || "";
      const pprompt = prop.reference_prompt || prop.prompt || "";
      return {
        id: prop.id || `prop_${Date.now()}_${index}`,
        name: pname,
        reference_prompt: pprompt,
        prompt: pprompt
      };
    });

    const payloadShots = (projectData.shots || []).map((shot: any) => ({
      shot_id: shot.shot_id,
      scene_number: Number(shot.scene_number || shot.scene_id || 0),
      duration_seconds: Number(shot.duration_seconds || 5),
      actions: shot.actions || "",
      characters: shot.characters || [],
      environment: shot.setting || shot.environment || "",
      props: shot.props || [],
      dialogue: shot.dialogue ? shot.dialogue.map((d: any) => ({
        character: d.character,
        speech: d.text
      })) : [],
      camera_movement: shot.camera_movement || "",
      shot_type: shot.framing || "",
      transition: shot.transition || "Cut",
      composition: shot.composition || "Rule of Thirds",
      lighting: shot.lighting || "Warm lighting"
    }));

    const payloadKeyframes = (projectData.keyframes || []).map((k: any) => ({
      shot_id: k.shot_id,
      prompt: k.keyframe_image_prompt || ""
    }));

    const payloadMotion = (projectData.motion_prompts || []).map((m: any) => ({
      shot_id: m.shot_id,
      prompt: m.motion_description || m.prompt || ""
    }));

    try {
      const response = await fetch(`${getBackendUrl()}/api/export-zip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storyboard,
          scenes: payloadScenes,
          characters: payloadCharacters,
          environments: payloadEnvironments,
          props: payloadProps,
          shots: payloadShots,
          keyframes: payloadKeyframes,
          motion_prompts: payloadMotion,
          model: selectedModel,
        }),
      });

      if (!response.ok) {
        throw new Error(`Export request failed with status ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${activeProjectName.replace(/\s+/g, "_")}_Project.zip`);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error(err);
      alert(`Export failed: ${err.message}`);
    }
  };

  // Call local API to generate image, supporting Image-to-Image (with media_ids and account_id)
  const generateImageViaLocalApi = async (promptText: string, mediaIds?: string[], accountId?: string) => {
    try {
      const payload: any = {
        prompt: promptText,
        count: imageCount || 1,
        aspect_ratio: imageAspectRatio || "IMAGE_ASPECT_RATIO_LANDSCAPE",
        model: imageModel || "GEM_PIX_2",
        for_video: true
      };

      if (mediaIds && mediaIds.length > 0) {
        payload.media_ids = mediaIds;
        payload.account_id = accountId || "default_account";
      }

      const localApiUrl = typeof window !== "undefined" ? `http://${window.location.hostname}:5000` : "http://127.0.0.1:5000";
      const response = await fetch(`${localApiUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Local API responded with status ${response.status}`);
      }

      const data = await response.json();
      if (data.success && data.images && data.images.length > 0) {
        return {
          url: data.images[0].url,
          media_id: data.images[0].media_id,
          account_id: data.account_id || "default_account"
        };
      } else {
        throw new Error("No image was returned from local API.");
      }
    } catch (err: any) {
      console.error("Local Image API failed: ", err.message);
      throw err;
    }
  };

  // Reference image generator trigger (pushes task to sequential queue)
  const triggerGenerateAssetImage = async (id: string) => {
    if (!checkPcDirectory()) return;
    const startedProjectId = activeProjectId;
    
    let promptText = "";
    let type: "character" | "environment" | "prop" = "character";
    let name = "";

    if (id.startsWith("char_")) {
      type = "character";
      name = id.substring(5);
      const found = projectData.characters.find(c => c.name === name);
      promptText = found ? found.turnaround_prompt : `character turnaround Pixar style ${name}`;
    } else if (id.startsWith("env_")) {
      type = "environment";
      name = id.substring(4);
      const found = projectData.environments.find(e => e.setting_name === name);
      promptText = found ? found.reference_prompt : `environment background Pixar style ${name}`;
    } else if (id.startsWith("prop_")) {
      type = "prop";
      name = id.substring(5);
      const found = projectData.props.find(p => p.prop_name === name);
      promptText = found ? found.reference_prompt : `prop Pixar style ${name}`;
    }

    const taskId = `media_task_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;
    queueManager.addMediaTask({
      id: taskId,
      projectId: startedProjectId,
      projectName: activeProjectName,
      type,
      targetId: name,
      prompt: promptText,
      params: {
        imageCount,
        imageAspectRatio,
        imageModel,
        pcDirectory: projectData.pcDirectory,
      }
    });
  };

  // Shot image generator trigger (pushes task to sequential queue)
  const triggerGenerateShotImage = async (key: string) => {
    if (!checkPcDirectory()) return;
    const startedProjectId = activeProjectId;
    const parts = key.split("_");
    const shotId = parts[parts.length - 1];

    // Find the shot details to check for referenced assets
    const shotObj = projectData.shots.find((s: any) => s.shot_id === shotId);
    const referencedAssets = shotObj ? getReferencedAssetsForShot(shotObj) : [];

    // Collect media_ids and account_id from referenced assets
    const mediaIds: string[] = [];
    let accountId = "";

    referencedAssets.forEach(ref => {
      let assetData = null;
      if (ref.type === "character") {
        assetData = projectData.characters.find(c => c.name === ref.name);
      } else if (ref.type === "environment") {
        assetData = projectData.environments.find(e => e.setting_name === ref.name);
      } else if (ref.type === "prop") {
        assetData = projectData.props.find(p => p.prop_name === ref.name);
      }

      if (assetData && assetData.media_id && !assetData.media_id.startsWith("mock_")) {
        mediaIds.push(assetData.media_id);
        if (!accountId && assetData.account_id) {
          accountId = assetData.account_id;
        }
      }
    });

    const keyframeObj = projectData.keyframes
      ? projectData.keyframes.find((k: any) => k.shot_id === shotId)
      : null;
    const promptText = keyframeObj?.keyframe_image_prompt || `Pixar keyframe for shot ${shotId}`;

    const taskId = `media_task_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;
    queueManager.addMediaTask({
      id: taskId,
      projectId: startedProjectId,
      projectName: activeProjectName,
      type: "shot_image",
      targetId: key, // Keep full key
      prompt: promptText,
      params: {
        imageCount,
        imageAspectRatio,
        imageModel,
        mediaIds: mediaIds.length > 0 ? mediaIds : undefined,
        accountId: accountId || undefined,
        pcDirectory: projectData.pcDirectory,
      }
    });
  };

  // Video segment generator trigger (pushes task to sequential queue)
  const triggerGenerateSegmentVideo = async (shotKey: string) => {
    if (!checkPcDirectory()) return;
    const startedProjectId = activeProjectId;
    const parts = shotKey.split("_");
    const shotId = parts[parts.length - 1];

    // Find motion description
    const motionIndex = projectData.motion_prompts
      ? projectData.motion_prompts.findIndex((m: any) => m.shot_id === shotId)
      : -1;
    const promptText = motionIndex !== -1 && projectData.motion_prompts
      ? projectData.motion_prompts[motionIndex].motion_description
      : "cinematic camera motion";

    // Find keyframe image media_id and account_id
    const keyframeObj = projectData.keyframes
      ? projectData.keyframes.find((k: any) => k.shot_id === shotId)
      : null;
    const hasImage = !!(keyframeObj && keyframeObj.url && !keyframeObj.url.startsWith("mock_") && keyframeObj.media_id);
    const mediaIds = hasImage ? [keyframeObj.media_id] : undefined;
    const accountId = hasImage ? (keyframeObj.account_id || "default_account") : undefined;

    // Resolve audioReferenceMediaIds from referenced characters in the shot
    const audioReferenceMediaIds: string[] = [];
    const shotObj = projectData.shots.find((s: any) => s.shot_id === shotId);
    if (shotObj) {
      const referencedAssets = getReferencedAssetsForShot(shotObj);
      referencedAssets.forEach(ref => {
        if (ref.type === "character") {
          const charData = projectData.characters.find(c => c.name.toLowerCase() === ref.name.toLowerCase());
          if (charData && charData.audioReferenceMediaIds) {
            charData.audioReferenceMediaIds.forEach((audioId: string) => {
              if (audioId && !audioReferenceMediaIds.includes(audioId)) {
                audioReferenceMediaIds.push(audioId);
              }
            });
          }
        }
      });
    }

    const taskId = `media_task_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;
    queueManager.addMediaTask({
      id: taskId,
      projectId: startedProjectId,
      projectName: activeProjectName,
      type: "shot_video",
      targetId: shotKey, // Keep full shotKey
      prompt: promptText,
      params: {
        videoCount,
        videoAspectRatio,
        videoModel,
        mediaIds,
        accountId,
        audioReferenceMediaIds: audioReferenceMediaIds.length > 0 ? audioReferenceMediaIds : undefined,
        duration_seconds: shotObj?.duration_seconds || 5,
        pcDirectory: projectData.pcDirectory,
      }
    });
  };

  // Video renderer caller using Next.js streaming API
  const startVideoRendering = async () => {
    if (!checkPcDirectory()) return;
    if (projectData.shots.length === 0) {
      alert("Vui lòng tạo danh sách shot trước khi render.");
      return;
    }
    
    setIsRenderingVideo(true);
    setVideoRenderPercent(0);
    setVideoRenderStage("Khởi chạy engine render...");
    queueManager.addLog("Bắt đầu tiến trình Render Video...", "running", activeProjectId);
    
    // Prepare the payload for the rendering API
    const payloadShots = (projectData.shots || []).map((shot: any) => ({
      shot_id: shot.shot_id,
      scene_number: shot.scene_number || shot.scene_id,
      duration_seconds: shot.duration_seconds || 5,
      actions: shot.actions || "",
      characters: shot.characters || [],
      environment: shot.environment || "",
      props: shot.props || [],
      dialogue: shot.dialogue ? shot.dialogue.map((d: any) => ({
        character: d.character,
        speech: d.text || d.speech
      })) : [],
      camera_movement: shot.camera_movement || "Static",
      shot_type: shot.framing || shot.shot_type || ""
    }));

    const payloadKeyframes = (projectData.keyframes || []).map((k: any) => ({
      shot_id: k.shot_id,
      url: k.url || "",
      media_id: k.media_id || ""
    }));

    const payloadMotion = (projectData.motion_prompts || []).map((m: any) => ({
      shot_id: m.shot_id,
      motion_description: m.motion_description || m.prompt || "",
      video_url: m.video_url || ""
    }));

    try {
      const response = await fetch("/api/render", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: activeProjectId,
          resolution: videoResolution,
          shots: payloadShots,
          keyframes: payloadKeyframes,
          motion_prompts: payloadMotion
        })
      });

      if (!response.ok) {
        throw new Error(`Render request failed: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("No response body received from server");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let buffer = "";

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          buffer += decoder.decode(value, { stream: !doneReading });
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // keep tail

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const data = JSON.parse(trimmed);
              if (data.percent !== undefined) {
                setVideoRenderPercent(data.percent);
              }
              if (data.stage) {
                setVideoRenderStage(data.stage);
                queueManager.addLog(`[Render Engine] ${data.stage}`, "info", activeProjectId);
              }
              
              if (data.status === "success") {
                queueManager.addLog("Quá trình render video hoàn tất! File MP4 đã được tạo.", "success", activeProjectId);
                setRenderTimestamp(Date.now());
                setIsRenderingVideo(false);
                setIsVideoGenerated(true);
                setActiveTab("video");
              } else if (data.status === "failed") {
                throw new Error(data.error || "Unknown render error");
              }
            } catch (err) {
              // Ignore JSON parse errors for incomplete chunks
            }
          }
        }
      }
    } catch (err: any) {
      console.error(err);
      alert(`Render failed: ${err.message}`);
      queueManager.addLog(`[Render Engine] Lỗi render: ${err.message}`, "error", activeProjectId);
      setIsRenderingVideo(false);
    }
  };

  // Helper matching search Unsplash links for visual assets
  const getAssetImage = (name: string, type: 'character' | 'environment' | 'prop') => {
    const lowercase = name.toLowerCase();
    if (type === 'character') {
      if (lowercase.includes('lisa')) {
        return "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=400&auto=format&fit=crop&q=80";
      }
      if (lowercase.includes('tom')) {
        return "https://images.unsplash.com/photo-1541562232579-512a21360020?w=400&auto=format&fit=crop&q=80";
      }
      return "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80";
    } else if (type === 'environment') {
      if (lowercase.includes('school') || lowercase.includes('trường')) {
        return "https://images.unsplash.com/photo-1509062522246-3755977927d7?w=500&auto=format&fit=crop&q=80";
      }
      if (lowercase.includes('classroom') || lowercase.includes('lớp')) {
        return "https://images.unsplash.com/photo-1541339907198-e08756dedf3f?w=500&auto=format&fit=crop&q=80";
      }
      return "https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=500&auto=format&fit=crop&q=80";
    } else {
      if (lowercase.includes('lunch') || lowercase.includes('cơm')) {
        return "https://images.unsplash.com/photo-1543007630-9710e4a00a20?w=400&auto=format&fit=crop&q=80";
      }
      return "https://images.unsplash.com/photo-1513542789411-b6a5d4f31634?w=400&auto=format&fit=crop&q=80";
    }
  };

  // Sync simulated subtitles playing on Tab 7 (Cinema)
  const getSubtitlesAtTime = (time: number) => {
    if (!projectData.scenes || projectData.scenes.length === 0) return "";
    
    let accumulatedTime = 0;
    for (let i = 0; i < projectData.scenes.length; i++) {
      const scene = projectData.scenes[i];
      const duration = scene.duration_seconds || 5;
      if (time >= accumulatedTime && time < accumulatedTime + duration) {
        // Look up dialogues in this scene
        if (scene.dialogues && scene.dialogues.length > 0) {
          // If multiple dialogues, divide duration evenly
          const count = scene.dialogues.length;
          const segmentDuration = duration / count;
          const offset = time - accumulatedTime;
          const dialogIndex = Math.floor(offset / segmentDuration);
          const currentDialog = scene.dialogues[Math.min(dialogIndex, count - 1)];
          return `${currentDialog.character}: "${currentDialog.text}"`;
        }
        return "";
      }
      accumulatedTime += duration;
    }
    return "";
  };

  const getCinemaMovieTotalDuration = () => {
    if (!projectData.scenes) return 10;
    return projectData.scenes.reduce((acc, s) => acc + (s.duration_seconds || 5), 0);
  };

  // Cinema tab duration & active state helper functions
  const getCinemaTotalDuration = () => {
    if (projectData.shots && projectData.shots.length > 0) {
      return projectData.shots.reduce((acc, s) => acc + (s.duration_seconds || 5), 0);
    }
    if (projectData.scenes && projectData.scenes.length > 0) {
      return projectData.scenes.reduce((acc, s) => acc + (s.duration_seconds || 5), 0);
    }
    return 10;
  };

  const getSubtitlesForCinema = (time: number, sceneStartTime: number, sceneDuration: number, dialogues: any[], description: string) => {
    if (!dialogues || dialogues.length === 0) {
      return { character: "", text: "" };
    }
    
    const count = dialogues.length;
    const segmentDuration = sceneDuration / count;
    const offset = time - sceneStartTime;
    const dialogIndex = Math.min(Math.floor(offset / segmentDuration), count - 1);
    const currentDialog = dialogues[dialogIndex];
    
    if (!currentDialog) return { character: "", text: "" };
    
    const charName = currentDialog.character || "";
    const fullText = currentDialog.text || "";
    
    // Apply word count limits
    const words = fullText.split(/\s+/).filter((w: string) => w.length > 0);
    const maxWords = subConfig.maxWordsPerSub || 6;
    const totalWords = words.length;
    
    if (totalWords <= maxWords) {
      return { character: charName, text: fullText };
    }
    
    // Split into sub-segments based on words per sub
    const numChunks = Math.ceil(totalWords / maxWords);
    const dialogueOffset = offset - (dialogIndex * segmentDuration);
    const subSegmentDuration = segmentDuration / numChunks;
    const chunkIndex = Math.min(Math.floor(dialogueOffset / subSegmentDuration), numChunks - 1);
    
    const startWordIdx = chunkIndex * maxWords;
    const endWordIdx = Math.min(startWordIdx + maxWords, totalWords);
    const chunkWords = words.slice(startWordIdx, endWordIdx);
    
    return {
      character: charName,
      text: chunkWords.join(" ")
    };
  };

  const getCinemaActiveStateAtTime = (time: number) => {
    const totalDuration = getCinemaTotalDuration();
    const clampedTime = Math.min(Math.max(0, time), totalDuration);
    
    // Play by shots
    if (projectData.shots && projectData.shots.length > 0) {
      let accumulatedTime = 0;
      for (let i = 0; i < projectData.shots.length; i++) {
        const shot = projectData.shots[i];
        const duration = shot.duration_seconds || 5;
        if (clampedTime >= accumulatedTime && clampedTime < accumulatedTime + duration) {
          const scene = projectData.scenes?.find((s: any) => s.scene_id === shot.scene_id);
          const keyframeObj = projectData.keyframes?.find((k: any) => k.shot_id === shot.shot_id);
          const motionObj = projectData.motion_prompts?.find((m: any) => m.shot_id === shot.shot_id);
          
          // Calculate start and duration of parent scene in shots list
          let sceneStartTime = 0;
          let sceneDuration = 0;
          let tempAcc = 0;
          projectData.shots.forEach((s) => {
            const dur = s.duration_seconds || 5;
            if (s.scene_id === shot.scene_id) {
              if (sceneDuration === 0) {
                sceneStartTime = tempAcc;
              }
              sceneDuration += dur;
            }
            tempAcc += dur;
          });
          
          const subtitle = getSubtitlesForCinema(clampedTime, sceneStartTime, sceneDuration, scene?.dialogues, scene?.description || "");
          
          return {
            mode: "shot" as const,
            index: i,
            totalCount: projectData.shots.length,
            activeShot: shot,
            activeScene: scene,
            imageUrl: keyframeObj?.url || "",
            videoUrl: motionObj?.video_url || "",
            subtitle,
            shotStartTime: accumulatedTime,
            shotDuration: duration
          };
        }
        accumulatedTime += duration;
      }
    }
    
    // Fallback: play by scenes
    if (projectData.scenes && projectData.scenes.length > 0) {
      let accumulatedTime = 0;
      for (let i = 0; i < projectData.scenes.length; i++) {
        const scene = projectData.scenes[i];
        const duration = scene.duration_seconds || 5;
        if (clampedTime >= accumulatedTime && clampedTime < accumulatedTime + duration) {
          const subtitle = getSubtitlesForCinema(clampedTime, accumulatedTime, duration, scene.dialogues, scene.description || "");
          return {
            mode: "scene" as const,
            index: i,
            totalCount: projectData.scenes.length,
            activeShot: null,
            activeScene: scene,
            imageUrl: "",
            videoUrl: "",
            subtitle,
            shotStartTime: accumulatedTime,
            shotDuration: duration
          };
        }
        accumulatedTime += duration;
      }
    }
    
    return {
      mode: "none" as const,
      index: 0,
      totalCount: 0,
      activeShot: null,
      activeScene: null,
      imageUrl: "",
      videoUrl: "",
      subtitle: { character: "", text: "" },
      shotStartTime: 0,
      shotDuration: 0
    };
  };


  // Inline SVGs for rendering without library dependencies
  const IconConfig = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
      <circle cx="12" cy="12" r="4"/>
    </svg>
  );

  const IconScene = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  );

  const IconSparkles = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v16M5 12h14M8 7l8 10M16 7L8 10" />
    </svg>
  );

  const IconFolder = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5z" />
      <path d="M6 6h10M6 10h10" />
    </svg>
  );

  const IconImage = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );

  const IconFilm = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 8-6 4 6 4V8Z" />
      <rect width="14" height="12" x="2" y="6" rx="2" />
    </svg>
  );

  const IconCinema = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="15" x="2" y="3" rx="2" />
      <path d="M12 18v4M9 22h6" />
    </svg>
  );

  const IconSettings = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );

  // Helper to determine active JSON editor step based on tab/subtab
  const getSelectedStepForTab = (tab: string, subTab: string): StepKey | null => {
    if (tab === "assets") {
      if (subTab === "scenes") return "story_analyzer";
      if (subTab === "characters") return "character_extractor";
      if (subTab === "environments") return "environment_extractor";
      if (subTab === "props") return "prop_extractor";
    }
    if (tab === "shots") return "shot_planner";
    if (tab === "video") return "motion_generator";
    return null;
  };

  // Sync selectedStep with active tabs
  useEffect(() => {
    const step = getSelectedStepForTab(activeTab, assetSubTab);
    setSelectedStep(step);
  }, [activeTab, assetSubTab]);

  // Cinema Preview timer and playback synchronizer refs/effects
  const cinemaTimerRef = useRef<any>(null);
  const lastTimeRef = useRef<number>(0);
  const cinemaVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (cinemaPlaying) {
      lastTimeRef.current = performance.now();
      const tick = () => {
        const now = performance.now();
        const delta = (now - lastTimeRef.current) / 1000;
        lastTimeRef.current = now;
        setCinemaPlayhead((prev) => {
          const total = getCinemaTotalDuration();
          let next = prev + delta;
          if (next >= total) {
            if (cinemaLoop) {
              next = 0;
            } else {
              next = total;
              setCinemaPlaying(false);
              return next;
            }
          }
          return next;
        });
        cinemaTimerRef.current = requestAnimationFrame(tick);
      };
      cinemaTimerRef.current = requestAnimationFrame(tick);
    } else {
      if (cinemaTimerRef.current) {
        cancelAnimationFrame(cinemaTimerRef.current);
      }
    }
    return () => {
      if (cinemaTimerRef.current) {
        cancelAnimationFrame(cinemaTimerRef.current);
      }
    };
  }, [cinemaPlaying, cinemaLoop]);

  useEffect(() => {
    if (!cinemaVideoRef.current) return;
    const activeState = getCinemaActiveStateAtTime(cinemaPlayhead);
    if (activeState.videoUrl) {
      const expectedTime = cinemaPlayhead - activeState.shotStartTime;
      // Sync play/pause state
      if (cinemaPlaying && cinemaVideoRef.current.paused) {
        cinemaVideoRef.current.play().catch(() => {});
      } else if (!cinemaPlaying && !cinemaVideoRef.current.paused) {
        cinemaVideoRef.current.pause();
      }
      // Sync current time if drift is > 0.3s
      const diff = Math.abs(cinemaVideoRef.current.currentTime - expectedTime);
      if (diff > 0.3) {
        cinemaVideoRef.current.currentTime = Math.max(0, Math.min(expectedTime, activeState.shotDuration));
      }
    }
  }, [cinemaPlayhead, cinemaPlaying]);

  const renderSubtitleLines = (subText: string) => {
    if (!subText) return null;
    const maxChars = subConfig.maxLineLength || 30;
    const words = subText.split(/\s+/).filter((w: string) => w.length > 0);
    const lines: string[] = [];
    let currentLine = "";
    
    words.forEach(word => {
      if ((currentLine + " " + word).trim().length > maxChars) {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          lines.push(word);
        }
      } else {
        currentLine = currentLine ? currentLine + " " + word : word;
      }
    });
    if (currentLine) {
      lines.push(currentLine);
    }
    
    return lines.map((line, idx) => (
      <div key={idx} style={{ margin: "2px 0" }}>
        {line}
      </div>
    ));
  };

  const handleCinemaSkip = (direction: number) => {
    const totalDuration = getCinemaTotalDuration();
    if (totalDuration <= 0) return;
    
    if (projectData.shots && projectData.shots.length > 0) {
      const activeState = getCinemaActiveStateAtTime(cinemaPlayhead);
      const nextIdx = Math.max(0, Math.min(activeState.index + direction, projectData.shots.length - 1));
      
      let nextTime = 0;
      for (let i = 0; i < nextIdx; i++) {
        nextTime += projectData.shots[i].duration_seconds || 5;
      }
      setCinemaPlayhead(nextTime);
      return;
    }
    
    if (projectData.scenes && projectData.scenes.length > 0) {
      const activeState = getCinemaActiveStateAtTime(cinemaPlayhead);
      const nextIdx = Math.max(0, Math.min(activeState.index + direction, projectData.scenes.length - 1));
      
      let nextTime = 0;
      for (let i = 0; i < nextIdx; i++) {
        nextTime += projectData.scenes[i].duration_seconds || 5;
      }
      setCinemaPlayhead(nextTime);
    }
  };

  const handleCinemaTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const totalDuration = getCinemaTotalDuration();
    if (!totalDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = clickX / rect.width;
    const seekTime = Math.max(0, Math.min(percent * totalDuration, totalDuration));
    setCinemaPlayhead(seekTime);
  };

  const toggleFullscreen = () => {
    const playerEl = document.getElementById("cinema-player-screen");
    if (!playerEl) return;
    
    if (!document.fullscreenElement) {
      playerEl.requestFullscreen().catch((err) => {
        console.error("Error attempting to enable fullscreen:", err);
      });
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);


  // Scan shot to match referenced assets
  const getReferencedAssetsForShot = (shot: any) => {
    const refs: { name: string; type: 'character' | 'environment' | 'prop'; key: string; url?: string }[] = [];
    const actionsLower = (shot.actions || "").toLowerCase();
    
    // Find the parent scene to matching setting/location and scene props
    const parentScene = projectData.scenes.find((s: any) => Number(s.scene_id) === Number(shot.scene_number || shot.scene_id));
    const sceneSettingLower = parentScene ? (parentScene.setting || "").toLowerCase() : "";
    const sceneProps = parentScene ? parentScene.props || [] : [];

    // Check characters
    const shotChars = shot.characters || [];
    projectData.characters.forEach(char => {
      if (
        char.name && 
        (actionsLower.includes(char.name.toLowerCase()) || 
         shotChars.some((c: any) => String(c).toLowerCase().includes(char.name.toLowerCase()) || char.name.toLowerCase().includes(String(c).toLowerCase())))
      ) {
        refs.push({ name: char.name, type: 'character', key: `char_${char.name}`, url: char.url });
      }
    });

    // Check setting matching environments
    const settingLower = (shot.setting || shot.environment || "").toLowerCase();
    projectData.environments.forEach(env => {
      const envName = env.setting_name || env.name || "";
      if (envName) {
        const envNameLower = envName.toLowerCase();
        // Fuzzy checks: check containment, parent scene setting, actions text, or keyword overlaps
        const isMatch = 
          settingLower.includes(envNameLower) || 
          envNameLower.includes(settingLower) || 
          (sceneSettingLower && (sceneSettingLower.includes(envNameLower) || envNameLower.includes(sceneSettingLower))) ||
          actionsLower.includes(envNameLower) ||
          (settingLower.length > 2 && envNameLower.length > 2 && (
            settingLower.split(/\s+/).some((word: string) => word.length > 2 && envNameLower.includes(word)) ||
            envNameLower.split(/\s+/).some((word: string) => word.length > 2 && settingLower.includes(word))
          )) ||
          (sceneSettingLower.length > 2 && envNameLower.length > 2 && (
            sceneSettingLower.split(/\s+/).some((word: string) => word.length > 2 && envNameLower.includes(word)) ||
            envNameLower.split(/\s+/).some((word: string) => word.length > 2 && sceneSettingLower.includes(word))
          ));
          
        if (isMatch) {
          if (!refs.some(r => r.name.toLowerCase() === envName.toLowerCase())) {
            refs.push({ name: envName, type: 'environment', key: `env_${envName}`, url: env.url });
          }
        }
      }
    });

    // Check props
    const shotProps = shot.props || [];
    projectData.props.forEach(prop => {
      const propName = prop.prop_name || prop.name || "";
      if (propName) {
        const propNameLower = propName.toLowerCase();
        // Fuzzy checks: check containment in actions, shotProps list, parent scene props, or keyword overlaps
        const isMatch = 
          actionsLower.includes(propNameLower) || 
          shotProps.some((p: any) => {
            const pLower = String(p).toLowerCase();
            return pLower.includes(propNameLower) || propNameLower.includes(pLower);
          }) ||
          sceneProps.some((p: any) => {
            const pLower = String(p).toLowerCase();
            return pLower.includes(propNameLower) || propNameLower.includes(pLower);
          }) ||
          (propNameLower.length > 2 && (
            propNameLower.split(/\s+/).some((word: string) => word.length > 2 && actionsLower.includes(word)) ||
            shotProps.some((p: any) => {
              const pLower = String(p).toLowerCase();
              return pLower.split(/\s+/).some((word: string) => word.length > 2 && propNameLower.includes(word));
            }) ||
            sceneProps.some((p: any) => {
              const pLower = String(p).toLowerCase();
              return pLower.split(/\s+/).some((word: string) => word.length > 2 && propNameLower.includes(word));
            })
          ));
          
        if (isMatch) {
          if (!refs.some(r => r.name.toLowerCase() === propName.toLowerCase())) {
            refs.push({ name: propName, type: 'prop', key: `prop_${propName}`, url: prop.url });
          }
        }
      }
    });

    return refs;
  };

  const getTabColor = (tabName: string) => {
    const isActive = activeTab === tabName;
    let hasData = false;
    
    if (tabName === "cauhinh") {
      hasData = storyboard.trim().length > 0;
    } else if (tabName === "assets") {
      hasData = projectData.scenes.length > 0 || projectData.characters.length > 0;
    } else if (tabName === "shots") {
      hasData = projectData.shots.length > 0;
    } else if (tabName === "video") {
      hasData = projectData.motion_prompts.length > 0;
    } else if (tabName === "rapphim") {
      hasData = projectData.motion_prompts.length > 0;
    }
    
    if (hasData) {
      return "#10b981"; // Green color
    }
    return isActive ? "var(--accent-purple)" : "var(--text-secondary)";
  };

  const getStepUIStatus = (stepKey: StepKey): "running" | "pending" | "idle" | "success" | "failed" => {
    if (activeStep === stepKey) {
      return "running";
    }
    
    const stepObj = steps.find(s => s.key === stepKey);
    if (!stepObj) return "idle";
    
    if (stepObj.status === "success") return "success";
    if (stepObj.status === "failed") return "failed";
    
    if (activeStep !== null) {
      const combo3Order: StepKey[] = [
        "story_analyzer",
        "character_extractor",
        "environment_extractor",
        "prop_extractor",
        "shot_planner"
      ];
      
      const combo1Order: StepKey[] = [
        "story_analyzer",
        "character_extractor",
        "shot_planner"
      ];
      
      const combo2Order: StepKey[] = [
        "character_extractor",
        "environment_extractor",
        "prop_extractor"
      ];
      
      if (isRunningAll) {
        const activeIdx = combo3Order.indexOf(activeStep);
        const currentIdx = combo3Order.indexOf(stepKey);
        if (activeIdx !== -1 && currentIdx > activeIdx) {
          return "pending";
        }
      } else {
        const isCombo1Active = combo1Order.includes(activeStep);
        const isCombo2Active = combo2Order.includes(activeStep);
        
        if (isCombo1Active) {
          const activeIdx = combo1Order.indexOf(activeStep);
          const currentIdx = combo1Order.indexOf(stepKey);
          if (activeIdx !== -1 && currentIdx > activeIdx) {
            return "pending";
          }
        } else if (isCombo2Active) {
          const activeIdx = combo2Order.indexOf(activeStep);
          const currentIdx = combo2Order.indexOf(stepKey);
          if (activeIdx !== -1 && currentIdx > activeIdx) {
            return "pending";
          }
        }
      }
    }
    
    return "idle";
  };

  const renderTabStatusBanner = (stepKey: StepKey, customMessage?: string) => {
    const status = getStepUIStatus(stepKey);
    if (status === "idle" || status === "success" || status === "failed") return null;
    
    const isRunning = status === "running";
    
    const stepNames: Record<StepKey, string> = {
      story_analyzer: "Phân tích câu chuyện (Story Analyzer)",
      character_extractor: "Trích xuất Nhân vật (Character Extractor)",
      environment_extractor: "Trích xuất Bối cảnh (Environment Extractor)",
      prop_extractor: "Trích xuất Đạo cụ (Prop Extractor)",
      shot_planner: "Shot Prompt Generator",
      keyframe_generator: "Tạo Prompt Keyframe",
      motion_generator: "Tạo mô tả chuyển động Video"
    };
    
    const stepName = stepNames[stepKey] || stepKey;
    const msg = customMessage || (isRunning 
      ? `Đang chạy phân tích ${stepName}, vui lòng chờ...` 
      : `Đang chờ đến lượt tạo ${stepName} trong Combo tự động...`);
      
    return (
      <div
        className="glass-panel"
        style={{
          padding: "12px 20px",
          marginBottom: "16px",
          background: isRunning 
            ? "rgba(6, 182, 212, 0.06)" 
            : "rgba(139, 92, 246, 0.04)",
          border: isRunning
            ? "1px solid rgba(6, 182, 212, 0.2)"
            : "1px solid rgba(139, 92, 246, 0.15)",
          borderLeft: isRunning
            ? "4px solid var(--accent-cyan)"
            : "4px solid var(--accent-purple)",
          borderRadius: "6px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          animation: isRunning ? "pulse 2s infinite" : "none",
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            backgroundColor: isRunning ? "var(--accent-cyan)" : "var(--accent-purple)",
            boxShadow: isRunning ? "0 0 8px var(--accent-cyan)" : "none",
          }}
        />
        <span style={{ fontSize: "0.85rem", fontWeight: 600, color: isRunning ? "#06b6d4" : "#a78bfa" }}>
          {msg}
        </span>
      </div>
    );
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#080c14", color: "#f3f4f6" }}>
      {/* Top Header Panel */}
      <header
        style={{
          background: "#0d1321",
          borderBottom: "1px solid var(--border-color)",
          padding: "12px 24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          position: "sticky",
          top: 0,
          zIndex: 10,
          height: "65px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          {/* Logo Brand */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "8px",
                background: "linear-gradient(135deg, #a78bfa, #06b6d4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 15px rgba(139, 92, 246, 0.4)",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
            </div>
            <h1 style={{ fontSize: "1.1rem", fontWeight: 800, letterSpacing: "0.03em", color: "#ffffff" }}>
              TOOL MANGA ANIME PRO
            </h1>
          </div>

          {/* Project Title Editor */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", paddingLeft: "16px", borderLeft: "1px solid rgba(255,255,255,0.08)" }}>
            <span style={{ fontSize: "0.9rem", color: "var(--text-secondary)", fontWeight: 500 }}>
              {activeProjectName}
            </span>
            <button
              onClick={handleSaveNamedProject}
              title="Save Project"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--text-muted)",
                display: "flex",
                alignItems: "center",
                padding: "4px"
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = "#ffffff"}
              onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-muted)"}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
            </button>
            <button
              onClick={handleExportZip}
              title="Export project as ZIP"
              disabled={projectData.scenes.length === 0}
              style={{
                background: "transparent",
                border: "none",
                cursor: projectData.scenes.length === 0 ? "not-allowed" : "pointer",
                color: "var(--text-muted)",
                display: "flex",
                alignItems: "center",
                padding: "4px",
                opacity: projectData.scenes.length === 0 ? 0.3 : 1
              }}
              onMouseEnter={(e) => { if (projectData.scenes.length > 0) e.currentTarget.style.color = "#ffffff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
            </button>
            <button
              onClick={handleExportJsonPrompts}
              title="Xuất JSON Prompts"
              disabled={projectData.shots.length === 0}
              style={{
                background: "transparent",
                border: "none",
                cursor: projectData.shots.length === 0 ? "not-allowed" : "pointer",
                color: "var(--text-muted)",
                display: "flex",
                alignItems: "center",
                padding: "4px",
                opacity: projectData.shots.length === 0 ? 0.3 : 1
              }}
              onMouseEnter={(e) => { if (projectData.shots.length > 0) e.currentTarget.style.color = "#ffffff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: "2px" }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </button>
            <button
              onClick={handleScanPcAssets}
              title="Quét Assets từ thư mục PC"
              disabled={!projectData.pcDirectory}
              style={{
                background: "transparent",
                border: "none",
                cursor: !projectData.pcDirectory ? "not-allowed" : "pointer",
                color: "var(--text-muted)",
                display: "flex",
                alignItems: "center",
                padding: "4px",
                opacity: !projectData.pcDirectory ? 0.3 : 1
              }}
              onMouseEnter={(e) => { if (projectData.pcDirectory) e.currentTarget.style.color = "#ffffff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 4v6h-6"/>
                <path d="M1 20v-6h6"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Right Header Panel */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {/* Model Status */}
          <div
            style={{
              background: "#080c14",
              border: "1px solid var(--border-color)",
              padding: "6px 12px",
              borderRadius: "20px",
              fontSize: "0.8rem",
              fontWeight: 500,
              color: "var(--text-secondary)",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span style={{ color: "#a78bfa", fontWeight: 700 }}>Google Gemini</span>
            <span style={{ color: "rgba(255, 255, 255, 0.15)" }}>|</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>{selectedModel}</span>
          </div>

          {/* Settings Button */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="sidebar-btn-new"
            style={{
              padding: "8px 16px",
              fontSize: "0.85rem",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "rgba(139, 92, 246, 0.9)",
              boxShadow: "0 0 12px rgba(139, 92, 246, 0.3)"
            }}
          >
            <IconSettings />
            Settings
          </button>
        </div>
      </header>

      {/* Main Layout Body */}
      <div style={{ display: "flex", flexGrow: 1 }}>
        {/* Left Sidebar */}
        <aside className="sidebar-container">
          <button
            onClick={handleNewProject}
            className="sidebar-btn-new"
            style={{ width: "100%" }}
          >
            <span style={{ fontSize: "1.2rem", lineHeight: 0 }}>+</span> New Project
          </button>

          <button
            onClick={() => {
              const fileInput = document.createElement("input");
              fileInput.type = "file";
              fileInput.accept = ".json";
              fileInput.onchange = async (e: any) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const text = await file.text();
                try {
                  const data = JSON.parse(text);
                  if (data.storyboard !== undefined && data.projectData !== undefined) {
                    const projectId = `project_${Date.now()}`;
                    const importedProj: SavedProject = {
                      id: projectId,
                      name: file.name.replace(".json", ""),
                      updatedAt: new Date().toISOString(),
                      storyboard: data.storyboard,
                      projectData: data.projectData,
                      steps: data.steps || INITIAL_STEPS,
                      model: data.model,
                      selectedStyle: data.selectedStyle,
                      styleDescription: data.styleDescription,
                      workflowMode: data.workflowMode,
                    };
                    await saveProject(importedProj);
                    await refreshProjectsList();
                    handleLoadProject(projectId);
                    alert("Project imported successfully!");
                  } else {
                    alert("Invalid project JSON structure.");
                  }
                } catch (err: any) {
                  alert(`Import failed: ${err.message}`);
                }
              };
              fileInput.click();
            }}
            className="sidebar-btn-import"
            style={{ width: "100%" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M12 3v12M8 11l4 4 4-4"/>
            </svg>
            Import
          </button>

          <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.06)", margin: "4px 0" }} />

          <h3 className="sidebar-section-title">
            PROJECTS HISTORY ({projectsList.length})
          </h3>

          {/* Scrollable list of project items */}
          <div className="project-list">
            {projectsList.map((p) => (
              <div
                key={p.id}
                onClick={() => handleLoadProject(p.id)}
                className={`project-item ${activeProjectId === p.id ? "active" : ""}`}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                  <span className="project-item-title" style={{ wordBreak: "break-word" }}>
                    {p.name}
                  </span>
                  <button
                    onClick={(e) => handleDeleteProject(p.id, p.name, e)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "rgba(239,68,68,0.5)",
                      cursor: "pointer",
                      padding: "2px",
                      borderRadius: "4px"
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.color = "rgba(239,68,68,1)"}
                    onMouseLeave={(e) => e.currentTarget.style.color = "rgba(239,68,68,0.5)"}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </div>
                <div className="project-item-meta">
                  <span>
                    {new Date(p.updatedAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                    {" "}
                    {new Date(p.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="project-item-pill">
                    {(p.model || "gemini-3.5-flas").slice(0, 15)}
                  </span>
                </div>
              </div>
            ))}

            {projectsList.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.8rem", marginTop: "20px" }}>
                No saved projects.
              </div>
            )}
          </div>
        </aside>

        {/* Right Main workspace */}
        <main style={{ flexGrow: 1, padding: "24px 32px", overflowY: "auto", display: "flex", flexDirection: "column" }}>
          {/* Top Tabs Horizontal Bar */}
          <div className="tabs-bar">
            <button
              onClick={() => { setActiveTab("cauhinh"); }}
              className={`tab-btn ${activeTab === "cauhinh" ? "active" : ""}`}
              style={{ color: getTabColor("cauhinh") }}
            >
              <IconConfig />
              1. Cấu hình dự án
            </button>
            <button
              onClick={() => { setActiveTab("assets"); }}
              className={`tab-btn ${activeTab === "assets" ? "active" : ""}`}
              style={{ color: getTabColor("assets") }}
            >
              <IconFolder />
              2. Lọc Assets
            </button>
            <button
              onClick={() => { setActiveTab("shots"); }}
              className={`tab-btn ${activeTab === "shots" ? "active" : ""}`}
              style={{ color: getTabColor("shots") }}
            >
              <IconImage />
              3. Image Shots
            </button>
            <button
              onClick={() => { setActiveTab("video"); }}
              className={`tab-btn ${activeTab === "video" ? "active" : ""}`}
              style={{ color: getTabColor("video") }}
            >
              <IconFilm />
              4. Tạo video
            </button>
            <button
              onClick={() => { setActiveTab("rapphim"); }}
              className={`tab-btn ${activeTab === "rapphim" ? "active" : ""}`}
              style={{ color: getTabColor("rapphim") }}
            >
              <IconCinema />
              5. Rạp phim
            </button>
          </div>

          {/* Active Tab View Body */}
          <div style={{ display: "flex", gap: "24px", flexGrow: 1, alignItems: "stretch" }}>
            {/* View container */}
            <div style={{ flexGrow: 1, display: "flex", flexDirection: "column" }}>
              
              {/* TAB 1: CẤU HÌNH DỰ ÁN */}
              {activeTab === "cauhinh" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "24px", alignItems: "stretch" }}>
                  {/* Left Column Config */}
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <div style={{ marginBottom: "20px" }}>
                      <h2 style={{ fontSize: "1.6rem", fontWeight: 800, marginBottom: "4px", color: "#ffffff" }}>
                        Cấu hình dự án
                      </h2>
                      <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                        Thiết lập cấu hình dự án, tải phụ đề SRT và thực hiện các tác vụ tạo phân cảnh, vẽ ảnh.
                      </p>
                    </div>
                    {activeStep && renderTabStatusBanner(activeStep)}

                    {/* PC Directory Settings Card */}
                    <div className="glass-panel" style={{ padding: "16px 20px", marginBottom: "20px", background: "rgba(124, 58, 237, 0.04)", border: "1px solid rgba(124, 58, 237, 0.2)", borderRadius: "10px" }}>
                      <span style={{ fontSize: "0.7rem", color: "#a78bfa", fontWeight: 700, letterSpacing: "0.05em", display: "block", marginBottom: "8px" }}>
                        💾 THƯ MỤC LƯU TRỮ DỰ ÁN TRÊN MÁY TÍNH (PC)
                      </span>
                      
                      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                        <input
                          type="text"
                          value={projectData.pcDirectory || ""}
                          onChange={(e) => handleManualPcDirectoryChange(e.target.value)}
                          onBlur={(e) => handleManualPcDirectoryBlur(e.target.value)}
                          placeholder="Nhập hoặc dán đường dẫn thư mục PC tại đây (ví dụ: D:\KidsProjects)..."
                          className="custom-input"
                          style={{ flexGrow: 1, padding: "8px 12px", fontSize: "0.85rem", background: "rgba(0,0,0,0.3)" }}
                        />
                        <button
                          onClick={handleSelectPcDirectory}
                          className="btn-primary"
                          style={{
                            padding: "8px 16px",
                            fontSize: "0.8rem",
                            borderRadius: "6px",
                            background: "linear-gradient(135deg, #7c3aed, #db2777)",
                            border: "none",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                            fontWeight: 600
                          }}
                        >
                          📂 Chọn thư mục
                        </button>
                        {projectData.pcDirectory && (
                          <button
                            onClick={handleScanPcAssets}
                            className="btn-primary"
                            style={{
                              padding: "8px 16px",
                              fontSize: "0.8rem",
                              borderRadius: "6px",
                              background: "linear-gradient(135deg, #10b981, #059669)",
                              border: "none",
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                              fontWeight: 600,
                              boxShadow: "0 0 10px rgba(16, 185, 129, 0.2)"
                            }}
                          >
                            🔍 Quét Assets
                          </button>
                        )}
                      </div>
                      
                      {projectData.pcDirectory ? (
                        <span style={{ fontSize: "0.72rem", color: "#34d399", display: "block", marginTop: "8px" }}>
                          ✓ Thư mục hợp lệ. Đã tự động khởi tạo các thư mục: <code style={{ color: "#ffffff" }}>/images_shots</code>, <code style={{ color: "#ffffff" }}>/references</code>, <code style={{ color: "#ffffff" }}>/videos</code>.
                        </span>
                      ) : (
                        <span style={{ fontSize: "0.72rem", color: "#f87171", display: "block", marginTop: "8px" }}>
                          ⚠ Bạn phải cấu hình thư mục lưu trước khi khởi chạy các tính năng tạo ảnh hoặc render phim.
                        </span>
                      )}
                    </div>

                    {/* Combos Grid */}
                    <div className="combo-grid">
                      {/* Combo 1 */}
                      <div className="combo-card">
                        <div>
                          <div className="combo-badge">Combo 1</div>
                          <h4 className="combo-title" style={{ marginTop: "10px", marginBottom: "4px" }}>
                            Combo 1: Tạo Prompt
                          </h4>
                          <p className="combo-desc">
                            Lập sơ đồ phân cảnh và tạo các prompt mô tả vẽ ảnh (Mapping & Prompts)
                          </p>
                        </div>
                        <button
                          onClick={runCombo1}
                          disabled={isRunningAll || activeStep !== null}
                          className="combo-btn"
                        >
                          {activeStep === "story_analyzer" ? "Đang chạy..." : "Chạy"}
                        </button>
                      </div>

                      {/* Combo 2 */}
                      <div className="combo-card">
                        <div>
                          <div className="combo-badge">Combo 2</div>
                          <h4 className="combo-title" style={{ marginTop: "10px", marginBottom: "4px" }}>
                            Combo 2: Prompt + Ảnh tham chiếu
                          </h4>
                          <p className="combo-desc">
                            Tạo lập bối cảnh phim, sinh prompt mô tả và vẽ ảnh tham chiếu (Assets)
                          </p>
                        </div>
                        <button
                          onClick={runCombo2}
                          disabled={isRunningAll || activeStep !== null}
                          className="combo-btn"
                        >
                          {["character_extractor", "environment_extractor", "prop_extractor"].includes(activeStep || "") ? "Đang chạy..." : "Chạy"}
                        </button>
                      </div>

                      {/* Combo 3 (FULL) */}
                      <div className="combo-card-full">
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div className="combo-badge">Combo 3 (Full)</div>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5">
                              <path d="m12 3-1.912 5.886L4.2 9l5.888 1.914L12 21l1.912-5.886L20 15l-5.888-1.914L12 3Z"/>
                            </svg>
                          </div>
                          <h4 className="combo-title" style={{ marginTop: "10px", marginBottom: "4px", color: "#ffffff" }}>
                            Combo 3: Tự động toàn bộ
                          </h4>
                          <p className="combo-desc">
                            Chạy tự động: Sinh Voice/SRT → Phân cảnh → Prompt → Ảnh tham chiếu → Ảnh Shots → Video → Xuất video .mp4
                          </p>
                        </div>
                        <button
                          onClick={handleRunAllPipeline}
                          disabled={isRunningAll || activeStep !== null}
                          className="combo-btn"
                        >
                          {isRunningAll ? "Đang chạy..." : "Chạy"}
                        </button>
                      </div>
                    </div>

                    {/* Workflow Mode Selector Title */}
                    <div className="workflow-section-title" style={{ marginTop: "24px", marginBottom: "12px", fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.05em" }}>
                      CHỌN TIẾN TRÌNH LÀM VIỆC (WORKFLOW)
                    </div>

                    {/* Workflow Selectors */}
                    <div className="workflow-selector">
                      <button
                        onClick={() => {
                          setWorkflowMode("srt_existing");
                          if (!storyboard.trim() || storyboard === SAMPLE_SCRIPT_AUTO) {
                            setStoryboard(SAMPLE_SRT);
                          }
                        }}
                        className={`workflow-btn ${workflowMode === "srt_existing" ? "active" : ""}`}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14 2 14 8 20 8"/>
                          <line x1="16" y1="13" x2="8" y2="13"/>
                          <line x1="16" y1="17" x2="8" y2="17"/>
                          <polyline points="10 9 9 9 8 9"/>
                        </svg>
                        Chế độ 1: Phụ đề SRT sẵn có
                      </button>

                      <button
                        onClick={() => {
                          setWorkflowMode("script_auto");
                          if (!storyboard.trim() || storyboard === SAMPLE_SRT) {
                            setStoryboard(SAMPLE_SCRIPT_AUTO);
                          }
                        }}
                        className={`workflow-btn ${workflowMode === "script_auto" ? "active" : ""}`}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                          <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
                        </svg>
                        Chế độ 2: Sinh Voice & SRT tự động từ kịch bản
                      </button>
                    </div>

                    {/* Subtitle / Script input Panel */}
                    <div className="style-panel" style={{ flexGrow: 1, marginTop: "16px" }}>
                      <div className="panel-header">
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2.2">
                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
                          </svg>
                          <h4 style={{ fontSize: "0.9rem", fontWeight: 700 }}>
                            {workflowMode === "script_auto"
                              ? "Sinh Phụ đề & Giọng đọc tự động từ Kịch bản"
                              : "Nội dung phụ đề SRT sẵn có"}
                          </h4>
                        </div>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            onClick={() => setStoryboard(workflowMode === "script_auto" ? SAMPLE_SCRIPT_AUTO : SAMPLE_SRT)}
                            className="btn-secondary"
                            style={{ padding: "4px 8px", fontSize: "0.7rem", borderRadius: "4px" }}
                          >
                            Sample
                          </button>
                          <button
                            onClick={handleClearStoryboard}
                            className="btn-secondary"
                            style={{ padding: "4px 8px", fontSize: "0.7rem", borderRadius: "4px", color: "var(--danger)" }}
                          >
                            Xóa
                          </button>
                        </div>
                      </div>

                      <div style={{ position: "relative", flexGrow: 1, display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "6px", display: "block" }}>
                          {workflowMode === "script_auto"
                            ? "NỘI DUNG KỊCH BẢN (MỖI DÒNG LÀ 1 CÂU THOẠI)"
                            : "NỘI DUNG SRT SUBTITLE"}
                          {` (${storyboard.trim() ? storyboard.split("\n").filter(l => l.trim()).length : 0} dòng)`}
                        </span>

                        <textarea
                          value={storyboard}
                          onChange={(e) => handleStoryboardChange(e.target.value)}
                          placeholder={
                            workflowMode === "script_auto"
                              ? "Nhập kịch bản tại đây...\nVí dụ:\nScene 1 (6s)\nLisa vẫy tay chào..."
                              : "Nhập tệp phụ đề SRT tại đây...\nVí dụ:\n1\n00:00:00,000 --> 00:00:06,000\nLisa vẫy tay..."
                          }
                          className="custom-textarea"
                          style={{ minHeight: "180px", flexGrow: 1, fontFamily: "var(--font-sans)" }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Right Column Style Panel */}
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <div className="style-panel" style={{ height: "100%" }}>
                      <div className="panel-header">
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="2.2">
                            <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"/>
                            <path d="M7.5 10.5C8.32843 10.5 9 9.82843 9 9C9 8.17157 8.32843 7.5 7.5 7.5C6.67157 7.5 6 8.17157 6 9C6 9.82843 6.67157 10.5 7.5 10.5Z"/>
                            <path d="M11.5 7.5C12.3284 7.5 13 6.82843 13 6C13 5.17157 12.3284 4.5 11.5 4.5C10.6716 4.5 10 5.17157 10 6C10 6.82843 10.6716 7.5 11.5 7.5Z"/>
                            <path d="M16.5 9.5C17.3284 9.5 18 8.82843 18 8C18 7.17157 17.3284 6.5 16.5 6.5C15.6716 6.5 15 7.17157 15 8C15 8.82843 15.6716 9.5 16.5 9.5Z"/>
                            <path d="M6 15C6 15 7.5 13.5 10 13.5C12.5 13.5 13 15 15.5 15C18 15 19 13.5 19 13.5"/>
                          </svg>
                          <h4 style={{ fontSize: "0.9rem", fontWeight: 700 }}>Style vẽ ảnh</h4>
                        </div>
                        <button
                          onClick={() => alert(`Preset Styles: Manga Color, Anime Sketch, Watercolor Pixar, Cinematic Studio.`)}
                          className="btn-secondary"
                          style={{ padding: "4px 8px", fontSize: "0.7rem", borderRadius: "4px" }}
                        >
                          Quản lý
                        </button>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>CHỌN PHONG CÁCH VẼ (STYLE)</span>
                        <select
                          value={selectedStyle}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSelectedStyle(val);
                            const matched = DRAWING_STYLES.find(s => s.name === val);
                            if (matched) setStyleDescription(matched.description);
                          }}
                          className="custom-select"
                        >
                          {DRAWING_STYLES.map((s, idx) => (
                            <option key={idx} value={s.name}>{s.name}</option>
                          ))}
                        </select>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "6px", flexGrow: 1, marginTop: "8px" }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>MÔ TẢ STYLE HIỆN TẠI</span>
                        <textarea
                          value={styleDescription}
                          onChange={(e) => setStyleDescription(e.target.value)}
                          className="custom-textarea"
                          style={{ flexGrow: 1, minHeight: "180px" }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: LỌC ASSETS */}
              {activeTab === "assets" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                    <div>
                      <h2 style={{ fontSize: "1.4rem", fontWeight: 800, marginBottom: "4px" }}>
                        Lọc Assets
                      </h2>
                      <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                        Lọc và quản lý Phân cảnh, Nhân vật, Bối cảnh và Đạo cụ của dự án.
                      </p>
                    </div>

                    {/* Sub tabs for Lọc Assets */}
                    <div style={{ display: "flex", gap: "8px", background: "#0b0f19", padding: "4px", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                      <button
                        onClick={() => { setAssetSubTab("scenes"); }}
                        style={{
                          background: assetSubTab === "scenes" ? "rgba(139,92,246,0.15)" : "transparent",
                          color: assetSubTab === "scenes" ? "#a78bfa" : "var(--text-secondary)",
                          border: "none", padding: "6px 12px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer"
                        }}
                      >
                        🎬 Phân cảnh ({projectData.scenes.length})
                      </button>
                      <button
                        onClick={() => { setAssetSubTab("characters"); }}
                        style={{
                          background: assetSubTab === "characters" ? "rgba(139,92,246,0.15)" : "transparent",
                          color: assetSubTab === "characters" ? "#a78bfa" : "var(--text-secondary)",
                          border: "none", padding: "6px 12px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer"
                        }}
                      >
                        👥 Nhân vật ({projectData.characters.length})
                      </button>
                      <button
                        onClick={() => { setAssetSubTab("environments"); }}
                        style={{
                          background: assetSubTab === "environments" ? "rgba(139,92,246,0.15)" : "transparent",
                          color: assetSubTab === "environments" ? "#a78bfa" : "var(--text-secondary)",
                          border: "none", padding: "6px 12px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer"
                        }}
                      >
                        🌄 Bối cảnh ({projectData.environments.length})
                      </button>
                      <button
                        onClick={() => { setAssetSubTab("props"); }}
                        style={{
                          background: assetSubTab === "props" ? "rgba(139,92,246,0.15)" : "transparent",
                          color: assetSubTab === "props" ? "#a78bfa" : "var(--text-secondary)",
                          border: "none", padding: "6px 12px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer"
                        }}
                      >
                        🎒 Đạo cụ ({projectData.props.length})
                      </button>
                    </div>
                  </div>

                  {/* Batch Action Buttons for Assets */}
                  {assetSubTab !== "scenes" && (
                    <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "16px", padding: "12px", background: "rgba(255,255,255,0.02)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", fontWeight: 600 }}>Hành động hàng loạt:</span>
                      <button
                        onClick={() => handleGenerateAllAssetImages(false)}
                        disabled={isGeneratingBatch || activeStep !== null || isRunningAll}
                        className="btn-primary"
                        style={{ padding: "6px 12px", fontSize: "0.75rem", borderRadius: "4px" }}
                      >
                        🎨 Tạo tất cả ảnh tham chiếu
                      </button>
                      <button
                        onClick={() => handleGenerateAllAssetImages(true)}
                        disabled={isGeneratingBatch || activeStep !== null || isRunningAll}
                        className="btn-secondary"
                        style={{ padding: "6px 12px", fontSize: "0.75rem", borderRadius: "4px" }}
                      >
                        🎨 Tạo ảnh chưa được tạo
                      </button>
                      {isGeneratingBatch && (
                        <button
                          onClick={handleStopDrawing}
                          className="btn-secondary"
                          style={{ padding: "6px 12px", fontSize: "0.75rem", borderRadius: "4px", color: "var(--danger)", borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)" }}
                        >
                          🛑 Dừng vẽ
                        </button>
                      )}
                    </div>
                  )}

                  {/* SUB TAB: Phân cảnh (Scenes) */}
                  {assetSubTab === "scenes" && (
                    <div>
                      {renderTabStatusBanner("story_analyzer")}
                      {projectData.scenes.length === 0 ? (
                        <div style={{ padding: "40px", textAlign: "center", border: "1px dashed var(--border-color)", borderRadius: "var(--border-radius-lg)" }}>
                          <span style={{ display: "block", color: "var(--text-muted)", marginBottom: "16px" }}>
                            Chưa có dữ liệu phân cảnh. Vui lòng chạy Story Analyzer (Combo 1) trước.
                          </span>
                          <button
                            onClick={runCombo1}
                            disabled={activeStep !== null || isRunningAll}
                            className="sidebar-btn-new"
                            style={{ margin: "0 auto", opacity: (activeStep !== null || isRunningAll) ? 0.5 : 1, cursor: (activeStep !== null || isRunningAll) ? "not-allowed" : "pointer" }}
                          >
                            Phân tích kịch bản
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px" }}>
                          {projectData.scenes.map((scene: any, idx) => (
                            <div key={idx} className="glass-panel" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa", padding: "2px 8px", borderRadius: "4px", fontSize: "0.75rem", fontWeight: 700 }}>
                                  Scene {scene.scene_id}
                                </span>
                                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                  Thời lượng: {scene.duration_seconds}s
                                </span>
                              </div>

                              <div style={{ fontSize: "0.85rem" }}>
                                <strong style={{ color: "#ffffff" }}>Bối cảnh:</strong>{" "}
                                <span style={{ color: "#06b6d4" }}>{scene.setting}</span>
                              </div>

                              <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                                <strong style={{ color: "#ffffff" }}>Mô tả:</strong> {scene.description}
                              </div>

                              {scene.dialogues && scene.dialogues.length > 0 && (
                                <div style={{ marginTop: "8px", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "8px" }}>
                                  <strong style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>
                                    HỘI THOẠI:
                                  </strong>
                                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                    {scene.dialogues.map((d: any, dIdx: number) => (
                                      <div key={dIdx} style={{ fontSize: "0.8rem", fontStyle: "italic" }}>
                                        <span style={{ color: "#c084fc", fontWeight: 600 }}>{d.character}:</span>{" "}
                                        <span style={{ color: "var(--text-primary)" }}>"{d.text}"</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* SUB TAB: Nhân vật */}
                  {assetSubTab === "characters" && (
                    <div>
                      {renderTabStatusBanner("character_extractor")}
                      {projectData.characters.length === 0 ? (
                        <div style={{ padding: "40px", textAlign: "center", border: "1px dashed var(--border-color)", borderRadius: "var(--border-radius-lg)" }}>
                          <span style={{ display: "block", color: "var(--text-muted)", marginBottom: "16px" }}>
                            Chưa trích xuất nhân vật. Vui lòng chạy Combo 2 hoặc Character Extractor.
                          </span>
                          <button
                            onClick={() => handleRunStep("character_extractor")}
                            disabled={activeStep !== null || isRunningAll}
                            className="sidebar-btn-new"
                            style={{ margin: "0 auto", opacity: (activeStep !== null || isRunningAll) ? 0.5 : 1, cursor: (activeStep !== null || isRunningAll) ? "not-allowed" : "pointer" }}
                          >
                            Trích xuất nhân vật
                          </button>
                        </div>
                      ) : (
                        <div>
                          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginBottom: "16px" }}>
                            <button
                              onClick={() => {
                                const input = document.createElement("input");
                                input.type = "file";
                                input.accept = ".json";
                                input.onchange = (e: any) => {
                                  const file = e.target.files[0];
                                  if (!file) return;
                                  const reader = new FileReader();
                                  reader.onload = async (evt: any) => {
                                    try {
                                      const imported = JSON.parse(evt.target.result);
                                      if (!Array.isArray(imported)) {
                                        alert("File JSON không hợp lệ. Phải là một danh sách các nhân vật.");
                                        return;
                                      }

                                      // Update in DB and State using our isolated DB helper
                                      await updateProjectDataInDb(activeProjectId, (prevData) => {
                                        const copy = { ...prevData };
                                        const existingCharacters = [...copy.characters];
                                        
                                        imported.forEach((importedChar: any, index: number) => {
                                          const charName = importedChar["tên nhân vật"] || importedChar.name;
                                          if (!charName) return;

                                          const existingIdx = existingCharacters.findIndex(c => c.name.toLowerCase() === charName.toLowerCase());
                                          const mappedChar = {
                                            id: importedChar.id || (existingIdx !== -1 ? existingCharacters[existingIdx].id : `char_${Date.now()}_${index}_${Math.random().toString(36).substring(2, 5)}`),
                                            name: charName,
                                            turnaround_prompt: importedChar.propmt || importedChar.prompt || (existingIdx !== -1 ? existingCharacters[existingIdx].turnaround_prompt : ""),
                                            media_id: importedChar.media_id || (existingIdx !== -1 ? existingCharacters[existingIdx].media_id : ""),
                                            audioReferenceMediaIds: importedChar.audioReferenceMediaIds || (existingIdx !== -1 ? existingCharacters[existingIdx].audioReferenceMediaIds : []),
                                            url: existingIdx !== -1 ? existingCharacters[existingIdx].url : ""
                                          };

                                          if (existingIdx !== -1) {
                                            existingCharacters[existingIdx] = {
                                              ...existingCharacters[existingIdx],
                                              ...mappedChar
                                            };
                                          } else {
                                            existingCharacters.push(mappedChar);
                                          }
                                        });

                                        copy.characters = existingCharacters;
                                        return copy;
                                      });

                                      queueManager.addLog(`Đã nhập JSON nhân vật thành công!`, "success", activeProjectId);
                                      alert(`Đã nhập dữ liệu cho ${imported.length} nhân vật thành công!`);
                                    } catch (err: any) {
                                      alert(`Lỗi khi đọc file JSON: ${err.message}`);
                                    }
                                  };
                                  reader.readAsText(file);
                                };
                                input.click();
                              }}
                              className="btn-secondary"
                              style={{ padding: "6px 12px", fontSize: "0.75rem", borderRadius: "4px" }}
                            >
                              📤 Nhập JSON nhân vật
                            </button>

                            <button
                              onClick={() => {
                                const exportData = projectData.characters.map((c: any, index: number) => ({
                                  id: c.id || `char_${index + 1}`,
                                  "tên nhân vật": c.name,
                                  "propmt": c.turnaround_prompt || "",
                                  media_id: c.media_id || "",
                                  audioReferenceMediaIds: c.audioReferenceMediaIds || []
                                }));
                                const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = `${activeProjectName.replace(/\s+/g, "_")}_Characters.json`;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                URL.revokeObjectURL(url);
                              }}
                              className="btn-primary"
                              style={{ padding: "6px 12px", fontSize: "0.75rem", borderRadius: "4px" }}
                            >
                              📥 Xuất JSON nhân vật
                            </button>
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "20px" }}>
                            {projectData.characters.map((char: any, idx) => {
                              const hasImg = !!(char.url && !char.url.startsWith("mock_"));
                              const isGen = generatingAssetIds[`char_${char.name}`];
                              return (
                                <div key={idx} className="glass-panel" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                                  <div style={{ aspectRatio: "16/9", position: "relative", background: "#060910", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    {isGen ? (
                                      renderMediaLoader(isGen, "Vẽ nhân vật...")
                                    ) : hasImg ? (
                                      <div style={{ width: "100%", height: "100%", position: "relative" }}>
                                        <img
                                          src={char.url}
                                          alt={char.name}
                                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                        />
                                        {renderImageActionToolbar(char.url, `character_${char.name}.png`, () => triggerGenerateAssetImage(`char_${char.name}`))}
                                      </div>
                                    ) : (
                                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                                        <span style={{ fontSize: "2rem" }}>👤</span>
                                        <button
                                          onClick={() => triggerGenerateAssetImage(`char_${char.name}`)}
                                          disabled={activeStep !== null || isRunningAll}
                                          className="btn-primary"
                                          style={{ padding: "6px 12px", fontSize: "0.75rem", borderRadius: "4px" }}
                                        >
                                          Tạo
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                                  <h4 style={{ color: "#a78bfa", fontSize: "0.95rem", fontWeight: 700 }}>{char.name}</h4>
                                  <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>TURNAROUND PROMPT:</span>
                                  <textarea
                                    value={char.turnaround_prompt}
                                    onChange={(e) => {
                                      const updated = [...projectData.characters];
                                      updated[idx].turnaround_prompt = e.target.value;
                                      handleUpdateStepData("character_extractor", updated);
                                    }}
                                    className="custom-textarea"
                                    style={{ minHeight: "65px", fontSize: "0.8rem", padding: "8px" }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* SUB TAB: Bối cảnh */}
                  {assetSubTab === "environments" && (
                    <div>
                      {renderTabStatusBanner("environment_extractor")}
                      {projectData.environments.length === 0 ? (
                        <div style={{ padding: "40px", textAlign: "center", border: "1px dashed var(--border-color)", borderRadius: "var(--border-radius-lg)" }}>
                          <span style={{ display: "block", color: "var(--text-muted)", marginBottom: "16px" }}>
                            Chưa trích xuất bối cảnh. Vui lòng chạy Combo 2 hoặc Environment Extractor.
                          </span>
                          <button
                            onClick={() => handleRunStep("environment_extractor")}
                            disabled={activeStep !== null || isRunningAll}
                            className="sidebar-btn-new"
                            style={{ margin: "0 auto", opacity: (activeStep !== null || isRunningAll) ? 0.5 : 1, cursor: (activeStep !== null || isRunningAll) ? "not-allowed" : "pointer" }}
                          >
                            Trích xuất bối cảnh
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "20px" }}>
                          {projectData.environments.map((env: any, idx) => {
                            const hasImg = !!(env.url && !env.url.startsWith("mock_"));
                            const isGen = generatingAssetIds[`env_${env.setting_name}`];
                            return (
                              <div key={idx} className="glass-panel" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                                <div style={{ aspectRatio: "16/9", position: "relative", background: "#060910", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    {isGen ? (
                                      renderMediaLoader(isGen, "Vẽ bối cảnh...")
                                    ) : hasImg ? (
                                      <div style={{ width: "100%", height: "100%", position: "relative" }}>
                                        <img
                                          src={env.url}
                                          alt={env.setting_name}
                                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                        />
                                        {renderImageActionToolbar(env.url, `env_${env.setting_name}.png`, () => triggerGenerateAssetImage(`env_${env.setting_name}`))}
                                      </div>
                                    ) : (
                                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                                        <span style={{ fontSize: "2rem" }}>🏞️</span>
                                        <button
                                          onClick={() => triggerGenerateAssetImage(`env_${env.setting_name}`)}
                                          disabled={activeStep !== null || isRunningAll}
                                          className="btn-primary"
                                          style={{ padding: "6px 12px", fontSize: "0.75rem", borderRadius: "4px" }}
                                        >
                                          Tạo
                                        </button>
                                      </div>
                                    )}
                                </div>
                                <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                                  <h4 style={{ color: "#06b6d4", fontSize: "0.95rem", fontWeight: 700 }}>{env.setting_name}</h4>
                                  <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>REFERENCE PROMPT:</span>
                                  <textarea
                                    value={env.reference_prompt}
                                    onChange={(e) => {
                                      const updated = [...projectData.environments];
                                      updated[idx].reference_prompt = e.target.value;
                                      handleUpdateStepData("environment_extractor", updated);
                                    }}
                                    className="custom-textarea"
                                    style={{ minHeight: "65px", fontSize: "0.8rem", padding: "8px" }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* SUB TAB: Đạo cụ */}
                  {assetSubTab === "props" && (
                    <div>
                      {renderTabStatusBanner("prop_extractor")}
                      {projectData.props.length === 0 ? (
                        <div style={{ padding: "40px", textAlign: "center", border: "1px dashed var(--border-color)", borderRadius: "var(--border-radius-lg)" }}>
                          <span style={{ display: "block", color: "var(--text-muted)", marginBottom: "16px" }}>
                            Chưa trích xuất đạo cụ. Vui lòng chạy Combo 2 hoặc Prop Extractor.
                          </span>
                          <button
                            onClick={() => handleRunStep("prop_extractor")}
                            disabled={activeStep !== null || isRunningAll}
                            className="sidebar-btn-new"
                            style={{ margin: "0 auto", opacity: (activeStep !== null || isRunningAll) ? 0.5 : 1, cursor: (activeStep !== null || isRunningAll) ? "not-allowed" : "pointer" }}
                          >
                            Trích xuất đạo cụ
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "20px" }}>
                          {projectData.props.map((prop: any, idx) => {
                            const hasImg = !!(prop.url && !prop.url.startsWith("mock_"));
                            const isGen = generatingAssetIds[`prop_${prop.prop_name}`];
                            return (
                              <div key={idx} className="glass-panel" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                                <div style={{ aspectRatio: "16/9", position: "relative", background: "#060910", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    {isGen ? (
                                      renderMediaLoader(isGen, "Vẽ đạo cụ...")
                                    ) : hasImg ? (
                                      <div style={{ width: "100%", height: "100%", position: "relative" }}>
                                        <img
                                          src={prop.url}
                                          alt={prop.prop_name}
                                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                        />
                                        {renderImageActionToolbar(prop.url, `prop_${prop.prop_name}.png`, () => triggerGenerateAssetImage(`prop_${prop.prop_name}`))}
                                      </div>
                                    ) : (
                                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                                        <span style={{ fontSize: "2rem" }}>🎒</span>
                                        <button
                                          onClick={() => triggerGenerateAssetImage(`prop_${prop.prop_name}`)}
                                          disabled={activeStep !== null || isRunningAll}
                                          className="btn-primary"
                                          style={{ padding: "6px 12px", fontSize: "0.75rem", borderRadius: "4px" }}
                                        >
                                          Tạo
                                        </button>
                                      </div>
                                    )}
                                </div>
                                <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                                  <h4 style={{ color: "#f59e0b", fontSize: "0.95rem", fontWeight: 700 }}>{prop.prop_name}</h4>
                                  <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>REFERENCE PROMPT:</span>
                                  <textarea
                                    value={prop.reference_prompt}
                                    onChange={(e) => {
                                      const updated = [...projectData.props];
                                      updated[idx].reference_prompt = e.target.value;
                                      handleUpdateStepData("prop_extractor", updated);
                                    }}
                                    className="custom-textarea"
                                    style={{ minHeight: "65px", fontSize: "0.8rem", padding: "8px" }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: IMAGE SHOTS */}
              {activeTab === "shots" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {renderTabStatusBanner("shot_planner")}
                  <div>
                    <h2 style={{ fontSize: "1.4rem", fontWeight: 800, marginBottom: "4px" }}>
                      Tạo ảnh Shots
                    </h2>
                    <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                      Lập kế hoạch phân cảnh góc quay (Shot Planner) và sinh prompt ảnh vẽ cho từng Shot.
                    </p>
                  </div>

                  {projectData.shots.length === 0 ? (
                    <div style={{ padding: "40px", textAlign: "center", border: "1px dashed var(--border-color)", borderRadius: "var(--border-radius-lg)" }}>
                      <span style={{ display: "block", color: "var(--text-muted)", marginBottom: "16px" }}>
                        Chưa lên kế hoạch camera shots. Vui lòng chạy Shot Planner (Step 5) trước.
                      </span>
                      <button
                        onClick={() => handleRunStep("shot_planner")}
                        disabled={activeStep !== null || isRunningAll}
                        className="sidebar-btn-new"
                        style={{ margin: "0 auto", opacity: (activeStep !== null || isRunningAll) ? 0.5 : 1, cursor: (activeStep !== null || isRunningAll) ? "not-allowed" : "pointer" }}
                      >
                        Lên kế hoạch camera
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                      {/* Batch Action Buttons for Shots */}
                      <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "16px", padding: "12px", background: "rgba(255,255,255,0.02)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
                        <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", fontWeight: 600 }}>Hành động hàng loạt:</span>
                        <button
                          onClick={() => handleRunStep("shot_planner")}
                          disabled={activeStep !== null || isRunningAll}
                          className="btn-primary"
                          style={{
                            padding: "6px 12px",
                            fontSize: "0.75rem",
                            borderRadius: "4px",
                            background: "rgba(168,85,247,0.2)",
                            border: "1px solid rgba(168,85,247,0.4)",
                            color: "#c084fc",
                            fontWeight: 600
                          }}
                        >
                          🔮 Sinh Prompts (Shot Planner)
                        </button>
                        <button
                          onClick={() => handleGenerateAllShotImages(false)}
                          disabled={isGeneratingBatch || activeStep !== null || isRunningAll}
                          className="btn-primary"
                          style={{ padding: "6px 12px", fontSize: "0.75rem", borderRadius: "4px" }}
                        >
                          🎨 Tạo tất cả các shots
                        </button>
                        <button
                          onClick={() => handleGenerateAllShotImages(true)}
                          disabled={isGeneratingBatch || activeStep !== null || isRunningAll}
                          className="btn-secondary"
                          style={{ padding: "6px 12px", fontSize: "0.75rem", borderRadius: "4px" }}
                        >
                          🎨 Tạo tất cả shots chưa tạo
                        </button>
                        <button
                          onClick={handleExportJsonPrompts}
                          disabled={activeStep !== null || isRunningAll}
                          className="btn-primary"
                          style={{
                            padding: "6px 12px",
                            fontSize: "0.75rem",
                            borderRadius: "4px",
                            background: "linear-gradient(135deg, #8b5cf6, #ec4899)",
                            border: "none",
                            cursor: "pointer",
                            fontWeight: 600,
                            boxShadow: "0 0 10px rgba(139, 92, 246, 0.2)"
                          }}
                        >
                          📥 Xuất JSON Prompts
                        </button>
                        {isGeneratingBatch && (
                          <button
                            onClick={handleStopDrawing}
                            className="btn-secondary"
                            style={{ padding: "6px 12px", fontSize: "0.75rem", borderRadius: "4px", color: "var(--danger)", borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)" }}
                          >
                            🛑 Dừng vẽ
                          </button>
                        )}
                      </div>

                      {projectData.shots.map((shot: any, idx) => {
                        const shotKey = `shot_${shot.scene_number || shot.scene_id || ''}_${shot.shot_id}`;
                        const keyframeObj = projectData.keyframes 
                          ? projectData.keyframes.find((k: any) => k.shot_id === shot.shot_id)
                          : null;
                        const keyframePrompt = keyframeObj?.keyframe_image_prompt || "";
                        const keyframeUrl = keyframeObj?.url || "";
                        const hasImg = !!(keyframeUrl && !keyframeUrl.startsWith("mock_"));
                        const isGen = generatingShotKeys[shotKey];

                        return (
                          <div key={idx} className="glass-panel" style={{ padding: "16px", display: "grid", gridTemplateColumns: "180px 1fr", gap: "16px", alignItems: "start" }}>
                            <div style={{ aspectRatio: "16/9", background: "#060910", borderRadius: "8px", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                               {isGen ? (
                                 renderMediaLoader(isGen, "Vẽ ảnh...")
                               ) : hasImg ? (
                                 <div style={{ width: "100%", height: "100%", position: "relative" }}>
                                   <img
                                     src={keyframeUrl}
                                     alt={`Scene ${shot.scene_id} - Shot ${shot.shot_id}`}
                                     style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                   />
                                   {renderImageActionToolbar(keyframeUrl, `shot_${shot.shot_id}.png`, () => triggerGenerateShotImage(shotKey))}
                                 </div>
                               ) : (
                                 <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                                   <button
                                     onClick={() => triggerGenerateShotImage(shotKey)}
                                     disabled={activeStep !== null || isRunningAll}
                                     className="btn-primary"
                                     style={{ padding: "4px 8px", fontSize: "0.7rem", borderRadius: "4px" }}
                                   >
                                     Tạo
                                   </button>
                                 </div>
                               )}
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <h4 style={{ color: "#a78bfa", fontSize: "0.9rem" }}>
                                  Scene {shot.scene_id} - Shot {String(shot.shot_id).replace('Shot', '')}
                                </h4>
                                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                  Camera: {shot.framing} | {shot.camera_movement}
                                </span>
                              </div>

                              <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                                <strong>Hành động:</strong> {shot.actions}
                              </p>

                              {keyframePrompt ? (
                                <div style={{ marginTop: "6px", background: "rgba(255,255,255,0.02)", padding: "8px", borderRadius: "4px", border: "1px solid rgba(255,255,255,0.04)" }}>
                                  <strong style={{ fontSize: "0.7rem", color: "#06b6d4", display: "block", marginBottom: "2px" }}>KEYFRAME IMAGE PROMPT:</strong>
                                  <p style={{ fontSize: "0.75rem", fontStyle: "italic", margin: 0 }}>{keyframePrompt}</p>
                                </div>
                              ) : (
                                <div style={{ marginTop: "6px", background: "rgba(255,255,255,0.01)", padding: "8px", borderRadius: "4px", border: "1px dashed rgba(255,255,255,0.04)" }}>
                                  <strong style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "block", marginBottom: "2px" }}>KEYFRAME IMAGE PROMPT:</strong>
                                  <p style={{ fontSize: "0.75rem", fontStyle: "italic", margin: 0, color: "var(--text-muted)" }}>Chưa sinh prompt</p>
                                </div>
                              )}

                              {/* Referenced Assets previews on segment */}
                              {(() => {
                                const refs = getReferencedAssetsForShot(shot);
                                if (refs.length === 0) return null;
                                return (
                                  <div style={{ marginTop: "16px", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "12px" }}>
                                    <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", display: "block", marginBottom: "8px", fontWeight: 700 }}>
                                      ASSETS THAM CHIẾU TRÊN SEGMENT:
                                    </span>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
                                      {refs.map((ref, refIdx) => {
                                        // Resolve asset info from projectData to check url or media_id
                                        let assetData = null;
                                        if (ref.type === "character") {
                                          assetData = projectData.characters.find(c => c.name.toLowerCase() === ref.name.toLowerCase());
                                        } else if (ref.type === "environment") {
                                          assetData = projectData.environments.find(e => e.setting_name.toLowerCase() === ref.name.toLowerCase());
                                        } else if (ref.type === "prop") {
                                          assetData = projectData.props.find(p => p.prop_name.toLowerCase() === ref.name.toLowerCase());
                                        }

                                        const hasAssetImg = !!(assetData?.url || assetData?.media_id) || mockGeneratedReferenceImages[ref.key];
                                        const isGen = !!generatingAssetIds[ref.key];
                                        const typeColor = ref.type === "character" ? "#a78bfa" : ref.type === "environment" ? "#06b6d4" : "#f59e0b";
                                        const typeLabel = ref.type === "character" ? "Nhân vật" : ref.type === "environment" ? "Bối cảnh" : "Đạo cụ";
                                        
                                        return (
                                          <div
                                            key={refIdx}
                                            style={{
                                              display: "flex",
                                              flexDirection: "column",
                                              width: "110px",
                                              padding: "6px",
                                              background: "rgba(255,255,255,0.01)",
                                              border: "1px solid rgba(255,255,255,0.03)",
                                              borderRadius: "6px",
                                              alignItems: "stretch",
                                              gap: "4px"
                                            }}
                                          >
                                            {/* Image Thumbnail Container */}
                                            <div
                                              style={{
                                                width: "100%",
                                                height: "55px",
                                                borderRadius: "4px",
                                                overflow: "hidden",
                                                background: "#060910",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                position: "relative",
                                                border: "1px solid rgba(255,255,255,0.02)"
                                              }}
                                            >
                                              {hasAssetImg ? (
                                                <>
                                                  <img
                                                    src={(assetData?.url) || getAssetImage(ref.name, ref.type)}
                                                    alt={ref.name}
                                                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                                  />
                                                  {assetData?.media_id && (
                                                    <span
                                                      style={{
                                                        position: "absolute",
                                                        top: "2px",
                                                        right: "2px",
                                                        fontSize: "0.55rem",
                                                        background: "#10b981",
                                                        color: "#ffffff",
                                                        padding: "1px 4px",
                                                        borderRadius: "2px",
                                                        fontWeight: 700
                                                      }}
                                                    >
                                                      ✓ ID
                                                    </span>
                                                  )}
                                                </>
                                              ) : (
                                                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: "100%", height: "100%" }}>
                                                  {isGen ? (
                                                    <span style={{ fontSize: "0.55rem", color: "var(--accent-cyan)" }}>Sinh...</span>
                                                  ) : (
                                                    <button
                                                      onClick={() => triggerGenerateAssetImage(ref.key)}
                                                      style={{
                                                        background: "transparent",
                                                        border: "none",
                                                        color: typeColor,
                                                        fontSize: "0.65rem",
                                                        cursor: "pointer",
                                                        textDecoration: "underline",
                                                        padding: 0
                                                      }}
                                                    >
                                                      Sinh ảnh
                                                    </button>
                                                  )}
                                                </div>
                                              )}
                                              
                                              {/* Mini type badge */}
                                              <span
                                                style={{
                                                  position: "absolute",
                                                  top: "2px",
                                                  left: "2px",
                                                  fontSize: "0.55rem",
                                                  background: "rgba(0,0,0,0.7)",
                                                  color: typeColor,
                                                  padding: "1px 3px",
                                                  borderRadius: "2px",
                                                  fontWeight: 700
                                                }}
                                              >
                                                {typeLabel}
                                              </span>
                                            </div>
                                            
                                            {/* Label */}
                                            <span
                                              style={{
                                                fontSize: "0.72rem",
                                                color: "#ffffff",
                                                fontWeight: 600,
                                                textAlign: "center",
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                whiteSpace: "nowrap"
                                              }}
                                              title={ref.name}
                                            >
                                              {ref.name}
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: TẠO VIDEO & RẠP PHIM */}
              {activeTab === "video" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                  {renderTabStatusBanner("shot_planner", "Đang phân cảnh & tạo mô tả chuyển động AI, vui lòng chờ...")}
                  {renderTabStatusBanner("motion_generator")}
                  {/* Tab Title */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                    <div>
                      <h2 style={{ fontSize: "1.4rem", fontWeight: 800, marginBottom: "4px" }}>
                        Tạo video & Rạp phim
                      </h2>
                      <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                        Cấu hình render video, quản lý motion prompts và tạo video cho từng phân đoạn camera.
                      </p>
                    </div>

                  </div>

                  {/* Unified Movie Player (If complete movie is rendered) */}
                  {isVideoGenerated && (
                    <div className="glass-panel" style={{ padding: "16px", background: "#0d1321" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                        <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#a78bfa" }}>🎬 XEM TRƯỚC TOÀN BỘ PHIM (CINEMATIC MOVIE)</span>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Thời lượng: {getCinemaMovieTotalDuration()}s | H.264 MP4</span>
                      </div>
                      
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: "16px", alignItems: "start" }}>
                        <div className="cinema-screen" style={{ width: "100%", aspectRatio: "16/9" }}>
                          <video
                            key={`movie-${activeProjectId}-${renderTimestamp}`}
                            ref={videoRef}
                            src={`/exports/${activeProjectId}.mp4?t=${renderTimestamp}`}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            onPlay={() => setIsPlaying(true)}
                            onPause={() => setIsPlaying(false)}
                            onDurationChange={(e) => setVideoDuration(e.currentTarget.duration)}
                            onTimeUpdate={(e) => setPlayheadTime(e.currentTarget.currentTime)}
                          />
                          {/* Subtitles Overlay */}
                          <div
                            style={{
                              position: "absolute",
                              bottom: "60px",
                              left: "5%",
                              right: "5%",
                              textAlign: "center",
                              background: "rgba(0, 0, 0, 0.75)",
                              color: "#fff",
                              padding: "6px 12px",
                              borderRadius: "6px",
                              fontSize: "0.85rem",
                              fontWeight: 500,
                              lineHeight: 1.4,
                              backdropFilter: "blur(4px)",
                              border: "1px solid rgba(255,255,255,0.06)",
                              pointerEvents: "none",
                              zIndex: 2,
                            }}
                          >
                            {getSubtitlesAtTime(playheadTime) || "AI Kids Animation Movie"}
                          </div>

                          {/* Video player controls panel */}
                          <div className="cinema-screen-overlay">
                            <div className="player-controls">
                              <button
                                onClick={() => {
                                  if (videoRef.current) {
                                    if (isPlaying) videoRef.current.pause();
                                    else videoRef.current.play();
                                  }
                                }}
                                style={{ background: "transparent", border: "none", color: "#ffffff", cursor: "pointer", fontSize: "1.2rem" }}
                              >
                                {isPlaying ? "⏸" : "▶"}
                              </button>

                              {/* Timeline bar */}
                              <div
                                onClick={(e) => {
                                  if (!videoRef.current || !videoDuration) return;
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const clickX = e.clientX - rect.left;
                                  const percent = clickX / rect.width;
                                  videoRef.current.currentTime = percent * videoDuration;
                                }}
                                className="timeline-bar"
                              >
                                <div
                                  className="timeline-progress"
                                  style={{ width: `${videoDuration ? (playheadTime / videoDuration) * 100 : 0}%` }}
                                />
                              </div>

                              <span style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}>
                                {Math.floor(playheadTime / 60)}:{(Math.floor(playheadTime % 60)).toString().padStart(2, '0')} / {Math.floor(videoDuration / 60)}:{(Math.floor(videoDuration % 60)).toString().padStart(2, '0')}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Scene Navigation List */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 700 }}>ĐIỀU HƯỚNG PHÂN CẢNH</span>
                          <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "180px", overflowY: "auto" }}>
                            {projectData.scenes.map((scene: any, sIdx) => {
                              let start = 0;
                              for (let i = 0; i < sIdx; i++) {
                                start += projectData.scenes[i].duration_seconds || 5;
                              }
                              const dur = scene.duration_seconds || 5;
                              const isActive = playheadTime >= start && playheadTime < start + dur;

                              return (
                                <button
                                  key={sIdx}
                                  onClick={() => {
                                    if (videoRef.current) videoRef.current.currentTime = start;
                                  }}
                                  style={{
                                    padding: "6px 12px",
                                    borderRadius: "4px",
                                    background: isActive ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.02)",
                                    border: `1px solid ${isActive ? "rgba(139,92,246,0.3)" : "var(--border-color)"}`,
                                    color: isActive ? "#a78bfa" : "var(--text-secondary)",
                                    fontSize: "0.75rem",
                                    cursor: "pointer",
                                    textAlign: "left",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis"
                                  }}
                                >
                                  🎬 Scene {scene.scene_id} - {scene.setting || "Chưa đặt tên"} ({dur}s)
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* AI Custom Instructions Input for Motion Generator */}
                  {projectData.shots.length > 0 && (
                    <div className="glass-panel" style={{ padding: "16px", background: "rgba(255, 255, 255, 0.01)", border: "1px solid rgba(255, 255, 255, 0.03)" }}>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: 700, display: "block", marginBottom: "8px" }}>
                        💡 YÊU CẦU BỔ SUNG KHI TẠO CHUYỂN ĐỘNG BẰNG AI (TÙY CHỌN)
                      </span>
                      <textarea
                        value={customMotionInstructions}
                        onChange={(e) => setCustomMotionInstructions(e.target.value)}
                        placeholder="Nhập hướng dẫn bổ sung cho Gemini khi tạo chuyển động (ví dụ: 'Hãy mô tả các nhân vật chuyển động cực kỳ chậm rãi', 'Thêm các hành động phụ như cười tươi', 'Máy quay luôn hướng theo nhân vật...')"
                        className="custom-textarea"
                        style={{
                          width: "100%",
                          minHeight: "60px",
                          fontSize: "0.8rem",
                          padding: "10px 12px",
                          lineHeight: 1.4,
                          background: "rgba(0, 0, 0, 0.2)",
                          border: "1px solid rgba(255,255,255,0.05)",
                          borderRadius: "4px"
                        }}
                      />
                      <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "4px", display: "block" }}>
                        * Nếu nhập yêu cầu này, hệ thống sẽ sử dụng AI Gemini để viết lại chuyển động theo ý bạn thay vì tự động chuyển đổi từ bảng phân cảnh.
                      </span>
                    </div>
                  )}

                  {/* Action panel: Generate Motion Prompts / Render Selected Videos */}
                  {projectData.shots.length > 0 && (
                    <div className="glass-panel" style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", padding: "12px 20px" }}>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          onClick={() => {
                            // Trigger render for all selected shots
                            const keys = Object.keys(selectedShots).filter(k => selectedShots[k]);
                            if (keys.length === 0) {
                              alert("Vui lòng chọn ít nhất một segment để render.");
                              return;
                            }
                            keys.forEach(k => triggerGenerateSegmentVideo(k));
                          }}
                          className="btn-secondary"
                          style={{
                            padding: "6px 12px",
                            fontSize: "0.75rem",
                            borderRadius: "4px"
                          }}
                        >
                          🎬 Render segment đã chọn ({Object.keys(selectedShots).filter(k => selectedShots[k]).length})
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Batch Action Buttons for Videos */}
                  {projectData.shots.length > 0 && (
                    <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "16px", padding: "12px", background: "rgba(255,255,255,0.02)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", fontWeight: 600 }}>Hành động hàng loạt:</span>
                      <button
                        onClick={() => handleRunStep("motion_generator")}
                        disabled={activeStep !== null || isRunningAll}
                        className="btn-primary"
                        style={{
                          padding: "6px 12px",
                          fontSize: "0.75rem",
                          borderRadius: "4px",
                          background: "rgba(168,85,247,0.2)",
                          border: "1px solid rgba(168,85,247,0.4)",
                          color: "#c084fc",
                          fontWeight: 600
                        }}
                      >
                        🔮 Sinh chuyển động (Motion Generator)
                      </button>
                      <button
                        onClick={() => handleGenerateAllSegmentVideos(false)}
                        disabled={isGeneratingBatch || activeStep !== null || isRunningAll}
                        className="btn-primary"
                        style={{ padding: "6px 12px", fontSize: "0.75rem", borderRadius: "4px" }}
                      >
                        🎬 Tạo tất cả video segment
                      </button>
                      <button
                        onClick={() => handleGenerateAllSegmentVideos(true)}
                        disabled={isGeneratingBatch || activeStep !== null || isRunningAll}
                        className="btn-secondary"
                        style={{ padding: "6px 12px", fontSize: "0.75rem", borderRadius: "4px" }}
                      >
                        🎬 Tạo video chưa tạo
                      </button>
                      <button
                        onClick={handleExportJsonPrompts}
                        disabled={activeStep !== null || isRunningAll}
                        className="btn-primary"
                        style={{
                          padding: "6px 12px",
                          fontSize: "0.75rem",
                          borderRadius: "4px",
                          background: "linear-gradient(135deg, #8b5cf6, #ec4899)",
                          border: "none",
                          cursor: "pointer",
                          fontWeight: 600,
                          boxShadow: "0 0 10px rgba(139, 92, 246, 0.2)"
                        }}
                      >
                        📥 Xuất JSON Prompts
                      </button>
                      {isGeneratingBatch && (
                        <button
                          onClick={handleStopDrawing}
                          className="btn-secondary"
                          style={{ padding: "6px 12px", fontSize: "0.75rem", borderRadius: "4px", color: "var(--danger)", borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)" }}
                        >
                          🛑 Dừng render video
                        </button>
                      )}
                    </div>
                  )}

                  {/* List of Shot Segment Cards */}
                  {projectData.shots.length === 0 ? (
                    <div style={{ padding: "40px", textAlign: "center", border: "1px dashed var(--border-color)", borderRadius: "var(--border-radius-lg)" }}>
                      <span style={{ display: "block", color: "var(--text-muted)", marginBottom: "16px" }}>
                        Chưa có camera shots. Vui lòng chạy Shot Planner (Step 5) trước.
                      </span>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                      {projectData.shots.map((shot: any, idx) => {
                        const shotKey = `shot_${shot.scene_number || shot.scene_id || ''}_${shot.shot_id}`;
                        const keyframeObj = projectData.keyframes 
                          ? projectData.keyframes.find((k: any) => k.shot_id === shot.shot_id)
                          : null;
                        const keyframeUrl = keyframeObj?.url || "";
                        const hasShotImg = !!(keyframeUrl && !keyframeUrl.startsWith("mock_"));
                        
                        // Find corresponding motion prompt by shot_id safely
                        const motionIndex = projectData.motion_prompts 
                          ? projectData.motion_prompts.findIndex((m: any) => m.shot_id === shot.shot_id)
                          : -1;
                        const motionText = motionIndex !== -1 && projectData.motion_prompts 
                          ? projectData.motion_prompts[motionIndex].motion_description 
                          : "";
                        const videoUrl = motionIndex !== -1 && projectData.motion_prompts
                          ? projectData.motion_prompts[motionIndex].video_url || ""
                          : "";
                        
                        const hasVideo = !!videoUrl || mockGeneratedSegmentVideos[shotKey] || isVideoGenerated;
                        const isGenVideo = generatingSegmentVideoKeys[shotKey];
                        const isGenShot = generatingShotKeys[shotKey];
                        
                        return (
                          <div
                            key={idx}
                            className="glass-panel"
                            style={{
                              display: "grid",
                              gridTemplateColumns: "80px 1fr 220px 220px",
                              gap: "20px",
                              padding: "20px",
                              alignItems: "stretch",
                              background: "#090e18",
                              border: "1px solid rgba(255,255,255,0.04)"
                            }}
                          >
                            {/* Column 1: Checkbox selector & ID */}
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", borderRight: "1px solid rgba(255,255,255,0.05)", paddingRight: "12px", gap: "8px" }}>
                              <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontWeight: 700 }}>CHỌN</span>
                              <input
                                type="checkbox"
                                checked={!!selectedShots[shotKey]}
                                onChange={(e) => {
                                  setSelectedShots(prev => ({ ...prev, [shotKey]: e.target.checked }));
                                }}
                                style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "#a78bfa" }}
                              />
                              <span style={{ fontSize: "0.85rem", color: "#a78bfa", fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                                #{String(shot.scene_number || shot.scene_id || '').padStart(2, '0')}
                              </span>
                            </div>

                            {/* Column 2: Motion Prompt Description */}
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 700 }}>
                                MÔ TẢ CHUYỂN ĐỘNG (MOTION PROMPT)
                              </span>
                              <textarea
                                value={motionText}
                                onChange={(e) => {
                                  if (motionIndex !== -1 && projectData.motion_prompts) {
                                    const updated = [...projectData.motion_prompts];
                                    updated[motionIndex].motion_description = e.target.value;
                                    handleUpdateStepData("motion_generator", updated);
                                  } else {
                                    const updated = [...(projectData.motion_prompts || []), {
                                      shot_id: shot.shot_id,
                                      motion_description: e.target.value,
                                      speed_profile: "Medium"
                                    }];
                                    handleUpdateStepData("motion_generator", updated);
                                  }
                                }}
                                placeholder="Nhập mô tả chuyển động camera & nhân vật..."
                                className="custom-textarea"
                                style={{
                                  flexGrow: 1,
                                  minHeight: "80px",
                                  fontSize: "0.8rem",
                                  padding: "8px 12px",
                                  lineHeight: 1.4,
                                  background: "rgba(0, 0, 0, 0.2)",
                                  border: "1px solid rgba(255,255,255,0.05)"
                                }}
                              />
                            </div>

                            {/* Column 3: Reference Shot Image */}
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 700 }}>
                                ẢNH SHOTS THAM CHIẾU
                              </span>
                              <div
                                style={{
                                  flexGrow: 1,
                                  aspectRatio: "16/10",
                                  background: "#060910",
                                  borderRadius: "4px",
                                  overflow: "hidden",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  position: "relative"
                                }}
                              >
                                {hasShotImg ? (
                                  <div style={{ width: "100%", height: "100%", position: "relative" }}>
                                    <img
                                      src={keyframeUrl}
                                      alt={`Scene ${shot.scene_id} - Shot ${shot.shot_id}`}
                                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                    />
                                    {renderImageActionToolbar(keyframeUrl, `shot_${shot.shot_id}.png`)}
                                  </div>
                                ) : (
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                                    {isGenShot ? (
                                      renderMediaLoader(isGenShot, "Vẽ ảnh...")
                                    ) : (
                                      <>
                                        <span style={{ fontSize: "1.2rem" }}>🖼️</span>
                                        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: 500 }}>Chưa tạo ảnh</span>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                              <button
                                onClick={() => {
                                  if (hasShotImg) {
                                    setFullscreenImageUrl(keyframeUrl);
                                  }
                                }}
                                disabled={!hasShotImg}
                                className="btn-secondary"
                                style={{
                                  width: "100%",
                                  padding: "4px 8px",
                                  fontSize: "0.7rem",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  gap: "4px",
                                  opacity: hasShotImg ? 1 : 0.4,
                                  cursor: hasShotImg ? "pointer" : "not-allowed"
                                }}
                              >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                  <circle cx="11" cy="11" r="8"/>
                                  <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                                </svg>
                                Xem ảnh Shots
                              </button>
                            </div>

                            {/* Column 4: Resulting Video */}
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 700 }}>
                                VIDEO KẾT QUẢ
                              </span>
                              <div
                                style={{
                                  flexGrow: 1,
                                  aspectRatio: "16/10",
                                  background: "#060910",
                                  borderRadius: "4px",
                                  overflow: "hidden",
                                  border: "1px solid rgba(255,255,255,0.04)",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center"
                                }}
                              >
                                {isGenVideo ? (
                                  renderMediaLoader(isGenVideo, "Rendering...")
                                ) : hasVideo ? (
                                  <video
                                    src={videoUrl || "https://assets.mixkit.co/videos/preview/mixkit-beautiful-aerial-view-of-forest-and-mountains-42646-large.mp4"}
                                    controls
                                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                  />
                                ) : (
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                                    <span style={{ fontSize: "1.2rem" }}>🎬</span>
                                    <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>Chưa tạo video</span>
                                  </div>
                                )}
                              </div>
                              <div style={{ display: "flex", gap: "4px" }}>
                                <button
                                  onClick={() => triggerGenerateSegmentVideo(shotKey)}
                                  disabled={!!isGenVideo || activeStep !== null || isRunningAll}
                                  className="btn-secondary"
                                  style={{
                                    flexGrow: 1,
                                    padding: "4px 8px",
                                    fontSize: "0.7rem",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: "4px"
                                  }}
                                >
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                                  </svg>
                                  Tạo lại video
                                </button>
                                <button
                                  onClick={() => {
                                    if (hasVideo) {
                                      alert(`Đang tải video của phân cảnh #${String(shot.scene_number || shot.scene_id || '').padStart(2, '0')}...`);
                                    } else {
                                      alert("Vui lòng tạo video trước.");
                                    }
                                  }}
                                  className="btn-secondary"
                                  style={{
                                    width: "32px",
                                    padding: "4px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center"
                                  }}
                                >
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                                  </svg>
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "rapphim" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: "24px", alignItems: "stretch", width: "100%" }}>
                  {/* Left Column: Cinema Preview Screen & Timeline */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    
                    {/* Cinema Screen Container */}
                    <div className="glass-panel" style={{ padding: "20px", background: "#060913", border: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: "16px", borderRadius: "12px" }}>
                      
                      {/* Cinema Title bar */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#a78bfa", letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: "8px" }}>
                          🎬 TRÌNH CHIẾU RẠP PHIM (STORY PREVIEW PLAYER)
                        </span>
                        {/* active state info */}
                        {(() => {
                          const activeState = getCinemaActiveStateAtTime(cinemaPlayhead);
                          if (activeState.mode === "shot" && activeState.activeShot) {
                            return (
                              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                Phân cảnh: <strong style={{ color: "#ffffff" }}>Scene {activeState.activeShot.scene_id} - Shot {String(activeState.activeShot.shot_id).replace('Shot', '')}</strong> (Cảnh {activeState.index + 1}/{activeState.totalCount})
                              </span>
                            );
                          } else if (activeState.mode === "scene" && activeState.activeScene) {
                            return (
                              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                Phân cảnh: <strong style={{ color: "#ffffff" }}>Scene {activeState.activeScene.scene_id}</strong> (Cảnh {activeState.index + 1}/{activeState.totalCount})
                              </span>
                            );
                          }
                          return (
                            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                              Chưa có phân cảnh nào
                            </span>
                          );
                        })()}
                      </div>

                      {/* 16:9 Screen */}
                      <div
                        id="cinema-player-screen"
                        className="cinema-screen"
                        style={{
                          width: "100%",
                          aspectRatio: "16/9",
                          background: "#000000",
                          borderRadius: "8px",
                          overflow: "hidden",
                          position: "relative",
                          border: "1px solid rgba(255,255,255,0.1)",
                          boxShadow: "0 20px 40px -15px rgba(124, 58, 237, 0.25)"
                        }}
                      >
                        {/* Display Media based on activeState */}
                        {(() => {
                          const activeState = getCinemaActiveStateAtTime(cinemaPlayhead);
                          const hasVideo = !!(activeState.videoUrl && !activeState.videoUrl.startsWith("mock_"));
                          const hasImage = !!(activeState.imageUrl && !activeState.imageUrl.startsWith("mock_"));

                          if (hasVideo) {
                            return (
                              <video
                                ref={cinemaVideoRef}
                                src={activeState.videoUrl}
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                playsInline
                                loop
                              />
                            );
                          } else if (hasImage) {
                            return (
                              <img
                                key={activeState.index}
                                src={activeState.imageUrl}
                                className="ken-burns"
                                alt="Cinema shot preview"
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              />
                            );
                          } else {
                            // Fallback if no media exists: Show stylized text overlay
                            return (
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  padding: "24px",
                                  height: "100%",
                                  width: "100%",
                                  background: "radial-gradient(circle, #0e172a 0%, #030712 100%)",
                                  color: "var(--text-secondary)",
                                  textAlign: "center"
                                }}
                              >
                                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" style={{ marginBottom: "12px" }}>
                                  <rect width="20" height="15" x="2" y="3" rx="2" />
                                  <path d="M12 18v4M9 22h6" />
                                </svg>
                                <div style={{ fontSize: "0.85rem", color: "#a78bfa", fontWeight: 700, marginBottom: "4px" }}>
                                  {activeState.mode === "shot" ? `SCENE ${activeState.activeShot?.scene_id} - SHOT ${String(activeState.activeShot?.shot_id).replace('Shot', '')}` : activeState.mode === "scene" ? `SCENE ${activeState.activeScene?.scene_id}` : "KHÔNG CÓ DỮ LIỆU"}
                                </div>
                                <div style={{ fontSize: "0.72rem", maxWidth: "400px", color: "var(--text-muted)", fontStyle: "italic" }}>
                                  {activeState.mode === "shot" ? activeState.activeShot?.actions : activeState.mode === "scene" ? activeState.activeScene?.description : "Vui lòng tạo kịch bản/phân cảnh trước để bắt đầu xem phim."}
                                </div>
                              </div>
                            );
                          }
                        })()}

                        {/* Subtitles Overlay */}
                        {(() => {
                          const activeState = getCinemaActiveStateAtTime(cinemaPlayhead);
                          const subtitle = activeState.subtitle;
                          if (!subtitle.text) return null;

                          // Align positions
                          let positionStyle: React.CSSProperties = {};
                          if (subConfig.alignment === "TOP") {
                            positionStyle = { top: "24px", bottom: "auto" };
                          } else if (subConfig.alignment === "CENTER") {
                            positionStyle = { top: "50%", bottom: "auto", transform: "translateY(-50%)" };
                          } else {
                            // BOTTOM
                            positionStyle = { bottom: "32px", top: "auto" };
                          }

                          // Font styling
                          let fontStyle: React.CSSProperties = {
                            fontFamily: subConfig.fontFamily === "sans-serif" ? "var(--font-sans)" : subConfig.fontFamily === "monospace" ? "var(--font-mono)" : subConfig.fontFamily,
                            fontSize: `${subConfig.fontSize}px`,
                            color: subConfig.color,
                            textAlign: "center"
                          };

                          // Text outline using multi-shadow
                          const w = subConfig.strokeWidth;
                          const c = subConfig.outlineColor;
                          if (w > 0) {
                            fontStyle.textShadow = `
                              -${w}px -${w}px 0 ${c},  
                               ${w}px -${w}px 0 ${c},
                              -${w}px  ${w}px 0 ${c},
                               ${w}px  ${w}px 0 ${c},
                              0 2px 4px rgba(0,0,0,0.8)
                            `;
                          } else {
                            fontStyle.textShadow = "0 2px 4px rgba(0,0,0,0.8)";
                          }

                          // Background box style
                          const hasBgBox = subConfig.bgOpacity > 0;
                          const bgStyle: React.CSSProperties = hasBgBox ? {
                            background: `${subConfig.bgColor || "#000000"}${Math.round(subConfig.bgOpacity * 2.55).toString(16).padStart(2, '0')}`,
                            padding: `${subConfig.bgPadding || 10}px ${Number(subConfig.bgPadding || 10) * 1.8}px`,
                            borderRadius: "6px",
                            backdropFilter: "blur(2px)",
                            border: "1px solid rgba(255,255,255,0.06)",
                            display: "inline-block"
                          } : {
                            display: "inline-block"
                          };

                          return (
                            <div
                              style={{
                                position: "absolute",
                                left: "8%",
                                right: "8%",
                                zIndex: 10,
                                display: "flex",
                                justifyContent: "center",
                                pointerEvents: "none",
                                ...positionStyle
                              }}
                            >
                              <div style={bgStyle}>
                                <div style={fontStyle}>
                                  {/* character name prefix */}
                                  {subtitle.character && (
                                    <span style={{ fontWeight: 800, color: "#a78bfa", marginRight: "6px" }}>
                                      {subtitle.character}:
                                    </span>
                                  )}
                                  {renderSubtitleLines(subtitle.text)}
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Projection screen top highlight shadow bar */}
                        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "30%", background: "linear-gradient(to bottom, rgba(167,139,250,0.08), transparent)", pointerEvents: "none" }} />

                        {/* Fullscreen Button */}
                        <button
                          onClick={toggleFullscreen}
                          style={{
                            position: "absolute",
                            top: "16px",
                            right: "16px",
                            zIndex: 20,
                            background: "rgba(0, 0, 0, 0.5)",
                            border: "1px solid rgba(255, 255, 255, 0.15)",
                            borderRadius: "6px",
                            width: "32px",
                            height: "32px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            color: "#ffffff",
                            backdropFilter: "blur(4px)",
                            transition: "all 0.2s"
                          }}
                          title={isFullscreen ? "Thu nhỏ" : "Phóng to toàn màn hình"}
                        >
                          {isFullscreen ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />
                            </svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                            </svg>
                          )}
                        </button>
                      </div>

                      {/* Video Player Controls (Playbar and buttons) */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px", background: "rgba(0,0,0,0.2)", padding: "12px", borderRadius: "8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                          
                          {/* Play / Pause button */}
                          <button
                            onClick={() => setCinemaPlaying(!cinemaPlaying)}
                            className="btn-primary"
                            style={{
                              width: "36px",
                              height: "36px",
                              borderRadius: "50%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "1rem",
                              background: cinemaPlaying ? "linear-gradient(135deg, #7c3aed, #db2777)" : "rgba(255,255,255,0.08)",
                              border: "none",
                              cursor: "pointer",
                              transition: "all 0.2s"
                            }}
                          >
                            {cinemaPlaying ? "⏸" : "▶"}
                          </button>

                          {/* Navigation buttons */}
                          <button
                            onClick={() => handleCinemaSkip(-1)}
                            className="btn-secondary"
                            style={{ padding: "6px 10px", fontSize: "0.75rem", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}
                            title="Lùi 1 phân cảnh"
                          >
                            ⏮
                          </button>
                          
                          <button
                            onClick={() => handleCinemaSkip(1)}
                            className="btn-secondary"
                            style={{ padding: "6px 10px", fontSize: "0.75rem", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}
                            title="Tiến 1 phân cảnh"
                          >
                            ⏭
                          </button>

                          {/* Loop toggle button */}
                          <button
                            onClick={() => setCinemaLoop(!cinemaLoop)}
                            className="btn-secondary"
                            style={{
                              padding: "6px 10px",
                              fontSize: "0.72rem",
                              borderRadius: "6px",
                              color: cinemaLoop ? "#a78bfa" : "var(--text-muted)",
                              border: `1px solid ${cinemaLoop ? "rgba(167,139,250,0.3)" : "rgba(255,255,255,0.05)"}`,
                              background: cinemaLoop ? "rgba(167,139,250,0.06)" : "transparent"
                            }}
                          >
                            🔁 Lặp lại
                          </button>

                          {/* Timeline slider */}
                          <div
                            onClick={handleCinemaTimelineClick}
                            style={{
                              flexGrow: 1,
                              height: "6px",
                              background: "rgba(255, 255, 255, 0.1)",
                              borderRadius: "3px",
                              position: "relative",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center"
                            }}
                          >
                            <div
                              style={{
                                height: "100%",
                                background: "linear-gradient(90deg, #7c3aed, #db2777)",
                                borderRadius: "3px",
                                width: `${getCinemaTotalDuration() ? (cinemaPlayhead / getCinemaTotalDuration()) * 100 : 0}%`
                              }}
                            />
                            <div
                              style={{
                                position: "absolute",
                                left: `calc(${getCinemaTotalDuration() ? (cinemaPlayhead / getCinemaTotalDuration()) * 100 : 0}% - 6px)`,
                                width: "12px",
                                height: "12px",
                                borderRadius: "50%",
                                background: "#ffffff",
                                boxShadow: "0 0 6px rgba(167, 139, 250, 0.8)",
                                border: "2px solid #7c3aed",
                                pointerEvents: "none"
                              }}
                            />
                          </div>

                          {/* Playback time indicator */}
                          <span style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--text-muted)", minWidth: "90px", textAlign: "right" }}>
                            {Math.floor(cinemaPlayhead / 60)}:{(Math.floor(cinemaPlayhead % 60)).toString().padStart(2, '0')} / {Math.floor(getCinemaTotalDuration() / 60)}:{(Math.floor(getCinemaTotalDuration() % 60)).toString().padStart(2, '0')}
                          </span>
                        </div>
                      </div>

                    </div>

                    {/* Timeline Navigator Shot list */}
                    <div className="glass-panel" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px", borderRadius: "12px" }}>
                      <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.05em" }}>
                        ĐIỀU HƯỚNG THEO VIDEO SHOT
                      </span>
                      
                      {projectData.shots.length === 0 ? (
                        <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-muted)", fontSize: "0.8rem" }}>
                          Chưa có thông tin video shot. Bạn cần hoàn thành bước 5 (Shot Planner) trước.
                        </div>
                      ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "10px", maxHeight: "250px", overflowY: "auto", paddingRight: "4px" }}>
                          {projectData.shots.map((shot: any, idx) => {
                            let start = 0;
                            for (let i = 0; i < idx; i++) {
                              start += projectData.shots[i].duration_seconds || 5;
                            }
                            const dur = shot.duration_seconds || 5;
                            const isActive = cinemaPlayhead >= start && cinemaPlayhead < start + dur;

                            // Lookup keyframe thumbnail
                            const keyframeObj = projectData.keyframes?.find((k: any) => k.shot_id === shot.shot_id);
                            const hasThumbnail = !!(keyframeObj?.url && !keyframeObj.url.startsWith("mock_"));

                            return (
                              <button
                                key={idx}
                                onClick={() => {
                                  setCinemaPlayhead(start);
                                  setCinemaPlaying(true);
                                }}
                                style={{
                                  padding: "8px",
                                  borderRadius: "8px",
                                  background: isActive ? "rgba(124, 58, 237, 0.12)" : "rgba(255,255,255,0.02)",
                                  border: `1px solid ${isActive ? "rgba(124, 58, 237, 0.35)" : "rgba(255,255,255,0.04)"}`,
                                  color: isActive ? "#a78bfa" : "var(--text-secondary)",
                                  fontSize: "0.75rem",
                                  cursor: "pointer",
                                  textAlign: "left",
                                  display: "flex",
                                  gap: "8px",
                                  alignItems: "center",
                                  transition: "all 0.2s"
                                }}
                              >
                                {/* Mini thumbnail */}
                                <div style={{ width: "48px", height: "27px", borderRadius: "4px", background: "#000", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "1px solid rgba(255,255,255,0.08)" }}>
                                  {hasThumbnail ? (
                                    <img src={keyframeObj.url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                  ) : (
                                    <span style={{ fontSize: "0.6rem" }}>🎬</span>
                                  )}
                                </div>
                                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexGrow: 1 }}>
                                  <div style={{ fontWeight: 700, display: "flex", justifyContent: "space-between" }}>
                                     <span>Scene {shot.scene_id} - Shot {String(shot.shot_id).replace('Shot', '')}</span>
                                    <span style={{ color: "var(--text-muted)", fontSize: "0.65rem" }}>{dur}s</span>
                                  </div>
                                  <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {shot.actions || "Chưa có hành động"}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                  </div>

                  {/* Right Column: Controls Sidebar */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "20px", width: "400px", flexShrink: 0 }}>
                    
                    {/* Render Movie Panel */}
                    <div className="glass-panel" style={{ padding: "20px", background: "linear-gradient(135deg, #0d1222 0%, #060913 100%)", border: "1px solid rgba(139, 92, 246, 0.15)", borderRadius: "12px", display: "flex", flexDirection: "column", gap: "14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", borderBottom: "1px solid rgba(139, 92, 246, 0.2)", paddingBottom: "10px" }}>
                        <span style={{ fontSize: "1.2rem" }}>🎬</span>
                        <h3 style={{ fontSize: "1.05rem", fontWeight: 800, color: "#ffffff", letterSpacing: "0.03em", margin: 0 }}>
                          XUẤT VIDEO MP4
                        </h3>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-secondary)" }}>
                          Độ phân giải video
                        </label>
                        <select
                          className="custom-select"
                          value={videoResolution}
                          onChange={(e) => setVideoResolution(e.target.value)}
                          style={{ width: "100%", padding: "10px 14px", background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px" }}
                        >
                          <option value="1080">Full HD (1920x1080) - Chất lượng cao</option>
                          <option value="720">HD (1280x720) - Khuyên dùng</option>
                          <option value="360">SD (640x360) - Tốc độ nhanh</option>
                        </select>
                      </div>

                      <button
                        onClick={startVideoRendering}
                        disabled={isRenderingVideo || projectData.shots.length === 0}
                        className="btn-primary"
                        style={{
                          padding: "10px 16px",
                          fontSize: "0.85rem",
                          fontWeight: 700,
                          borderRadius: "8px",
                          background: isRenderingVideo ? "rgba(139, 92, 246, 0.3)" : "linear-gradient(135deg, #7c3aed, #db2777)",
                          border: "none",
                          cursor: "pointer",
                          display: "flex",
                          justifyContent: "center",
                          alignItems: "center",
                          gap: "8px",
                          boxShadow: "0 4px 12px rgba(124, 58, 237, 0.35)",
                          transition: "all 0.2s"
                        }}
                      >
                        {isRenderingVideo ? (
                          <>
                            <span className="pulse-dot" style={{ background: "#ffffff" }} />
                            Rendering ({videoRenderPercent}%)
                          </>
                        ) : (
                          "🎬 Render phim hoàn chỉnh"
                        )}
                      </button>

                      {isRenderingVideo && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "var(--text-secondary)" }}>
                            <span>Tiến độ: {videoRenderPercent}%</span>
                            <span style={{ fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "200px" }}>{videoRenderStage}</span>
                          </div>
                          <div style={{ width: "100%", height: "6px", background: "rgba(255,255,255,0.08)", borderRadius: "3px", overflow: "hidden" }}>
                            <div style={{ width: `${videoRenderPercent}%`, height: "100%", background: "linear-gradient(90deg, #7c3aed, #db2777)", transition: "width 0.2s ease" }} />
                          </div>
                        </div>
                      )}

                      {isVideoGenerated && !isRenderingVideo && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px", background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.25)", borderRadius: "8px", padding: "10px 14px", fontSize: "0.75rem", color: "#34d399" }}>
                          <span style={{ fontWeight: 700 }}>✓ Đã biên dịch video thành công!</span>
                          <span style={{ color: "var(--text-secondary)", fontSize: "0.7rem" }}>
                            Bạn có thể xem trước phim ở trình phát bên trái hoặc tải file MP4 trực tiếp từ thư mục `public/exports`.
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Subtitle Settings Panel */}
                    <div className="glass-panel" style={{ padding: "24px", background: "#0f121d", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "12px", display: "flex", flexDirection: "column", gap: "20px" }}>
                      
                      {/* Header */}
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "12px" }}>
                        <span style={{ fontSize: "1.2rem", color: "#a78bfa" }}>🎛️</span>
                        <h3 style={{ fontSize: "1.05rem", fontWeight: 800, color: "#ffffff", letterSpacing: "0.03em", margin: 0 }}>
                          CẤU HÌNH SUBTITLE
                        </h3>
                      </div>

                      {/* Font Family selector */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-secondary)" }}>
                          T Kiểu chữ (Font Family)
                        </label>
                        <select
                          value={subConfig.fontFamily}
                          onChange={(e) => setSubConfig(prev => ({ ...prev, fontFamily: e.target.value }))}
                          className="custom-select"
                          style={{ width: "100%", padding: "10px 14px", background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px" }}
                        >
                          <option value="sans-serif">Sans-Serif (Mặc định)</option>
                          <option value="serif">Serif (Thời cổ / Kịch)</option>
                          <option value="monospace">Monospace (Lập trình)</option>
                          <option value="cursive">Cursive (Bút viết tay)</option>
                          <option value="Outfit">Outfit (Hiện đại thanh lịch)</option>
                          <option value="Arial">Arial</option>
                          <option value="Times New Roman">Times New Roman</option>
                        </select>
                      </div>

                      {/* Font Size slider */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-secondary)" }}>
                            Kích thước (Font Size)
                          </label>
                          <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#a78bfa" }}>
                            {subConfig.fontSize}px
                          </span>
                        </div>
                        <input
                          type="range"
                          min="16"
                          max="80"
                          value={subConfig.fontSize}
                          onChange={(e) => setSubConfig(prev => ({ ...prev, fontSize: parseInt(e.target.value) }))}
                          className="cinema-range"
                        />
                      </div>

                      {/* Colors grid (Text Color & Outline Color) */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                        
                        {/* Text Color */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-secondary)" }}>
                            Màu chữ
                          </label>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "4px 8px" }}>
                            <input
                              type="color"
                              value={subConfig.color}
                              onChange={(e) => setSubConfig(prev => ({ ...prev, color: e.target.value }))}
                              style={{ width: "24px", height: "24px", border: "none", borderRadius: "4px", cursor: "pointer", background: "transparent" }}
                            />
                            <span style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "#ffffff", textTransform: "uppercase" }}>
                              {subConfig.color}
                            </span>
                          </div>
                        </div>

                        {/* Outline Color */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-secondary)" }}>
                            Màu viền (Outline)
                          </label>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "4px 8px" }}>
                            <input
                              type="color"
                              value={subConfig.outlineColor}
                              onChange={(e) => setSubConfig(prev => ({ ...prev, outlineColor: e.target.value }))}
                              style={{ width: "24px", height: "24px", border: "none", borderRadius: "4px", cursor: "pointer", background: "transparent" }}
                            />
                            <span style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "#ffffff", textTransform: "uppercase" }}>
                              {subConfig.outlineColor}
                            </span>
                          </div>
                        </div>

                      </div>

                      {/* Stroke Width Slider */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-secondary)" }}>
                            Độ dày viền (Stroke)
                          </label>
                          <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#a78bfa" }}>
                            {subConfig.strokeWidth}px
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="10"
                          value={subConfig.strokeWidth}
                          onChange={(e) => setSubConfig(prev => ({ ...prev, strokeWidth: parseInt(e.target.value) }))}
                          className="cinema-range"
                        />
                      </div>

                      {/* Background Box Opacity Slider */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-secondary)" }}>
                            Độ mờ hộp nền
                          </label>
                          <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#a78bfa" }}>
                            {subConfig.bgOpacity}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={subConfig.bgOpacity}
                          onChange={(e) => setSubConfig(prev => ({ ...prev, bgOpacity: parseInt(e.target.value) }))}
                          className="cinema-range"
                        />
                      </div>

                      {/* Background Box Color & Padding (User Custom Additions) */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                        {/* BG Color */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-secondary)" }}>
                            Màu hộp nền
                          </label>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "4px 8px" }}>
                            <input
                              type="color"
                              value={subConfig.bgColor}
                              onChange={(e) => setSubConfig(prev => ({ ...prev, bgColor: e.target.value }))}
                              style={{ width: "24px", height: "24px", border: "none", borderRadius: "4px", cursor: "pointer", background: "transparent" }}
                            />
                            <span style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "#ffffff", textTransform: "uppercase" }}>
                              {subConfig.bgColor}
                            </span>
                          </div>
                        </div>

                        {/* BG Padding */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-secondary)" }}>
                              Size hộp (Padding)
                            </label>
                            <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#a78bfa" }}>
                              {subConfig.bgPadding}px
                            </span>
                          </div>
                          <input
                            type="range"
                            min="4"
                            max="30"
                            value={subConfig.bgPadding}
                            onChange={(e) => setSubConfig(prev => ({ ...prev, bgPadding: parseInt(e.target.value) }))}
                            className="cinema-range"
                          />
                        </div>
                      </div>

                      {/* Max Line Length slider */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-secondary)" }}>
                            Độ dài dòng tối đa
                          </label>
                          <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#a78bfa" }}>
                            {subConfig.maxLineLength} ký tự
                          </span>
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="80"
                          value={subConfig.maxLineLength}
                          onChange={(e) => setSubConfig(prev => ({ ...prev, maxLineLength: parseInt(e.target.value) }))}
                          className="cinema-range"
                        />
                      </div>

                      {/* Max Words per Sub slider */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-secondary)" }}>
                            Từ tối đa / Sub (Tách câu)
                          </label>
                          <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#a78bfa" }}>
                            {subConfig.maxWordsPerSub} từ
                          </span>
                        </div>
                        <input
                          type="range"
                          min="2"
                          max="15"
                          value={subConfig.maxWordsPerSub}
                          onChange={(e) => setSubConfig(prev => ({ ...prev, maxWordsPerSub: parseInt(e.target.value) }))}
                          className="cinema-range"
                        />
                      </div>

                      {/* Alignment segmented controller */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-secondary)" }}>
                          Vị trí hiển thị (Alignment)
                        </label>
                        <div className="segmented-control">
                          <button
                            onClick={() => setSubConfig(prev => ({ ...prev, alignment: "TOP" }))}
                            className={`segmented-control-btn ${subConfig.alignment === "TOP" ? "active" : ""}`}
                          >
                            TOP
                          </button>
                          <button
                            onClick={() => setSubConfig(prev => ({ ...prev, alignment: "CENTER" }))}
                            className={`segmented-control-btn ${subConfig.alignment === "CENTER" ? "active" : ""}`}
                          >
                            CENTER
                          </button>
                          <button
                            onClick={() => setSubConfig(prev => ({ ...prev, alignment: "BOTTOM" }))}
                            className={`segmented-control-btn ${subConfig.alignment === "BOTTOM" ? "active" : ""}`}
                          >
                            BOTTOM
                          </button>
                        </div>
                      </div>

                    </div>
                  </div>

                </div>
              )}
            </div>

            {/* Collapsible right sidebar JSON editor */}
            {showJsonEditor && ["assets", "shots", "video"].includes(activeTab) && selectedStep && (
              <div style={{ width: "340px", flexShrink: 0 }}>
                <JsonEditor
                  title={getStepJsonFilename(selectedStep)}
                  data={getStepJsonData(selectedStep)}
                  onChangeData={(updatedData) => handleUpdateStepData(selectedStep, updatedData)}
                  disabled={isRunningAll || activeStep !== null}
                />
              </div>
            )}

        </div>
      </main>
    </div>

      {/* Global Configuration settings overlay Modal */}
      {isSettingsOpen && (
        <div className="modal-overlay" onClick={() => setIsSettingsOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "12px" }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#ffffff" }}>
                System Configuration
              </h3>
              <button
                onClick={() => setIsSettingsOpen(false)}
                style={{ background: "transparent", border: "none", color: "var(--text-secondary)", fontSize: "1.1rem", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <ApiKeyInput
              apiKeys={apiKeys}
              onChangeApiKeys={handleApiKeysChange}
              selectedModel={selectedModel}
              onChangeModel={handleModelChange}
              rpmLimit={rpmLimit}
              onChangeRpmLimit={handleRpmLimitChange}
              chunkSize={chunkSize}
              onChangeChunkSize={handleChunkSizeChange}
              
              imageCount={imageCount}
              onChangeImageCount={(val) => {
                setImageCount(val);
                localStorage.setItem("local_image_count", val.toString());
              }}
              imageAspectRatio={imageAspectRatio}
              onChangeImageAspectRatio={(val) => {
                setImageAspectRatio(val);
                localStorage.setItem("local_image_aspect_ratio", val);
              }}
              imageModel={imageModel}
              onChangeImageModel={(val) => {
                setImageModel(val);
                localStorage.setItem("local_image_model", val);
              }}

              videoCount={videoCount}
              onChangeVideoCount={(val) => {
                setVideoCount(val);
                localStorage.setItem("local_video_count", val.toString());
              }}
              videoAspectRatio={videoAspectRatio}
              onChangeVideoAspectRatio={(val) => {
                setVideoAspectRatio(val);
                localStorage.setItem("local_video_aspect_ratio", val);
              }}
              videoModel={videoModel}
              onChangeVideoModel={(val) => {
                setVideoModel(val);
                localStorage.setItem("local_video_model", val);
              }}
              imageConcurrency={imageConcurrency}
              onChangeImageConcurrency={(val) => {
                setImageConcurrency(val);
                localStorage.setItem("local_image_concurrency", val.toString());
              }}
              videoConcurrency={videoConcurrency}
              onChangeVideoConcurrency={(val) => {
                setVideoConcurrency(val);
                localStorage.setItem("local_video_concurrency", val.toString());
              }}
            />

            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "12px", display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="sidebar-btn-new"
                style={{ padding: "8px 20px" }}
              >
                Close Settings
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Custom Project Name Modal */}
      {isProjectNameModalOpen && (
        <div className="modal-overlay" onClick={() => setIsProjectNameModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "400px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "12px", marginBottom: "16px" }}>
              <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#ffffff" }}>
                {projectNameModalTitle}
              </h3>
              <button
                onClick={() => setIsProjectNameModalOpen(false)}
                style={{ background: "transparent", border: "none", color: "var(--text-secondary)", fontSize: "1.1rem", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "20px" }}>
              <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)" }}>Tên dự án</label>
              <input
                type="text"
                value={projectNameInput}
                onChange={(e) => setProjectNameInput(e.target.value)}
                placeholder="Nhập tên dự án..."
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && projectNameInput.trim()) {
                    projectNameModalCallback?.(projectNameInput.trim());
                    setIsProjectNameModalOpen(false);
                  }
                }}
                style={{
                  width: "100%",
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--border-radius-sm)",
                  padding: "8px 12px",
                  color: "var(--text-primary)",
                  fontSize: "0.85rem",
                  outline: "none",
                }}
              />
            </div>

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setIsProjectNameModalOpen(false)}
                className="btn-secondary"
                style={{ padding: "6px 12px", fontSize: "0.8rem" }}
              >
                Hủy
              </button>
              <button
                onClick={() => {
                  if (!projectNameInput.trim()) {
                    alert("Vui lòng nhập tên dự án hợp lệ.");
                    return;
                  }
                  projectNameModalCallback?.(projectNameInput.trim());
                  setIsProjectNameModalOpen(false);
                }}
                className="btn-primary"
                style={{ padding: "6px 16px", fontSize: "0.8rem" }}
              >
                Xác nhận
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Web Directory Explorer Modal */}
      {isExplorerOpen && (
        <div className="modal-overlay" onClick={() => setIsExplorerOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "600px", width: "90%", display: "flex", flexDirection: "column", height: "80vh", maxHeight: "600px", background: "#0b0f19", border: "1px solid var(--border-color)", padding: "20px", borderRadius: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "12px", marginBottom: "16px" }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#ffffff", display: "flex", alignItems: "center", gap: "8px" }}>
                <span>📁 Trình duyệt thư mục PC</span>
              </h3>
              <button
                onClick={() => setIsExplorerOpen(false)}
                style={{ background: "transparent", border: "none", color: "var(--text-secondary)", fontSize: "1.1rem", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            {/* Breadcrumbs & Navigation */}
            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "16px" }}>
              {explorerParentPath !== null && (
                <button
                  onClick={() => explorePath(explorerParentPath)}
                  className="btn-secondary"
                  style={{ padding: "6px 12px", fontSize: "0.8rem", borderRadius: "6px", display: "flex", alignItems: "center", gap: "4px" }}
                  title="Thư mục cha"
                >
                  ↑ Lên một cấp
                </button>
              )}
              {explorerCurrentPath && (
                <button
                  onClick={() => explorePath("")}
                  className="btn-secondary"
                  style={{ padding: "6px 12px", fontSize: "0.8rem", borderRadius: "6px" }}
                  title="Danh sách ổ đĩa"
                >
                  💻 Root
                </button>
              )}
              <input
                type="text"
                readOnly
                value={explorerCurrentPath || "Danh sách ổ đĩa (Root)"}
                className="custom-input"
                style={{ flexGrow: 1, padding: "6px 10px", fontSize: "0.8rem", background: "rgba(0,0,0,0.2)", cursor: "default" }}
              />
            </div>

            {/* Error message */}
            {explorerError && (
              <div style={{ padding: "10px", background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.2)", color: "#f87171", borderRadius: "6px", fontSize: "0.8rem", marginBottom: "16px" }}>
                {explorerError}
              </div>
            )}

            {/* Folder List */}
            <div style={{ flexGrow: 1, overflowY: "auto", background: "rgba(0,0,0,0.25)", border: "1px solid var(--border-color)", borderRadius: "8px", padding: "8px", display: "flex", flexDirection: "column", gap: "4px" }}>
              {explorerFolders.length === 0 ? (
                <div style={{ padding: "30px", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                  Thư mục trống hoặc không có quyền truy cập.
                </div>
              ) : (
                explorerFolders.map((folder, idx) => (
                  <div
                    key={idx}
                    onClick={() => explorePath(folder.path)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                      color: "var(--text-primary)",
                      transition: "background 0.2s"
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    <span style={{ fontSize: "1.1rem" }}>📁</span>
                    <span style={{ fontWeight: 500 }}>{folder.name}</span>
                  </div>
                ))
              )}
            </div>

            {/* Create new folder input */}
            {showNewFolderInput ? (
              <div style={{ display: "flex", gap: "8px", marginTop: "16px", alignItems: "center" }}>
                <input
                  type="text"
                  value={explorerNewFolderName}
                  onChange={(e) => setExplorerNewFolderName(e.target.value)}
                  placeholder="Nhập tên thư mục mới..."
                  className="custom-input"
                  style={{ flexGrow: 1, padding: "8px 12px", fontSize: "0.8rem" }}
                  autoFocus
                />
                <button
                  onClick={handleCreateNewFolder}
                  className="btn-primary"
                  style={{ padding: "8px 16px", fontSize: "0.8rem", borderRadius: "6px" }}
                >
                  Tạo
                </button>
                <button
                  onClick={() => setShowNewFolderInput(false)}
                  className="btn-secondary"
                  style={{ padding: "8px 16px", fontSize: "0.8rem", borderRadius: "6px" }}
                >
                  Hủy
                </button>
              </div>
            ) : (
              explorerCurrentPath && (
                <div style={{ display: "flex", justifyContent: "flex-start", marginTop: "16px" }}>
                  <button
                    onClick={() => setShowNewFolderInput(true)}
                    className="btn-secondary"
                    style={{ padding: "6px 12px", fontSize: "0.8rem", borderRadius: "6px", display: "flex", alignItems: "center", gap: "4px" }}
                  >
                    ➕ Tạo thư mục mới
                  </button>
                </div>
              )
            )}

            {/* Action buttons */}
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "12px", marginTop: "16px" }}>
              <button
                onClick={() => setIsExplorerOpen(false)}
                className="btn-secondary"
                style={{ padding: "8px 16px", fontSize: "0.8rem", borderRadius: "6px" }}
              >
                Hủy
              </button>
              {explorerCurrentPath && (
                <button
                  onClick={() => handleSelectExplorerFolder(explorerCurrentPath)}
                  className="btn-primary"
                  style={{
                    padding: "8px 24px",
                    fontSize: "0.8rem",
                    borderRadius: "6px",
                    background: "linear-gradient(135deg, #7c3aed, #db2777)",
                    border: "none",
                    fontWeight: 600
                  }}
                >
                  Chọn thư mục này
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Fullscreen Image Zoom Modal Overlay */}
      {fullscreenImageUrl && (
        <div
          className="modal-overlay"
          onClick={() => setFullscreenImageUrl(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(3, 7, 18, 0.9)",
            backdropFilter: "blur(12px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            cursor: "zoom-out",
            animation: "modal-fade-in 0.25s ease-out"
          }}
        >
          {/* Close button top right */}
          <button
            onClick={() => setFullscreenImageUrl(null)}
            style={{
              position: "absolute",
              top: "24px",
              right: "24px",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "50%",
              width: "48px",
              height: "48px",
              color: "#ffffff",
              fontSize: "1.5rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
            title="Đóng"
          >
            ✕
          </button>

          {/* Download button top right next to close */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              downloadImageUrl(fullscreenImageUrl, "zoom_image.png");
            }}
            style={{
              position: "absolute",
              top: "24px",
              right: "88px",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "50%",
              width: "48px",
              height: "48px",
              color: "#ffffff",
              fontSize: "1.2rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
            title="Tải ảnh về"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>

          {/* Centered Large Image */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "85vw",
              maxHeight: "80vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "8px",
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.1)",
              boxShadow: "0 25px 50px -12px rgba(0,0,0,0.8)",
              cursor: "default"
            }}
          >
            <img
              src={fullscreenImageUrl}
              alt="Zoomed View"
              style={{
                maxWidth: "100%",
                maxHeight: "80vh",
                objectFit: "contain"
              }}
            />
          </div>
        </div>
      )}
      <FloatingSystemLogs activeProjectId={activeProjectId} />
    </div>
  );
}
