/* ===========================================================================
   UI language catalog — Turkish (default), English, Arabic
   ======================================================================== */

window.MRO_I18N = (() => {
  const SUPPORTED = ["tr", "en", "ar"];
  const DEFAULT = "tr";
  const STORAGE_KEY = "mro-lang";

  const META = {
    tr: { dir: "ltr", locale: "tr-TR", label: "Türkçe" },
    en: { dir: "ltr", locale: "en-US", label: "English" },
    ar: { dir: "rtl", locale: "ar", label: "العربية" },
  };

  const strings = {
    tr: {
      title: "Çok Modlu Araştırma Orkestratörü",
      brandTitle: "Çok Modlu Araştırma Orkestratörü",
      brandSub: "Sabit boru hattı çok ajanlı sistem · SENG 456",
      hudTime: "süre",
      hudTokens: "jeton",
      hudRetries: "yeniden",
      historyBtn: "Çalışma geçmişi (H)",
      connecting: "bağlanıyor…",
      offlineMock: "çevrimdışı mock",
      serverOffline: "sunucu kapalı",
      mockTitle: "API anahtarı yok — ajanlar belirleyici çevrimdışı yanıtlar döndürür.",
      liveTitle: "Canlı model çağrıları · anahtar {key}",
      stageTitle: "Boru hattı",
      stageFlow: "planla → görü → araştır → yaz → incele",
      plannerName: "Planlayıcı",
      plannerDesc: "Konuyu numaralı bir plana böler",
      visionName: "Görü",
      visionDesc: "İsteğe bağlı görüntüyü açıklar",
      researchName: "Araştırma",
      researchDesc: "Yerel anahtar kelime aracı → bulgular",
      writerName: "Yazar",
      writerDesc: "Kısa raporu taslaklar",
      reviewerName: "İnceleyici",
      reviewerDesc: "Onaylar veya düzeltme ister",
      humanName: "İnsan kapısı",
      humanDesc: "Düzeltmeler için yetki sınırı",
      idle: "boşta",
      standby: "beklemede",
      consoleTitle: "Yürütme günlüğü",
      copy: "kopyala",
      clear: "temizle",
      consoleIdle: "Boşta. Bir konu yazın ve boru hattını çalıştırın.",
      newRun: "Yeni çalışma",
      modeResearch: "Araştırma",
      modeChat: "Sohbet",
      chatTitle: "Sohbet",
      chatEmpty: "Bir mesaj yazın — soldaki ajan boru hattı her turda planlar, araştırır ve yanıtı yazar.",
      chatPlaceholder: "Takip sorusu yazın…",
      chatSend: "Gönder",
      chatAttach: "görüntü",
      clearChat: "temizle",
      switchedToChat: "Sohbet modu — her mesaj boru hattını çalıştırır.",
      switchedToResearch: "Tek araştırma modu — bir konu, bir rapor.",
      error: "hata",
      languageLabel: "Dil",
      topicLabel: "Konu / soru",
      topicPlaceholder: "örn. Çok ajanlı orkestrasyon çok modlu görevlere nasıl yardımcı olur?",
      referenceLabel: "Referans metin",
      optional: "isteğe bağlı",
      referencePlaceholder: "Araştırma ajanının anahtar kelime aracının analiz edeceği metni yapıştırın…",
      imageLabel: "Görüntü",
      imageOpt: "isteğe bağlı · görü ajanını etkinleştirir",
      dropAria: "Görüntü ekle",
      dropMain: "Görüntüyü bırakın veya seçmek için tıklayın",
      dropHint: "PNG · JPEG · WEBP · GIF · en fazla 8 MB",
      remove: "kaldır",
      runPipeline: "Boru hattını çalıştır",
      running: "Çalışıyor…",
      cancelTitle: "Çalışmayı iptal et (Esc)",
      output: "Çıktı",
      export: "dışa aktar",
      exportTitle: "Çalışmayı Markdown olarak indir",
      copyOutputTitle: "Aktif paneli kopyala",
      tabReport: "Rapor",
      tabPlan: "Plan",
      tabResearch: "Araştırma",
      tabVision: "Görü",
      tabReview: "İnceleme",
      emptyReport: "Henüz rapor yok — üretmek için boru hattını çalıştırın.",
      emptyPlan: "Henüz plan yok.",
      emptyResearch: "Henüz bulgu yok.",
      emptyVision: "Görü ajanını etkinleştirmek için bir görüntü ekleyin.",
      emptyReview: "Henüz inceleme yok.",
      historyTitle: "Çalışma geçmişi",
      close: "Kapat",
      noHistory: "Henüz kayıtlı çalışma yok.",
      modalTitle: "İnsan onayı gerekli",
      modalBody:
        "İnceleyici bu taslağı onaylamayacak. Boru hattı duraklatıldı — sizin kararınız olmadan raporu yeniden yazmaz.",
      acceptAsIs: "Olduğu gibi kabul et",
      sendRevision: "Düzeltmeye geri gönder",
      modalFoot: "Düzeltmeler en fazla 2 tur ile sınırlıdır.",
      agentPlanner: "Planlayıcı",
      agentVision: "Görü",
      agentResearch: "Araştırma",
      agentWriter: "Yazar",
      agentReviewer: "İnceleyici",
      agentHuman: "İnsan kapısı",
      enterTopic: "Önce bir konu girin.",
      runStarted: 'Çalışma başladı · "{topic}"',
      imageAttached: "Görüntü eklendi — görü ajanı etkin.",
      referenceAttached: "Referans metin eklendi.",
      couldNotStart: "Çalışma başlatılamadı.",
      connectionLost: "Sunucu bağlantısı kesildi.",
      runCancelled: "Çalışma iptal edildi.",
      cancelled: "iptal edildi",
      revising: "düzeltiliyor",
      runningState: "çalışıyor",
      started: "başladı",
      revisionPass: " (düzeltme turu)",
      retryingIn: "Yeniden deneniyor {s}s içinde…",
      retrying: "yeniden deneniyor",
      skipped: "atlandı",
      skippedReason: "atlandı — {reason}",
      noImageReason: "görüntü yok",
      done: "bitti",
      failed: "başarısız",
      awaitingYou: "sizi bekliyor",
      reviewerRequested: "İnceleyici değişiklik istedi: {reason}",
      accepted: "kabul edildi",
      sentBack: "geri gönderildi",
      youAccepted: "Taslağı olduğu gibi kabul ettiniz.",
      youSentBack: "Taslağı düzeltmeye geri gönderdiniz.",
      noImageRun: "Bu çalışma için görüntü sağlanmadı.",
      pipelineComplete: "Boru hattı tamamlandı · {verdict} · {time} · {tokens} jeton",
      approved: "onaylandı",
      needsRevision: "düzeltme gerekli",
      reportApproved: "Rapor onaylandı",
      reportNeedsRevision: "Rapor düzeltme gerektiriyor",
      revisionCount: " · {n} düzeltme",
      words: "kelime",
      sentences: "cümle",
      avgSent: "ort/cümle",
      source: "kaynak",
      reference: "referans",
      topicSource: "konu",
      keywords: "Anahtar kelimeler",
      phrases: "Yinelenen ifadeler",
      findings: "Bulgular",
      approvedBadge: "✓ Onaylandı",
      needsRevisionBadge: "⚠ Düzeltme gerekli",
      reviewNote: "Not",
      reviewParseNote:
        "İnceleyici beklenen yanıt biçimini bozdu; karar metninden çıkarıldı.",
      unsupportedImage: "Desteklenmeyen görüntü türü.",
      useImageTypes: "PNG, JPEG, WEBP veya GIF kullanın.",
      imageTooLarge: "Görüntü çok büyük.",
      imageLimit: "{size} — sınır 8 MB.",
      couldNotRead: "Dosya okunamadı.",
      imageReady: "Görüntü hazır — görü ajanı çalışacak.",
      noReason: "(neden belirtilmedi)",
      couldNotSendDecision: "Kararınız gönderilemedi.",
      couldNotLoadHistory: "Geçmiş yüklenemedi.",
      loadedHistory: "Geçmişten çalışma yüklendi.",
      couldNotLoadRun: "Bu çalışma yüklenemedi.",
      downloadingMd: "Markdown dışa aktarma indiriliyor…",
      outputCopied: "Çıktı kopyalandı.",
      logCopied: "Günlük kopyalandı.",
      logCleared: "Günlük temizlendi.",
      nothingToCopy: "Kopyalanacak bir şey yok.",
      clipboardBlocked: "Pano erişimi engellendi.",
      pipelineOnline: "Boru hattı çevrimiçi · {mode}",
    },

    en: {
      title: "Multimodal Research Orchestrator",
      brandTitle: "Multimodal Research Orchestrator",
      brandSub: "Fixed-pipeline multi-agent system · SENG 456",
      hudTime: "time",
      hudTokens: "tokens",
      hudRetries: "retries",
      historyBtn: "Run history (H)",
      connecting: "connecting…",
      offlineMock: "offline mock",
      serverOffline: "server offline",
      mockTitle: "No API key set — agents return deterministic offline responses.",
      liveTitle: "Live model calls · key {key}",
      stageTitle: "Pipeline",
      stageFlow: "plan → vision → research → write → review",
      plannerName: "Planner",
      plannerDesc: "Breaks the topic into a numbered plan",
      visionName: "Vision",
      visionDesc: "Describes an optional image",
      researchName: "Research",
      researchDesc: "Local keyword tool → findings",
      writerName: "Writer",
      writerDesc: "Drafts the short report",
      reviewerName: "Reviewer",
      reviewerDesc: "Approves or requests revision",
      humanName: "Human gate",
      humanDesc: "Authority boundary for revisions",
      idle: "idle",
      standby: "standby",
      consoleTitle: "Execution log",
      copy: "copy",
      clear: "clear",
      consoleIdle: "Idle. Describe a topic and run the pipeline.",
      newRun: "New run",
      modeResearch: "Research",
      modeChat: "Chat",
      chatTitle: "Chat",
      chatEmpty: "Write a message — the agent pipeline on the left plans, researches, and writes each turn.",
      chatPlaceholder: "Ask a follow-up…",
      chatSend: "Send",
      chatAttach: "image",
      clearChat: "clear",
      switchedToChat: "Chat mode — each message runs the pipeline.",
      switchedToResearch: "Single research mode — one topic, one report.",
      error: "error",
      languageLabel: "Language",
      topicLabel: "Topic / question",
      topicPlaceholder: "e.g. How does multi-agent orchestration help with multimodal tasks?",
      referenceLabel: "Reference text",
      optional: "optional",
      referencePlaceholder: "Paste material for the research agent's keyword tool to analyze…",
      imageLabel: "Image",
      imageOpt: "optional · enables the vision agent",
      dropAria: "Attach an image",
      dropMain: "Drop an image or click to browse",
      dropHint: "PNG · JPEG · WEBP · GIF · max 8 MB",
      remove: "remove",
      runPipeline: "Run pipeline",
      running: "Running…",
      cancelTitle: "Cancel run (Esc)",
      output: "Output",
      export: "export",
      exportTitle: "Download run as Markdown",
      copyOutputTitle: "Copy active panel",
      tabReport: "Report",
      tabPlan: "Plan",
      tabResearch: "Research",
      tabVision: "Vision",
      tabReview: "Review",
      emptyReport: "No report yet — run the pipeline to generate one.",
      emptyPlan: "No plan yet.",
      emptyResearch: "No findings yet.",
      emptyVision: "Attach an image to activate the vision agent.",
      emptyReview: "No review yet.",
      historyTitle: "Run history",
      close: "Close",
      noHistory: "No saved runs yet.",
      modalTitle: "Human approval required",
      modalBody:
        "The reviewer will not sign off on this draft. The pipeline is paused — it will not rewrite the report without your decision.",
      acceptAsIs: "Accept as-is",
      sendRevision: "Send back for revision",
      modalFoot: "Revisions are capped at 2 rounds.",
      agentPlanner: "Planner",
      agentVision: "Vision",
      agentResearch: "Research",
      agentWriter: "Writer",
      agentReviewer: "Reviewer",
      agentHuman: "Human gate",
      enterTopic: "Enter a topic first.",
      runStarted: 'Run started · "{topic}"',
      imageAttached: "Image attached — vision agent enabled.",
      referenceAttached: "Reference text attached.",
      couldNotStart: "Could not start the run.",
      connectionLost: "Connection to the server was lost.",
      runCancelled: "Run cancelled.",
      cancelled: "cancelled",
      revising: "revising",
      runningState: "running",
      started: "started",
      revisionPass: " (revision pass)",
      retryingIn: "Retrying in {s}s…",
      retrying: "retrying",
      skipped: "skipped",
      skippedReason: "skipped — {reason}",
      noImageReason: "no image supplied",
      done: "done",
      failed: "failed",
      awaitingYou: "awaiting you",
      reviewerRequested: "Reviewer requested changes: {reason}",
      accepted: "accepted",
      sentBack: "sent back",
      youAccepted: "You accepted the draft as-is.",
      youSentBack: "You sent the draft back for revision.",
      noImageRun: "No image was supplied for this run.",
      pipelineComplete: "Pipeline complete · {verdict} · {time} · {tokens} tokens",
      approved: "approved",
      needsRevision: "needs revision",
      reportApproved: "Report approved",
      reportNeedsRevision: "Report needs revision",
      revisionCount: " · {n} revision(s)",
      words: "words",
      sentences: "sentences",
      avgSent: "avg/sent",
      source: "source",
      reference: "reference",
      topicSource: "topic",
      keywords: "Keywords",
      phrases: "Recurring phrases",
      findings: "Findings",
      approvedBadge: "✓ Approved",
      needsRevisionBadge: "⚠ Needs revision",
      reviewNote: "Note",
      reviewParseNote:
        "The reviewer broke the expected reply format; the verdict was inferred from its wording.",
      unsupportedImage: "Unsupported image type.",
      useImageTypes: "Use PNG, JPEG, WEBP or GIF.",
      imageTooLarge: "Image is too large.",
      imageLimit: "{size} — the limit is 8 MB.",
      couldNotRead: "Could not read that file.",
      imageReady: "Image ready — the vision agent will run.",
      noReason: "(no reason given)",
      couldNotSendDecision: "Could not send your decision.",
      couldNotLoadHistory: "Could not load history.",
      loadedHistory: "Loaded run from history.",
      couldNotLoadRun: "Could not load that run.",
      downloadingMd: "Downloading Markdown export…",
      outputCopied: "Output copied.",
      logCopied: "Log copied.",
      logCleared: "Log cleared.",
      nothingToCopy: "Nothing to copy.",
      clipboardBlocked: "Clipboard access was blocked.",
      pipelineOnline: "Pipeline online · {mode}",
    },

    ar: {
      title: "منسّق البحث متعدد الوسائط",
      brandTitle: "منسّق البحث متعدد الوسائط",
      brandSub: "نظام متعدد الوكلاء بخط أنابيب ثابت · SENG 456",
      hudTime: "الوقت",
      hudTokens: "رموز",
      hudRetries: "إعادة",
      historyBtn: "سجل التشغيل (H)",
      connecting: "جارٍ الاتصال…",
      offlineMock: "محاكاة دون اتصال",
      serverOffline: "الخادم غير متصل",
      mockTitle: "لا يوجد مفتاح API — تُرجع الوكلاء ردوداً حتمية دون اتصال.",
      liveTitle: "استدعاءات النموذج مباشرة · المفتاح {key}",
      stageTitle: "خط الأنابيب",
      stageFlow: "تخطيط → رؤية → بحث → كتابة → مراجعة",
      plannerName: "المخطّط",
      plannerDesc: "يقسم الموضوع إلى خطة مرقّمة",
      visionName: "الرؤية",
      visionDesc: "يصف صورة اختيارية",
      researchName: "البحث",
      researchDesc: "أداة كلمات مفتاحية محلية → نتائج",
      writerName: "الكاتب",
      writerDesc: "يصوغ التقرير القصير",
      reviewerName: "المراجع",
      reviewerDesc: "يوافق أو يطلب تعديلاً",
      humanName: "بوابة بشرية",
      humanDesc: "حدود السلطة للتعديلات",
      idle: "خامل",
      standby: "استعداد",
      consoleTitle: "سجل التنفيذ",
      copy: "نسخ",
      clear: "مسح",
      consoleIdle: "خامل. صف موضوعاً وشغّل خط الأنابيب.",
      newRun: "تشغيل جديد",
      modeResearch: "بحث",
      modeChat: "محادثة",
      chatTitle: "محادثة",
      chatEmpty: "اكتب رسالة — خط الأنابيب على اليسار يخطط ويبحث ويكتب في كل جولة.",
      chatPlaceholder: "اسأل متابعة…",
      chatSend: "إرسال",
      chatAttach: "صورة",
      clearChat: "مسح",
      switchedToChat: "وضع المحادثة — كل رسالة تشغّل خط الأنابيب.",
      switchedToResearch: "وضع البحث الواحد — موضوع واحد وتقرير واحد.",
      error: "خطأ",
      languageLabel: "اللغة",
      topicLabel: "الموضوع / السؤال",
      topicPlaceholder: "مثال: كيف تساعد أوركسترا الوكلاء المتعددة في المهام متعددة الوسائط؟",
      referenceLabel: "نص مرجعي",
      optional: "اختياري",
      referencePlaceholder: "الصق مادة لتحليلها بأداة الكلمات المفتاحية لوكيل البحث…",
      imageLabel: "صورة",
      imageOpt: "اختياري · يفعّل وكيل الرؤية",
      dropAria: "إرفاق صورة",
      dropMain: "أسقط صورة أو انقر للتصفح",
      dropHint: "PNG · JPEG · WEBP · GIF · حتى 8 MB",
      remove: "إزالة",
      runPipeline: "تشغيل خط الأنابيب",
      running: "جارٍ التشغيل…",
      cancelTitle: "إلغاء التشغيل (Esc)",
      output: "المخرجات",
      export: "تصدير",
      exportTitle: "تنزيل التشغيل كـ Markdown",
      copyOutputTitle: "نسخ اللوحة النشطة",
      tabReport: "التقرير",
      tabPlan: "الخطة",
      tabResearch: "البحث",
      tabVision: "الرؤية",
      tabReview: "المراجعة",
      emptyReport: "لا تقرير بعد — شغّل خط الأنابيب لإنشاء واحد.",
      emptyPlan: "لا خطة بعد.",
      emptyResearch: "لا نتائج بعد.",
      emptyVision: "أرفق صورة لتفعيل وكيل الرؤية.",
      emptyReview: "لا مراجعة بعد.",
      historyTitle: "سجل التشغيل",
      close: "إغلاق",
      noHistory: "لا تشغيلات محفوظة بعد.",
      modalTitle: "مطلوب موافقة بشرية",
      modalBody:
        "لن يوافق المراجع على هذه المسودة. خط الأنابيب متوقف — لن يعيد كتابة التقرير دون قرارك.",
      acceptAsIs: "قبول كما هو",
      sendRevision: "إعادة للتعديل",
      modalFoot: "التعديلات محدودة بجولتين كحد أقصى.",
      agentPlanner: "المخطّط",
      agentVision: "الرؤية",
      agentResearch: "البحث",
      agentWriter: "الكاتب",
      agentReviewer: "المراجع",
      agentHuman: "بوابة بشرية",
      enterTopic: "أدخل موضوعاً أولاً.",
      runStarted: 'بدأ التشغيل · "{topic}"',
      imageAttached: "أُرفقت صورة — وكيل الرؤية مفعّل.",
      referenceAttached: "أُرفق نص مرجعي.",
      couldNotStart: "تعذّر بدء التشغيل.",
      connectionLost: "فُقد الاتصال بالخادم.",
      runCancelled: "أُلغي التشغيل.",
      cancelled: "ملغى",
      revising: "جارٍ التعديل",
      runningState: "يعمل",
      started: "بدأ",
      revisionPass: " (جولة تعديل)",
      retryingIn: "إعادة المحاولة خلال {s}ث…",
      retrying: "إعادة المحاولة",
      skipped: "تخطّى",
      skippedReason: "تخطّى — {reason}",
      noImageReason: "لا صورة",
      done: "تم",
      failed: "فشل",
      awaitingYou: "بانتظارك",
      reviewerRequested: "طلب المراجع تغييرات: {reason}",
      accepted: "مقبول",
      sentBack: "أُعيد",
      youAccepted: "قبلت المسودة كما هي.",
      youSentBack: "أرسلت المسودة للتعديل.",
      noImageRun: "لم تُزوَّد صورة لهذا التشغيل.",
      pipelineComplete: "اكتمل خط الأنابيب · {verdict} · {time} · {tokens} رمزاً",
      approved: "موافق عليه",
      needsRevision: "يحتاج تعديلاً",
      reportApproved: "وُوفق على التقرير",
      reportNeedsRevision: "التقرير يحتاج تعديلاً",
      revisionCount: " · {n} تعديل/تعديلات",
      words: "كلمات",
      sentences: "جمل",
      avgSent: "متوسط/جملة",
      source: "مصدر",
      reference: "مرجع",
      topicSource: "موضوع",
      keywords: "كلمات مفتاحية",
      phrases: "عبارات متكررة",
      findings: "النتائج",
      approvedBadge: "✓ موافق عليه",
      needsRevisionBadge: "⚠ يحتاج تعديلاً",
      reviewNote: "ملاحظة",
      reviewParseNote: "كسر المراجع صيغة الرد المتوقعة؛ استُنتج الحكم من الصياغة.",
      unsupportedImage: "نوع صورة غير مدعوم.",
      useImageTypes: "استخدم PNG أو JPEG أو WEBP أو GIF.",
      imageTooLarge: "الصورة كبيرة جداً.",
      imageLimit: "{size} — الحد 8 MB.",
      couldNotRead: "تعذّر قراءة الملف.",
      imageReady: "الصورة جاهزة — سيعمل وكيل الرؤية.",
      noReason: "(لم يُذكر سبب)",
      couldNotSendDecision: "تعذّر إرسال قرارك.",
      couldNotLoadHistory: "تعذّر تحميل السجل.",
      loadedHistory: "حُمّل تشغيل من السجل.",
      couldNotLoadRun: "تعذّر تحميل ذلك التشغيل.",
      downloadingMd: "جارٍ تنزيل تصدير Markdown…",
      outputCopied: "نُسخت المخرجات.",
      logCopied: "نُسخ السجل.",
      logCleared: "مُسح السجل.",
      nothingToCopy: "لا شيء للنسخ.",
      clipboardBlocked: "حُظر الوصول إلى الحافظة.",
      pipelineOnline: "خط الأنابيب متصل · {mode}",
    },
  };

  let current = DEFAULT;

  function normalize(code) {
    const c = String(code || "").toLowerCase().slice(0, 2);
    return SUPPORTED.includes(c) ? c : DEFAULT;
  }

  function t(key, vars) {
    const catalog = strings[current] || strings[DEFAULT];
    let out = catalog[key] ?? strings.en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        out = out.replaceAll(`{${k}}`, String(v));
      }
    }
    return out;
  }

  function get() {
    return current;
  }

  function loadSaved() {
    try {
      return normalize(localStorage.getItem(STORAGE_KEY));
    } catch {
      return DEFAULT;
    }
  }

  function set(code) {
    current = normalize(code);
    try {
      localStorage.setItem(STORAGE_KEY, current);
    } catch {
      /* ignore */
    }
    apply();
    return current;
  }

  function apply() {
    const meta = META[current];
    const root = document.documentElement;
    root.lang = current;
    root.dir = meta.dir;
    document.title = t("title");

    document.querySelectorAll("[data-i18n]").forEach((node) => {
      const key = node.getAttribute("data-i18n");
      if (key) node.textContent = t(key);
    });
    document.querySelectorAll("[data-i18n-html]").forEach((node) => {
      const key = node.getAttribute("data-i18n-html");
      if (key) node.innerHTML = t(key);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
      const key = node.getAttribute("data-i18n-placeholder");
      if (key) node.setAttribute("placeholder", t(key));
    });
    document.querySelectorAll("[data-i18n-title]").forEach((node) => {
      const key = node.getAttribute("data-i18n-title");
      if (key) node.setAttribute("title", t(key));
    });
    document.querySelectorAll("[data-i18n-aria]").forEach((node) => {
      const key = node.getAttribute("data-i18n-aria");
      if (key) node.setAttribute("aria-label", t(key));
    });

    // Refresh idle node state labels if they are still idle/standby.
    document.querySelectorAll(".node").forEach((node) => {
      const agent = node.dataset.agent;
      const text = node.querySelector(".state-text");
      if (!text) return;
      const running = ["running", "done", "skipped", "waiting", "error", "retrying"].some((c) =>
        node.classList.contains(c)
      );
      if (!running) text.textContent = agent === "human" ? t("standby") : t("idle");
    });

    const select = document.getElementById("languageSelect");
    if (select && select.value !== current) select.value = current;

    window.dispatchEvent(new CustomEvent("mro:langchange", { detail: { language: current } }));
  }

  function init() {
    current = loadSaved();
    apply();
  }

  return { SUPPORTED, DEFAULT, META, strings, t, get, set, init, apply, normalize };
})();
