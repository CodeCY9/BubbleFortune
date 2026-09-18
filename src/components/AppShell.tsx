import React, { useEffect, useCallback } from 'react';
import { Sparkles, ArrowLeft, Home, ChevronRight } from 'lucide-react';
import { translate, useLanguage } from '../i18n';
import './AppShell.css';

interface AppShellProps {
  title?: string;
  categoryName?: string;
  onBack?: () => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  title,
  categoryName,
  onBack,
  children,
}) => {
  const language = useLanguage();

  const handleBack = useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.assign('/');
    }
  }, [onBack]);

  // ESC 快捷键自动返回
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleBack]);

  return (
    <div className="app-shell-viewport">
      {/* 顶部全局统一导航栏 */}
      <header className="app-shell-topbar">
        <div className="app-shell-topbar-inner">
          <div className="app-shell-brand-area">
            <a href="/" className="app-shell-logo-link" aria-label="BubbleFortune Home">
              <Sparkles size={20} color="#f59e0b" />
              <span>BubbleFortune</span>
            </a>

            {/* 面包屑导航 */}
            <nav className="app-shell-breadcrumb" aria-label="Breadcrumb">
              <ChevronRight size={14} color="#6b7280" />
              <a href="/" className="app-shell-breadcrumb-link">
                <Home size={13} style={{ marginRight: 4 }} />
                <span>{translate('common.back', language).replace(/^[←\s]+/, '') || '大厅'}</span>
              </a>
              {title && (
                <>
                  <ChevronRight size={14} color="#6b7280" />
                  <span className="app-shell-breadcrumb-current">{title}</span>
                </>
              )}
            </nav>
          </div>

          <div className="app-shell-actions">
            <button
              type="button"
              onClick={handleBack}
              className="app-shell-back-btn"
              title="返回大厅 (Esc)"
            >
              <ArrowLeft size={16} />
              <span>返回大厅</span>
              <kbd className="app-shell-key-badge">Esc</kbd>
            </button>
          </div>
        </div>
      </header>

      {/* 内容主体 */}
      <main className="app-shell-main">
        {children}
      </main>
    </div>
  );
};
