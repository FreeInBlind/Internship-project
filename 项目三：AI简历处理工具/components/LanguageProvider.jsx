import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const messages = {
  zh: {
    brand: '简历工作台',
    navLabel: '主导航',
    navHome: '首页',
    navWorkspace: '工作台',
    navHistory: '历史记录',
    navSettings: '设置',
    navLogin: '登录',
    navLogout: '退出登录',
    navLoading: '正在检查登录状态…',
    skipToContent: '跳至主要内容',
    accountLabel: '账户',
    registerTitle: '注册',
    email: '电子邮箱',
    password: '密码',
    confirmPassword: '确认密码',
    loginSubmit: '登录',
    registerSubmit: '创建账户',
    working: '处理中…',
    needAccount: '还没有账户？注册',
    haveAccount: '已有账户？登录',
    passwordMismatch: '两次输入的密码不一致。',
    passwordLength: '密码须为 12 至 72 个 Unicode 字符，且不超过 72 个 UTF-8 字节。',
    passwordHint: '密码须为 12 至 72 个 Unicode 字符，且不超过 72 个 UTF-8 字节。',
    authFailed: '登录失败，请检查邮箱和密码后重试。',
    registerFailed: '注册失败，请检查输入或稍后重试。',
    networkError: '请求失败，请稍后重试。',
    registered: '请求已处理，请使用该邮箱和密码登录。',
    language: 'English',
    heroEyebrow: '提取 · 确认 · 改进',
    heroTitle: '让简历的下一步，更清楚。',
    heroBody: '先在浏览器中提取、检查简历文字，再按需使用个人 AI 生成修改建议，编辑并主动保存报告。由你决定何时发送内容。',
    startWork: '进入工作台',
    personalAiSettings: '个人 AI 设置',
    startTitle: '从一份简历开始',
    startBody: '登录后选择文件，检查提取的文字。无需调用 AI，也可以先完成提取和文本确认。',
    formatsLabel: '支持格式',
    formatsBody: 'TXT、MD、PDF、DOCX；PNG、JPG、JPEG、WEBP 图片。',
    limitsLabel: '文件与识别限制',
    limitsBody: '单个文件最大 3 MB，PDF 最多 5 页。本地 OCR 可能有误，请核对识别结果；AI 建议也需要人工判断。',
    stepsTitle: '四步处理，由你掌控',
    stepOne: '选择并提取文件',
    stepOneBody: '在浏览器内读取文件；图片和需要识别的 PDF 页面使用本地 OCR。',
    stepTwo: '检查并确认文本',
    stepTwoBody: '先修正识别错误，再提交确认。确认文本会发往本站服务端，但不会调用 AI。',
    stepThree: '按需使用个人 AI',
    stepThreeBody: '配置服务商并填写岗位信息；明确点击分析后，才发送已确认文本和岗位信息。',
    stepFour: '编辑并按需保存报告',
    viewHistory: '查看已保存报告',
    historyEntryBody: '已保存的报告可在有效期内重新打开，修改标题与 Markdown，或主动删除。未保存草稿不会出现在历史中。',
    stepFourBody: '查看结构化建议，编辑 Markdown 草稿。报告不会自动保存；你可主动保存到历史记录，首次保存起保留 14 天。',
    boundariesTitle: '开始前，了解这些边界',
    privacyTitle: '文件留在浏览器，发送由你决定',
    privacyBody: '原始文件在浏览器内解析，不上传或保存原始文件。确认文本会发送到本站；开始 AI 分析后，文本和岗位信息还会经本站服务端发送给所选服务商。主动保存报告时，确认文本与求职信息会和报告一并存入账户历史 14 天。请先移除不必要的个人信息。',
    aiTitle: 'AI 可选，服务商可能收费',
    aiBody: '官方 AI 默认关闭。个人 AI 需要自己的 API 地址、密钥和模型；连接测试和分析可能产生服务商费用。可选择仅本次使用，或将配置加密保存到账户。临时密钥仅在内存中保留；已保存密钥只在服务端解密使用，不回传浏览器。',
    temporaryTitle: '主动保存，保留 14 天',
    temporaryBody: '报告不会自动保存。主动保存后可从历史记录恢复，并仅可修改标题和 Markdown 正文；首次保存起保留 14 天，修改不会延长期限。未保存的草稿离页或刷新后丢失；当前不提供报告导出。',
    workspaceTitle: '工作台',
    workspaceBody: '在浏览器内提取文件、确认文本，并按需使用个人 AI 分析。',
    historyTitle: '历史记录',
    historyBody: '查看主动保存的报告；每份报告自首次保存起保留 14 天，修改不会续期。',
    historyEmptyTitle: '还没有已保存的报告',
    historyEmptyBody: '在报告详情页主动保存后，报告会出现在这里。登录不会自动保存报告，未保存草稿离页或刷新后无法恢复。',
    historyNext: '你可以前往工作台处理简历，或先配置个人 AI。',
    settingsTitle: '设置',
    settingsBody: '配置自己的 AI 服务商。只有你主动测试连接或开始分析时才会发送请求，服务商可能收费。',
    officialAi: '官方 AI',
    officialAiUnavailable: '暂不支持',
    officialAiReady: '官方 AI 当前可用。仅在你点击开始分析后，才会发送一次已确认文本和岗位信息。',
    officialAiPaused: '官方 AI 暂不开放，不会发送分析请求。上传、文本确认和报告编辑不受影响。',
    customAi: '个人 AI',
    customAiSettings: '独立配置自定义 AI',
    loginTitle: '登录',
    loginBody: '登录或创建账户以访问简历工作台。登录不会自动保存报告，也不会调用 AI。',
    feedbackTitle: '报告详情',
    feedbackBody: '查看并编辑 Markdown；主动保存后可在 14 天有效期内从历史记录恢复。',
    backHome: '返回首页',
    unavailable: '此项功能当前尚未开放。可用操作请见本页说明。',
    statusLabel: '使用提示',
    footer: '简历工作台 · AI 按需使用 · 报告主动保存 14 天',
    titles: {
      home: '首页 | 简历工作台',
      workspace: '工作台 | 简历工作台',
      history: '历史记录 | 简历工作台',
      settings: '设置 | 简历工作台',
      login: '登录 | 简历工作台',
      feedback: '报告详情 | 简历工作台',
    },
  },
  en: {
    brand: 'Resume Workspace',
    navLabel: 'Primary navigation',
    navHome: 'Home',
    navWorkspace: 'Workspace',
    navHistory: 'History',
    navSettings: 'Settings',
    navLogin: 'Log in',
    navLogout: 'Log out',
    navLoading: 'Checking sign-in…',
    skipToContent: 'Skip to main content',
    accountLabel: 'Account',
    registerTitle: 'Register',
    email: 'Email',
    password: 'Password',
    confirmPassword: 'Confirm password',
    loginSubmit: 'Log in',
    registerSubmit: 'Create account',
    working: 'Please wait…',
    needAccount: 'Need an account? Register',
    haveAccount: 'Already have an account? Log in',
    passwordMismatch: 'The passwords do not match.',
    passwordLength: 'Password must contain 12 to 72 Unicode code points and at most 72 UTF-8 bytes.',
    passwordHint: 'Use 12 to 72 Unicode code points, with a maximum of 72 UTF-8 bytes.',
    authFailed: 'Login failed. Check your email and password and try again.',
    registerFailed: 'Registration failed. Check your details or try again later.',
    networkError: 'Request failed. Please try again later.',
    registered: 'Request processed. Please log in with this email and password.',
    language: '中文',
    heroEyebrow: 'Extract · Confirm · Improve',
    heroTitle: 'Make your next resume step clearer.',
    heroBody: 'Extract and check resume text in your browser. Optionally use your own AI provider for suggestions, then edit and explicitly save a report. You decide when to send your content.',
    startWork: 'Open workspace',
    personalAiSettings: 'Personal AI settings',
    startTitle: 'Start with your resume',
    startBody: 'Sign in, choose a file, and check the extracted text. Extraction and text confirmation do not require an AI request.',
    formatsLabel: 'Supported formats',
    formatsBody: 'TXT, MD, PDF, DOCX; PNG, JPG, JPEG, and WEBP images.',
    limitsLabel: 'File and recognition limits',
    limitsBody: 'Up to 3 MB per file and 5 pages per PDF. Local OCR can make mistakes: check the extracted text. AI suggestions also need human review.',
    stepsTitle: 'Four steps, in your control',
    stepOne: 'Choose and extract a file',
    stepOneBody: 'Files are read in your browser. Images and PDF pages that need recognition use local OCR.',
    stepTwo: 'Check and confirm the text',
    stepTwoBody: 'Fix recognition errors before confirming. Confirmation sends the text to this app’s server, but does not call AI.',
    stepThree: 'Use personal AI if needed',
    stepThreeBody: 'Configure a provider and add job details. Confirmed text and job details are sent only when you explicitly start analysis.',
    stepFour: 'Edit and optionally save the report',
    viewHistory: 'View saved reports',
    historyEntryBody: 'Reopen saved reports before expiry, edit the title and Markdown, or delete them. Unsaved drafts do not appear in history.',
    stepFourBody: 'Read structured suggestions and edit a Markdown draft. Reports are not saved automatically. Explicitly saved reports remain available for 14 days from first save.',
    boundariesTitle: 'Know the boundaries before you start',
    privacyTitle: 'Local files, deliberate sharing',
    privacyBody: 'Original files are parsed in your browser, not uploaded or saved. Confirmed text is sent to this app’s server. Starting AI analysis also sends text and job details through the server to your chosen provider. Explicitly saving a report stores its confirmed text and job context in your account history for 14 days. Remove unnecessary personal information first.',
    aiTitle: 'Optional AI, possible provider charges',
    aiBody: 'Official AI is off by default. Personal AI needs your own API URL, key, and model; connection tests and analysis may incur provider charges. Choose temporary use or encrypted account storage. Temporary keys stay in memory; saved keys are decrypted only on the server and are never returned to the browser.',
    temporaryTitle: 'Explicit saving, 14-day retention',
    temporaryBody: 'Reports are not saved automatically. Reopen saved reports through history and edit only the title and Markdown. Reports expire 14 days after first save; edits do not extend expiry. Unsaved drafts are lost when leaving or refreshing. Export is not available.',
    workspaceTitle: 'Workspace',
    workspaceBody: 'Extract files in your browser, confirm the text, and optionally analyze it with personal AI.',
    historyTitle: 'History',
    historyBody: 'View explicitly saved reports. Each expires 14 days after first save; edits do not extend expiry.',
    historyEmptyTitle: 'No saved reports yet',
    historyEmptyBody: 'Explicitly save a report on its detail page to see it here. Signing in does not enable automatic saving; unsaved drafts are lost when leaving or refreshing.',
    historyNext: 'Process a resume in the workspace, or configure personal AI first.',
    settingsTitle: 'Settings',
    settingsBody: 'Configure your own AI provider. Requests are sent only when you test a connection or start analysis, and provider charges may apply.',
    officialAi: 'Official AI',
    officialAiUnavailable: 'Currently unavailable',
    officialAiReady: 'Official AI is currently available. Confirmed text and job details are sent once, only after you click Start analysis.',
    officialAiPaused: 'Official AI is paused. No analysis request will be sent. Uploading, text confirmation, and report editing remain available.',
    customAi: 'Personal AI',
    customAiSettings: 'Configure custom AI separately',
    loginTitle: 'Log in',
    loginBody: 'Log in or create an account to access your workspace. Signing in does not automatically save reports or call AI.',
    feedbackTitle: 'Report details',
    feedbackBody: 'View and edit Markdown. Explicitly saved reports can be restored from history until their 14-day expiry.',
    backHome: 'Back home',
    unavailable: 'This option is not available yet. See this page for available actions.',
    statusLabel: 'Usage note',
    footer: 'Resume Workspace · AI on demand · Save reports for 14 days',
    titles: {
      home: 'Home | Resume Workspace',
      workspace: 'Workspace | Resume Workspace',
      history: 'History | Resume Workspace',
      settings: 'Settings | Resume Workspace',
      login: 'Log in | Resume Workspace',
      feedback: 'Report details | Resume Workspace',
    },
  },
};

const LanguageContext = createContext(null);

const languageStorageKey = 'resume-workspace-language';

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState('zh');
  const [hasLoadedPreference, setHasLoadedPreference] = useState(false);

  useEffect(() => {
    try {
      const storedLanguage = window.localStorage.getItem(languageStorageKey);
      if (storedLanguage === 'zh' || storedLanguage === 'en') {
        setLanguage(storedLanguage);
      }
    } catch {
      // Continue with the default language if browser storage is unavailable.
    }
    setHasLoadedPreference(true);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    if (hasLoadedPreference) {
      try {
        window.localStorage.setItem(languageStorageKey, language);
      } catch {
        // Continue without persistence if browser storage is unavailable.
      }
    }
  }, [language, hasLoadedPreference]);

  const value = useMemo(() => ({
    language,
    toggleLanguage: () => setLanguage((current) => current === 'zh' ? 'en' : 'zh'),
    t: messages[language],
  }), [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within LanguageProvider');
  return context;
}
