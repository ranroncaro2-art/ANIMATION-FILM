"use client";

import React, { useState, useEffect, useRef } from "react";
import ApiKeyInput from "../components/ApiKeyInput";
import JsonEditor from "../components/JsonEditor";
import { StepKey, PipelineStep } from "../components/PipelineProgress";
import {
  saveProject,
  getProject,
  deleteProject,
  listProjects,
  SavedProject,
  ProjectMetadata
} from "../utils/db";
import { queueManager } from "../utils/queue";

const BACKEND_URL = "http://127.0.0.1:8000";

interface ProjectData {
  scenes: any[];
  characters: any[];
  environments: any[];
  props: any[];
  shots: any[];
  keyframes: any[];
  motion_prompts: any[];
}

const INITIAL_PROJECT_DATA: ProjectData = {
  scenes: [],
  characters: [],
  environments: [],
  props: [],
  shots: [],
  keyframes: [],
  motion_prompts: [],
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
    label: "5. Shot Planner",
    description: "Plan individual camera shots, movements, and framings",
    status: "idle",
  },
  {
    key: "keyframe_generator",
    label: "6. Keyframe Prompt AI",
    description: "Generate static reference image prompts for each shot",
    status: "idle",
  },
  {
    key: "motion_generator",
    label: "7. Motion Prompt AI",
    description: "Generate Veo 3 motion and video generation prompts",
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
  const [storyboard, setStoryboard] = useState("");
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

  // Local API Draw & Video configurations
  const [imageCount, setImageCount] = useState<number>(1);
  const [imageAspectRatio, setImageAspectRatio] = useState<string>("IMAGE_ASPECT_RATIO_LANDSCAPE");
  const [imageModel, setImageModel] = useState<string>("GEM_PIX_2");
  
  const [videoCount, setVideoCount] = useState<number>(1);
  const [videoAspectRatio, setVideoAspectRatio] = useState<string>("VIDEO_ASPECT_RATIO_LANDSCAPE");
  const [videoModel, setVideoModel] = useState<string>("Veo 3.1 Lite - 0 credit");

  const [imageConcurrency, setImageConcurrency] = useState<number>(2);
  const [videoConcurrency, setVideoConcurrency] = useState<number>(1);

  // Mock Generation previews for Asset References & Shots
  const [mockGeneratedReferenceImages, setMockGeneratedReferenceImages] = useState<Record<string, boolean>>({});
  const [mockGeneratedShotImages, setMockGeneratedShotImages] = useState<Record<string, boolean>>({});
  const [generatingAssetIds, setGeneratingAssetIds] = useState<Record<string, boolean>>({});
  const [generatingShotKeys, setGeneratingShotKeys] = useState<Record<string, boolean>>({});

  // Video Rendering preview state
  const [isRenderingVideo, setIsRenderingVideo] = useState<boolean>(false);
  const [videoRenderPercent, setVideoRenderPercent] = useState<number>(0);
  const [videoRenderStage, setVideoRenderStage] = useState<string>("");
  const [isVideoGenerated, setIsVideoGenerated] = useState<boolean>(false);

  // Video Player state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playheadTime, setPlayheadTime] = useState<number>(0);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Video Segment rendering states
  const [selectedShots, setSelectedShots] = useState<Record<string, boolean>>({});
  const [mockGeneratedSegmentVideos, setMockGeneratedSegmentVideos] = useState<Record<string, boolean>>({});
  const [generatingSegmentVideoKeys, setGeneratingSegmentVideoKeys] = useState<Record<string, boolean>>({});

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

  // System logs states
  const [systemLogs, setSystemLogs] = useState<any[]>([]);
  const [showLogsPanel, setShowLogsPanel] = useState<boolean>(true);
  const [filterLogsCurrentProj, setFilterLogsCurrentProj] = useState<boolean>(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Subscribe to system logs from the singleton queueManager
  useEffect(() => {
    const unsubscribe = queueManager.subscribeLogs((logs) => {
      setSystemLogs(logs);
    });
    return () => unsubscribe();
  }, []);

  // Scroll to bottom when new logs are appended
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [systemLogs, showLogsPanel]);

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
      .catch(console.error);

    // Refresh the list of saved projects
    refreshProjectsList();
  }, []);

  // Debounced auto-save to IndexedDB for the active workspace
  useEffect(() => {
    const timer = setTimeout(() => {
      // Only save if there's actually some content to store
      if (storyboard.trim() || projectData.scenes.length > 0) {
        const activeProject: SavedProject = {
          id: activeProjectId,
          name: activeProjectName,
          updatedAt: new Date().toISOString(),
          storyboard,
          projectData,
          steps,
          model: selectedModel,
          selectedStyle,
          styleDescription,
          workflowMode,
        };
        saveProject(activeProject).catch((err) => {
          console.error("IndexedDB Auto-save failed:", err);
        });
      }
    }, 1000); // 1 second debounce
    
    return () => clearTimeout(timer);
  }, [storyboard, projectData, steps, activeProjectName, selectedModel, selectedStyle, styleDescription, workflowMode, activeProjectId]);

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
    const name = prompt("Enter project name:", activeProjectName === "Untitled Project" ? "" : activeProjectName);
    if (name === null) return;
    if (!name.trim()) {
      alert("Please enter a valid project name.");
      return;
    }

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

    const name = prompt("Nhập tên dự án mới:", "Dự án mới");
    if (name === null) return; // User cancelled
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
    });
  };

  // Run groups of steps (Combo runs)
  const runCombo1 = () => {
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

    // Reset local data
    setProjectData(INITIAL_PROJECT_DATA);

    queueManager.runCombo1({
      projectId: activeProjectId,
      projectName: activeProjectName,
      storyboard,
      apiKeys,
      selectedModel,
      rpmLimit,
      chunkSize,
      initialSteps: INITIAL_STEPS,
      projectData: INITIAL_PROJECT_DATA,
    });
    setActiveTab("assets");
    setAssetSubTab("scenes");
  };

  const runCombo2 = () => {
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

    // Reset local data
    setProjectData(INITIAL_PROJECT_DATA);

    queueManager.runCombo2({
      projectId: activeProjectId,
      projectName: activeProjectName,
      storyboard,
      apiKeys,
      selectedModel,
      rpmLimit,
      chunkSize,
      initialSteps: INITIAL_STEPS,
      projectData: INITIAL_PROJECT_DATA,
    });
    setActiveTab("assets");
    setAssetSubTab("characters");
  };

  // Run the whole pipeline sequentially
  const handleRunAllPipeline = () => {
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

    // Reset local data
    setProjectData(INITIAL_PROJECT_DATA);

    queueManager.runAllPipeline({
      projectId: activeProjectId,
      projectName: activeProjectName,
      storyboard,
      apiKeys,
      selectedModel,
      rpmLimit,
      chunkSize,
      initialSteps: INITIAL_STEPS,
    });
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

    const payloadCharacters = (projectData.characters || []).map((char: any) => ({
      name: char.name,
      description: char.description,
      prompt: char.turnaround_prompt
    }));

    const payloadEnvironments = (projectData.environments || []).map((env: any) => ({
      name: env.setting_name,
      prompt: env.reference_prompt
    }));

    const payloadProps = (projectData.props || []).map((prop: any) => ({
      name: prop.prop_name,
      prompt: prop.reference_prompt
    }));

    const payloadShots = (projectData.shots || []).map((shot: any) => ({
      shot_id: shot.shot_id,
      scene_number: shot.scene_number || shot.scene_id,
      duration_seconds: shot.duration_seconds,
      actions: shot.actions || "",
      characters: shot.characters,
      environment: shot.environment,
      props: shot.props,
      dialogue: shot.dialogue ? shot.dialogue.map((d: any) => ({
        character: d.character,
        speech: d.text
      })) : [],
      camera_movement: shot.camera_movement,
      shot_type: shot.framing
    }));

    const payloadKeyframes = (projectData.keyframes || []).map((k: any) => ({
      shot_id: k.shot_id,
      prompt: k.keyframe_image_prompt
    }));

    const payloadMotion = (projectData.motion_prompts || []).map((m: any) => ({
      shot_id: m.shot_id,
      prompt: m.motion_description
    }));

    try {
      const response = await fetch(`${BACKEND_URL}/api/export-zip`, {
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

      const response = await fetch("http://127.0.0.1:5000/api/generate", {
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
      console.warn("Local Image API offline or failed, falling back to mock. Error:", err.message);
      // Fallback: Use anime placeholder URL so persistence on reload is active even when offline
      return {
        url: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=400&auto=format&fit=crop&q=80",
        media_id: `mock_media_${Math.random().toString(36).substring(2, 11)}`,
        account_id: "mock_account"
      };
    }
  };

  // Reference image generator trigger
  const triggerGenerateAssetImage = async (id: string) => {
    const startedProjectId = activeProjectId;
    setGeneratingAssetIds(prev => ({ ...prev, [id]: true }));
    queueManager.addLog(`Bắt đầu vẽ ảnh tham chiếu cho Asset: ${id}...`, "running", startedProjectId);
    
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

    try {
      const result = await generateImageViaLocalApi(promptText);

      // Isolated database update
      await updateProjectDataInDb(startedProjectId, (prevData) => {
        const copy = { ...prevData };
        if (type === "character") {
          copy.characters = copy.characters.map(c => c.name === name ? { ...c, url: result.url, media_id: result.media_id, account_id: result.account_id } : c);
        } else if (type === "environment") {
          copy.environments = copy.environments.map(e => e.setting_name === name ? { ...e, url: result.url, media_id: result.media_id, account_id: result.account_id } : e);
        } else if (type === "prop") {
          copy.props = copy.props.map(p => p.prop_name === name ? { ...p, url: result.url, media_id: result.media_id, account_id: result.account_id } : p);
        }
        return copy;
      });

      setMockGeneratedReferenceImages(prev => ({ ...prev, [id]: true }));
      queueManager.addLog(`Đã vẽ xong ảnh tham chiếu cho Asset: ${name}! Media ID: ${result.media_id}`, "success", startedProjectId);
    } catch (err: any) {
      queueManager.addLog(`Lỗi vẽ ảnh Asset: ${err.message}`, "error", startedProjectId);
    } finally {
      setGeneratingAssetIds(prev => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
    }
  };

  const triggerGenerateShotImage = async (key: string) => {
    const startedProjectId = activeProjectId;
    setGeneratingShotKeys(prev => ({ ...prev, [key]: true }));
    queueManager.addLog(`Bắt đầu vẽ ảnh cho Shot: ${key}...`, "running", startedProjectId);

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

    if (mediaIds.length > 0) {
      queueManager.addLog(`Phát hiện ${mediaIds.length} ảnh tham chiếu cho Shot ${shotId}. Sử dụng chế độ Image-to-Image.`, "info", startedProjectId);
    }

    const keyframeObj = projectData.keyframes
      ? projectData.keyframes.find((k: any) => k.shot_id === shotId)
      : null;
    const promptText = keyframeObj?.keyframe_image_prompt || `Pixar keyframe for shot ${shotId}`;

    try {
      const result = await generateImageViaLocalApi(promptText, mediaIds.length > 0 ? mediaIds : undefined, accountId || undefined);

      // Isolated database update
      await updateProjectDataInDb(startedProjectId, (prevData) => {
        const copy = { ...prevData };
        copy.keyframes = copy.keyframes.map(k =>
          k.shot_id === shotId
            ? { ...k, url: result.url, media_id: result.media_id, account_id: result.account_id }
            : k
        );
        return copy;
      });

      setMockGeneratedShotImages(prev => ({ ...prev, [key]: true }));
      queueManager.addLog(`Đã vẽ xong ảnh cho Shot: ${shotId}! Media ID: ${result.media_id}`, "success", startedProjectId);
    } catch (err: any) {
      queueManager.addLog(`Lỗi vẽ ảnh cho Shot ${shotId}: ${err.message}`, "error", startedProjectId);
    } finally {
      setGeneratingShotKeys(prev => {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
    }
  };

  const triggerGenerateSegmentVideo = async (shotKey: string) => {
    const startedProjectId = activeProjectId;
    setGeneratingSegmentVideoKeys(prev => ({ ...prev, [shotKey]: true }));
    queueManager.addLog(`Bắt đầu gọi API local render video phân đoạn: ${shotKey}...`, "running", startedProjectId);

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
    const mediaId = keyframeObj?.media_id || "";
    const accountId = keyframeObj?.account_id || "";

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

    try {
      const payload: any = {
        prompt: promptText,
        aspect_ratio: videoAspectRatio || "VIDEO_ASPECT_RATIO_LANDSCAPE"
      };

      if (mediaId && !mediaId.startsWith("mock_")) {
        payload.media_ids = [mediaId];
        payload.account_id = accountId || "default_account";
      }

      if (audioReferenceMediaIds.length > 0) {
        payload.audioReferenceMediaIds = audioReferenceMediaIds;
      }

      // Call port 5000 API, set timeout to 10 minutes (600000 ms)
      const response = await fetch("http://127.0.0.1:5000/api/generate_video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Video API responded with status ${response.status}`);
      }

      const data = await response.json();
      if (data.success && data.videos && data.videos.length > 0) {
        const videoUrl = data.videos[0].url;

        // Isolated database update
        await updateProjectDataInDb(startedProjectId, (prevData) => {
          const copy = { ...prevData };
          if (motionIndex !== -1) {
            copy.motion_prompts = copy.motion_prompts.map((m, idx) =>
              idx === motionIndex ? { ...m, video_url: videoUrl } : m
            );
          } else {
            copy.motion_prompts = [
              ...(copy.motion_prompts || []),
              { shot_id: shotId, motion_description: promptText, video_url: videoUrl }
            ];
          }
          return copy;
        });

        setMockGeneratedSegmentVideos(prev => ({ ...prev, [shotKey]: true }));
        queueManager.addLog(`Đã render xong video phân đoạn ${shotId}! URL: ${videoUrl}`, "success", startedProjectId);
      } else {
        throw new Error("No video was returned from local API.");
      }
    } catch (err: any) {
      console.warn("Local Video API failed or offline. Error:", err.message);
      // Fallback: simulate success using mixkit forest video if offline/fails
      setMockGeneratedSegmentVideos(prev => ({ ...prev, [shotKey]: true }));
      queueManager.addLog(`Render video Shot ${shotId} thất bại (offline/error), sử dụng video mẫu.`, "info", startedProjectId);
    } finally {
      setGeneratingSegmentVideoKeys(prev => {
        const copy = { ...prev };
        delete copy[shotKey];
        return copy;
      });
    }
  };

  // Video renderer simulator
  const startVideoRendering = () => {
    if (projectData.motion_prompts.length === 0) {
      alert("Please run Motion Prompt AI (Step 7) first to plan the videos.");
      return;
    }
    setIsRenderingVideo(true);
    setVideoRenderPercent(0);
    setVideoRenderStage("Initialising Video Engine...");
    queueManager.addLog("Bắt đầu tiến trình Render Video...", "running", activeProjectId);

    const stages = [
      { p: 15, msg: "Compiling background environment references..." },
      { p: 30, msg: "Generating synthetic voice dialog tracks..." },
      { p: 55, msg: "Applying image style weights & rendering shots..." },
      { p: 75, msg: "Interpolating Veo 3 camera motion vectors (24fps)..." },
      { p: 90, msg: "Blending frames and rendering final audio mux..." },
      { p: 100, msg: "Compiling MP4 container..." }
    ];

    let currentStageIndex = 0;
    const interval = setInterval(() => {
      setVideoRenderPercent(prev => {
        const next = prev + Math.floor(Math.random() * 8) + 2;
        if (next >= 100) {
          clearInterval(interval);
          setVideoRenderStage("Render complete!");
          queueManager.addLog("Quá trình render video hoàn tất! File MP4 đã được tạo.", "success", activeProjectId);
          setTimeout(() => {
            setIsRenderingVideo(false);
            setIsVideoGenerated(true);
            setActiveTab("video"); // Redirect to the unified video tab!
          }, 800);
          return 100;
        }

        // Advance stage message
        if (currentStageIndex < stages.length && next >= stages[currentStageIndex].p) {
          setVideoRenderStage(stages[currentStageIndex].msg);
          queueManager.addLog(`[Render Engine] ${stages[currentStageIndex].msg}`, "info", activeProjectId);
          currentStageIndex++;
        }
        return next;
      });
    }, 250);
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
        return scene.description || `Scene ${scene.scene_id}`;
      }
      accumulatedTime += duration;
    }
    return "";
  };

  const getCinemaMovieTotalDuration = () => {
    if (!projectData.scenes) return 10;
    return projectData.scenes.reduce((acc, s) => acc + (s.duration_seconds || 5), 0);
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

  // Scan shot to match referenced assets
  const getReferencedAssetsForShot = (shot: any) => {
    const refs: { name: string; type: 'character' | 'environment' | 'prop'; key: string; url?: string }[] = [];
    const actionsLower = (shot.actions || "").toLowerCase();
    
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
      if (
        env.setting_name && 
        (settingLower.includes(env.setting_name.toLowerCase()) || 
         env.setting_name.toLowerCase().includes(settingLower) || 
         actionsLower.includes(env.setting_name.toLowerCase()))
      ) {
        if (!refs.some(r => r.name === env.setting_name)) {
          refs.push({ name: env.setting_name, type: 'environment', key: `env_${env.setting_name}`, url: env.url });
        }
      }
    });

    // Check props
    const shotProps = shot.props || [];
    projectData.props.forEach(prop => {
      if (
        prop.prop_name && 
        (actionsLower.includes(prop.prop_name.toLowerCase()) || 
         shotProps.some((p: any) => String(p).toLowerCase().includes(prop.prop_name.toLowerCase()) || prop.prop_name.toLowerCase().includes(String(p).toLowerCase())))
      ) {
        if (!refs.some(r => r.name === prop.prop_name)) {
          refs.push({ name: prop.prop_name, type: 'prop', key: `prop_${prop.prop_name}`, url: prop.url });
        }
      }
    });

    return refs;
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
            >
              <IconConfig />
              1. Cấu hình dự án
            </button>
            <button
              onClick={() => { setActiveTab("assets"); }}
              className={`tab-btn ${activeTab === "assets" ? "active" : ""}`}
            >
              <IconFolder />
              2. Lọc Assets
            </button>
            <button
              onClick={() => { setActiveTab("shots"); }}
              className={`tab-btn ${activeTab === "shots" ? "active" : ""}`}
            >
              <IconImage />
              3. Image Shots
            </button>
            <button
              onClick={() => { setActiveTab("video"); }}
              className={`tab-btn ${activeTab === "video" ? "active" : ""}`}
            >
              <IconFilm />
              4. Tạo video
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

                  {/* SUB TAB: Phân cảnh (Scenes) */}
                  {assetSubTab === "scenes" && (
                    <div>
                      {projectData.scenes.length === 0 ? (
                        <div style={{ padding: "40px", textAlign: "center", border: "1px dashed var(--border-color)", borderRadius: "var(--border-radius-lg)" }}>
                          <span style={{ display: "block", color: "var(--text-muted)", marginBottom: "16px" }}>
                            Chưa có dữ liệu phân cảnh. Vui lòng chạy Story Analyzer (Combo 1) trước.
                          </span>
                          <button onClick={runCombo1} className="sidebar-btn-new" style={{ margin: "0 auto" }}>
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
                      {projectData.characters.length === 0 ? (
                        <div style={{ padding: "40px", textAlign: "center", border: "1px dashed var(--border-color)", borderRadius: "var(--border-radius-lg)" }}>
                          <span style={{ display: "block", color: "var(--text-muted)", marginBottom: "16px" }}>
                            Chưa trích xuất nhân vật. Vui lòng chạy Combo 2 hoặc Character Extractor.
                          </span>
                          <button onClick={() => handleRunStep("character_extractor")} className="sidebar-btn-new" style={{ margin: "0 auto" }}>
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
                              const hasImg = !!(char.url || char.media_id) || mockGeneratedReferenceImages[`char_${char.name}`];
                              const isGen = !!generatingAssetIds[`char_${char.name}`];
                              return (
                                <div key={idx} className="glass-panel" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                                  <div style={{ aspectRatio: "16/9", position: "relative", background: "#060910", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    {hasImg ? (
                                      <>
                                        <img
                                          src={char.url || getAssetImage(char.name, 'character')}
                                          alt={char.name}
                                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                        />
                                        {char.media_id && (
                                          <span
                                            style={{
                                              position: "absolute",
                                              top: "8px",
                                              right: "8px",
                                              fontSize: "0.65rem",
                                              background: "#10b981",
                                              color: "#ffffff",
                                              padding: "2px 6px",
                                              borderRadius: "4px",
                                              fontWeight: 700
                                            }}
                                          >
                                            ✓ Đã có ID
                                          </span>
                                        )}
                                      </>
                                    ) : (
                                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                                      <span style={{ fontSize: "2rem" }}>👤</span>
                                      {isGen ? (
                                        <span style={{ fontSize: "0.75rem", color: "var(--accent-cyan)" }}>Vẽ ảnh...</span>
                                      ) : (
                                        <button
                                          onClick={() => triggerGenerateAssetImage(`char_${char.name}`)}
                                          className="btn-primary"
                                          style={{ padding: "6px 12px", fontSize: "0.75rem", borderRadius: "4px" }}
                                        >
                                          Vẽ ảnh tham chiếu
                                        </button>
                                      )}
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
                      {projectData.environments.length === 0 ? (
                        <div style={{ padding: "40px", textAlign: "center", border: "1px dashed var(--border-color)", borderRadius: "var(--border-radius-lg)" }}>
                          <span style={{ display: "block", color: "var(--text-muted)", marginBottom: "16px" }}>
                            Chưa trích xuất bối cảnh. Vui lòng chạy Combo 2 hoặc Environment Extractor.
                          </span>
                          <button onClick={() => handleRunStep("environment_extractor")} className="sidebar-btn-new" style={{ margin: "0 auto" }}>
                            Trích xuất bối cảnh
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "20px" }}>
                          {projectData.environments.map((env: any, idx) => {
                            const hasImg = !!(env.url || env.media_id) || mockGeneratedReferenceImages[`env_${env.setting_name}`];
                            const isGen = !!generatingAssetIds[`env_${env.setting_name}`];
                            return (
                              <div key={idx} className="glass-panel" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                                <div style={{ aspectRatio: "16/9", position: "relative", background: "#060910", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  {hasImg ? (
                                    <>
                                      <img
                                        src={env.url || getAssetImage(env.setting_name, 'environment')}
                                        alt={env.setting_name}
                                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                      />
                                      {env.media_id && (
                                        <span
                                          style={{
                                            position: "absolute",
                                            top: "8px",
                                            right: "8px",
                                            fontSize: "0.65rem",
                                            background: "#10b981",
                                            color: "#ffffff",
                                            padding: "2px 6px",
                                            borderRadius: "4px",
                                            fontWeight: 700
                                          }}
                                        >
                                          ✓ Đã có ID
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                                      <span style={{ fontSize: "2rem" }}>🏞️</span>
                                      {isGen ? (
                                        <span style={{ fontSize: "0.75rem", color: "var(--accent-cyan)" }}>Vẽ bối cảnh...</span>
                                      ) : (
                                        <button
                                          onClick={() => triggerGenerateAssetImage(`env_${env.setting_name}`)}
                                          className="btn-primary"
                                          style={{ padding: "6px 12px", fontSize: "0.75rem", borderRadius: "4px" }}
                                        >
                                          Vẽ ảnh tham chiếu
                                        </button>
                                      )}
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
                      {projectData.props.length === 0 ? (
                        <div style={{ padding: "40px", textAlign: "center", border: "1px dashed var(--border-color)", borderRadius: "var(--border-radius-lg)" }}>
                          <span style={{ display: "block", color: "var(--text-muted)", marginBottom: "16px" }}>
                            Chưa trích xuất đạo cụ. Vui lòng chạy Combo 2 hoặc Prop Extractor.
                          </span>
                          <button onClick={() => handleRunStep("prop_extractor")} className="sidebar-btn-new" style={{ margin: "0 auto" }}>
                            Trích xuất đạo cụ
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "20px" }}>
                          {projectData.props.map((prop: any, idx) => {
                            const hasImg = !!(prop.url || prop.media_id) || mockGeneratedReferenceImages[`prop_${prop.prop_name}`];
                            const isGen = !!generatingAssetIds[`prop_${prop.prop_name}`];
                            return (
                              <div key={idx} className="glass-panel" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                                <div style={{ aspectRatio: "16/9", position: "relative", background: "#060910", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  {hasImg ? (
                                    <>
                                      <img
                                        src={prop.url || getAssetImage(prop.prop_name, 'prop')}
                                        alt={prop.prop_name}
                                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                      />
                                      {prop.media_id && (
                                        <span
                                          style={{
                                            position: "absolute",
                                            top: "8px",
                                            right: "8px",
                                            fontSize: "0.65rem",
                                            background: "#10b981",
                                            color: "#ffffff",
                                            padding: "2px 6px",
                                            borderRadius: "4px",
                                            fontWeight: 700
                                          }}
                                        >
                                          ✓ Đã có ID
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                                      <span style={{ fontSize: "2rem" }}>🎒</span>
                                      {isGen ? (
                                        <span style={{ fontSize: "0.75rem", color: "var(--accent-cyan)" }}>Vẽ đạo cụ...</span>
                                      ) : (
                                        <button
                                          onClick={() => triggerGenerateAssetImage(`prop_${prop.prop_name}`)}
                                          className="btn-primary"
                                          style={{ padding: "6px 12px", fontSize: "0.75rem", borderRadius: "4px" }}
                                        >
                                          Vẽ ảnh tham chiếu
                                        </button>
                                      )}
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
                      <button onClick={() => handleRunStep("shot_planner")} className="sidebar-btn-new" style={{ margin: "0 auto" }}>
                        Lên kế hoạch camera
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                      {projectData.shots.map((shot: any, idx) => {
                        const shotKey = `shot_${shot.scene_number || shot.scene_id || ''}_${shot.shot_id}`;
                        const keyframeObj = projectData.keyframes 
                          ? projectData.keyframes.find((k: any) => k.shot_id === shot.shot_id)
                          : null;
                        const keyframePrompt = keyframeObj?.keyframe_image_prompt || "";
                        const keyframeUrl = keyframeObj?.url || "";
                        const hasImg = !!keyframeUrl || mockGeneratedShotImages[shotKey];
                        const isGen = !!generatingShotKeys[shotKey];

                        return (
                          <div key={idx} className="glass-panel" style={{ padding: "16px", display: "grid", gridTemplateColumns: "180px 1fr", gap: "16px", alignItems: "start" }}>
                            <div style={{ aspectRatio: "16/9", background: "#060910", borderRadius: "8px", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              {hasImg ? (
                                <img
                                  src={keyframeUrl || getAssetImage(shot.actions || "", 'environment')}
                                  alt={`Shot ${shot.scene_id}.${shot.shot_id}`}
                                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                />
                              ) : (
                                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                                  {isGen ? (
                                    <span style={{ fontSize: "0.7rem", color: "var(--accent-cyan)" }}>Sinh ảnh...</span>
                                  ) : (
                                    <button
                                      onClick={() => triggerGenerateShotImage(shotKey)}
                                      className="btn-primary"
                                      style={{ padding: "4px 8px", fontSize: "0.7rem", borderRadius: "4px" }}
                                    >
                                      Sinh ảnh Shot
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <h4 style={{ color: "#a78bfa", fontSize: "0.9rem" }}>
                                  Shot {shot.scene_id}.{shot.shot_id} (Scene {shot.scene_id})
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
                                <button
                                  onClick={() => handleRunStep("keyframe_generator")}
                                  className="btn-secondary"
                                  style={{ padding: "4px 8px", fontSize: "0.7rem", borderRadius: "4px", width: "fit-content", marginTop: "4px" }}
                                >
                                  Generate Prompt ảnh vẽ
                                </button>
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

                    {/* Global Render options */}
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "#0b0f19", padding: "8px 16px", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: 700 }}>ĐỘ PHÂN GIẢI</span>
                        <select className="custom-select" defaultValue="1080" style={{ padding: "4px 8px", fontSize: "0.75rem", background: "transparent", border: "none", color: "#ffffff" }}>
                          <option value="1080">FHD (1920x1080)</option>
                          <option value="720">HD (1280x720)</option>
                        </select>
                      </div>

                      <div style={{ width: "1px", height: "24px", background: "rgba(255,255,255,0.08)" }} />

                      <button
                        onClick={startVideoRendering}
                        disabled={isRenderingVideo || projectData.motion_prompts.length === 0}
                        className="btn-primary"
                        style={{
                          padding: "6px 12px",
                          fontSize: "0.75rem",
                          borderRadius: "6px",
                          background: "linear-gradient(135deg, #7c3aed, #db2777)"
                        }}
                      >
                        {isRenderingVideo ? `Rendering (${videoRenderPercent}%)` : "🎬 Render phim hoàn chỉnh"}
                      </button>
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
                            ref={videoRef}
                            src="https://assets.mixkit.co/videos/preview/mixkit-beautiful-aerial-view-of-forest-and-mountains-42646-large.mp4"
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

                  {/* Action panel: Generate Motion Prompts / Render Selected Videos */}
                  {projectData.shots.length > 0 && (
                    <div className="glass-panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px" }}>
                      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                        <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                          Công cụ AI:
                        </span>
                        <button
                          onClick={() => handleRunStep("motion_generator")}
                          className="btn-primary"
                          style={{
                            padding: "6px 12px",
                            fontSize: "0.75rem",
                            borderRadius: "4px",
                            background: "rgba(139,92,246,0.2)",
                            border: "1px solid rgba(139,92,246,0.4)",
                            color: "#a78bfa"
                          }}
                        >
                          🔮 Tự động sinh mô tả chuyển động (Step 7)
                        </button>
                      </div>

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
                        const hasShotImg = !!keyframeUrl || mockGeneratedShotImages[shotKey];
                        
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
                        const isGenVideo = !!generatingSegmentVideoKeys[shotKey];
                        
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
                                  border: "1px solid rgba(255,255,255,0.04)",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center"
                                }}
                              >
                                {hasShotImg ? (
                                  <img
                                    src={keyframeUrl || getAssetImage(shot.actions || "", 'environment')}
                                    alt={`Shot ${shot.scene_id}.${shot.shot_id}`}
                                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                  />
                                ) : (
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                                    <span style={{ fontSize: "1.2rem" }}>🖼️</span>
                                    <button
                                      onClick={() => triggerGenerateShotImage(shotKey)}
                                      className="btn-primary"
                                      style={{ padding: "4px 8px", fontSize: "0.65rem", borderRadius: "3px" }}
                                    >
                                      Sinh ảnh shot
                                    </button>
                                  </div>
                                )}
                              </div>
                              <button
                                onClick={() => {
                                  if (hasShotImg) {
                                    alert(`[Shot ${shot.scene_id}.${shot.shot_id}]\nHành động: ${shot.actions}\nGóc quay: ${shot.framing} | Chuyển động: ${shot.camera_movement}`);
                                  } else {
                                    triggerGenerateShotImage(shotKey);
                                  }
                                }}
                                className="btn-secondary"
                                style={{
                                  width: "100%",
                                  padding: "4px 8px",
                                  fontSize: "0.7rem",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  gap: "4px"
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
                                {hasVideo ? (
                                  <video
                                    src={videoUrl || "https://assets.mixkit.co/videos/preview/mixkit-beautiful-aerial-view-of-forest-and-mountains-42646-large.mp4"}
                                    controls
                                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                  />
                                ) : (
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                                    {isGenVideo ? (
                                      <span style={{ fontSize: "0.68rem", color: "var(--accent-cyan)", fontWeight: 600 }}>Rendering...</span>
                                    ) : (
                                      <>
                                        <span style={{ fontSize: "1.2rem" }}>🎬</span>
                                        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>Chưa tạo video</span>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div style={{ display: "flex", gap: "4px" }}>
                                <button
                                  onClick={() => triggerGenerateSegmentVideo(shotKey)}
                                  disabled={isGenVideo}
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
          {/* Collapsible System Logs Terminal Panel */}
          <div
            style={{
              marginTop: "24px",
              background: "#080c14",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
            }}
          >
            {/* Terminal Header */}
            <div
              onClick={() => setShowLogsPanel(!showLogsPanel)}
              style={{
                background: "#0d1321",
                padding: "10px 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
                borderBottom: showLogsPanel ? "1px solid var(--border-color)" : "none",
                userSelect: "none"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "1rem" }}>💻</span>
                <span style={{ fontSize: "0.85rem", fontWeight: 700, letterSpacing: "0.03em", color: "#a78bfa" }}>
                  SYSTEM LOGS TERMINAL
                </span>
                
                {/* Stats indicators */}
                {systemLogs.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "12px" }}>
                    <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                      ({systemLogs.length} logs)
                    </span>
                    {systemLogs.some(l => l.type === "running") && (
                      <span className="pulse-dot" style={{ display: "inline-block", width: "8px", height: "8px", background: "#38bdf8", borderRadius: "50%" }} />
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "16px" }} onClick={(e) => e.stopPropagation()}>
                {/* Filter toggle */}
                <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "0.72rem", color: "var(--text-secondary)" }}>
                  <input
                    type="checkbox"
                    checked={filterLogsCurrentProj}
                    onChange={(e) => setFilterLogsCurrentProj(e.target.checked)}
                    style={{ cursor: "pointer" }}
                  />
                  Lọc theo dự án hiện tại
                </label>

                {/* Clear button */}
                <button
                  onClick={() => queueManager.clearLogs()}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "rgba(239, 68, 68, 0.7)",
                    fontSize: "0.72rem",
                    cursor: "pointer",
                    padding: "2px 6px",
                    borderRadius: "4px"
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = "rgba(239, 68, 68, 1)"}
                  onMouseLeave={(e) => e.currentTarget.style.color = "rgba(239, 68, 68, 0.7)"}
                >
                  Xóa Logs
                </button>

                {/* Collapse button */}
                <button
                  onClick={() => setShowLogsPanel(!showLogsPanel)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--text-secondary)",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    padding: "2px"
                  }}
                >
                  {showLogsPanel ? "▼" : "▲"}
                </button>
              </div>
            </div>

            {/* Terminal Body */}
            {showLogsPanel && (
              <div
                style={{
                  height: "160px",
                  overflowY: "auto",
                  padding: "12px 16px",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.75rem",
                  lineHeight: 1.5,
                  display: "flex",
                  flexDirection: "column",
                  background: "#05080f",
                  scrollBehavior: "smooth"
                }}
              >
                {(() => {
                  const filtered = filterLogsCurrentProj
                    ? systemLogs.filter(l => l.projectId === activeProjectId)
                    : systemLogs;

                  if (filtered.length === 0) {
                    return (
                      <div style={{ color: "var(--text-muted)", fontStyle: "italic", textAlign: "center", marginTop: "40px" }}>
                        Chưa có log hệ thống nào được ghi nhận.
                      </div>
                    );
                  }

                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {filtered.map((log, idx) => {
                        let badgeColor = "#9ca3af";
                        let textColor = "var(--text-primary)";
                        let prefix = "[INFO]";

                        if (log.type === "success") {
                          badgeColor = "#10b981";
                          textColor = "#10b981";
                          prefix = "[SUCCESS]";
                        } else if (log.type === "error") {
                          badgeColor = "#f87171";
                          textColor = "#f87171";
                          prefix = "[ERROR]";
                        } else if (log.type === "running") {
                          badgeColor = "#38bdf8";
                          textColor = "#38bdf8";
                          prefix = "[RUNNING]";
                        }

                        return (
                          <div key={idx} className="terminal-console-line">
                            <span style={{ color: "rgba(255,255,255,0.25)", flexShrink: 0 }}>
                              [{log.timestamp}]
                            </span>
                            <span style={{ color: badgeColor, fontWeight: 700, flexShrink: 0, minWidth: "75px" }}>
                              {prefix}
                            </span>
                            <span style={{ color: textColor }}>
                              {log.message}
                            </span>
                          </div>
                        );
                      })}
                      <div ref={logsEndRef} />
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
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
    </div>
  );
}
