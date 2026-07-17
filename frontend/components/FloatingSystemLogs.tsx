import React, { useState, useEffect, useRef } from "react";
import { queueManager } from "../utils/queue";

interface FloatingSystemLogsProps {
  activeProjectId?: string;
}

export const FloatingSystemLogs: React.FC<FloatingSystemLogsProps> = ({ activeProjectId }) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [filterCurrentProj, setFilterCurrentProj] = useState<boolean>(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Subscribe to system logs from the queueManager
  useEffect(() => {
    const unsubscribe = queueManager.subscribeLogs((newLogs) => {
      setLogs(newLogs);
    });
    return () => unsubscribe();
  }, []);

  // Auto scroll to bottom when new logs are added or panel is opened
  useEffect(() => {
    if (isOpen && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, isOpen]);

  // Click outside to close log panel
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isOpen &&
        panelRef.current &&
        !panelRef.current.contains(event.target as Node)
      ) {
        // Only close if we didn't click the toggle button
        const toggleBtn = document.getElementById("logs-toggle-btn");
        if (toggleBtn && !toggleBtn.contains(event.target as Node)) {
          setIsOpen(false);
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const filteredLogs = filterCurrentProj && activeProjectId
    ? logs.filter((log) => log.projectId === activeProjectId)
    : logs;

  const isRunning = logs.some((l) => l.type === "running");

  return (
    <>
      {/* Floating Toggle Button */}
      <button
        id="logs-toggle-btn"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: "fixed",
          top: "80px",
          right: "24px",
          zIndex: 999,
          width: "48px",
          height: "48px",
          borderRadius: "50%",
          background: isOpen 
            ? "linear-gradient(135deg, #7c3aed, #0284c7)" 
            : "rgba(15, 21, 36, 0.8)",
          border: isOpen 
            ? "1px solid rgba(255, 255, 255, 0.3)" 
            : "1px solid rgba(139, 92, 246, 0.3)",
          boxShadow: isOpen
            ? "0 0 20px rgba(139, 92, 246, 0.5), 0 4px 12px rgba(0, 0, 0, 0.4)"
            : "0 4px 12px rgba(0, 0, 0, 0.4)",
          backdropFilter: "blur(12px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: isOpen ? "#ffffff" : "#a78bfa",
          cursor: "pointer",
          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          outline: "none"
        }}
        onMouseEnter={(e) => {
          if (!isOpen) {
            e.currentTarget.style.transform = "scale(1.08)";
            e.currentTarget.style.borderColor = "rgba(139, 92, 246, 0.6)";
            e.currentTarget.style.boxShadow = "0 0 15px rgba(139, 92, 246, 0.4), 0 4px 12px rgba(0, 0, 0, 0.4)";
          }
        }}
        onMouseLeave={(e) => {
          if (!isOpen) {
            e.currentTarget.style.transform = "scale(1)";
            e.currentTarget.style.borderColor = "rgba(139, 92, 246, 0.3)";
            e.currentTarget.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.4)";
          }
        }}
        title="Xem logs hệ thống"
      >
        {/* Terminal SVG Icon */}
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>

        {/* Running pulse effect */}
        {isRunning && !isOpen && (
          <span
            className="pulse-dot"
            style={{
              position: "absolute",
              top: "-2px",
              right: "-2px",
              width: "12px",
              height: "12px",
              background: "#38bdf8",
              borderRadius: "50%",
              border: "2px solid #080c14",
              display: "block"
            }}
          />
        )}

        {/* Unread/Log count badge */}
        {logs.length > 0 && !isRunning && !isOpen && (
          <span
            style={{
              position: "absolute",
              top: "-4px",
              right: "-4px",
              background: "rgba(139, 92, 246, 1)",
              color: "#ffffff",
              fontSize: "0.65rem",
              fontWeight: 800,
              padding: "2px 6px",
              borderRadius: "10px",
              minWidth: "18px",
              textAlign: "center",
              border: "1.5px solid #080c14",
              boxShadow: "0 2px 4px rgba(0,0,0,0.3)"
            }}
          >
            {logs.length > 99 ? "99+" : logs.length}
          </span>
        )}
      </button>

      {/* Floating System Logs Panel */}
      {isOpen && (
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            top: "140px",
            right: "24px",
            zIndex: 998,
            width: "440px",
            maxHeight: "520px",
            background: "rgba(10, 16, 28, 0.95)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "12px",
            boxShadow: "0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(139, 92, 246, 0.08)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            animation: "fadeInUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards"
          }}
        >
          {/* Header */}
          <div
            style={{
              background: "rgba(17, 24, 39, 0.6)",
              padding: "12px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
              userSelect: "none"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "0.95rem" }}>💻</span>
              <span style={{ fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.05em", color: "#a78bfa" }}>
                SYSTEM LOGS
              </span>
              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: "4px" }}>
                {logs.length}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              {/* Clear button */}
              <button
                onClick={() => queueManager.clearLogs()}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "rgba(239, 68, 68, 0.8)",
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  transition: "all 0.2s"
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "rgba(239, 68, 68, 1)";
                  e.currentTarget.style.background = "rgba(239, 68, 68, 0.1)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "rgba(239, 68, 68, 0.8)";
                  e.currentTarget.style.background = "transparent";
                }}
              >
                Clear
              </button>

              {/* Close Button */}
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                  fontSize: "0.95rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "24px",
                  height: "24px",
                  borderRadius: "4px",
                  transition: "all 0.2s"
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#ffffff";
                  e.currentTarget.style.background = "rgba(255,255,255,0.08)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-secondary)";
                  e.currentTarget.style.background = "transparent";
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Filters Bar */}
          <div
            style={{
              padding: "8px 16px",
              background: "rgba(13, 19, 33, 0.4)",
              borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center"
            }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "0.7rem", color: "var(--text-secondary)" }}>
              <input
                type="checkbox"
                checked={filterCurrentProj}
                onChange={(e) => setFilterCurrentProj(e.target.checked)}
                style={{
                  cursor: "pointer",
                  accentColor: "#8b5cf6",
                  width: "12px",
                  height: "12px"
                }}
              />
              Lọc theo dự án hiện tại
            </label>
            
            {isRunning && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="pulse-dot" style={{ display: "inline-block", width: "6px", height: "6px", background: "#38bdf8", borderRadius: "50%" }} />
                <span style={{ fontSize: "0.65rem", color: "#38bdf8", fontWeight: 500 }}>Đang xử lý...</span>
              </div>
            )}
          </div>

          {/* Console Body */}
          <div
            style={{
              flexGrow: 1,
              height: "360px",
              overflowY: "auto",
              padding: "16px",
              fontFamily: "var(--font-mono)",
              fontSize: "0.72rem",
              lineHeight: 1.6,
              background: "rgba(5, 8, 15, 0.95)",
              display: "flex",
              flexDirection: "column",
              scrollBehavior: "smooth"
            }}
          >
            {filteredLogs.length === 0 ? (
              <div
                style={{
                  color: "var(--text-muted)",
                  fontStyle: "italic",
                  textAlign: "center",
                  marginTop: "120px",
                  fontSize: "0.75rem"
                }}
              >
                Chưa có log hệ thống nào được ghi nhận.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {filteredLogs.map((log, idx) => {
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
                    <div
                      key={idx}
                      className="terminal-console-line"
                      style={{
                        animation: "fadeInLine 0.15s ease-out forwards"
                      }}
                    >
                      <span style={{ color: "rgba(255,255,255,0.2)", flexShrink: 0 }}>
                        [{log.timestamp}]
                      </span>
                      <span style={{ color: badgeColor, fontWeight: 700, flexShrink: 0, minWidth: "68px" }}>
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
            )}
          </div>

          {/* CSS Animation injection (safely handled inline or via dynamic style element) */}
          <style dangerouslySetInnerHTML={{__html: `
            @keyframes fadeInUp {
              from {
                opacity: 0;
                transform: translateY(10px) scale(0.98);
              }
              to {
                opacity: 1;
                transform: translateY(0) scale(1);
              }
            }
            @keyframes fadeInLine {
              from {
                opacity: 0;
                transform: translateX(-4px);
              }
              to {
                opacity: 1;
                transform: translateX(0);
              }
            }
          `}} />
        </div>
      )}
    </>
  );
};
