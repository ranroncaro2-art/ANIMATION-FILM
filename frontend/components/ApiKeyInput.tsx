"use client";

import React, { useState, useEffect } from "react";

interface ApiKeyInputProps {
  apiKeys: string[];
  onChangeApiKeys: (keys: string[]) => void;
  selectedModel: string;
  onChangeModel: (model: string) => void;
  rpmLimit: number;
  onChangeRpmLimit: (val: number) => void;
  chunkSize: number;
  onChangeChunkSize: (val: number) => void;

  // Local drawing & video configurations
  imageCount: number;
  onChangeImageCount: (val: number) => void;
  imageAspectRatio: string;
  onChangeImageAspectRatio: (val: string) => void;
  imageModel: string;
  onChangeImageModel: (val: string) => void;

  videoCount: number;
  onChangeVideoCount: (val: number) => void;
  videoAspectRatio: string;
  onChangeVideoAspectRatio: (val: string) => void;
  videoModel: string;
  onChangeVideoModel: (val: string) => void;

  imageConcurrency: number;
  onChangeImageConcurrency: (val: number) => void;
  videoConcurrency: number;
  onChangeVideoConcurrency: (val: number) => void;
  mediaDelaySeconds: number;
  onChangeMediaDelaySeconds: (val: number) => void;

  selectedImageAccounts?: string[];
  onChangeSelectedImageAccounts?: (accounts: string[]) => void;
  selectedUltraAccount?: string;
  onChangeSelectedUltraAccount?: (account: string) => void;
}

