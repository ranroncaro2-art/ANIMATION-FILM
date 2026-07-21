"use client";

import React, { useState, useEffect } from 'react';

interface LoginScreenProps {
  onLoginSuccess: (deployLink: string) => void;
}

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  // Tab state: 'login' | 'register'
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');

  // Form states
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullname, setFullname] = useState('');
  
  const [macAddress, setMacAddress] = useState('Đang lấy MAC...');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [copied, setCopied] = useState(false);

  // Focus states for input glowing
  const [focusedField, setFocusedField] = useState<string | null>(null);

  // Hardcoded Apps Script Endpoint from ToolMangaPro
  const apiEndpoint = 'https://script.google.com/macros/s/AKfycbx0hbnhKtbENSTCO5qUOj02vcf4qy8Z7LFKXvsYUpbE9p-pg1zF9_n6GRZuMLgRwQk/exec';

  // Request & Feedback states
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Load MAC Address and saved configs on mount
  useEffect(() => {
    const savedUsername = localStorage.getItem('login_saved_username');
    if (savedUsername) {
      setUsername(savedUsername);
    }

    const fetchMac = async () => {
      try {
        // 1. Try Electron API if available
        if (typeof window !== 'undefined' && (window as any).electronAPI?.getMacAddress) {
          const mac = await (window as any).electronAPI.getMacAddress();
          if (mac && mac !== 'MAC-NOT-FOUND') {
            setMacAddress(mac);
            return;
          }
        }

        // 2. Fallback to Python Backend API if available
        const backendHost = typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1';
        const res = await fetch(`http://${backendHost}:8000/api/system/mac`);
        if (res.ok) {
          const data = await res.json();
          if (data.mac && data.mac !== 'MAC-NOT-FOUND' && data.mac !== 'ERROR-FETCHING-MAC') {
            setMacAddress(data.mac);
            return;
          }
        }

        // 3. Fallback
        setMacAddress('DEV-MOCK-MAC-ADDRESS');
      } catch (err) {
        console.error('Failed to get MAC address:', err);
        setMacAddress('DEV-MOCK-MAC-ADDRESS');
      }
    };

    fetchMac();
  }, []);

  const copyToClipboard = () => {
    if (macAddress === 'Đang lấy MAC...' || macAddress === 'ERROR-FETCHING-MAC') return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(macAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!username.trim() || !password.trim()) {
      setErrorMsg('Vui lòng nhập đầy đủ Tài khoản/Gmail và Mật khẩu.');
      return;
    }

    if (activeTab === 'register') {
      if (password !== confirmPassword) {
        setErrorMsg('Mật khẩu nhập lại không khớp!');
        return;
      }
      if (password.length < 6) {
        setErrorMsg('Mật khẩu phải có ít nhất 6 ký tự!');
        return;
      }
    }

    setLoading(true);

    try {
      const payload = {
        action: activeTab, // 'login' or 'register'
        username: username.trim(),
        password: password.trim(),
        fullname: fullname.trim(),
        mac: macAddress,
        app: 'TOOL-ANIME-KIDS'
      };

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify(payload),
        redirect: 'follow'
      });

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        if (activeTab === 'register') {
          setSuccessMsg(result.message || 'Đăng ký tài khoản thành công! Vui lòng chuyển sang Đăng nhập.');
          setActiveTab('login');
        } else {
          setSuccessMsg(result.message || 'Đăng nhập thành công!');
          
          if (rememberMe) {
            localStorage.setItem('login_saved_username', username);
          } else {
            localStorage.removeItem('login_saved_username');
          }

          const isValidAbsoluteUrl = (url: any): boolean => {
            if (!url) return false;
            const cleaned = String(url).trim().toLowerCase();
            if (cleaned === '' || cleaned === 'undefined' || cleaned === 'null' || cleaned === '/') return false;
            return cleaned.startsWith('http://') || cleaned.startsWith('https://');
          };

          localStorage.setItem('login_session_active', 'true');
          localStorage.setItem('login_session_user', username);
          localStorage.setItem('login_session_mac', macAddress);
          if (result.deploy_link && isValidAbsoluteUrl(result.deploy_link)) {
            localStorage.setItem('login_deploy_link', result.deploy_link);
          } else {
            localStorage.removeItem('login_deploy_link');
          }

          setTimeout(() => {
            onLoginSuccess(result.deploy_link && isValidAbsoluteUrl(result.deploy_link) ? result.deploy_link : '');
          }, 1000);
        }
      } else {
        setErrorMsg(result.message || (activeTab === 'login' ? 'Sai thông tin tài khoản hoặc thiết bị chưa được cấp quyền.' : 'Đăng ký thất bại. Tài khoản có thể đã tồn tại.'));
      }
    } catch (err: any) {
      console.error('Auth error:', err);
      setErrorMsg(`Không thể kết nối đến máy chủ xác thực. Chi tiết: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.outerContainer}>
      {/* Background neon glows */}
      <div style={styles.glowTopLeft} />
      <div style={styles.glowBottomRight} />

      {/* Main Glass Card */}
      <div style={styles.cardContainer}>
        
        {/* Header Branding */}
        <div style={styles.headerBox}>
          <div style={styles.logoIconBox}>
            <svg style={{ width: 28, height: 28, color: '#ffffff' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m16-6h2m-2 6h2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
          </div>
          <h2 style={styles.titleGradient}>
            TOOL ANIME KIDS PRO
          </h2>
          <p style={styles.subtitle}>
            Hệ thống xác thực & kích hoạt thiết bị
          </p>
        </div>

        {/* Tab Switcher */}
        <div style={styles.tabContainer}>
          <button
            type="button"
            onClick={() => {
              setActiveTab('login');
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
            style={{
              ...styles.tabBtn,
              ...(activeTab === 'login' ? styles.tabBtnActiveLogin : styles.tabBtnInactive)
            }}
          >
            Đăng nhập
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('register');
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
            style={{
              ...styles.tabBtn,
              ...(activeTab === 'register' ? styles.tabBtnActiveRegister : styles.tabBtnInactive)
            }}
          >
            Đăng ký tài khoản
          </button>
        </div>

        {/* Form Content Box */}
        <div style={styles.formPadding}>
          <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            
            {/* Alert Status Info */}
            {errorMsg && (
              <div style={styles.alertError}>
                <svg style={{ width: 20, height: 20, color: '#f87171', flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span style={{ fontSize: '12px', color: '#fecaca', lineHeight: '1.5' }}>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div style={styles.alertSuccess}>
                <svg style={{ width: 20, height: 20, color: '#34d399', flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span style={{ fontSize: '12px', color: '#a7f3d0', lineHeight: '1.5' }}>{successMsg}</span>
              </div>
            )}

            {/* Fullname Input (Only in Register tab) */}
            {activeTab === 'register' && (
              <div style={styles.inputGroup}>
                <label style={styles.label}>Họ và tên / Biệt danh</label>
                <div style={styles.inputWrapper}>
                  <span style={styles.inputIcon}>
                    <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    value={fullname}
                    onChange={(e) => setFullname(e.target.value)}
                    onFocus={() => setFocusedField('fullname')}
                    onBlur={() => setFocusedField(null)}
                    disabled={loading}
                    style={{
                      ...styles.inputElement,
                      ...(focusedField === 'fullname' ? styles.inputElementFocused : {})
                    }}
                    placeholder="Nguyễn Văn A"
                  />
                </div>
              </div>
            )}

            {/* Username Input */}
            <div style={styles.inputGroup}>
              <label style={styles.label}>Tài khoản / Gmail</label>
              <div style={styles.inputWrapper}>
                <span style={styles.inputIcon}>
                  <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onFocus={() => setFocusedField('username')}
                  onBlur={() => setFocusedField(null)}
                  disabled={loading}
                  style={{
                    ...styles.inputElement,
                    ...(focusedField === 'username' ? styles.inputElementFocused : {})
                  }}
                  placeholder="user@example.com"
                />
              </div>
            </div>

            {/* Password Input */}
            <div style={styles.inputGroup}>
              <label style={styles.label}>Mật khẩu</label>
              <div style={styles.inputWrapper}>
                <span style={styles.inputIcon}>
                  <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </span>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField(null)}
                  disabled={loading}
                  style={{
                    ...styles.inputElement,
                    paddingRight: '40px',
                    ...(focusedField === 'password' ? styles.inputElementFocused : {})
                  }}
                  placeholder="••••••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  style={styles.eyeBtn}
                >
                  {showPassword ? (
                    <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858-5.908a10.04 10.04 0 013.682-.788c4.478 0 8.268 2.943 9.542 7a10.025 10.025 0 01-4.132 5.411m-4.276-4.276a3 3 0 10-4.243-4.243" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
                    </svg>
                  ) : (
                    <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Confirm Password Input (Only in Register tab) */}
            {activeTab === 'register' && (
              <div style={styles.inputGroup}>
                <label style={styles.label}>Nhập lại mật khẩu</label>
                <div style={styles.inputWrapper}>
                  <span style={styles.inputIcon}>
                    <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </span>
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onFocus={() => setFocusedField('confirmPassword')}
                    onBlur={() => setFocusedField(null)}
                    disabled={loading}
                    style={{
                      ...styles.inputElement,
                      paddingRight: '40px',
                      ...(focusedField === 'confirmPassword' ? styles.inputElementFocused : {})
                    }}
                    placeholder="••••••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    tabIndex={-1}
                    style={styles.eyeBtn}
                  >
                    {showConfirmPassword ? (
                      <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858-5.908a10.04 10.04 0 013.682-.788c4.478 0 8.268 2.943 9.542 7a10.025 10.025 0 01-4.132 5.411m-4.276-4.276a3 3 0 10-4.243-4.243" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
                      </svg>
                    ) : (
                      <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* MAC Address Display Card */}
            <div style={styles.macCard}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={styles.macIconBox}>
                  <svg style={{ width: 18, height: 18, color: '#a78bfa' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m16-6h2m-2 6h2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                  </svg>
                </div>
                <div>
                  <p style={styles.macLabel}>Mã thiết bị (MAC Address)</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                    <p style={styles.macValue}>{macAddress}</p>
                    {macAddress !== 'Đang lấy MAC...' && macAddress !== 'ERROR-FETCHING-MAC' && (
                      <button
                        type="button"
                        onClick={copyToClipboard}
                        style={styles.copyBtn}
                        title="Sao chép mã thiết bị"
                      >
                        {copied ? (
                          <svg style={{ width: 14, height: 14, color: '#34d399' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg style={{ width: 14, height: 14, color: '#94a3b8' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div style={styles.lockedBadge}>Locked</div>
            </div>

            {/* Remember Me Checkbox (Only in Login tab) */}
            {activeTab === 'login' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 0' }}>
                <label style={styles.rememberLabel}>
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    disabled={loading}
                    style={{ accentColor: '#8b5cf6', cursor: 'pointer' }}
                  />
                  Ghi nhớ tài khoản
                </label>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              style={{
                ...styles.submitBtn,
                background: activeTab === 'login'
                  ? 'linear-gradient(135deg, #7c3aed 0%, #c026d3 100%)'
                  : 'linear-gradient(135deg, #c026d3 0%, #db2777 100%)',
                opacity: loading ? 0.7 : 1
              }}
            >
              {loading ? (
                <>
                  <span style={styles.spinnerIcon} />
                  Đang xử lý hệ thống...
                </>
              ) : activeTab === 'login' ? (
                <>
                  Đăng nhập hệ thống
                  <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </>
              ) : (
                <>
                  Đăng ký tài khoản
                  <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                </>
              )}
            </button>
          </form>

          {/* Footer Info */}
          <div style={styles.footerBox}>
            <p style={styles.footerText}>
              <svg style={{ width: 14, height: 14, color: '#64748b' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Thiết bị của bạn sẽ tự động liên kết khi đăng nhập thành công.
            </p>
          </div>

        </div>
      </div>

      <style jsx global>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// Inline Style Object Dictionary for guaranteed 100% Styling without relying on Tailwind
const styles: { [key: string]: React.CSSProperties } = {
  outerContainer: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#070b13',
    position: 'relative',
    overflow: 'hidden',
    padding: '16px',
    userSelect: 'none',
    fontFamily: "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  },
  glowTopLeft: {
    position: 'absolute',
    top: '-15%',
    left: '-15%',
    width: '55%',
    height: '55%',
    borderRadius: '50%',
    background: 'rgba(124, 58, 237, 0.15)',
    filter: 'blur(120px)',
    pointerEvents: 'none'
  },
  glowBottomRight: {
    position: 'absolute',
    bottom: '-15%',
    right: '-15%',
    width: '55%',
    height: '55%',
    borderRadius: '50%',
    background: 'rgba(219, 39, 119, 0.15)',
    filter: 'blur(120px)',
    pointerEvents: 'none'
  },
  cardContainer: {
    width: '100%',
    maxWidth: '440px',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    backdropFilter: 'blur(20px)',
    borderRadius: '24px',
    border: '1px solid rgba(51, 65, 85, 0.8)',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
    position: 'relative',
    zIndex: 10,
    overflow: 'hidden',
    transition: 'all 0.3s ease'
  },
  headerBox: {
    padding: '32px 32px 16px 32px',
    textAlign: 'center'
  },
  logoIconBox: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '56px',
    height: '56px',
    borderRadius: '16px',
    background: 'linear-gradient(135deg, #7c3aed 0%, #c026d3 100%)',
    boxShadow: '0 8px 20px rgba(124, 58, 237, 0.3)',
    marginBottom: '16px'
  },
  titleGradient: {
    fontSize: '22px',
    fontWeight: 800,
    background: 'linear-gradient(90deg, #a78bfa 0%, #f472b6 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    letterSpacing: '0.03em',
    margin: 0
  },
  subtitle: {
    fontSize: '11px',
    color: '#94a3b8',
    marginTop: '6px',
    textTransform: 'uppercase',
    letterSpacing: '0.15em',
    fontWeight: 600
  },
  tabContainer: {
    display: 'flex',
    borderBottom: '1px solid rgba(51, 65, 85, 0.8)',
    padding: '0 32px'
  },
  tabBtn: {
    flex: 1,
    padding: '12px 0',
    fontSize: '12px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  tabBtnActiveLogin: {
    borderBottom: '2px solid #8b5cf6',
    color: '#a78bfa'
  },
  tabBtnActiveRegister: {
    borderBottom: '2px solid #d946ef',
    color: '#f0abfc'
  },
  tabBtnInactive: {
    borderBottom: '2px solid transparent',
    color: '#64748b'
  },
  formPadding: {
    padding: '24px 32px 32px 32px'
  },
  alertError: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '12px',
    padding: '12px',
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-start',
    textAlign: 'left'
  },
  alertSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    border: '1px solid rgba(16, 185, 129, 0.3)',
    borderRadius: '12px',
    padding: '12px',
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-start',
    textAlign: 'left'
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    textAlign: 'left'
  },
  label: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.08em'
  },
  inputWrapper: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center'
  },
  inputIcon: {
    position: 'absolute',
    left: '12px',
    color: '#64748b',
    display: 'flex',
    alignItems: 'center',
    pointerEvents: 'none'
  },
  inputElement: {
    width: '100%',
    backgroundColor: 'rgba(2, 6, 23, 0.7)',
    border: '1px solid #1e293b',
    borderRadius: '12px',
    paddingLeft: '38px',
    paddingRight: '14px',
    paddingTop: '11px',
    paddingBottom: '11px',
    fontSize: '13px',
    color: '#f8fafc',
    outline: 'none',
    transition: 'all 0.2s ease'
  },
  inputElementFocused: {
    border: '1px solid #8b5cf6',
    boxShadow: '0 0 12px rgba(139, 92, 246, 0.3)'
  },
  eyeBtn: {
    position: 'absolute',
    right: '12px',
    background: 'none',
    border: 'none',
    color: '#64748b',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center'
  },
  macCard: {
    backgroundColor: 'rgba(2, 6, 23, 0.8)',
    border: '1px solid #1e293b',
    borderRadius: '12px',
    padding: '12px 14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    textAlign: 'left'
  },
  macIconBox: {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  macLabel: {
    fontSize: '10px',
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    margin: 0
  },
  macValue: {
    fontSize: '12px',
    fontFamily: 'monospace',
    color: '#cbd5e1',
    fontWeight: 600,
    margin: 0
  },
  copyBtn: {
    background: 'none',
    border: 'none',
    padding: '4px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    borderRadius: '4px'
  },
  lockedBadge: {
    fontSize: '9px',
    padding: '2px 8px',
    borderRadius: '20px',
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    border: '1px solid rgba(139, 92, 246, 0.3)',
    color: '#c084fc',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em'
  },
  rememberLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: '#94a3b8',
    cursor: 'pointer',
    userSelect: 'none'
  },
  submitBtn: {
    width: '100%',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '13px 0',
    fontWeight: 700,
    fontSize: '14px',
    letterSpacing: '0.03em',
    border: 'none',
    cursor: 'pointer',
    boxShadow: '0 10px 20px -5px rgba(124, 58, 237, 0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    marginTop: '6px',
    transition: 'all 0.2s ease'
  },
  spinnerIcon: {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    border: '2px solid rgba(255, 255, 255, 0.3)',
    borderTopColor: '#ffffff',
    animation: 'spin 0.8s linear infinite'
  },
  footerBox: {
    marginTop: '24px',
    paddingTop: '16px',
    borderTop: '1px solid rgba(51, 65, 85, 0.6)',
    textAlign: 'center'
  },
  footerText: {
    fontSize: '11px',
    color: '#64748b',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    margin: 0
  }
};
