import { StepKey, PipelineStep } from "../components/PipelineProgress";
import { SavedProject, saveProject, getProject } from "./db";

export interface MediaTask {
  id: string;
  projectId: string;
  projectName: string;
  type: "character" | "environment" | "prop" | "shot_image" | "shot_video";
  targetId: string; // name of character, setting_name of environment, prop_name of prop, or full shotKey
  status: "pending" | "running" | "success" | "failed";
  prompt: string;
  error?: string;
  params?: any;
}

const getBackendUrl = () => {
  if (typeof window !== "undefined") {
    return `http://${window.location.hostname}:8000`;
  }
  return "http://127.0.0.1:8000";
};

export interface ProjectTaskState {
  projectId: string;
  status: "idle" | "running" | "success" | "failed" | "paused";
  activeStep: StepKey | null;
  isRunningAll: boolean;
  error?: string;
}

export interface SystemLog {
  timestamp: string;
  type: "info" | "success" | "error" | "running";
  message: string;
  projectId?: string;
}

type TaskListener = (projectId: string, state: ProjectTaskState, projectData?: any, steps?: any) => void;
type LogListener = (logs: SystemLog[]) => void;

const STEP_LABELS: Record<string, string> = {
  story_analyzer: "Phân tích kịch bản thô & chia nhỏ cấu trúc từng Scene (Story Analyzer)",
  character_extractor: "Bóc tách nhân vật, trang phục & Turnaround Prompts (Character Extractor)",
  environment_extractor: "Bóc tách bối cảnh, địa điểm & không gian 3D Pixar (Environment Extractor)",
  prop_extractor: "Bóc tách đạo cụ & vật thể trong từng cảnh (Prop Extractor)",
  shot_planner: "Lập kế hoạch phân cảnh, góc quay camera & Shot Prompts (Shot Planner)",
  keyframe_generator: "Tạo Prompt ảnh tham chiếu Keyframe (Keyframe Generator)",
  motion_generator: "Tạo Veo 3 Video Motion Prompts cho từng shot (Motion Generator)",
};

const getStepText = (key: string) => STEP_LABELS[key] || key;

class BackgroundQueueManager {
  private tasks: Map<string, ProjectTaskState> = new Map();
  private listeners: Set<TaskListener> = new Set();
  private activePromises: Map<string, Promise<any>> = new Map();
  private systemLogs: SystemLog[] = [];
  private logListeners: Set<LogListener> = new Set();
  private dbWriteQueue: Promise<any> = Promise.resolve();
  private imageAccountRRIndex: number = 0;