export default function ApiKeyInput({
  apiKeys,
  onChangeApiKeys,
  selectedModel,
  onChangeModel,
  rpmLimit,
  onChangeRpmLimit,
  chunkSize,
  onChangeChunkSize,
  
  imageCount,
  onChangeImageCount,
  imageAspectRatio,
  onChangeImageAspectRatio,
  imageModel,
  onChangeImageModel,
  videoCount,
  onChangeVideoCount,
  videoAspectRatio,
  onChangeVideoAspectRatio,
  videoModel,
  onChangeVideoModel,
  imageConcurrency,
  onChangeImageConcurrency,
  videoConcurrency,
  onChangeVideoConcurrency,
  mediaDelaySeconds,
  onChangeMediaDelaySeconds,

  selectedImageAccounts = [],
  onChangeSelectedImageAccounts,
  selectedUltraAccount = "",
  onChangeSelectedUltraAccount,
}: ApiKeyInputProps) {
  const [rawText, setRawText] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<"gemini" | "image" | "video">("gemini");
  
  const [fetchedAccounts, setFetchedAccounts] = useState<any[]>([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState<boolean>(false);

  const loadAccounts = async () => {
    setIsLoadingAccounts(true);
    try {
      const localApiUrl = typeof window !== "undefined" ? `http://${window.location.hostname}:5000` : "http://127.0.0.1:5000";
      const res = await fetch(`${localApiUrl}/api/accounts`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.accounts)) {
          setFetchedAccounts(data.accounts);
        }
      }
    } catch (err) {
      console.error("Error fetching accounts:", err);
    } finally {
      setIsLoadingAccounts(false);
    }
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    // Initialize text with existing keys
    if (apiKeys.length > 0 && !rawText) {
      setRawText(apiKeys.join("\n"));
    }
  }, [apiKeys, rawText]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedKeys = rawText
      .split(/[\n,]+/)
      .map((key) => key.trim())
      .filter((key) => key.length > 0);
    
    onChangeApiKeys(parsedKeys);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const getMaskedKey = (key: string) => {
    if (key.length <= 12) return "••••••••••••";
    return `${key.slice(0, 8)}••••${key.slice(-4)}`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Settings sub-tabs navigation */}
      <div style={{ display: "flex", gap: "8px", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "12px", marginBottom: "8px" }}>
        <button
          onClick={() => setActiveSettingsTab("gemini")}
          style={{
            background: activeSettingsTab === "gemini" ? "rgba(167,139,250,0.15)" : "transparent",
            color: activeSettingsTab === "gemini" ? "#a78bfa" : "var(--text-secondary)",
            border: "none", padding: "8px 16px", borderRadius: "6px", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", transition: "all 0.2s"
          }}
        >
          🔑 Gemini AI
        </button>
        <button
          onClick={() => setActiveSettingsTab("image")}
          style={{
            background: activeSettingsTab === "image" ? "rgba(6,182,212,0.15)" : "transparent",
            color: activeSettingsTab === "image" ? "#06b6d4" : "var(--text-secondary)",
            border: "none", padding: "8px 16px", borderRadius: "6px", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", transition: "all 0.2s"
          }}
        >
          🎨 Tạo Ảnh
        </button>
        <button
          onClick={() => setActiveSettingsTab("video")}
          style={{
            background: activeSettingsTab === "video" ? "rgba(245,158,11,0.15)" : "transparent",
            color: activeSettingsTab === "video" ? "#f59e0b" : "var(--text-secondary)",
            border: "none", padding: "8px 16px", borderRadius: "6px", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", transition: "all 0.2s"
          }}
        >
          🎬 Tạo Video
        </button>
      </div>

      {/* RENDER ACTIVE TAB */}
      {activeSettingsTab === "gemini" && (
        <div className="glass-panel" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <h3 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: "4px", display: "flex", alignItems: "center", gap: "8px", color: "#a78bfa" }}>
              <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-purple)" }}></span>
              Cấu hình Gemini AI
            </h3>
            <p style={{ fontSize: "0.80rem", color: "var(--text-secondary)" }}>
              Nhập một hoặc nhiều API key của Gemini (mỗi dòng một key) để chạy trích xuất dữ liệu.
            </p>
          </div>

          <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)" }}>Khóa API Gemini</label>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="AIzaSy..."
                style={{
                  width: "100%",
                  height: "80px",
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--border-radius-sm)",
                  padding: "8px",
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.8rem",
                  resize: "none",
                  outline: "none",
                  transition: "var(--transition-fast)",
                }}
                onFocus={(e) => (e.target.style.borderColor = "var(--accent-purple)")}
                onBlur={(e) => (e.target.style.borderColor = "var(--border-color)")}
              />
            </div>

            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <button
                type="submit"
                className="btn-primary"
                style={{
                  padding: "6px 12px",
                  fontSize: "0.8rem",
                  borderRadius: "var(--border-radius-sm)",
                  flexGrow: 1,
                }}
              >
                {isSaved ? "Đã lưu khóa API! ✓" : "Lưu khóa API"}
              </button>
            </div>
          </form>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px", borderTop: "1px solid var(--border-color)", paddingTop: "12px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)" }}>Mô hình trích xuất</label>
              <select
                value={selectedModel}
                onChange={(e) => onChangeModel(e.target.value)}
                style={{
                  background: "var(--bg-secondary)",
                  color: "#ffffff",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--border-radius-sm)",
                  padding: "6px 10px",
                  fontSize: "0.85rem",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="gemini-2.5-flash">Gemini 2.5 Flash (Khuyên dùng)</option>
                <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
              </select>
            </div>

            <div style={{ display: "flex", gap: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "4px" }}>
                  RPM Limit
                </label>
                <input
                  type="number"
                  value={rpmLimit}
                  onChange={(e) => onChangeRpmLimit(parseInt(e.target.value) || 0)}
                  min="0"
                  max="60"
                  style={{
                    background: "var(--bg-secondary)",
                    color: "#ffffff",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--border-radius-sm)",
                    padding: "6px 10px",
                    fontSize: "0.85rem",
                    outline: "none",
                  }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "4px" }}>
                  Chunk Size
                </label>
                <input
                  type="number"
                  value={chunkSize}
                  onChange={(e) => onChangeChunkSize(parseInt(e.target.value) || 1)}
                  min="1"
                  max="20"
                  style={{
                    background: "var(--bg-secondary)",
                    color: "#ffffff",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--border-radius-sm)",
                    padding: "6px 10px",
                    fontSize: "0.85rem",
                    outline: "none",
                  }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "4px" }}>
                  Trễ gọi API (giây)
                </label>
                <input
                  type="number"
                  value={mediaDelaySeconds}
                  onChange={(e) => onChangeMediaDelaySeconds(Math.max(0, parseInt(e.target.value) || 0))}
                  min="0"
                  max="120"
                  style={{
                    background: "var(--bg-secondary)",
                    color: "#ffffff",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--border-radius-sm)",
                    padding: "6px 10px",
                    fontSize: "0.85rem",
                    outline: "none",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {activeSettingsTab === "image" && (
        <div className="glass-panel" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <h3 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: "4px", display: "flex", alignItems: "center", gap: "8px", color: "var(--accent-cyan)" }}>
              <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-cyan)" }}></span>
              Cấu hình tạo Ảnh
            </h3>
            <p style={{ fontSize: "0.80rem", color: "var(--text-secondary)" }}>
              Thiết lập tham số gửi tới API local vẽ ảnh (GEM_PIX_2 / NARWHAL).
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {/* Số lượng + Aspect Ratio */}
            <div style={{ display: "flex", gap: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)" }}>Số lượng</label>
                <select
                  value={imageCount}
                  onChange={(e) => onChangeImageCount(parseInt(e.target.value))}
                  style={{
                    background: "var(--bg-secondary)",
                    color: "#ffffff",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--border-radius-sm)",
                    padding: "8px 12px",
                    fontSize: "0.9rem",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value={1}>1 Ảnh</option>
                  <option value={2}>2 Ảnh</option>
                  <option value={3}>3 Ảnh</option>
                  <option value={4}>4 Ảnh</option>
                </select>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)" }}>Tỷ lệ (Aspect Ratio)</label>
                <select
                  value={imageAspectRatio}
                  onChange={(e) => onChangeImageAspectRatio(e.target.value)}
                  style={{
                    background: "var(--bg-secondary)",
                    color: "#ffffff",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--border-radius-sm)",
                    padding: "8px 12px",
                    fontSize: "0.9rem",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value="IMAGE_ASPECT_RATIO_LANDSCAPE">16:9 Ngang</option>
                  <option value="IMAGE_ASPECT_RATIO_PORTRAIT">9:16 Dọc</option>
                  <option value="IMAGE_ASPECT_RATIO_SQUARE">1:1 Vuông</option>
                </select>
              </div>
            </div>

            {/* Multi-Account Selection Panel */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", background: "rgba(0,0,0,0.25)", padding: "12px", borderRadius: "8px", border: "1px solid rgba(6,182,212,0.2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 700, color: "#06b6d4", display: "flex", alignItems: "center", gap: "6px" }}>
                  👤 Chọn tài khoản tạo ảnh (Đa tài khoản luân phiên chống hết Quota)
                </label>
                <button
                  type="button"
                  onClick={loadAccounts}
                  style={{ background: "transparent", border: "none", color: "#a78bfa", fontSize: "0.75rem", cursor: "pointer", fontWeight: 600 }}
                >
                  🔄 Tải lại TK
                </button>
              </div>
              {fetchedAccounts.length === 0 ? (
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {isLoadingAccounts ? "Đang kết nối tải tài khoản..." : "Không tìm thấy danh sách TK local (dùng default_account)"}
                </span>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "4px" }}>
                  {fetchedAccounts.map((acc: any) => {
                    const isChecked = selectedImageAccounts.includes(acc.id);
                    return (
                      <label
                        key={acc.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          fontSize: "0.8rem",
                          cursor: "pointer",
                          background: isChecked ? "rgba(6,182,212,0.18)" : "rgba(255,255,255,0.04)",
                          padding: "5px 10px",
                          borderRadius: "6px",
                          border: isChecked ? "1px solid #06b6d4" : "1px solid rgba(255,255,255,0.1)",
                          userSelect: "none"
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (!onChangeSelectedImageAccounts) return;
                            if (e.target.checked) {
                              onChangeSelectedImageAccounts([...selectedImageAccounts, acc.id]);
                            } else {
                              onChangeSelectedImageAccounts(selectedImageAccounts.filter((id) => id !== acc.id));
                            }
                          }}
                        />
                        <span style={{ fontWeight: 600, color: acc.alive ? "#ffffff" : "#f87171" }}>
                          {acc.id} <span style={{ fontSize: "0.7rem", opacity: 0.8 }}>({acc.acc_type || "image"})</span> {acc.alive ? "✓" : "❌"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Model & Parallel Threads */}
            <div style={{ display: "flex", gap: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)" }}>Model</label>
                <select
                  value={imageModel}
                  onChange={(e) => onChangeImageModel(e.target.value)}
                  style={{
                    background: "var(--bg-secondary)",
                    color: "#ffffff",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--border-radius-sm)",
                    padding: "8px 12px",
                    fontSize: "0.9rem",
                    outline: "none",
                    cursor: "pointer",
                    width: "100%"
                  }}
                >
                  <optgroup label="Tạo Ảnh (Image Models)" style={{ background: "var(--bg-primary)" }}>
                    <option value="GEM_PIX_2">Nano Banana Pro (GEM_PIX_2)</option>
                    <option value="NARWHAL">Nano Banana 2 (NARWHAL)</option>
                  </optgroup>
                </select>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)" }}>Số luồng chạy song song</label>
                <select
                  value={imageConcurrency}
                  onChange={(e) => onChangeImageConcurrency(parseInt(e.target.value))}
                  style={{
                    background: "var(--bg-secondary)",
                    color: "#ffffff",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--border-radius-sm)",
                    padding: "8px 12px",
                    fontSize: "0.9rem",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value={1}>1 Luồng</option>
                  <option value={2}>2 Luồng</option>
                  <option value={3}>3 Luồng</option>
                  <option value={4}>4 Luồng</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeSettingsTab === "video" && (
        <div className="glass-panel" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <h3 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: "4px", display: "flex", alignItems: "center", gap: "8px", color: "#f59e0b" }}>
              <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: "#f59e0b" }}></span>
              Cấu hình tạo Video
            </h3>
            <p style={{ fontSize: "0.80rem", color: "var(--text-secondary)" }}>
              Thiết lập tham số gửi tới API local render video (Veo 3.1 / Veo 3).
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {/* Số lượng + Aspect Ratio */}
            <div style={{ display: "flex", gap: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)" }}>Số lượng</label>
                <select
                  value={videoCount}
                  onChange={(e) => onChangeVideoCount(parseInt(e.target.value))}
                  style={{
                    background: "var(--bg-secondary)",
                    color: "#ffffff",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--border-radius-sm)",
                    padding: "8px 12px",
                    fontSize: "0.9rem",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value={1}>1 Video</option>
                  <option value={2}>2 Video</option>
                </select>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)" }}>Tỷ lệ (Aspect Ratio)</label>
                <select
                  value={videoAspectRatio}
                  onChange={(e) => onChangeVideoAspectRatio(e.target.value)}
                  style={{
                    background: "var(--bg-secondary)",
                    color: "#ffffff",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--border-radius-sm)",
                    padding: "8px 12px",
                    fontSize: "0.9rem",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value="VIDEO_ASPECT_RATIO_LANDSCAPE">16:9 Ngang</option>
                  <option value="VIDEO_ASPECT_RATIO_PORTRAIT">9:16 Dọc</option>
                  <option value="VIDEO_ASPECT_RATIO_SQUARE">1:1 Vuông</option>
                </select>
              </div>
            </div>

            {/* Ultra Account Selection Panel */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", background: "rgba(0,0,0,0.25)", padding: "12px", borderRadius: "8px", border: "1px solid rgba(245,158,11,0.2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 700, color: "#f59e0b", display: "flex", alignItems: "center", gap: "6px" }}>
                  👑 Tài khoản Ultra tạo Video (Chỉ định đúng TK Ultra trên máy chủ)
                </label>
                <button
                  type="button"
                  onClick={loadAccounts}
                  style={{ background: "transparent", border: "none", color: "#a78bfa", fontSize: "0.75rem", cursor: "pointer", fontWeight: 600 }}
                >
                  🔄 Tải lại TK
                </button>
              </div>
              <select
                value={selectedUltraAccount}
                onChange={(e) => onChangeSelectedUltraAccount?.(e.target.value)}
                style={{
                  background: "var(--bg-secondary)",
                  color: "#ffffff",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--border-radius-sm)",
                  padding: "8px 12px",
                  fontSize: "0.85rem",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="">-- Mặc định (Tự động chọn TK sẵn có) --</option>
                {fetchedAccounts.map((acc: any) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.id} ({acc.acc_type || "video"}) {acc.alive ? "✓ Sẵn sàng" : "❌ Lỗi/Hết token"}
                  </option>
                ))}
              </select>
            </div>

            {/* Model & Parallel Threads */}
            <div style={{ display: "flex", gap: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)" }}>Model Video (T2V)</label>
                <select
                  value={videoModel}
                  onChange={(e) => onChangeVideoModel(e.target.value)}
                  style={{
                    background: "var(--bg-secondary)",
                    color: "#ffffff",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--border-radius-sm)",
                    padding: "8px 12px",
                    fontSize: "0.9rem",
                    outline: "none",
                    cursor: "pointer",
                    width: "100%"
                  }}
                >
                  <optgroup label="Text → Video" style={{ background: "var(--bg-primary)" }}>
                    <option value="Veo 3 Fast - 10 credit">Veo 3 Fast - 10 credit</option>
                    <option value="Veo 3 Fast Relaxed - có phí">Veo 3 Fast Relaxed - có phí</option>
                    <option value="Veo 3 Standard - có phí">Veo 3 Standard - có phí</option>
                    <option value="Veo 3 Quality - 100 credit">Veo 3 Quality - 100 credit</option>
                    <option value="Veo 3 Fast Portrait - 0 credit">Veo 3 Fast Portrait - 0 credit</option>
                    <option value="Veo 3.1 Lite - 0 credit">Veo 3.1 Lite - 0 credit</option>
                  </optgroup>
                </select>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)" }}>Số luồng chạy song song</label>
                <select
                  value={videoConcurrency}
                  onChange={(e) => onChangeVideoConcurrency(parseInt(e.target.value))}
                  style={{
                    background: "var(--bg-secondary)",
                    color: "#ffffff",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--border-radius-sm)",
                    padding: "8px 12px",
                    fontSize: "0.9rem",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value={1}>1 Luồng</option>
                  <option value={2}>2 Luồng</option>
                  <option value={3}>3 Luồng</option>
                  <option value={4}>4 Luồng</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
