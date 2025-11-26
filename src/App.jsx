import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Send, MessageSquare, Table, Clipboard, Play, RotateCcw, 
  Check, Loader2, Sparkles, BookOpen, Plus, Trash2, 
  ToggleLeft, ToggleRight, X, Edit2, Cloud, AlertTriangle, Info, Settings, Save, Download, Upload, User, WifiOff
} from 'lucide-react';

// --- Firebase Imports ---
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  signInWithCustomToken,
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  writeBatch
} from 'firebase/firestore';

// --- Firebase Configuration ---
// ⚠️ LOCAL DEPLOYMENT NOTE: 
// If you are running this locally with a dummy config, the app will now automatically fallback to LocalStorage.
// You don't need to change this unless you have a real Firebase project.
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : { apiKey: "dummy-key", authDomain: "dummy", projectId: "dummy" }; // Fallback for local dev without env vars

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

export default function App() {
  // --- State Management ---
  const [user, setUser] = useState(null);
  const [isOfflineMode, setIsOfflineMode] = useState(false); // New: Track offline state
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: '你好 Kiwi！我是你的 AI 测试助手。\n\n我们将分两步工作：\n1. **功能讨论**：你告诉我大概要测什么，我们先确定功能列表。\n2. **生成用例**：确认功能后，点击生成，我会自动为你补充详细步骤和异常场景。'
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isDiscussing, setIsDiscussing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [testCases, setTestCases] = useState([]);
  const [activeTab, setActiveTab] = useState('chat'); 
  
  // Prompt Cards
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
  const [promptCards, setPromptCards] = useState([]);
  const [isLoadingCards, setIsLoadingCards] = useState(true);
  const [editingCard, setEditingCard] = useState(null); 
  const [cardForm, setCardForm] = useState({ title: '', content: '' });
  const [isEditingCardMode, setIsEditingCardMode] = useState(false); 
  const fileInputRef = useRef(null); 

  // Settings & Model Config
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiConfig, setApiConfig] = useState({
    provider: 'gemini', 
    apiKey: '',
    baseUrl: '', 
    modelName: ''
  });

  // UI States
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' }); 
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: '', message: '', onConfirm: null });

  const chatEndRef = useRef(null);

  // --- Default Cards ---
  const DEFAULT_CARDS = [
    {
      id: 'default-1',
      title: 'Excel 格式化与合并规范',
      content: [
        '在生成测试用例时，请严格遵循以下格式规范：',
        '1. 【结构层级】：JSON 必须包含 "module" (功能模块) 字段。同一模块的用例必须连续排列，以便后续进行单元格合并展示。',
        '2. 【多点换行】：测试步骤和预期结果包含多点时，必须使用 "\\n" 换行，严禁写成一段。',
        '3. 【优先级标准】：严格使用 P0 (核心)、P1 (重要)、P2 (一般) 标识。'
      ].join('\n'),
      isActive: true,
      createdAt: Date.now()
    },
    {
      id: 'default-2',
      title: '通用边界值规则',
      content: [
        '在设计数值型或长度限制的输入框测试用例时，必须包含：',
        '- 最小值-1',
        '- 最小值',
        '- 最大值',
        '- 最大值+1',
        '- 空值',
        '- 非数字/特殊字符',
        '- 超长字符'
      ].join('\n'),
      isActive: false,
      createdAt: Date.now() + 1
    },
    {
      id: 'default-3',
      title: '移动端异常场景',
      content: [
        '涉及移动端功能时，需补充以下场景：',
        '- 弱网/断网状态下的表现',
        '- 飞行模式切换',
        '- 应用后台切换/杀进程',
        '- 来电/短信中断',
        '- 低电量/省电模式提醒'
      ].join('\n'),
      isActive: false,
      createdAt: Date.now() + 2
    }
  ];

  // --- Effects ---
  useEffect(() => {
    // Load Settings
    const savedConfig = localStorage.getItem('kiwi_qa_api_config');
    if (savedConfig) setApiConfig(JSON.parse(savedConfig));

    // Init Auth with Smart Fallback
    const initAuth = async () => {
      // Check if using dummy config
      if (firebaseConfig.apiKey === "dummy-key" || !firebaseConfig.apiKey) {
        console.warn("⚠️ Using Dummy Config. Switching to Offline Mode.");
        enableOfflineMode();
        return;
      }

      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth failed, falling back to offline mode:", error);
        enableOfflineMode();
      }
    };

    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setIsOfflineMode(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const enableOfflineMode = () => {
    setUser({ uid: 'local-user', isLocal: true });
    setIsOfflineMode(true);
  };

  // --- Data Sync (Hybrid: Firestore + LocalStorage) ---
  useEffect(() => {
    if (!user) return;

    // 1. Offline Mode: Sync from LocalStorage
    if (user.isLocal) {
      const localData = localStorage.getItem('kiwi_qa_cards');
      if (localData) {
        setPromptCards(JSON.parse(localData));
      } else {
        // Seed defaults for local user
        setPromptCards(DEFAULT_CARDS);
        localStorage.setItem('kiwi_qa_cards', JSON.stringify(DEFAULT_CARDS));
      }
      setIsLoadingCards(false);
      return;
    }

    // 2. Online Mode: Sync from Firestore
    const cardsCollectionRef = collection(db, 'artifacts', appId, 'users', user.uid, 'prompt_cards');
    const unsubscribe = onSnapshot(cardsCollectionRef, (snapshot) => {
      if (snapshot.empty && !snapshot.metadata.fromCache) {
        seedDefaultCards(cardsCollectionRef);
      } else {
        const loadedCards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        loadedCards.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        setPromptCards(loadedCards);
        setIsLoadingCards(false);
      }
    }, (error) => {
      console.error("Firestore sync error, switching to local view", error);
      setIsLoadingCards(false);
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (toast.show) {
      const timer = setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast.show]);

  const seedDefaultCards = async (collectionRef) => {
    try {
      const batch = writeBatch(db);
      DEFAULT_CARDS.forEach(card => {
        // Remove ID for new doc creation if needed, or use it as doc ID
        const { id, ...data } = card;
        const newDocRef = doc(collectionRef);
        batch.set(newDocRef, data);
      });
      await batch.commit();
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- Helper: Save to LocalStorage ---
  const saveToLocalStorage = (cards) => {
    localStorage.setItem('kiwi_qa_cards', JSON.stringify(cards));
    setPromptCards(cards);
  };

  // --- Logic: Row Span Calculation ---
  const rowSpans = useMemo(() => {
    if (testCases.length === 0) return { modules: [], contents: [] };
    const modules = new Array(testCases.length).fill(0);
    const contents = new Array(testCases.length).fill(0);
    let mStart = 0, cStart = 0;
    for (let i = 0; i < testCases.length; i++) {
      if (i > 0 && testCases[i].module !== testCases[i - 1].module) {
        modules[mStart] = i - mStart; mStart = i;
      }
      if (i === testCases.length - 1) modules[mStart] = i - mStart + 1;
      const isSameModule = i > 0 && testCases[i].module === testCases[i - 1].module;
      const isSameContent = i > 0 && testCases[i].testContent === testCases[i - 1].testContent;
      if (i > 0 && (!isSameModule || !isSameContent)) {
        contents[cStart] = i - cStart; cStart = i;
      }
      if (i === testCases.length - 1) contents[cStart] = i - cStart + 1;
    }
    return { modules, contents };
  }, [testCases]);

  // --- Logic: Context & API ---
  const getActiveContext = () => {
    const activeCards = promptCards.filter(c => c.isActive);
    if (activeCards.length === 0) return "";
    return `\n--- ACTIVE GLOBAL CONTEXT RULES ---\n${activeCards.map((c, i) => `${i + 1}. [${c.title}]: ${c.content}`).join('\n')}\n-----------------------------------\n`;
  };

  const showNotification = (message, type = 'success') => setToast({ show: true, message, type });

  const callLLM = async (prompt) => {
    if (apiConfig.provider === 'gemini' && !apiConfig.apiKey) return await callSystemGemini(prompt);
    if (!apiConfig.apiKey && apiConfig.provider !== 'custom') throw new Error("请在设置中配置 API Key");
    return (apiConfig.provider === 'openai' || apiConfig.provider === 'custom') ? await callOpenAICompatible(prompt) : await callSystemGemini(prompt, apiConfig.apiKey);
  };

  const callSystemGemini = async (prompt, customKey = "") => {
    const apiKey = customKey || "";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!response.ok) throw new Error(`Gemini API Error: ${response.status}`);
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  };

  const callOpenAICompatible = async (prompt) => {
    const baseUrl = apiConfig.baseUrl || "https://api.openai.com/v1";
    const url = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiConfig.apiKey}` },
      body: JSON.stringify({ model: apiConfig.modelName || "gpt-3.5-turbo", messages: [{ role: "user", content: prompt }], temperature: 0.7 }),
    });
    if (!response.ok) { const err = await response.text(); throw new Error(`Model API Error: ${response.status} - ${err}`); }
    const data = await response.json();
    return data.choices[0].message.content;
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;
    const userMsg = { role: 'user', content: inputValue };
    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setIsDiscussing(true);
    try {
      const historyText = messages.map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`).join('\n');
      const prompt = `History: ${historyText}\n${getActiveContext()}\nUser Input: ${inputValue}\nYou are an expert QA Engineer. Discuss requirements with Kiwi. PHASE 1: REQUIREMENT CLARIFICATION ONLY. Focus on confirming the "Function List". Reply in Chinese. Be concise.`;
      const response = await callLLM(prompt);
      setMessages(prev => [...prev, { role: 'assistant', content: response }]);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'assistant', content: `连接错误: ${error.message}` }]);
    } finally { setIsDiscussing(false); }
  };

  const handleGenerateTestCases = async () => {
    if (messages.length < 2) return showNotification("请先讨论需求", "error");
    setIsGenerating(true);
    setActiveTab('table');
    try {
      const historyText = messages.map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`).join('\n');
      const prompt = `PHASE 2: DEEP THINKING & GENERATION\nContext: ${historyText}\nGlobal Rules: ${getActiveContext()}\nTASK: Generate DETAILED test cases. FORMAT: JSON Array ONLY. Ensure strictly valid JSON syntax. Do NOT use single backslashes unless for escaping. Keys: "module", "testContent", "preConditions", "testSteps" (use \\n), "expectedResult" (use \\n), "priority" (P0/P1/P2), "remarks". Sort: module -> testContent. Language: Chinese.`;
      const response = await callLLM(prompt);
      let cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim().replace(/\\'/g, "'");
      try {
        setTestCases(JSON.parse(cleanJson));
        showNotification("生成完毕！");
      } catch (firstError) {
        console.warn("JSON repair...", firstError);
        const repairedJson = cleanJson.replace(/\\(?![/\\bfnrtu"])/g, "\\\\");
        setTestCases(JSON.parse(repairedJson));
        showNotification("生成完毕 (已修复格式)！");
      }
    } catch (error) {
      console.error(error);
      showNotification(`生成失败: ${error.message}`, "error");
    } finally { setIsGenerating(false); }
  };

  const handleSaveSettings = () => {
    localStorage.setItem('kiwi_qa_api_config', JSON.stringify(apiConfig));
    setIsSettingsOpen(false);
    showNotification("设置已保存");
  };

  // --- Handlers: Prompt Cards (Hybrid) ---
  const toggleCard = async (id) => {
    if (!user) return;
    if (user.isLocal) {
      const newCards = promptCards.map(c => c.id === id ? { ...c, isActive: !c.isActive } : c);
      saveToLocalStorage(newCards);
      return;
    }
    // Firebase
    const c = promptCards.find(x => x.id === id);
    if(c) updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'prompt_cards', id), { isActive: !c.isActive });
  };

  const handleDeleteCardClick = (id) => {
    setConfirmDialog({
      isOpen: true, title: '删除卡片', message: '确定要删除此卡片吗？',
      onConfirm: async () => {
        if (user?.isLocal) {
          const newCards = promptCards.filter(c => c.id !== id);
          saveToLocalStorage(newCards);
          showNotification("卡片已删除 (本地)");
        } else {
          try { await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'prompt_cards', id)); showNotification("卡片已删除"); }
          catch(e) { showNotification("删除失败", "error"); }
        }
      }
    });
  };

  const saveCard = async () => {
    // Validation Check - Ensuring it works for both local and cloud
    if (!user) {
        showNotification("用户状态异常，请刷新重试", "error");
        return;
    }
    if (!cardForm.title.trim() || !cardForm.content.trim()) {
        showNotification("标题和内容不能为空", "error");
        return;
    }

    try {
      if (user.isLocal) {
        // Local Storage Logic
        let newCards;
        if (editingCard) {
          newCards = promptCards.map(c => c.id === editingCard.id ? { ...c, title: cardForm.title, content: cardForm.content } : c);
          showNotification("卡片已更新 (本地)");
        } else {
          newCards = [...promptCards, { id: Date.now().toString(), title: cardForm.title, content: cardForm.content, isActive: true, createdAt: Date.now() }];
          showNotification("新卡片已添加 (本地)");
        }
        saveToLocalStorage(newCards);
      } else {
        // Firebase Logic
        const col = collection(db, 'artifacts', appId, 'users', user.uid, 'prompt_cards');
        if (editingCard) await updateDoc(doc(col, editingCard.id), { title: cardForm.title, content: cardForm.content });
        else await addDoc(col, { title: cardForm.title, content: cardForm.content, isActive: true, createdAt: Date.now() });
        showNotification("卡片保存成功");
      }
      setIsEditingCardMode(false);
    } catch(e) { 
        console.error(e);
        showNotification("保存失败", "error"); 
    }
  };

  // --- Handlers: Export / Import (Hybrid) ---
  const handleExportCards = () => {
    if (promptCards.length === 0) return showNotification("没有可导出的卡片", "error");
    const exportData = promptCards.map(({ title, content, isActive }) => ({ title, content, isActive }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kiwi_qa_prompts_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showNotification("提示词库已导出");
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (!Array.isArray(imported)) throw new Error("格式错误");
        
        let count = 0;
        
        if (user?.isLocal) {
            // Local Import
            const newCards = [...promptCards];
            imported.forEach(card => {
                if (card.title && card.content) {
                    newCards.push({
                        id: Date.now().toString() + Math.random(),
                        title: card.title,
                        content: card.content,
                        isActive: card.isActive ?? false,
                        createdAt: Date.now() + count++
                    });
                }
            });
            saveToLocalStorage(newCards);
        } else {
            // Firebase Import
            const batch = writeBatch(db);
            const col = collection(db, 'artifacts', appId, 'users', user.uid, 'prompt_cards');
            imported.forEach(card => {
              if (card.title && card.content) {
                const newRef = doc(col);
                batch.set(newRef, { title: card.title, content: card.content, isActive: card.isActive ?? false, createdAt: Date.now() + count++ });
              }
            });
            await batch.commit();
        }
        showNotification(`成功导入 ${count} 条规则`);
      } catch (err) {
        console.error(err);
        showNotification("导入失败：文件格式不正确", "error");
      }
      if(fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const copyToClipboard = () => {
    if (testCases.length === 0) return;
    try {
      const tempDiv = document.createElement('div');
      tempDiv.style.position = 'absolute';
      tempDiv.style.left = '-9999px';
      const getPrioStyle = (p) => {
        if(p === 'P0') return 'background-color: #fee2e2; color: #991b1b; font-weight: bold;';
        if(p === 'P1') return 'background-color: #ffedd5; color: #9a3412; font-weight: bold;';
        return 'background-color: #dcfce7; color: #166534; font-weight: bold;';
      };
      const { modules, contents } = rowSpans;
      const tableHTML = `
        <table border="1" style="border-collapse: collapse; width: 100%; font-family: sans-serif;">
          <thead>
            <tr style="background-color: #f3e8ff; color: #581c87;">
              <th style="border: 1px solid #a8a29e; padding: 8px;">功能模块</th>
              <th style="border: 1px solid #a8a29e; padding: 8px;">测试内容</th>
              <th style="border: 1px solid #a8a29e; padding: 8px;">前提条件</th>
              <th style="border: 1px solid #a8a29e; padding: 8px;">测试步骤</th>
              <th style="border: 1px solid #a8a29e; padding: 8px;">期望结果</th>
              <th style="border: 1px solid #a8a29e; padding: 8px;">优先级</th>
              <th style="border: 1px solid #a8a29e; padding: 8px;">备注</th>
            </tr>
          </thead>
          <tbody>
            ${testCases.map((tc, i) => `
              <tr>
                ${modules[i] > 0 ? `<td rowspan="${modules[i]}" style="border: 1px solid #d6d3d1; padding: 8px; vertical-align: middle; background-color: #fafafa; font-weight: bold;">${tc.module||''}</td>` : ''}
                ${contents[i] > 0 ? `<td rowspan="${contents[i]}" style="border: 1px solid #d6d3d1; padding: 8px; vertical-align: middle;">${tc.testContent||''}</td>` : ''}
                <td style="border: 1px solid #d6d3d1; padding: 8px; vertical-align: top;">${(tc.preConditions||'').replace(/\n/g, '<br>')}</td>
                <td style="border: 1px solid #d6d3d1; padding: 8px; vertical-align: top;">${(tc.testSteps||'').replace(/\n/g, '<br>')}</td>
                <td style="border: 1px solid #d6d3d1; padding: 8px; vertical-align: top;">${(tc.expectedResult||'').replace(/\n/g, '<br>')}</td>
                <td style="border: 1px solid #d6d3d1; padding: 8px; vertical-align: top; text-align: center; ${getPrioStyle(tc.priority)}">${tc.priority||''}</td>
                <td style="border: 1px solid #d6d3d1; padding: 8px; vertical-align: top;">${tc.remarks||''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`;
      tempDiv.innerHTML = tableHTML;
      document.body.appendChild(tempDiv);
      const range = document.createRange();
      range.selectNodeContents(tempDiv);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      if (document.execCommand('copy')) showNotification("✅ 已复制！");
      document.body.removeChild(tempDiv);
    } catch (err) { showNotification("自动复制受限", "error"); }
  };

  const handleResetClick = () => {
    setConfirmDialog({
      isOpen: true, title: '清空会话', message: '确定要清空会话吗？',
      onConfirm: () => {
        setMessages([{ role: 'assistant', content: '我是你的 AI 测试助手。请告诉我测试需求。' }]);
        setTestCases([]);
        setActiveTab('chat');
        showNotification("已重置");
      }
    });
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-sans text-gray-800">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 md:px-6 md:py-4 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-2">
          <div className="bg-purple-600 p-2 rounded-lg text-white"><Sparkles size={20} /></div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">智能测试用例生成器</h1>
            <div className="flex items-center gap-1 text-xs text-gray-500">
               <span>By Kiwi's Assistant</span>
               {user && <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${isOfflineMode ? 'bg-gray-200 text-gray-600' : 'bg-green-50 text-green-600'}`}>
                 {isOfflineMode ? <><WifiOff size={10}/> 本地模式</> : <><Cloud size={10}/> 云同步</>}
               </span>}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setIsSettingsOpen(true)} className="p-2 text-gray-600 hover:bg-gray-100 rounded-md" title="设置"><Settings size={20} /></button>
          <button onClick={() => setIsPromptModalOpen(true)} className="flex items-center gap-2 px-3 py-2 text-sm text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-md transition">
            <BookOpen size={16} /> <span className="hidden sm:inline">提示词库</span>
            <span className="flex items-center justify-center w-5 h-5 bg-purple-200 rounded-full text-xs font-bold">{promptCards.filter(c => c.isActive).length}</span>
          </button>
          <button onClick={handleResetClick} className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md transition"><RotateCcw size={16} /> <span className="hidden sm:inline">重置</span></button>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex overflow-hidden relative">
        {/* Chat Panel */}
        <div className={`flex-1 flex flex-col bg-white border-r border-gray-200 transition-all duration-300 ${activeTab === 'table' ? 'hidden md:flex md:w-1/3 md:flex-none' : 'w-full'}`}>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
             {!isLoadingCards && promptCards.some(c => c.isActive) && (
               <div className="flex justify-center mb-2">
                 <div className="bg-purple-100 text-purple-800 text-xs px-3 py-1 rounded-full border border-purple-200 flex items-center gap-1">
                   <BookOpen size={12} /><span>已启用 {promptCards.filter(c => c.isActive).length} 条规则</span>
                 </div>
               </div>
             )}
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed shadow-sm ${msg.role === 'user' ? 'bg-purple-600 text-white rounded-br-none' : 'bg-white border border-gray-200 text-gray-700 rounded-bl-none'}`}>
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              </div>
            ))}
            {isDiscussing && <div className="flex justify-start"><div className="bg-white border p-3 rounded-2xl rounded-bl-none"><Loader2 className="animate-spin text-purple-600" size={16} /></div></div>}
            <div ref={chatEndRef} />
          </div>
          <div className="p-4 bg-white border-t border-gray-200">
            <div className="relative">
              <textarea value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())} placeholder="描述你的测试需求..." className="w-full pr-12 pl-4 py-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none resize-none text-sm h-24" />
              <button onClick={handleSendMessage} disabled={!inputValue.trim() || isDiscussing} className="absolute right-3 bottom-3 p-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"><Send size={16} /></button>
            </div>
            <div className="mt-3 flex justify-between"><p className="text-xs text-gray-400">Step 1：讨论功能范围。</p><button onClick={handleGenerateTestCases} disabled={isGenerating || messages.length < 2} className="md:hidden flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm shadow-md">{isGenerating ? <Loader2 size={16}/> : <Play size={16} />} 生成</button></div>
          </div>
        </div>

        {/* Table Panel */}
        <div className={`flex-[2] bg-gray-100 flex flex-col overflow-hidden ${activeTab === 'chat' ? 'hidden md:flex' : 'flex'}`}>
          <div className="bg-white border-b border-gray-200 p-3 flex justify-between shadow-sm">
             <div className="flex items-center gap-2">
               <button onClick={() => setActiveTab('chat')} className="md:hidden p-2 text-gray-600"><MessageSquare size={20}/></button>
               <h2 className="font-semibold text-gray-700 flex items-center gap-2"><Table size={18} className="text-purple-600"/> 生成结果</h2>
             </div>
             <div className="flex gap-2">
                <button onClick={handleGenerateTestCases} disabled={isGenerating || messages.length < 2} className="hidden md:flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 shadow-sm">{isGenerating ? <Loader2 className="animate-spin" size={16}/> : <Play size={16} />} 生成用例</button>
               <button onClick={copyToClipboard} disabled={testCases.length === 0} className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50 shadow-sm"><Clipboard size={16} /> 复制到 Excel</button>
             </div>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {isGenerating ? (
               <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-4"><Loader2 className="animate-spin text-purple-600" size={48} /><p>正在深度分析与生成...</p></div>
            ) : testCases.length > 0 ? (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-purple-100 border-b border-purple-200">
                        <th className="p-3 text-sm font-bold text-purple-900 w-[120px]">功能模块</th>
                        <th className="p-3 text-sm font-bold text-purple-900 w-[150px]">测试内容</th>
                        <th className="p-3 text-sm font-bold text-purple-900 w-[150px]">前提条件</th>
                        <th className="p-3 text-sm font-bold text-purple-900 w-[250px]">测试步骤</th>
                        <th className="p-3 text-sm font-bold text-purple-900 w-[150px]">期望结果</th>
                        <th className="p-3 text-sm font-bold text-purple-900 w-20 text-center">优先级</th>
                        <th className="p-3 text-sm font-bold text-purple-900 w-[100px]">备注</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {testCases.map((tc, i) => (
                        <tr key={i} className="hover:bg-gray-50 text-sm text-gray-700">
                          {rowSpans.modules[i] > 0 && <td rowSpan={rowSpans.modules[i]} className="p-3 font-bold bg-gray-50 align-middle border-r border-gray-200">{tc.module}</td>}
                          {rowSpans.contents[i] > 0 && <td rowSpan={rowSpans.contents[i]} className="p-3 font-medium align-middle border-r border-gray-200">{tc.testContent}</td>}
                          <td className="p-3 text-gray-500 whitespace-pre-wrap align-top">{tc.preConditions}</td>
                          <td className="p-3 whitespace-pre-wrap align-top">{tc.testSteps}</td>
                          <td className="p-3 whitespace-pre-wrap align-top">{tc.expectedResult}</td>
                          <td className="p-3 text-center align-top"><span className={`px-2 py-1 rounded text-xs font-bold ${tc.priority === 'P0' ? 'bg-red-100 text-red-700' : tc.priority === 'P1' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>{tc.priority}</span></td>
                          <td className="p-3 text-gray-500 italic align-top">{tc.remarks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-3"><Table size={64} className="opacity-20" /><p>暂无数据</p></div>
            )}
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2"><Settings size={20} className="text-gray-600"/> 系统设置</h3>
            
            <div className="space-y-6">
              {/* Account Section */}
              <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                <h4 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-1"><User size={14}/> 当前账号信息</h4>
                <div className="text-xs text-gray-500 break-all font-mono bg-white p-2 rounded border border-gray-100">
                  {user ? (user.isLocal ? '本地离线用户 (Local User)' : `UID: ${user.uid}`) : '初始化中...'}
                </div>
                <p className="text-[10px] text-orange-500 mt-1">
                  {isOfflineMode 
                    ? '⚠️ 当前为本地模式，数据仅存在浏览器缓存中。请务必使用“提示词库”中的【导出】功能备份数据。' 
                    : '✅ 已连接云端，数据自动同步。'}
                </p>
              </div>

              {/* Model Config Section */}
              <div className="space-y-3">
                <h4 className="text-sm font-bold text-gray-700">🤖 模型配置</h4>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Provider</label>
                  <select 
                    value={apiConfig.provider} 
                    onChange={e => setApiConfig({...apiConfig, provider: e.target.value})}
                    className="w-full border rounded-lg p-2 text-sm bg-white"
                  >
                    <option value="gemini">Google Gemini (Default)</option>
                    <option value="openai">OpenAI / Compatible</option>
                    <option value="custom">Custom (Ollama/Local)</option>
                  </select>
                </div>

                {apiConfig.provider !== 'gemini' && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Base URL</label>
                      <input 
                        type="text" 
                        placeholder="https://api.openai.com/v1" 
                        value={apiConfig.baseUrl}
                        onChange={e => setApiConfig({...apiConfig, baseUrl: e.target.value})}
                        className="w-full border rounded-lg p-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Model Name</label>
                      <input 
                        type="text" 
                        placeholder="gpt-4" 
                        value={apiConfig.modelName}
                        onChange={e => setApiConfig({...apiConfig, modelName: e.target.value})}
                        className="w-full border rounded-lg p-2 text-sm"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">API Key</label>
                  <input 
                    type="password" 
                    placeholder={apiConfig.provider === 'gemini' ? "Optional (Uses System Key)" : "sk-..."}
                    value={apiConfig.apiKey}
                    onChange={e => setApiConfig({...apiConfig, apiKey: e.target.value})}
                    className="w-full border rounded-lg p-2 text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setIsSettingsOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
              <button onClick={handleSaveSettings} className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2">
                <Save size={16}/> 保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Prompt Library Modal */}
      {isPromptModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-2xl">
              <div className="flex items-center gap-2 text-purple-800"><BookOpen size={20} /><h3 className="font-bold text-lg">提示词库</h3></div>
              <div className="flex items-center gap-2">
                 <input 
                   type="file" 
                   ref={fileInputRef} 
                   onChange={handleImportFileChange} 
                   accept=".json" 
                   className="hidden"
                 />
                 <button onClick={handleImportClick} className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200 transition" title="导入配置">
                   <Upload size={14}/> <span className="hidden sm:inline">导入</span>
                 </button>
                 <button onClick={handleExportCards} className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200 transition" title="备份到本地">
                   <Download size={14}/> <span className="hidden sm:inline">导出</span>
                 </button>
                 <div className="w-px h-6 bg-gray-300 mx-1"></div>
                 <button onClick={() => {setIsPromptModalOpen(false); setIsEditingCardMode(false);}} className="p-2 hover:bg-gray-200 rounded-full text-gray-500"><X size={20} /></button>
              </div>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              {!isEditingCardMode ? (
                <div className="space-y-4">
                   <div className="flex justify-between items-center mb-4"><p className="text-sm text-gray-500">激活规则将注入 AI 大脑。</p><button onClick={() => {setEditingCard(null); setCardForm({title:'',content:''}); setIsEditingCardMode(true);}} className="flex items-center gap-1 bg-purple-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-purple-700"><Plus size={16} /> 新增</button></div>
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                     {promptCards.map(card => (
                       <div key={card.id} className={`border-2 rounded-xl p-4 relative transition-all ${card.isActive ? 'border-purple-500 bg-purple-50' : 'border-gray-200 bg-white'}`}>
                         <div className="flex justify-between items-start mb-2"><h4 className="font-bold text-gray-800 pr-8 truncate">{card.title}</h4><button onClick={() => toggleCard(card.id)} className={`text-2xl ${card.isActive ? 'text-purple-600' : 'text-gray-300'}`}>{card.isActive ? <ToggleRight size={28}/> : <ToggleLeft size={28}/>}</button></div>
                         <p className="text-xs text-gray-600 line-clamp-3 mb-8 h-10 whitespace-pre-wrap">{card.content}</p>
                         <div className="absolute bottom-3 right-3 flex gap-2">
                           <button onClick={() => {setEditingCard(card); setCardForm({title:card.title, content:card.content}); setIsEditingCardMode(true);}} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-md"><Edit2 size={14} /></button>
                           {/* Use custom delete handler instead of browser confirm */}
                           <button onClick={() => handleDeleteCardClick(card.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-md"><Trash2 size={14} /></button>
                         </div>
                       </div>
                     ))}
                   </div>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">标题</label><input type="text" value={cardForm.title} onChange={e => setCardForm({...cardForm, title: e.target.value})} className="w-full border rounded-lg p-2 focus:ring-purple-500" placeholder="例如：Excel格式规范"/></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">规则内容</label><textarea value={cardForm.content} onChange={e => setCardForm({...cardForm, content: e.target.value})} className="w-full border rounded-lg p-2 h-40 focus:ring-purple-500" placeholder="AI 应当遵循的规则..."/></div>
                  <div className="flex justify-end gap-3"><button onClick={() => setIsEditingCardMode(false)} className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg">取消</button><button onClick={saveCard} className="px-4 py-2 bg-purple-600 text-white rounded-lg">保存</button></div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirm & Toast */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold text-gray-900 mb-2">{confirmDialog.title}</h3>
            <p className="text-gray-500 text-sm mb-6">{confirmDialog.message}</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDialog(prev => ({...prev, isOpen: false}))} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg text-sm">取消</button>
              <button onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(prev => ({...prev, isOpen: false})); }} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm">确定</button>
            </div>
          </div>
        </div>
      )}
      {toast.show && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 z-[70] transition-all duration-300 ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-gray-800 text-white'}`}>
           {toast.type === 'error' ? <AlertTriangle size={18}/> : <Info size={18}/>}
           <span className="text-sm font-medium">{toast.message}</span>
        </div>
      )}
    </div>
  );
}