  private async uploadImageToGoogle(imagePathOrUrl: string, accountId: string): Promise<string | null> {
    try {
      const res = await fetch("/api/upload-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagePath: imagePathOrUrl, accountId })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.media_id) {
          return data.media_id;
        }
      }
    } catch (err) {
      console.error("Error auto-uploading image to Google via upload-image API:", err);
    }
    return null;
  }

  private async safeUpdateProject(projectId: string, updater: (project: SavedProject) => SavedProject | Promise<SavedProject>) {
    this.dbWriteQueue = this.dbWriteQueue.then(async () => {
      try {
        const project = await getProject(projectId);
        if (!project) {
          console.error(`Project not found in DB: ${projectId}`);
          return;
        }
        const updatedProject = await updater(project);
        await saveProject(updatedProject);
        return updatedProject;
      } catch (err) {
        console.error("Error in safeUpdateProject:", err);
      }
    });
    return this.dbWriteQueue;
  }

  subscribe(listener: TaskListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(projectId: string, state: ProjectTaskState, projectData?: any, steps?: any) {
    this.listeners.forEach(listener => {
      try {
        listener(projectId, state, projectData, steps);
      } catch (err) {
        console.error("Error in queue listener:", err);
      }
    });
  }

  subscribeLogs(listener: LogListener) {
    this.logListeners.add(listener);
    // Send current logs immediately
    listener(this.systemLogs);
    return () => {
      this.logListeners.delete(listener);
    };
  }

  private notifyLogs() {
    this.logListeners.forEach(listener => {
      try {
        listener([...this.systemLogs]);
      } catch (err) {
        console.error("Error in log listener:", err);
      }
    });
  }

  addLog(message: string, type: "info" | "success" | "error" | "running" = "info", projectId?: string) {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const logEntry: SystemLog = { timestamp, type, message, projectId };
    this.systemLogs.push(logEntry);
    if (this.systemLogs.length > 200) {
      this.systemLogs.shift();
    }
    this.notifyLogs();
  }

  clearLogs() {
    this.systemLogs = [];
    this.notifyLogs();
  }

  getLogs(): SystemLog[] {
    return this.systemLogs;
  }

  private pausedProjects: Set<string> = new Set();

  isTaskPaused(projectId: string): boolean {
    return this.pausedProjects.has(projectId);
  }

  pauseTask(projectId: string) {
    this.pausedProjects.add(projectId);
    const state = this.getTaskState(projectId);
    const updatedState: ProjectTaskState = {
      ...state,
      status: "paused",
      isPaused: true,
    };
    this.tasks.set(projectId, updatedState);
    this.notify(projectId, updatedState);
    this.addLog(`[Hệ thống] ⏸ Đã tạm dừng quá trình xử lý kịch bản. Nhấn "Tạo tiếp" để tiếp tục bất kỳ lúc nào.`, "info", projectId);
  }

  resumeTask(projectId: string) {
    this.pausedProjects.delete(projectId);
    const state = this.getTaskState(projectId);
    const updatedState: ProjectTaskState = {
      ...state,
      status: "running",
      isPaused: false,
    };
    this.tasks.set(projectId, updatedState);
    this.notify(projectId, updatedState);
    this.addLog(`[Hệ thống] ▶ Đang tiếp tục xử lý kịch bản từ các phân cảnh chưa hoàn thành...`, "running", projectId);
  }

  getTaskState(projectId: string): ProjectTaskState {
    const state = this.tasks.get(projectId);
    if (state) return state;
    return {
      projectId,
      status: this.isTaskPaused(projectId) ? "paused" : "idle",
      activeStep: null,
      isRunningAll: false,
      isPaused: this.isTaskPaused(projectId),
    };
  }

  isTaskRunning(projectId: string): boolean {
    const state = this.getTaskState(projectId);
    return state.status === "running";
  }

  // Run a single step in the background
  async runStep(params: {
    projectId: string;
    projectName: string;
    stepKey: StepKey;
    storyboard: string;
    projectData: any;
    steps: PipelineStep[];
    apiKeys: string[];
    selectedModel: string;
    rpmLimit: number;
    chunkSize: number;
    custom_instructions?: string;
  }) {
    const { projectId, stepKey } = params;
    const taskKey = `${projectId}_${stepKey}`;

    if (this.activePromises.has(taskKey)) {
      return; // Already running this step
    }

    const taskState: ProjectTaskState = {
      projectId,
      status: "running",
      activeStep: stepKey,
      isRunningAll: false,
    };
    this.tasks.set(projectId, taskState);
    this.notify(projectId, taskState);
    if (stepKey === "story_analyzer") {
      this.addLog(`[Bộ Lọc Local] ⚡ Đang phân tích kịch bản qua Bộ Lọc Thủ Công (0 Tokens)...`, "running", projectId);
    } else {
      this.addLog(`[Gemini AI] ⏳ Đang phân tích: ${getStepText(stepKey)}...`, "running", projectId);
    }

    const promise = this.executeStepApi(params)
      .then(async (updatedData) => {
        const updatedSteps = params.steps.map((s) =>
          s.key === stepKey ? { ...s, status: "success" as const, error: undefined } : s
        );

        // Save progress to IndexedDB
        const savedProj: SavedProject = {
          id: projectId,
          name: params.projectName,
          updatedAt: new Date().toISOString(),
          storyboard: params.storyboard,
          projectData: updatedData,
          steps: updatedSteps,
          model: params.selectedModel,
        };
        await saveProject(savedProj);
        if (stepKey === "story_analyzer") {
          this.addLog(`[Bộ Lọc Local] ⚡ Hoàn thành bóc tách Scene qua Bộ Lọc Thủ Công (0 Tokens consumed)!`, "success", projectId);
        } else {
          this.addLog(`[Gemini AI] ✅ Hoàn thành: ${getStepText(stepKey)}!`, "success", projectId);
        }

        const finalState: ProjectTaskState = {
          projectId,
          status: "success",
          activeStep: null,
          isRunningAll: false,
        };
        this.tasks.delete(projectId);
        this.notify(projectId, finalState, updatedData, updatedSteps);
      })
      .catch(async (err: any) => {
        const updatedSteps = params.steps.map((s) =>
          s.key === stepKey ? { ...s, status: "failed" as const, error: err.message } : s
        );

        const savedProj: SavedProject = {
          id: projectId,
          name: params.projectName,
          updatedAt: new Date().toISOString(),
          storyboard: params.storyboard,
          projectData: params.projectData,
          steps: updatedSteps,
          model: params.selectedModel,
        };
        await saveProject(savedProj);
        this.addLog(`Bước "${stepKey}" thất bại: ${err.message}`, "error", projectId);

        const finalState: ProjectTaskState = {
          projectId,
          status: "failed",
          activeStep: null,
          isRunningAll: false,
          error: err.message,
        };
        this.tasks.set(projectId, finalState);
        this.notify(projectId, finalState, params.projectData, updatedSteps);
      })
      .finally(() => {
        this.activePromises.delete(taskKey);
      });

    this.activePromises.set(taskKey, promise);
  }

  // Run Combo 1 steps sequentially in the background (Story -> Shot Planner -> Keyframe Generator)
  async runCombo1(params: {
    projectId: string;
    projectName: string;
    storyboard: string;
    apiKeys: string[];
    selectedModel: string;
    rpmLimit: number;
    chunkSize: number;
    initialSteps: PipelineStep[];
    projectData: any;
  }) {
    const { projectId } = params;
    const taskKey = `${projectId}_combo1`;

    if (this.activePromises.has(taskKey)) {
      return; // Already running combo 1
    }

    const taskState: ProjectTaskState = {
      projectId,
      status: "running",
      activeStep: "story_analyzer",
      isRunningAll: false,
    };
    this.tasks.set(projectId, taskState);
    this.notify(projectId, taskState);
    this.addLog(`Bắt đầu chạy Combo 1 (Tạo Prompt) cho dự án "${params.projectName}"...`, "running", projectId);

    const promise = (async () => {
      let currentData = { ...params.projectData };
      let currentSteps = [...params.initialSteps];

      const runAndSave = async (stepKey: StepKey) => {
        this.tasks.set(projectId, {
          projectId,
          status: "running",
          activeStep: stepKey,
          isRunningAll: false,
        });
        currentSteps = currentSteps.map(s => s.key === stepKey ? { ...s, status: "running" as const } : s);
        this.notify(projectId, this.getTaskState(projectId), currentData, currentSteps);
        if (stepKey === "story_analyzer") {
          this.addLog(`[Bộ Lọc Local] ⚡ Đang phân tích kịch bản qua Bộ Lọc Thủ Công (0 Tokens)...`, "running", projectId);
        } else {
          this.addLog(`[Gemini AI] ⏳ Đang phân tích: ${getStepText(stepKey)}...`, "running", projectId);
        }

        const updatedData = await this.executeStepApi({
          ...params,
          stepKey,
          projectData: currentData,
          steps: currentSteps,
        });

        currentData = updatedData;
        if (stepKey === "character_extractor") {
          currentSteps = currentSteps.map(s => 
            ["character_extractor", "environment_extractor", "prop_extractor"].includes(s.key) 
              ? { ...s, status: "success" as const } 
              : s
          );
        } else {
          currentSteps = currentSteps.map(s => s.key === stepKey ? { ...s, status: "success" as const } : s);
        }
        if (stepKey === "story_analyzer") {
          this.addLog(`[Bộ Lọc Local] ⚡ Hoàn thành bóc tách Scene qua Bộ Lọc Thủ Công (0 Tokens consumed)!`, "success", projectId);
        } else {
          this.addLog(`[Gemini AI] ✅ Hoàn thành: ${getStepText(stepKey)}!`, "success", projectId);
        }

        // Save progress to IndexedDB
        const savedProj: SavedProject = {
          id: projectId,
          name: params.projectName,
          updatedAt: new Date().toISOString(),
          storyboard: params.storyboard,
          projectData: currentData,
          steps: currentSteps,
          model: params.selectedModel,
        };
        await saveProject(savedProj);
      };

      try {
        await runAndSave("story_analyzer");
        await runAndSave("character_extractor");
        await runAndSave("shot_planner");

        const finalState: ProjectTaskState = {
          projectId,
          status: "success",
          activeStep: null,
          isRunningAll: false,
        };
        this.tasks.delete(projectId);
        this.notify(projectId, finalState, currentData, currentSteps);
        this.addLog(`Combo 1 hoàn thành toàn bộ các bước thành công!`, "success", projectId);
      } catch (err: any) {
        const runningStep = this.getTaskState(projectId).activeStep;
        if (runningStep) {
          currentSteps = currentSteps.map(s => s.key === runningStep ? { ...s, status: "failed" as const, error: err.message } : s);
        }

        const savedProj: SavedProject = {
          id: projectId,
          name: params.projectName,
          updatedAt: new Date().toISOString(),
          storyboard: params.storyboard,
          projectData: currentData,
          steps: currentSteps,
          model: params.selectedModel,
        };
        await saveProject(savedProj);

        const finalState: ProjectTaskState = {
          projectId,
          status: "failed",
          activeStep: null,
          isRunningAll: false,
          error: err.message,
        };
        this.tasks.set(projectId, finalState);
        this.notify(projectId, finalState, currentData, currentSteps);
        this.addLog(`Combo 1 thất bại tại bước "${runningStep || 'unknown'}": ${err.message}`, "error", projectId);
      }
    })().finally(() => {
      this.activePromises.delete(taskKey);
    });

    this.activePromises.set(taskKey, promise);
  }

  // Run Combo 2 steps sequentially in the background
  async runCombo2(params: {
    projectId: string;
    projectName: string;
    storyboard: string;
    apiKeys: string[];
    selectedModel: string;
    rpmLimit: number;
    chunkSize: number;
    initialSteps: PipelineStep[];
    projectData: any;
  }) {
    const { projectId } = params;
    const taskKey = `${projectId}_combo2`;

    if (this.activePromises.has(taskKey)) {
      return; // Already running combo 2
    }

    const taskState: ProjectTaskState = {
      projectId,
      status: "running",
      activeStep: "character_extractor",
      isRunningAll: false,
    };
    this.tasks.set(projectId, taskState);
    this.notify(projectId, taskState);
    this.addLog(`Bắt đầu chạy Combo 2 (Prompt + Ảnh tham chiếu) cho dự án "${params.projectName}"...`, "running", projectId);

    const promise = (async () => {
      let currentData = { ...params.projectData };
      let currentSteps = [...params.initialSteps];

      const runAndSave = async (stepKey: StepKey) => {
        this.tasks.set(projectId, {
          projectId,
          status: "running",
          activeStep: stepKey,
          isRunningAll: false,
        });
        currentSteps = currentSteps.map(s => s.key === stepKey ? { ...s, status: "running" as const } : s);
        this.notify(projectId, this.getTaskState(projectId), currentData, currentSteps);
        if (stepKey === "story_analyzer") {
          this.addLog(`[Bộ Lọc Local] ⚡ Đang phân tích kịch bản qua Bộ Lọc Thủ Công (0 Tokens)...`, "running", projectId);
        } else {
          this.addLog(`[Gemini AI] ⏳ Đang phân tích: ${getStepText(stepKey)}...`, "running", projectId);
        }

        const updatedData = await this.executeStepApi({
          ...params,
          stepKey,
          projectData: currentData,
          steps: currentSteps,
        });

        currentData = updatedData;
        currentSteps = currentSteps.map(s => s.key === stepKey ? { ...s, status: "success" as const } : s);
        if (stepKey === "story_analyzer") {
          this.addLog(`[Bộ Lọc Local] ⚡ Hoàn thành bóc tách Scene qua Bộ Lọc Thủ Công (0 Tokens consumed)!`, "success", projectId);
        } else {
          this.addLog(`[Gemini AI] ✅ Hoàn thành: ${getStepText(stepKey)}!`, "success", projectId);
        }

        // Save progress to IndexedDB
        const savedProj: SavedProject = {
          id: projectId,
          name: params.projectName,
          updatedAt: new Date().toISOString(),
          storyboard: params.storyboard,
          projectData: currentData,
          steps: currentSteps,
          model: params.selectedModel,
        };
        await saveProject(savedProj);
      };

      try {
        // If story_analyzer has not run yet, run it first!
        if (currentData.scenes.length === 0) {
          await runAndSave("story_analyzer");
        }
        await runAndSave("character_extractor");
        await runAndSave("environment_extractor");
        await runAndSave("prop_extractor");

        const finalState: ProjectTaskState = {
          projectId,
          status: "success",
          activeStep: null,
          isRunningAll: false,
        };
        this.tasks.delete(projectId);
        this.notify(projectId, finalState, currentData, currentSteps);
        this.addLog(`Combo 2 hoàn thành toàn bộ các bước thành công!`, "success", projectId);
      } catch (err: any) {
        const runningStep = this.getTaskState(projectId).activeStep;
        if (runningStep) {
          currentSteps = currentSteps.map(s => s.key === runningStep ? { ...s, status: "failed" as const, error: err.message } : s);
        }

        const savedProj: SavedProject = {
          id: projectId,
          name: params.projectName,
          updatedAt: new Date().toISOString(),
          storyboard: params.storyboard,
          projectData: currentData,
          steps: currentSteps,
          model: params.selectedModel,
        };
        await saveProject(savedProj);

        const finalState: ProjectTaskState = {
          projectId,
          status: "failed",
          activeStep: null,
          isRunningAll: false,
          error: err.message,
        };
        this.tasks.set(projectId, finalState);
        this.notify(projectId, finalState, currentData, currentSteps);
        this.addLog(`Combo 2 thất bại tại bước "${runningStep || 'unknown'}": ${err.message}`, "error", projectId);
      }
    })().finally(() => {
      this.activePromises.delete(taskKey);
    });

    this.activePromises.set(taskKey, promise);
  }

  // Run all pipeline steps in sequence
  async runAllPipeline(params: {
    projectId: string;
    projectName: string;
    storyboard: string;
    apiKeys: string[];
    selectedModel: string;
    rpmLimit: number;
    chunkSize: number;
    initialSteps: PipelineStep[];
    pcDirectory?: string;
  }) {
    const { projectId } = params;
    const taskKey = `${projectId}_all`;

    if (this.activePromises.has(taskKey)) {
      return; // Already running full pipeline
    }

    const taskState: ProjectTaskState = {
      projectId,
      status: "running",
      activeStep: "story_analyzer",
      isRunningAll: true,
    };
    this.tasks.set(projectId, taskState);
    this.notify(projectId, taskState);
    this.addLog(`Bắt đầu chạy Combo 3 (Tự động toàn bộ) cho dự án "${params.projectName}"...`, "running", projectId);

    const promise = (async () => {
      let currentData = {
        scenes: [],
        characters: [],
        environments: [],
        props: [],
        shots: [],
        keyframes: [],
        motion_prompts: [],
        pcDirectory: params.pcDirectory || "",
      };
      
      let currentSteps: PipelineStep[] = params.initialSteps.map(s => ({ ...s, status: "idle" as const, error: undefined }));

      const runAndSave = async (stepKey: StepKey) => {
        // Update task state with active step
        this.tasks.set(projectId, {
          projectId,
          status: "running",
          activeStep: stepKey,
          isRunningAll: true,
        });
        currentSteps = currentSteps.map(s => s.key === stepKey ? { ...s, status: "running" as const } : s);
        this.notify(projectId, this.getTaskState(projectId), currentData, currentSteps);
        if (stepKey === "story_analyzer") {
          this.addLog(`[Bộ Lọc Local] ⚡ Đang phân tích kịch bản qua Bộ Lọc Thủ Công (0 Tokens)...`, "running", projectId);
        } else {
          this.addLog(`[Gemini AI] ⏳ Đang phân tích: ${getStepText(stepKey)}...`, "running", projectId);
        }

        const updatedData = await this.executeStepApi({
          ...params,
          stepKey,
          projectData: currentData,
          steps: currentSteps,
        });

        currentData = updatedData;
        currentSteps = currentSteps.map(s => s.key === stepKey ? { ...s, status: "success" as const } : s);
        if (stepKey === "story_analyzer") {
          this.addLog(`[Bộ Lọc Local] ⚡ Hoàn thành bóc tách Scene qua Bộ Lọc Thủ Công (0 Tokens consumed)!`, "success", projectId);
        } else {
          this.addLog(`[Gemini AI] ✅ Hoàn thành: ${getStepText(stepKey)}!`, "success", projectId);
        }

        // Save progress to IndexedDB
        const savedProj: SavedProject = {
          id: projectId,
          name: params.projectName,
          updatedAt: new Date().toISOString(),
          storyboard: params.storyboard,
          projectData: currentData,
          steps: currentSteps,
          model: params.selectedModel,
        };
        await saveProject(savedProj);
      };

      try {
        // Step 1: Analyze Story
        await runAndSave("story_analyzer");
        // Step 2: Extract Characters
        await runAndSave("character_extractor");
        // Step 3: Extract Environments
        await runAndSave("environment_extractor");
        // Step 4: Extract Props
        await runAndSave("prop_extractor");
        // Step 5: Plan Shots
        await runAndSave("shot_planner");
        // Step 6: Generate Keyframe Prompts
        await runAndSave("keyframe_generator");
        // Step 7: Generate Motion Prompts
        await runAndSave("motion_generator");

        const finalState: ProjectTaskState = {
          projectId,
          status: "success",
          activeStep: null,
          isRunningAll: false,
        };
        this.tasks.delete(projectId);
        this.notify(projectId, finalState, currentData, currentSteps);
        this.addLog(`Combo 3 (Tự động toàn bộ) hoàn thành toàn bộ các bước thành công!`, "success", projectId);
      } catch (err: any) {
        const runningStep = this.getTaskState(projectId).activeStep;
        if (runningStep) {
          currentSteps = currentSteps.map(s => s.key === runningStep ? { ...s, status: "failed" as const, error: err.message } : s);
        }

        const savedProj: SavedProject = {
          id: projectId,
          name: params.projectName,
          updatedAt: new Date().toISOString(),
          storyboard: params.storyboard,
          projectData: currentData,
          steps: currentSteps,
          model: params.selectedModel,
        };
        await saveProject(savedProj);

        const finalState: ProjectTaskState = {
          projectId,
          status: "failed",
          activeStep: null,
          isRunningAll: false,
          error: err.message,
        };
        this.tasks.set(projectId, finalState);
        this.notify(projectId, finalState, currentData, currentSteps);
        this.addLog(`Combo 3 thất bại tại bước "${runningStep || 'unknown'}": ${err.message}`, "error", projectId);
      }
    })().finally(() => {
      this.activePromises.delete(taskKey);
    });

    this.activePromises.set(taskKey, promise);
  }

  private async executeStepApi(params: {
    stepKey: StepKey;
    storyboard: string;
    projectData: any;
    apiKeys: string[];
    selectedModel: string;
    rpmLimit: number;
    chunkSize: number;
    [key: string]: any;
  }) {
    const { stepKey, storyboard, projectData, apiKeys, selectedModel, rpmLimit, chunkSize, custom_instructions } = params;
    
    const BACKEND_URL = getBackendUrl();
    let url = "";
    let bodyPayload: any = {};

    // Helper to map scenes to backend format
    const mapScenesToBackend = (scenesList: any[]) => {
      return (scenesList || []).map((scene: any) => ({
        scene_number: Number(scene.scene_id || 0),
        duration_seconds: Number(scene.duration_seconds || 5),
        characters: scene.characters || [],
        location: scene.setting || "",
        props: scene.props || [],
        action: scene.description || "",
        dialogue: (scene.dialogues || []).map((d: any) => ({
          character: d.character || "",
          speech: d.text || ""
        }))
      }));
    };

    // Helper to map characters to backend format
    const mapCharactersToBackend = (charList: any[]) => {
      return (charList || []).map((char: any, index: number) => {
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
    };

    // Helper to map environments to backend format
    const mapEnvironmentsToBackend = (envList: any[]) => {
      return (envList || []).map((env: any, index: number) => {
        const ename = env.setting_name || env.name || "";
        const eprompt = env.reference_prompt || env.prompt || "";
        return {
          id: env.id || `env_${Date.now()}_${index}`,
          name: ename,
          reference_prompt: eprompt,
          prompt: eprompt
        };
      });
    };

    // Helper to map props to backend format
    const mapPropsToBackend = (propList: any[]) => {
      return (propList || []).map((prop: any, index: number) => {
        const pname = prop.prop_name || prop.name || "";
        const pprompt = prop.reference_prompt || prop.prompt || "";
        return {
          id: prop.id || `prop_${Date.now()}_${index}`,
          name: pname,
          reference_prompt: pprompt,
          prompt: pprompt
        };
      });
    };

    // Helper to map shots to backend format
    const mapShotsToBackend = (shotList: any[]) => {
      const motionPrompts = projectData.motion_prompts || [];
      return (shotList || []).map((shot: any) => {
        const editedMotion = motionPrompts.find((m: any) => m.shot_id === shot.shot_id);
        return {
          shot_id: shot.shot_id || "",
          scene_number: Number(shot.scene_number || shot.scene_id || 0),
          duration_seconds: Number(shot.duration_seconds || 5),
          actions: shot.actions || "",
          characters: shot.characters || [],
          environment: shot.setting || shot.environment || "",
          props: shot.props || [],
          dialogue: (shot.dialogue || []).map((d: any) => ({
            character: d.character || "",
            speech: d.text || d.speech || ""
          })),
          camera_movement: shot.camera_movement || "",
          shot_type: shot.framing || shot.shot_type || "",
          transition: shot.transition || "Cut",
          composition: shot.composition || "Rule of Thirds",
          lighting: shot.lighting || "Warm lighting",
          camera: shot.camera || `${shot.framing || "Medium Shot"}, ${shot.camera_movement || "Static"}`,
          timeline: shot.timeline || [],
          motion: shot.motion || {
            primary_motion: shot.primary_motion || "Idle",
            secondary_motion: shot.secondary_motion || ["Blink", "Breathing"],
            motion_level: shot.motion_level || "Low"
          },
          keyframe_prompt: shot.keyframe_prompt || "",
          motion_prompt: editedMotion?.motion_description || shot.motion_prompt || ""
        };
      });
    };

    // Helper to map keyframes to backend format
    const mapKeyframesToBackend = (keyframeList: any[]) => {
      return (keyframeList || []).map((k: any) => ({
        shot_id: k.shot_id || "",
        prompt: k.keyframe_image_prompt || ""
      }));
    };

    switch (stepKey) {
      case "story_analyzer":
        url = `${BACKEND_URL}/api/analyze-story`;
        bodyPayload = {
          storyboard,
          api_keys: apiKeys,
          model: selectedModel,
          rpm_limit: rpmLimit,
        };
        break;
      
      case "character_extractor":
      case "environment_extractor":
      case "prop_extractor":
        url = `${BACKEND_URL}/api/extract-assets`;
        bodyPayload = {
          storyboard,
          scenes: mapScenesToBackend(projectData.scenes),
          api_keys: apiKeys,
          model: selectedModel,
          rpm_limit: rpmLimit,
          chunk_size: chunkSize,
        };
        break;

      case "shot_planner":
        url = `${BACKEND_URL}/api/plan-shots`;
        bodyPayload = {
          storyboard,
          scenes: mapScenesToBackend(projectData.scenes),
          characters: mapCharactersToBackend(projectData.characters),
          environments: mapEnvironmentsToBackend(projectData.environments),
          props: mapPropsToBackend(projectData.props),
          api_keys: apiKeys,
          model: selectedModel,
          rpm_limit: rpmLimit,
          chunk_size: chunkSize,
        };
        break;

      case "keyframe_generator":
        url = `${BACKEND_URL}/api/generate-keyframes`;
        bodyPayload = {
          shots: mapShotsToBackend(projectData.shots),
          characters: mapCharactersToBackend(projectData.characters),
          environments: mapEnvironmentsToBackend(projectData.environments),
          props: mapPropsToBackend(projectData.props),
          api_keys: apiKeys,
          model: selectedModel,
          rpm_limit: rpmLimit,
          chunk_size: chunkSize,
        };
        break;

      case "motion_generator":
        url = `${BACKEND_URL}/api/generate-motion`;
        bodyPayload = {
          storyboard,
          shots: mapShotsToBackend(projectData.shots),
          characters: mapCharactersToBackend(projectData.characters),
          environments: mapEnvironmentsToBackend(projectData.environments),
          props: mapPropsToBackend(projectData.props),
          keyframes: mapKeyframesToBackend(projectData.keyframes),
          api_keys: apiKeys,
          model: selectedModel,
          rpm_limit: rpmLimit,
          chunk_size: chunkSize,
          custom_instructions: custom_instructions || null,
        };
        break;
    }

    if (stepKey === "shot_planner") {
      const streamUrl = `${BACKEND_URL}/api/stream-plan-shots`;
      const response = await fetch(streamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: `Request failed with status ${response.status}` }));
        let errorMsg = errorData.detail || `Request failed with status ${response.status}`;
        throw new Error(errorMsg);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedShots: any[] = [];
      let currentDataState = { ...projectData };

      if (reader) {
        while (true) {
          if (this.isTaskPaused(params.projectId)) {
            try { reader.cancel(); } catch (e) {}
            break;
          }
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const chunk = JSON.parse(line.trim());
              if (chunk.type === "init") {
                if (chunk.is_regex) {
                  this.addLog(`[Regex Engine] ⚡ Trích xuất thủ công ${chunk.total_scenes} Shots từ Storyboard (0 Gemini AI calls)...`, "success", params.projectId);
                } else {
                  this.addLog(`[Gemini AI] ⏳ Khởi chạy phân tích: Chia thành ${chunk.total_batches} Batches (${chunk.total_scenes} Scenes)...`, "running", params.projectId);
                }
              } else if (chunk.type === "batch_complete") {
                const inTokens = chunk.input_tokens || 0;
                const outTokens = chunk.output_tokens || 0;

                const newBatchShots = (chunk.shots || []).map((shot: any) => ({
                  shot_id: shot.shot_id,
                  scene_id: shot.scene_number || shot.scene_id,
                  scene_number: shot.scene_number || shot.scene_id,
                  duration_seconds: shot.duration_seconds,
                  actions: shot.actions || shot.action || "",
                  characters: shot.characters || [],
                  environment: shot.environment || "",
                  props: shot.props || [],
                  dialogue: shot.dialogue ? shot.dialogue.map((d: any) => ({
                    character: d.character,
                    text: d.speech
                  })) : [],
                  camera_movement: shot.camera_movement || "",
                  framing: shot.shot_type || shot.framing || "",
                  transition: shot.transition || "",
                  composition: shot.composition || "",
                  lighting: shot.lighting || "",
                  keyframe_prompt: shot.keyframe_prompt || "",
                  motion_prompt: shot.motion_prompt || ""
                }));

                // Append new shots avoiding duplicate scene/shot IDs
                accumulatedShots.push(...newBatchShots);
                // Sort shots by scene number
                accumulatedShots.sort((a: any, b: any) => (a.scene_number || 0) - (b.scene_number || 0));
                accumulatedShots.forEach((s: any, idx: number) => {
                  s.shot_id = `Shot${String(idx + 1).padStart(3, '0')}`;
                });

                const existingKf = currentDataState.keyframes || [];
                const realKeyframes = accumulatedShots.map((shot: any) => {
                  const existing = existingKf.find((k: any) => k.shot_id === shot.shot_id);
                  return {
                    shot_id: shot.shot_id,
                    keyframe_image_prompt: shot.keyframe_prompt || shot.actions || "",
                    url: existing?.url || "",
                    media_id: existing?.media_id || "",
                    account_id: existing?.account_id || ""
                  };
                });

                const existingMp = currentDataState.motion_prompts || [];
                const realMotions = accumulatedShots.map((shot: any) => {
                  const existing = existingMp.find((m: any) => m.shot_id === shot.shot_id);
                  return {
                    shot_id: shot.shot_id,
                    motion_description: shot.motion_prompt || shot.camera_movement || "",
                    video_url: existing?.video_url || ""
                  };
                });

                currentDataState = {
                  ...currentDataState,
                  shots: [...accumulatedShots],
                  keyframes: realKeyframes,
                  motion_prompts: realMotions,
                  input_tokens: (projectData.input_tokens || 0) + inTokens,
                  output_tokens: (projectData.output_tokens || 0) + outTokens,
                };

                // Notify UI to render new shots immediately!
                const taskState = this.getTaskState(params.projectId);
                this.notify(params.projectId, taskState, currentDataState, params.steps);
                this.addLog(`[Gemini AI] 🚀 Batch ${chunk.batch_index + 1}/${chunk.total_batches} (${chunk.scene_range}) hoàn thành -> Đã cập nhật ngay ${accumulatedShots.length} Shots lên màn hình!`, "success", params.projectId);

                // Save checkpoint to IndexedDB
                saveProject({
                  id: params.projectId,
                  name: params.projectName,
                  updatedAt: new Date().toISOString(),
                  storyboard: params.storyboard,
                  projectData: currentDataState,
                  steps: params.steps,
                  model: params.selectedModel,
                });
              } else if (chunk.type === "error") {
                throw new Error(chunk.message);
              }
            } catch (e: any) {
              if (e.message && !e.message.includes("Unexpected end of JSON")) {
                throw e;
              }
            }
          }
        }
      }
      return currentDataState;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      let errorMsg = "";
      if (Array.isArray(errorData.detail)) {
        errorMsg = errorData.detail.map((err: any) => {
          const locStr = err.loc ? err.loc.join(" -> ") : "unknown";
          return `[${locStr}] ${err.msg}`;
        }).join("\n");
      } else {
        errorMsg = errorData.detail || `Request failed with status ${response.status}`;
      }
      throw new Error(errorMsg);
    }

    const responseData = await response.json();
    const updatedData = { ...projectData };

    // Extract tokens from API response
    const inTokens = responseData.input_tokens || 0;
    const outTokens = responseData.output_tokens || 0;

    // Accumulate project-specific tokens
    updatedData.input_tokens = (projectData.input_tokens || 0) + inTokens;
    updatedData.output_tokens = (projectData.output_tokens || 0) + outTokens;

    // Accumulate global cumulative tokens in localStorage
    if (typeof window !== "undefined") {
      const globalIn = parseInt(localStorage.getItem("global_input_tokens") || "0") || 0;
      const globalOut = parseInt(localStorage.getItem("global_output_tokens") || "0") || 0;
      localStorage.setItem("global_input_tokens", (globalIn + inTokens).toString());
      localStorage.setItem("global_output_tokens", (globalOut + outTokens).toString());
    }

    switch (stepKey) {
      case "story_analyzer":
        updatedData.scenes = (responseData.scenes || []).map((scene: any) => ({
          scene_id: scene.scene_number,
          duration_seconds: scene.duration_seconds,
          characters: scene.characters,
          setting: scene.location,
          props: scene.props,
          description: scene.action,
          dialogues: scene.dialogue ? scene.dialogue.map((d: any) => ({
            character: d.character,
            text: d.speech
          })) : []
        }));

        // Automatically initialize shots, keyframes, and motion prompts from standardized format
        try {
          const assembleRes = await fetch(`${BACKEND_URL}/api/assemble-storyboard`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ storyboard, style_preset_id: "3d_pixar" })
          });
          if (assembleRes.ok) {
            const stdShots = await assembleRes.json();
            if (stdShots && stdShots.length > 0) {
              updatedData.shots = stdShots.map((s: any, idx: number) => {
                const shotId = `Shot${String(idx + 1).padStart(3, '0')}`;
                return {
                  shot_id: shotId,
                  scene_id: s.scene_number,
                  scene_number: s.scene_number,
                  duration_seconds: s.duration_seconds || 5,
                  actions: s.visual || s.character_motion || "",
                  characters: s.characters || [],
                  environment: s.setting || "",
                  props: s.props || [],
                  dialogue: s.dialogue ? s.dialogue.map((d: any) => ({ character: d.character, speech: d.speech || d.text })) : [],
                  camera_movement: s.camera_motion || "Static",
                  framing: s.shot_type || "Medium Shot",
                  transition: s.closing_transition || s.opening_transition || "Cut",
                  composition: "Rule of Thirds",
                  lighting: s.lighting || "Warm lighting",
                  camera: `${s.shot_type || 'Medium Shot'}, ${s.camera_motion || 'Static'}`,
                  timeline: [{ time: `0-${s.duration_seconds || 5}`, action: s.character_motion || s.visual || "Action" }],
                  motion: { primary_motion: s.character_motion || "Action", secondary_motion: ["Blink", "Breathing"], motion_level: "Low" },
                  keyframe_prompt: s.assembled_image_prompt,
                  motion_prompt: s.assembled_video_prompt
                };
              });

              updatedData.keyframes = updatedData.shots.map((shot: any) => ({
                shot_id: shot.shot_id,
                keyframe_image_prompt: shot.keyframe_prompt,
                url: "",
                media_id: "",
                account_id: ""
              }));

              updatedData.motion_prompts = updatedData.shots.map((shot: any) => ({
                shot_id: shot.shot_id,
                motion_description: shot.motion_prompt,
                video_url: ""
              }));
            }
          }
        } catch (err) {
          console.warn("Assemble storyboard fallback in queue:", err);
        }

        if (!updatedData.shots || updatedData.shots.length === 0) {
          updatedData.shots = updatedData.scenes.map((scene: any, idx: number) => {
            const shotId = `Shot${String(idx + 1).padStart(3, '0')}`;
            return {
              shot_id: shotId,
              scene_id: scene.scene_id,
              scene_number: scene.scene_id,
              duration_seconds: scene.duration_seconds || 5,
              actions: scene.description || "",
              characters: scene.characters || [],
              environment: scene.setting || "",
              props: scene.props || [],
              dialogue: scene.dialogues || [],
              camera_movement: "Static",
              framing: "Medium Shot",
              transition: "Cut",
              composition: "Rule of Thirds",
              lighting: "Warm lighting",
              camera: "Medium Shot, Static",
              timeline: [{ time: `0-${scene.duration_seconds || 5}`, action: scene.description || "Idle" }],
              motion: {
                primary_motion: "Idle",
                secondary_motion: ["Blink", "Breathing"],
                motion_level: "Low"
              },
              keyframe_prompt: "",
              motion_prompt: ""
            };
          });

          updatedData.keyframes = updatedData.shots.map((shot: any) => ({
            shot_id: shot.shot_id,
            keyframe_image_prompt: "",
            url: "",
            media_id: "",
            account_id: ""
          }));

          updatedData.motion_prompts = updatedData.shots.map((shot: any) => ({
            shot_id: shot.shot_id,
            motion_description: "",
            video_url: ""
          }));
        }
        break;

      case "character_extractor":
      case "environment_extractor":
      case "prop_extractor":
        const existingChars = projectData.characters || [];
        const existingEnvs = projectData.environments || [];
        const existingProps = projectData.props || [];

        updatedData.characters = (responseData.characters || []).map((char: any) => {
          const nameToMatch = char.canonical_name || char.name || "";
          const existing = existingChars.find((c: any) => 
            (c.name && c.name.toLowerCase() === nameToMatch.toLowerCase()) || 
            (c.canonical_name && c.canonical_name.toLowerCase() === nameToMatch.toLowerCase()) ||
            c.id === char.id
          );
          return {
            id: char.id || "",
            canonical_name: nameToMatch,
            name: nameToMatch,
            age: char.age || "",
            gender: char.gender || "",
            appearance: char.appearance || "",
            outfit: char.outfit || "",
            hairstyle: char.hairstyle || "",
            accessories: char.accessories || "",
            voice_style: char.voice_style || "",
            personality: char.personality || "",
            description: char.description || `${char.age || ""} ${char.gender || ""}, ${char.personality || ""}`,
            turnaround_prompt: char.turnaround_prompt || char.prompt || "",
            url: existing?.url || "",
            media_id: existing?.media_id || "",
            account_id: existing?.account_id || ""
          };
        });

        updatedData.environments = (responseData.environments || []).map((env: any) => {
          const nameToMatch = env.name || env.setting_name || "";
          const existing = existingEnvs.find((e: any) => 
            (e.setting_name && e.setting_name.toLowerCase() === nameToMatch.toLowerCase()) || 
            e.id === env.id
          );
          return {
            id: env.id || "",
            setting_name: nameToMatch,
            reference_prompt: env.reference_prompt || env.prompt || "",
            url: existing?.url || "",
            media_id: existing?.media_id || "",
            account_id: existing?.account_id || ""
          };
        });

        updatedData.props = (responseData.props || []).map((prop: any) => {
          const nameToMatch = prop.name || prop.prop_name || "";
          const existing = existingProps.find((p: any) => 
            (p.prop_name && p.prop_name.toLowerCase() === nameToMatch.toLowerCase()) || 
            p.id === prop.id
          );
          return {
            id: prop.id || "",
            prop_name: nameToMatch,
            reference_prompt: prop.reference_prompt || prop.prompt || "",
            url: existing?.url || "",
            media_id: existing?.media_id || "",
            account_id: existing?.account_id || ""
          };
        });
        break;

      case "shot_planner":
        updatedData.shots = (responseData.shots || []).map((shot: any) => ({
          shot_id: shot.shot_id,
          scene_id: shot.scene_number || shot.scene_id,
          scene_number: shot.scene_number || shot.scene_id,
          duration_seconds: shot.duration_seconds,
          actions: shot.actions || shot.action || "",
          characters: shot.characters || [],
          environment: shot.environment || "",
          props: shot.props || [],
          dialogue: shot.dialogue ? shot.dialogue.map((d: any) => ({
            character: d.character,
            text: d.speech
          })) : [],
          camera_movement: shot.camera_movement || "",
          framing: shot.shot_type || shot.framing || "",
          transition: shot.transition || "",
          composition: shot.composition || "",
          lighting: shot.lighting || "",
          keyframe_prompt: shot.keyframe_prompt || "",
          motion_prompt: shot.motion_prompt || ""
        }));

        const existingKf = projectData.keyframes || [];
        updatedData.keyframes = (responseData.shots || []).map((shot: any) => {
          const existing = existingKf.find((ex: any) => ex.shot_id === shot.shot_id);
          return {
            shot_id: shot.shot_id,
            keyframe_image_prompt: shot.keyframe_prompt || "",
            url: existing?.url || "",
            media_id: existing?.media_id || "",
            account_id: existing?.account_id || ""
          };
        });

        const existingMot = projectData.motion_prompts || [];
        updatedData.motion_prompts = (responseData.shots || []).map((shot: any) => {
          const existing = existingMot.find((ex: any) => ex.shot_id === shot.shot_id);
          return {
            shot_id: shot.shot_id,
            motion_description: shot.motion_prompt || "",
            video_url: existing?.video_url || ""
          };
        });
        break;

      case "keyframe_generator":
        const existingKeyframes = projectData.keyframes || [];
        updatedData.keyframes = (responseData.keyframes || []).map((k: any) => {
          const existing = existingKeyframes.find((ex: any) => ex.shot_id === k.shot_id);
          return {
            shot_id: k.shot_id,
            keyframe_image_prompt: k.prompt || k.keyframe_image_prompt || "",
            url: existing?.url || "",
            media_id: existing?.media_id || "",
            account_id: existing?.account_id || ""
          };
        });
        break;

      case "motion_generator":
        const existingMotions = projectData.motion_prompts || [];
        updatedData.motion_prompts = (responseData.motion_prompts || []).map((m: any) => {
          const existing = existingMotions.find((ex: any) => ex.shot_id === m.shot_id);
          return {
            shot_id: m.shot_id,
            motion_description: m.prompt || m.motion_description || "",
            video_url: existing?.video_url || ""
          };
        });
        break;
    }

    return updatedData;
  }

  // Media Queue System
  private mediaQueue: MediaTask[] = [];
  private mediaQueueListeners: Set<MediaQueueListener> = new Set();
  private mediaDelaySeconds = 0;
  private imageConcurrencyLimit = 2;
  private videoConcurrencyLimit = 1;

  setConcurrencyLimits(imageLimit: number, videoLimit: number) {
    this.imageConcurrencyLimit = imageLimit;
    this.videoConcurrencyLimit = videoLimit;
    this.processMediaQueue();
  }

  setMediaDelaySeconds(delaySeconds: number) {
    this.mediaDelaySeconds = delaySeconds;
  }

  subscribeMediaQueue(listener: MediaQueueListener) {
    this.mediaQueueListeners.add(listener);
    listener([...this.mediaQueue]);
    return () => {
      this.mediaQueueListeners.delete(listener);
    };
  }

  private notifyMediaQueue() {
    this.mediaQueueListeners.forEach(listener => {
      try {
        listener([...this.mediaQueue]);
      } catch (err) {
        console.error("Error in media queue listener:", err);
      }
    });
  }

  addMediaTask(task: Omit<MediaTask, "status">) {
    const newTask: MediaTask = { ...task, status: "pending" };
    this.mediaQueue.push(newTask);
    this.notifyMediaQueue();
    this.processMediaQueue();
  }

  stopMediaQueue() {
    this.mediaQueue = this.mediaQueue.filter(t => t.status === "success" || t.status === "failed");
    this.notifyMediaQueue();
    this.addLog("Đã hủy tất cả tác vụ vẽ ảnh/video trong hàng chờ.", "info");
  }

  getMediaQueue(): MediaTask[] {
    return this.mediaQueue;
  }

  private processMediaQueue() {
    let startedAny = false;

    // Check running task counts
    const runningImages = this.mediaQueue.filter(t => t.status === "running" && t.type !== "shot_video").length;
    const runningVideos = this.mediaQueue.filter(t => t.status === "running" && t.type === "shot_video").length;

    // Start image tasks if below limit
    if (runningImages < this.imageConcurrencyLimit) {
      const nextImageTask = this.mediaQueue.find(t => t.status === "pending" && t.type !== "shot_video");
      if (nextImageTask) {
        this.runTaskAsync(nextImageTask);
        startedAny = true;
      }
    }

    // Start video tasks if below limit
    if (runningVideos < this.videoConcurrencyLimit) {
      const nextVideoTask = this.mediaQueue.find(t => t.status === "pending" && t.type === "shot_video");
      if (nextVideoTask) {
        this.runTaskAsync(nextVideoTask);
        startedAny = true;
      }
    }

    // Re-evaluate immediately to start additional tasks up to limits
    if (startedAny) {
      setTimeout(() => this.processMediaQueue(), 0);
    }
  }

  private async runTaskAsync(task: MediaTask) {
    task.status = "running";
    this.notifyMediaQueue();

    if (this.mediaDelaySeconds > 0) {
      this.addLog(`[Hàng chờ] Chờ ${this.mediaDelaySeconds} giây trễ giãn cách trước khi chạy ${task.targetId}...`, "info", task.projectId);
      await new Promise(resolve => setTimeout(resolve, this.mediaDelaySeconds * 1000));
    }

    this.addLog(`[Hàng chờ] Bắt đầu vẽ ${task.type === "shot_video" ? "video" : "ảnh"} cho ${task.targetId} (Dự án: ${task.projectName})...`, "running", task.projectId);

    const maxAttempts = 3;
    let attempt = 0;
    let success = false;
    let lastError: any = null;

    while (attempt < maxAttempts && !success) {
      attempt++;
      try {
        if (attempt > 1) {
          this.addLog(`[Hàng chờ] Thử lại lần ${attempt}/${maxAttempts} cho ${task.targetId}...`, "running", task.projectId);
        }
        if (task.type === "shot_video") {
          await this.executeVideoTask(task);
        } else {
          await this.executeImageTask(task);
        }
        success = true;
      } catch (err: any) {
        lastError = err;
        this.addLog(`[Hàng chờ] Thử lần ${attempt}/${maxAttempts} thất bại cho ${task.targetId}: ${err.message}`, "error", task.projectId);
        if (attempt < maxAttempts) {
          // Wait 3 seconds before retrying
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    }

    if (success) {
      task.status = "success";
      this.addLog(`[Hàng chờ] Đã vẽ xong ${task.type === "shot_video" ? "video" : "ảnh"} cho ${task.targetId}!`, "success", task.projectId);
    } else {
      task.status = "failed";
      task.error = lastError?.message || "Unknown error after 3 attempts";
      this.addLog(`[Hàng chờ] Thất bại sau ${maxAttempts} lần thử. Dừng vẽ ${task.type === "shot_video" ? "video" : "ảnh"} cho ${task.targetId}.`, "error", task.projectId);
    }

    this.notifyMediaQueue();
    this.processMediaQueue();
  }

  private async executeImageTask(task: MediaTask) {
    let chosenAccount = "default_account";
    const selectedImageAccounts: string[] = task.params?.selectedImageAccounts || [];
    if (selectedImageAccounts.length > 0) {
      chosenAccount = selectedImageAccounts[this.imageAccountRRIndex % selectedImageAccounts.length];
      this.imageAccountRRIndex++;
    } else if (task.params?.accountId) {
      chosenAccount = task.params.accountId;
    }

    // Auto Upload referenced local images to Google if needed
    let mediaIds = task.params?.mediaIds || [];
    if (task.type === "shot_image" && task.params?.referencedAssetPaths && task.params.referencedAssetPaths.length > 0) {
      const freshMediaIds: string[] = [];
      for (const assetPath of task.params.referencedAssetPaths) {
        if (assetPath && (assetPath.startsWith("/api/media") || assetPath.includes(":\\") || assetPath.includes("/"))) {
          this.addLog(`[Auto Upload] Tải ảnh tham chiếu lên Google qua TK ${chosenAccount}...`, "info", task.projectId);
          const newMediaId = await this.uploadImageToGoogle(assetPath, chosenAccount);
          if (newMediaId) {
            freshMediaIds.push(newMediaId);
          }
        }
      }
      if (freshMediaIds.length > 0) {
        mediaIds = freshMediaIds;
      }
    }

    const payload: any = {
      prompt: task.prompt,
      count: task.params?.imageCount || 1,
      aspect_ratio: task.params?.imageAspectRatio || "IMAGE_ASPECT_RATIO_LANDSCAPE",
      model: task.params?.imageModel || "GEM_PIX_2",
      for_video: true,
      account_id: chosenAccount
    };

    if (mediaIds && mediaIds.length > 0) {
      payload.media_ids = mediaIds;
    }

    if (task.type === "shot_image") {
      const logMsg = `[API Vẽ ảnh Shot] Prompt: "${payload.prompt}" | Model: ${payload.model} | Aspect: ${payload.aspect_ratio} | Count: ${payload.count} | TK: ${payload.account_id} | Media IDs: ${JSON.stringify(payload.media_ids || [])}`;
      console.log(logMsg, payload);
      this.addLog(logMsg, "info", task.projectId);
    }

    let data;
    try {
      const localApiUrl = typeof window !== "undefined" ? `http://${window.location.hostname}:5000` : "http://127.0.0.1:5000";
      const response = await fetch(`${localApiUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Local API responded with status ${response.status}`);
      }

      data = await response.json();
      if (!data.success || !data.images || data.images.length === 0) {
        throw new Error(data.error || "No image was returned from local API.");
      }
    } catch (err: any) {
      throw err;
    }

    const result = {
      url: data.images[0].url,
      media_id: data.images[0].media_id,
      account_id: data.account_id || chosenAccount
    };

    if (task.params?.pcDirectory) {
      let subFolder = "references";
      let filename = "";
      if (task.type === "character" || task.type === "environment" || task.type === "prop") {
        subFolder = "references";
        filename = `${task.targetId}.png`;
      } else if (task.type === "shot_image") {
        const parts = task.targetId.split("_");
        const shotId = parts[parts.length - 1];
        subFolder = "images";
        filename = `shots_${shotId}.png`;
      }

      try {
        const saveRes = await fetch("/api/save-media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pcDirectory: task.params.pcDirectory,
            subFolder,
            filename,
            url: result.url
          })
        });
        if (saveRes.ok) {
          const saveInfo = await saveRes.json();
          if (saveInfo.success && saveInfo.savedPath) {
            result.url = `/api/media?path=${encodeURIComponent(saveInfo.savedPath)}`;
          }
        }
      } catch (err) {
        console.error("Error auto-saving image to PC path:", err);
      }
    }

    let pData: any;
    let stepsCopy: any;

    await this.safeUpdateProject(task.projectId, (project) => {
      const copy = { ...project };
      pData = { ...copy.projectData };

      if (task.type === "character") {
        pData.characters = pData.characters.map((c: any) =>
          c.name === task.targetId ? { ...c, url: result.url, media_id: result.media_id, account_id: result.account_id } : c
        );
      } else if (task.type === "environment") {
        pData.environments = pData.environments.map((e: any) =>
          e.setting_name === task.targetId ? { ...e, url: result.url, media_id: result.media_id, account_id: result.account_id } : e
        );
      } else if (task.type === "prop") {
        pData.props = pData.props.map((p: any) =>
          p.prop_name === task.targetId ? { ...p, url: result.url, media_id: result.media_id, account_id: result.account_id } : p
        );
      } else if (task.type === "shot_image") {
        const parts = task.targetId.split("_");
        const shotId = parts[parts.length - 1];
        if (!pData.keyframes) {
          pData.keyframes = [];
        }
        const hasKeyframe = pData.keyframes.some((k: any) => k.shot_id === shotId);
        if (hasKeyframe) {
          pData.keyframes = pData.keyframes.map((k: any) =>
            k.shot_id === shotId ? { ...k, url: result.url, media_id: result.media_id, account_id: result.account_id } : k
          );
        } else {
          pData.keyframes.push({
            shot_id: shotId,
            url: result.url,
            media_id: result.media_id,
            account_id: result.account_id,
            keyframe_image_prompt: task.prompt || ""
          });
        }
      }

      copy.projectData = pData;
      copy.updatedAt = new Date().toISOString();
      stepsCopy = copy.steps;
      return copy;
    });

    this.addLog(`[Tạo Ảnh Thành Công] Target: ${task.targetId} | Dự án: ${task.projectName} | TK API: ${result.account_id}`, "success", task.projectId);

    if (pData) {
      this.notify(task.projectId, this.getTaskState(task.projectId), pData, stepsCopy);
    }
  }

  private async executeVideoTask(task: MediaTask) {
    let chosenAccount = "default_account";
    if (task.params?.selectedUltraAccount) {
      chosenAccount = task.params.selectedUltraAccount;
    } else if (task.params?.accountId) {
      chosenAccount = task.params.accountId;
    }

    let mediaIds = task.params?.mediaIds;
    const keyframeUrl = task.params?.keyframeUrl;

    // If I2V but media_id is missing or keyframe is a local file path, auto-upload keyframe to Google using Ultra account
    if ((!mediaIds || mediaIds.length === 0 || !mediaIds[0] || mediaIds[0].startsWith("mock_")) && keyframeUrl) {
      this.addLog(`[Auto Upload] Tải ảnh khung hình (keyframe) lên Google qua TK Ultra ${chosenAccount}...`, "info", task.projectId);
      const newMediaId = await this.uploadImageToGoogle(keyframeUrl, chosenAccount);
      if (newMediaId) {
        mediaIds = [newMediaId];
        // Save new media_id back to projectData keyframe
        const parts = task.targetId.split("_");
        const shotId = parts[parts.length - 1];
        await this.safeUpdateProject(task.projectId, (project) => {
          const copy = { ...project };
          if (copy.projectData && copy.projectData.keyframes) {
            copy.projectData.keyframes = copy.projectData.keyframes.map((k: any) =>
              k.shot_id === shotId ? { ...k, media_id: newMediaId, account_id: chosenAccount } : k
            );
          }
          return copy;
        });
      }
    }

    const isI2V = mediaIds && mediaIds.length > 0;

    const mapT2VModel = (uiModel: string): string => {
      if (!uiModel) return "veo_3_1_t2v_lite_low_priority";
      if (uiModel.includes("Veo 3.1 Lite")) return "veo_3_1_t2v_lite_low_priority";
      if (uiModel.includes("Veo 3 Fast -")) return "veo_3_0_t2v_fast";
      if (uiModel.includes("Veo 3 Fast Relaxed")) return "veo_3_0_t2v_fast_relaxed";
      if (uiModel.includes("Veo 3 Standard")) return "veo_3_0_t2v_standard";
      if (uiModel.includes("Veo 3 Quality")) return "veo_3_0_t2v_quality";
      if (uiModel.includes("Veo 3 Fast Portrait")) return "veo_3_0_t2v_fast_portrait";
      return uiModel;
    };

    const payload: any = {
      prompt: task.prompt,
      aspect_ratio: task.params?.videoAspectRatio || "VIDEO_ASPECT_RATIO_LANDSCAPE",
      duration_seconds: task.params?.duration_seconds || 5,
      fps: 30,
      count: task.params?.videoCount || 1,
      account_id: chosenAccount
    };

    if (isI2V) {
      payload.model = "veo_3_1_r2v_lite_low_priority";
      payload.media_ids = mediaIds;
    } else {
      payload.model = mapT2VModel(task.params?.videoModel);
    }

    if (task.params?.audioReferenceMediaIds && task.params.audioReferenceMediaIds.length > 0) {
      payload.audioReferenceMediaIds = task.params.audioReferenceMediaIds;
    }

    const logMsg = `[API Veo 3 Video] Prompt: "${payload.prompt}" | Model: ${payload.model} | Aspect: ${payload.aspect_ratio} | Duration: ${payload.duration_seconds}s | TK Ultra: ${payload.account_id} | Media IDs: ${JSON.stringify(payload.media_ids || [])}`;
    console.log(logMsg, payload);
    this.addLog(logMsg, "info", task.projectId);

    let data;
    try {
      const localApiUrl = typeof window !== "undefined" ? `http://${window.location.hostname}:5000` : "http://127.0.0.1:5000";
      const response = await fetch(`${localApiUrl}/api/generate_video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Video API responded with status ${response.status}`);
      }

      data = await response.json();
      if (!data.success || !data.videos || data.videos.length === 0) {
        throw new Error(data.error || "No video was returned from local API.");
      }
    } catch (err: any) {
      throw err;
    }

    let videoUrl = data.videos[0].url;

    if (task.params?.pcDirectory) {
      const parts = task.targetId.split("_");
      const shotId = parts[parts.length - 1];
      const subFolder = "videos";
      const filename = `${shotId}.mp4`;

      try {
        const saveRes = await fetch("/api/save-media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pcDirectory: task.params.pcDirectory,
            subFolder,
            filename,
            url: videoUrl
          })
        });
        if (saveRes.ok) {
          const saveInfo = await saveRes.json();
          if (saveInfo.success && saveInfo.savedPath) {
            videoUrl = `/api/media?path=${encodeURIComponent(saveInfo.savedPath)}`;
          }
        }
      } catch (err) {
        console.error("Error auto-saving video to PC path:", err);
      }
    }

    let pData: any;
    let stepsCopy: any;

    await this.safeUpdateProject(task.projectId, (project) => {
      const copy = { ...project };
      pData = { ...copy.projectData };
      const parts = task.targetId.split("_");
      const shotId = parts[parts.length - 1];

      const motionIndex = pData.motion_prompts
        ? pData.motion_prompts.findIndex((m: any) => m.shot_id === shotId)
        : -1;

      if (motionIndex !== -1) {
        pData.motion_prompts = pData.motion_prompts.map((m: any, idx: number) =>
          idx === motionIndex ? { ...m, video_url: videoUrl, account_id: chosenAccount } : m
        );
      } else {
        pData.motion_prompts = [
          ...(pData.motion_prompts || []),
          { shot_id: shotId, motion_description: task.prompt, video_url: videoUrl, account_id: chosenAccount }
        ];
      }

      copy.projectData = pData;
      copy.updatedAt = new Date().toISOString();
      stepsCopy = copy.steps;
      return copy;
    });

    this.addLog(`[Tạo Video Thành Công] Target: ${task.targetId} | Dự án: ${task.projectName} | TK Ultra: ${chosenAccount}`, "success", task.projectId);

    if (pData) {
      this.notify(task.projectId, this.getTaskState(task.projectId), pData, stepsCopy);
    }
  }
}

type MediaQueueListener = (queue: MediaTask[]) => void;

export const queueManager = new BackgroundQueueManager();
