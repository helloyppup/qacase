import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Send, MessageSquare, Table, Clipboard, Play, RotateCcw, 
  Check, Loader2, Sparkles, BookOpen, Plus, Trash2, 
  ToggleLeft, ToggleRight, X, Edit2, Cloud, AlertTriangle, Info, Settings, Save, Download, Upload, User, WifiOff,
  Paperclip, FileText, Maximize2, Minimize2
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
const firebaseConfig = typeof __firebase_config !== 'undefined'
  ? JSON.parse(__firebase_config)
  : { apiKey: "dummy-key", authDomain: "dummy", projectId: "dummy" };

const isDummyConfig = !firebaseConfig?.apiKey || firebaseConfig.apiKey === "dummy-key" || firebaseConfig.apiKey.includes("dummy");

let app = null;
let auth = null;
let db = null;

if (!isDummyConfig) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  } catch (e) {
    console.warn("Firebase initialization skipped or failed:", e);
  }
}
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- Utility: Load External Scripts for File Parsing ---
const loadScript = (src) => {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

export default function App() {
  // --- State Management ---
  const [user, setUser] = useState(null);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [isChatFullScreen, setIsChatFullScreen] = useState(false); // 新增全屏状态

  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: '你好！我是你的 AI 测试助手。\n\n我们将分两步工作：\n1. **功能讨论**：你告诉我大概要测什么，上传文档会注入全局上下文。\n2. **生成用例**：确认功能后，点击生成，我会自动为你补充详细步骤和异常场景。'
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
  const docFileInputRef = useRef(null);

  // Attached Documents
  const [attachedFiles, setAttachedFiles] = useState([]);

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
      title: '物联网设备通用异常',
      content: [
        '在设计设备相关测试用例时，必须包含：',
        '- 弱网/断网/网络频繁切换状态下的表现',
        '- 设备断电重启后的状态恢复',
        '- 丢包/乱序/重复报文处理',
        '- 协议边界值（如超长指令、非法格式）',
        '- 并发指令冲突处理'
      ].join('\n'),
      isActive: false,
      createdAt: Date.now() + 1
    }
  ];

  // --- Effects ---
  useEffect(() => {
    const savedConfig = localStorage.getItem('kiwi_qa_api_config');
    if (savedConfig) setApiConfig(JSON.parse(savedConfig));

    const initAuth = async () => {
      if (isDummyConfig || !auth) {
        console.log("ℹ️ Local/Dummy Config detected. Activating Offline Mode.");
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
        console.warn("⚠️ Cloud Auth failed (Offline Mode Activated):", error.message);
        enableOfflineMode();
      }
    };

    initAuth();
    let unsubscribe = () => {};
    if (auth) {
      unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        if (currentUser) {
          setUser(currentUser);
          setIsOfflineMode(false);
        }
      });
    }
    return () => unsubscribe();
  }, []);

  const enableOfflineMode = () => {
    setUser({ uid: 'local-user', isLocal: true });
    setIsOfflineMode(true);
  };

  // --- Data Sync ---
  useEffect(() => {
    if (!user) return;
    if (user.isLocal || !db) {
      const localData = localStorage.getItem('kiwi_qa_cards');
      if (localData) {
        setPromptCards(JSON.parse(localData));
      } else {
        setPromptCards(DEFAULT_CARDS);
        localStorage.setItem('kiwi_qa_cards', JSON.stringify(DEFAULT_CARDS));
      }
      setIsLoadingCards(false);
      return;
    }
    try {
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
          console.warn("Firestore sync interrupted:", error.code);
          setIsLoadingCards(false);
        });
        return () => unsubscribe();
    } catch (e) {
        console.warn("Firestore init failed:", e);
        setIsLoadingCards(false);
    }
  }, [user]);

  useEffect(() => {
    if (toast.show) {
      const timer = setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast.show]);

  const seedDefaultCards = async (collectionRef) => {
    if (!db) return;
    try {
      const batch = writeBatch(db);
      DEFAULT_CARDS.forEach(card => {
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

  const saveToLocalStorage = (cards) => {
    localStorage.setItem('kiwi_qa_cards', JSON.stringify(cards));
    setPromptCards(cards);
  };

  // --- Document Parsing ---
  const parsePDF = async (file) => {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map(item => item.str);
      text += strings.join(' ') + '\n';
      if (text.length > 300000) {
        text += "\n\n[提示：文档过长，为保证模型性能已截断尾部内容。]";
        break;
      }
    }
    return text;
  };

  const parseWord = async (file) => {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
    const arrayBuffer = await file.arrayBuffer();
    const result = await window.mammoth.extractRawText({ arrayBuffer });
    let text = result.value;
    if (text.length > 300000) {
      text = text.substring(0, 300000) + "\n\n[提示：文档过长，为保证模型性能已截断尾部内容。]";
    }
    return text;
  };

  const handleDocFileChange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    for (const file of files) {
      const fileId = Date.now().toString() + file.name;
      setAttachedFiles(prev => [...prev, { id: fileId, name: file.name, text: '', isParsing: true }]);

      try {
        let extractedText = '';
        const lowerName = file.name.toLowerCase();

        if (lowerName.endsWith('.pdf')) {
          extractedText = await parsePDF(file);
        } else if (lowerName.endsWith('.docx')) {
          extractedText = await parseWord(file);
        } else if (file.type.startsWith('text/') || lowerName.endsWith('.md') || lowerName.endsWith('.json')) {
          extractedText = await file.text();
        } else {
          throw new Error("不支持的格式，请上传 PDF、DOCX 或 TXT");
        }

        setAttachedFiles(prev => prev.map(f => f.id === fileId ? { ...f, text: extractedText, isParsing: false } : f));
        showNotification(`文档《${file.name}》解析成功！`);
      } catch (err) {
        console.error(err);
        setAttachedFiles(prev => prev.filter(f => f.id !== fileId));
        showNotification(`解析《${file.name}》失败: ${err.message}`, "error");
      }
    }
    if (docFileInputRef.current) docFileInputRef.current.value = '';
  };


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

  const getActiveContext = () => {
    const activeCards = promptCards.filter(c => c.isActive);
    let contextStr = "";

    if (activeCards.length > 0) {
      contextStr += `\n--- ACTIVE GLOBAL CONTEXT RULES ---\n${activeCards.map((c, i) => `${i + 1}. [${c.title}]: ${c.content}`).join('\n')}\n-----------------------------------\n`;
    }

    if (attachedFiles.length > 0) {
      contextStr += `\n--- ATTACHED PROTOCOL/REQUIREMENT DOCUMENTS ---\n下面是用户上传的设备文档，请在设计用例和解答问题时作为重要依据：\n`;
      contextStr += attachedFiles.map(f => `【文档名称: ${f.name}】\n${f.text}`).join('\n\n');
      contextStr += `\n-----------------------------------\n`;
    }

    return contextStr;
  };

  const showNotification = (message, type = 'success') => setToast({ show: true, message, type });

  const callLLM = async (prompt) => {
    if (apiConfig.provider === 'gemini' && !apiConfig.apiKey) return await callSystemGemini(prompt);
    if (!apiConfig.apiKey && apiConfig.provider !== 'custom') throw new Error("请在设置中配置 API Key");
    return (['openai', 'custom', 'deepseek'].includes(apiConfig.provider)) ? await callOpenAICompatible(prompt) : await callSystemGemini(prompt, apiConfig.apiKey);
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
    let url = "";
    let model = apiConfig.modelName;

    if (apiConfig.provider === 'deepseek') {
      url = "https://api.deepseek.com/chat/completions";
      model = model || "deepseek-chat";
    } else {
      const baseUrl = (apiConfig.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, '');
      url = `${baseUrl}/chat/completions`;
      model = model || "gpt-3.5-turbo";
    }

    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiConfig.apiKey}` },
      body: JSON.stringify({ model: model, messages: [{ role: "user", content: prompt }], temperature: 0.7 }),
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
      const prompt = `History: ${historyText}\n${getActiveContext()}\nUser Input: ${inputValue}\nYou are an expert QA Engineer. Discuss requirements with Kiwi. PHASE 1: REQUIREMENT CLARIFICATION ONLY. Focus on confirming the "Function List" and analyzing any provided protocol documents. Reply in Chinese. Be concise.`;
      const response = await callLLM(prompt);
      setMessages(prev => [...prev, { role: 'assistant', content: response }]);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'assistant', content: `连接错误: ${error.message}` }]);
    } finally { setIsDiscussing(false); }
  };

  const handleGenerateTestCases = async () => {
    if (messages.length < 2 && attachedFiles.length === 0) return showNotification("请先提供需求或协议文档", "error");
    setIsGenerating(true);
    setActiveTab('table');
    setIsChatFullScreen(false); // 生成时自动收起全屏，展示表格
    try {
      const historyText = messages.map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`).join('\n');
      const prompt = `
        PHASE 2: DEEP THINKING & GENERATION
        Context: ${historyText}
        Global Rules: ${getActiveContext()}
        
        TASK: Generate DETAILED test cases based on the discussion and any attached protocol documents.
        
        **CRITICAL FORMAT INSTRUCTION**:
        1. Return ONLY a raw JSON array.
        2. Do NOT include any conversational text, "thinking" blocks, or markdown formatting (no \`\`\`json).
        3. Do NOT start with rules or explanations like "[Rule 1]...". Just start with "[".
        4. Ensure strictly valid JSON syntax.
        5. Escape double quotes inside strings (e.g. use "\\"", NOT """).
        
        Keys: "module", "testContent", "preConditions", "testSteps" (use "\\n" for new lines), "expectedResult" (use "\\n"), "priority" (P0/P1/P2), "remarks".
        Sort: module -> testContent.
        Language: Chinese.
      `;

      const response = await callLLM(prompt);

      let cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
      const jsonArrayMatch = cleanJson.match(/\[\s*\{[\s\S]*\}\s*\]/);

      if (jsonArrayMatch) {
        cleanJson = jsonArrayMatch[0];
      } else {
        const simpleMatch = cleanJson.match(/\[[\s\S]*\]/);
        if (simpleMatch) cleanJson = simpleMatch[0];
      }

      cleanJson = cleanJson.replace(/\\'/g, "'");

      try {
        setTestCases(JSON.parse(cleanJson));
        showNotification("生成完毕！");
      } catch (firstError) {
        console.warn("JSON Parse failed, attempting auto-repair...", firstError);
        const repairedJson = cleanJson.replace(/\\(?![/\\bfnrtu"])/g, "\\\\");
        try {
           setTestCases(JSON.parse(repairedJson));
           showNotification("生成完毕 (已自动修复格式)！");
        } catch (e) {
           throw new Error("格式修复失败，请重试。");
        }
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

  // --- Handlers: Prompt Cards ---
  const toggleCard = async (id) => {
    if (!user) return;
    if (user.isLocal || !db) {
      const newCards = promptCards.map(c => c.id === id ? { ...c, isActive: !c.isActive } : c);
      saveToLocalStorage(newCards);
      return;
    }
    const c = promptCards.find(x => x.id === id);
    if(c) updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'prompt_cards', id), { isActive: !c.isActive });
  };

  const handleDeleteCardClick = (id) => {
    setConfirmDialog({
      isOpen: true, title: '删除卡片', message: '确定要删除此卡片吗？',
      onConfirm: async () => {
        if (user?.isLocal || !db) {
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
    if (!user) return showNotification("用户状态异常，请刷新重试", "error");
    if (!cardForm.title.trim() || !cardForm.content.trim()) return showNotification("标题和内容不能为空", "error");

    try {
      if (user.isLocal || !db) {
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
        if (user?.isLocal || !db) {
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
      isOpen: true, title: '清空会话', message: '确定要清空会话及已上传的附件吗？',
      onConfirm: () => {
        setMessages([{ role: 'assistant', content: '我是你的 AI 测试助手。\n\n我们分两步走：\n1. 先讨论功能列表（或者上传文档）。\n2. 再点击生成，我会为你补充详细用例。' }]);
        setTestCases([]);
        setAttachedFiles([]); // Clear attachments on reset
        setActiveTab('chat');
        setIsChatFullScreen(false);
        showNotification("已重置");
      }
    });
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-sans text-gray-800">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 md:px-6 md:py-4 flex items-center justify-between shadow-sm z-10 shrink-0">
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
        <div className={`bg-white border-r border-gray-200 transition-all duration-300 flex flex-col relative z-20 
          ${activeTab === 'table' ? 'hidden md:flex' : 'flex flex-1 w-full'} 
          ${isChatFullScreen ? 'md:w-full md:flex-1' : 'md:w-1/3 md:flex-none'}
        `}>

          {/* Chat Header (New) */}
          <div className="bg-white border-b border-gray-200 p-3 flex justify-between items-center shadow-sm shrink-0">
             <div className="flex items-center gap-2">
               <h2 className="font-semibold text-gray-700 flex items-center gap-2"><MessageSquare size={18} className="text-purple-600"/> 需求沟通</h2>
             </div>
             <div className="flex gap-2">
                <button onClick={() => setActiveTab('table')} className="md:hidden p-1.5 text-gray-500 hover:bg-gray-100 rounded-md transition" title="查看表格">
                  <Table size={18}/>
                </button>
                <button
                  onClick={() => setIsChatFullScreen(!isChatFullScreen)}
                  className="hidden md:flex p-1.5 text-gray-500 hover:bg-gray-100 rounded-md transition"
                  title={isChatFullScreen ? "收起面板" : "全屏扩展"}
                >
                  {isChatFullScreen ? <Minimize2 size={18}/> : <Maximize2 size={18}/>}
                </button>
             </div>
          </div>

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

          <div className="p-4 bg-white border-t border-gray-200 shrink-0">
            {/* Attached Files Display */}
            {attachedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3 p-2 bg-gray-50 rounded-lg border border-gray-200 max-h-24 overflow-y-auto">
                {attachedFiles.map(f => (
                  <div key={f.id} className="flex items-center gap-1 bg-white px-2 py-1 rounded border border-gray-300 text-xs text-gray-700 shadow-sm">
                    {f.isParsing ? <Loader2 size={12} className="animate-spin text-purple-600" /> : <FileText size={12} className="text-purple-600"/>}
                    <span className="max-w-[120px] truncate" title={f.name}>{f.name}</span>
                    {!f.isParsing && (
                      <button onClick={() => setAttachedFiles(prev => prev.filter(x => x.id !== f.id))} className="text-gray-400 hover:text-red-500 ml-1">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="relative">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())}
                placeholder="描述测试需求，或上传文档..."
                className="w-full pl-12 pr-12 py-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none resize-none text-sm h-24"
              />

              <button onClick={() => docFileInputRef.current?.click()} className="absolute left-3 bottom-3 p-2 text-gray-500 hover:bg-gray-200 hover:text-purple-600 rounded-lg transition" title="上传文档 (PDF/Word/TXT)">
                 <Paperclip size={18} />
              </button>
              <input type="file" multiple ref={docFileInputRef} onChange={handleDocFileChange} accept=".pdf,.doc,.docx,.txt,.md,.json" className="hidden" />

              <button onClick={handleSendMessage} disabled={!inputValue.trim() || isDiscussing || attachedFiles.some(f => f.isParsing)} className="absolute right-3 bottom-3 p-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"><Send size={16} /></button>
            </div>
            <div className="mt-3 flex justify-between">
              <p className="text-xs text-gray-400">Step 1：讨论功能与协议范围。</p>
              <button onClick={handleGenerateTestCases} disabled={isGenerating || (messages.length < 2 && attachedFiles.length === 0)} className="md:hidden flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm shadow-md">
                {isGenerating ? <Loader2 size={16}/> : <Play size={16} />} 生成
              </button>
            </div>
          </div>
        </div>

        {/* Table Panel */}
        <div className={`bg-gray-100 flex flex-col overflow-hidden transition-all duration-300 
          ${activeTab === 'chat' ? 'hidden md:flex' : 'flex flex-1 w-full'} 
          ${isChatFullScreen ? 'md:hidden' : 'md:flex-[2]'}
        `}>
          <div className="bg-white border-b border-gray-200 p-3 flex justify-between shadow-sm shrink-0">
             <div className="flex items-center gap-2">
               <button onClick={() => setActiveTab('chat')} className="md:hidden p-2 text-gray-600"><MessageSquare size={20}/></button>
               <h2 className="font-semibold text-gray-700 flex items-center gap-2"><Table size={18} className="text-purple-600"/> 生成结果</h2>
             </div>
             <div className="flex gap-2">
                <button onClick={handleGenerateTestCases} disabled={isGenerating || (messages.length < 2 && attachedFiles.length === 0)} className="hidden md:flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 shadow-sm">{isGenerating ? <Loader2 className="animate-spin" size={16}/> : <Play size={16} />} 生成用例</button>
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
                    <option value="deepseek">DeepSeek (推荐)</option>
                    <option value="openai">OpenAI / Compatible</option>
                    <option value="custom">Custom (Ollama/Local)</option>
                  </select>
                </div>

                {['openai', 'custom'].includes(apiConfig.provider) && (
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
                )}

                {apiConfig.provider !== 'gemini' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Model Name</label>
                    <input
                      type="text"
                      placeholder={apiConfig.provider === 'deepseek' ? "deepseek-chat (留空默认) 或 deepseek-reasoner" : "gpt-4"}
                      value={apiConfig.modelName}
                      onChange={e => setApiConfig({...apiConfig, modelName: e.target.value})}
                      className="w-full border rounded-lg p-2 text-sm"
                    />
                  </div>
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